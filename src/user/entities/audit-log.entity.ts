import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Audit event enum — 用户鉴权事件 (大厂合规要求).
 *
 * V1 事件:
 *   - USER_REGISTER / USER_LOGIN_SUCCESS / USER_LOGIN_FAILED
 *   - USER_LOGOUT / USER_TOKEN_REFRESH / USER_TOKEN_REVOKED / USER_STATE_CHANGED
 *
 * V2 新增 (企业级鉴权必备):
 *   - USER_PASSWORD_CHANGED: 改密 (合规审计)
 *   - USER_PASSWORD_RESET_REQUESTED / USER_PASSWORD_RESET_COMPLETED: 密码重置流程
 *   - USER_EMAIL_VERIFICATION_SENT / USER_EMAIL_VERIFIED: 邮箱验证
 *   - USER_PHONE_VERIFICATION_SENT / USER_PHONE_VERIFIED: 手机号验证
 *   - USER_ACCOUNT_LOCKED / USER_ACCOUNT_UNLOCKED: 账号锁定/解锁
 *   - USER_OAUTH_LINKED / USER_OAUTH_UNLINKED: OAuth 绑定/解绑
 *   - USER_OAUTH_LOGIN_SUCCESS / USER_OAUTH_LOGIN_FAILED: OAuth 登录
 *   - USER_HARD_DELETED: 软删到期真删 (cron 跑)
 *   - USER_FORCED_PASSWORD_RESET: 强制重置周期触发
 */
export enum AuditEvent {
  // V1
  UserRegister = 'user_register',
  UserLoginSuccess = 'user_login_success',
  UserLoginFailed = 'user_login_failed',
  UserLogout = 'user_logout',
  UserTokenRefresh = 'user_token_refresh',
  UserTokenRevoked = 'user_token_revoked',
  UserStateChanged = 'user_state_changed',

  // V2 密码
  UserPasswordChanged = 'user_password_changed',
  UserPasswordResetRequested = 'user_password_reset_requested',
  UserPasswordResetCompleted = 'user_password_reset_completed',
  UserForcedPasswordReset = 'user_forced_password_reset',

  // V2 验证
  UserEmailVerificationSent = 'user_email_verification_sent',
  UserEmailVerified = 'user_email_verified',
  UserPhoneVerificationSent = 'user_phone_verification_sent',
  UserPhoneVerified = 'user_phone_verified',

  // V2 锁定
  UserAccountLocked = 'user_account_locked',
  UserAccountUnlocked = 'user_account_unlocked',

  // V2 OAuth
  // eslint-disable-next-line @typescript-eslint/naming-convention
  UserOAuthLinked = 'user_oauth_linked',
  // eslint-disable-next-line @typescript-eslint/naming-convention
  UserOAuthUnlinked = 'user_oauth_unlinked',
  // eslint-disable-next-line @typescript-eslint/naming-convention
  UserOAuthLoginSuccess = 'user_oauth_login_success',
  // eslint-disable-next-line @typescript-eslint/naming-convention
  UserOAuthLoginFailed = 'user_oauth_login_failed',

  // V2 软删
  UserHardDeleted = 'user_hard_deleted',
}

/**
 * Audit log entity — 用户鉴权事件日志 (大厂合规要求).
 *
 * 设计原则:
 *   - append-only, 不允许 update / delete (用 DB 权限约束)
 *   - 记录 userId + event + ip + ua + metadata
 *   - V2 写走 BullMQ 队列 (异步), 不阻塞主流程
 *   - 合规要求: 保留至少 90 天 (GDPR/SOC2)
 *
 * 索引优化:
 *   - idx_user_id: 按用户查历史
 *   - idx_event_created: 按事件 + 时间窗口查 (e.g. 最近 1 小时登录失败次数)
 *   - idx_created_at: 范围扫描 / 清理老数据
 */
@Entity('user_audit_logs')
@Index('idx_user_id', ['userId'])
@Index('idx_event_created', ['event', 'createdAt'])
@Index('idx_created_at', ['createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 关联 User.uid (nullable: 登录失败时可能 userId 未知) */
  @Column({ type: 'varchar', length: 36, name: 'user_id', nullable: true })
  userId!: string | null;

  /** 事件类型 */
  @Column({ type: 'varchar', length: 64 })
  event!: AuditEvent;

  /** IP 地址 */
  @Column({ type: 'varchar', length: 64, name: 'ip_address', nullable: true })
  ipAddress!: string | null;

  /** User-Agent */
  @Column({ type: 'varchar', length: 512, name: 'user_agent', nullable: true })
  userAgent!: string | null;

  /** 附加元数据 (JSON: 失败原因、device 信息等) */
  @Column({ type: 'text', nullable: true })
  metadata!: string | null;

  /** 是否成功 (false 通常意味着安全事件, 需风控关注) */
  @Column({ type: 'boolean', default: true, name: 'is_success' })
  isSuccess!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
