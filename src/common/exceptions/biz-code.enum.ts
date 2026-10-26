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

  // V2026-10-12 (Phase 8.1 — KB 状态机, spec §12.2):
  //   4 态状态机 (draft / review / published / archived) 非法转换,
  //   workflow.service.ts 校验, 跟 client 7.3 严格对齐.
  InvalidStateTransition = 11_006,

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

  // ====== 业务模块 (20xxx+) —「我的」Tab V2.0 二级页专用 ======
  // AI 对话历史 (26xxx)
  ChatSessionNotFound = 26_001, // 会话不存在
  ChatSessionArchived = 26_003, // 会话已归档, 不允许修改/删除
  // 心理健身 / 仪表板 (31xxx)
  DashboardRangeInvalid = 31_001, // 时间范围不合法
  DashboardDataEmpty = 31_002, // 用户暂无训练数据
  // 人生地图 (24xxx)
  LifeMapStageNotFound = 24_001, // 人生阶段不存在
  LifeMapNotInitialized = 24_002, // 心理地图未初始化
  // 具身 (25xxx)
  EmbodiedDeviceAlreadyPaired = 25_001, // 设备已绑定
  EmbodiedDeviceNotFound = 25_002, // 设备不存在
  EmbodiedSensorPermissionDenied = 25_003, // 传感器权限被用户拒绝
  // 隐私 / 数据导出 (30xxx)
  PrivacyExportInProgress = 30_001, // 导出任务进行中
  PrivacyExportEmpty = 30_002, // 导出数据为空
  PrivacyDeleteCooldown = 30_003, // 删除账号冷却中 (7 天)
  PrivacyAuthorizationNotFound = 30_004, // 授权记录不存在

  // ====== Growth 模块 (40xxx) —「成长」Tab V2026-09-14 长期方案专用 ======
  // V2026-09-14 治本 (Stage C): 跟前端 lib/features/growth/data/repositories/growth_repository_impl.dart
  //   Failure 1:1 对齐, 跟前端 AppEventBus 联动的字符串 code 字段区分
  //   (前端 entity 用 snake_case 字符串如 'GROWTH_DAILY_TOOLS_FETCH_FAIL',
  //   这里用 40xxx BizCode, HttpExceptionFilter 统一转 { code, message, data } JSON).
  GrowthDailyToolsFetchFail = 40_001, // GET /growth/daily-tools 服务端失败
  GrowthDailyToolsEmpty = 40_002, // GET /growth/daily-tools 返 0 条 (V1.0 不允许)
  GrowthDailyToolsLinkRouteNotWhitelisted = 40_003, // linkRoute 不在 §6 白名单
  GrowthWeeklyOverviewFetchFail = 40_004, // GET /growth/weekly-overview 服务端失败
  GrowthToolNotFound = 40_005, // POST /growth/tools/:id/complete 工具不存在
  GrowthCompleteFail = 40_006, // POST /growth/tools/:id/complete 写入失败
  GrowthToolSourceInvalid = 40_007, // tool_completion_source 不在 9 enum
  GrowthToolFragmentsGrantInvalid = 40_008, // fragments_grant key 不在 5 code 或 value 越界

  // ====== 微技能自由练习模块 (45xxx) — V1.3 §7 / §8 专用 ======
  //   §8.5 E2 治本: 「空库」与「无权访问」必须能被前端区分开.
  //     之前的实现对两种情况都抛 NotFoundException, 前端只能看到同一个 404,
  //     于是把"内容库还没灌 seed"显示成"你的场景被删了" —— 两种完全不同的用户沟通.
  //     现在拆成两个 code: 池空 = 409/400 级的"暂时没有可练的", 场景不存在 = 404.
  PracticeScenarioPoolEmpty = 45_001, // 可练场景池为空 (内容库未灌 seed / 全部被 exceptMode 排除)
  PracticeScenarioNotFound = 45_002, // 场景不存在 / 已停用 / 不属于本人
  PracticeTurnOutOfRange = 45_003, // 提交轮次超出场景设定的往返轮数 (§8.5 B1)
  PracticeCustomScenarioStorageFull = 45_004, // 私有场景条数达上限 (§8.5 B2)

  // ====== 语音微训练 STT 代理 (45_1xx) — V2026-10-23 spec §2.4 ======
  //   为什么要**独立**一套码, 而不是复用通用 1001/1003/1005:
  //   §2.4 要求"不同上游失败 → 前端不同文案 + 不同 HTTP 语义", 而通用码
  //   (InvalidParameter / RateLimited / ThirdPartyError) 只能表达"失败了",
  //   表达不了"是**音频本身**不合格 (400/413/422) 还是"**上游**不可用" (502/504).
  //   前端据此分流: 音频不合格 → 引导重录; 上游不可用 → 引导稍后重试.
  PracticeAsrAudioInvalid = 45_101, // 音频格式/时长不支持 (上游 400 + 本地预检)
  PracticeAsrAudioTooLarge = 45_102, // 音频超 50MB (上游 413 + 本地预检)
  PracticeAsrNoSpeechDetected = 45_103, // 未识别到有效语音 (上游 422; 不回显敏感细节)
  PracticeAsrUpstreamUnavailable = 45_104, // 上游不可用 (上游 401/402/5xx + 网络故障)
  PracticeAsrUpstreamRateLimited = 45_105, // 上游限流 (上游 429)
  PracticeAsrTimeout = 45_106, // 上游转写超时 (本地 AbortSignal 超时)

  // ====== 首页金句模块 (46xxx) — 「每日一句」后端接口 ======
  //   §4 零压红线: 「不下发、不展示全站 likeCount」—— 错误码同理不应带出任何
  //   「有多少人收藏了这类内容」的信息, 只描述**当前用户自己的操作**是否成立.
  QuoteLibraryEmpty = 46_001, // 金句内容库为空 (未跑 seed:quotes; 前端回退本地种子)
  QuoteNotFound = 46_002, // 金句不存在 / 已下架
  QuoteCursorInvalid = 46_003, // 金句流游标无效或已失效

  // ====== AI 模拟来访池模块 (47xxx) — 公共模板 + 克隆实例化 ======
  //   §4 零压红线: 「不下发、不统计全站收藏数 / 使用数」—— 错误码同理不应带出
  //   「有多少人用了这个人设」的信息, 只描述**当前用户自己的操作**是否成立.
  VisitorPoolTemplateNotFound = 47_001, // 公共模板不存在 / 已下架 / 已软删
  VisitorPoolCursorInvalid = 47_002, // 图鉴游标无效或已失效
  VisitorPoolGenerationFailed = 47_003, // 内部 AI 生成失败 (结构校验不过 / LLM 不可用)
  VisitorPoolForbidden = 47_004, // 无内部管理权限 (普通用户访问生成/管理端点)
  VisitorPoolLibraryEmpty = 47_005, // 公共模板库为空 (未跑 seed:visitor-pool; 前端回退本地种子)

  // ====== 官方音色目录模块 (48xxx) — V2026-10-26 spec §任务 2 ======
  //   为什么要**独立**一套码, 而不是复用通用 1001/1003/1005:
  //     §任务 2 要求「上游 1004 鉴权失败 / 1008 余额不足 → 502 + 可读 message,
  //     前端隐藏或置灰选择器, **不崩溃**」. 通用码 (ThirdPartyError) 只能表达
  //     "失败了", 表达不了"是**我们的** key 失效了"与"是**额度**用完了"——
  //     这两种对运维是完全不同的处置动作 (换 key vs 充值), 前端也要给不同提示.
  VoiceCatalogUpstreamUnavailable = 48_001, // 上游不可用 (1004 鉴权失败 / 5xx / 网络故障)
  VoiceCatalogUpstreamRateLimited = 48_002, // 上游限流 (1002 / 429)
  VoiceCatalogUpstreamTimeout = 48_003, // 上游超时 (本地 AbortSignal 超时)
  VoiceCatalogEmpty = 48_004, // 上游返回空列表 (目录尚未就绪 / 响应异常)
  VoiceCatalogUpstreamNoBalance = 48_005, // 上游余额不足 (1008 / 402)
}
