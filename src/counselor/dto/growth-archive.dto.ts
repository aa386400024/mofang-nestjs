// V2026-11-06 治本 (WP44 · 成长档案体系 — 成长档案 DTO 契约):
//   职责: 成长档案总览卡片 + 趋势曲线 两个端点的出参形状.
//   边界: 只做形状声明; 零业务逻辑.
//
//   为什么"没有数据"返 null 而不是 0:
//     总分 0 和"一场都没练过"是两件事 —— 用 0 表达"没数据"会让用户看到
//     "我练了 0 分", 那是在说一个不存在的结论 (同 WP43 空场次不给 0 分的口径).
//
//   反双胞胎:
//     - 不复用 counselor-growth.dto (那是成长 Tab 的 4 区块, 职责正交);
//     - 不复用 counselor-profile.dto (那是我的 Tab: 训练偏好 + 会员状态);
//     - 趋势点按**天**聚合 (任务单 §五: 30 天 = 30 个点, 足够看趋势).

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * 三大维度均分 (技术 / BDI 变化 / 伦理).
 */
export interface GrowthArchiveCategoryAverages {
  /** 技术维度均分 (0-100). */
  technical: number | null;
  /** BDI 变化维度均分 (0-100). */
  bdiDelta: number | null;
  /** 伦理维度均分 (0-100). */
  ethics: number | null;
}

/**
 * 成长档案总览卡片.
 */
export interface GrowthArchiveOverviewDto {
  /** 总对练场次 (training_sessions 计). */
  totalSessions: number;
  /** 综合总分均值 (0-100); 没有评估 → null. */
  avgOverallScore: number | null;
  /** 最近一场的综合总分 (0-100); 没有评估 → null. */
  latestScore: number | null;
  /** 历史最高综合总分 (0-100); 没有评估 → null. */
  highestScore: number | null;
  /** 三大维度均分. */
  averageByCategory: GrowthArchiveCategoryAverages;
  /** 累计危机触发次数. */
  crisisCount: number;
}

/**
 * 趋势曲线上的一个点 (一天).
 */
export interface GrowthArchiveTrendPointDto {
  /** 日期 (YYYY-MM-DD). */
  date: string;
  /** 当天综合总分均值 (0-100). */
  overall: number;
  /** 当天技术维度均分 (0-100). */
  technical: number;
  /** 当天 BDI 变化维度均分 (0-100). */
  bdiDelta: number;
  /** 当天伦理维度均分 (0-100). */
  ethics: number;
}

/**
 * 趋势曲线响应.
 */
export interface GrowthArchiveTrendDto {
  /** 趋势点 (按日期升序). */
  points: readonly GrowthArchiveTrendPointDto[];
}

/**
 * 趋势查询入参.
 */
export class GrowthArchiveTrendQueryDto {
  /**
   * 回看天数 (默认 30, 上限 365).
   */
  @ApiPropertyOptional({ description: '回看天数 (默认 30, 上限 365)', default: 30, minimum: 1, maximum: 365 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  @IsOptional()
  days?: number = 30;
}
