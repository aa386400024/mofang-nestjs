import { Injectable } from '@nestjs/common';

import { MembershipPromotionAudience, MembershipPromotionStatus } from '../../domain/membership.enums.js';
import type { PromotionDecision, PromotionEvaluationInput } from '../../domain/membership.types.js';
import { MEMBERSHIP_CAMPAIGNS, NO_PROMOTION, type MembershipCampaignDefinition } from '../../membership.constants.js';
import type { PromotionEnginePort } from '../promotion-engine.port.js';
import { evaluateFlexRule, type FlexRule } from './flex-rule.evaluator.js';

/**
 * 动态活动规则引擎 — 读取订单服务传入的活动快照，按 `flex-rules-engine` 兼容 DSL 求值。
 *
 * 设计边界：
 *   - 规则只做结构匹配（周期/档位/时间窗/受众/活动码）；
 *   - 价格、底价、预算、单用户限次在规则命中后由服务层再校验，避免把“金额真相”放进规则动作里；
 *   - 无 DB、无网络、无动态代码执行，可在纯单测中完整覆盖。
 */
@Injectable()
export class FlexRulesPromotionEngine implements PromotionEnginePort {
  evaluate(input: PromotionEvaluationInput): PromotionDecision {
    const campaigns = input.campaigns ?? MEMBERSHIP_CAMPAIGNS;
    const candidates = this.candidates(campaigns, input);
    if (candidates.length === 0) {
      return this.noPromotion('NO_ACTIVE_CAMPAIGN');
    }

    let lastReason = 'NO_ELIGIBLE_CAMPAIGN';
    for (const campaign of candidates) {
      const rule = this.buildRule(campaign, input);
      const result = evaluateFlexRule(rule, this.buildData(input));
      if (!result.matched) continue;

      const promotionId = campaign.id;
      const campaignPriceCents = campaign.prices[input.tier];
      if (campaignPriceCents === undefined || campaignPriceCents < 0) {
        lastReason = 'CAMPAIGN_TIER_NOT_OFFERED';
        continue;
      }

      const perUserCount = input.redemptionCountByPromotion ? (input.redemptionCountByPromotion[promotionId] ?? 0) : input.redemptionCount;
      if (perUserCount >= campaign.perUserLimit) {
        lastReason = 'PER_USER_LIMIT_REACHED';
        continue;
      }

      const campaignFloor = campaign.floors[input.tier];
      const effectiveFloor = Math.max(input.floorPriceCents, campaignFloor ?? 0);
      if (campaignPriceCents < effectiveFloor) {
        lastReason = 'BELOW_FLOOR_PRICE';
        continue;
      }
      if (campaignPriceCents >= input.renewalPriceCents) {
        lastReason = 'CAMPAIGN_PRICE_NOT_DISCOUNTED';
        continue;
      }

      const mappedBudget = input.campaignBudgetRemainingCentsByPromotion?.[promotionId];
      const budgetRemaining = mappedBudget === undefined ? (input.campaignBudgetRemainingCents ?? campaign.budgetCents) : mappedBudget;
      const discountCents = Math.max(0, input.listPriceCents - campaignPriceCents);
      if (budgetRemaining !== null && budgetRemaining < discountCents) {
        lastReason = 'CAMPAIGN_BUDGET_EXHAUSTED';
        continue;
      }

      return {
        promotionId,
        promotionName: campaign.name,
        campaignPriceCents,
        discountCents,
        giftMinutes: campaign.giftMinutes?.[input.tier] ?? 0,
        floorPriceCents: effectiveFloor,
        ruleVersion: campaign.ruleVersion,
        eligible: true,
        reasons: [],
      };
    }

    return this.noPromotion(lastReason);
  }

  private candidates(campaigns: readonly MembershipCampaignDefinition[], input: PromotionEvaluationInput): MembershipCampaignDefinition[] {
    const requestedCode = input.campaignCode?.trim() ?? '';
    return campaigns
      .filter((campaign) => campaign.billingPeriod === input.billingPeriod)
      .filter((campaign) => (campaign.status ?? MembershipPromotionStatus.Active) === MembershipPromotionStatus.Active)
      .filter((campaign) => campaign.prices[input.tier] !== undefined)
      .filter((campaign) => (requestedCode ? campaign.code === requestedCode : campaign.autoApply === true))
      .toSorted((a, b) => (b.priority ?? 100) - (a.priority ?? 100) || b.startsAt.getTime() - a.startsAt.getTime());
  }

  private buildRule(campaign: MembershipCampaignDefinition, input: PromotionEvaluationInput): FlexRule {
    const conditions: { field: string; operator: 'equals' | 'in' | 'greaterThanOrEqual' | 'lessThanOrEqual'; value: unknown }[] = [
      { field: 'billingPeriod', operator: 'equals', value: input.billingPeriod },
      { field: 'tier', operator: 'equals', value: input.tier },
      { field: 'nowMs', operator: 'greaterThanOrEqual', value: campaign.startsAt.getTime() },
      { field: 'nowMs', operator: 'lessThanOrEqual', value: campaign.endsAt.getTime() },
    ];

    if ((campaign.audience ?? MembershipPromotionAudience.FirstPurchase) === MembershipPromotionAudience.FirstPurchase) {
      conditions.push({ field: 'isFirstPurchase', operator: 'equals', value: true });
    }

    const requestedCode = input.campaignCode?.trim() ?? '';
    conditions.push({
      field: 'requestedCode',
      operator: 'in',
      value: requestedCode ? [campaign.code] : ['', campaign.code],
    });

    return {
      id: `promotion:${campaign.id}`,
      conditions: { operator: 'AND', rules: conditions },
      actions: [
        { type: 'set_value', target: 'promotionId', value: campaign.id },
        { type: 'set_value', target: 'campaignPriceCents', value: campaign.prices[input.tier] },
      ],
    };
  }

  private buildData(input: PromotionEvaluationInput): Record<string, unknown> {
    return {
      tier: input.tier,
      billingPeriod: input.billingPeriod,
      isFirstPurchase: input.isFirstPurchase,
      nowMs: input.now.getTime(),
      requestedCode: input.campaignCode?.trim() ?? '',
    };
  }

  private noPromotion(reason: string): PromotionDecision {
    return { ...NO_PROMOTION, eligible: false, reasons: [reason] };
  }
}
