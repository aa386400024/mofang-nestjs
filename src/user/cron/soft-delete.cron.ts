import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { CronJob } from 'cron';
import { LessThan, Repository } from 'typeorm';

import { User } from '../entities/user.entity.js';
import { AuditEvent } from '../enums/audit-event.enum.js';
import { AccountErasureService } from '../providers/account-erasure.service.js';
import { AuditLogService } from '../providers/audit-log.service.js';
import { SessionService } from '../providers/session.service.js';

/**
 * Soft delete cron — 软删到期真删 (大厂 GDPR 合规).
 *
 * 设计:
 *   - 主 cron 表达式在启动时从 env 读 (默认 0 3 * * *)
 *   - 用 SchedulerRegistry + CronJob (装饰器不能动态值)
 *   - 查 deleted_at < now() - retentionDays 的用户
 *   - 真删 (TypeORM cascade 自动清关联表)
 *   - 写审计日志 (UserHardDeleted)
 *
 * 大厂做法:
 *   - 不直接 hard delete, 先 list 给一遍人工 audit (生产建议)
 *   - 这里 V2 直接硬删, 配合 audit log 留痕
 *   - V3 加"软删宽限期": 软删后 N 天内可恢复, 超期才真删
 *
 * 注意事项:
 *   - 多实例部署时, 用分布式锁 (Redis SETNX) 保证只有一个实例跑 cron
 *     V2 假设单实例, V3 加锁
 *   - Cron 表达式在 onModuleInit 时从 env 读 (不放在 @Cron 装饰器)
 */
@Injectable()
export class SoftDeleteCron {
  private readonly logger = new Logger(SoftDeleteCron.name);

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly erasure: AccountErasureService,
    private readonly auditLog: AuditLogService,
    private readonly sessions: SessionService,
    private readonly config: ConfigService,
  ) {
    // 启动时注册动态 cron (主任务: 软删到期真删)
    const cronExpr = this.config.get<string>('softDelete.cronSchedule') ?? '0 3 * * *';
    this.logger.log(`Registering cron: soft-delete-purge schedule="${cronExpr}"`);

    const job = new CronJob(cronExpr, () => {
      void this.purgeExpiredSoftDeletes();
    });
    this.schedulerRegistry.addCronJob('soft-delete-purge', job);
    job.start();
  }

  /**
   * 软删到期真删 (主流程).
   */

  public async purgeExpiredSoftDeletes(): Promise<void> {
    const retentionDays = this.config.get<number>('softDelete.retentionDays') ?? 30;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    this.logger.log(`Soft delete purge started: cutoff=${cutoff.toISOString()} retention=${retentionDays}d`);

    const victims = await this.userRepo.find({
      where: { deletedAt: LessThan(cutoff) },
      select: { uid: true, phone: true, email: true },
    });
    if (victims.length === 0) {
      this.logger.log('No expired soft-deleted users found.');
      return;
    }

    this.logger.warn(`Found ${victims.length} expired soft-deleted users, starting hard delete...`);

    let successCount = 0;
    for (const user of victims) {
      try {
        await this.purgeOne(user.uid);
        successCount++;
      } catch (err) {
        this.logger.error(`Hard delete failed: uid=${user.uid}, err=${(<Error>err).message}`);
      }
    }

    this.logger.log(`Soft delete purge completed: ${successCount}/${victims.length} users hard-deleted.`);
    await this.auditLog.log({
      userId: null,
      event: AuditEvent.UserHardDeleted,
      metadata: { totalFound: victims.length, hardDeleted: successCount, cutoff },
      isSuccess: successCount === victims.length,
    });
  }

  /**
   * 单个用户硬擦除 — 委托 AccountErasureService 按 metadata 全表删除。
   */
  private async purgeOne(uid: string): Promise<void> {
    await this.erasure.erase(uid);
    this.logger.log(`hard-deleted user: uid=${uid}`);
  }

  /**
   * 清理过期 session — 每天 3:30 AM 跑.
   */
  @Cron('30 3 * * *', { name: 'cleanup-expired-sessions' })
  public async cleanupExpiredSessions(): Promise<void> {
    const count = await this.sessions.cleanupExpired();
    this.logger.log(`Expired sessions cleanup: ${count} marked revoked`);
  }
}
