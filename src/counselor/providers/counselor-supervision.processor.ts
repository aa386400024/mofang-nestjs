// V2026-10-21 治本 (V1.2 VS-A — counselor 督导异步队列 processor):
//   原因: 真接 LLM 后, 1 次督导反馈要读完整 transcript 做临床推理, 官方文档口径下
//     单次可能跑到 30-120s. 放进 HTTP 请求里同步做 = 请求超时 + 上游连接被占.
//     V1.1 §4.2.7 的 training_sessions.status 注释里本来就写了 "已结束 — session 关闭,
//     异步派发 BullMQ 督导生成", 但 V0.5 阶段是 mock 同步返, 一直没落地.
//   修法: 新增 counselor 专属 BullMQ 队列 + processor, 完全照 src/agent/supervisor/
//     supervisor.processor.ts 的既定 pattern 抄:
//     - onModuleInit 建 Queue + Worker, onModuleDestroy 关 (Promise.allSettled)
//     - prefix 'bullmq' + defaultJobOptions { attempts:3, backoff exponential/1000,
//       removeOnComplete {count:1000, age:86400}, removeOnFail {count:5000} } (全项目统一)
//     - enqueue(): boolean 失败不抛, 由调用方决定降级
//     - Worker concurrency = 1 (LLM 串行, 避免打爆上游配额 / 触发 429)
//   反双胞胎:
//     - 不复用 agent 的 'supervisor' 队列: 那个队列的 payload 是 agent 的 RunReportInput,
//       落的是 supervisor 自己的表, 跟 counselor 的 supervision_feedback 不是一回事;
//       两个 processor 抢同一个队列名会导致 job 被错误消费
//     - 不在 HTTP 请求里同步兜底生成: 120s 同步会拖死连接; enqueue 失败直接返失败态给 client
//     - 不引 @nestjs/bull: 项目既定用 bullmq 原生 Queue + Worker (跟 3 个存量 processor 一致)
//   验证:
//     1. tsc 0 错
//     2. 大炮跑 POST /counselor/training-sessions/:id/finish → 返 supervision.status=queued
//     3. worker 日志出现 [counselor_supervision_done] 且 supervision_feedback 表新增 1 行
//   时间戳: 2026-10-21

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { type Job, Queue, Worker } from 'bullmq';

import { SupervisionService } from './supervision.service';
import { QUEUE_NAMES } from '../../shared/infra/redis/redis.constants';
import { RedisService } from '../../shared/infra/redis/redis.service';
import { SessionType } from '../enums/session-type.enum';
import { SupervisionSchoolCode } from '../enums/supervision-school-code.enum';

/**
 * counselor 督导生成 job payload.
 */
export interface CounselorSupervisionJobData {
  readonly sessionId: string;
  readonly sessionType: SessionType;
  readonly schoolCode: SupervisionSchoolCode;
  readonly userId: string;
  readonly tenantId: string;
}

/**
 * counselor 督导异步生成 worker.
 */
@Injectable()
export class CounselorSupervisionProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CounselorSupervisionProcessor.name);
  private queue!: Queue<CounselorSupervisionJobData>;
  private worker!: Worker<CounselorSupervisionJobData>;

  constructor(
    private readonly redis: RedisService,
    private readonly supervision: SupervisionService,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = this.redis.getBullClient();
    const bullPrefix = 'bullmq';

    this.queue = new Queue<CounselorSupervisionJobData>(QUEUE_NAMES.counselorSupervision, {
      connection,
      prefix: bullPrefix,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 1000, age: 24 * 3600 },
        removeOnFail: { count: 5000 },
      },
    });

    this.worker = new Worker<CounselorSupervisionJobData>(QUEUE_NAMES.counselorSupervision, async (job) => this.processJob(job), {
      connection,
      prefix: bullPrefix,
      // LLM 串行: 单次督导可能 30-120s, 并发放开会打爆上游配额触发 429.
      concurrency: 1,
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `[counselor_supervision_failed] jobId=${job?.id ?? 'n/a'} ` + `sessionId=${job?.data?.sessionId ?? 'n/a'} err=${err.message}`,
      );
    });

    this.logger.log(`CounselorSupervisionProcessor started: queue=${QUEUE_NAMES.counselorSupervision}`);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.worker?.close(), this.queue?.close()]);
  }

  /**
   * 入队 1 个督导生成任务.
   *
   * @param data job payload
   * @returns true = 入队成功; false = 入队失败 (调用方需降级提示, 本方法不抛)
   */
  async enqueue(data: CounselorSupervisionJobData): Promise<boolean> {
    try {
      await this.queue.add('counselor-supervision', data, {
        // jobId 幂等: 同一 session 同一流派重复 finish 时不会堆重复 job
        jobId: `cs-${data.sessionId}-${data.sessionType}-${data.schoolCode}`,
      });
      return true;
    } catch (err) {
      this.logger.warn(`[enqueue_failed] sessionId=${data.sessionId} err=${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /**
   * job handler — 调 SupervisionService 真接 LLM 生成 1 流派反馈.
   *
   * 失败直接抛给 BullMQ → 触发指数退避重试 (attempts: 3), 重试用尽进 removeOnFail 队列.
   */
  private async processJob(job: Job<CounselorSupervisionJobData>): Promise<void> {
    const data = job.data;
    await this.supervision.generateFeedback(
      {
        sessionId: data.sessionId,
        sessionType: data.sessionType,
        schoolCode: data.schoolCode,
      },
      data.userId,
    );
    this.logger.log(`[counselor_supervision_done] jobId=${job.id} sessionId=${data.sessionId} ` + `school=${data.schoolCode}`);
  }
}
