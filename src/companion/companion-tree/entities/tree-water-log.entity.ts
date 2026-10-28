import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { CompanionTree } from './companion-tree.entity';
import { WaterAction } from '../enums/water-action.enum';

/**
 * 浇水 / 施肥 / 修剪 日志 — V2026-09-12 §6.3 共种陪伴树.
 *
 * 大厂 standard:
 *   - 每次照顾都写一条 log (审计 + 时序回放)
 *   - FK 到 companion_trees (cascade delete — 树归档后日志一起删)
 *
 * 反双胞胎:
 *   - 不复用 companion-record (那是完整陪伴会话记录, 不是单次浇水)
 */
@Entity('companion_tree_water_logs')
@Index('idx_tree_water_logs_tree_created', ['treeId', 'createdAt'])
export class TreeWaterLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'tree_id' })
  treeId!: string;

  @ManyToOne(() => CompanionTree, (tree) => tree.waterLogs, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'tree_id' })
  tree!: CompanionTree;

  @Column({ type: 'varchar', length: 64, name: 'actor_user_id' })
  actorUserId!: string;

  @Column({
    type: 'enum',
    enum: WaterAction,
    name: 'action',
  })
  action!: WaterAction;

  @Column({ type: 'varchar', length: 64, name: 'actor_anonymous_name', nullable: true })
  actorAnonymousName!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
