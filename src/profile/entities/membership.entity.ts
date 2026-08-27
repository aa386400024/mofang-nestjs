import { Column, CreateDateColumn, Entity, Index, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { User } from '../../user/entities/user.entity';

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
  status!: 'inactive' | 'active' | 'expired' | 'trial';

  @Column({ type: 'varchar', length: 16, name: 'tier', default: 'free' })
  tier!: 'free' | 'plus' | 'pro';

  @Column({ type: 'datetime', name: 'expires_at', nullable: true })
  expiresAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'uid', referencedColumnName: 'uid' })
  user?: User;
}
