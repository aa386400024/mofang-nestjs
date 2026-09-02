import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * 陪伴关系绑定 entity — 双角色共用 (大厂企业级 V3).
 *
 * V2.0 §Tab4:
 *   - 成长用户端 ("权限与共享管理"): owner_uid 是成长用户, companion_uid 是陪伴者
 *     - owner_uid 列出他/她授权的所有陪伴者 + 各自的权限等级 (L1/L2/L3)
 *   - 陪伴者端 ("绑定关系管理"): owner_uid 是陪伴者, companion_uid 是被陪伴的成长用户
 *     - owner_uid 列出他/她陪伴的所有人 + 各自的权限等级
 *
 *   双方通过同一个表 + 同样的字段, 角色区分只靠查询时 owner_uid / companion_uid
 *
 * 字段:
 *   - permissionLevel: L1 (紧急) / L2 (状态) / L3 (互动), 见 V2.0 §Tab4 二级页
 *   - status: pending (邀请中) / active (生效) / terminated (解除)
 *   - inviteCode: 邀请码 (成长用户生成, 陪伴者用码绑定)
 *   - inviteCodeExpiresAt: 邀请码过期时间 (V2.0 设 24h)
 *   - terminatedAt: 解除时间 (审计)
 *
 * 大厂做法:
 *   - INDEX (owner_uid), INDEX (companion_uid), INDEX (invite_code)
 *   - 解除是软状态 (status=terminated), 不真删 (审计追溯)
 *   - 真删由 users.deleted_at cascade 触发
 *   - V3 加"双向解除确认": 主动方 terminate, 对方收到通知, 7 天后自动生效
 */
@Entity('companion_bindings')
@Index('idx_bindings_owner', ['ownerUid'])
@Index('idx_bindings_companion', ['companionUid'])
@Index('idx_bindings_invite_code', ['inviteCode'])
@Index('uq_bindings_owner_companion', ['ownerUid', 'companionUid'], { unique: true })
export class CompanionBinding {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 关系 owner — 成长用户 = owner / 陪伴者 = owner (按上下文). */
  @Column({ type: 'char', length: 36, name: 'owner_uid' })
  ownerUid!: string;

  /** 关系对方 — 跟 owner 角色相反 (陪伴者 or 成长用户). */
  @Column({ type: 'char', length: 36, name: 'companion_uid', nullable: true })
  companionUid!: string | null;

  /** 邀请码 (owner 生成, companion 输入码绑定). V2.0 6 位数字 (复用 verification code 风格). */
  @Column({ type: 'varchar', length: 16, name: 'invite_code', nullable: true })
  inviteCode!: string | null;

  @Column({ type: 'datetime', name: 'invite_code_expires_at', nullable: true })
  inviteCodeExpiresAt!: Date | null;

  /** pending: 邀请中; active: 生效; terminated: 解除. */
  @Column({ type: 'varchar', length: 16, name: 'status', default: 'pending' })
  status!: 'pending' | 'active' | 'terminated';

  /** L1 紧急 / L2 状态 / L3 互动 — V2.0 §Tab4 权限等级说明. */
  @Column({ type: 'varchar', length: 8, name: 'permission_level', default: 'L1' })
  permissionLevel!: 'L1' | 'L2' | 'L3';

  @Column({ type: 'datetime', name: 'bound_at', nullable: true })
  boundAt!: Date | null;

  @Column({ type: 'datetime', name: 'terminated_at', nullable: true })
  terminatedAt!: Date | null;

  @Column({ type: 'varchar', length: 255, name: 'terminate_reason', nullable: true })
  terminateReason!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
