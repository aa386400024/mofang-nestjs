/// <reference types="../../typings/global" />

/**
 * User module constants.
 *
 * 大厂共用账号设计 (心塑 + 魔方共享):
 *   - users 表单表, 是两个前端的唯一账号锚点
 *   - phone + email 平台唯一 (跨心塑/魔方)
 *   - 业务数据 (psychology / moyin) 通过 user_id 关联, 不在 users 表里混存
 *   - status 统一字段 (active / inactive / banned), 不分前端
 */

/**
 * JWT token types — 用于 JwtService.sign() 区分 access vs refresh
 * 实际 token 解析时由 payload.type 区分
 */
export enum TokenType {
  Access = 'access',
  Refresh = 'refresh',
}

/**
 * Session 撤销原因 (审计用, V2 新增).
 */
export enum SessionRevokeReason {
  /** 用户主动登出 */
  Logout = 'logout',
  /** 用户改密 */
  PasswordChanged = 'password_changed',
  /** 用户主动撤销该设备 (多端管理 UI) */
  ManualRevoke = 'manual_revoke',
  /** 用户撤销全部其他设备 (logout-all) */
  LogoutAll = 'logout_all',
  /** 用户被管理员撤销 */
  AdminRevoke = 'admin_revoke',
  /** 自然过期 */
  Expired = 'expired',
}

/**
 * 强制重置原因 (审计用, V2 新增).
 */
export enum PasswordResetTrigger {
  /** 用户主动改密 */
  User = 'user',
  /** 周期到期强制重置 */
  CycleExpired = 'cycle_expired',
  /** 忘记密码 */
  Forgot = 'forgot',
  /** 管理员强制重置 */
  Admin = 'admin',
}