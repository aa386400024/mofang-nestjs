/**
 * Redis 命名空间常量 (大厂 Key 设计标准).
 *
 * 统一管理所有 Redis Key 模板, 避免散写字符串导致 key 漂移.
 *
 * 命名规范: `{prefix}:{namespace}:{identifier}`
 *   - prefix: 环境隔离 (mofang:dev / mofang:prod)
 *   - namespace: 业务域 (blacklist / queue / verification / ratelimit / cache)
 *   - identifier: 业务 ID (jti / phone / token)
 *
 * 注意: BullMQ 自带 key 前缀 (bull:{queueName}:...), 跟这里解耦.
 */
export const REDIS_KEYS = {
  /** JWT 黑名单 — {jti} */
  jwtBlacklist: (jti: string): string => `blacklist:${jti}`,
  /** 邮箱验证 token — {token} */
  emailVerification: (token: string): string => `verify:email:${token}`,
  /** 邮箱验证 by userId — 反查 {uid} */
  emailVerificationByUid: (uid: string): string => `verify:email:uid:${uid}`,
  /** 密码重置 token — {token} */
  passwordReset: (token: string): string => `reset:pwd:${token}`,
  /** 密码重置 by userId — 反查 */
  passwordResetByUid: (uid: string): string => `reset:pwd:uid:${uid}`,
  /** 短信验证码 — {phone}:{purpose} */
  smsCode: (phone: string, purpose: string): string => `sms:${phone}:${purpose}`,
  /** 短信发送频率限制 — {phone} */
  smsRateLimit: (phone: string): string => `sms:ratelimit:${phone}`,
  /** 用户失败登录计数 — {uid} */
  loginFailedCount: (uid: string): string => `auth:fail:${uid}`,
  /** 账号锁定 — {uid} */
  accountLock: (uid: string): string => `auth:lock:${uid}`,
  /** OAuth state 防 CSRF — {state} */
  oauthState: (state: string): string => `oauth:state:${state}`,
} as const;

/**
 * 短信验证码场景.
 */
export enum SmsPurpose {
  /** 注册 */
  Register = 'register',
  /** 登录 */
  Login = 'login',
  /** 改密 */
  ChangePassword = 'change_password',
  /** 重置密码 */
  ResetPassword = 'reset_password',
  /** 绑定手机号 */
  BindPhone = 'bind_phone',
}

/**
 * BullMQ 队列名称常量.
 */
export const QUEUE_NAMES = {
  auditLog: 'audit-log',
  emailOutbox: 'email-outbox',
  smsOutbox: 'sms-outbox',
} as const;