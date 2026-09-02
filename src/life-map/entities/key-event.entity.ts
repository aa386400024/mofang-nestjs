import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { LIFE_STAGES, type LifeStage } from '../../shared/types/practice.types';

export const KEY_EVENT_TYPES = ['positive', 'negative', 'turning'] as const;
export type KeyEventType = (typeof KEY_EVENT_TYPES)[number];

/**
 * 关键事件记录 — V3.0 §3 Tab3 心理地图核心表.
 *
 * 一行 = 一个事件. 用户可增删改, 软删 (deletedAt).
 *
 * V3.0 治本:
 *   - 加 deleted_at: 软删
 *   - age 必填 (事件发生年龄)
 *   - 全部字段允许 nullable (前端表单逐步填写)
 *   - Index(userId, age) 排序查询 (时间轴按年龄正序)
 */
@Entity('key_events')
@Index('idx_ke_user_age', ['userId', 'age'])
export class KeyEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'user_id' })
  userId!: string;

  @Column({ type: 'varchar', length: 100, name: 'title' })
  title!: string;

  /** 事件发生年龄. */
  @Column({ type: 'int', name: 'age' })
  age!: number;

  @Column({ type: 'enum', enum: KEY_EVENT_TYPES, name: 'type' })
  type!: KeyEventType;

  @Column({ type: 'text', name: 'description', nullable: true })
  description?: string | null;

  @Column({ type: 'text', name: 'feelings', nullable: true })
  feelings?: string | null;

  @Column({ type: 'text', name: 'influence', nullable: true })
  influence?: string | null;

  @Column({ type: 'text', name: 'interpretation', nullable: true })
  interpretation?: string | null;

  @Column({ type: 'enum', enum: LIFE_STAGES, name: 'stage', nullable: true })
  stage?: LifeStage | null;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime', name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'datetime', name: 'deleted_at', nullable: true })
  deletedAt?: Date | null;
}
