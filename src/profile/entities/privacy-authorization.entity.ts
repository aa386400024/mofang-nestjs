import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import type { PrivacyAuthorizationStatus, PrivacyAuthorizationType } from '../../shared/types/practice.types';
import { User } from '../../user/entities/user.entity';

/**
 * 隐私授权记录 entity — V2.0 §Tab4 「授权管理」.
 *
 * 设计要点:
 *   - 用户每次授权 (OAuth 第三方 / 设备权限 / 推送) 写一行
 *   - 用户撤销权限 → status='revoked' (软删, 保留 audit)
 *   - 索引: (uid, type) — 查"我授权了哪些 Google / 微信账号"高效
 *   - 严格权限校验: 撤销 OAuth 绑定时, 同时调外部 provider 撤销 token
 */
@Entity('privacy_authorizations')
@Index('idx_privacy_auths_uid_type', ['uid', 'type'])
@Index('idx_privacy_auths_uid_status', ['uid', 'status'])
export class PrivacyAuthorization {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  @Column({ type: 'varchar', length: 64, name: 'type' })
  type!: PrivacyAuthorizationType;

  @Column({ type: 'varchar', length: 32, name: 'status', default: 'active' })
  status!: PrivacyAuthorizationStatus;

  /** 显示名 (e.g. "Google · 张大炮",  "iPhone 15 Pro 后置相机"). */
  @Column({ type: 'varchar', length: 128, name: 'display_name' })
  displayName!: string;

  /** OAuth 提供方返回的 accountId (e.g. Google sub), 用于撤销时反向调用. */
  @Column({ type: 'varchar', length: 128, name: 'provider_account_id', nullable: true })
  providerAccountId!: string | null;

  /** 设备权限类授权的 scope (e.g. 'read_heart_rate,write_workout'). */
  @Column({ type: 'varchar', length: 256, name: 'scope', nullable: true })
  scope!: string | null;

  @CreateDateColumn({ name: 'granted_at' })
  grantedAt!: Date;

  @Column({ type: 'datetime', name: 'expires_at', nullable: true })
  expiresAt!: Date | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'uid', referencedColumnName: 'uid' })
  user?: User;
}
