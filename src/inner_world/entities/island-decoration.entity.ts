import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { IslandArea } from '../enums/island-area.enum';

/**
 * 用户装饰表 — V4.0 §3.2 (装饰摆件).
 *
 * 生命周期:
 *   - 用户用碎片购买 → 插入 (purchased_at 有值, placed=None)
 *   - 拖放到 4 区 → 更新 placedArea + placedX/PlacedY
 *   - 移除 → placed=null
 *
 * 注意: 跟 island_elements 区分:
 *   - island_elements 是内置必有的 10 个元素 (硬编码定义)
 *   - island_decorations 是可选装饰 (用户购买)
 */
@Entity('inner_world_island_decorations')
@Index('uk_iwid_user_decoration', ['userId', 'decorationId'], { unique: true })
@Index('idx_iwid_user_placed', ['userId', 'placedArea'])
export class IslandDecoration {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'user_id' })
  userId!: string;

  /** 跟 DECORATION_DEFS.decorationId 1:1. */
  @Column({ type: 'varchar', length: 64, name: 'decoration_id' })
  decorationId!: string;

  @Column({ type: 'timestamp', name: 'purchased_at' })
  purchasedAt!: Date;

  /** null = 持有但未摆放. */
  @Column({ type: 'enum', enum: IslandArea, name: 'placed_area', nullable: true })
  placedArea!: IslandArea | null;

  @Column({ type: 'float', name: 'placed_x', nullable: true })
  placedX!: number | null;

  @Column({ type: 'float', name: 'placed_y', nullable: true })
  placedY!: number | null;

  /** 总花费碎片 (冗余字段, 便于统计; 真实金额走 fragment_logs). */
  @Column({ type: 'int', name: 'spent_fragments', default: 0 })
  spentFragments!: number;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt!: Date;
}
