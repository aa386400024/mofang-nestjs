import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, IsNull, LessThanOrEqual, type EntityManager, type Repository } from 'typeorm';

import { MembershipAccountService } from './membership-account.service.js';
import { MembershipPlanGrantService } from './membership-plan-grant.service.js';
import { MembershipPricingService } from './membership-pricing.service.js';
import { MembershipPromotionReservationService } from './membership-promotion-reservation.service.js';
import { MembershipPromotionService } from './membership-promotion.service.js';
import { QuotaLedgerService } from './quota-ledger.service.js';
import { MetricsService } from '../../shared/infra/metrics/index.js';
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
    @Optional()
    private readonly promotionService?: MembershipPromotionService,
    @Optional()
    private readonly reservationService?: MembershipPromotionReservationService,
    @Optional()
    private readonly planGrantService?: MembershipPlanGrantService,
    @Optional()
    private readonly metrics?: MetricsService,
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

    if (!this.promotionService) {
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

    const campaigns = await this.promotionService.listSellableCampaigns(billingPeriod, now);
    const redemptionCountByPromotion = await this.promotionService.redemptionCountsByPromotion(uid);
    const campaignBudgetRemainingCentsByPromotion = await this.promotionService.budgetRemainingByPromotion(campaigns);
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
      campaigns,
      redemptionCountByPromotion,
      campaignBudgetRemainingCentsByPromotion,
    });
  }

  /** 创建订单：幂等键命中直接返回原订单；支付通道未接时状态仍为 pending。 */
  async createOrder(uid: string, input: CreateMembershipOrderInput, now: Date = new Date()): Promise<MembershipOrderSummary> {
    if (input.idempotencyKey) {
      const existing = await this.orderRepo.findOne({ where: { uid, idempotencyKey: input.idempotencyKey } });
      if (existing) return this.toSummary(existing);
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        if (input.idempotencyKey) {
          const existing = await manager.getRepository(MembershipOrder).findOne({
            where: { uid, idempotencyKey: input.idempotencyKey },
          });
          if (existing) return this.toSummary(existing);
        }

        const addon = MEMBERSHIP_ADDONS.find((item) => item.id === input.productId);
        if (addon) return this.createAddonOrder(manager, uid, addon.id, input, now);

        const tier = this.parsePlanTier(input.productId);
        const quote = await this.quote(uid, input.productId, input.billingPeriod, input.couponDiscountCents ?? 0, input.promotionCode, now);
        const expiresAt = addDays(now, 0.5);
        const order = manager.getRepository(MembershipOrder).create({
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
          expiresAt,
        });

        if (quote.promotionId && this.reservationService) {
          await this.reservationService.reserve(manager, {
            uid,
            promotionId: quote.promotionId,
            orderId: order.id,
            discountCents: quote.promotionDiscountCents,
            giftMinutes: quote.giftMinutes,
            expiresAt,
            now,
          });
        }
        await manager.getRepository(MembershipOrder).save(order);
        return this.toSummary(order);
      });
    } catch (error) {
      // 幂等键唯一索引冲突：另一个并发请求已写入，回查返回同一订单，不把 500 抛给客户端。
      if (input.idempotencyKey && this.isDuplicateKey(error)) {
        const existing = await this.orderRepo.findOne({ where: { uid, idempotencyKey: input.idempotencyKey } });
        if (existing) return this.toSummary(existing);
      }
      throw error;
    }
  }

  /** 历史订单。 */
  async listOrders(uid: string, limit = 20): Promise<MembershipOrderSummary[]> {
    const orders = await this.orderRepo.find({ where: { uid }, order: { createdAt: 'DESC' }, take: limit });
    return orders.map((order) => this.toSummary(order));
  }

  /**
   * 支付成功回调 / 内部验单成功后调用。
   *
   * 同一事务内锁订单、开通账号、发配额、写订单 paid、活动兑换、确认预算预占；
   * 重复回调在订单行锁后看到 paid 直接返回，不会二次延长会员周期。
   * 真实支付通道未接时，本方法只能由内部测试或未来回调调用，控制器不暴露伪支付入口。
   */
  async markPaid(uid: string, orderId: string, now: Date = new Date()): Promise<MembershipOrderSummary> {
    const summary = await this.dataSource.transaction(async (manager) => {
      const orderRepo = manager.getRepository(MembershipOrder);
      const order = await orderRepo.findOne({ where: { id: orderId, uid }, lock: { mode: 'pessimistic_write' } });
      if (!order) throw new MembershipOrderError('订单不存在');
      if (order.status === MembershipOrderStatus.Paid) return this.toSummary(order);
      if (order.status !== MembershipOrderStatus.Pending) throw new MembershipOrderError(`订单状态 ${order.status} 不可支付`);

      await this.accountService.applyPaidOrder(
        {
          orderId: order.id,
          uid: order.uid,
          planId: order.planId,
          orderType: order.orderType,
          billingPeriod: order.billingPeriod,
          amountCents: order.amountCents,
          promotionId: order.promotionId,
          giftMinutes: order.giftMinutes,
          paidAt: now,
        },
        manager,
      );

      order.status = MembershipOrderStatus.Paid;
      order.paidAt = now;
      order.expiresAt = order.billingPeriod === BillingPeriod.Annual ? addDays(now, 365) : addDays(now, 30);
      await orderRepo.save(order);

      if (order.promotionId) {
        await this.recordRedemption(order, now, manager);
        await this.reservationService?.consume(order.id, manager);
      }
      return this.toSummary(order);
    });

    this.metrics?.incMembershipOrderPaid(summary.planId, summary.billingPeriod, summary.orderType);
    this.logger.log(`membership order paid uid=${uid} order=${orderId} amountCents=${summary.amountCents}`);
    return summary;
  }

  /**
   * 退款：目前只支持订单全额退款。
   *
   * 部分退款没有按比例回收权益的产品与财务口径，直接 fail-closed 拒绝，
   * 避免“退部分钱却把订单置为终态并收回全部权益”的错误语义。
   * 同一事务内完成订单状态、会员回退、term 终止、未使用 lot 收回、活动兑换撤销、预算预占释放。
   */
  async refund(uid: string, orderId: string, refundAmountCents: number, now: Date = new Date()): Promise<MembershipOrderSummary> {
    if (!Number.isInteger(refundAmountCents) || refundAmountCents < 0) {
      throw new MembershipOrderError('退款金额必须是 0..订单金额 的整数分');
    }

    const summary = await this.dataSource.transaction(async (manager) => {
      const orderRepo = manager.getRepository(MembershipOrder);
      const locked = await orderRepo.findOne({ where: { id: orderId, uid }, lock: { mode: 'pessimistic_write' } });
      if (!locked) throw new MembershipOrderError('订单不存在');
      if (locked.status !== MembershipOrderStatus.Paid) throw new MembershipOrderError(`订单状态 ${locked.status} 不可退款`);
      if (refundAmountCents > locked.amountCents) throw new MembershipOrderError('退款金额不能超过订单金额');
      if (refundAmountCents < locked.amountCents) {
        throw new MembershipOrderError('部分退款暂不支持：请按订单全额退款或走人工审批');
      }

      locked.status = MembershipOrderStatus.Refunded;
      locked.paidAt = locked.paidAt ?? now;
      await orderRepo.save(locked);

      const redemptionRepo = manager.getRepository(MembershipPromotionRedemption);
      await redemptionRepo.update({ uid, orderId }, { revokedAt: now });
      await this.quotaLedger.revokeOrderLots(uid, orderId, manager);
      await this.reservationService?.release(orderId, manager);
      await this.planGrantService?.cancelTermForOrder(uid, orderId, manager);
      await this.accountService.markOrderRefunded(uid, orderId, now, manager);
      return this.toSummary(locked);
    });

    this.metrics?.incMembershipOrderRefunded(summary.planId, summary.billingPeriod, summary.orderType);
    return summary;
  }

  /**
   * 关闭过期 pending 订单：订单行锁内确认仍 pending 且已过期，置 closed 并释放活动预占。
   *
   * 没有这一步，pending 订单会无限期可支付，预算预占被超时释放后仍可能被晚到回调占用，
   * 形成“预算已还给活动池、订单却还能付”的窗口。支付回调命中 closed 会直接拒绝。
   */
  async closeExpired(now: Date = new Date(), limit = 500): Promise<number> {
    const candidates = await this.orderRepo.find({
      where: { status: MembershipOrderStatus.Pending, expiresAt: LessThanOrEqual(now) },
      order: { expiresAt: 'ASC' },
      take: limit,
    });
    let closed = 0;
    for (const candidate of candidates) {
      const didClose = await this.dataSource.transaction(async (manager) => {
        const orderRepo = manager.getRepository(MembershipOrder);
        const order = await orderRepo.findOne({ where: { id: candidate.id }, lock: { mode: 'pessimistic_write' } });
        if (!order || order.status !== MembershipOrderStatus.Pending) return false;
        if (!order.expiresAt || order.expiresAt.getTime() > now.getTime()) return false;
        order.status = MembershipOrderStatus.Closed;
        await orderRepo.save(order);
        await this.reservationService?.release(order.id, manager);
        return true;
      });
      if (didClose) closed += 1;
    }
    if (closed > 0) this.logger.log(`membership pending orders closed rows=${closed}`);
    return closed;
  }

  private async createAddonOrder(
    manager: EntityManager,
    uid: string,
    addonId: string,
    input: CreateMembershipOrderInput,
    now: Date,
  ): Promise<MembershipOrderSummary> {
    const addon = MEMBERSHIP_ADDONS.find((item) => item.id === addonId);
    if (!addon) throw new MembershipOrderError('加包不存在');
    const orderRepo = manager.getRepository(MembershipOrder);
    const order = orderRepo.create({
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
    await orderRepo.save(order);
    return this.toSummary(order);
  }

  private async recordRedemption(order: MembershipOrder, now: Date, manager: EntityManager): Promise<void> {
    if (!order.promotionId) return;
    await manager
      .getRepository(MembershipPromotionRedemption)
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

  private isDuplicateKey(error: unknown): boolean {
    const code = (error as { driverError?: { code?: string }; code?: string })?.driverError?.code ?? (error as { code?: string })?.code;
    return code === 'ER_DUP_ENTRY' || code === '23505';
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
    return campaign.budgetCents === null ? null : Math.max(0, campaign.budgetCents - spent);
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
