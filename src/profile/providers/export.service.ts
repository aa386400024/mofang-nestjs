import { Injectable, Logger, NotImplementedException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { BizCode } from '../../common/exceptions/biz-code.enum.js';
import { BizException } from '../../common/exceptions/biz.exception.js';
import { OAuthIdentity } from '../../user/entities/oauth-identity.entity.js';
import { User } from '../../user/entities/user.entity.js';
import { AuditEvent } from '../../user/enums/audit-event.enum.js';
import { AuditLogService } from '../../user/providers/audit-log.service.js';
import { JwtBlacklistService } from '../../user/providers/jwt-blacklist.service.js';
import { SessionService } from '../../user/providers/session.service.js';
import { UserState } from '../../user/user.state.js';

import { DeleteAccountDto, DeleteAccountResponseDto, ExportDataDto, ExportTaskDto } from '../dto/export.dto.js';

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
    config: ConfigService,
  ) {
    this.retentionDays = config.get<number>('softDelete.retentionDays') ?? 30;
  }

  /**
   * 导出我的数据 — 真实导出尚未上线，明确 501，不返回假任务。
   */
  async exportData(_uid: string, _dto: ExportDataDto): Promise<ExportTaskDto> {
    throw new NotImplementedException('数据导出功能尚未上线');
  }

  /**
   * 取导出任务状态 — 真实导出尚未上线，明确 501。
   */
  async getExportTask(_uid: string, _taskId: string): Promise<ExportTaskDto> {
    throw new NotImplementedException('数据导出功能尚未上线');
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
