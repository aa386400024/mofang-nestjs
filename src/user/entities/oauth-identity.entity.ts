import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { User } from './user.entity';

/**
 * OAuth provider enum — 第三方登录 provider 枚举.
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export enum OAuthProvider {
  Wechat = 'wechat',
  Google = 'google',
  Apple = 'apple',
}

/**
 * OAuth identity entity — 用户第三方账号绑定 (大厂标准).
 *
 * 设计:
 *   - 一个用户可绑定多个 provider (e.g. 同时绑微信 + Apple)
 *   - 同一 provider 只能绑一个用户 (provider + providerUserId 联合唯一)
 *   - 绑定后允许用第三方登录, 自动创建 session (跟密码登录同流程)
 *
 * 字段:
 *   - provider: 第三方 (wechat / google / apple)
 *   - providerUserId: 第三方用户 ID (openid / sub / apple sub)
 *   - providerData: 第三方返回的原始 userinfo (JSON, 便于后续 V3 取头像/昵称)
 *   - accessToken / refreshToken: 第三方 token (可选, 用于 V3 调第三方 API)
 *   - expiresAt: 第三方 token 过期时间
 *
 * 与 V1 (auth/strategies) 区别:
 *   - V1 用 passport session 模式 (cookie session)
 *   - V2 用 JWT 模式 (跟密码登录统一), 第三方登录后直接发 JWT
 */
@Entity('user_oauth_identities')
@Index('idx_provider_user', ['provider', 'providerUserId'], { unique: true })
@Index('idx_user_provider', ['userId', 'provider'], { unique: true })
// eslint-disable-next-line @typescript-eslint/naming-convention
export class OAuthIdentity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 关联 User.uid */
  @Column({ type: 'varchar', length: 36, name: 'user_id' })
  userId!: string;

  /** 第三方 provider */
  @Column({ type: 'varchar', length: 32 })
  provider!: OAuthProvider;

  /** 第三方用户 ID (openid / google sub / apple sub) */
  @Column({ type: 'varchar', length: 255, name: 'provider_user_id' })
  providerUserId!: string;

  /** 第三方返回的原始 userinfo (JSON) */
  @Column({ type: 'text', nullable: true, name: 'provider_data' })
  providerData!: string | null;

  /** 第三方 access token (加密存, V3 加) */
  @Column({ type: 'text', nullable: true, name: 'access_token' })
  accessToken!: string | null;

  /** 第三方 refresh token */
  @Column({ type: 'text', nullable: true, name: 'refresh_token' })
  refreshToken!: string | null;

  /** 第三方 token 过期时间 */
  @Column({ type: 'datetime', name: 'expires_at', nullable: true })
  expiresAt!: Date | null;

  /** 绑定时间 */
  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  /** 更新时间 (重新登录 / 刷新 token 时更新) */
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  /** 关联 (不预加载) */
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'uid' })
  user?: User;
}
