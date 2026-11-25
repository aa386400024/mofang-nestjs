import { describe, expect, it } from 'vitest';

import {
  BillingPeriod,
  MembershipPromotionAudience,
  MembershipPromotionStatus,
  MembershipTier,
} from '../../src/membership/domain/membership.enums.js';
import type { PromotionEvaluationInput } from '../../src/membership/domain/membership.types.js';
import type { MembershipCampaignDefinition } from '../../src/membership/membership.constants.js';
import { FlexRulesPromotionEngine } from '../../src/membership/providers/promotion/flex-rules-promotion.engine.js';

const NOW = new Date('2026-11-25T12:00:00+08:00');

function campaign(overrides: Partial<MembershipCampaignDefinition> = {}): MembershipCampaignDefinition {
  return {
    id: 'dynamic_campaign',
    name: '动态活动',
    code: 'DYNAMIC',
    billingPeriod: BillingPeriod.Monthly,
    status: MembershipPromotionStatus.Active,
    audience: MembershipPromotionAudience.FirstPurchase,
    autoApply: true,
    startsAt: new Date('2026-11-01T00:00:00+08:00'),
    endsAt: new Date('2027-12-31T23:59:59+08:00'),
    prices: { [MembershipTier.Plus]: 7000 },
    floors: { [MembershipTier.Plus]: 6800 },
    giftMinutes: {},
    budgetCents: 1_000_000,
    perUserLimit: 1,
    priority: 100,
    ruleVersion: 'membership-promotion-v1',
    ...overrides,
  };
}

function input(overrides: Partial<PromotionEvaluationInput> = {}): PromotionEvaluationInput {
  const campaigns = overrides.campaigns ?? [campaign()];
  return {
    uid: 'u-1',
    tier: MembershipTier.Plus,
    billingPeriod: BillingPeriod.Monthly,
    isFirstPurchase: true,
    listPriceCents: 18_800,
    promoPriceCents: 6800,
    renewalPriceCents: 8800,
    annualPriceCents: 88_000,
    annualPromoPriceCents: 68_000,
    floorPriceCents: 6800,
    annualFloorPriceCents: 68_000,
    now: NOW,
    redemptionCount: 0,
    campaignBudgetRemainingCents: null,
    campaigns,
    redemptionCountByPromotion: Object.fromEntries(campaigns.map((item) => [item.id, 0])),
    campaignBudgetRemainingCentsByPromotion: Object.fromEntries(campaigns.map((item) => [item.id, item.budgetCents])),
    ...overrides,
  };
}

describe('AF-516 动态活动规则引擎', () => {
  it('命中运营活动并按活动价出价', () => {
    const decision = new FlexRulesPromotionEngine().evaluate(input());

    expect(decision.eligible).toBe(true);
    expect(decision.promotionId).toBe('dynamic_campaign');
    expect(decision.campaignPriceCents).toBe(7000);
    expect(decision.discountCents).toBe(11_800);
    expect(decision.ruleVersion).toBe('membership-promotion-v1');
  });

  it('单用户限次用按活动计数，不被其他活动兑换次数误伤', () => {
    const decision = new FlexRulesPromotionEngine().evaluate(
      input({
        redemptionCount: 5,
        redemptionCountByPromotion: { dynamic_campaign: 0 },
      }),
    );

    expect(decision.eligible).toBe(true);
  });

  it('已兑换满一次后不再命中', () => {
    const decision = new FlexRulesPromotionEngine().evaluate(input({ redemptionCountByPromotion: { dynamic_campaign: 1 } }));

    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain('PER_USER_LIMIT_REACHED');
  });

  it('预算不足时不命中，避免超发折扣', () => {
    const decision = new FlexRulesPromotionEngine().evaluate(
      input({ campaignBudgetRemainingCentsByPromotion: { dynamic_campaign: 5000 } }),
    );

    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain('CAMPAIGN_BUDGET_EXHAUSTED');
  });

  it('暂停状态的活动即使时间窗内也不参与', () => {
    const decision = new FlexRulesPromotionEngine().evaluate(
      input({ campaigns: [campaign({ status: MembershipPromotionStatus.Paused })] }),
    );

    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain('NO_ACTIVE_CAMPAIGN');
  });

  it('非自动活动只在显式活动码时命中', () => {
    const autoDecision = new FlexRulesPromotionEngine().evaluate(
      input({ campaigns: [campaign({ autoApply: false })], campaignCode: undefined }),
    );
    expect(autoDecision.eligible).toBe(false);

    const codeDecision = new FlexRulesPromotionEngine().evaluate(
      input({ campaigns: [campaign({ autoApply: false })], campaignCode: 'DYNAMIC' }),
    );
    expect(codeDecision.eligible).toBe(true);
  });

  it('活动价不低于续费价时视为无效折扣', () => {
    const decision = new FlexRulesPromotionEngine().evaluate(input({ campaigns: [campaign({ prices: { [MembershipTier.Plus]: 8800 } })] }));

    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain('CAMPAIGN_PRICE_NOT_DISCOUNTED');
  });
});
