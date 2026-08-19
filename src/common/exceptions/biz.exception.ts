import { HttpException, HttpStatus } from '@nestjs/common';

import { BizCode } from './biz-code.enum';

/**
 * 业务异常类 (大厂标准).
 *
 * 跟 NestJS 内置 HttpException 区别:
 *   - HttpException 用 HTTP status code (4xx/5xx), 是协议层
 *   - BizException 用业务错误码 (BizCode enum), 是应用层
 *   - 一个 BizException 自动映射到合适 HTTP status:
 *     - BizCode.UserNotFound → 404
 *     - BizCode.UserAlreadyExists → 409
 *     - BizCode.Unauthorized/InvalidCredentials/TokenExpired → 401
 *     - BizCode.RateLimited → 429
 *     - BizCode.AccountLocked → 423
 *     - 其他 → 400
 *
 * 用法:
 *   throw new BizException(BizCode.UserNotFound);
 *   throw new BizException(BizCode.UserNotFound, '用户不存在');
 */
export class BizException extends HttpException {
  constructor(code: BizCode, message?: string) {
    const httpStatus = mapBizCodeToHttpStatus(code);
    super({ code, message: message ?? getBizCodeDefaultMessage(code) }, httpStatus);
  }
}

/**
 * BizCode 默认 HTTP status 映射.
 * 大厂做法: 业务错误码 → HTTP status 是协议层关注点, 集中映射.
 */
function mapBizCodeToHttpStatus(code: BizCode): HttpStatus {
  switch (code) {
    case BizCode.ResourceNotFound:
    case BizCode.UserNotFound:
      return HttpStatus.NOT_FOUND;
    case BizCode.UserAlreadyExists:
    case BizCode.EmailAlreadyVerified:
    case BizCode.PhoneAlreadyVerified:
    case BizCode.OAuthAccountAlreadyLinked:
      return HttpStatus.CONFLICT;
    case BizCode.Unauthorized:
    case BizCode.InvalidCredentials:
    case BizCode.TokenExpired:
    case BizCode.TokenRevoked:
    case BizCode.TokenInvalid:
      return HttpStatus.UNAUTHORIZED;
    case BizCode.RateLimited:
    case BizCode.VerificationCodeRateLimited:
      return HttpStatus.TOO_MANY_REQUESTS;
    case BizCode.AccountLocked:
      return HttpStatus.LOCKED;
    case BizCode.ServiceUnavailable:
      return HttpStatus.SERVICE_UNAVAILABLE;
    case BizCode.Forbidden:
      return HttpStatus.FORBIDDEN;
    default:
      return HttpStatus.BAD_REQUEST;
  }
}

/**
 * BizCode 默认文案 (中文 fallback).
 * V2 抽到 i18n, 跟 i18n key 绑定.
 */
function getBizCodeDefaultMessage(code: BizCode): string {
  const messages: Record<BizCode, string> = {
    [BizCode.Success]: '成功',
    [BizCode.UnknownError]: '未知错误',
    [BizCode.InvalidParameter]: '参数错误',
    [BizCode.ResourceNotFound]: '资源不存在',
    [BizCode.RateLimited]: '请求过于频繁, 请稍后再试',
    [BizCode.ServiceUnavailable]: '服务暂不可用',
    [BizCode.ThirdPartyError]: '第三方服务错误',
    [BizCode.Forbidden]: '禁止访问',

    [BizCode.UserNotFound]: '用户不存在',
    [BizCode.UserAlreadyExists]: '用户已存在',
    [BizCode.UserBanned]: '账号已被禁用',
    [BizCode.InvalidPhone]: '手机号格式不正确',
    [BizCode.InvalidEmail]: '邮箱格式不正确',
    [BizCode.WeakPassword]: '密码强度不足',
    [BizCode.PasswordReused]: '密码与最近使用过的密码重复',
    [BizCode.PasswordExpired]: '密码已过期, 请重置密码',
    [BizCode.AccountLocked]: '账号已锁定, 请稍后再试',
    [BizCode.EmailAlreadyVerified]: '邮箱已验证',
    [BizCode.PhoneAlreadyVerified]: '手机号已验证',
    [BizCode.EmailNotVerified]: '邮箱未验证',

    [BizCode.Unauthorized]: '未授权',
    [BizCode.InvalidCredentials]: '手机号或密码错误',
    [BizCode.TokenExpired]: 'token 已过期',
    [BizCode.TokenRevoked]: 'token 已被撤销',
    [BizCode.TokenInvalid]: 'token 无效',

    [BizCode.VerificationCodeInvalid]: '验证码不正确',
    [BizCode.VerificationCodeExpired]: '验证码已过期',
    [BizCode.VerificationCodeRateLimited]: '验证码请求过于频繁',

    [BizCode.OAuthProviderError]: '第三方登录失败',
    [BizCode.OAuthAccountAlreadyLinked]: '该第三方账号已绑定其他用户',
    [BizCode.OAuthAccountNotLinked]: '该第三方账号未绑定',
    [BizCode.OAuthInvalidState]: 'OAuth 状态校验失败',
  };
  return messages[code] ?? '错误';
}