// V2026-09-04 治本 (V6.0 §4.2 + audit P0-3):
//   急救会话 DTO — 端侧 SQLCipher 本地表对齐.
//   关键: id 用前端 UUID (跨设备 upsert 幂等键);
//         started_at_ms / completed_at_ms 用前端毫秒时间戳 (不二次转换).

import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNumber, IsObject, IsOptional, IsString, Min } from 'class-validator';

import { EmergencyToolKind, SessionPhase } from '../enums/emergency.enums';

/**
 * 急救会话上报 DTO — POST /emergency/sessions.
//   端侧练习结束调用, 含前端 id (UUID 幂等键).
 */
export class UpsertEmergencySessionDto {
  // V2026-09-04 治本 (smoke 修): 加 class-validator 装饰器, 否则 Global ValidationPipe
  //   (whitelist: true) 会把未装饰字段剔掉, dto 变 {} → service 调 dto.startedAtMs.toString() 必崩.
  @IsString()
  @ApiProperty({ description: '前端 UUID, 跨设备 upsert 幂等键', example: 'uuid-v4' })
  id!: string;

  @IsEnum(EmergencyToolKind)
  @ApiProperty({ enum: ['grounding_54321', 'breath_448', 'safe_place', 'tipp', 'thought_bubble'] })
  toolKind!: EmergencyToolKind;

  @IsEnum(SessionPhase)
  @ApiProperty({ enum: ['idle', 'prerating', 'running', 'postrating', 'completed', 'abandoned'] })
  phase!: SessionPhase;

  @IsOptional()
  @IsNumber()
  @ApiProperty({ description: '不安度前测 0..10', required: false, nullable: true, minimum: 0, maximum: 10 })
  intensityBefore!: number | null;

  @IsOptional()
  @IsNumber()
  @ApiProperty({ description: '不安度后测 0..10', required: false, nullable: true, minimum: 0, maximum: 10 })
  intensityAfter!: number | null;

  @IsInt()
  @Min(0)
  @ApiProperty({ description: '已完成阶段数', example: 3 })
  stagesCompleted!: number;

  @IsInt()
  @Min(0)
  @ApiProperty({ description: '前端毫秒时间戳 — 与前端 EmergencySession.startedAtMs 对齐', example: 1_725_432_100_123 })
  startedAtMs!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @ApiProperty({ description: '完成毫秒时间戳', required: false, nullable: true })
  completedAtMs!: number | null;

  @IsOptional()
  @IsString()
  @ApiProperty({ description: 'thought_bubble 工具专用 — 走 SQLCipher 加密', required: false, nullable: true })
  notes!: string | null;

  @IsOptional()
  @IsObject()
  @ApiProperty({ description: '上下文透传', required: false, nullable: true, additionalProperties: true })
  context!: Record<string, unknown> | null;
}

/**
 * 急救会话响应 DTO — 与上报字段对齐 + 服务端入库时间.
 */
export class EmergencySessionDto {
  @ApiProperty() id!: string;
  @ApiProperty() uid!: string;
  @ApiProperty({ enum: ['grounding_54321', 'breath_448', 'safe_place', 'tipp', 'thought_bubble'] })
  toolKind!: EmergencyToolKind;

  @ApiProperty({ enum: ['idle', 'prerating', 'running', 'postrating', 'completed', 'abandoned'] })
  phase!: SessionPhase;

  @ApiProperty({ required: false, nullable: true }) intensityBefore!: number | null;
  @ApiProperty({ required: false, nullable: true }) intensityAfter!: number | null;
  @ApiProperty() stagesCompleted!: number;
  @ApiProperty() startedAtMs!: number;
  @ApiProperty({ required: false, nullable: true }) completedAtMs!: number | null;
  @ApiProperty({ required: false, nullable: true }) notes!: string | null;
  @ApiProperty({ required: false, nullable: true, additionalProperties: true })
  context!: Record<string, unknown> | null;

  @ApiProperty() createdAt!: Date;
}

/**
 * 急救会话列表 — 跨设备同步用.
 */
export class EmergencySessionListDto {
  @ApiProperty({ type: [EmergencySessionDto] })
  items!: EmergencySessionDto[];

  @ApiProperty({ description: '总条数' })
  total!: number;
}
