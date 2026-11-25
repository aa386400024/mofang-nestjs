import {
  BillingPeriod,
  MembershipFeature,
  MembershipOrderStatus,
  MembershipOrderType,
  MembershipSource,
  MembershipStatus,
  MembershipTier,
  PaymentChannel,
  QuotaLotSource,
  TtsModel,
} from './membership.enums.js';
import type { MembershipCampaignDefinition } from '../membership.constants.js';

export interface MembershipPlanDefinition {
  readonly id: MembershipTier;
  readonly name: string;
  readonly description: string;
  readonly isPaid: boolean;
  /** 原价（分/月）。真实可售锚点，不允许虚构。 */
  readonly listPriceCents: number;
  /** 新用户首期活动价（分/月）；null 表示该档不参与首购活动。 */
  readonly promoPriceCents: number | null;
  /** 续费价（分/月）。 */
  readonly renewalPriceCents: number;
  /** 标准年付价（分/年），按 10 个月续费价。 */
  readonly annualPriceCents: number;
  /** 首年限时活动年付价（分/年）；null 表示不参与。 */
  readonly annualPromoPriceCents: number | null;
  /** 活动底价（分/月），任何活动不得击穿。 */
  readonly floorPriceCents: number;
  /** 首年限时年付底价（分/年）。 */
  readonly annualFloorPriceCents: number;
  /** 当期套餐分钟数/月。 */
  readonly monthlyMinutes: number;
  /** 新用户一次性赠送分钟数；0 表示无。 */
  readonly newUserBonusMinutes: number;
  readonly ttsModel: TtsModel;
  readonly concurrentSessions: number;
  /** 最高文字额度（条/日），仅作权益展示与后续限流口径。 */
  readonly textDailyLimit: number;
  readonly features: readonly MembershipFeature[];
}

export interface MembershipAddonDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly priceCents: number;
  readonly minutes: number;
  readonly validMonths: number;
}

export interface MembershipEntitlement {
  readonly feature: MembershipFeature;
  readonly title: string;
  readonly description: string;
  readonly unlocked: boolean;
  readonly minTier: MembershipTier;
}

export interface MembershipQuotaBalance {
  readonly planMinutes: number;
  readonly promotionMinutes: number;
  readonly addonMinutes: number;
  readonly migrationMinutes: number;
  readonly totalRemainingMinutes: number;
  readonly includedMinutesThisPeriod: number;
  readonly usedMinutesThisPeriod: number;
  readonly dailyUsedMinutes: number;
  readonly dailyLimitMinutes: number;
  readonly preDeductMinutes: number;
  readonly singleSessionLimitMinutes: number;
}

export interface MembershipAccountSnapshot {
  readonly uid: string;
  readonly status: MembershipStatus;
  readonly tier: MembershipTier;
  readonly legacyTier: string;
  readonly expiresAt: Date | null;
  readonly periodStart: Date | null;
  readonly periodEnd: Date | null;
  readonly autoRenew: boolean;
  readonly source: MembershipSource;
  readonly lastOrderId: string | null;
}

export interface QuotaLotSnapshot {
  readonly id: string;
  readonly source: QuotaLotSource;
  readonly minutesRemaining: number;
  readonly expiresAt: Date;
}

export interface QuotaAllocation {
  readonly lotId: string;
  readonly minutes: number;
}

export interface QuotaAllocationResult {
  readonly allocations: readonly QuotaAllocation[];
  readonly allocatedMinutes: number;
  readonly requestedMinutes: number;
}

export interface PromotionEvaluationInput {
  readonly uid: string;
  readonly tier: MembershipTier;
  readonly billingPeriod: BillingPeriod;
  readonly isFirstPurchase: boolean;
  readonly listPriceCents: number;
  readonly promoPriceCents: number | null;
  readonly renewalPriceCents: number;
  readonly annualPriceCents: number;
  readonly annualPromoPriceCents: number | null;
  readonly floorPriceCents: number;
  readonly annualFloorPriceCents: number;
  readonly now: Date;
  readonly campaignCode?: string;
  readonly redemptionCount: number;
  readonly campaignBudgetRemainingCents: number | null;
  /** 订单服务传入的实时活动快照；缺省时规则引擎回落到静态活动常量。 */
  readonly campaigns?: readonly MembershipCampaignDefinition[];
  readonly redemptionCountByPromotion?: Readonly<Record<string, number>>;
  readonly campaignBudgetRemainingCentsByPromotion?: Readonly<Record<string, number | null>>;
}

export interface PromotionDecision {
  readonly promotionId: string | null;
  readonly promotionName: string | null;
  readonly campaignPriceCents: number;
  readonly discountCents: number;
  readonly giftMinutes: number;
  readonly floorPriceCents: number;
  readonly ruleVersion: string;
  readonly eligible: boolean;
  readonly reasons: readonly string[];
}

export interface PriceQuote {
  readonly tier: MembershipTier;
  readonly billingPeriod: BillingPeriod;
  readonly listPriceCents: number;
  readonly basePriceCents: number;
  readonly campaignPriceCents: number;
  readonly renewalPriceCents: number;
  readonly floorPriceCents: number;
  readonly promotionId: string | null;
  readonly promotionName: string | null;
  readonly promotionDiscountCents: number;
  readonly couponDiscountCents: number;
  readonly amountCents: number;
  readonly giftMinutes: number;
  readonly currency: 'CNY';
  readonly periodMinutes: number;
  readonly ttsModel: TtsModel;
  readonly ruleVersion: string;
}

export interface MembershipOrderSummary {
  readonly id: string;
  readonly uid: string;
  readonly planId: string;
  readonly productName: string;
  readonly orderType: MembershipOrderType;
  readonly billingPeriod: BillingPeriod;
  readonly listAmountCents: number;
  readonly discountCents: number;
  readonly amountCents: number;
  readonly giftMinutes: number;
  readonly status: MembershipOrderStatus;
  readonly paymentChannel: PaymentChannel;
  readonly createdAt: Date;
  readonly paidAt: Date | null;
  readonly expiresAt: Date | null;
}

export interface CreateMembershipOrderInput {
  readonly productId: string;
  readonly billingPeriod: BillingPeriod;
  readonly paymentChannel: PaymentChannel;
  readonly promotionCode?: string;
  readonly couponDiscountCents?: number;
  readonly idempotencyKey?: string;
}

export interface MembershipOverview {
  readonly account: MembershipAccountSnapshot;
  readonly quota: MembershipQuotaBalance;
  readonly entitlements: readonly MembershipEntitlement[];
  readonly availablePlans: readonly MembershipPlanDefinition[];
  readonly availableAddons: readonly MembershipAddonDefinition[];
  readonly recentOrders: readonly MembershipOrderSummary[];
  readonly paymentReserved: boolean;
  readonly legacyStatus: string;
  readonly legacyTier: string;
}

/** 订单实体写入参数（由订单 service 组装，account service 只消费）。 */
export interface PaidOrderPayload {
  readonly orderId: string;
  readonly uid: string;
  readonly planId: string;
  readonly orderType: MembershipOrderType;
  readonly billingPeriod: BillingPeriod;
  readonly amountCents: number;
  readonly promotionId: string | null;
  readonly giftMinutes: number;
  readonly paidAt: Date;
}
