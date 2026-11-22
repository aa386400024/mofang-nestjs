// V2026-10-12 (Phase 8.3 — Analytics DTO / SPEC §12.5):
//   4 KPI + 4 trend 数组 + TimeRange 枚举, 跟客户端 7.8 AnalyticsOverview
//   字段严格对应. client 7.8 AnalyticsOverview.fromJson 字段命名一致.

import { ApiProperty } from '@nestjs/swagger';

/**
 * 时间范围 — 决策 A: 4 档 today / week / month / year.
 * 跟 client 7.8 TimeRange.wireName 严格对应.
 */
export enum TimeRange {
  Today = 'today',
  Week = 'week',
  Month = 'month',
  Year = 'year',
}

/**
 * Analytics overview 响应 — 4 KPI + 4 trend 数组, 跟 client 7.8 AnalyticsOverview
 * entity 字段严格对应.
 */
export class AnalyticsOverviewDto {
  @ApiProperty({ description: '查询时间范围 (回传, 跟请求一致)', enum: TimeRange })
  timeRange!: TimeRange;

  // ─── KPI 1: KB 发布量 ───
  @ApiProperty({ description: 'KPI 1 — KB 发布量 (published 状态总数)' })
  kbPublished!: number;

  @ApiProperty({ description: 'KPI 1 sparkline 数据' })
  kbPublishedTrend!: number[];

  // ─── KPI 2: 草稿→发布转化率 ───
  @ApiProperty({ description: 'KPI 2 — 草稿→发布转化率 (0-1)' })
  draftToPublishRate!: number;

  @ApiProperty({ description: 'KPI 2 sparkline 数据' })
  draftToPublishRateTrend!: number[];

  // ─── KPI 3: 平均审核 SLA ───
  @ApiProperty({ description: 'KPI 3 — 平均审核 SLA (小时)' })
  avgReviewSlaHours!: number;

  @ApiProperty({ description: 'KPI 3 sparkline 数据' })
  avgReviewSlaTrend!: number[];

  // ─── KPI 4: 排期发布占比 ───
  @ApiProperty({ description: 'KPI 4 — 排期发布占比 (0-1, published 中 scheduledPublishAt 非空比例)' })
  scheduledPublishRatio!: number;

  @ApiProperty({ description: 'KPI 4 sparkline 数据' })
  scheduledPublishTrend!: number[];
}
