import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * 小岛元素表 — V4.0 §3.1.
 *
 * 设计:
 *   - elementId 是稳定字符串 ID (见 ISLAND_ELEMENT_DEFS), 跨设备不变
 *   - 用户首次解锁某 element 时插入一行
 *   - growthValue 累加, 达到 ISLAND_ELEMENT_DEFS.growthMax 后视觉升满级
 *   - placedX/PlacedY nullable: 元素摆放到 4 区中的具体坐标, 用于渲染
 *
 * 性能:
 *   - (user_id, element_id) unique — 同一元素只 1 行
 *   - (user_id, growth_value DESC) 用于 "成长进度排行" 查询
 */
@Entity('inner_world_island_elements')
@Index('uk_iwie_user_element', ['userId', 'elementId'], { unique: true })
@Index('idx_iwie_user_growth', ['userId', 'growthValue'])
export class IslandElement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'user_id' })
  userId!: string;

  /** 跟 ISLAND_ELEMENT_DEFS.elementId 1:1. */
  @Column({ type: 'varchar', length: 64, name: 'element_id' })
  elementId!: string;

  @Column({ type: 'timestamp', name: 'unlocked_at' })
  unlockedAt!: Date;

  /** 成长值, 0 ~ growthMax (见 ISLAND_ELEMENT_DEFS). */
  @Column({ type: 'int', name: 'growth_value', default: 0 })
  growthValue!: number;

  /** 用户手动摆放的归一化坐标 (0..1, 相对 4 区宽高). nullable = 沿用默认. */
  @Column({ type: 'float', name: 'placed_x', nullable: true })
  placedX!: number | null;

  @Column({ type: 'float', name: 'placed_y', nullable: true })
  placedY!: number | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt!: Date;
}
