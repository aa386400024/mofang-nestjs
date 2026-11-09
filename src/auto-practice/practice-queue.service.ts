// V2026-11-08 治本 (Phase2.5 WP-D · 自动对练批量队列):
//   职责: 把"批量跑 N 场对练"做成 BullMQ 任务 —— controller 入队就返回,
//         Worker 按并发上限慢慢跑, 进程重启不丢任务, 队列长度/失败可观测.
//
//   照抄 audit-log.processor / deliberation.processor 的既定 pattern:
//     · onModuleInit 建 Queue + Worker, onModuleDestroy 用 Promise.allSettled 关;
//     · prefix: 'bullmq' + 全项目统一 defaultJobOptions;
//     · 不引 @nestjs/bull —— 仓库既定用 bullmq 原生 Queue + Worker.
//
//   并发 3 (env AUTO_PRACTICE_WORKER_CONCURRENCY 可调):
//     一场对练 ~15 轮 × 2 次 LLM ≈ 30 次调用, 单场 2-5 分钟; 并发 3 = 同时 3 场.
//
//   反双胞胎:
//     - Worker 不自己跑业务逻辑: 只调 PracticeRunnerService.run(), 业务全在 runner.
//     - job payload 只传 id (characterSlug / counselorModeId), 不传整个 entity ——
//       薄 payload 进 Redis, worker 从 DB 重新解析 mode (防 entity 形状漂移).
//     - 失败重试: attempts 1 (总共跑 2 次) —— 一场对练烧的 LLM 费用不低,
//       重试 3 次 = 3 倍成本; LLM 抖动一次重跑足够.

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type Job, Queue, Worker } from 'bullmq';
import { nanoid } from 'nanoid';
import { Repository } from 'typeorm';

import { CounselorMode } from './entities/counselor-mode.entity.js';
import { PracticeRunnerService } from './practice-runner.service.js';
import { QUEUE_NAMES } from '../shared/infra/redis/redis.constants.js';
import { RedisService } from '../shared/infra/redis/redis.service.js';

/**
 * 批量对练 job 数据.
 */
export interface AutoPracticeJobData {
  /** 来访者角色 slug. */
  readonly characterSlug: string;
  /** 咨询师模式 id (ap_counselor_modes.id). */
  readonly counselorModeId: string;
  /** 最大轮数. */
  readonly maxTurns: number;
  /** 批量批次 id. */
  readonly batchId: string;
}

/** Worker 并发数默认值. */
const DEFAULT_CONCURRENCY = 3;

@Injectable()
export class PracticeQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PracticeQueueService');
  private queue!: Queue<AutoPracticeJobData>;
  private worker!: Worker<AutoPracticeJobData>;
  private readonly concurrency: number;

  constructor(
    private readonly redis: RedisService,
    private readonly runner: PracticeRunnerService,
    @InjectRepository(CounselorMode) private readonly modeRepo: Repository<CounselorMode>,
  ) {
    const raw = Number(process.env.AUTO_PRACTICE_WORKER_CONCURRENCY);
    this.concurrency = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_CONCURRENCY;
  }

  /** @inheritdoc */
  async onModuleInit(): Promise<void> {
    const connection = this.redis.getBullClient();
    this.queue = new Queue<AutoPracticeJobData>(QUEUE_NAMES.autoPractice, {
      connection,
      prefix: 'bullmq',
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 5000, age: 7 * 24 * 3600 },
        removeOnFail: { count: 10_000 },
      },
    });
    this.worker = new Worker<AutoPracticeJobData>(QUEUE_NAMES.autoPractice, async (job) => this.processJob(job), {
      connection,
      prefix: 'bullmq',
      concurrency: this.concurrency,
    });
    this.worker.on('failed', (job, err) => {
      this.logger.error(`[auto_practice] job failed id=${job?.id} reason=${err.message}`);
    });
    this.logger.log(`[auto_practice] queue started concurrency=${this.concurrency}`);
  }

  /** @inheritdoc */
  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.worker?.close(), this.queue?.close()]);
  }

  /**
   * 入队一场对练.
   *
   * @param data job 数据
   */
  async enqueue(data: AutoPracticeJobData): Promise<void> {
    // V2026-11-09 P1-1 修复: BullMQ jobId 不允许含冒号 (Redis key 分隔符),
    // 原来拼 `${batchId}:${slug}:${mode}:${nanoid(8)}` 直接 500.
    // jobId 只需唯一, 业务字段已在 data 里, 直接用 nanoid.
    await this.queue.add('run-practice', data, {
      jobId: nanoid(),
    });
  }

  /** Worker 回调: 跑一场对练. */
  private async processJob(job: Job<AutoPracticeJobData>): Promise<void> {
    const data = job.data;
    const mode = await this.modeRepo.findOne({ where: { id: data.counselorModeId, enabled: 1 } });
    if (!mode) {
      this.logger.warn(`[auto_practice] 模式不存在或未启用: ${data.counselorModeId}, 跳过`);
      return;
    }
    await this.runner.run({
      characterSlug: data.characterSlug,
      counselorMode: mode,
      maxTurns: data.maxTurns,
      batchId: data.batchId,
    });
  }
}
