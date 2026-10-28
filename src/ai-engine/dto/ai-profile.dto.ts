// V2026-09-04 治本 (V6.0 §3.1):
//   AI 用户画像 DTO — 7 维度快照传输层.
//   边界: DTO ↔ entity (snake_case ↔ camelCase) 转换在 service 层做.
//   反双胞胎: 不写 7 维度独立 DTO (太碎), 一个大 DTO 覆盖所有维度;
//             跟前端 AIUserProfile 1:1 对齐.

import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsObject } from 'class-validator';

import { AIProfileDimension, AIProfileSource } from '../enums/ai-profile.enums';

/**
 * 单维度快照 — 服务端往返都用这个 DTO.
 *
 * V2026-09-04 治本: payload 用 Record<string, unknown> 透传, 由前端
 * 解释 schema; 不在 DTO 层约束每个维度的字段, 减少 schema 漂移.
 */
export class AIProfileDimensionDto {
  @ApiProperty({ enum: AIProfileDimension, description: '维度 id' })
  dimension!: AIProfileDimension;

  @ApiProperty({ description: '维度结构化数据', type: 'object', additionalProperties: true })
  payload!: Record<string, unknown>;

  @ApiProperty({ enum: AIProfileSource, description: '数据来源' })
  source!: AIProfileSource;

  @ApiProperty({ description: '更新时间戳 (ms)', example: 1_725_432_100_123 })
  updatedAtMs!: number;
}

/**
 * 7 维度集合 — 一次拉全 / 一次写全 (端侧缓存 schema 跟服务端对齐).
 */
export class AIProfileDto {
  @ApiProperty({ description: '用户 uid', example: 'uuid-v4' })
  uid!: string;

  @ApiProperty({ type: [AIProfileDimensionDto], description: '7 维度快照' })
  dimensions!: AIProfileDimensionDto[];

  @ApiProperty({ description: '服务端拉取时间戳 (ms)' })
  fetchedAtMs!: number;
}

/**
 * 客户端增量更新请求 — 用 (dimension, payload, source) upsert 单维度.
 */
export class UpsertAIProfileDimensionDto {
  // V2026-09-04 治本 (smoke 修): 加 class-validator 装饰器, 否则 Global ValidationPipe
  //   (whitelist: true) 会把所有未装饰字段剔掉, dto 变 {} → service 拿到 undefined.
  //   上一轮 typeorm upsert SQL parameters 全 null, 报 ER_BAD_NULL_ERROR 1048.
  @IsEnum(AIProfileDimension)
  @ApiProperty({ enum: AIProfileDimension })
  dimension!: AIProfileDimension;

  @IsObject()
  @ApiProperty({ type: 'object', additionalProperties: true })
  payload!: Record<string, unknown>;

  @IsEnum(AIProfileSource)
  @ApiProperty({ enum: AIProfileSource })
  source!: AIProfileSource;
}
