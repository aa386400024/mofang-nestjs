import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Worker, type Job, Queue } from 'bullmq';
import { Repository } from 'typeorm';

import { AuditEvent, AuditLog } from '../../../user/entities/audit-log.entity';
import { RedisService } from '../redis';
import { QUEUE_NAMES } from '../redis/redis.constants';

/**
 * 审计日志 Job 数据结构 (BullMQ payload).
 */
export interface AuditLogJobData {
  userId: string | null;
  event: AuditEvent;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
  isSuccess?: boolean;
}

/**
 * Audit log queue — 大厂异步审计 (V2 核心).
 *
 * 设计:
 *   - 业务层只 enqueue (微秒级返回), 不阻塞主流程
 *   - Worker 异步消费 (可水平扩展 worker 实例)
 *   - 失败重试 (exponential backoff)
 *   - 失败兜底: enqueue 失败时业务层自动降级到 sync DB 写
 *
 * 性能:
 *   - V1 (sync): 每次登录/注册多一次 DB round-trip (~5-20ms)
 *   - V2 (async): 入队 <1ms, 消费在后台批量写 (可聚合 batch 优化)
 *
 * 与 V1 AuditLogService 对比:
 *   - V1: log() 直接 await this.repo.save() → 阻塞主流程
 *   - V2: log() 入队 + 兜底 sync, 主流程 0 阻塞
 */
@Injectable()
export class AuditLogProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditLogProcessor.name);
  private queue!: Queue<AuditLogJobData>;
  private worker!: Worker<AuditLogJobData>;

  constructor(
    private readonly redis: RedisService,
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  // ========================================================================
  // Lifecycle
  // ========================================================================

  async onModuleInit(): Promise<void> {
    const connection = this.redis.getBullClient();
    // BullMQ key namespace (跟 ioredis 的 keyPrefix 配合, 最终 key: {ioredisPrefix}:{bullPrefix}:{queueName}:...)
    const bullPrefix = 'bullmq';

    this.queue = new Queue<AuditLogJobData>(QUEUE_NAMES.auditLog, {
      connection,
      prefix: bullPrefix,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 1000, age: 24 * 3600 },
        removeOnFail: { count: 5000 },
      },
    });

    this.worker = new Worker<AuditLogJobData>(QUEUE_NAMES.auditLog, async (job) => this.processJob(job), {
      connection,
      prefix: bullPrefix,
      concurrency: 5,
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(`audit job failed: id=${job?.id}, err=${err.message}`);
    });
    this.worker.on('error', (err) => {
      this.logger.error(`audit worker error: ${err.message}`);
    });

    this.logger.log(`AuditLogProcessor started: queue=${QUEUE_NAMES.auditLog}`);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.worker?.close(), this.queue?.close()]);
  }

  // ========================================================================
  // Public API
  // ========================================================================

  /**
   * 入队审计日志 (供 AuditLogService 调用).
   * 返回 false 表示入队失败, 调用方降级到 sync 写.
   */
  async enqueue(data: AuditLogJobData): Promise<boolean> {
    try {
      await this.queue.add('audit', data, {
        // 高优先级事件 (登录失败) 插队
        priority: this.priorityOf(data.event),
      });
      return true;
    } catch (err) {
      this.logger.warn(`enqueue failed, fallback to sync: ${(<Error>err).message}`);
      return false;
    }
  }

  /**
   * Worker 同步处理 (兜底路径, 队列不可用时调用).
   */
  async processSync(data: AuditLogJobData): Promise<void> {
    await this.processJobData(data);
  }

  // ========================================================================
  // Worker (consumer)
  // ========================================================================

  private async processJob(job: Job<AuditLogJobData>): Promise<void> {
    await this.processJobData(job.data);
  }

  private async processJobData(data: AuditLogJobData): Promise<void> {
    try {
      const entry = this.repo.create({
        userId: data.userId,
        event: data.event,
        ipAddress: data.ipAddress ?? null,
        userAgent: data.userAgent ?? null,
        metadata: data.metadata ? JSON.stringify(data.metadata) : null,
        isSuccess: data.isSuccess ?? true,
      });
      await this.repo.save(entry);
    } catch (err) {
      this.logger.error(`audit save failed: event=${data.event}, userId=${data.userId}, err=${(<Error>err).message}`);
      throw err; // 让 BullMQ 重试
    }
  }

  /**
   * 事件优先级 (越小越优先).
   * 安全事件 (登录失败) 优先持久化, 便于风控实时分析.
   */
  private priorityOf(event: AuditEvent): number {
    if (event === AuditEvent.UserLoginFailed) return 1;
    if (event === AuditEvent.UserStateChanged) return 2;
    return 5;
  }
}
