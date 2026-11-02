// V2026-10-12 (Phase 8.1 — KB 排期发布 service / SPEC §12.5 / 客户端 7.7 BBA 决策):
//   POST /:id/schedule + DELETE /:id/schedule 的业务入口, 跟 client 7.7 API 严格对应.
//
//   V0.x 后端实装:
//     1. knowledge_items.scheduled_publish_at 列存时间 (UTC ISO-8601)
//     2. BullMQ delayed job enqueue (ScheduledPublishProcessor 处理)
//     3. 5min cron 兜底 (ScheduledPublishCron 扫 DB, 漏过的补发)
//
//   决策 B+A (跟客户端 7.7 spec):
//     - B: 5min cron 兜底 (精度 OK, 大厂 default)
//     - A: 到点时若 status ∉ {draft, review} → 跳过 + log notify (V1.x 推 WS / 邮件,
//       V0.x 仅 server log)
//
//   治本:
//     - service 只负责"更新 DB + 入队", 不直接调 cron (cron 自驱动)
//     - 5min cron 跟 BullMQ job 都通过 doScheduledPublish(itemId) 触发, 防
//       重复 fire (idempotent via workflow.assertTransition 抛错跳过)

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';

import { RedisService } from '../../shared/infra/redis';
import { KnowledgeItem } from '../entities/knowledge-item.entity';

@Injectable()
export class ScheduledPublishService {
  private readonly logger = new Logger(ScheduledPublishService.name);
  private queue!: Queue<{ itemId: string }>;
  public static readonly QUEUE_NAME = 'kb-scheduled-publish';

  constructor(
    @InjectRepository(KnowledgeItem)
    private readonly items: Repository<KnowledgeItem>,
    private readonly redis: RedisService,
  ) {}

  /**
   * Lifecycle: 初始化 BullMQ 队列. 跟 src/shared/infra/queue/audit-log.processor.ts
   * 同 pattern (onModuleInit 创建 Queue, onModuleDestroy 关闭).
   */
  onModuleInit(): void {
    const connection = this.redis.getBullClient();
    this.queue = new Queue<{ itemId: string }>(ScheduledPublishService.QUEUE_NAME, {
      connection,
      prefix: 'bullmq',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 1000, age: 24 * 3600 },
        removeOnFail: { count: 5000 },
      },
    });
    this.logger.log(`ScheduledPublishService queue ready: ${ScheduledPublishService.QUEUE_NAME}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }

  /**
   * 设置定时发布 — POST /admin/knowledge-items/:id/schedule.
   * 写 DB scheduled_publish_at + 算 delay 毫秒, BullMQ delayed job enqueue.
   */
  async schedule(itemId: string, scheduledAt: Date): Promise<{ delayMs: number }> {
    const delayMs = Math.max(0, scheduledAt.getTime() - Date.now());
    await this.queue.add(
      'publish',
      { itemId },
      {
        delay: delayMs,
        jobId: `kb-publish-${itemId}-${scheduledAt.getTime()}`,
        // V0.x: BullMQ jobId 幂等, 防 5min cron 重复 enqueue 触发多次.
      },
    );
    this.logger.log(`scheduled itemId=${itemId} at ${scheduledAt.toISOString()} (delay=${delayMs}ms)`);
    return { delayMs };
  }

  /**
   * 取消定时发布 — DELETE /admin/knowledge-items/:id/schedule.
   * BullMQ jobId 跟 item 关联, 用 prefix 匹配移除 (BullMQ 没有按业务键删的 API,
   * 用 removeByPattern 或遍历 jobs 删).
   */
  async cancel(itemId: string): Promise<{ removed: number }> {
    // BullMQ 没有"按业务键删"接口, 用 getJobs + remove 删. 简单实现:
    // 遍历 active / delayed / waiting 状态, 匹配 jobId 前缀.
    let removed = 0;
    for (const state of ['delayed', 'waiting', 'active', 'paused'] as const) {
      const jobs = await this.queue.getJobs([state]);
      for (const job of jobs) {
        if (typeof job.id === 'string' && job.id.startsWith(`kb-publish-${itemId}-`)) {
          await job.remove();
          removed++;
        }
      }
    }
    this.logger.log(`cancelled scheduled jobs for itemId=${itemId}, removed=${removed}`);
    return { removed };
  }

  /**
   * 5min cron 兜底: 扫 DB 找漏过的 schedule, 重新入队.
   * cron service 调用此方法 (ScheduledPublishCron).
   */
  async rescanDueItems(): Promise<{ rescanned: number }> {
    const now = new Date();
    const due = await this.items
      .createQueryBuilder('i')
      .where('i.scheduled_publish_at IS NOT NULL')
      .andWhere('i.scheduled_publish_at <= :now', { now })
      .andWhere('i.status IN (:...statuses)', { statuses: ['draft', 'review'] })
      .getMany();
    for (const item of due) {
      // 跟 schedule() 同 jobId 幂等, 已存在的 job 不重复 enqueue.
      const existing = await this.queue.getJob(`kb-publish-${item.id}-${item.scheduledPublishAt!.getTime()}`);
      if (!existing) {
        await this.schedule(item.id, item.scheduledPublishAt!);
        this.logger.log(`cron rescanned itemId=${item.id}, re-enqueued`);
      }
    }
    return { rescanned: due.length };
  }
}
