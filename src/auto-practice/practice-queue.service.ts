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
import type { Repository } from 'typeorm';

import { CounselorMode } from './entities/counselor-mode.entity.js';
import { PracticeBatchHealthService } from './practice-batch-health.service.js';
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

/**
 * Worker 并发数默认值.
 *
 * V2026-11-09 治本 (Phase2.5 WP-H · 改动 4): 3 → 2.
 *
 * 为什么降: 一场对练 ~15~35 轮 × 两侧各 1 次 LLM ≈ 30~70 次调用;
 * 并发 3 = 同时 3 场 ≈ 100+ 次在途调用, 足以把上游打到限流 ——
 * 而上游一限流, 渲染链就进冷却, 整场对练改吐兜底句 (见 WP-H 任务单 §二).
 * 并发是**唯一**一个"少花钱少出错"的旋钮, 优先降它.
 */
const DEFAULT_CONCURRENCY = 2;

/** 并发下限 (1 = 串行跑批; 金丝雀验证用这个档). */
const MIN_CONCURRENCY = 1;

/** 并发上限 (防止误配把上游打满 —— 上限越界比不配更糟). */
const MAX_CONCURRENCY = 5;

/**
 * 解析自动对练 Worker 并发数 (纯函数; 便于单测).
 *
 * 口径:
 *   · 未配置 / 空 / 非数字 / ≤0 → 回落缺省 (2);
 *   · 小于下限 → 夹到下限 (1);
 *   · 大于上限 → 夹到上限 (5);
 *   · 其余 → 取整后采用.
 *
 * 为什么不照用 env 原值: 并发直接决定打上游的力度, 填成 99 比填 2 危险得多;
 * 但也不能静默改 —— 越界时由调用方告警 (让人知道自己填的值没生效).
 *
 * @param raw env 原值
 * @returns 实际生效的并发数
 */
export function resolveAutoPracticeConcurrency(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_CONCURRENCY;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return DEFAULT_CONCURRENCY;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CONCURRENCY;
  const floored = Math.floor(parsed);
  if (floored < MIN_CONCURRENCY) return MIN_CONCURRENCY;
  return Math.min(floored, MAX_CONCURRENCY);
}

/**
 * 这个 env 值是否被**夹**过 (夹过 = 填的值没生效, 该告警).
 *
 * @param raw env 原值
 * @param resolved 实际生效值
 * @returns 是否被夹
 */
export function isAutoPracticeConcurrencyClamped(raw: string | undefined, resolved: number): boolean {
  if (raw === undefined) return false;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return false;
  return Math.floor(parsed) !== resolved;
}

@Injectable()
export class PracticeQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PracticeQueueService');
  private queue!: Queue<AutoPracticeJobData>;
  private worker!: Worker<AutoPracticeJobData>;
  private readonly concurrency: number;

  constructor(
    private readonly redis: RedisService,
    private readonly runner: PracticeRunnerService,
    private readonly batchHealth: PracticeBatchHealthService,
    @InjectRepository(CounselorMode) private readonly modeRepo: Repository<CounselorMode>,
  ) {
    const raw = process.env.AUTO_PRACTICE_WORKER_CONCURRENCY;
    this.concurrency = resolveAutoPracticeConcurrency(raw);
    if (isAutoPracticeConcurrencyClamped(raw, this.concurrency)) {
      this.logger.warn(`[auto_practice] 并发数不在 1~5 范围内, 已夹到 ${this.concurrency}: requested=${(raw ?? '').trim()}`);
    }
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
    // V2026-11-10 治本 (WP-H 改动 9 + 新增 12): 批次收尾时算有效性门禁 + 写逐字稿索引.
    //   只在"批次全部跑完"时才落库 (最后一场跑完的那次会命中) —— 中途不落, 免得刷 100 次.
    //   失败只 warn: 门禁与索引是可观测性设施, 不该让 job 失败重跑 (重跑 = 再烧一遍钱).
    try {
      const result = await this.batchHealth.refreshBatch(data.batchId, { onlyWhenFinished: true });
      if (result.allSessionsFinished && !result.health.valid) {
        this.logger.warn(`[auto_practice] 批次未通过有效性门禁 batch=${data.batchId} flags=${result.health.flags.join(',')}`);
      }
    } catch (error) {
      this.logger.warn(`[auto_practice] 批次健康刷新失败 batch=${data.batchId}: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }
}
