import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';

import { buildExportArchive } from './export-archive.js';
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
  status: 'completed';
  createdAt: string;
  completedAt: string;
  sizeBytes: number;
  contentType: string;
  fileName: string;
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
 *   - 导出不再返回常量 taskId / 任意 taskId 均可查询：真实实现前直接 501，避免谎报。
 *
 * V3 计划:
 *   - exportData 串接 BullMQ queue, 异步生成加密 ZIP, 24h presigned URL。
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
  ) {
    this.retentionDays = config.get<number>('softDelete.retentionDays') ?? 30;
  }

  /**
   * 导出我的数据 — 同步采集 + 生成 JSON/ZIP，任务元数据与文件进 Redis 24h.
   *
   * 为什么同步生成: 当前纵切只覆盖 profile 域（10 张表），数据量在校内可控；
   * 先给出**真实可用**的导出，不假装 BullMQ 异步。等对话/记忆纳入后再切异步.
   *
   * @param uid 用户 id
   * @param dto 导出格式
   * @returns 已完成的任务状态 + 下载地址
   */
  async exportData(uid: string, dto: ExportDataDto): Promise<ExportTaskDto> {
    const lockKey = `${LOCK_KEY_PREFIX}${uid}`;
    const locked = await this.redis.setnx(lockKey, '1', EXPORT_MIN_INTERVAL_SECONDS);
    if (!locked) {
      throw new BizException(BizCode.RateLimited, `导出过于频繁，请 ${EXPORT_MIN_INTERVAL_SECONDS}s 后再试`);
    }

    const payload = await this.exportCollector.collect(uid);
    const archive = buildExportArchive(dto.format ?? 'json', payload);
    const taskId = randomUUID();
    const now = new Date();
    const record: ExportTaskRecord = {
      taskId,
      uid,
      status: 'completed',
      createdAt: now.toISOString(),
      completedAt: now.toISOString(),
      sizeBytes: archive.buffer.length,
      contentType: archive.contentType,
      fileName: archive.fileName,
    };

    await this.redis.set(`${TASK_KEY_PREFIX}${taskId}`, JSON.stringify(record), EXPORT_TASK_TTL_SECONDS);
    await this.redis.set(`${DATA_KEY_PREFIX}${taskId}`, archive.buffer.toString('base64'), EXPORT_TASK_TTL_SECONDS);
    await this.auditLog.log({
      userId: uid,
      event: AuditEvent.UserDataExportRequested,
      metadata: { taskId, format: dto.format ?? 'json', sizeBytes: record.sizeBytes },
      isSuccess: true,
    });
    this.logger.log(`[export] uid=${uid} taskId=${taskId} format=${dto.format ?? 'json'} size=${record.sizeBytes}`);
    return ExportService.toTaskDto(record);
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

  /** 元数据 → 对客 DTO. */
  private static toTaskDto(record: ExportTaskRecord): ExportTaskDto {
    return {
      taskId: record.taskId,
      status: record.status,
      createdAt: record.createdAt,
      completedAt: record.completedAt,
      downloadUrl: `/profile/me/export/${record.taskId}/download`,
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
