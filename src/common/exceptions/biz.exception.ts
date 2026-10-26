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
 * 业务错误码 → HTTP status 的分组表.
 *
 * V2026-10-23 治本 (AI 模拟来访池 — mapBizCodeToHttpStatus 复杂度 23 → 5):
 *   原因: 映射表用 switch 写, 每加一个业务码就多一个 case. 这次新增来访池的 5 个码
 *     (含 2 个 404 / 1 个 403) 后, ESLint complexity 报 23 (上限 20) —— 超限 3 个码.
 *     继续加码只会更糟, 且 switch 的 case 数**没有上限护栏**.
 *   修法: 改成分组 Set + if 链: 每个 HTTP status 一个 Set, 新增业务码 = 往对应 Set 里
 *     加一行. 复杂度与业务码数量**解耦** (恒等于 status 分组数), 再加 50 个码也不超限.
 *   反双胞胎: 不用 eslint-disable 压复杂度 —— 那是把味道藏起来, 下一个新增码又会超;
 *     也不用「把 switch 拆成几个函数」—— 同样的 case 总数, 只是换了个地方, 复杂度没降.
 *   验证: 1. lint 0 错  2. 每个 status 分组内的码行为完全不变 (逐码对表)
 *   时间戳: 2026-10-23
 */
const NOT_FOUND_CODES: ReadonlySet<BizCode> = new Set([
  BizCode.ResourceNotFound,
  BizCode.UserNotFound,
  BizCode.PracticeScenarioNotFound,
  BizCode.QuoteNotFound,
  BizCode.QuoteLibraryEmpty,
  BizCode.VisitorPoolTemplateNotFound,
  BizCode.VisitorPoolLibraryEmpty,
  // V2026-10-24 治本 (growth 业务码归位 HTTP 语义):
  //   工具不存在 = 资源不存在 → 404 (之前没归组, 落到默认分支 400).
  //   后果: 前端拿到 400 会提示“参数错了”, 而真实语义是“这个工具 id 不存在” → 用户看不出该换哪个.
  BizCode.GrowthToolNotFound,
]);

const CONFLICT_CODES: ReadonlySet<BizCode> = new Set([
  BizCode.UserAlreadyExists,
  BizCode.EmailAlreadyVerified,
  BizCode.PhoneAlreadyVerified,
  BizCode.OAuthAccountAlreadyLinked,
]);

const UNAUTHORIZED_CODES: ReadonlySet<BizCode> = new Set([
  BizCode.Unauthorized,
  BizCode.InvalidCredentials,
  BizCode.TokenExpired,
  BizCode.TokenRevoked,
  BizCode.TokenInvalid,
]);

// V2026-10-23 治本 (STT 上游 429 必须真的是 429):
//   原因: 上游 429 (rate_limit_error) 的语义是"可重试的限流", HTTP 语义必须是 429,
//     前端据此决定"稍等几秒自动重试"还是"提示用户稍后再来". 漏挂进这个分组的话,
//     它会落到默认分支 → 400, 前端把限流当成"参数错了", 于是既不重试也不提示, 用户只
//     看到一句莫名其妙的话.
//   修法: 把 STT 的上游限流码并进 RATE_LIMITED_CODES (与全局 RateLimited 同一语义).
const RATE_LIMITED_CODES: ReadonlySet<BizCode> = new Set([
  BizCode.RateLimited,
  BizCode.VerificationCodeRateLimited,
  BizCode.PracticeAsrUpstreamRateLimited,
]);

const LOCKED_CODES: ReadonlySet<BizCode> = new Set([BizCode.AccountLocked]);

const FORBIDDEN_CODES: ReadonlySet<BizCode> = new Set([BizCode.Forbidden, BizCode.VisitorPoolForbidden]);

// V2026-10-23 治本 (语音微训练 STT 代理 — 上游错误要映射成不同的 HTTP 语义):
//   原因: spec §2.4 把上游 8 类错误分成两组 —— "音频不合格" (400/413/422, 用户重录
//     能解决) 与 "上游不可用" (502/504, 用户等一下就行). 这两组若都落到默认 400,
//     前端就没法分流, 用户会被反复引导去"重录一段" —— 而真因是上游挂了, 重录一万次
//     也没用. 治本: 显式建 4 个 status 分组, 语义边界写进代码而不是靠调用方记忆.
//   反双胞胎: 不为这 4 个 status 单独开一个 switch (复杂度会随业务码数量线性增长,
//     上一次治本刚把 mapBizCodeToHttpStatus 的 switch 拆成 Set 分组, 不走回头路).
const PAYLOAD_TOO_LARGE_CODES: ReadonlySet<BizCode> = new Set([BizCode.PracticeAsrAudioTooLarge]);

const UNPROCESSABLE_CODES: ReadonlySet<BizCode> = new Set([
  BizCode.PracticeAsrNoSpeechDetected,
  // V2026-10-24 治本 (growth 业务码归位 HTTP 语义):
  //   “今日推荐工具为空 / linkRoute 不在白名单” = 服务端算出来的结果不合规 → 422.
  //   之前落到默认 400 (“你的请求有问题”), 而请求本身没问题 → 前端会引导用户去改请求, 改不了.
  BizCode.GrowthDailyToolsEmpty,
  BizCode.GrowthDailyToolsLinkRouteNotWhitelisted,
]);

/**
 * V2026-10-24 治本 (growth 业务码归位 HTTP 语义 — 新增 500 组):
 *   原因: growth 三个“服务端自己挂了”的码 (取工具失败 / 取周报失败 / 写入完成失败)
 *     之前不在任何分组里 → 全部落到默认分支 400.
 *     后果: 前端拿到 400 会当成“参数错了”提示用户重填, 而真实情况是服务端故障 →
 *     用户反复重试无意义, 监控里 4xx 指标也会被污染 (真正的服务端故障没进 5xx).
 *   修法: 显式归入 500 组.
 *   反双胞胎: 不把这三个码当成 4xx 糊弄过去 —— 400 与 500 的前端行为完全不同.
 */
const INTERNAL_ERROR_CODES: ReadonlySet<BizCode> = new Set([
  BizCode.GrowthDailyToolsFetchFail,
  BizCode.GrowthWeeklyOverviewFetchFail,
  BizCode.GrowthCompleteFail,
]);

const BAD_GATEWAY_CODES: ReadonlySet<BizCode> = new Set([BizCode.PracticeAsrUpstreamUnavailable]);

const GATEWAY_TIMEOUT_CODES: ReadonlySet<BizCode> = new Set([BizCode.PracticeAsrTimeout]);

/**
 * BizCode 默认 HTTP status 映射.
 * 大厂做法: 业务错误码 → HTTP status 是协议层关注点, 集中映射.
 */
function mapBizCodeToHttpStatus(code: BizCode): HttpStatus {
  if (NOT_FOUND_CODES.has(code)) {
    return HttpStatus.NOT_FOUND;
  }
  if (CONFLICT_CODES.has(code)) {
    return HttpStatus.CONFLICT;
  }
  if (UNAUTHORIZED_CODES.has(code)) {
    return HttpStatus.UNAUTHORIZED;
  }
  if (RATE_LIMITED_CODES.has(code)) {
    return HttpStatus.TOO_MANY_REQUESTS;
  }
  if (LOCKED_CODES.has(code)) {
    return HttpStatus.LOCKED;
  }
  if (FORBIDDEN_CODES.has(code)) {
    return HttpStatus.FORBIDDEN;
  }
  if (PAYLOAD_TOO_LARGE_CODES.has(code)) {
    return HttpStatus.PAYLOAD_TOO_LARGE;
  }
  if (UNPROCESSABLE_CODES.has(code)) {
    return HttpStatus.UNPROCESSABLE_ENTITY;
  }
  if (INTERNAL_ERROR_CODES.has(code)) {
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }
  if (BAD_GATEWAY_CODES.has(code)) {
    return HttpStatus.BAD_GATEWAY;
  }
  if (GATEWAY_TIMEOUT_CODES.has(code)) {
    return HttpStatus.GATEWAY_TIMEOUT;
  }
  if (code === BizCode.ServiceUnavailable) {
    return HttpStatus.SERVICE_UNAVAILABLE;
  }
  return HttpStatus.BAD_REQUEST;
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

    // V2026-10-23 (语音微训练 STT 代理 — spec §2.4):
    //   文案统一给"用户下一步能做什么", 不回显上游原始 message (可能含内部错误码).
    [BizCode.PracticeAsrAudioInvalid]: '音频格式或时长不支持，请重新录一段',
    [BizCode.PracticeAsrAudioTooLarge]: '音频过大，请缩短后重试',
    [BizCode.PracticeAsrNoSpeechDetected]: '未识别到有效语音，请再试一次',
    [BizCode.PracticeAsrUpstreamUnavailable]: '转写服务暂不可用，稍后再试',
    [BizCode.PracticeAsrUpstreamRateLimited]: '太频繁了，稍等几秒再试',
    [BizCode.PracticeAsrTimeout]: '转写超时了，稍后再试',

    // V2026-10-22 (首页金句 · 每日一句):
    //   QuoteLibraryEmpty 走 404: 内容库没灌 seed 是"服务端还没准备好",
    //   前端据此回退本地种子 (spec §4「不得白屏或报错」), 不是用户的错.
    [BizCode.QuoteLibraryEmpty]: '金句内容库为空',
    [BizCode.QuoteNotFound]: '金句不存在或已下架',
    [BizCode.QuoteCursorInvalid]: '分页游标无效或已失效',

    // V2026-10-23 (AI 模拟来访池 — 公共模板 + 克隆实例化):
    //   404 口径跟金句一致: 模板不存在/已下架是"这个人物暂不可用",
    //   库为空是"服务端还没准备好", 两者要能被前端分开处理.
    [BizCode.VisitorPoolTemplateNotFound]: '该来访人物暂不可用',
    [BizCode.VisitorPoolCursorInvalid]: '分页游标无效或已失效',
    [BizCode.VisitorPoolGenerationFailed]: '来访人物生成失败',
    [BizCode.VisitorPoolForbidden]: '无权访问来访池管理能力',
    [BizCode.VisitorPoolLibraryEmpty]: '来访人物内容库为空',

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
