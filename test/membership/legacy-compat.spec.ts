import { describe, expect, it, vi } from 'vitest';

import { BillingService } from '../../src/billing/providers/billing.service.js';
import { MembershipSource, MembershipStatus, MembershipTier } from '../../src/membership/domain/membership.enums.js';
import type { MembershipOverview } from '../../src/membership/domain/membership.types.js';
import { MembershipService } from '../../src/profile/providers/membership.service.js';

function overview(overrides: Partial<MembershipOverview['account']> = {}): MembershipOverview {
  return {
    account: {
      uid: 'u-1',
      status: MembershipStatus.Active,
      tier: MembershipTier.Max,
      legacyTier: 'pro',
      expiresAt: new Date('2027-11-25T12:00:00+08:00'),
      periodStart: new Date('2026-11-25T12:00:00+08:00'),
      periodEnd: new Date('2027-11-25T12:00:00+08:00'),
      autoRenew: true,
      source: MembershipSource.Order,
      lastOrderId: 'o-1',
      ...overrides,
    },
    quota: {
      planMinutes: 1000,
      promotionMinutes: 0,
      addonMinutes: 0,
      migrationMinutes: 0,
      totalRemainingMinutes: 1000,
      includedMinutesThisPeriod: 1000,
      usedMinutesThisPeriod: 0,
      dailyUsedMinutes: 0,
      dailyLimitMinutes: 180,
      preDeductMinutes: 10,
      singleSessionLimitMinutes: 50,
    },
    entitlements: [],
    availablePlans: [],
    availableAddons: [],
    recentOrders: [],
    paymentReserved: true,
    legacyStatus: 'yearly',
    legacyTier: 'pro',
  };
}

describe('AF-512 旧端点兼容契约', () => {
  it('/profile/membership：Max 在旧 3 档字段降级为 pro，新字段返回 max', async () => {
    const accountService = { getOverview: vi.fn().mockResolvedValue(overview()) };
    const service = new MembershipService(accountService as never);
    const dto = await service.getMembership('u-1');

    expect(dto.status).toBe('active');
    expect(dto.tier).toBe('pro');
    expect(dto.tierV2).toBe(MembershipTier.Max);
    expect(dto.minutesRemaining).toBe(1000);
    expect(dto.benefits).toHaveLength(5);
  });

  it('/profile/membership：refunded 映射为 expired，权益全锁', async () => {
    const accountService = {
      getOverview: vi.fn().mockResolvedValue(overview({ status: MembershipStatus.Refunded })),
    };
    const service = new MembershipService(accountService as never);
    const dto = await service.getMembership('u-1');

    expect(dto.status).toBe('expired');
    expect(dto.benefits.every((benefit) => !benefit.unlocked)).toBe(true);
  });

  it('/billing/membership：旧 DTO 形状保留，返回 v2 plans/addons 与 paymentReserved', async () => {
    const accountService = { getOverview: vi.fn().mockResolvedValue(overview()) };
    const service = new BillingService(accountService as never, {} as never);
    const dto = await service.getMembershipOverview('u-1');

    expect(dto.membership.status).toBe('yearly');
    expect(dto.membership.tier).toBe(MembershipTier.Max);
    expect(dto.membership.minutesRemaining).toBe(1000);
    expect(dto.plans).toHaveLength(3);
    expect(dto.addons).toHaveLength(3);
    expect(dto.paymentReserved).toBe(true);
  });

  it('/billing/products：只返回 3 档 + 3 加包，旧单次 SKU 下线', async () => {
    const service = new BillingService({} as never, {} as never);
    const products = await service.listAvailableProducts();

    expect(products).toHaveLength(6);
    expect(products.map((product) => product.id)).toEqual([
      MembershipTier.Plus,
      MembershipTier.Pro,
      MembershipTier.Max,
      'addon_100',
      'addon_300',
      'addon_500',
    ]);
    expect(products.some((product) => product.id.startsWith('single_'))).toBe(false);
  });
});
