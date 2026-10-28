import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * 工具皮肤状态表 — V4.0 §3.4.
 *
 * 跟 ISLAND_ELEMENT 同思路 — 区分 "定义" 和 "状态":
 *   - 皮肤定义 (TOOL_SKIN_DEFS) 是代码内常量
 *   - 用户状态 (本表) 只记 unlocked_at + equipped_at
 *
 * 同时只能有一个皮肤"装备" — 由 application 层保证 (DB unique partial index).
 *
 * 注意: 同一用户对同一 skin 只有一行, unique (user_id, skin_id).
 * "当前装备的皮肤" = WHERE user_id=? AND equipped_at IS NOT NULL.
 */
@Entity('inner_world_tool_skin_states')
@Index('uk_iwts_user_skin', ['userId', 'skinId'], { unique: true })
@Index('idx_iwts_user_equipped', ['userId', 'equippedAt'])
export class ToolSkinState {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'user_id' })
  userId!: string;

  /** 跟 TOOL_SKIN_DEFS.skinId 1:1. */
  @Column({ type: 'varchar', length: 96, name: 'skin_id' })
  skinId!: string;

  @Column({ type: 'timestamp', name: 'unlocked_at' })
  unlockedAt!: Date;

  /** null = 已解锁但未装备. */
  @Column({ type: 'timestamp', name: 'equipped_at', nullable: true })
  equippedAt!: Date | null;

  /** 解锁来源: 'fragment' | 'member' | 'manual'. */
  @Column({ type: 'varchar', length: 32, name: 'unlock_source' })
  unlockSource!: string;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt!: Date;
}
