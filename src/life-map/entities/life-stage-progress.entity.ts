import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { LIFE_STAGES, type LifeStage } from '../../shared/types/practice.types';

/**
 * 人生阶段任务完成度记录 — V3.0 §3 Tab3 心理地图核心表.
 *
 * 一行 = 一用户一阶段 (UNIQUE user_id + stage), V3.0 允许更新.
 *
 * V3.0 治本:
 *   - 加 deleted_at: 软删, 跟其他 moyin 表一致
 *   - completionPct: 0-100 整数, NULL 表示尚未填写
 *   - 加 Index(userId): 高频查询用户全量阶段用
 *   - 加 Index(userId, stage) UNIQUE: 一行一阶段
 */
@Entity('life_stage_progress')
@Index('idx_lsp_user', ['userId'])
@Index('uniq_lsp_user_stage', ['userId', 'stage'], { unique: true })
export class LifeStageProgressEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'user_id' })
  userId!: string;

  @Column({ type: 'enum', enum: LIFE_STAGES, name: 'stage' })
  stage!: LifeStage;

  /** 任务完成度 0-100, NULL 表示尚未填写. */
  @Column({ type: 'int', name: 'completion_pct', nullable: true })
  completionPct!: number | null;

  @Column({ type: 'text', name: 'stuck_points', nullable: true })
  stuckPoints?: string | null;

  @Column({ type: 'text', name: 'gains', nullable: true })
  gains?: string | null;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime', name: 'updated_at' })
  updatedAt!: Date;

  /** V3.0 治本: 软删, 默认 0 (active). */
  @Column({ type: 'datetime', name: 'deleted_at', nullable: true })
  deletedAt?: Date | null;
}
