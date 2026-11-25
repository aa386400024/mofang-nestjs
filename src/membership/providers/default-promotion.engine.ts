import { Injectable } from '@nestjs/common';

import type { PromotionEnginePort } from './promotion-engine.port.js';
import { MembershipTier } from '../domain/membership.enums.js';
import type { PromotionDecision, PromotionEvaluationInput } from '../domain/membership.types.js';
import { MEMBERSHIP_CAMPAIGNS, NO_PROMOTION } from '../membership.constants.js';

/**
 * 内置活动规则实现 — 首购月付 / 首年限时年付。
 *
 * 为什么先不直接接 flex-rules-engine：
 *   - 规则数量少且强约束（底价、单用户一次、预算），内置实现更可测；
 *   - 端口已固定，后续把规则表迁到 flex-rules-engine 不影响订单与配额；
 *   - 新增第三方依赖属于 L4 冻结动作，先不引入，避免把商业闭环绑在一个 npm 包上。
 */
@Injectable()
export class DefaultPromotionEngine implements PromotionEnginePort {
  evaluate(input: PromotionEvaluationInput): PromotionDecision {
    if (input.tier === MembershipTier.Free) {
      return NO_PROMOTION;
    }
    if (!input.isFirstPurchase) {
      return { ...NO_PROMOTION, reasons: ['NOT_FIRST_PURCHASE'] };
    }

    const campaign = MEMBERSHIP_CAMPAIGNS.find((item) => {
      if (item.billingPeriod !== input.billingPeriod) return false;
      if (input.now < item.startsAt || input.now > item.endsAt) return false;
      if (input.campaignCode && item.code !== input.campaignCode) return false;
      return item.prices[input.tier] !== undefined;
    });

    if (!campaign) {
      return { ...NO_PROMOTION, reasons: ['NO_ACTIVE_CAMPAIGN'] };
    }
    if (input.redemptionCount >= campaign.perUserLimit) {
      return { ...NO_PROMOTION, promotionId: campaign.id, reasons: ['PER_USER_LIMIT_REACHED'] };
    }

    const campaignPrice = campaign.prices[input.tier] ?? 0;
    const floorPrice = Math.max(campaign.floors[input.tier] ?? input.floorPriceCents, input.floorPriceCents);
    if (campaignPrice < floorPrice) {
      return { ...NO_PROMOTION, promotionId: campaign.id, reasons: ['BELOW_FLOOR_PRICE'] };
    }

    const discountCents = Math.max(0, input.listPriceCents - campaignPrice);
    if (input.campaignBudgetRemainingCents !== null && input.campaignBudgetRemainingCents < discountCents) {
      return { ...NO_PROMOTION, promotionId: campaign.id, reasons: ['CAMPAIGN_BUDGET_EXHAUSTED'] };
    }

    return {
      promotionId: campaign.id,
      promotionName: campaign.name,
      campaignPriceCents: campaignPrice,
      discountCents,
      giftMinutes: 0,
      floorPriceCents: floorPrice,
      ruleVersion: campaign.ruleVersion,
      eligible: true,
      reasons: ['FIRST_PURCHASE_CAMPAIGN_APPLIED'],
    };
  }
}
