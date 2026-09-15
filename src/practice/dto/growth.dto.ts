/**
 * V2026-09-14 治本 (Stage C 后端契约): Growth 模块 DTO.
 *
 * 跟前端 lib/features/growth/data/dto/growth_dtos.dart DailyGrowthToolDto /
 * WeeklyOverviewDto / WeeklyMetricDto 严格 1:1 对齐.
 *
 * 字段命名: snake_case (NestJS / Swagger 约定), 前端 dart 字段名 camelCase,
 *   序列化由前端 DTO.fromJson() 自动映射 (camelCase ↔ snake_case 在 JSON 层透明).
 *
 * 设计原则 (大厂 Clean Architecture):
 *   - DTO 跟 entity 解耦: DTO 是 API 契约 (字段 nullable + 默认), entity 是持久化结构
 *   - 所有字段 nullable + 默认值, 后端契约变更时前端不炸
 *   - enum 字段全 String 字面量 + `as const` + 类型别名, 前端 enum.fromKey() 容错映射
 *   - 时间字段全 ISO string (前端 dart DateTime.parse)
 *
 * 反双胞胎:
 *   - 不在 DTO 里塞业务逻辑 (e.g. 派生字段), 派生逻辑放 Service
 *   - 不写 V2.1 计划的新字段 (e.g. recommendation_id), 保持 V1.0 契约
 */

import { ApiProperty } from '@nestjs/swagger';

import { FragmentsGrantDto } from './fragments-grant.dto';
import { FRAGMENT_TYPE_CODES } from '../constants/fragment-type-code';
import { TOOL_COMPLETION_SOURCES, ToolCompletionSource } from '../constants/tool-completion-source';

// ════════════════════════════════════════════════════════════════
// Stage Index 枚举 (跟前端 GrowthStage 5 个 enum value 0-4 1:1)
// ════════════════════════════════════════════════════════════════

export const GROWTH_STAGE_INDICES = [0, 1, 2, 3, 4] as const;
export type GrowthStageIndex = (typeof GROWTH_STAGE_INDICES)[number];

/** Trend enum (跟前端 WeeklyMetricTrend.up/flat/down 1:1). */
export const WEEKLY_METRIC_TRENDS = ['up', 'flat', 'down'] as const;
export type WeeklyMetricTrend = (typeof WEEKLY_METRIC_TRENDS)[number];

// ════════════════════════════════════════════════════════════════
// DailyGrowthToolDto — 15 字段 (V2026-09-14 完整版, 含跨 feature 联动 2 字段)
// ════════════════════════════════════════════════════════════════

export class DailyGrowthToolDto {
  @ApiProperty({ description: '工具唯一 id, snake_case, 跟 practice 端对齐' })
  id!: string;

  @ApiProperty({ description: '视觉锚点 emoji' })
  emoji!: string;

  @ApiProperty({ description: '用户可见中文标题' })
  title!: string;

  @ApiProperty({ description: '1 句话价值描述' })
  subtitle!: string;

  @ApiProperty({ description: '预计耗时, e.g. "3 分钟"' })
  duration!: string;

  @ApiProperty({ description: '短词标签, e.g. "随时可做" / "推荐傍晚" / "选做"' })
  tag!: string;

  @ApiProperty({ description: '0-4 对应 GrowthStage enum', enum: GROWTH_STAGE_INDICES })
  stage_index!: GrowthStageIndex;

  @ApiProperty({ description: '跳转路由 (跟前端 router 白名单一致)', required: false, nullable: true })
  link_route!: string | null;

  @ApiProperty({
    description: '完成 source 严格枚举 (9 source)',
    enum: TOOL_COMPLETION_SOURCES,
  })
  tool_completion_source!: ToolCompletionSource;

  @ApiProperty({ description: '碎片产出映射', type: () => FragmentsGrantDto })
  fragments_grant!: FragmentsGrantDto;

  @ApiProperty({ description: '是否派发 BadgesReconciled' })
  completion_badge_trigger!: boolean;

  @ApiProperty({ description: 'false = 走 else 分支内嵌派发' })
  is_linked!: boolean;

  @ApiProperty({ description: '今日是否已完成 (前端用来灰显)' })
  is_completed_today!: boolean;

  // ─── V2026-09-14 长期方案 Stage C: 跨 feature 联动 flag (透传即可, 后端无联动逻辑) ───
  @ApiProperty({
    description: 'V2026-09-14 长期方案 Stage C: 完成后是否自动建好状态日记草稿',
    default: false,
  })
  auto_create_diary!: boolean;

  @ApiProperty({
    description: 'V2026-09-14 长期方案 Stage C: 完成后是否触发微干预场景',
    required: false,
    nullable: true,
  })
  micro_intervention_scenario_id!: string | null;
}

// ════════════════════════════════════════════════════════════════
// WeeklyOverviewDto — 10 字段
// ════════════════════════════════════════════════════════════════

export class WeeklyMetricDto {
  @ApiProperty({ description: 'e.g. "完成工具数"' })
  label!: string;

  @ApiProperty({ description: 'e.g. "5 次" / "+12%"' })
  value!: string;

  @ApiProperty({ description: '趋势箭头', enum: WEEKLY_METRIC_TRENDS })
  trend!: WeeklyMetricTrend;
}

export class WeeklyOverviewDto {
  @ApiProperty({ description: '周维度 UUID, e.g. "wo_2026-W37"' })
  id!: string;

  @ApiProperty({ description: '用户可见周标签' })
  week_label!: string;

  @ApiProperty({ description: 'LLM 生成 1-2 句总结, 「被看见」语气' })
  ai_summary!: string;

  @ApiProperty({ description: 'AI 驱动小图, 3-4 个', type: () => [WeeklyMetricDto] })
  key_metrics!: WeeklyMetricDto[];

  @ApiProperty({ description: '详情页路由, 默认 "/profile/growth-report"' })
  report_route_path!: string;

  // ─── V2026-09-14 新增: 4 KPI 跨 feature 聚合 ───
  @ApiProperty({ description: 'V2026-09-14 新增: 本周完成工具数 (跨 feature 聚合)' })
  tools_completed_this_week!: number;

  @ApiProperty({ description: 'V2026-09-14 新增: 本周产出碎片总数' })
  fragments_earned_this_week!: number;

  @ApiProperty({ description: 'V2026-09-14 新增: 本周小岛解锁元素数' })
  islands_unlocked_this_week!: number;

  @ApiProperty({ description: 'V2026-09-14 新增: 连续活跃天数' })
  consecutive_active_days!: number;

  @ApiProperty({ description: 'true = AI 生成, false = in-memory fallback' })
  is_personalized!: boolean;
}

// ════════════════════════════════════════════════════════════════
// V2026-09-14 治本: 启动期一致性 assert (跟前端 9 source + 5 fragment code 一致)
// ════════════════════════════════════════════════════════════════

export function assertGrowthDtoContract(): void {
  if (TOOL_COMPLETION_SOURCES.length !== 9) {
    throw new Error(
      `[contract] TOOL_COMPLETION_SOURCES expected 9, got ${String(TOOL_COMPLETION_SOURCES.length)}. ` +
        '跟前端 lib/features/practice/domain/utils/tool_completion_source_mapper.dart 一致.',
    );
  }
  if (FRAGMENT_TYPE_CODES.length !== 5) {
    throw new Error(
      `[contract] FRAGMENT_TYPE_CODES expected 5, got ${String(FRAGMENT_TYPE_CODES.length)}. ` +
        '跟前端 lib/features/inner_world/domain/entities/fragment_type.dart FragmentType enum 一致.',
    );
  }
}
