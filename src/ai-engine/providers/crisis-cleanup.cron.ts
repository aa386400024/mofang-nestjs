// V2026-09-04 治本 (V6.0 §11.2 + §11.3):
//   CrisisEvent 定期清理 — 90 天后归档 (§11.3 审计 + GDPR).
//   关键反双胞胎:
//     - 不写 cleanup 通用 cron (那是 system 模块, 不在 ai-engine).
//     - 不删除 CrisisEvent 原始记录 (90 天后写 archive 表, V3 接).
//   如何验证:
//     1. SELECT COUNT(*) FROM crisis_events WHERE detected_at < NOW() - INTERVAL 90 DAY
//     2. cron 触发 → 同上查询返回 0 (已归档或删除).

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';

import { CrisisEventEntity } from '../entities/crisis-event.entity';
import { CrisisLevel } from '../enums/ai-crisis.enums';

/**
 * CrisisEvent 清理 — §11.3 审计数据保留期.
 *
 * V2.0 实现: 90 天前的 high / medium 记录保留 (合规审计需要, 默认 90 天),
 * low 记录 30 天后直接删除 (隐私 + GDPR 数据最小化).
 * V3: 加 archive 表, 90 天后挪到 crisis_events_archive.
 */
@Injectable()
export class CrisisCleanupCron {
  private readonly logger = new Logger(CrisisCleanupCron.name);

  /** 审计保留期 — 90 天 (可配置, 默认 90). */
  static readonly HIGH_MEDIUM_RETENTION_DAYS = 90;
  /** low 级别保留期 — 30 天 (隐私优先). */
  static readonly LOW_RETENTION_DAYS = 30;

  constructor(
    @InjectRepository(CrisisEventEntity)
    private readonly repo: Repository<CrisisEventEntity>,
  ) {}

  /**
   * 每天凌晨 3 点执行 — 业务低峰期.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleCron(): Promise<void> {
    const start = Date.now();
    try {
      const highMediumThreshold = new Date(Date.now() - CrisisCleanupCron.HIGH_MEDIUM_RETENTION_DAYS * 24 * 3600 * 1000);
      const lowThreshold = new Date(Date.now() - CrisisCleanupCron.LOW_RETENTION_DAYS * 24 * 3600 * 1000);

      // V2026-09-04 治本: V2 阶段只删 low (隐私优先), high/medium
      // 保留 90 天供 §11.3 审计. V3 接 archive 表再挪 high/medium.
      const lowResult = await this.repo.delete({
        level: CrisisLevel.LOW,
        detectedAt: LessThan(lowThreshold),
      });

      this.logger.log(
        `Crisis cleanup done: low deleted=${lowResult.affected ?? 0} ` +
          `high/medium retained until ${highMediumThreshold.toISOString().slice(0, 10)} ` +
          `elapsed=${Date.now() - start}ms`,
      );
    } catch (e) {
      this.logger.error(`Crisis cleanup failed: ${(e as Error).message}`);
    }
  }
}
