import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, IsNull, type Repository } from 'typeorm';

import { MembershipAccountService } from './membership-account.service.js';
import { MembershipPricingService } from './membership-pricing.service.js';
import { QuotaLedgerService } from './quota-ledger.service.js';
import { BillingPeriod, MembershipOrderStatus, MembershipOrderType, MembershipTier, PaymentChannel } from '../domain/membership.enums.js';
import type { CreateMembershipOrderInput, MembershipOrderSummary, PriceQuote } from '../domain/membership.types.js';
import { addDays } from '../domain/membership.utils.js';
import { MembershipOrder } from '../entities/membership-order.entity.js';
import { MembershipPromotionRedemption } from '../entities/membership-promotion-redemption.entity.js';
import { MEMBERSHIP_ADDONS, MEMBERSHIP_CAMPAIGNS, MEMBERSHIP_PLANS } from '../membership.constants.js';

export class MembershipOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MembershipOrderError';
  }
}

/**
 * 订单服务 — 下单、订单查询、支付成功开通、退款追回。
 *
 * 价格由 PricingService 计算；活动由 PromotionEnginePort 判定；
 * 订单服务只做“冻结快照 + 状态机 + 调账号/账本”。
 */
@Injectable()
export class MembershipOrderService {
  private readonly logger = new Logger(MembershipOrderService.name);

  constructor(
    @InjectRepository(MembershipOrder)
    private readonly orderRepo: Repository<MembershipOrder>,
    @InjectRepository(MembershipPromotionRedemption)
    private readonly redemptionRepo: Repository<MembershipPromotionRedemption>,
    private readonly accountService: MembershipAccountService,
    private readonly pricingService: MembershipPricingService,
    private readonly quotaLedger: QuotaLedgerService,
    private readonly dataSource: DataSource,
  ) {}

  /** 预览价格：供客户端展示原价、活动价、优惠券后价与底价。 */
  async quote(
    uid: string,
    productId: string,
    billingPeriod: BillingPeriod = BillingPeriod.Monthly,
    couponDiscountCents = 0,
    campaignCode?: string,
    now: Date = new Date(),
  ): Promise<PriceQuote> {
    const addon = MEMBERSHIP_ADDONS.find((item) => item.id === productId);
    if (addon) {
      const tier = (await this.accountService.getAccount(uid, now)).tier;
      return {
        tier,
        billingPeriod,
        listPriceCents: addon.priceCents,
        basePriceCents: addon.priceCents,
        campaignPriceCents: addon.priceCents,
        renewalPriceCents: addon.priceCents,
        floorPriceCents: addon.priceCents,
        promotionId: null,
        promotionName: null,
        promotionDiscountCents: 0,
        couponDiscountCents: 0,
        amountCents: addon.priceCents,
        giftMinutes: 0,
        currency: 'CNY',
        periodMinutes: addon.minutes,
        ttsModel: MEMBERSHIP_PLANS[tier].ttsModel,
        ruleVersion: 'membership-addon-v1',
      };
    }

    const tier = this.parsePlanTier(productId);
    const firstPurchase = await this.accountService.isFirstPurchase(uid);
    const redemptionCount = await this.redemptionRepo.count({ where: { uid, revokedAt: IsNull() } });
    const campaignBudgetRemainingCents = await this.campaignBudgetRemaining(billingPeriod);

    return this.pricingService.quote({
      uid,
      tier,
      billingPeriod,
      isFirstPurchase: firstPurchase,
      now,
      couponDiscountCents,
      campaignCode,
      redemptionCount,
      campaignBudgetRemainingCents,
    });
  }

  /** 创建订单：幂等键命中直接返回原订单；支付通道未接时状态仍为 pending。 */
  async createOrder(uid: string, input: CreateMembershipOrderInput, now: Date = new Date()): Promise<MembershipOrderSummary> {
    if (input.idempotencyKey) {
      const existing = await this.orderRepo.findOne({ where: { uid, idempotencyKey: input.idempotencyKey } });
      if (existing) return this.toSummary(existing);
    }

    const addon = MEMBERSHIP_ADDONS.find((item) => item.id === input.productId);
    if (addon) return this.createAddonOrder(uid, addon.id, input, now);

    const tier = this.parsePlanTier(input.productId);
    const quote = await this.quote(uid, input.productId, input.billingPeriod, input.couponDiscountCents ?? 0, input.promotionCode, now);

    const order = this.orderRepo.create({
      id: randomUUID(),
      uid,
      planId: tier,
      orderType: MembershipOrderType.Subscription,
      billingPeriod: input.billingPeriod,
      listAmountCents: quote.listPriceCents,
      discountCents: quote.promotionDiscountCents + quote.couponDiscountCents,
      amountCents: quote.amountCents,
      giftMinutes: quote.giftMinutes,
      currency: 'CNY',
      status: MembershipOrderStatus.Pending,
      paymentChannel: input.paymentChannel,
      idempotencyKey: input.idempotencyKey ?? null,
      promotionId: quote.promotionId,
      couponCode: input.promotionCode ?? null,
      paidAt: null,
      expiresAt: addDays(now, 0.5),
    });
    await this.orderRepo.save(order);
    return this.toSummary(order);
  }

  /** 历史订单。 */
  async listOrders(uid: string, limit = 20): Promise<MembershipOrderSummary[]> {
    const orders = await this.orderRepo.find({ where: { uid }, order: { createdAt: 'DESC' }, take: limit });
    return orders.map((order) => this.toSummary(order));
  }

  /**
   * 支付成功回调 / 内部验单成功后调用。
   *
   * 先开通账号与发放配额，再落订单 paid；账号侧按 orderId 幂等，重复回调不会重复发放。
   * 真实支付通道未接时，本方法只能由内部测试或未来回调调用，控制器不暴露伪支付入口。
   */
  async markPaid(uid: string, orderId: string, now: Date = new Date()): Promise<MembershipOrderSummary> {
    const order = await this.orderRepo.findOne({ where: { id: orderId, uid } });
    if (!order) throw new MembershipOrderError('订单不存在');
    if (order.status === MembershipOrderStatus.Paid) return this.toSummary(order);
    if (order.status !== MembershipOrderStatus.Pending) throw new MembershipOrderError(`订单状态 ${order.status} 不可支付`);

    await this.accountService.applyPaidOrder({
      orderId: order.id,
      uid: order.uid,
      planId: order.planId,
      orderType: order.orderType,
      billingPeriod: order.billingPeriod,
      amountCents: order.amountCents,
      promotionId: order.promotionId,
      giftMinutes: order.giftMinutes,
      paidAt: now,
    });

    order.status = MembershipOrderStatus.Paid;
    order.paidAt = now;
    order.expiresAt = order.billingPeriod === BillingPeriod.Annual ? addDays(now, 365) : addDays(now, 30);
    await this.orderRepo.save(order);

    if (order.promotionId) {
      await this.recordRedemption(order, now);
    }
    this.logger.log(`membership order paid uid=${uid} order=${orderId} amountCents=${order.amountCents}`);
    return this.toSummary(order);
  }

  /**
   * 退款：7 天内未使用全额、已使用按剩余天数比例由业务侧计算后传入 refundAmountCents。
   * 本方法负责状态、活动兑换追回、该订单发放的未使用 lot 收回。
   */
  async refund(uid: string, orderId: string, refundAmountCents: number, now: Date = new Date()): Promise<MembershipOrderSummary> {
    const order = await this.orderRepo.findOne({ where: { id: orderId, uid } });
    if (!order) throw new MembershipOrderError('订单不存在');
    if (order.status !== MembershipOrderStatus.Paid) throw new MembershipOrderError(`订单状态 ${order.status} 不可退款`);
    if (!Number.isInteger(refundAmountCents) || refundAmountCents < 0 || refundAmountCents > order.amountCents) {
      throw new MembershipOrderError('退款金额必须是 0..订单金额 的整数分');
    }

    await this.dataSource.transaction(async (manager) => {
      const orderRepo = manager.getRepository(MembershipOrder);
      const locked = await orderRepo.findOne({ where: { id: orderId, uid }, lock: { mode: 'pessimistic_write' } });
      if (!locked || locked.status !== MembershipOrderStatus.Paid) throw new MembershipOrderError('订单状态已变化');
      locked.status = MembershipOrderStatus.Refunded;
      locked.paidAt = locked.paidAt ?? now;
      await orderRepo.save(locked);

      const redemptionRepo = manager.getRepository(MembershipPromotionRedemption);
      await redemptionRepo.update({ uid, orderId }, { revokedAt: now });
      await this.quotaLedger.revokeOrderLots(uid, orderId, manager);
    });

    order.status = MembershipOrderStatus.Refunded;
    await this.accountService.markOrderRefunded(uid, orderId, now);
    return this.toSummary(order);
  }

  private async createAddonOrder(
    uid: string,
    addonId: string,
    input: CreateMembershipOrderInput,
    now: Date,
  ): Promise<MembershipOrderSummary> {
    const addon = MEMBERSHIP_ADDONS.find((item) => item.id === addonId);
    if (!addon) throw new MembershipOrderError('加包不存在');
    const order = this.orderRepo.create({
      id: randomUUID(),
      uid,
      planId: addon.id,
      orderType: MembershipOrderType.Addon,
      billingPeriod: BillingPeriod.Monthly,
      listAmountCents: addon.priceCents,
      discountCents: 0,
      amountCents: addon.priceCents,
      giftMinutes: 0,
      currency: 'CNY',
      status: MembershipOrderStatus.Pending,
      paymentChannel: input.paymentChannel,
      idempotencyKey: input.idempotencyKey ?? null,
      promotionId: null,
      couponCode: null,
      paidAt: null,
      expiresAt: addDays(now, 0.5),
    });
    await this.orderRepo.save(order);
    return this.toSummary(order);
  }

  private async recordRedemption(order: MembershipOrder, now: Date): Promise<void> {
    if (!order.promotionId) return;
    await this.redemptionRepo
      .createQueryBuilder()
      .insert()
      .into(MembershipPromotionRedemption)
      .values({
        id: randomUUID(),
        uid: order.uid,
        promotionId: order.promotionId,
        orderId: order.id,
        discountCents: order.discountCents,
        grantedMinutes: order.giftMinutes,
        revokedAt: null,
        createdAt: now,
      })
      .orIgnore()
      .execute();
  }

  private async campaignBudgetRemaining(billingPeriod: BillingPeriod): Promise<number | null> {
    const campaign = MEMBERSHIP_CAMPAIGNS.find((item) => item.billingPeriod === billingPeriod);
    if (!campaign) return null;
    const raw = await this.redemptionRepo
      .createQueryBuilder('r')
      .select('COALESCE(SUM(r.discountCents), 0)', 'spent')
      .where('r.promotionId = :promotionId', { promotionId: campaign.id })
      .andWhere('r.revokedAt IS NULL')
      .getRawOne<{ spent: string }>();
    const spent = Number(raw?.spent ?? 0);
    return Math.max(0, campaign.budgetCents - spent);
  }

  private parsePlanTier(productId: string): MembershipTier {
    const tier = Object.values(MembershipTier).find((item) => item === productId);
    if (!tier || tier === MembershipTier.Free) throw new MembershipOrderError(`未知或不可购买的档位: ${productId}`);
    return tier;
  }

  private toSummary(order: MembershipOrder): MembershipOrderSummary {
    return {
      id: order.id,
      uid: order.uid,
      planId: order.planId,
      productName: this.productName(order),
      orderType: order.orderType,
      billingPeriod: order.billingPeriod,
      listAmountCents: order.listAmountCents,
      discountCents: order.discountCents,
      amountCents: order.amountCents,
      giftMinutes: order.giftMinutes,
      status: order.status,
      paymentChannel: order.paymentChannel,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      expiresAt: order.expiresAt,
    };
  }

  private productName(order: MembershipOrder): string {
    if (order.orderType === MembershipOrderType.Addon) {
      return MEMBERSHIP_ADDONS.find((item) => item.id === order.planId)?.name ?? order.planId;
    }
    const tier = Object.values(MembershipTier).find((item) => item === order.planId) ?? MembershipTier.Free;
    return MEMBERSHIP_PLANS[tier].name;
  }
}

/** 允许客户端选择的支付通道；当前全部落 reserved，不返回伪 paid。 */
export const SUPPORTED_PAYMENT_CHANNELS: readonly PaymentChannel[] = [
  PaymentChannel.Wechat,
  PaymentChannel.Alipay,
  PaymentChannel.AppleIap,
  PaymentChannel.Reserved,
] as const;
