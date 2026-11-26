import { describe, expect, it, vi } from 'vitest';

import { MembershipStatus, MembershipTier } from '../../src/membership/domain/membership.enums.js';
import { MembershipAccountService } from '../../src/membership/providers/membership-account.service.js';
import type { Membership } from '../../src/profile/entities/membership.entity.js';
import { TtsMembershipTierAdapter } from '../../src/voice/tts/runtime/tts-membership-tier.adapter.js';

const NOW = new Date('2026-11-26T12:00:00+08:00');

function membership(overrides: Partial<Membership> = {}): Partial<Membership> {
  return {
    uid: 'u-1',
    status: MembershipStatus.Active,
    tier: 'pro',
    tierV2: MembershipTier.Pro,
    expiresAt: new Date('2026-11-01T00:00:00+08:00'),
    periodEnd: new Date('2026-12-25T12:00:00+08:00'),
    createdAt: new Date('2026-01-01T00:00:00+08:00'),
    ...overrides,
  };
}

function accountService(existing: Partial<Membership> | null): MembershipAccountService {
  const repo = { findOne: vi.fn().mockResolvedValue(existing) };
  return new MembershipAccountService(
    repo as never,
    { find: vi.fn(), count: vi.fn() } as never,
    { getBalance: vi.fn(), grantPlan: vi.fn() } as never,
    { transaction: vi.fn() } as never,
    { refreshForUid: vi.fn().mockResolvedValue(0) } as never,
  );
}

function adapter(existing: Partial<Membership> | null): TtsMembershipTierAdapter {
  return new TtsMembershipTierAdapter(accountService(existing));
}

describe('TtsMembershipTierAdapter', () => {
  it('periodEnd 未到期时以 periodEnd 为准，旧 expiresAt 过期不降档', async () => {
    await expect(adapter(membership()).getEffectiveTier('u-1', NOW)).resolves.toBe('pro');
  });

  it('periodEnd 到期后落 free', async () => {
    await expect(adapter(membership({ periodEnd: new Date('2026-11-01T00:00:00+08:00') })).getEffectiveTier('u-1', NOW)).resolves.toBe(
      'free',
    );
  });

  it('非 active 状态即使 tierV2=Max 也落 free', async () => {
    await expect(
      adapter(membership({ status: MembershipStatus.Expired, tierV2: MembershipTier.Max })).getEffectiveTier('u-1', NOW),
    ).resolves.toBe('free');
  });

  it('会员查询异常降级 free，不阻断语音链路', async () => {
    const failing = {
      getEffectiveTier: vi.fn().mockRejectedValue(new Error('db down')),
    } as unknown as MembershipAccountService;
    const target = new TtsMembershipTierAdapter(failing);
    await expect(target.getEffectiveTier('u-1', NOW)).resolves.toBe('free');
  });
});
