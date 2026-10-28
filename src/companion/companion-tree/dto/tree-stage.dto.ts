/**
 * 共种陪伴树 DTO (跟前端 CompanionTree 1:1).
 */
export class CompanionTreeDto {
  id!: string;

  ownerAId!: string;

  ownerBId!: string | null;

  waterCount!: number;

  milestonesTriggered!: number[];

  lastWaterAt!: Date | null;

  createdAt!: Date;

  updatedAt!: Date;

  /**
   * 派生字段 (大厂 standard: 派生计算放 entity 内部, DTO 不存).
   */
  stage!: number; // 0..4
  stageLabel!: string;
  stageEmoji!: string;
  waterToNextStage!: number;
  stageProgress!: number; // 0..1
  daysSinceCreated!: number;
  daysSinceLastWater!: number | null;
  isWilting!: boolean;
  isDualMode!: boolean;
}

/**
 * 共种树简要信息 (用于 controller 内的派生结果).
 */
export class CompanionTreeStatsDto {
  waterCount!: number;
  stage!: number;
  daysSinceCreated!: number;
}
