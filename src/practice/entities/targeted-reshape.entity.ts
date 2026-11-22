import { Column, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 心理基因靶向重塑 entity — V3.0 设计手册 §3.4 心理健身房.
 *
 * 1 行/用户, 存核心卡点 + 4 周重塑计划 + 当前进度.
 *
 * 设计:
 *   - stuckPoints JSON 字段存核心卡点列表 (不抽独立表, V2.0 单行足够)
 *   - weeklyTasks JSON 字段存 ReshapeWeeklyTask 列表
 *   - loosenessScore 0.0-1.0, 由用户自评或 LLM 计算 (V3 接 LLM)
 *   - 1:N weeklyTasks 与 1:N stuckPoints 都用 JSON 数组, 避免多表 join 复杂度
 *
 * V3 升级点: 接 LLM 推理卡点识别 + 实时更新 loosenessScore.
 */
@Entity('targeted_reshapes')
@Index('idx_targeted_reshapes_uid', ['uid'])
export class TargetedReshape {
  @PrimaryColumn({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  @Column({ type: 'simple-json', name: 'stuck_points' })
  stuckPoints!: {
    id: string;
    label: string;
    formationStage: string;
    impactLevel: number;
    rootCause: string;
    creatureKey?: string;
  }[];

  @Column({ type: 'simple-json', name: 'weekly_tasks' })
  weeklyTasks!: {
    weekNumber: number;
    stuckPointId: string;
    title: string;
    modality: 'narrative' | 'imagery' | 'exposure' | 'communication';
    summary: string;
  }[];

  @Column({ type: 'int', name: 'completed_week_count', default: 0 })
  completedWeekCount!: number;

  @Column({ type: 'float', name: 'looseness_score', default: 0 })
  loosenessScore!: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
