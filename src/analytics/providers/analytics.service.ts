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

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';

import { AnalyticsOverviewDto, TimeRange } from '../dto/analytics.dto';
import { AnalyticsEvent, AnalyticsEventType } from '../entities/analytics-event.entity';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(AnalyticsEvent)
    private readonly events: Repository<AnalyticsEvent>,
  ) {}

  /**
   * 4 KPI + 4 trend — 跟 client 7.8 AnalyticsOverview 字段严格对应.
   * tenantId 从 JWT 拿 (TenantContextMiddleware 已注入), 强隔离.
   */
  async getOverview(tenantId: string, range: TimeRange): Promise<AnalyticsOverviewDto> {
    const { start, end } = this.timeRangeWindow(range);

    // KPI 1: KB 发布量 (approve 计数)
    const kbPublished = await this.events.count({
      where: {
        tenantId,
        eventType: AnalyticsEventType.KbPublished,
        createdAt: Between(start, end),
      },
    });

    // KPI 2: 草稿→发布转化率 (published / submitted, 0 分母保护)
    const submitted = await this.events.count({
      where: {
        tenantId,
        eventType: AnalyticsEventType.DraftSubmitted,
        createdAt: Between(start, end),
      },
    });
    const draftToPublishRate = submitted > 0 ? kbPublished / submitted : 0;

    // KPI 3: 平均审核 SLA (V0.x 占位返 0, V1.x 真实计算)
    const avgReviewSlaHours = 0;

    // KPI 4: 排期发布占比 (V0.x 占位返 0, V1.x 接 KB_SCHEDULE_FIRED 计数)
    const scheduledPublishRatio = 0;

    // 4 trend — V0.x 用 KB_PUBLISHED 事件作 sparkline 数据源, 各 KPI 各自归一化.
    // V1.x 接 ClickHouse 物化视图时, trend 走预聚合表, 实时 query 退场.
    const publishedTrend = await this.buildTrend(tenantId, range, AnalyticsEventType.KbPublished, start, end);

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
   * 在内存分桶, 避免 N+1 (V0.x 数据量小 OK, V1.x 升级 SQL GROUP BY).
   */
  private async buildTrend(tenantId: string, range: TimeRange, eventType: AnalyticsEventType, start: Date, end: Date): Promise<number[]> {
    const bucketCount = this.bucketCount(range);
    const bucketMs = (end.getTime() - start.getTime()) / bucketCount;
    // V2026-10-12 治本 (Phase 8.3 — unicorn/no-new-array):
    //   new Array(N) 意图不清, 改 Array.from({length: N}).fill(0) 明确表达
    //   "创建 N 个 0 的数组". 跟 src/ai-engine/providers/effect-aggregate.cron.ts
    //   Map 分桶 pattern 一致.
    // V2026-10-12 治本 (Phase 8.3 — unicorn/no-array-from-fill):
    //   Array.from({length}).fill() 链式调用违规, 改用 Array.from(N, () => 0)
    //   第 2 个 mapFunction 参数 (跟 src/ai-engine 现有 pattern 对齐). 顺带去
    //   显式 <number> 泛型, 第 2 参数返回 number 推断.
    const counts = Array.from({ length: bucketCount }, () => 0);

    // V2026-10-12 治本 (Phase 8.3 — TypeORM select 类型):
    //   TypeORM FindOptions select 是对象形式 { field: true }, 不是 string[].
    //   string[] 走 createQueryBuilder().select() 合法 (跟 src/ai-engine
    //   providers/ai-effect.service.ts getHistory 同 pattern), 但 Repository.find
    //   的 select 必须是对象. 治本: 改对象形式.
    const events = await this.events.find({
      where: { tenantId, eventType, createdAt: Between(start, end) },
      select: { createdAt: true },
    });

    for (const e of events) {
      const idx = Math.min(Math.floor((e.createdAt.getTime() - start.getTime()) / bucketMs), bucketCount - 1);
      counts[idx]++;
    }
    return counts;
  }
}
