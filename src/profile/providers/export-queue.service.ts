import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';

import { resolveBullPrefix } from '../../shared/infra/queue/bullmq-prefix.js';
import { RedisService } from '../../shared/infra/redis/redis.service.js';

/** 导出任务 payload —— 只含定位与格式，不含任何用户数据. */
export interface ExportJobData {
  taskId: string;
  uid: string;
  format: 'json' | 'zip';
}

/** 独立队列名：导出与审计/督导的 payload 与消费逻辑不同，混用会错消费. */
const EXPORT_QUEUE_NAME = 'profile-export';

/**
 * AF-595: 导出任务队列.
 *
 * 请求线程只做「登记任务 + 入队」；采集/序列化/ZIP/写 Redis 全在 Worker 里跑，
 * 避免慢请求长时间占用事件循环。Worker 的处理器由 `ExportService` 注册，
 * 队列服务本身不反向依赖业务服务，避免 DI 环.
 */
@Injectable()
export class ExportQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExportQueueService.name);
  private queue?: Queue<ExportJobData>;
  private worker?: Worker<ExportJobData>;
  private processor?: (data: ExportJobData) => Promise<void>;

  constructor(private readonly redis: RedisService) {}

  /** ExportService 构造时注册处理器. */
  registerProcessor(processor: (data: ExportJobData) => Promise<void>): void {
    this.processor = processor;
  }

  async onModuleInit(): Promise<void> {
    const connection = this.redis.getBullClient();
    const prefix = resolveBullPrefix();

    this.queue = new Queue<ExportJobData>(EXPORT_QUEUE_NAME, {
      connection,
      prefix,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 1000, age: 24 * 3600 },
        removeOnFail: { count: 1000, age: 7 * 24 * 3600 },
      },
    });

    this.worker = new Worker<ExportJobData>(EXPORT_QUEUE_NAME, async (job: Job<ExportJobData>) => this.handle(job), {
      connection,
      prefix,
      concurrency: 2,
    });
    this.worker.on('failed', (job, err) => {
      this.logger.error(`export job failed: id=${job?.id ?? '-'} task=${job?.data.taskId ?? '-'} err=${err.message}`);
    });
    this.worker.on('error', (err) => {
      this.logger.error(`export worker error: ${err.message}`);
    });

    this.logger.log(`ExportQueueService started: queue=${EXPORT_QUEUE_NAME}`);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.worker?.close(), this.queue?.close()]);
  }

  /** 入队；队列未初始化时不丢任务，返回 false 由调用方落 failed. */
  async enqueue(data: ExportJobData): Promise<boolean> {
    if (!this.queue) return false;
    try {
      await this.queue.add('export', data);
      return true;
    } catch (err) {
      this.logger.warn(`export enqueue failed task=${data.taskId}: ${(err as Error).message}`);
      return false;
    }
  }

  private async handle(job: Job<ExportJobData>): Promise<void> {
    if (!this.processor) throw new Error('export processor not registered');
    await this.processor(job.data);
  }
}
