// V2026-09-04 治本 (V6.0 §3.3):
//   AI 动态解锁状态 DTO — 6 大高阶功能 + 4 维度评分.
//   反双胞胎: 不写「unlock 请求 DTO」 — 解锁是服务端自动评估, 客户端
//             只读. POST 只用于「手动重置 / admin 回滚」.

import { ApiProperty } from '@nestjs/swagger';

import { AIUnlockFeature, AIUnlockState } from '../enums/ai-unlock.enums';

/**
 * 单功能解锁状态 — 跟前端 AIUnlockState 1:1.
 */
export class AIUnlockStateDto {
  @ApiProperty({ enum: AIUnlockFeature, description: '高阶功能 id' })
  feature!: AIUnlockFeature;

  @ApiProperty({ enum: AIUnlockState, description: '解锁状态机' })
  state!: AIUnlockState;

  // ─── 4 维度评分 (跟 entity 字段同名) ───

  @ApiProperty({ description: '需求强度 0..1', example: 0.72 })
  scoreNeed!: number;

  @ApiProperty({ description: '使用深度 0..1', example: 0.45 })
  scoreUsage!: number;

  @ApiProperty({ description: '干预效果 0..1', example: 0.68 })
  scoreEffect!: number;

  @ApiProperty({ description: '心理准备度 0..1', example: 0.81 })
  scoreReadiness!: number;

  @ApiProperty({ description: '综合分 (need*.4 + usage*.25 + effect*.2 + readiness*.15)', example: 0.65 })
  compositeScore!: number;

  @ApiProperty({ description: '回退原因 (仅 rolled_back 时有值)', required: false, nullable: true })
  rollbackReason!: string | null;

  @ApiProperty({ description: '上次评估时间戳 (ms)' })
  lastEvaluatedAtMs!: number;
}

/**
 * 6 功能状态集合 — 一次拉全.
 */
export class AIUnlockStatesDto {
  @ApiProperty({ type: [AIUnlockStateDto], description: '6 大高阶功能状态' })
  items!: AIUnlockStateDto[];

  @ApiProperty({ description: '服务端拉取时间戳 (ms)' })
  fetchedAtMs!: number;
}
