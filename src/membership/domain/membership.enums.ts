/**
 * 会员体系 v2 领域枚举 — 与 wire 字符串 1:1，禁止在业务层散落裸字符串。
 *
 * 四档：Free / Plus / Pro / Max。加包不是档位，不进入 tier。
 */
export enum MembershipTier {
  Free = 'free',
  Plus = 'plus',
  Pro = 'pro',
  Max = 'max',
}

/**
 * 订阅状态机：active 可用；grace 扣款失败宽限；paused 用户暂停；expired 到期；refunded 已退款。
 * inactive 保留给从未开通的账号。
 */
export enum MembershipStatus {
  Inactive = 'inactive',
  Active = 'active',
  Trial = 'trial',
  Grace = 'grace',
  Paused = 'paused',
  Expired = 'expired',
  Refunded = 'refunded',
}

/** 会员账号来源：order 付费订单；migration 旧数据迁移；system 系统发放；promotion 活动。 */
export enum MembershipSource {
  System = 'system',
  Order = 'order',
  Migration = 'migration',
  Promotion = 'promotion',
}

/** 配额 lot 来源。扣减顺序：plan → promotion → addon → migration。 */
export enum QuotaLotSource {
  Plan = 'plan',
  Promotion = 'promotion',
  Addon = 'addon',
  Migration = 'migration',
}

/** 计费周期。 */
export enum BillingPeriod {
  Monthly = 'monthly',
  Annual = 'annual',
}

/** 订单类型。 */
export enum MembershipOrderType {
  Subscription = 'subscription',
  Addon = 'addon',
}

/** 订单状态。 */
export enum MembershipOrderStatus {
  Pending = 'pending',
  Paid = 'paid',
  Failed = 'failed',
  Refunded = 'refunded',
  Closed = 'closed',
}

/** 支付通道。真实通道未接时统一落 reserved，不伪造 paid。 */
export enum PaymentChannel {
  Wechat = 'wechat',
  Alipay = 'alipay',
  AppleIap = 'apple_iap',
  Reserved = 'reserved',
}

/** 权益编码。前端只按编码映射展示，不自行推断档位。 */
export enum MembershipFeature {
  BasicAssessment = 'basic_assessment',
  GrowthArchive = 'growth_archive',
  Cbt = 'cbt',
  PersonCentered = 'person_centered',
  BasicRolePool = 'basic_role_pool',
  AllSchools = 'all_schools',
  AllRolePool = 'all_role_pool',
  AdvancedReport = 'advanced_report',
  PrioritySupport = 'priority_support',
  DataExport = 'data_export',
  DedicatedSupport = 'dedicated_support',
  MaxTextQuota = 'max_text_quota',
  HdTts = 'hd_tts',
  SupervisionDiscount = 'supervision_discount',
}

/** TTS 模型分层。Free/Plus 用 turbo，Pro/Max 用 hd。 */
export enum TtsModel {
  Turbo = 'turbo',
  Hd = 'hd',
}
