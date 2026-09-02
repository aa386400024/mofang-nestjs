import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { UserState } from '../user.state';

/**
 * User entity — 心塑 + 魔方共用账号表 (大厂企业级).
 *
 * V1 字段 (基础账号):
 *   - uid: UUID 主键
 *   - phone: 手机号 (全平台唯一, 11 位)
 *   - email: 邮箱 (全平台唯一, 可选)
 *   - passwordHash: bcrypt hash, 永不存明文
 *   - state: 用户状态 (state machine: pending_verification/active/suspended/banned/deleted)
 *   - deletedAt: 软删时间 (GDPR/合规友好, 30 天后真删)
 *   - lastLoginAt: 最后登录时间 (风控用)
 *   - createdAt / updatedAt: 自动管理
 *
 * V2 新增字段 (企业级增强):
 *   - emailVerifiedAt: 邮箱验证时间 (NULL = 未验证)
 *   - phoneVerifiedAt: 手机号验证时间 (NULL = 未验证)
 *   - failedLoginCount: 连续失败登录次数 (密码爆破防护)
 *   - lockedUntil: 账号锁定到期时间 (超过阈值后锁定 N 分钟)
 *   - passwordChangedAt: 最后改密时间 (强制重置周期判定)
 *   - mustChangePassword: 是否强制要求改密 (改密流程触发后置 true)
 *
 * 大厂设计:
 *   - 业务数据 (心塑心理 / 魔方创作) 不在 users 表, 通过 uid 关联到各自 schema
 *   - 软删 + state 状态机分离: state 是业务禁用, deleted 是软删
 *   - phone/email 唯一索引 (允许 NULL, 多个 NULL 不冲突)
 *   - 敏感字段 (password_hash) 不返回给前端
 */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  uid!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 20, nullable: true })
  phone!: string | null;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'password_hash' })
  passwordHash!: string;

  /** 用户状态 (state machine, 见 user.state.ts) */
  @Column({ type: 'varchar', length: 32, default: UserState.Active })
  state!: UserState;

  /** 最后登录时间 (风控 + 业务分析) */
  @Column({ type: 'datetime', name: 'last_login_at', nullable: true })
  lastLoginAt!: Date | null;

  // ====== V2 新增 ======

  /** 邮箱验证时间 (NULL = 未验证) */
  @Column({ type: 'datetime', name: 'email_verified_at', nullable: true })
  emailVerifiedAt!: Date | null;

  /** 手机号验证时间 (NULL = 未验证) */
  @Column({ type: 'datetime', name: 'phone_verified_at', nullable: true })
  phoneVerifiedAt!: Date | null;

  /** 连续失败登录次数 (登录成功后归零) */
  @Column({ type: 'int', default: 0, name: 'failed_login_count' })
  failedLoginCount!: number;

  /** 账号锁定到期时间 (超过阈值后锁定 N 分钟, NULL = 未锁定) */
  @Column({ type: 'datetime', name: 'locked_until', nullable: true })
  lockedUntil!: Date | null;

  /** 最后改密时间 (强制重置周期判定) */
  @Column({ type: 'datetime', name: 'password_changed_at', nullable: true })
  passwordChangedAt!: Date | null;

  /** 是否强制要求改密 (true 时登录会强制跳改密页) */
  @Column({ type: 'boolean', default: false, name: 'must_change_password' })
  mustChangePassword!: boolean;

  // ====== V1 软删 ======

  /** 软删时间 (GDPR/合规: 30 天后真删, V2 加 cron job) */
  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
