// V2026-09-04 治本 (V6.0 §3.2):
//   AI 推荐 DTO — 6 种类型 + 4 排序阶段.
//   边界: 不写「推荐创建 DTO」 — 客户端无写权, 全由服务端跑推荐引擎.

import { ApiProperty } from '@nestjs/swagger';

import { AIRecommendKind, AIRecommendPhase } from '../enums/ai-recommend.enums';

/**
 * 推荐条目 — 单条.
 */
export class AIRecommendItemDto {
  @ApiProperty({ description: '推荐目标 id', example: 'breathing_478' })
  targetId!: string;

  @ApiProperty({ enum: AIRecommendKind, description: '推荐目标类型 (工具/科普/课程/路径/游戏化/商业化)' })
  kind!: AIRecommendKind;

  @ApiProperty({ description: '推荐标题 (端侧直接展示)', example: '478 呼吸法 · 缓解急性焦虑' })
  title!: string;

  @ApiProperty({ description: '推荐说明 (一段话解释为什么)', example: '近 7 天 3 次出现「社交焦虑」自评, 系统推荐' })
  rationale!: string;

  @ApiProperty({ description: '置信度 0..1', example: 0.87 })
  confidence!: number;

  @ApiProperty({ description: '冷启动优先 (V2.0 第 7 天前)', example: false })
  isColdStart!: boolean;
}

/**
 * 推荐列表响应.
 */
export class AIRecommendListDto {
  @ApiProperty({ type: [AIRecommendItemDto] })
  items!: AIRecommendItemDto[];

  @ApiProperty({ enum: AIRecommendPhase, description: '推荐阶段 (召回/粗排/精排/重排)' })
  phase!: AIRecommendPhase;

  @ApiProperty({ description: '服务端拉取时间戳 (ms)' })
  fetchedAtMs!: number;
}
