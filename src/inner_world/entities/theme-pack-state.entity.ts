import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * 主题包状态表 — V4.0 §3.4.
 *
 * 同一时刻用户只能启用 1 个主题包 — 由 application 层保证:
 *   - 装备新 pack 前, 先把所有同 user 的 active_at 清空 (transaction)
 *   - 然后写入新 pack 的 active_at
 *
 * 跟 tool-skin-state 不同: 皮肤按工具区分 (一个工具可独立皮肤), 主题包是 app 全局.
 */
@Entity('inner_world_theme_pack_states')
@Index('uk_iwtp_user_pack', ['userId', 'packId'], { unique: true })
@Index('idx_iwtp_user_active', ['userId', 'activeAt'])
export class ThemePackState {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'user_id' })
  userId!: string;

  /** 跟 THEME_PACK_DEFS.packId 1:1. */
  @Column({ type: 'varchar', length: 96, name: 'pack_id' })
  packId!: string;

  @Column({ type: 'timestamp', name: 'unlocked_at' })
  unlockedAt!: Date;

  /** null = 已解锁但未启用. */
  @Column({ type: 'timestamp', name: 'active_at', nullable: true })
  activeAt!: Date | null;

  @Column({ type: 'varchar', length: 32, name: 'unlock_source' })
  unlockSource!: string;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt!: Date;
}
