import { describe, expect, it, vi } from 'vitest';

import { BizCode } from '../../src/common/exceptions/biz-code.enum.js';
import {
  MembershipPromotionAudience,
  MembershipPromotionReservationStatus,
  MembershipPromotionStatus,
  MembershipTier,
} from '../../src/membership/domain/membership.enums.js';
import { MembershipPromotionRedemption } from '../../src/membership/entities/membership-promotion-redemption.entity.js';
import { MembershipPromotionReservation } from '../../src/membership/entities/membership-promotion-reservation.entity.js';
import { MembershipPromotion } from '../../src/membership/entities/membership-promotion.entity.js';
import { MembershipPromotionReservationService } from '../../src/membership/providers/membership-promotion-reservation.service.js';

function promotion(overrides: Partial<MembershipPromotion> = {}): MembershipPromotion {
  return {
    id: 'p-1',
    code: 'FIRST_MONTHLY',
    name: '首期活动',
    description: '',
    status: MembershipPromotionStatus.Active,
    billingPeriod: 'monthly' as never,
    audience: MembershipPromotionAudience.FirstPurchase,
    autoApply: true,
    startsAt: new Date('2026-11-01T00:00:00+08:00'),
    endsAt: new Date('2027-12-31T23:59:59+08:00'),
    prices: { [MembershipTier.Plus]: 6800 },
    floors: { [MembershipTier.Plus]: 6800 },
    giftMinutes: {},
    budgetCents: 1000,
    perUserLimit: 1,
    priority: 100,
    ruleVersion: 'membership-promotion-v1',
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function createManager(options: {
  budgetCents?: number | null;
  perUserLimit?: number;
  spent?: number;
  held?: number;
  paidCount?: number;
  heldCount?: number;
}) {
  const promotionRow = promotion({
    budgetCents: options.budgetCents === undefined ? 1000 : options.budgetCents,
    perUserLimit: options.perUserLimit ?? 1,
  });
  const existingReservation = vi.fn().mockResolvedValue(null);
  const managerReservationRepo = {
    findOne: existingReservation,
    count: vi.fn().mockResolvedValue(options.heldCount ?? 0),
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: unknown) => value),
  };
  const promotionRepo = { findOne: vi.fn().mockResolvedValue(promotionRow) };
  const redemptionRepo = {
    count: vi.fn().mockResolvedValue(options.paidCount ?? 0),
    createQueryBuilder: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getRawOne: vi.fn().mockResolvedValue({ spent: String(options.spent ?? 0) }),
    })),
  };
  // sumHeld 用的是同一个 managerReservationRepo 的 query builder；与 count 分开返回。
  (managerReservationRepo as Record<string, unknown>)['createQueryBuilder'] = vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    addSelect: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    getRawOne: vi.fn().mockResolvedValue({ held: String(options.held ?? 0) }),
  }));
  const manager = {
    getRepository: (entity: unknown) => {
      if (entity === MembershipPromotion) return promotionRepo;
      if (entity === MembershipPromotionReservation) return managerReservationRepo;
      if (entity === MembershipPromotionRedemption) return redemptionRepo;
      throw new Error('unexpected entity');
    },
  };
  return { manager, managerReservationRepo, promotionRepo, redemptionRepo };
}

function createService() {
  const outerRepo = {
    findOne: vi.fn(),
    createQueryBuilder: vi.fn(),
  };
  const service = new MembershipPromotionReservationService(outerRepo as never);
  return { service, outerRepo };
}

const NOW = new Date('2026-11-26T12:00:00+08:00');

describe('AF-517 活动预算/限次预占', () => {
  it('已支付 + held + 本次折扣超过预算时拒绝预占', async () => {
    const { service } = createService();
    const { manager } = createManager({ budgetCents: 1000, spent: 600, held: 300 });

    await expect(
      service.reserve(manager as never, {
        uid: 'u-1',
        promotionId: 'p-1',
        orderId: 'o-1',
        discountCents: 200,
        giftMinutes: 0,
        expiresAt: new Date(NOW.getTime() + 60_000),
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: BizCode.MembershipPromotionBudgetExhausted });
  });

  it('同一用户已支付 + pending 预占达到限次时拒绝', async () => {
    const { service } = createService();
    const { manager } = createManager({ budgetCents: null, perUserLimit: 1, paidCount: 1, heldCount: 0 });

    await expect(
      service.reserve(manager as never, {
        uid: 'u-1',
        promotionId: 'p-1',
        orderId: 'o-2',
        discountCents: 100,
        giftMinutes: 0,
        expiresAt: new Date(NOW.getTime() + 60_000),
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: BizCode.MembershipPromotionPerUserLimit });
  });

  it('预算内成功写入 held 预占，并保留金额/分钟/过期时间', async () => {
    const { service } = createService();
    const { manager, managerReservationRepo } = createManager({ budgetCents: 5000, spent: 0, held: 0 });

    const row = await service.reserve(manager as never, {
      uid: 'u-1',
      promotionId: 'p-1',
      orderId: 'o-3',
      discountCents: 1200,
      giftMinutes: 30,
      expiresAt: new Date(NOW.getTime() + 60_000),
      now: NOW,
    });

    expect(row).toMatchObject({
      status: MembershipPromotionReservationStatus.Held,
      discountCents: 1200,
      giftMinutes: 30,
    });
    expect(managerReservationRepo.save).toHaveBeenCalledTimes(1);
  });

  it('同订单重复预占直接返回原记录，不二次占用额度', async () => {
    const { service } = createService();
    const { manager, promotionRepo } = createManager({});
    const existing = { id: 'r-1', orderId: 'o-4', discountCents: 100 };
    const managerReservationRepo = manager.getRepository(MembershipPromotionReservation) as unknown as {
      findOne: ReturnType<typeof vi.fn>;
    };
    managerReservationRepo.findOne.mockResolvedValue(existing);

    const row = await service.reserve(manager as never, {
      uid: 'u-1',
      promotionId: 'p-1',
      orderId: 'o-4',
      discountCents: 100,
      giftMinutes: 0,
      expiresAt: new Date(NOW.getTime() + 60_000),
      now: NOW,
    });

    expect(row).toBe(existing);
    expect(promotionRepo.findOne).not.toHaveBeenCalled();
  });

  it('清理过期 held：状态改为 released 并返回条数', async () => {
    const { service, outerRepo } = createService();
    const execute = vi.fn().mockResolvedValue({ affected: 3 });
    outerRepo.createQueryBuilder.mockReturnValue({
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      execute,
    });

    await expect(service.cleanupExpired(NOW)).resolves.toBe(3);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
