// V2026-10-15 治本 (V3.4 — ability.dto.ts, 4 DTO 1:1 wire):
//   原因: counselor-mode-v1.0 §6.3 拍板 7 维度 28 子指标 + user 聚合 score, V0.3
//     §13 baseline 0 子指标 DTO, 1:1 wire 0 破坏. 4 DTO 1:1 对应 xin_su_app
//     AbilityDimension + AbilityScore entity 字段.
//
//   修法:
//     - 4 DTO 跟 V0.5 已有 counselor-* DTO 风格一致 (ApiProperty + class-validator)
//     - AbilityDimensionListItemDto: 子指标 list (无 description, 减少 list 流量)
//     - AbilityDimensionDetailDto: 子指标详情 (含 description, UI 详情用)
//     - UpsertAbilityScoreDto: 手动 upsert score 输入 (userId × dimensionId × score + source + evidence)
//     - AbilityProfileDto: user 聚合 (28 子指标 score + 7 维度分布, UI 雷达图用)
//     - 跟 AbilityParentDimension 7 enum 严格 1:1 wire
//
//   反双胞胎:
//     - 不在 DTO 暴露 tenantId: V0.x 风格 1:1 wire 跟 entity 1:1, tenantId 走 JWT
//     - 不在 DTO 加 vector 字段: V0.x 阶段不接 RAG, V2.x 升级再切
//     - 不用 snake_case wire (用 camelCase 跟 V0.x DTO 风格一致)
//
//   验证:
//     1. tsc 0 错 (4 DTO 字段 type 严格)
//     2. 跟 xin_su_app AbilityDimension + AbilityScore entity 字段 1:1 wire
//
//   时间戳: 2026-10-15

import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

import { AbilityParentDimension } from '../enums/ability-parent-dimension.enum';

// ════════════════════════════════════════════════════════════════════════════
// 单个子指标 list 项 (无 description, 减少 list 流量)
// ════════════════════════════════════════════════════════════════════════════

export class AbilityDimensionListItemDto {
  @ApiProperty({ description: '子指标 id (UUID)' })
  id!: string;

  @ApiProperty({ description: '7 维度 enum (跟 AbilityParentDimension 1:1)', enum: AbilityParentDimension })
  parentDimension!: AbilityParentDimension;

  @ApiProperty({ description: '子指标 code (DB UNIQUE)' })
  subIndicatorCode!: string;

  @ApiProperty({ description: '子指标中文名 (UI 雷达图标签)' })
  subIndicatorName!: string;

  @ApiProperty({ description: 'UI 雷达图 28 标签排序 (1-28)' })
  displayOrder!: number;

  @ApiProperty({ description: '是否启用 (V0.x 阶段 28 子指标全 active)' })
  isActive!: boolean;
}

// ════════════════════════════════════════════════════════════════════════════
// 子指标详情 (含 description, UI 详情用)
// ════════════════════════════════════════════════════════════════════════════

export class AbilityDimensionDetailDto extends AbilityDimensionListItemDto {
  @ApiProperty({ description: '子指标定义说明 (UI 详情 / 督导报告用)', nullable: true })
  description!: string | null;
}

// ════════════════════════════════════════════════════════════════════════════
// 手动 upsert score 输入 (V0.5 阶段不接 W3-4 supervision.service 自动累加)
// ════════════════════════════════════════════════════════════════════════════

export class UpsertAbilityScoreDto {
  @ApiProperty({ description: '子指标 id (UUID, dimensionId 1:1 wire)' })
  @IsString()
  @MinLength(36)
  @MaxLength(36)
  dimensionId!: string;

  @ApiProperty({ description: '子指标分数 0-100 (V0.x AIProfileSnapshot 0-1 改为 0-100)', minimum: 0, maximum: 100 })
  @IsInt()
  @Min(0)
  @Max(100)
  score!: number;

  @ApiProperty({
    description: '来源 (跟 V0.x AIProfileSnapshot.source 1:1: cloud / local / user_override)',
    enum: ['cloud', 'local', 'user_override'],
    default: 'cloud',
  })
  @IsOptional()
  @IsIn(['cloud', 'local', 'user_override'])
  source?: string;

  @ApiProperty({
    description: '来源 session_id 列表 (V1.x 接 W3-4 supervision_feedback 自动累加时填)',
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenceSessionIds?: string[];
}

// ════════════════════════════════════════════════════════════════════════════
// user 聚合 profile (28 子指标 score + 7 维度分布, UI 雷达图用)
// ════════════════════════════════════════════════════════════════════════════

export class AbilityScoreItemDto {
  @ApiProperty({ description: '子指标 id (UUID)' })
  dimensionId!: string;

  @ApiProperty({ description: '子指标 code' })
  subIndicatorCode!: string;

  @ApiProperty({ description: '子指标中文名 (UI 雷达图标签)' })
  subIndicatorName!: string;

  @ApiProperty({ description: '7 维度 enum', enum: AbilityParentDimension })
  parentDimension!: AbilityParentDimension;

  @ApiProperty({ description: '子指标分数 0-100 (0 表示暂无数据, 跟 V0.x 1:1 风格)', example: 75 })
  score!: number;

  @ApiProperty({ description: '来源 (跟 V0.x AIProfileSnapshot.source 1:1)' })
  source!: string;

  @ApiProperty({ description: 'UI 雷达图 28 标签排序' })
  displayOrder!: number;
}

export class AbilityDimensionAvgDto {
  @ApiProperty({ description: '7 维度 enum', enum: AbilityParentDimension })
  parentDimension!: AbilityParentDimension;

  @ApiProperty({ description: '该维度所有子指标平均分 (0-100, UI 雷达图 7 主轴)', example: 68 })
  averageScore!: number;

  @ApiProperty({ description: '该维度子指标数量' })
  subIndicatorCount!: number;
}

export class AbilityProfileDto {
  @ApiProperty({ description: 'userId (跟 entity 1:1)' })
  userId!: string;

  @ApiProperty({ description: '28 子指标 score 列表', type: [AbilityScoreItemDto] })
  scores!: AbilityScoreItemDto[];

  @ApiProperty({ description: '7 维度平均分 (UI 雷达图 7 主轴)', type: [AbilityDimensionAvgDto] })
  dimensionAverages!: AbilityDimensionAvgDto[];

  @ApiProperty({ description: '总体平均分 (28 子指标加权平均, 0-100)', example: 65 })
  overallAverage!: number;
}
