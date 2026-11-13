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

// V2026-11-14 治本 (TD-13 · L-1b 仓储端口抽象试点 · analytics 域):
//   依赖从 `@InjectRepository(AnalyticsEvent)` 换成 `@Inject(ANALYTICS_EVENT_REPOSITORY)` ——
//   写库动作收进端口实现 (data/), 本 service 只负责"事件语义 + 静默失败策略".
//   治本:
//     - 静默 catch + warn 语义逐字保留 (analytics 写失败不影响主流程) —— 这是本 service 的
//       核心契约, 端口化不改变它; 端口**不吞异常**, 失败必须冒到 tracker 才能被 warn
//     - 公共方法签名 `record(tenantId, eventType, itemId, userId, metadata)` 逐字不变:
//       跨模块消费方 (knowledge-base) 按 5 个位置参数调用, 改签名 = 越权改别的业务域

import { Inject, Injectable, Logger } from '@nestjs/common';

import { ANALYTICS_EVENT_REPOSITORY, type AnalyticsEventRepository } from '../domain/repositories/analytics-event.repository.js';
import { AnalyticsEventType } from '../entities/analytics-event.entity.js';

@Injectable()
export class AnalyticsEventTrackerService {
  private readonly logger = new Logger(AnalyticsEventTrackerService.name);

  constructor(
    @Inject(ANALYTICS_EVENT_REPOSITORY)
    private readonly events: AnalyticsEventRepository,
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
      await this.events.record({
        tenantId,
        eventType,
        itemId,
        userId,
        metadata,
      });
    } catch (e) {
      // V2026-10-12 治本 (analytics 写失败静默):
      //   跟 audit-log.processor.ts.enqueue() 失败 fallback sync 写同 pattern,
      //   但这里没有 sync fallback (analytics 不是 critical path). 静默 log,
      //   防止 analytics 挂了把主流程 (KB 编辑 / 排期) 拖崩.
      this.logger.warn(`record analytics event failed: type=${eventType} itemId=${itemId} err=${(e as Error).message}`);
    }
  }
}
