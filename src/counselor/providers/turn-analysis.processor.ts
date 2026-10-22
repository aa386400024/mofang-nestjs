// V2026-10-21 治本 (V1.2 VS-B2 — 每轮分析 BullMQ worker):
//   原因: 每轮会谈结束都要跑一次 LLM 分析 (实时轻提示 + 移情/阻抗标记 + 本轮披露抽取),
//     这是**高频异步任务**:
//     - 不能同步跑在 transcript 写入请求里 (LLM 3-8s, 会拖住 HTTP 连接)
//     - 不能用 fire-and-forget (进程重启就丢, 且没法重试)
//     → 走 BullMQ (仓库既有 pattern: supervisor / counselor-supervision 2 个队列)
//   修法: TurnAnalysisProcessor (照 src/agent/supervisor/supervisor.processor.ts 抄):
//     - onModuleInit 建 Queue + Worker, onModuleDestroy 关
//     - prefix 'bullmq' + 统一 defaultJobOptions (attempts 3 / 指数退避 / removeOnComplete / removeOnFail)
//     - Worker concurrency = 2 (不是 1): 每轮分析是**短任务** (low 档, 期望 3-8s),
//       且不同会话之间互不相关, 并发 2 能兼顾吞吐与上游限流
//     - enqueue(): boolean 失败不抛, 由调用方降级
//   **V2026-10-21 修订 (D9)**: 本 worker **不再**因 tier=off 而跳过 ——
//     轻提示只是"要不要展示", 档案抽取与移情标记是**卷宗数据**, 对进阶用户同样有价值.
//     关掉提示就不跑 = 档案永远不填 + 信任度永远不涨 = 整个 M1 信息暴露机制失效.
//     改档位只是不落库/不推送 hint, 分析本身照常.
//   反双胞胎:
//     - 不在 job payload 里塞 transcript 全文: 载荷会越来越大, 且可能与库里不一致;
//       service 自己读库拿**最新** transcript (单一真值源)
//     - 不在 enqueue 时读档位: 入队到执行之间可能隔几秒, 用户可能刚改了偏好 → 执行时读
//   验证:
//     1. tsc 0 错
//     2. 大炮跑一轮会话 → worker 日志出现 [turn_analysis_done]
//     3. 档位设 off → 日志里 hint=n, 但 disclosures/mark 照常产出
//   时间戳: 2026-10-21

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { type Job, Queue, Worker } from 'bullmq';

import { CounselorUiPreferenceService } from './counselor-ui-preference.service';
import { TurnAnalysisService } from './turn-analysis.service';
import { QUEUE_NAMES } from '../../shared/infra/redis/redis.constants';
import { RedisService } from '../../shared/infra/redis/redis.service';
import { CounselorUiPreferenceKey } from '../enums/counselor-ui-preference-key.enum';
import { LiveSupervisionHintTier } from '../enums/live-supervision-hint-tier.enum';

/**
 * 每轮分析 job payload.
 *
 * **只带定位信息, 不带 transcript 内容** —— service 自己读库拿最新数据.
 */
export interface TurnAnalysisJobData {
  /** 会话 id (单次训练 / 长程卷宗皆可) */
  readonly sessionId: string;
  /** 会话归属用户 id */
  readonly userId: string;
  /** 来访者这一轮在 transcript 里的序号 (从 0 开始) */
  readonly turnIndex: number;
}

/**
 * 每轮会谈分析 worker.
 */
@Injectable()
export class TurnAnalysisProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TurnAnalysisProcessor.name);
  private queue!: Queue<TurnAnalysisJobData>;
  private worker!: Worker<TurnAnalysisJobData>;

  constructor(
    private readonly redis: RedisService,
    private readonly turnAnalysis: TurnAnalysisService,
    private readonly uiPreference: CounselorUiPreferenceService,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = this.redis.getBullClient();
    const bullPrefix = 'bullmq';

    this.queue = new Queue<TurnAnalysisJobData>(QUEUE_NAMES.counselorTurnAnalysis, {
      connection,
      prefix: bullPrefix,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 1000, age: 24 * 3600 },
        removeOnFail: { count: 5000 },
      },
    });

    this.worker = new Worker<TurnAnalysisJobData>(QUEUE_NAMES.counselorTurnAnalysis, async (job) => this.processJob(job), {
      connection,
      prefix: bullPrefix,
      // 并发 2: 每轮分析是短任务 (low 档), 不同会话互不相关.
      // 不设 1 (那是 supervisor 队列的做法, 那里单次 LLM 调用 30-120s, 串行才压得住上游).
      concurrency: 2,
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `[turn_analysis_failed] jobId=${job?.id ?? 'n/a'} sessionId=${job?.data?.sessionId ?? 'n/a'} ` + `err=${err.message}`,
      );
    });

    this.logger.log(`TurnAnalysisProcessor started: queue=${QUEUE_NAMES.counselorTurnAnalysis}`);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.worker?.close(), this.queue?.close()]);
  }

  /**
   * 入队 1 个分析任务.
   *
   * @param data job payload
   * @returns true = 入队成功; false = 入队失败 (调用方降级, 本方法不抛)
   */
  async enqueue(data: TurnAnalysisJobData): Promise<boolean> {
    try {
      await this.queue.add('turn-analysis', data, {
        // jobId 幂等: 同一会话同一轮不重复堆 job
        jobId: `ta-${data.sessionId}-${data.turnIndex}`,
      });
      return true;
    } catch (err) {
      this.logger.warn(
        `[enqueue_failed] sessionId=${data.sessionId} turn=${data.turnIndex} ` + `err=${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /**
   * job handler — 读档位 → 调分析器.
   *
   * @param job BullMQ job
   */
  private async processJob(job: Job<TurnAnalysisJobData>): Promise<void> {
    const data = job.data;

    // 档位在**执行时**读 (入队时读会滞后几秒, 用户中途改的偏好要能立刻生效)
    const prefs = await this.uiPreference.getPreferences(data.userId);
    const tier = prefs[CounselorUiPreferenceKey.LIVE_SUPERVISION_HINT_TIER] as LiveSupervisionHintTier;

    await this.turnAnalysis.analyze(data.userId, data.sessionId, data.turnIndex, tier);
  }
}
