import { describe, expect, it, vi } from 'vitest';

import { BillingPeriod, MembershipTier } from '../../src/membership/domain/membership.enums.js';
import { CreateMembershipPromotionDto } from '../../src/membership/dto/membership-promotion.dto.js';
import { MembershipPromotion } from '../../src/membership/entities/membership-promotion.entity.js';
import { MembershipPromotionService } from '../../src/membership/providers/membership-promotion.service.js';

function createService() {
  const rows: MembershipPromotion[] = [];
  const promotionRepo = {
    findOne: vi.fn(
      async ({ where }: { where: { id?: string; code?: string } }) =>
        rows.find((row) => (where.id ? row.id === where.id : row.code === where.code)) ?? null,
    ),
    create: vi.fn((value: Partial<MembershipPromotion>) => value),
    save: vi.fn(async (value: MembershipPromotion) => {
      value.createdAt ??= new Date();
      value.updatedAt ??= new Date();
      if (!rows.includes(value)) rows.push(value);
      return value;
    }),
  };
  const redemptionRepo = { createQueryBuilder: vi.fn() };
  const service = new MembershipPromotionService(promotionRepo as never, redemptionRepo as never);
  return { service, rows, promotionRepo };
}

function dto(overrides: Partial<CreateMembershipPromotionDto> = {}): CreateMembershipPromotionDto {
  return {
    code: 'NEW_CAMPAIGN',
    name: '运营活动',
    billingPeriod: BillingPeriod.Monthly,
    startsAt: new Date('2026-11-01T00:00:00+08:00'),
    endsAt: new Date('2027-12-31T23:59:59+08:00'),
    prices: { [MembershipTier.Plus]: 7000 },
    ...overrides,
  };
}

describe('AF-516 活动运营服务', () => {
  it('创建活动时补默认受众和自动命中', async () => {
    const { service, rows } = createService();

    const created = await service.create('admin-1', dto());

    expect(created.status).toBe('draft');
    expect(created.audience).toBe('first_purchase');
    expect(created.autoApply).toBe(true);
    expect(created.prices[MembershipTier.Plus]).toBe(7000);
    expect(created.floors[MembershipTier.Plus]).toBeUndefined();
    expect(rows).toHaveLength(1);
  });

  it('运营价击穿会员档底价时拒绝落库', async () => {
    const { service, rows } = createService();

    await expect(service.create('admin-1', dto({ prices: { [MembershipTier.Plus]: 5000 } }))).rejects.toThrow();

    expect(rows).toHaveLength(0);
  });

  it('活动码重复时拒绝创建', async () => {
    const { service } = createService();
    await service.create('admin-1', dto());
    await expect(service.create('admin-2', dto({ name: '另一个活动' }))).rejects.toThrow(/已存在/);
  });
});
