// V2026-10-12 (Phase 8.1 — KB 排期发布 5min cron 兜底 / SPEC §12.5 / 客户端 7.7 决策 B):
//   5min cron 扫 DB 找 scheduled_publish_at <= now() && status ∈ {draft, review},
//   漏过 BullMQ job 的补发. 跟 src/ai-engine/providers/effect-aggregate.cron.ts
//   同 pattern (@Cron 装饰器 + @Injectable + private logger).
//
//   决策 B: 5min 精度 (大厂 default, 比 1min 节约 5x 资源, 比实时 WebSocket push 简单).
//   BullMQ delayed job 是主路径, cron 是兜底, 漏过率极低 (BullMQ 自身持久化
//   + 3 次重试, 只有 Redis 挂了 + 数据恢复才漏, cron 兜这种 corner case).

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { ScheduledPublishService } from './scheduled-publish.service';

@Injectable()
export class ScheduledPublishCron {
  private readonly logger = new Logger(ScheduledPublishCron.name);

  constructor(private readonly scheduledPublish: ScheduledPublishService) {}

  /**
   * 每 5 分钟跑一次 — 扫 DB 找漏过的 schedule, 重新入队 BullMQ.
   * 时序: BullMQ delayed job 失败 / Redis 短暂不可用 / 数据迁移 等场景兜底.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async rescan(): Promise<void> {
    try {
      const { rescanned } = await this.scheduledPublish.rescanDueItems();
      if (rescanned > 0) {
        this.logger.log(`scheduled-publish cron: rescanned ${rescanned} due item(s)`);
      }
    } catch (e) {
      this.logger.error(`scheduled-publish cron failed: ${(e as Error).message}`);
    }
  }
}
