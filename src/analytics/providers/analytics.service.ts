// V2026-10-12 (Phase 8.3 — Analytics 聚合 service / SPEC §12.5):
//   4 KPI + 4 trend 实时聚合 SQL, 跟客户端 7.8 AnalyticsOverview 字段严格对应.
//
//   大厂 spec (跟 src/ai-engine/providers/ai-effect.service.ts getHistory 同 pattern):
//     - 单 repository 注入, 4 KPI 4 SQL 一次发, 走 Promise.all 并行
//     - 4 trend 在内存里分桶 (V0.x 数据量小 OK, V1.x 升级 ClickHouse 物化视图)
//
//   治本:
//     - 不引 OLAP 库 (V0.x 简单, 4 个 COUNT query + 内存分桶, 性能 OK)
//     - 不缓存 (V0.x 实时 SQL, V1.x 接 Redis cache)
//     - KPI 3 (avg review SLA) V0.x 占位返 0 (真实计算要 join events by item_id
//       + 时间差聚合, V1.x 增强), 跟 client 7.8 spec 注释一致.

// V2026-11-14 治本 (TD-13 · L-1b 仓储端口抽象试点 · analytics 域):
//   依赖从 `@InjectRepository(AnalyticsEvent)` 换成 `@Inject(ANALYTICS_EVENT_REPOSITORY)` ——
//   service 只依赖仓储端口接口, 不再直接碰 typeorm 的仓储 API 与区间操作符.
//   治本:
//     - KPI 计数与 trend 取数都收成**端口方法** (countByType / findCreatedAtBetween),
//       查询口径 (tenantId 隔离 + eventType + 时间窗) 封在 TypeORM 实现里, 与改前逐字一致
//     - 纯计算 (timeRangeWindow / bucketCount / buildTrend 分桶) 全部留在本 service ——
//       它们是纯函数, 不属于仓储
//     - KPI 3 / KPI 4 仍是 V0.x 占位 0 (口径不动, 本单只做结构重构)

import { Inject, Injectable } from '@nestjs/common';

import { ANALYTICS_EVENT_REPOSITORY, type AnalyticsEventRepository } from '../domain/repositories/analytics-event.repository.js';
import { AnalyticsOverviewDto, TimeRange } from '../dto/analytics.dto.js';
import { AnalyticsEventType } from '../enums/analytics-event-type.enum.js';

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(ANALYTICS_EVENT_REPOSITORY)
    private readonly events: AnalyticsEventRepository,
  ) {}

  /**
   * 4 KPI + 4 trend — 跟 client 7.8 AnalyticsOverview 字段严格对应.
   * tenantId 从 JWT 拿 (TenantContextMiddleware 已注入), 强隔离.
   */
  async getOverview(tenantId: string, range: TimeRange): Promise<AnalyticsOverviewDto> {
    const { start, end } = this.timeRangeWindow(range);

    // AF-595: KPI 1 / KPI 2 与 trend 分桶互不依赖，改 Promise.all 并行；
    // trend 的桶号与计数由仓储在 SQL 里聚合，service 不再拉全量 createdAt.
    const [kbPublished, submitted, publishedTrend] = await Promise.all([
      this.events.countByType(tenantId, AnalyticsEventType.KbPublished, start, end),
      this.events.countByType(tenantId, AnalyticsEventType.DraftSubmitted, start, end),
      this.buildTrend(tenantId, range, AnalyticsEventType.KbPublished, start, end),
    ]);

    // KPI 3: 平均审核 SLA (V0.x 占位返 0, V1.x 真实计算)
    const avgReviewSlaHours = 0;

    // KPI 4: 排期发布占比 (V0.x 占位返 0, V1.x 接 KB_SCHEDULE_FIRED 计数)
    const scheduledPublishRatio = 0;

    // 4 trend — V0.x 用 KB_PUBLISHED 事件作 sparkline 数据源, 各 KPI 各自归一化.
    // V1.x 接 ClickHouse 物化视图时, trend 走预聚合表, 实时 query 退场.
    const draftToPublishRate = submitted > 0 ? kbPublished / submitted : 0;

    return {
      timeRange: range,
      kbPublished,
      kbPublishedTrend: publishedTrend,
      draftToPublishRate,
      draftToPublishRateTrend: publishedTrend.map((v) => (submitted > 0 ? v / submitted : 0)),
      avgReviewSlaHours,
      avgReviewSlaTrend: publishedTrend,
      scheduledPublishRatio,
      scheduledPublishTrend: publishedTrend.map((v) => (kbPublished > 0 ? v / kbPublished : 0)),
    };
  }

  // ─── 内部 ───

  /**
   * 时间窗口 — 跟 client 7.8 TimeRange.sparklinePointCount 对齐:
   *   today  → 24 hours (从 00:00 算起, V0.x 简化)
   *   week   → 7 days
   *   month  → 30 days
   *   year   → 12 months
   */
  private timeRangeWindow(range: TimeRange): { start: Date; end: Date } {
    const end = new Date();
    const start = new Date();
    switch (range) {
      case TimeRange.Today:
        start.setHours(0, 0, 0, 0);
        break;
      case TimeRange.Week:
        start.setDate(start.getDate() - 7);
        break;
      case TimeRange.Month:
        start.setDate(start.getDate() - 30);
        break;
      case TimeRange.Year:
        start.setMonth(start.getMonth() - 12);
        break;
    }
    return { start, end };
  }

  private bucketCount(range: TimeRange): number {
    // V2026-10-12 治本 (Phase 8.3 — sonarjs/no-nested-conditional):
    //   嵌套三元违反 sonarjs 规则, 拆 switch 链. 跟 src/ai-engine 现有
    //   Service 风格 (TypeORM repo.find switch case) 对齐.
    switch (range) {
      case TimeRange.Today:
        return 24;
      case TimeRange.Week:
        return 7;
      case TimeRange.Month:
        return 30;
      case TimeRange.Year:
        return 12;
    }
  }

  /**
   * trend 分桶 —— 桶号与计数由仓储 SQL 聚合，内存只保留 bucketCount 个数.
   */
  private async buildTrend(tenantId: string, range: TimeRange, eventType: AnalyticsEventType, start: Date, end: Date): Promise<number[]> {
    const bucketCount = this.bucketCount(range);
    const buckets = await this.events.countBucketed(tenantId, eventType, start, end, bucketCount);
    // 仓储契约保证定长；这里再裁/补一次，防止实现偏差把前端 sparkline 长度带歪.
    return Array.from({ length: bucketCount }, (_, index) => buckets[index] ?? 0);
  }
}
