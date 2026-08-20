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
  UserNotFound = 10_001,
  UserAlreadyExists = 10_002,
  UserBanned = 10_003,
  InvalidPhone = 10_004,
  InvalidEmail = 10_005,
  WeakPassword = 10_006,
  PasswordReused = 10_007,
  PasswordExpired = 10_008,
  AccountLocked = 10_009,
  EmailAlreadyVerified = 10_010,
  PhoneAlreadyVerified = 10_011,
  EmailNotVerified = 10_012,

  // ====== 鉴权模块 (11xxx) ======
  Unauthorized = 11_001,
  InvalidCredentials = 11_002,
  TokenExpired = 11_003,
  TokenRevoked = 11_004,
  TokenInvalid = 11_005,

  // ====== 验证码 (12xxx) ======
  VerificationCodeInvalid = 12_001,
  VerificationCodeExpired = 12_002,
  VerificationCodeRateLimited = 12_003,

  // ====== OAuth (13xxx) ======
  // eslint-disable-next-line @typescript-eslint/naming-convention
  OAuthProviderError = 13_001,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  OAuthAccountAlreadyLinked = 13_002,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  OAuthAccountNotLinked = 13_003,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  OAuthInvalidState = 13_004,

  // ====== 合规模块 / Consent (14xxx) ======

  ConsentVersionInvalid = 14_001, // 协议版本号格式不符 (e.g. 不是 vX.Y)

  ConsentDeviceIdInvalid = 14_002, // 设备指纹格式不符

  ConsentPlatformUnsupported = 14_003, // 平台不在白名单

  ConsentRateLimited = 14_004, // consent 记录接口被限流 (防御性)
}
