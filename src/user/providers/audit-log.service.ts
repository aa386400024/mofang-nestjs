import { Injectable, Logger } from '@nestjs/common';

import { AuditLogProcessor } from '../../shared/infra/queue';
import { MetricsService } from '../../shared/infra/metrics';
import { AuditEvent } from '../entities/audit-log.entity';

/**
 * Audit log service — 用户鉴权事件日志 (大厂合规要求).
 *
 * V2 实现: 异步写 (BullMQ 队列), 兜底同步写.
 *
 * 流程:
 *   1. log() 入队 AuditLogProcessor.enqueue (微秒级返回)
 *   2. AuditLogProcessor Worker 异步消费, 写 DB
 *   3. 入队失败 (Redis 不可用 / 队列满) → 兜底走 processSync
 *   4. 兜底也失败 → 仅 log error, 不 throw (审计失败不阻塞主流程)
 *
 * 性能:
 *   - V1 同步写: 每次鉴权操作多 5-20ms DB round-trip
 *   - V2 异步写: 入队 <1ms, DB 写在后台批量执行
 *
 * 与 V1 对比:
 *   - V1 直接 await this.repo.save() (阻塞)
 *   - V2 this.queue.add() (异步) + 兜底 (sync)
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    private readonly processor: AuditLogProcessor,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * 记录事件.
   * @returns 不 throw, 业务层不依赖返回值
   */
  async log(input: {
    userId: string | null;
    event: AuditEvent;
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: Record<string, unknown>;
    isSuccess?: boolean;
  }): Promise<void> {
    const payload = {
      userId: input.userId,
      event: input.event,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      metadata: input.metadata,
      isSuccess: input.isSuccess ?? true,
    };

    // 1. 优先入队 (async, <1ms)
    const ok = await this.processor.enqueue(payload);
    if (ok) {
      this.metrics.incAuditLogEnqueued(input.event);
      return;
    }

    // 2. 兜底: 同步写 DB
    try {
      await this.processor.processSync(payload);
      this.metrics.incAuditLogFailed(input.event, 'enqueue');
    } catch (err) {
      // 3. 兜底也失败: 仅 log, 不 throw
      this.logger.error(
        `Audit log fully failed: event=${input.event}, userId=${input.userId}`,
        err instanceof Error ? err.stack : String(err),
      );
      this.metrics.incAuditLogFailed(input.event, 'process');
    }
  }
}