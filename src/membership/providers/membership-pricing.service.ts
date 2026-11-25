import { Inject, Injectable } from '@nestjs/common';

import { BillingPeriod, MembershipTier } from '../domain/membership.enums.js';
import type { PriceQuote, PromotionEvaluationInput } from '../domain/membership.types.js';
import { MEMBERSHIP_PLANS } from '../membership.constants.js';
import { PROMOTION_ENGINE, type PromotionEnginePort } from './promotion-engine.port.js';

export interface QuoteInput {
  readonly tier: MembershipTier;
  readonly billingPeriod: BillingPeriod;
  readonly isFirstPurchase: boolean;
  readonly uid: string;
  readonly now?: Date;
  readonly campaignCode?: string;
  readonly couponDiscountCents?: number;
  readonly redemptionCount?: number;
  readonly campaignBudgetRemainingCents?: number | null;
}

/**
 * 价格计算单一入口。
 *
 * 层级固定：原价 → 活动价 → 优惠券 → 底价保护。
 * 活动只输出命中结果；本服务负责把“活动价 + 优惠券”压到底价之上，绝不击穿。
 */
@Injectable()
export class MembershipPricingService {
  constructor(
    @Inject(PROMOTION_ENGINE)
    private readonly promotionEngine: PromotionEnginePort,
  ) {}

  quote(input: QuoteInput): PriceQuote {
    const plan = MEMBERSHIP_PLANS[input.tier];
    const now = input.now ?? new Date();
    const couponDiscountCents = Math.max(0, input.couponDiscountCents ?? 0);

    if (!plan.isPaid) {
      return {
        tier: input.tier,
        billingPeriod: input.billingPeriod,
        listPriceCents: 0,
        basePriceCents: 0,
        campaignPriceCents: 0,
        renewalPriceCents: 0,
        floorPriceCents: 0,
        promotionId: null,
        promotionName: null,
        promotionDiscountCents: 0,
        couponDiscountCents: 0,
        amountCents: 0,
        giftMinutes: 0,
        currency: 'CNY',
        periodMinutes: input.billingPeriod === BillingPeriod.Annual ? plan.monthlyMinutes * 12 : plan.monthlyMinutes,
        ttsModel: plan.ttsModel,
        ruleVersion: 'membership-pricing-v1',
      };
    }

    const isAnnual = input.billingPeriod === BillingPeriod.Annual;
    const listPriceCents = isAnnual ? plan.listPriceCents * 12 : plan.listPriceCents;
    const renewalPriceCents = isAnnual ? plan.annualPriceCents : plan.renewalPriceCents;
    const promoPriceCents = isAnnual ? plan.annualPromoPriceCents : plan.promoPriceCents;
    const floorPriceCents = isAnnual ? plan.annualFloorPriceCents : plan.floorPriceCents;
    const baseBeforePromotion = renewalPriceCents;

    const evaluation: PromotionEvaluationInput = {
      uid: input.uid,
      tier: input.tier,
      billingPeriod: input.billingPeriod,
      isFirstPurchase: input.isFirstPurchase,
      listPriceCents,
      promoPriceCents,
      renewalPriceCents,
      annualPriceCents: plan.annualPriceCents,
      annualPromoPriceCents: plan.annualPromoPriceCents,
      floorPriceCents: plan.floorPriceCents,
      annualFloorPriceCents: plan.annualFloorPriceCents,
      now,
      campaignCode: input.campaignCode,
      redemptionCount: input.redemptionCount ?? 0,
      campaignBudgetRemainingCents: input.campaignBudgetRemainingCents ?? null,
    };

    const decision = this.promotionEngine.evaluate(evaluation);
    const campaignPriceCents = decision.eligible ? decision.campaignPriceCents : baseBeforePromotion;
    const basePriceCents = Math.max(floorPriceCents, campaignPriceCents);
    const effectiveCoupon = Math.min(couponDiscountCents, Math.max(0, basePriceCents - floorPriceCents));
    const amountCents = Math.max(floorPriceCents, basePriceCents - effectiveCoupon);
    const promotionDiscountCents = Math.max(0, listPriceCents - basePriceCents);

    return {
      tier: input.tier,
      billingPeriod: input.billingPeriod,
      listPriceCents,
      basePriceCents,
      campaignPriceCents,
      renewalPriceCents,
      floorPriceCents,
      promotionId: decision.promotionId,
      promotionName: decision.promotionName,
      promotionDiscountCents,
      couponDiscountCents: effectiveCoupon,
      amountCents,
      giftMinutes: decision.giftMinutes,
      currency: 'CNY',
      periodMinutes: isAnnual ? plan.monthlyMinutes * 12 : plan.monthlyMinutes,
      ttsModel: plan.ttsModel,
      ruleVersion: decision.ruleVersion,
    };
  }
}
