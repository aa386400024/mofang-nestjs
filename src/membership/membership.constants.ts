import {
  BillingPeriod,
  MembershipFeature,
  MembershipPromotionAudience,
  MembershipPromotionStatus,
  MembershipTier,
  PaymentChannel,
  QuotaLotSource,
  TtsModel,
} from './domain/membership.enums.js';
import type {
  MembershipAddonDefinition,
  MembershipEntitlement,
  MembershipPlanDefinition,
  PromotionDecision,
} from './domain/membership.types.js';

/**
 * 会员体系 v2 唯一数值真相源。
 *
 * 任何价格、分钟、权益、底价都从这里读；前端展示、订单、活动、测试不得另抄一份。
 * 单位：价格一律整数分；分钟一律整数分钟。
 */
export const MEMBERSHIP_PLANS: Readonly<Record<MembershipTier, MembershipPlanDefinition>> = {
  [MembershipTier.Free]: {
    id: MembershipTier.Free,
    name: 'Free',
    description: '免费版：基础快评与每月体验时长',
    isPaid: false,
    listPriceCents: 0,
    promoPriceCents: 0,
    renewalPriceCents: 0,
    annualPriceCents: 0,
    annualPromoPriceCents: 0,
    floorPriceCents: 0,
    annualFloorPriceCents: 0,
    monthlyMinutes: 30,
    newUserBonusMinutes: 50,
    ttsModel: TtsModel.Turbo,
    concurrentSessions: 1,
    textDailyLimit: 20,
    features: [MembershipFeature.BasicAssessment],
  },
  [MembershipTier.Plus]: {
    id: MembershipTier.Plus,
    name: 'Plus',
    description: '成长版：成长档案 + 基础流派与角色池',
    isPaid: true,
    listPriceCents: 18_800,
    promoPriceCents: 6800,
    renewalPriceCents: 8800,
    annualPriceCents: 88_000,
    annualPromoPriceCents: 68_000,
    floorPriceCents: 6800,
    annualFloorPriceCents: 68_000,
    monthlyMinutes: 240,
    newUserBonusMinutes: 0,
    ttsModel: TtsModel.Turbo,
    concurrentSessions: 1,
    textDailyLimit: 60,
    features: [
      MembershipFeature.BasicAssessment,
      MembershipFeature.GrowthArchive,
      MembershipFeature.Cbt,
      MembershipFeature.PersonCentered,
      MembershipFeature.BasicRolePool,
    ],
  },
  [MembershipTier.Pro]: {
    id: MembershipTier.Pro,
    name: 'Pro',
    description: '专业版：全流派 + 全角色池 + 高级报告',
    isPaid: true,
    listPriceCents: 36_800,
    promoPriceCents: 16_800,
    renewalPriceCents: 18_800,
    annualPriceCents: 188_000,
    annualPromoPriceCents: 168_000,
    floorPriceCents: 16_800,
    annualFloorPriceCents: 168_000,
    monthlyMinutes: 500,
    newUserBonusMinutes: 0,
    ttsModel: TtsModel.Hd,
    concurrentSessions: 1,
    textDailyLimit: 150,
    features: [
      MembershipFeature.BasicAssessment,
      MembershipFeature.GrowthArchive,
      MembershipFeature.Cbt,
      MembershipFeature.PersonCentered,
      MembershipFeature.BasicRolePool,
      MembershipFeature.AllSchools,
      MembershipFeature.AllRolePool,
      MembershipFeature.AdvancedReport,
      MembershipFeature.PrioritySupport,
      MembershipFeature.HdTts,
      MembershipFeature.SupervisionDiscount,
    ],
  },
  [MembershipTier.Max]: {
    id: MembershipTier.Max,
    name: 'Max',
    description: '旗舰版：最高时长 + 数据导出 + 专属客服',
    isPaid: true,
    listPriceCents: 68_800,
    promoPriceCents: 32_800,
    renewalPriceCents: 36_800,
    annualPriceCents: 368_000,
    annualPromoPriceCents: 328_000,
    floorPriceCents: 32_800,
    annualFloorPriceCents: 328_000,
    monthlyMinutes: 1000,
    newUserBonusMinutes: 0,
    ttsModel: TtsModel.Hd,
    concurrentSessions: 1,
    textDailyLimit: 400,
    features: [
      MembershipFeature.BasicAssessment,
      MembershipFeature.GrowthArchive,
      MembershipFeature.Cbt,
      MembershipFeature.PersonCentered,
      MembershipFeature.BasicRolePool,
      MembershipFeature.AllSchools,
      MembershipFeature.AllRolePool,
      MembershipFeature.AdvancedReport,
      MembershipFeature.PrioritySupport,
      MembershipFeature.HdTts,
      MembershipFeature.SupervisionDiscount,
      MembershipFeature.DataExport,
      MembershipFeature.DedicatedSupport,
      MembershipFeature.MaxTextQuota,
    ],
  },
};

export const MEMBERSHIP_ADDONS: readonly MembershipAddonDefinition[] = [
  {
    id: 'addon_100',
    name: '100 分钟加包',
    description: '100 分钟，12 个月有效',
    priceCents: 3000,
    minutes: 100,
    validMonths: 12,
  },
  {
    id: 'addon_300',
    name: '300 分钟加包',
    description: '300 分钟，12 个月有效',
    priceCents: 8800,
    minutes: 300,
    validMonths: 12,
  },
  {
    id: 'addon_500',
    name: '500 分钟加包',
    description: '500 分钟，12 个月有效',
    priceCents: 13_800,
    minutes: 500,
    validMonths: 12,
  },
] as const;

/** 权益目录：标题/说明/最低档位。 */
export const MEMBERSHIP_FEATURE_CATALOG: Readonly<
  Record<MembershipFeature, { readonly title: string; readonly description: string; readonly minTier: MembershipTier }>
> = {
  [MembershipFeature.BasicAssessment]: {
    title: '基础快评',
    description: '每场训练结束后的规则快评',
    minTier: MembershipTier.Free,
  },
  [MembershipFeature.GrowthArchive]: {
    title: '成长档案',
    description: '长期成长档案与阶段趋势',
    minTier: MembershipTier.Plus,
  },
  [MembershipFeature.Cbt]: {
    title: 'CBT 流派',
    description: '认知行为取向训练',
    minTier: MembershipTier.Plus,
  },
  [MembershipFeature.PersonCentered]: {
    title: '人本流派',
    description: '人本-以人为中心取向训练',
    minTier: MembershipTier.Plus,
  },
  [MembershipFeature.BasicRolePool]: {
    title: '基础角色池',
    description: '常用来访角色',
    minTier: MembershipTier.Plus,
  },
  [MembershipFeature.AllSchools]: {
    title: '全部 4 流派',
    description: 'CBT / 人本 / 精神动力 / 家庭系统',
    minTier: MembershipTier.Pro,
  },
  [MembershipFeature.AllRolePool]: {
    title: '全部角色池',
    description: '全部来访角色与难度',
    minTier: MembershipTier.Pro,
  },
  [MembershipFeature.AdvancedReport]: {
    title: '高级报告',
    description: '月度深度报告与周趋势曲线',
    minTier: MembershipTier.Pro,
  },
  [MembershipFeature.PrioritySupport]: {
    title: '优先客服',
    description: '优先响应队列',
    minTier: MembershipTier.Pro,
  },
  [MembershipFeature.DataExport]: {
    title: '数据导出',
    description: '训练记录与报告导出',
    minTier: MembershipTier.Max,
  },
  [MembershipFeature.DedicatedSupport]: {
    title: '专属客服',
    description: '专属客服通道',
    minTier: MembershipTier.Max,
  },
  [MembershipFeature.MaxTextQuota]: {
    title: '最高文字额度',
    description: '每日最高文字对话额度',
    minTier: MembershipTier.Max,
  },
  [MembershipFeature.HdTts]: {
    title: 'HD 语音',
    description: '更高音质的语音合成',
    minTier: MembershipTier.Pro,
  },
  [MembershipFeature.SupervisionDiscount]: {
    title: '真人督导折扣',
    description: 'Pro 9 折 / Max 8 折，按次付费',
    minTier: MembershipTier.Pro,
  },
};

/** 配额规则：预扣 / 单场 / 每日 / 加包有效期。 */
export const MEMBERSHIP_QUOTA_RULES = {
  preDeductMinutes: 10,
  singleSessionLimitMinutes: 50,
  dailyLimitMinutes: 180,
  addonValidMonths: 12,
  planMinutesRollover: false,
  deductionOrder: [QuotaLotSource.Plan, QuotaLotSource.Promotion, QuotaLotSource.Addon, QuotaLotSource.Migration],
} as const;

/** 活动定义：首购月付 / 首年限时年付。 */
export interface MembershipCampaignDefinition {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly billingPeriod: BillingPeriod;
  readonly status?: MembershipPromotionStatus;
  readonly audience?: MembershipPromotionAudience;
  /** true 表示未传活动码时自动参与；false 只接受显式活动码。 */
  readonly autoApply?: boolean;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly prices: Readonly<Partial<Record<MembershipTier, number>>>;
  readonly floors: Readonly<Partial<Record<MembershipTier, number>>>;
  readonly giftMinutes?: Readonly<Partial<Record<MembershipTier, number>>>;
  readonly budgetCents: number | null;
  readonly perUserLimit: number;
  readonly priority?: number;
  readonly ruleVersion: string;
}

export const MEMBERSHIP_CAMPAIGNS: readonly MembershipCampaignDefinition[] = [
  {
    id: 'campaign_first_monthly_2026',
    name: '新用户首期活动',
    code: 'FIRST_MONTHLY',
    billingPeriod: BillingPeriod.Monthly,
    status: MembershipPromotionStatus.Active,
    audience: MembershipPromotionAudience.FirstPurchase,
    autoApply: true,
    startsAt: new Date('2026-11-01T00:00:00+08:00'),
    endsAt: new Date('2027-12-31T23:59:59+08:00'),
    prices: {
      [MembershipTier.Plus]: 6800,
      [MembershipTier.Pro]: 16_800,
      [MembershipTier.Max]: 32_800,
    },
    floors: {
      [MembershipTier.Plus]: 6800,
      [MembershipTier.Pro]: 16_800,
      [MembershipTier.Max]: 32_800,
    },
    budgetCents: 5_000_000,
    perUserLimit: 1,
    ruleVersion: 'membership-promotion-v1',
  },
  {
    id: 'campaign_first_annual_2026',
    name: '首年限时年付',
    code: 'FIRST_ANNUAL',
    billingPeriod: BillingPeriod.Annual,
    status: MembershipPromotionStatus.Active,
    audience: MembershipPromotionAudience.FirstPurchase,
    autoApply: true,
    startsAt: new Date('2026-11-01T00:00:00+08:00'),
    endsAt: new Date('2027-12-31T23:59:59+08:00'),
    prices: {
      [MembershipTier.Plus]: 68_000,
      [MembershipTier.Pro]: 168_000,
      [MembershipTier.Max]: 328_000,
    },
    floors: {
      [MembershipTier.Plus]: 68_000,
      [MembershipTier.Pro]: 168_000,
      [MembershipTier.Max]: 328_000,
    },
    budgetCents: 10_000_000,
    perUserLimit: 1,
    ruleVersion: 'membership-promotion-v1',
  },
] as const;

/** 旧 3 档 → 新档位。旧客户端只认 free/plus/pro，Max 在旧字段降级映射为 pro。 */
export const LEGACY_TIER_MAP: Readonly<Record<'free' | 'plus' | 'pro', MembershipTier>> = {
  free: MembershipTier.Free,
  plus: MembershipTier.Plus,
  pro: MembershipTier.Pro,
};

export const LEGACY_TIER_REVERSE_MAP: Readonly<Record<MembershipTier, 'free' | 'plus' | 'pro'>> = {
  [MembershipTier.Free]: 'free',
  [MembershipTier.Plus]: 'plus',
  [MembershipTier.Pro]: 'pro',
  [MembershipTier.Max]: 'pro',
};

/** 旧 billing 5 档 → 新会员状态；仅用于 /billing/membership 兼容字段。 */
export const LEGACY_BILLING_STATUS_MAP: Readonly<Record<string, string>> = {
  none: 'none',
  monthly: 'monthly',
  quarterly: 'quarterly',
  yearly: 'yearly',
  lifetime: 'lifetime',
  free: 'none',
  plus: 'monthly',
  pro: 'yearly',
  max: 'yearly',
};

export const PAYMENT_CHANNELS_RESERVED: readonly PaymentChannel[] = [
  PaymentChannel.Wechat,
  PaymentChannel.Alipay,
  PaymentChannel.AppleIap,
  PaymentChannel.Reserved,
] as const;

/** 档位是否达到最低权益档。 */
export function tierAtLeast(tier: MembershipTier, minTier: MembershipTier): boolean {
  const order: readonly MembershipTier[] = [MembershipTier.Free, MembershipTier.Plus, MembershipTier.Pro, MembershipTier.Max];
  return order.indexOf(tier) >= order.indexOf(minTier);
}

/** 生成某档位权益明细。 */
export function getEntitlements(tier: MembershipTier): MembershipEntitlement[] {
  return Object.values(MembershipFeature).map((feature) => {
    const meta = MEMBERSHIP_FEATURE_CATALOG[feature];
    return {
      feature,
      title: meta.title,
      description: meta.description,
      unlocked: tierAtLeast(tier, meta.minTier),
      minTier: meta.minTier,
    };
  });
}

/** 空活动决策：不命中任何活动。 */
export const NO_PROMOTION: PromotionDecision = {
  promotionId: null,
  promotionName: null,
  campaignPriceCents: 0,
  discountCents: 0,
  giftMinutes: 0,
  floorPriceCents: 0,
  ruleVersion: 'membership-promotion-v1',
  eligible: false,
  reasons: ['NO_ELIGIBLE_CAMPAIGN'],
};
