import { ApiProperty } from '@nestjs/swagger';

/**
 * 心理基因靶向重塑 DTO — V3.0 §3 Tab3 + 心理健身房共用.
 *
 * 涵盖:
 *   - 卡点列表 (3 个核心卡点)
 *   - 4 周重塑任务 (按卡点分拆)
 *   - 当前周完成进度
 *   - 松动度评分 (自评)
 *
 * V3.0 治本:
 *   - 卡点关联小怪兽图鉴 (creatureKey: slug) — 趣味模式
 *   - 4 周渐进式: 第 N 周解锁需 N-1 周全部完成 (前端 unlock 校验)
 *   - 松动度: 用户自评 0-100, 服务端聚合
 */

const STUCK_POINT_IDS = [
  'need_suppress', // 需求压抑
  'people_pleaser', // 讨好型模式
  'catastrophizing', // 灾难化思维
  'self_blame', // 自我责备
  'avoidance', // 回避型应对
] as const;
export type StuckPointId = (typeof STUCK_POINT_IDS)[number];

const RESHAPE_MODALITIES = [
  'narrative', // 叙事重构
  'imagery_desensitization', // 意象脱敏
  'graded_exposure', // 分级暴露
  'relational_drill', // 关系演练
] as const;
export type ReshapeModality = (typeof RESHAPE_MODALITIES)[number];

export const CREATURE_KEYS = ['people_pleaser_slime', 'catastrophe_dino', 'need_ghost', 'self_blame_wraith', 'avoidance_phantom'] as const;
export type CreatureKey = (typeof CREATURE_KEYS)[number];

// ═══════════════════════════════════════════════════════════════════
// 1. 卡点
// ═══════════════════════════════════════════════════════════════════

export class StuckPointDto {
  @ApiProperty({ description: '卡点标识', enum: STUCK_POINT_IDS })
  id!: StuckPointId;

  @ApiProperty({ description: '卡点名称', example: '讨好型模式' })
  label!: string;

  @ApiProperty({ description: '形成阶段', example: '童年 (0-12 岁)' })
  formationStage!: string;

  @ApiProperty({ description: '影响程度 1-5', example: 4 })
  impactLevel!: number;

  @ApiProperty({ description: '根源分析', example: '童年需求常被否定' })
  rootCause!: string;

  @ApiProperty({ description: '对应小怪兽图鉴 key (趣味模式)', required: false })
  creatureKey?: CreatureKey;

  @ApiProperty({ description: '习性描述', required: false, example: '总是软趴趴想贴向别人' })
  creatureTrait?: string;
}

// ═══════════════════════════════════════════════════════════════════
// 2. 4 周任务
// ═══════════════════════════════════════════════════════════════════

export class ReshapeWeeklyTaskDto {
  @ApiProperty({ description: '周数 1-4', example: 1 })
  weekNumber!: number;

  @ApiProperty({ description: '关联卡点', enum: STUCK_POINT_IDS })
  stuckPointId!: StuckPointId;

  @ApiProperty({ description: '任务标题', example: '认识讨好型怪兽' })
  title!: string;

  @ApiProperty({ description: '干预模态', enum: RESHAPE_MODALITIES })
  modality!: ReshapeModality;

  @ApiProperty({ description: '任务简述', example: '用 1 周时间回忆讨好型模式如何在童年形成' })
  summary!: string;

  @ApiProperty({ description: '任务步骤', type: [String] })
  steps!: string[];

  @ApiProperty({ description: '是否已解锁 (基于上一周完成态)' })
  unlocked!: boolean;

  @ApiProperty({ description: '是否已完成' })
  completed!: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// 3. 综合状态
// ═══════════════════════════════════════════════════════════════════

export class TargetedReshapeStatusDto {
  @ApiProperty({ type: [StuckPointDto] })
  stuckPoints!: StuckPointDto[];

  @ApiProperty({ type: [ReshapeWeeklyTaskDto] })
  weeklyTasks!: ReshapeWeeklyTaskDto[];

  @ApiProperty({ description: '已完成的周数', example: 1 })
  completedWeekCount!: number;

  @ApiProperty({ description: '卡点松动度 0-100 (聚合)', example: 12 })
  loosenessScore!: number;

  @ApiProperty({ description: '本周周数 1-4', example: 1 })
  currentWeek!: number;

  @ApiProperty({
    description: '解锁状态',
    enum: ['unlocked', 'locking', 'locked'],
  })
  unlockStatus!: 'unlocked' | 'locking' | 'locked';

  @ApiProperty({ description: '解锁文案', required: false })
  lockedReason?: string;

  @ApiProperty({ description: '小怪兽图鉴已解锁数量', example: 0 })
  unlockedCreatureCount!: number;

  @ApiProperty({ description: '小怪兽图鉴总数', example: 3 })
  totalCreatureCount!: number;
}

// ═══════════════════════════════════════════════════════════════════
// 4. 完成 + 松动度上报
// ═══════════════════════════════════════════════════════════════════

export class CompleteTaskDto {
  @ApiProperty({ description: '任务周数', example: 1 })
  weekNumber!: number;

  @ApiProperty({ description: '关联卡点', enum: STUCK_POINT_IDS })
  stuckPointId!: StuckPointId;

  @ApiProperty({ description: '用户反馈', required: false })
  feedback?: string;
}

export class LoosenessReportDto {
  @ApiProperty({ description: '卡点', enum: STUCK_POINT_IDS })
  stuckPointId!: StuckPointId;

  @ApiProperty({ description: '本周松动度自评 0-100', example: 60 })
  weekLooseness!: number;
}
