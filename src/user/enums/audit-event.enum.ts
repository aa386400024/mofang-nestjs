// V2026-11-14 治本 (TD-15 · C+ 枚举外移 · P-DEBT-11 / L-1):
//   用户鉴权事件枚举 —— 从 `entities/audit-log.entity.ts` 外移.
//
//   治本:
//     - 枚举原先定义在 entity 文件里, 任何**值位置**导入它的代码 (user.service /
//       audit-log.service / soft-delete.cron / audit-log.processor / 三个 spec)
//       都会把 entity 文件拉进模块加载期 → 顶层 @Entity / @Column 装饰器求值 →
//       typeorm 经**传递**闭包进入.
//       移到零 typeorm 依赖的独立文件后, 这条边即解除.
//     - 本文件**零** typeorm / @nestjs/typeorm 依赖, 不引用任何 entity 类,
//       无装饰器 / 无 Nest / 无 process.env / 无网络 —— 纯枚举定义.
//     - 枚举成员名与字符串值**逐字不变** (合规审计口径零漂移).
//
//   反双胞胎:
//     - 不把审计事件枚举跟 `BizCode` / `AuditLog` entity 焊在一起 —— 审计事件串是
//       落库的合规口径, 独立文件才好让 spec / 报表复用而不拖动 entity.
//
//   如何验证:
//     1. tsc 0 错; 全量测试用例数与既有断言逐字不变;
//     2. grep 复核: 本文件 typeorm import = 0; 原 `entities/` 路径下的枚举 import 残留 = 0.
//
//   时间戳: 2026-11-14 GMT+8

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
  // V2026-11-02 (已登录态首次设密码): 与"改密"分开记 —— 首次设置 (无密码 → 有密码)
  //   跟 修改 (有密码 → 新密码) 是两件事, 审计上必须能分开看.
  UserPasswordFirstSet = 'user_password_first_set',
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
