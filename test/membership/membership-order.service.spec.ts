import { describe, expect, it, vi } from 'vitest';

import {
  BillingPeriod,
  MembershipOrderStatus,
  MembershipOrderType,
  MembershipTier,
  PaymentChannel,
} from '../../src/membership/domain/membership.enums.js';
import { MembershipOrder } from '../../src/membership/entities/membership-order.entity.js';
import { MembershipOrderService } from '../../src/membership/providers/membership-order.service.js';

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o-1',
    uid: 'u-1',
    planId: MembershipTier.Plus,
    orderType: MembershipOrderType.Subscription,
    billingPeriod: BillingPeriod.Monthly,
    listAmountCents: 18_800,
    discountCents: 12_000,
    amountCents: 6800,
    giftMinutes: 0,
    currency: 'CNY',
    status: MembershipOrderStatus.Pending,
    paymentChannel: PaymentChannel.Reserved,
    idempotencyKey: 'idem-1',
    promotionId: 'campaign_first_monthly_2026',
    couponCode: null,
    createdAt: new Date('2026-11-25T12:00:00+08:00'),
    paidAt: null,
    expiresAt: null,
    updatedAt: new Date('2026-11-25T12:00:00+08:00'),
    ...overrides,
  };
}

function createService() {
  const orderRepo = {
    findOne: vi.fn(),
    find: vi.fn().mockResolvedValue([]),
    save: vi.fn(async (value: unknown) => value),
    create: vi.fn((value: unknown) => value),
  };
  const chain = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    getRawOne: vi.fn().mockResolvedValue({ spent: '0' }),
    insert: vi.fn().mockReturnThis(),
    into: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    orIgnore: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue({}),
  };
  const redemptionRepo = {
    count: vi.fn().mockResolvedValue(0),
    createQueryBuilder: vi.fn(() => chain),
    update: vi.fn().mockResolvedValue({}),
  };
  const accountService = {
    isFirstPurchase: vi.fn().mockResolvedValue(true),
    applyPaidOrder: vi.fn().mockResolvedValue({}),
    markOrderRefunded: vi.fn().mockResolvedValue({}),
    getAccount: vi.fn().mockResolvedValue({ tier: MembershipTier.Plus }),
  };
  const pricingService = {
    quote: vi.fn().mockReturnValue({
      tier: MembershipTier.Plus,
      billingPeriod: BillingPeriod.Monthly,
      listPriceCents: 18_800,
      basePriceCents: 6800,
      campaignPriceCents: 6800,
      renewalPriceCents: 8800,
      floorPriceCents: 6800,
      promotionId: 'campaign_first_monthly_2026',
      promotionName: '新用户首期活动',
      promotionDiscountCents: 12_000,
      couponDiscountCents: 0,
      amountCents: 6800,
      giftMinutes: 0,
      currency: 'CNY',
      periodMinutes: 240,
      ttsModel: 'turbo',
      ruleVersion: 'membership-promotion-v1',
    }),
  };
  const quotaLedger = {
    revokeOrderLots: vi.fn().mockResolvedValue(0),
  };
  const reservationService = {
    consume: vi.fn().mockResolvedValue(1),
    release: vi.fn().mockResolvedValue(1),
    reserve: vi.fn().mockResolvedValue({}),
  };
  const planGrantService = {
    cancelTermForOrder: vi.fn().mockResolvedValue(1),
  };
  const metrics = {
    incMembershipOrderPaid: vi.fn(),
    incMembershipOrderRefunded: vi.fn(),
  };
  const dataSource = {
    transaction: async (callback: (manager: unknown) => unknown) =>
      callback({
        getRepository: (entity: unknown) => (entity === MembershipOrder ? orderRepo : redemptionRepo),
      }),
  };
  const service = new MembershipOrderService(
    orderRepo as never,
    redemptionRepo as never,
    accountService as never,
    pricingService as never,
    quotaLedger as never,
    dataSource as never,
    undefined,
    reservationService as never,
    planGrantService as never,
    metrics as never,
  );
  return { service, orderRepo, redemptionRepo, accountService, pricingService, reservationService, planGrantService, metrics };
}

describe('AF-512 会员订单', () => {
  it('创建订单只落 pending，不伪造 paid', async () => {
    const { service, orderRepo } = createService();
    orderRepo.create.mockImplementation((value) => value);
    const summary = await service.createOrder('u-1', {
      productId: MembershipTier.Plus,
      billingPeriod: BillingPeriod.Monthly,
      paymentChannel: PaymentChannel.Reserved,
      idempotencyKey: 'idem-1',
    });

    expect(summary.status).toBe(MembershipOrderStatus.Pending);
    expect(summary.paidAt).toBeNull();
    expect(summary.amountCents).toBe(6800);
    expect(summary.discountCents).toBe(12_000);
    expect(orderRepo.save).toHaveBeenCalledTimes(1);
  });

  it('同一幂等键重复提交返回原订单，不新建', async () => {
    const { service, orderRepo } = createService();
    orderRepo.findOne.mockResolvedValue(order());
    const summary = await service.createOrder('u-1', {
      productId: MembershipTier.Plus,
      billingPeriod: BillingPeriod.Monthly,
      paymentChannel: PaymentChannel.Reserved,
      idempotencyKey: 'idem-1',
    });

    expect(summary.id).toBe('o-1');
    expect(orderRepo.save).not.toHaveBeenCalled();
  });

  it('支付成功回调把订单 giftMinutes 传给账号开通', async () => {
    const { service, orderRepo, redemptionRepo, accountService, reservationService, metrics } = createService();
    orderRepo.findOne.mockResolvedValue(order({ giftMinutes: 30 }));
    const summary = await service.markPaid('u-1', 'o-1');

    expect(summary.status).toBe(MembershipOrderStatus.Paid);
    expect(accountService.applyPaidOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'o-1',
        giftMinutes: 30,
        paidAt: expect.any(Date),
      }),
      expect.anything(),
    );
    expect(orderRepo.save).toHaveBeenCalledTimes(1); // 仅订单 paid 状态
    expect(redemptionRepo.createQueryBuilder).toHaveBeenCalled();
    expect(reservationService.consume).toHaveBeenCalledWith('o-1', expect.anything());
    expect(metrics.incMembershipOrderPaid).toHaveBeenCalledWith(
      MembershipTier.Plus,
      BillingPeriod.Monthly,
      MembershipOrderType.Subscription,
    );
  });

  it('已支付订单重复回调直接返回，不重复发放', async () => {
    const { service, orderRepo, accountService } = createService();
    orderRepo.findOne.mockResolvedValue(order({ status: MembershipOrderStatus.Paid }));
    const summary = await service.markPaid('u-1', 'o-1');

    expect(summary.status).toBe(MembershipOrderStatus.Paid);
    expect(accountService.applyPaidOrder).not.toHaveBeenCalled();
  });

  it('退款成功：订单置 refunded、收回未使用 lot、回退会员、终止 term、释放预占', async () => {
    const { service, orderRepo, accountService, planGrantService, reservationService, metrics } = createService();
    orderRepo.findOne.mockResolvedValue(order({ status: MembershipOrderStatus.Paid, amountCents: 6800 }));
    const summary = await service.refund('u-1', 'o-1', 6800);

    expect(summary.status).toBe(MembershipOrderStatus.Refunded);
    expect(accountService.markOrderRefunded).toHaveBeenCalledWith('u-1', 'o-1', expect.any(Date), expect.anything());
    expect(planGrantService.cancelTermForOrder).toHaveBeenCalledWith('u-1', 'o-1', expect.anything());
    expect(reservationService.release).toHaveBeenCalledWith('o-1', expect.anything());
    expect(metrics.incMembershipOrderRefunded).toHaveBeenCalledWith(
      MembershipTier.Plus,
      BillingPeriod.Monthly,
      MembershipOrderType.Subscription,
    );
  });

  it('部分退款直接拒绝：订单与权益不变化', async () => {
    const { service, orderRepo, accountService, planGrantService, reservationService } = createService();
    const paid = order({ status: MembershipOrderStatus.Paid, amountCents: 6800 });
    orderRepo.findOne.mockResolvedValue(paid);

    await expect(service.refund('u-1', 'o-1', 3000)).rejects.toThrow('部分退款');

    expect(paid.status).toBe(MembershipOrderStatus.Paid);
    expect(orderRepo.save).not.toHaveBeenCalled();
    expect(accountService.markOrderRefunded).not.toHaveBeenCalled();
    expect(planGrantService.cancelTermForOrder).not.toHaveBeenCalled();
    expect(reservationService.release).not.toHaveBeenCalled();
  });

  it('退款金额超出订单金额直接拒绝', async () => {
    const { service, orderRepo } = createService();
    orderRepo.findOne.mockResolvedValue(order({ status: MembershipOrderStatus.Paid, amountCents: 6800 }));
    await expect(service.refund('u-1', 'o-1', 6801)).rejects.toThrow('退款金额');
  });

  it('过期 pending 订单关闭并释放活动预占；支付回调随后命中 closed 被拒绝', async () => {
    const { service, orderRepo, reservationService } = createService();
    const now = new Date('2026-11-26T00:00:00+08:00');
    const expired = order({ expiresAt: new Date('2026-11-25T23:00:00+08:00') });
    orderRepo.find.mockResolvedValue([expired]);
    orderRepo.findOne.mockResolvedValue(expired);

    await expect(service.closeExpired(now)).resolves.toBe(1);

    expect(expired.status).toBe(MembershipOrderStatus.Closed);
    expect(orderRepo.save).toHaveBeenCalledTimes(1);
    expect(reservationService.release).toHaveBeenCalledWith('o-1', expect.anything());

    await expect(service.markPaid('u-1', 'o-1', now)).rejects.toThrow('不可支付');
  });
});
