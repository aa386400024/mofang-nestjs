import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { User } from './user.entity';

/**
 * Session entity — 用户登录会话 (大厂多端管理).
 *
 * V1 字段:
 *   - sid / userId / jti / deviceInfo / ipAddress / expiresAt / isRevoked
 *
 * V2 新增 (多端管理 UI 用):
 *   - lastActiveAt: 最后活跃时间 (列表展示用, 用于"X 分钟前活跃")
 *   - loginAt: 登录时间 (跟 createdAt 类似, 但语义更清晰)
 *   - userAgentRaw: 原始 User-Agent 字符串 (列表展示用)
 *   - location: 登录地点 (V3 接入 IP 地理位置库)
 *   - deviceType: 设备类型 (mobile / desktop / tablet / unknown, 简单 UA 解析)
 *
 * 大厂做法:
 *   - 不在 session 里存完整设备指纹 (太重), 存原始 UA + 简单分类
 *   - session 跟 blacklist 是两回事: blacklist 是 token 黑名单 (Redis),
 *     session 是用户会话 (DB, 用于多端 UI 管理).
 */
@Entity('user_sessions')
@Index('idx_user_id', ['userId'])
@Index('idx_jti', ['jti'], { unique: true })
@Index('idx_user_active', ['userId', 'isRevoked'])
export class Session {
  @PrimaryGeneratedColumn('uuid')
  sid!: string;

  /** 关联 User.uid */
  @Column({ type: 'varchar', length: 36, name: 'user_id' })
  userId!: string;

  /** Refresh token 的 jti (JWT ID), 用于精确撤销 */
  @Column({ type: 'varchar', length: 64 })
  jti!: string;

  /** 设备描述 (登录时由前端传入, e.g. "iPhone 15 Pro / iOS 17") */
  @Column({ type: 'varchar', length: 255, name: 'device_info', nullable: true })
  deviceInfo!: string | null;

  /** 原始 User-Agent (V2 新增, 用于多端 UI 展示) */
  @Column({ type: 'varchar', length: 512, name: 'user_agent_raw', nullable: true })
  userAgentRaw!: string | null;

  /** 设备类型 (V2 新增, mobile/desktop/tablet/unknown) */
  @Column({ type: 'varchar', length: 32, name: 'device_type', default: 'unknown' })
  deviceType!: string;

  /** IP 地址 */
  @Column({ type: 'varchar', length: 64, name: 'ip_address', nullable: true })
  ipAddress!: string | null;

  /** 登录地点 (V3 接入 IP 地理位置, V2 留 null) */
  @Column({ type: 'varchar', length: 128, name: 'location', nullable: true })
  location!: string | null;

  /** 最后活跃时间 (V2 新增, 列表展示) */
  @Column({ type: 'datetime', name: 'last_active_at', nullable: true })
  lastActiveAt!: Date | null;

  /** session 过期时间 (跟 refresh token 同步) */
  @Column({ type: 'datetime', name: 'expires_at' })
  expiresAt!: Date;

  /** 是否已主动撤销 (false 表示有效, true 表示 revoked/expired) */
  @Column({ type: 'boolean', default: false, name: 'is_revoked' })
  isRevoked!: boolean;

  /** 撤销原因 (V2 新增: manual / password_changed / force_logout_all / jwt_blacklist) */
  @Column({ type: 'varchar', length: 64, name: 'revoked_reason', nullable: true })
  revokedReason!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  /** 关联 (V1 不预加载, 避免 N+1; 业务层按需 find) */
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'uid' })
  user?: User;
}
