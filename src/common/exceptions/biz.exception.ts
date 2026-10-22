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
  // V2026-10-12 治本 (Phase 8.1 — KB workflow 校验):
  //   BizException 加 public readonly code 字段, 让 caller (scheduled-publish.processor.ts
  //   等) 能用 `e.code === BizCode.X` 判定具体业务错 (不只是 HTTP 4xx). 治本前
  //   processor 用 instanceof + getStatus() 拿 HTTP, 不能区分 Forbidden vs InvalidState.
  public readonly code: BizCode;

  constructor(code: BizCode, message?: string) {
    const httpStatus = mapBizCodeToHttpStatus(code);
    super({ code, message: message ?? getBizCodeDefaultMessage(code) }, httpStatus);
    this.code = code;
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
    case BizCode.PracticeScenarioNotFound:
    case BizCode.QuoteNotFound:
    case BizCode.QuoteLibraryEmpty:
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

    // V2026-10-12 (Phase 8.1 — KB 状态机, spec §12.2):
    //   跟 8.1 workflow.service.ts assertTransition 抛错场景对齐, 文案跟
    //   client 7.3 canXxx false 时的 UI 提示一致: "此操作不被当前状态允许".
    [BizCode.InvalidStateTransition]: '此操作不被当前状态允许',

    [BizCode.VerificationCodeInvalid]: '验证码不正确',
    [BizCode.VerificationCodeExpired]: '验证码已过期',
    [BizCode.VerificationCodeRateLimited]: '验证码请求过于频繁',

    [BizCode.OAuthProviderError]: '第三方登录失败',
    [BizCode.OAuthAccountAlreadyLinked]: '该第三方账号已绑定其他用户',
    [BizCode.OAuthAccountNotLinked]: '该第三方账号未绑定',
    [BizCode.OAuthInvalidState]: 'OAuth 状态校验失败',

    [BizCode.ConsentVersionInvalid]: '协议版本号格式不正确 (需 vX.Y 格式)',
    [BizCode.ConsentDeviceIdInvalid]: '设备指纹格式不正确',
    [BizCode.ConsentPlatformUnsupported]: '平台不在支持列表',
    [BizCode.ConsentRateLimited]: '同意记录请求过于频繁, 请稍后再试',

    // V2026-08-28 —「我的」Tab V2.0 4 个新页面专用
    [BizCode.ChatSessionNotFound]: '对话不存在或不属于你',
    [BizCode.ChatSessionArchived]: '已归档的会话不允许修改或删除',
    [BizCode.DashboardRangeInvalid]: '时间范围不合法',
    [BizCode.DashboardDataEmpty]: '暂无训练数据',
    [BizCode.LifeMapStageNotFound]: '人生阶段不存在',
    [BizCode.LifeMapNotInitialized]: '心理地图未初始化, 请先完成基础梳理',
    [BizCode.EmbodiedDeviceAlreadyPaired]: '该类型设备已绑定',
    [BizCode.EmbodiedDeviceNotFound]: '设备不存在或不属于你',
    [BizCode.EmbodiedSensorPermissionDenied]: '传感器权限已被拒绝',
    [BizCode.PrivacyExportInProgress]: '数据导出任务进行中, 请稍后查询',
    [BizCode.PrivacyExportEmpty]: '没有可导出的数据',
    [BizCode.PrivacyDeleteCooldown]: '账号删除冷却中 (7 天), 请冷静期后重试',
    [BizCode.PrivacyAuthorizationNotFound]: '授权记录不存在',

    // V2026-10-22 (V1.3 §7 / §8 — 微技能自由练习):
    //   §8.5 E2: 空池与无权访问要能被前端分开处理, 文案也要分开.
    [BizCode.PracticeScenarioPoolEmpty]: '暂无可练习的场景 (内容库为空或已被全部排除)',
    [BizCode.PracticeScenarioNotFound]: '练习场景不存在或不可用',
    [BizCode.PracticeTurnOutOfRange]: '提交轮次超出该场景设定的往返轮数',
    [BizCode.PracticeCustomScenarioStorageFull]: '我的真实场景已达条数上限',

    // V2026-10-22 (首页金句 · 每日一句):
    //   QuoteLibraryEmpty 走 404: 内容库没灌 seed 是"服务端还没准备好",
    //   前端据此回退本地种子 (spec §4「不得白屏或报错」), 不是用户的错.
    [BizCode.QuoteLibraryEmpty]: '金句内容库为空',
    [BizCode.QuoteNotFound]: '金句不存在或已下架',
    [BizCode.QuoteCursorInvalid]: '分页游标无效或已失效',

    // V2026-09-14 长期方案 Stage C: Growth 模块 8 个错误码默认文案
    [BizCode.GrowthDailyToolsFetchFail]: '今日推荐工具拉取失败',
    [BizCode.GrowthDailyToolsEmpty]: '今日推荐工具为空 (V1.0 必返 3 条)',
    [BizCode.GrowthDailyToolsLinkRouteNotWhitelisted]: 'linkRoute 不在白名单',
    [BizCode.GrowthWeeklyOverviewFetchFail]: '本周成长概览拉取失败',
    [BizCode.GrowthToolNotFound]: '工具不存在或不在今日推荐列表',
    [BizCode.GrowthCompleteFail]: '工具完成写入失败',
    [BizCode.GrowthToolSourceInvalid]: 'tool_completion_source 不在 9 source enum',
    [BizCode.GrowthToolFragmentsGrantInvalid]: 'fragments_grant key/value 不合规',
  };
  return messages[code] ?? '错误';
}
