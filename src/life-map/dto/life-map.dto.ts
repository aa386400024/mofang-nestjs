import { ApiProperty } from '@nestjs/swagger';

import type { LifeStage } from '../../shared/types/practice.types';

/**
 * 人生地图完整 DTO 集合 — V3.0 §3 Tab3 评估子模块.
 *
 * 涵盖:
 *   - 入口页面 (overview / timeline)
 *   - 阶段梳理 (LifeStageProgressDto + Save 路由)
 *   - 关键事件 CRUD (KeyEventDto)
 *   - 心理基因盘点 (GenomeDimensionDto)
 *   - 人生剧本推演 (LifeForecastDto + Save)
 *   - 成长轨迹报告 (GrowthReportDto)
 *
 * 字段命名跟心塑前端 DTO 1:1 (camelCase), 严格 + 默认值兜底覆盖各种缺字段场景.
 */

const LIFE_STAGE_KEYS = ['adolescence', 'emerging_adulthood', 'transition', 'midlife'] as const;
export type LifeStageKey = (typeof LIFE_STAGE_KEYS)[number];

const GENOME_DIMENSION_KEYS = ['security', 'self_esteem', 'autonomy', 'resilience', 'self_integration'] as const;
export type GenomeDimensionKey = (typeof GENOME_DIMENSION_KEYS)[number];

const KEY_EVENT_TYPE_KEYS = ['positive', 'negative', 'turning'] as const;
export type KeyEventTypeKey = (typeof KEY_EVENT_TYPE_KEYS)[number];

const FORECAST_SCENARIO_KEYS = ['job_change', 'end_relationship', 'relocate', 'parenthood', 'startup'] as const;
export type ForecastScenarioKey = (typeof FORECAST_SCENARIO_KEYS)[number];

// ═══════════════════════════════════════════════════════════════════════
// 1. 入口页面 (V2.0 已有, 扩展字段)
// ═══════════════════════════════════════════════════════════════════════

export class LifeMapEntryDto {
  @ApiProperty({ description: 'emoji', example: '🧭' })
  emoji!: string;

  @ApiProperty({ description: '强调色 (iris/coral/mint)', example: 'iris' })
  accent!: 'iris' | 'coral' | 'mint';

  @ApiProperty({ description: '入口标题', example: '人生阶段梳理' })
  title!: string;

  @ApiProperty({ description: '入口副标题', example: '青春期 / 初显期 / 转型期 / 中期 任务完成度' })
  subtitle!: string;

  @ApiProperty({ description: '进度文案', example: '已梳理 0 / 4 阶段' })
  tag!: string;

  @ApiProperty({ description: '完成度 (0-1)', example: 0 })
  progress!: number;

  /** V3.0 治本: 新增渐进解锁状态 — 推演引擎 / 报告入口的解锁态. */
  @ApiProperty({ description: '解锁状态', enum: ['unlocked', 'locking', 'locked'], example: 'locked' })
  unlockStatus!: 'unlocked' | 'locking' | 'locked';

  @ApiProperty({ description: '未解锁时的引导文案', required: false, example: '完成阶段梳理后解锁' })
  lockedReason?: string;
}

export class LifeMapOverviewDto {
  @ApiProperty({ type: [LifeMapEntryDto] })
  entries!: LifeMapEntryDto[];

  @ApiProperty({ description: '成长报告是否解锁', example: false })
  reportUnlocked!: boolean;

  @ApiProperty({ description: '人生推演引擎是否解锁', example: false })
  forecastUnlocked!: boolean;
}

export class LifeMapTimelineNode {
  @ApiProperty({ description: '阶段标识', enum: LIFE_STAGE_KEYS })
  stage!: LifeStage;

  @ApiProperty({ description: '年龄范围文案', example: '12-18' })
  ageRange!: string;

  @ApiProperty({ description: '是否已记录', example: false })
  filled!: boolean;

  /** V3.0 治本: 完成度滑值 0-100, 给前端用, 替代单纯布尔. */
  @ApiProperty({ description: '阶段任务完成度 0-100', example: 0 })
  completionPct!: number;
}

export class LifeMapTimelineDto {
  @ApiProperty({ type: [LifeMapTimelineNode] })
  nodes!: LifeMapTimelineNode[];

  @ApiProperty({ description: '已记录节点数', example: 0 })
  filledCount!: number;
}

// ═══════════════════════════════════════════════════════════════════════
// 2. 阶段梳理 (V3.0 真实业务化)
// ═══════════════════════════════════════════════════════════════════════

export class LifeStageProgressDto {
  @ApiProperty({ description: '阶段标识', enum: LIFE_STAGE_KEYS })
  stage!: LifeStage;

  /**
   * V3.0 治本: completionPct 与 Entity 语义对齐 (nullable).
   *   - number: 用户已填写 (0-100)
   *   - null:   用户尚未填写 (前端按 "未填写" 渲染, 区别于 0%)
   *
   * DTO 之前定义为 `number` 与 Entity `number | null` 不一致, 是真实的设计缺陷,
   * 导致 service 必须做 `?? 0` 兜底, 丢失了 "未填写 vs 已填 0" 的语义区分。
   */
  @ApiProperty({
    description: '阶段任务完成度 0-100, null 表示尚未填写',
    example: 0,
    nullable: true,
    type: Number,
  })
  completionPct!: number | null;

  @ApiProperty({ description: '本阶段关键事件数', example: 0 })
  keyEventCount!: number;

  @ApiProperty({ description: '本阶段卡点描述', required: false, example: '找工作焦虑' })
  stuckPoints?: string;

  @ApiProperty({ description: '本阶段收获描述', required: false, example: '学会独立生活' })
  gains?: string;

  @ApiProperty({ description: '更新时间 (ISO8601)' })
  updatedAt!: string;
}

export class SaveStageProgressDto {
  @ApiProperty({ description: '阶段标识', enum: LIFE_STAGE_KEYS })
  stage!: LifeStage;

  @ApiProperty({ description: '阶段任务完成度 0-100', example: 0 })
  completionPct!: number;

  @ApiProperty({ description: '本阶段卡点描述', required: false })
  stuckPoints?: string;

  @ApiProperty({ description: '本阶段收获描述', required: false })
  gains?: string;
}

export class StageProgressListDto {
  @ApiProperty({ type: [LifeStageProgressDto] })
  stages!: LifeStageProgressDto[];

  @ApiProperty({ description: '全量阶段是否都已填写', example: false })
  allStagesFilled!: boolean;
}

// ═══════════════════════════════════════════════════════════════════════
// 3. 关键事件 (V3.0 CRUD 完整化)
// ═══════════════════════════════════════════════════════════════════════

export class KeyEventDto {
  @ApiProperty({ description: '事件 ID (UUID)' })
  id!: string;

  @ApiProperty({ description: '事件标题', example: '高考失利' })
  title!: string;

  @ApiProperty({ description: '事件发生年龄', example: 18 })
  age!: number;

  @ApiProperty({ description: '事件类型', enum: KEY_EVENT_TYPE_KEYS })
  type!: KeyEventTypeKey;

  @ApiProperty({ description: '事件详细描述', required: false })
  description?: string;

  @ApiProperty({ description: '当时的感受', required: false })
  feelings?: string;

  @ApiProperty({ description: '对现在的影响', required: false })
  influence?: string;

  @ApiProperty({ description: '现在的解读', required: false })
  interpretation?: string;

  @ApiProperty({ description: '关联的人生阶段', enum: LIFE_STAGE_KEYS, required: false })
  stage?: LifeStage;

  @ApiProperty({ description: '创建时间 (ISO8601)' })
  createdAt!: string;

  @ApiProperty({ description: '更新时间 (ISO8601)' })
  updatedAt!: string;
}

export class CreateKeyEventDto {
  @ApiProperty({ description: '事件标题', example: '高考失利' })
  title!: string;

  @ApiProperty({ description: '事件发生年龄', example: 18 })
  age!: number;

  @ApiProperty({ description: '事件类型', enum: KEY_EVENT_TYPE_KEYS })
  type!: KeyEventTypeKey;

  @ApiProperty({ description: '事件详细描述', required: false })
  description?: string;

  @ApiProperty({ description: '当时的感受', required: false })
  feelings?: string;

  @ApiProperty({ description: '对现在的影响', required: false })
  influence?: string;

  @ApiProperty({ description: '现在的解读', required: false })
  interpretation?: string;

  @ApiProperty({ description: '关联的人生阶段', enum: LIFE_STAGE_KEYS, required: false })
  stage?: LifeStage;
}

export class UpdateKeyEventDto {
  @ApiProperty({ description: '事件标题', required: false })
  title?: string;

  @ApiProperty({ description: '事件类型', enum: KEY_EVENT_TYPE_KEYS, required: false })
  type?: KeyEventTypeKey;

  @ApiProperty({ description: '事件详细描述', required: false })
  description?: string;

  @ApiProperty({ description: '当时的感受', required: false })
  feelings?: string;

  @ApiProperty({ description: '对现在的影响', required: false })
  influence?: string;

  @ApiProperty({ description: '现在的解读', required: false })
  interpretation?: string;

  @ApiProperty({ description: '关联的人生阶段', enum: LIFE_STAGE_KEYS, required: false })
  stage?: LifeStage;
}

export class KeyEventListDto {
  @ApiProperty({ type: [KeyEventDto] })
  events!: KeyEventDto[];

  @ApiProperty({ description: '事件总数', example: 0 })
  total!: number;
}

// ═══════════════════════════════════════════════════════════════════════
// 4. 心理基因盘点 (5 维度)
// ═══════════════════════════════════════════════════════════════════════

export class GenomeDimensionDto {
  @ApiProperty({ description: '维度标识', enum: GENOME_DIMENSION_KEYS })
  key!: GenomeDimensionKey;

  @ApiProperty({ description: '维度名称', example: '安全感' })
  label!: string;

  @ApiProperty({ description: '维度得分 0-100', example: 0 })
  score!: number;

  @ApiProperty({ description: '维度等级 (gentle/balanced/stable/strong)', example: 'balanced' })
  tier!: 'gentle' | 'balanced' | 'stable' | 'strong';

  @ApiProperty({ description: '来源分析 (童年/家庭/重大事件)', required: false })
  source?: string;

  @ApiProperty({ description: '提升建议', required: false })
  improvement?: string;

  @ApiProperty({ description: '更新时间 (ISO8601)' })
  updatedAt!: string;
}

export class SaveGenomeDimensionDto {
  @ApiProperty({ description: '维度标识', enum: GENOME_DIMENSION_KEYS })
  key!: GenomeDimensionKey;

  @ApiProperty({ description: '维度得分 0-100', example: 50 })
  score!: number;

  @ApiProperty({ description: '来源分析 (童年/家庭/重大事件)', required: false })
  source?: string;

  @ApiProperty({ description: '提升建议', required: false })
  improvement?: string;
}

export class GenomeDimensionListDto {
  @ApiProperty({ type: [GenomeDimensionDto] })
  dimensions!: GenomeDimensionDto[];

  @ApiProperty({ description: '已盘点维度数', example: 0 })
  filledCount!: number;

  @ApiProperty({ description: '是否全量盘点完成', example: false })
  allFilled!: boolean;
}

// ═══════════════════════════════════════════════════════════════════════
// 5. 人生剧本推演 (V3.0 渐进解锁)
// ═══════════════════════════════════════════════════════════════════════

export class ForecastInputDto {
  @ApiProperty({ description: '场景标识', enum: FORECAST_SCENARIO_KEYS })
  scenario!: ForecastScenarioKey;

  @ApiProperty({ description: '选择内容描述', example: '考虑跳槽到大厂' })
  description!: string;

  @ApiProperty({ description: '最担心的 3 个点', type: [String] })
  worries!: string[];

  @ApiProperty({ description: '最期待的 3 个点', type: [String] })
  expectations!: string[];
}

export class ForecastDimensionDto {
  @ApiProperty({ description: '维度名', example: '安全感冲击' })
  dimension!: string;

  @ApiProperty({ description: '影响等级 (low/medium/high)', example: 'medium' })
  level!: 'low' | 'medium' | 'high';

  @ApiProperty({ description: '描述', example: '陌生团队初期安全感会下降' })
  description!: string;
}

export class LifeForecastDto {
  @ApiProperty({ description: '推演 ID' })
  id!: string;

  @ApiProperty({ description: '场景标识', enum: FORECAST_SCENARIO_KEYS })
  scenario!: ForecastScenarioKey;

  @ApiProperty({ description: '选择内容描述' })
  description!: string;

  @ApiProperty({ description: '风险维度', type: [ForecastDimensionDto] })
  risks!: ForecastDimensionDto[];

  @ApiProperty({ description: '成长机会维度', type: [ForecastDimensionDto] })
  opportunities!: ForecastDimensionDto[];

  @ApiProperty({ description: '前置准备建议', type: [String] })
  preparations!: string[];

  @ApiProperty({ description: '创建时间 (ISO8601)' })
  createdAt!: string;
}

export class ForecastListDto {
  @ApiProperty({ type: [LifeForecastDto] })
  forecasts!: LifeForecastDto[];

  @ApiProperty({ description: '推演总数', example: 0 })
  total!: number;

  @ApiProperty({ description: '是否满足解锁条件 (阶段全填 + 事件 >= 3)', example: false })
  unlockStatus!: 'unlocked' | 'locking' | 'locked';

  @ApiProperty({ description: '解锁条件文案', required: false })
  lockedReason?: string;
}

// ═══════════════════════════════════════════════════════════════════════
// 6. 成长轨迹综合报告
// ═══════════════════════════════════════════════════════════════════════

export class GrowthReportDto {
  @ApiProperty({ description: '报告 ID' })
  id!: string;

  @ApiProperty({ description: '各阶段任务完成度曲线', type: [Number] })
  stageCompletionCurve!: number[];

  @ApiProperty({ type: [GenomeDimensionDto] })
  genomeDimensions!: GenomeDimensionDto[];

  @ApiProperty({ description: '识别出的核心卡点', type: [String] })
  coreStuckPoints!: string[];

  @ApiProperty({ description: '分阶段行动建议', type: [String] })
  stageActionPlan!: string[];

  @ApiProperty({ description: '推荐训练计划', type: [String] })
  recommendedTools!: string[];

  @ApiProperty({ description: '综合解读', example: '你当前处于转型期...' })
  summary!: string;

  @ApiProperty({ description: '生成时间 (ISO8601)' })
  generatedAt!: string;

  @ApiProperty({ description: '是否可生成报告', example: false })
  canGenerate!: boolean;

  @ApiProperty({ description: '解锁条件文案', required: false })
  blockedReason?: string;
}
