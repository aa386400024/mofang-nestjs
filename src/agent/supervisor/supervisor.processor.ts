// V2026-10-09 治本 (Supervisor BullMQ Processor — SPEC §11.2):
//   职责: 异步消费 supervisor 队列, 调 SupervisorService.runReport 生成督导报告
//   触发: voice.service.ts endSession 调 enqueue(input)
//   模式: 跟 src/shared/infra/queue/audit-log.processor.ts 同款 (Queue + Worker + enqueue + processSync 兜底)
//
//   关键设计:
//     - 并发 1: 督导报告生成走 LLM, 单 worker 串行足够 (V0.x 简化, V1.x 水平扩展)
//     - 失败 3 次 + exponential backoff: BullMQ 默认 attempts: 3
//     - enqueue 失败 → processSync 兜底: 跟 audit-log 同策略
//     - runReport 内已 catch 写库异常 → 不让 BullMQ 重试死循环
//
//   反双胞胎:
//     - 不在 Processor 内写 Supervisor 业务逻辑 — 只调 SupervisorService.runReport
//     - 不直接注入 SUPERVISION_REPORT_REPOSITORY — 走 SupervisorService
//     - 不引入 @nestjs/bull — 跟 audit-log 一样用 bullmq 原生 Queue + Worker
//     - 不在 Processor 内做 schema 校验 — 那是 SupervisorService 的事
//
//   如何验证:
//     1. pnpm build 无 type error
//     2. 启动后 log "SupervisorProcessor started: queue=supervisor"
//     3. voice.service.ts endSession 触发 enqueue, Worker 异步消费, log supervisor job done/failed
//     4. enqueue 失败 (Redis down) → 兜底 processSync, 不抛异常
//     5. runReport 写库异常 → SupervisorService 内 catch + log, BullMQ 不重试 (status=parse_error 落库)

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { type Job, Queue, Worker } from 'bullmq';

import { SupervisorService } from './supervisor.service';
import type { RunReportInput } from './supervisor.types';
import { QUEUE_NAMES } from '../../shared/infra/redis/redis.constants';
import { RedisService } from '../../shared/infra/redis/redis.service';

@Injectable()
export class SupervisorProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SupervisorProcessor.name);
  private queue!: Queue<RunReportInput>;
  private worker!: Worker<RunReportInput>;

  constructor(
    private readonly redis: RedisService,
    private readonly supervisor: SupervisorService,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = this.redis.getBullClient();
    // BullMQ key namespace (跟 ioredis 的 keyPrefix 配合, 最终 key: {ioredisPrefix}:{bullPrefix}:{queueName}:...)
    const bullPrefix = 'bullmq';

    this.queue = new Queue<RunReportInput>(QUEUE_NAMES.supervisor, {
      connection,
      prefix: bullPrefix,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 1000, age: 24 * 3600 },
        removeOnFail: { count: 5000 },
      },
    });

    this.worker = new Worker<RunReportInput>(QUEUE_NAMES.supervisor, async (job) => this.processJob(job), {
      connection,
      prefix: bullPrefix,
      // V2026-10-09 治本: 督导报告单 worker 串行足够 (LLM 推理 2-5s/单, V0.x 简化);
      //   V1.x 水平扩展直接加 worker 实例即可, 业务代码不动.
      concurrency: 1,
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(`[worker] job failed: id=${job?.id ?? 'n/a'} session=${job?.data.sessionId ?? 'n/a'} ` + `err=${err.message}`);
    });
    this.worker.on('error', (err) => {
      this.logger.error(`[worker] error: ${err.message}`);
    });

    this.logger.log(`SupervisorProcessor started: queue=${QUEUE_NAMES.supervisor}`);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.worker?.close(), this.queue?.close()]);
  }

  /**
   * 入队督导报告生成 (供 voice.service.ts endSession 调用).
   * 返回 false 表示入队失败, 调用方降级到 processSync 同步执行.
   * V0.x: 失败不抛, 跟 audit-log.enqueue 同策略.
   */
  async enqueue(input: RunReportInput): Promise<boolean> {
    try {
      await this.queue.add('supervisor', input);
      this.logger.log(`[enqueue] supervisor_enqueued session=${input.sessionId}`);
      return true;
    } catch (err) {
      this.logger.warn(
        `[enqueue] failed, fallback to processSync: session=${input.sessionId} ` +
          `err=${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /**
   * Worker 同步处理 (兜底路径, 队列不可用时调用).
   * V0.x: 调 SupervisorService.runReport, 内部已 catch 写库异常, 不抛.
   */
  async processSync(input: RunReportInput): Promise<void> {
    await this.processJobData(input);
  }

  private async processJob(job: Job<RunReportInput>): Promise<void> {
    await this.processJobData(job.data);
  }

  private async processJobData(input: RunReportInput): Promise<void> {
    const row = await this.supervisor.runReport(input);
    this.logger.log(
      `[processJob] session=${input.sessionId} status=${row.status} ` + `score=${row.overallScore} annotations=${row.annotations.length}`,
    );
  }
}
