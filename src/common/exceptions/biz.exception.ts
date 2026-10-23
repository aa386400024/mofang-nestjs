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

const RATE_LIMITED_CODES: ReadonlySet<BizCode> = new Set([BizCode.RateLimited, BizCode.VerificationCodeRateLimited]);

const LOCKED_CODES: ReadonlySet<BizCode> = new Set([BizCode.AccountLocked]);

const FORBIDDEN_CODES: ReadonlySet<BizCode> = new Set([BizCode.Forbidden, BizCode.VisitorPoolForbidden]);

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
