// V2026-10-12 (Phase 8.1 — KB 排期发布 worker / SPEC §12.5):
//   BullMQ worker 消费 kb-scheduled-publish 队列, 到点调 knowledge.approve().
//
//   决策 A (跟客户端 7.7 spec 一致): 到点时若 status ∉ {draft, review} → 跳过
//   + log notify (V0.x server log, V1.x 推 WS / 邮件).
//
//   大厂 spec (跟 src/shared/infra/queue/audit-log.processor.ts 同 pattern):
//     - onModuleInit 创建 Worker
//     - onModuleDestroy 关闭
//     - concurrency = 5 (单实例基准, 水平扩展加 worker 实例即可)

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Worker } from 'bullmq';
import { Repository } from 'typeorm';

import { KnowledgeService } from './knowledge.service';
import { ScheduledPublishService } from './scheduled-publish.service';
import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';
import { RedisService } from '../../shared/infra/redis';
import { KnowledgeItem } from '../entities/knowledge-item.entity';

@Injectable()
export class ScheduledPublishProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduledPublishProcessor.name);
  private worker!: Worker<{ itemId: string }>;

  constructor(
    private readonly redis: RedisService,
    private readonly knowledgeService: KnowledgeService,
    @InjectRepository(KnowledgeItem)
    private readonly items: Repository<KnowledgeItem>,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = this.redis.getBullClient();
    this.worker = new Worker<{ itemId: string }>(ScheduledPublishService.QUEUE_NAME, async (job) => this.processJob(job), {
      connection,
      prefix: 'bullmq',
      concurrency: 5,
    });
    this.worker.on('failed', (job, err) => {
      this.logger.error(`kb-scheduled-publish job failed: id=${job?.id}, err=${err.message}`);
    });
    this.worker.on('error', (err) => {
      this.logger.error(`kb-scheduled-publish worker error: ${err.message}`);
    });
    this.logger.log(`ScheduledPublishProcessor started: queue=${ScheduledPublishService.QUEUE_NAME}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  private async processJob(job: Job<{ itemId: string }>): Promise<void> {
    const { itemId } = job.data;
    this.logger.log(`processing scheduled publish: itemId=${itemId}`);

    // 防御性再校验: status 必须 ∈ {draft, review}, 否则跳过 (决策 A).
    // 跟 cron 兜底 + knowledge.approve() 内部 workflow.assertTransition 三层保险.
    const item = await this.items.findOne({ where: { id: itemId } });
    if (!item) {
      this.logger.warn(`scheduled publish: itemId=${itemId} not found, skip`);
      return;
    }
    if (item.status !== 'draft' && item.status !== 'review') {
      this.logger.warn(`scheduled publish: itemId=${itemId} status=${item.status} (not in {draft, review}), skip+notify (决策 A)`);
      return;
    }
    if (item.scheduledPublishAt && item.scheduledPublishAt.getTime() > Date.now() + 60_000) {
      // BullMQ 提前 1min 以上 fire (异常), 拒绝 publish.
      this.logger.warn(`scheduled publish: itemId=${itemId} scheduled_at=${item.scheduledPublishAt.toISOString()} still in future, skip`);
      return;
    }

    try {
      await this.knowledgeService.approve(item.tenantId, itemId, item.authorId);
      this.logger.log(`scheduled publish: itemId=${itemId} approved, status=published`);
    } catch (e) {
      // workflow.assertTransition 抛 BizException(InvalidStateTransition) 时,
      // 跟防御性 status check 重叠但多一层保险. 静默 log, 不 throw (防 BullMQ 重试无限循环).
      if (e instanceof BizException && e.code === BizCode.InvalidStateTransition) {
        this.logger.warn(`scheduled publish: itemId=${itemId} state changed before fire, skip`);
        return;
      }
      throw e;
    }
  }
}
