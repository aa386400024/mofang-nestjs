import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { TreeWaterLog } from './tree-water-log.entity';

/**
 * 共种陪伴树 entity — V2026-09-12 §6.3 共种陪伴树.
 *
 * 大厂 standard (对标蚂蚁森林合种):
 *   - 双作者共享 1 棵 (ownerAId + ownerBId), 单人模式 ownerBId = null
 *   - 5 阶段 (L0 种子 → L4 大树) 由 waterCount 派生 (entity 不存 stage 字段)
 *   - milestones 50/200/500 触发列表
 *   - 7 天未浇水 → wilting (UI 警告, entity 不存字段, 服务端用 lastWaterAt 计算)
 *
 * 反双胞胎:
 *   - 不复用 rehab-item (那是康复项, 独立业务)
 *   - 不复用 sync-practice (那是同步练习, 独立业务)
 */
@Entity('companion_trees')
@Index('idx_companion_trees_owner_a', ['ownerAId'])
@Index('idx_companion_trees_owner_b', ['ownerBId'])
export class CompanionTree {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'owner_a_id' })
  ownerAId!: string;

  @Column({ type: 'varchar', length: 64, name: 'owner_b_id', nullable: true })
  ownerBId!: string | null;

  @Column({ type: 'int', name: 'water_count', default: 0 })
  waterCount!: number;

  @Column({ type: 'json', name: 'milestones_triggered', default: () => '(JSON_ARRAY())' })
  milestonesTriggered!: number[];

  @Column({ type: 'datetime', name: 'last_water_at', nullable: true })
  lastWaterAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  /**
   * 浇水日志列表 (cascade delete).
   */
  @OneToMany(() => TreeWaterLog, (log) => log.tree)
  waterLogs!: TreeWaterLog[];
}

/**
 * 阶段定义 — 大厂 standard 数值表 (跟前端 CompanionTreeStage 1:1).
 */
export const TreeStageMeta: readonly {
  label: string;
  emoji: string;
  waterThreshold: number;
}[] = [
  { label: '种子', emoji: '🌱', waterThreshold: 0 },
  { label: '幼苗', emoji: '🌿', waterThreshold: 20 },
  { label: '小树', emoji: '🌳', waterThreshold: 60 },
  { label: '中树', emoji: '🌲', waterThreshold: 150 },
  { label: '大树', emoji: '🏞️', waterThreshold: 300 },
];

/**
 * 派生当前阶段 (跟前端 TreeStage.of).
 */
export function deriveStage(waterCount: number): number {
  let stage = 0;
  for (let i = TreeStageMeta.length - 1; i >= 0; i--) {
    const t = TreeStageMeta[i];
    if (waterCount >= t.waterThreshold) {
      stage = i;
      break;
    }
  }
  return stage;
}

/**
 * 里程碑定义 (跟前端 TreeMilestone.all).
 */
export const TreeMilestoneMeta: readonly {
  threshold: number;
  emoji: string;
  label: string;
}[] = [
  { threshold: 50, emoji: '🌿', label: '初见' },
  { threshold: 200, emoji: '🌳', label: '同舟' },
  { threshold: 500, emoji: '🏞️', label: '共栖' },
];
