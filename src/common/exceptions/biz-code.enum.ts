/**
 * 业务错误码 (大厂标准).
 *
 * 设计原则:
 *   - 不依赖 HTTP status code (HTTP 4xx/5xx 是协议层, 业务码是应用层)
 *   - 前端根据 code 判断错误类型, 不解析 message (message 可能 i18n)
 *   - code = 0 表示成功 (跟 HTTP 200 解耦, 让前端统一处理)
 *   - 错误码分段: 通用 (1xxx) / 用户 (10xxx) / 鉴权 (11xxx) / 业务 (20xxx+)
 *
 * 用法:
 *   throw new BizException(BizCode.UserNotFound);
 */
export enum BizCode {
  // ====== 通用 (1xxx) ======
  Success = 0,
  UnknownError = 1000,
  InvalidParameter = 1001,
  ResourceNotFound = 1002,
  RateLimited = 1003,
  ServiceUnavailable = 1004,
  ThirdPartyError = 1005,
  Forbidden = 1006,

  // ====== 用户模块 (10xxx) ======
  UserNotFound = 10001,
  UserAlreadyExists = 10002,
  UserBanned = 10003,
  InvalidPhone = 10004,
  InvalidEmail = 10005,
  WeakPassword = 10006,
  PasswordReused = 10007,
  PasswordExpired = 10008,
  AccountLocked = 10009,
  EmailAlreadyVerified = 10010,
  PhoneAlreadyVerified = 10011,
  EmailNotVerified = 10012,

  // ====== 鉴权模块 (11xxx) ======
  Unauthorized = 11001,
  InvalidCredentials = 11002,
  TokenExpired = 11003,
  TokenRevoked = 11004,
  TokenInvalid = 11005,

  // ====== 验证码 (12xxx) ======
  VerificationCodeInvalid = 12001,
  VerificationCodeExpired = 12002,
  VerificationCodeRateLimited = 12003,

  // ====== OAuth (13xxx) ======
  OAuthProviderError = 13001,
  OAuthAccountAlreadyLinked = 13002,
  OAuthAccountNotLinked = 13003,
  OAuthInvalidState = 13004,
}