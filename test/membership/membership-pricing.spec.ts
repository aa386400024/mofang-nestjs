import { describe, expect, it } from 'vitest';

import { BillingPeriod, MembershipTier } from '../../src/membership/domain/membership.enums.js';
import { DefaultPromotionEngine } from '../../src/membership/providers/default-promotion.engine.js';
import { MembershipPricingService } from '../../src/membership/providers/membership-pricing.service.js';

const NOW = new Date('2026-11-25T12:00:00+08:00');

function pricing(): MembershipPricingService {
  return new MembershipPricingService(new DefaultPromotionEngine());
}

function quote(overrides: Partial<Parameters<MembershipPricingService['quote']>[0]> = {}) {
  return pricing().quote({
    uid: 'u-1',
    tier: MembershipTier.Plus,
    billingPeriod: BillingPeriod.Monthly,
    isFirstPurchase: true,
    now: NOW,
    ...overrides,
  });
}

describe('AF-512 会员价格层级', () => {
  it('首购 Plus 月付命中 68 元活动价，原价/续费价同时返回', () => {
    const result = quote();
    expect(result.listPriceCents).toBe(18_800);
    expect(result.basePriceCents).toBe(6800);
    expect(result.amountCents).toBe(6800);
    expect(result.renewalPriceCents).toBe(8800);
    expect(result.promotionDiscountCents).toBe(12_000);
    expect(result.promotionId).toBe('campaign_first_monthly_2026');
    expect(result.floorPriceCents).toBe(6800);
  });

  it('非首购按续费价，不给首购活动', () => {
    const result = quote({ isFirstPurchase: false });
    expect(result.amountCents).toBe(8800);
    expect(result.promotionId).toBeNull();
    expect(result.promotionDiscountCents).toBe(10_000);
  });

  it('首年 Plus 年付命中 680 元，年付底价 680 元', () => {
    const result = quote({ billingPeriod: BillingPeriod.Annual });
    expect(result.listPriceCents).toBe(18_800 * 12);
    expect(result.amountCents).toBe(68_000);
    expect(result.periodMinutes).toBe(240 * 12);
    expect(result.floorPriceCents).toBe(68_000);
  });

  it('优惠券不能击穿底价：68 元再减 10 元仍然是 68 元', () => {
    const result = quote({ couponDiscountCents: 1000 });
    expect(result.couponDiscountCents).toBe(0);
    expect(result.amountCents).toBe(6800);
  });

  it('续费价上的优惠券可以生效，但仍有底价保护', () => {
    const result = quote({ isFirstPurchase: false, couponDiscountCents: 1000 });
    expect(result.basePriceCents).toBe(8800);
    expect(result.couponDiscountCents).toBe(1000);
    expect(result.amountCents).toBe(7800);
  });

  it('活动预算耗尽时回落到续费价，不继续发首购折扣', () => {
    const result = quote({ campaignBudgetRemainingCents: 0 });
    expect(result.amountCents).toBe(8800);
    expect(result.promotionId).toBe('campaign_first_monthly_2026');
    expect(result.promotionDiscountCents).toBe(10_000);
  });

  it('活动窗口外不命中活动', () => {
    const result = quote({ now: new Date('2028-01-01T00:00:00+08:00') });
    expect(result.amountCents).toBe(8800);
    expect(result.promotionDiscountCents).toBe(10_000);
  });

  it('Pro/Max 用 HD，Plus/Free 用 turbo；价格不随周期改变音色', () => {
    const pro = quote({ tier: MembershipTier.Pro, isFirstPurchase: true });
    const max = quote({ tier: MembershipTier.Max, isFirstPurchase: true });
    const plus = quote({ tier: MembershipTier.Plus });
    expect(pro.ttsModel).toBe('hd');
    expect(max.ttsModel).toBe('premium');
    expect(plus.ttsModel).toBe('turbo');
  });
});
