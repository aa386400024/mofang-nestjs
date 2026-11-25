import { describe, expect, it, vi } from 'vitest';

import {
  BillingPeriod,
  MembershipOrderType,
  MembershipSource,
  MembershipStatus,
  MembershipTier,
} from '../../src/membership/domain/membership.enums.js';
import { MembershipAccountService } from '../../src/membership/providers/membership-account.service.js';
import type { Membership } from '../../src/profile/entities/membership.entity.js';

function createService(existing: Partial<Membership> | null = null) {
  const saved: Partial<Membership>[] = [];
  const repo = {
    findOne: vi.fn().mockResolvedValue(existing),
    create: vi.fn((value: Partial<Membership>) => value),
    save: vi.fn(async (value: Partial<Membership>) => {
      saved.push(value);
      return value;
    }),
    update: vi.fn(),
  };
  const orderRepo = {
    find: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  };
  const quotaLedger = {
    getBalance: vi.fn().mockResolvedValue({
      planMinutes: 0,
      promotionMinutes: 0,
      addonMinutes: 0,
      migrationMinutes: 0,
      totalRemainingMinutes: 0,
      includedMinutesThisPeriod: 30,
      usedMinutesThisPeriod: 0,
      dailyUsedMinutes: 0,
      dailyLimitMinutes: 180,
      preDeductMinutes: 10,
      singleSessionLimitMinutes: 50,
    }),
    grantPlan: vi.fn().mockResolvedValue({}),
    grantPromotion: vi.fn().mockResolvedValue({}),
    grantAddon: vi.fn().mockResolvedValue({}),
  };
  const planGrantService = {
    refreshForUid: vi.fn().mockResolvedValue(0),
    cancelActiveTerms: vi.fn().mockResolvedValue(0),
    createAnnualTerm: vi.fn().mockResolvedValue({}),
    createMonthlyTerm: vi.fn().mockResolvedValue({}),
  };
  const dataSource = {
    transaction: async (callback: (manager: unknown) => unknown) => callback({ getRepository: () => repo }),
  };
  const service = new MembershipAccountService(
    repo as never,
    orderRepo as never,
    quotaLedger as never,
    dataSource as never,
    planGrantService as never,
  );
  return { service, repo, orderRepo, quotaLedger, planGrantService, saved };
}

const PAID_AT = new Date('2026-11-25T12:00:00+08:00');

describe('AF-512 会员账号开通', () => {
  it('首购 Plus 月付：状态 active、周期 1 个月、发放套餐分钟', async () => {
    const { service, quotaLedger, saved } = createService(null);
    const snapshot = await service.applyPaidOrder({
      orderId: 'o-1',
      uid: 'u-1',
      planId: MembershipTier.Plus,
      orderType: MembershipOrderType.Subscription,
      billingPeriod: BillingPeriod.Monthly,
      amountCents: 6800,
      promotionId: 'campaign_first_monthly_2026',
      giftMinutes: 0,
      paidAt: PAID_AT,
    });

    expect(snapshot.tier).toBe(MembershipTier.Plus);
    expect(snapshot.status).toBe(MembershipStatus.Active);
    expect(snapshot.periodStart?.toISOString()).toBe(PAID_AT.toISOString());
    expect(snapshot.periodEnd?.toISOString()).toBe('2026-12-25T04:00:00.000Z');
    expect(snapshot.autoRenew).toBe(true);
    expect(snapshot.source).toBe(MembershipSource.Order);
    expect(quotaLedger.grantPlan).toHaveBeenCalledTimes(1);
    expect(saved.length).toBeGreaterThan(0);
  });

  it('年付首月只发一个月分钟并登记 term，剩余月份由补发服务按月发', async () => {
    const { service, quotaLedger, planGrantService } = createService(null);
    const snapshot = await service.applyPaidOrder({
      orderId: 'o-annual',
      uid: 'u-1',
      planId: MembershipTier.Pro,
      orderType: MembershipOrderType.Subscription,
      billingPeriod: BillingPeriod.Annual,
      amountCents: 168_000,
      promotionId: 'campaign_first_annual_2026',
      giftMinutes: 0,
      paidAt: PAID_AT,
    });

    expect(snapshot.periodEnd?.toISOString()).toBe('2027-11-25T04:00:00.000Z');
    expect(quotaLedger.grantPlan).toHaveBeenCalledTimes(1);
    const grantArgs = quotaLedger.grantPlan.mock.calls[0];
    expect(grantArgs[1].monthlyMinutes).toBe(500);
    expect(grantArgs[3].toISOString()).toBe('2026-12-25T04:00:00.000Z');
    expect(grantArgs[5]).toBe('plan:1');
    expect(planGrantService.createAnnualTerm).toHaveBeenCalledTimes(1);
    expect(planGrantService.createAnnualTerm.mock.calls[0][1]).toMatchObject({
      orderId: 'o-annual',
      tier: MembershipTier.Pro,
      monthsTotal: 12,
      firstMonthGranted: true,
    });
  });

  it('跨档购买会停掉旧年付 term，防止旧订单继续发放套餐分钟', async () => {
    const existing = {
      uid: 'u-1',
      status: MembershipStatus.Active,
      tier: 'plus' as const,
      tierV2: MembershipTier.Plus,
      expiresAt: new Date('2026-12-25T12:00:00+08:00'),
      periodEnd: new Date('2026-12-25T12:00:00+08:00'),
      autoRenew: true,
      source: MembershipSource.Order,
      legacyTier: 'plus',
      lastOrderId: 'o-old',
    };
    const { service, planGrantService } = createService(existing);
    await service.applyPaidOrder({
      orderId: 'o-upgrade',
      uid: 'u-1',
      planId: MembershipTier.Pro,
      orderType: MembershipOrderType.Subscription,
      billingPeriod: BillingPeriod.Monthly,
      amountCents: 18_800,
      promotionId: null,
      giftMinutes: 0,
      paidAt: PAID_AT,
    });

    expect(planGrantService.cancelActiveTerms).toHaveBeenCalledWith('u-1', 'o-upgrade', expect.anything());
  });

  it('同档续费从原 periodEnd 顺延，不吞掉剩余周期', async () => {
    const existing = {
      uid: 'u-1',
      status: MembershipStatus.Active,
      tier: 'plus' as const,
      tierV2: MembershipTier.Plus,
      expiresAt: new Date('2026-12-25T12:00:00+08:00'),
      periodStart: new Date('2026-11-25T12:00:00+08:00'),
      periodEnd: new Date('2026-12-25T12:00:00+08:00'),
      autoRenew: true,
      source: MembershipSource.Order,
      legacyTier: 'plus',
      lastOrderId: 'o-old',
    };
    const { service, quotaLedger, planGrantService } = createService(existing);
    const snapshot = await service.applyPaidOrder({
      orderId: 'o-2',
      uid: 'u-1',
      planId: MembershipTier.Plus,
      orderType: MembershipOrderType.Subscription,
      billingPeriod: BillingPeriod.Monthly,
      amountCents: 8800,
      promotionId: null,
      giftMinutes: 0,
      paidAt: PAID_AT,
    });

    expect(snapshot.periodStart?.toISOString()).toBe('2026-11-25T04:00:00.000Z');
    expect(snapshot.periodEnd?.toISOString()).toBe('2027-01-25T04:00:00.000Z');
    // 未来周期续费不得在今天提前发下一周期分钟，由 term 在 periodStart 补发。
    expect(quotaLedger.grantPlan).not.toHaveBeenCalled();
    expect(planGrantService.createMonthlyTerm).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orderId: 'o-2', firstMonthGranted: false }),
    );
  });

  it('升档立即按新档重开周期，旧档进 legacyTier 审计', async () => {
    const existing = {
      uid: 'u-1',
      status: MembershipStatus.Active,
      tier: 'plus' as const,
      tierV2: MembershipTier.Plus,
      expiresAt: new Date('2026-12-25T12:00:00+08:00'),
      periodStart: new Date('2026-11-25T12:00:00+08:00'),
      periodEnd: new Date('2026-12-25T12:00:00+08:00'),
      autoRenew: true,
      source: MembershipSource.Order,
      legacyTier: 'plus',
      lastOrderId: 'o-old',
    };
    const { service } = createService(existing);
    const snapshot = await service.applyPaidOrder({
      orderId: 'o-3',
      uid: 'u-1',
      planId: MembershipTier.Pro,
      orderType: MembershipOrderType.Subscription,
      billingPeriod: BillingPeriod.Monthly,
      amountCents: 16_800,
      promotionId: 'campaign_first_monthly_2026',
      giftMinutes: 0,
      paidAt: PAID_AT,
    });

    expect(snapshot.tier).toBe(MembershipTier.Pro);
    expect(snapshot.periodStart?.toISOString()).toBe(PAID_AT.toISOString());
    expect(snapshot.periodEnd?.toISOString()).toBe('2026-12-25T04:00:00.000Z');
  });

  it('加包订单只发配额，不改会员档位与周期', async () => {
    const existing = {
      uid: 'u-1',
      status: MembershipStatus.Active,
      tier: 'plus' as const,
      tierV2: MembershipTier.Plus,
      expiresAt: new Date('2026-12-25T12:00:00+08:00'),
      periodEnd: new Date('2026-12-25T12:00:00+08:00'),
      autoRenew: true,
      source: MembershipSource.Order,
      legacyTier: 'plus',
      lastOrderId: 'o-old',
    };
    const { service, quotaLedger } = createService(existing);
    const snapshot = await service.applyPaidOrder({
      orderId: 'o-addon',
      uid: 'u-1',
      planId: 'addon_100',
      orderType: MembershipOrderType.Addon,
      billingPeriod: BillingPeriod.Monthly,
      amountCents: 3000,
      promotionId: null,
      giftMinutes: 0,
      paidAt: PAID_AT,
    });

    expect(snapshot.tier).toBe(MembershipTier.Plus);
    expect(snapshot.periodEnd?.toISOString()).toBe('2026-12-25T04:00:00.000Z');
    expect(quotaLedger.grantAddon).toHaveBeenCalledTimes(1);
    expect(quotaLedger.grantPlan).not.toHaveBeenCalled();
  });
});
