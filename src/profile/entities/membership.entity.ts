import { Column, CreateDateColumn, Entity, Index, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { MembershipSource, MembershipStatus, MembershipTier } from '../../membership/domain/membership.enums.js';
import { User } from '../../user/entities/user.entity.js';

/**
 * 心塑会员 entity — 1:1 关联 users (大厂企业级 V3).
 *
 * V2.0 §Tab4 会员中心 (成长用户专属):
 *   - status: inactive / active / expired / trial
 *   - expiresAt: 过期时间
 *   - tier: 会员等级 (free / plus / pro, V2.0 默认 free)
 *
 * 大厂做法:
 *   - 1:1 跟 users.uid (PK + FK 同列)
 *   - 状态机: trial → active → expired (跟 user.state 思路一致)
 *   - 订单 / 支付 / 续费逻辑 V3 接入, 本次只占位 + 静态权益列表
 *   - 业务字段 (current_period_start/end / auto_renew) V3 加, V2.0 简化
 */
@Entity('user_memberships')
@Index('idx_memberships_status', ['status'])
@Index('idx_memberships_expires_at', ['expiresAt'])
export class Membership {
  @PrimaryColumn({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  /** active: 已开通; expired: 已过期; trial: 试用中; inactive: 未开通 (V2.0 默认). */
  @Column({ type: 'varchar', length: 16, name: 'status', default: 'inactive' })
  status!: MembershipStatus;

  /** 旧 3 档字段：旧客户端继续读；新逻辑以 tierV2 为准。 */
  @Column({ type: 'varchar', length: 16, name: 'tier', default: 'free' })
  tier!: 'free' | 'plus' | 'pro';

  /** 新 4 档字段。NULL 表示尚未迁移，按 legacy tier 映射。 */
  @Column({ type: 'varchar', length: 20, name: 'tier_v2', nullable: true })
  tierV2!: MembershipTier | null;

  /** 旧 counselor 模块的月度周期字段（YYYY-MM），保留兼容。 */
  @Column({ type: 'varchar', length: 7, name: 'quota_period', nullable: true })
  quotaPeriod!: string | null;

  /** 弱网文字降级开关，旧 counselor 模块保留字段。 */
  @Column({ type: 'tinyint', name: 'quota_text_fallback', default: 1 })
  quotaTextFallback!: boolean;

  @Column({ type: 'datetime', name: 'expires_at', nullable: true })
  expiresAt!: Date | null;

  @Column({ type: 'datetime', name: 'period_start', nullable: true })
  periodStart!: Date | null;

  @Column({ type: 'datetime', name: 'period_end', nullable: true })
  periodEnd!: Date | null;

  @Column({ type: 'tinyint', name: 'auto_renew', default: 0 })
  autoRenew!: boolean;

  @Column({ type: 'varchar', length: 16, name: 'source', default: MembershipSource.System })
  source!: MembershipSource;

  /** 迁移前档位快照；Max 等新档在旧字段无法表达时用于审计。 */
  @Column({ type: 'varchar', length: 16, name: 'legacy_tier', nullable: true })
  legacyTier!: string | null;

  @Column({ type: 'char', length: 36, name: 'last_order_id', nullable: true })
  lastOrderId!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'uid', referencedColumnName: 'uid' })
  user?: User;
}
