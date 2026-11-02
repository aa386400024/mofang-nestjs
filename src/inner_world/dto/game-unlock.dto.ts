// V2026-09-04 治本 (V6.0 §6 + §3.3):
//   Inner World 游戏化模块解锁进度 DTO.
//   对齐前端 game_unlock_progress V2 表 (commit 14935e3 §J).
//   反双胞胎: 跟 ai_unlock_states 字段不完全相同, 不合并 DTO (那个是
//             AI 评估, 这个是 Inner World 模块进度详情).

import { ApiProperty } from '@nestjs/swagger';

import { AIUnlockState } from '../../ai-engine/enums/ai-unlock.enums';

/**
 * Inner World 模块解锁进度 — 单功能.
 */
export class GameUnlockProgressDto {
  @ApiProperty({ description: '模块 id', example: 'companion_tree' })
  moduleId!: string;

  @ApiProperty({ enum: AIUnlockState })
  state!: AIUnlockState;

  @ApiProperty({
    description: '模块进度详情 (companion_tree/pet_cultivation/time_capsule/puzzle_pet 字段不同)',
    required: false,
    nullable: true,
    additionalProperties: true,
  })
  progressJson!: Record<string, unknown> | null;

  @ApiProperty({ description: '更新时间戳 (ms)' })
  updatedAtMs!: number;
}

/**
 * Inner World 所有模块解锁进度 — 端侧 GameUnlockProgressBloc 同步源.
 */
export class GameUnlockProgressListDto {
  @ApiProperty({ type: [GameUnlockProgressDto] })
  items!: GameUnlockProgressDto[];

  @ApiProperty({ description: '服务端拉取时间戳 (ms)' })
  fetchedAtMs!: number;
}

/**
 * 客户端上报 — 端侧进度变更 (浇水 / 喂养 / 解锁成就 / 时间胶囊封存).
 */
export class UpsertGameUnlockDto {
  @ApiProperty() moduleId!: string;
  @ApiProperty({ enum: AIUnlockState }) state!: AIUnlockState;
  @ApiProperty({
    required: false,
    nullable: true,
    additionalProperties: true,
  })
  progressJson!: Record<string, unknown> | null;
}
