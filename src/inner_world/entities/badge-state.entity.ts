import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { BadgeId } from '../enums/badge-id.enum';

/**
 * 徽章状态表 — V4.0 §3.3.
 *
 * 设计原则 — "存在即解锁":
 *   - 没有 unlocked 布尔字段, 用户没解锁 = 库里没这一行
 *   - 这样 SUM COUNT 查询自然 = 已解锁数, 不用 WHERE 过滤
 *
 * 触发:
 *   - reconcile() 由 reconciliation.service.ts 调用, 触发点:
 *     - 碎片 grant/consume 后
 *     - 工具 session complete 后
 *     - 用户主动调 POST /inner-world/badges/reconcile
 *
 * pending 机制:
 *   - 解锁的瞬间行已写入 (unlocked_at 有值)
 *   - "前端还没展示 unlock overlay" 的中间态 — 用 unlock_consumed_at 表示
 *   - 前端 BadgeUnlockOverlay 展示完调 POST /badges/:id/consume 标记
 */
@Entity('inner_world_badge_states')
@Index('uk_iwb_user_badge', ['userId', 'badgeId'], { unique: true })
@Index('idx_iwb_user_time', ['userId', 'unlockedAt'])
export class BadgeState {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'user_id' })
  userId!: string;

  @Column({ type: 'varchar', length: 64, name: 'badge_id' })
  badgeId!: BadgeId;

  /**
   * 解锁时刻. 写入即解锁, 不允许为空.
   * "pending" 状态 = unlock_consumed_at IS NULL.
   */
  @Column({ type: 'timestamp', name: 'unlocked_at' })
  unlockedAt!: Date;

  /**
   * 前端 unlock overlay 消费时刻.
   * NULL = 还没消费, 前端 cold start 时应再次展示.
   * 业务时机: 用户第一次看到 BadgeUnlockOverlay 弹出, 看完点 "知道了".
   */
  @Column({ type: 'timestamp', name: 'unlock_consumed_at', nullable: true })
  unlockConsumedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt!: Date;
}
