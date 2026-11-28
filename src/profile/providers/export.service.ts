import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';

import { buildExportArchive } from './export-archive.js';
import { ExportQueueService, type ExportJobData } from './export-queue.service.js';
import { UserDataExportCollector } from './user-data-export.collector.js';

import { BizCode } from '../../common/exceptions/biz-code.enum.js';
import { BizException } from '../../common/exceptions/biz.exception.js';
import { RedisService } from '../../shared/infra/redis/redis.service.js';
import { OAuthIdentity } from '../../user/entities/oauth-identity.entity.js';
import { User } from '../../user/entities/user.entity.js';
import { AuditEvent } from '../../user/enums/audit-event.enum.js';
import { AuditLogService } from '../../user/providers/audit-log.service.js';
import { JwtBlacklistService } from '../../user/providers/jwt-blacklist.service.js';
import { SessionService } from '../../user/providers/session.service.js';
import { UserState } from '../../user/user.state.js';

import { DeleteAccountDto, DeleteAccountResponseDto, ExportDataDto, ExportTaskDto } from '../dto/export.dto.js';

/** 导出任务与数据在 Redis 的 TTL —— 契约是 24h 后过期. */
export const EXPORT_TASK_TTL_SECONDS = 24 * 60 * 60;

/** 同一用户两次导出之间的最短间隔（秒）. */
export const EXPORT_MIN_INTERVAL_SECONDS = 60;

const TASK_KEY_PREFIX = 'profile:export:task:';
const DATA_KEY_PREFIX = 'profile:export:data:';
const LOCK_KEY_PREFIX = 'profile:export:lock:';

/** Redis 里的任务元数据. */
interface ExportTaskRecord {
  taskId: string;
  uid: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  format: 'json' | 'zip';
  createdAt: string;
  completedAt: string | null;
  sizeBytes: number | null;
  contentType: string | null;
  fileName: string | null;
}

/** 下载时返回的字节流信息. */
export interface ExportDownload {
  contentType: string;
  fileName: string;
  body: Buffer;
}

/**
 * 数据导出 + 一键删除服务 — V2.0 §Tab4 隐私与数据安全.
 *
 * AF-537 P0-6 治本:
 *   - 删除账户不再“只写日志就返回 deleted”：落软删、撤 session、撤 JWT、解绑 OAuth、写审计。
 *   - 导出不再返回常量 taskId / 任意 taskId 均可查询：AF-586 起改为真实采集 + Redis 任务 + 所有者校验。
 *
 * V3 计划:
 *   - 对话 / 记忆 / 练习 / 语音转写纳入导出后，exportData 切 BullMQ 异步与加密 ZIP。
 *   - deleteAccount 冷静期到期后由 soft-delete cron 做全量数据擦除。
 */
@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);
  private readonly retentionDays: number;

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly sessions: SessionService,
    private readonly blacklist: JwtBlacklistService,
    private readonly auditLog: AuditLogService,
    private readonly exportCollector: UserDataExportCollector,
    private readonly redis: RedisService,
    config: ConfigService,
    private readonly exportQueue: ExportQueueService,
  ) {
    this.retentionDays = config.get<number>('softDelete.retentionDays') ?? 30;
    this.exportQueue.registerProcessor((data) => this.processTask(data));
  }

  /**
   * 申请导出 — 只登记任务并入队，采集与打包全部异步.
   *
   * AF-595: 旧实现把 14 域采集、全量 `JSON.stringify`、ZIP CRC、base64 写 Redis
   * 全放在 HTTP 请求里；数据越多请求越久，还阻塞事件循环。现在请求线程只做
   * 锁 + 写 pending 元数据 + 入队，立即返回任务号。
   */
  async exportData(uid: string, dto: ExportDataDto): Promise<ExportTaskDto> {
    const lockKey = `${LOCK_KEY_PREFIX}${uid}`;
    const locked = await this.redis.setnx(lockKey, '1', EXPORT_MIN_INTERVAL_SECONDS);
    if (!locked) {
      throw new BizException(BizCode.RateLimited, `导出过于频繁，请 ${EXPORT_MIN_INTERVAL_SECONDS}s 后再试`);
    }

    const taskId = randomUUID();
    const format = dto.format ?? 'json';
    const record: ExportTaskRecord = {
      taskId,
      uid,
      status: 'pending',
      format,
      createdAt: new Date().toISOString(),
      completedAt: null,
      sizeBytes: null,
      contentType: null,
      fileName: null,
    };
    await this.redis.set(`${TASK_KEY_PREFIX}${taskId}`, JSON.stringify(record), EXPORT_TASK_TTL_SECONDS);

    const enqueued = await this.exportQueue.enqueue({ taskId, uid, format });
    if (!enqueued) {
      record.status = 'failed';
      await this.redis.set(`${TASK_KEY_PREFIX}${taskId}`, JSON.stringify(record), EXPORT_TASK_TTL_SECONDS);
      throw new BizException(BizCode.ServiceUnavailable, '导出任务队列不可用，请稍后重试');
    }

    await this.auditLog.log({
      userId: uid,
      event: AuditEvent.UserDataExportRequested,
      metadata: { taskId, format },
      isSuccess: true,
    });
    this.logger.log(`[export] enqueued uid=${uid} taskId=${taskId} format=${format}`);
    return ExportService.toTaskDto(record);
  }

  /**
   * Worker 侧处理：processing → 采集/打包 → completed；任一步失败落 failed.
   *
   * 失败落盘后再抛出，让 BullMQ 按 attempts 重试；最终一次仍失败时记录保持 failed，
   * 用户可通过 getExportTask 查询，不会静默丢失.
   */
  async processTask(data: ExportJobData): Promise<void> {
    const record = await this.readTask(data.uid, data.taskId);
    if (record.status === 'completed') return;

    record.status = 'processing';
    await this.writeTask(record);

    try {
      const payload = await this.exportCollector.collect(record.uid);
      const archive = buildExportArchive(record.format, payload);
      await this.redis.set(`${DATA_KEY_PREFIX}${record.taskId}`, archive.buffer.toString('base64'), EXPORT_TASK_TTL_SECONDS);

      record.status = 'completed';
      record.completedAt = new Date().toISOString();
      record.sizeBytes = archive.buffer.length;
      record.contentType = archive.contentType;
      record.fileName = archive.fileName;
      await this.writeTask(record);
      this.logger.log(`[export] completed uid=${record.uid} taskId=${record.taskId} size=${record.sizeBytes}`);
    } catch (err) {
      record.status = 'failed';
      record.completedAt = null;
      record.sizeBytes = null;
      record.contentType = null;
      record.fileName = null;
      await this.writeTask(record).catch(() => {});
      this.logger.error(`[export] failed uid=${record.uid} taskId=${record.taskId}: ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * 查询导出任务状态 — 只允许任务所有者读取.
   */
  async getExportTask(uid: string, taskId: string): Promise<ExportTaskDto> {
    const record = await this.readTask(uid, taskId);
    return ExportService.toTaskDto(record);
  }

  /**
   * 下载导出文件 — 只允许任务所有者读取；过期 / 不存在统一 404，不泄露任务存在性.
   */
  async getExportDownload(uid: string, taskId: string): Promise<ExportDownload> {
    const record = await this.readTask(uid, taskId);
    const encoded = await this.redis.get(`${DATA_KEY_PREFIX}${taskId}`);
    if (!encoded) throw new NotFoundException('导出文件不存在或已过期');
    if (record.status !== 'completed' || !record.contentType || !record.fileName) {
      throw new NotFoundException('导出尚未完成或已失败');
    }
    return {
      contentType: record.contentType,
      fileName: record.fileName,
      body: Buffer.from(encoded, 'base64'),
    };
  }

  /** 读任务元数据 + 所有者校验. */
  private async readTask(uid: string, taskId: string): Promise<ExportTaskRecord> {
    if (!/^[0-9a-f-]{36}$/.test(taskId)) throw new NotFoundException('导出任务不存在');
    const raw = await this.redis.get(`${TASK_KEY_PREFIX}${taskId}`);
    if (!raw) throw new NotFoundException('导出任务不存在或已过期');
    let record: ExportTaskRecord;
    try {
      record = JSON.parse(raw) as ExportTaskRecord;
    } catch {
      throw new NotFoundException('导出任务不存在或已过期');
    }
    if (record.uid !== uid) throw new NotFoundException('导出任务不存在或已过期');
    return record;
  }

  /** 写任务元数据（成功/失败态统一入口）. */
  private async writeTask(record: ExportTaskRecord): Promise<void> {
    await this.redis.set(`${TASK_KEY_PREFIX}${record.taskId}`, JSON.stringify(record), EXPORT_TASK_TTL_SECONDS);
  }

  /** 元数据 → 对客 DTO. */
  private static toTaskDto(record: ExportTaskRecord): ExportTaskDto {
    return {
      taskId: record.taskId,
      status: record.status,
      createdAt: record.createdAt,
      completedAt: record.completedAt,
      downloadUrl: record.status === 'completed' ? `/profile/me/export/${record.taskId}/download` : null,
      sizeBytes: record.sizeBytes,
    };
  }

  /**
   * 一键删除账户 — 软删 + 撤销全部会话 + 解绑 OAuth + 冷静期后硬删。
   *
   * 业务约束:
   *   - confirmation 必须等于 "确认删除" (防误操作)
   *   - 仅本人 uid 可删 (controller 的 JWT guard + 本方法 uid 参数)
   *   - deletedAt 写入后用户无法登录；30 天后 soft-delete cron 做全量擦除
   */
  async deleteAccount(uid: string, dto: DeleteAccountDto): Promise<DeleteAccountResponseDto> {
    if (dto.confirmation !== '确认删除') {
      throw new BizException(BizCode.InvalidParameter, '二次确认字符串不匹配');
    }

    const user = await this.userRepo.findOne({ where: { uid, deletedAt: IsNull() } });
    if (!user) {
      throw new NotFoundException('用户不存在或已删除');
    }

    const now = new Date();
    user.state = UserState.Deleted;
    user.deletedAt = now;
    user.passwordHash = '!DELETED!';
    user.phone = null;
    user.email = null;
    user.emailVerifiedAt = null;
    user.phoneVerifiedAt = null;
    await this.userRepo.save(user);

    // 撤销全部会话 + 黑名单，立即切断现有 token。
    const revoked = await this.sessions.revokeAllByUserId(uid);
    await this.blacklist.revokeMany(revoked);

    // 解绑第三方身份，避免 OAuth 再次登入已删除账号。
    await this.userRepo.manager.getRepository(OAuthIdentity).delete({ userId: uid });

    await this.auditLog.log({
      userId: uid,
      event: AuditEvent.UserAccountDeletionRequested,
      metadata: {
        reason: dto.reason ?? null,
        sessionsRevoked: revoked.length,
        retentionDays: this.retentionDays,
      },
      isSuccess: true,
    });

    this.logger.warn(`uid=${uid} requested account deletion; soft-deleted, purge after ${this.retentionDays}d`);

    const purgeAt = new Date(now.getTime() + this.retentionDays * 24 * 60 * 60 * 1000);
    return {
      status: 'deletion_requested',
      deletedAt: now.toISOString(),
      purgeAt: purgeAt.toISOString(),
    };
  }
}
