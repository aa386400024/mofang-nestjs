import { describe, expect, it } from 'vitest';

import { BillingPeriod, MembershipTier } from '../../src/membership/domain/membership.enums.js';
import { DefaultPromotionEngine } from '../../src/membership/providers/default-promotion.engine.js';

const NOW = new Date('2026-11-25T12:00:00+08:00');
const ENGINE = new DefaultPromotionEngine();

const BASE = {
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
  campaignBudgetRemainingCents: 5_000_000,
} as const;

describe('AF-512 活动引擎边界', () => {
  it('首购命中活动并输出规则版本', () => {
    const decision = ENGINE.evaluate(BASE);
    expect(decision.eligible).toBe(true);
    expect(decision.campaignPriceCents).toBe(6800);
    expect(decision.ruleVersion).toBe('membership-promotion-v1');
  });

  it('非首购不命中', () => {
    const decision = ENGINE.evaluate({ ...BASE, isFirstPurchase: false });
    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain('NOT_FIRST_PURCHASE');
  });

  it('单用户限一次：已兑换过则不再命中', () => {
    const decision = ENGINE.evaluate({ ...BASE, redemptionCount: 1 });
    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain('PER_USER_LIMIT_REACHED');
  });

  it('预算不足不命中，且不返回可发折扣', () => {
    const decision = ENGINE.evaluate({ ...BASE, campaignBudgetRemainingCents: 0 });
    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain('CAMPAIGN_BUDGET_EXHAUSTED');
  });

  it('活动价低于底价时拒绝，不允许击穿', () => {
    const decision = ENGINE.evaluate({ ...BASE, floorPriceCents: 7000 });
    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain('BELOW_FLOOR_PRICE');
  });

  it('活动窗口外不命中', () => {
    const decision = ENGINE.evaluate({ ...BASE, now: new Date('2028-01-01T00:00:00+08:00') });
    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain('NO_ACTIVE_CAMPAIGN');
  });

  it('Free 档永远不参与活动', () => {
    const decision = ENGINE.evaluate({ ...BASE, tier: MembershipTier.Free });
    expect(decision.eligible).toBe(false);
  });
});
