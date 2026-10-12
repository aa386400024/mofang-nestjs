// V2026-10-12 (Phase 8.3 — Analytics 事件追踪 service / SPEC §12.5):
//   业务事件追踪 hook — 跨模块 (knowledge-base 5 workflow + 2 schedule action
//   + ScheduledPublishProcessor) 调 record() 写 analytics_events.
//
//   大厂 spec (跟 src/shared/infra/queue/audit-log.processor.ts fallback 思路):
//     - 静默 catch + log (analytics 写失败不影响主流程, 跟 audit 写失败一致)
//     - 不 throw, 避免循环依赖故障 (analytics 挂了不应该把 KB 编辑阻塞)
//
//   治本:
//     - 不引 EventEmitter 库 (NestJS @nestjs/event-emitter) — 跨模块 DI 更直接,
//       V0.x 不引新 dep.
//     - 不在主流程 async/await, fire-and-forget pattern (analytics 异步写).

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AnalyticsEvent, AnalyticsEventType } from '../entities/analytics-event.entity';

@Injectable()
export class AnalyticsEventTrackerService {
  private readonly logger = new Logger(AnalyticsEventTrackerService.name);

  constructor(
    @InjectRepository(AnalyticsEvent)
    private readonly events: Repository<AnalyticsEvent>,
  ) {}

  /**
   * 记录业务事件 — 静默失败 (analytics 写失败不影响主流程).
   * V0.x fire-and-forget, V1.x 接 outbox 模式 + 异步 worker.
   */
  async record(
    tenantId: string,
    eventType: AnalyticsEventType,
    itemId: string | null,
    userId: string | null,
    metadata: Record<string, unknown> | null = null,
  ): Promise<void> {
    try {
      await this.events.save(
        this.events.create({
          tenantId,
          eventType,
          itemId,
          userId,
          metadata,
        }),
      );
    } catch (e) {
      // V2026-10-12 治本 (analytics 写失败静默):
      //   跟 audit-log.processor.ts.enqueue() 失败 fallback sync 写同 pattern,
      //   但这里没有 sync fallback (analytics 不是 critical path). 静默 log,
      //   防止 analytics 挂了把主流程 (KB 编辑 / 排期) 拖崩.
      this.logger.warn(`record analytics event failed: type=${eventType} itemId=${itemId} err=${(e as Error).message}`);
    }
  }
}
