import { describe, expect, it, vi } from 'vitest';

import { BizCode } from '../../src/common/exceptions/biz-code.enum.js';
import { MembershipController } from '../../src/membership/controllers/membership.controller.js';
import { BillingPeriod, MembershipTier, PaymentChannel } from '../../src/membership/domain/membership.enums.js';

function createController() {
  const accountService = { getOverview: vi.fn() };
  const orderService = {
    quote: vi.fn().mockResolvedValue({ amountCents: 6800 }),
    createOrder: vi.fn().mockResolvedValue({ id: 'o-1' }),
  };
  const quotaLedger = {};
  const controller = new MembershipController(accountService as never, orderService as never, quotaLedger as never);
  return { controller, orderService };
}

describe('AF-517 客户端优惠券入口', () => {
  it('报价传非零优惠券金额直接 50011 拒绝，不透传给报价服务', async () => {
    const { controller, orderService } = createController();

    await expect(
      controller.getQuote({ userId: 'u-1' }, { productId: MembershipTier.Plus, couponDiscountCents: 12_000 }),
    ).rejects.toMatchObject({ code: BizCode.MembershipCouponUnsupported });
    expect(orderService.quote).not.toHaveBeenCalled();
  });

  it('报价传 0 或省略优惠券时按服务端价格计算', async () => {
    const { controller, orderService } = createController();

    await controller.getQuote({ userId: 'u-1' }, { productId: MembershipTier.Plus, couponDiscountCents: 0 });

    expect(orderService.quote).toHaveBeenCalledWith('u-1', MembershipTier.Plus, BillingPeriod.Monthly, 0, undefined);
  });

  it('下单传非零优惠券金额直接 50011 拒绝，不创建订单', async () => {
    const { controller, orderService } = createController();

    await expect(
      controller.createOrder(
        { userId: 'u-1' },
        {
          productId: MembershipTier.Plus,
          billingPeriod: BillingPeriod.Monthly,
          paymentChannel: PaymentChannel.Reserved,
          couponDiscountCents: 5000,
        },
      ),
    ).rejects.toMatchObject({ code: BizCode.MembershipCouponUnsupported });
    expect(orderService.createOrder).not.toHaveBeenCalled();
  });
});
