// V2026-09-04 治本 (V6.0 §3.4):
//   AI 干预效果 DTO — 短 / 中 / 长 3 维.
//   反双胞胎: 不写 monthly/weekly 写 DTO (cron 聚合, 客户端不能写).

import { ApiProperty } from '@nestjs/swagger';

import { AIEffectHorizon } from '../enums/ai-effect.enums';

/**
 * 单次短期效果上报 — POST /ai/effect/immediate.
 *
 * 大厂 standard: 短效立刻上报, 中长效由 cron 聚合, 客户端不重复上报.
 */
export class RecordImmediateEffectDto {
  @ApiProperty({ description: '工具 id (e.g. breathing_478)', example: 'breathing_478' })
  toolId!: string;

  @ApiProperty({ description: '会话 id (跟前端 session id 对齐)', example: 'uuid-v4' })
  sessionId!: string;

  @ApiProperty({ description: '不安度前测 0..10', required: false, nullable: true, minimum: 0, maximum: 10 })
  intensityBefore!: number | null;

  @ApiProperty({ description: '不安度后测 0..10', required: false, nullable: true, minimum: 0, maximum: 10 })
  intensityAfter!: number | null;

  @ApiProperty({ description: '主观情绪分 0..1', required: false, nullable: true })
  moodScore!: number | null;

  @ApiProperty({ description: '上下文透传 (session_id / scenario_id 等)', required: false, nullable: true, additionalProperties: true })
  context!: Record<string, unknown> | null;
}

/**
 * 单条效果记录.
 */
export class AIEffectRecordDto {
  @ApiProperty({ enum: AIEffectHorizon })
  horizon!: AIEffectHorizon;

  @ApiProperty({ description: '工具 id' })
  toolId!: string;

  @ApiProperty({ description: '会话 id' })
  sessionId!: string;

  @ApiProperty({ description: '不安度前测', required: false, nullable: true })
  intensityBefore!: number | null;

  @ApiProperty({ description: '不安度后测', required: false, nullable: true })
  intensityAfter!: number | null;

  @ApiProperty({ description: '主观情绪分', required: false, nullable: true })
  moodScore!: number | null;

  @ApiProperty({ description: '周维度情绪变化 -1..1', required: false, nullable: true })
  weeklyDelta!: number | null;

  @ApiProperty({ description: '月维度心理变化 -1..1', required: false, nullable: true })
  monthlyDelta!: number | null;

  @ApiProperty({ description: '游戏化参与度 0..1', required: false, nullable: true })
  gamificationEngagement!: number | null;

  @ApiProperty({ description: '记录时间戳 (ms)' })
  recordedAtMs!: number;
}

/**
 * 历史效果列表响应 — §3.4 趋势面板用.
 */
export class AIEffectHistoryDto {
  @ApiProperty({ type: [AIEffectRecordDto] })
  items!: AIEffectRecordDto[];

  @ApiProperty({ description: '总条数' })
  total!: number;
}
