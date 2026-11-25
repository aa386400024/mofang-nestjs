import { Injectable } from '@nestjs/common';

import { BillingPeriod, MembershipOrderStatus, PaymentChannel } from '../../membership/domain/membership.enums.js';
import type { MembershipOverview, MembershipOrderSummary } from '../../membership/domain/membership.types.js';
import { MEMBERSHIP_ADDONS, MEMBERSHIP_PLANS } from '../../membership/membership.constants.js';
import { MembershipAccountService } from '../../membership/providers/membership-account.service.js';
import { MembershipOrderService } from '../../membership/providers/membership-order.service.js';
import { type CreateOrderDto, type MembershipOverviewDto, type OrderDto, type ProductDto } from '../dto/billing.dto.js';

/**
 * 旧 /billing/* 兼容层。
 *
 * V0.5 的 4 个单次 SKU 已下线（旧 99/199 档负毛利）；本层把 v2 的
 * 4 档 + 分钟加包映射成旧 ProductDto 形状，并把新字段一并返回。
 * 真实支付未接：订单仍为 pending，paymentReserved=true。
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly accountService: MembershipAccountService,
    private readonly orderService: MembershipOrderService,
  ) {}

  async getMembershipOverview(userId: string): Promise<MembershipOverviewDto> {
    const overview = await this.accountService.getOverview(userId);
    return this.toOverview(overview, userId);
  }

  async listAvailableProducts(): Promise<ProductDto[]> {
    return [...this.planProducts(), ...this.addonProducts()];
  }

  async createOrder(userId: string, dto: CreateOrderDto): Promise<OrderDto> {
    const order = await this.orderService.createOrder(userId, {
      productId: dto.productId,
      billingPeriod: dto.billingPeriod === 'annual' ? BillingPeriod.Annual : BillingPeriod.Monthly,
      paymentChannel: dto.paymentChannel as PaymentChannel,
      idempotencyKey: dto.idempotencyKey,
    });
    return this.toOrder(order, userId);
  }

  async listOrders(userId: string): Promise<OrderDto[]> {
    const orders = await this.orderService.listOrders(userId);
    return orders.map((order) => this.toOrder(order, userId));
  }

  private toOverview(overview: MembershipOverview, userId: string): MembershipOverviewDto {
    const quota = overview.quota;
    const membership: MembershipOverviewDto['membership'] = {
      status: overview.legacyStatus as MembershipOverviewDto['membership']['status'],
      expiresAt: overview.account.expiresAt,
      autoRenew: overview.account.autoRenew,
      remainingQuota: {
        sessions: Math.floor(quota.totalRemainingMinutes / 10),
        ttsChars: 0,
      },
      tier: overview.account.tier,
      minutesRemaining: quota.totalRemainingMinutes,
      periodStart: overview.account.periodStart,
      periodEnd: overview.account.periodEnd,
    };
    return {
      membership,
      recentOrders: overview.recentOrders.map((order) => this.toOrder(order, userId)),
      availableProducts: [...this.planProducts(), ...this.addonProducts()],
      plans: this.planProducts(),
      addons: this.addonProducts(),
      currentRole: 'counselor_learner',
      paymentReserved: true,
    };
  }

  private planProducts(): ProductDto[] {
    return Object.values(MEMBERSHIP_PLANS)
      .filter((plan) => plan.isPaid)
      .map((plan) => ({
        id: plan.id,
        name: plan.name,
        description: plan.description,
        priceCents: plan.promoPriceCents ?? plan.renewalPriceCents,
        durationDays: 30,
        quota: { sessions: Math.floor(plan.monthlyMinutes / 10), ttsChars: 0 },
        kind: 'plan' as const,
        minutes: plan.monthlyMinutes,
        renewalPriceCents: plan.renewalPriceCents,
        annualPriceCents: plan.annualPriceCents,
      }));
  }

  private addonProducts(): ProductDto[] {
    return MEMBERSHIP_ADDONS.map((addon) => ({
      id: addon.id,
      name: addon.name,
      description: addon.description,
      priceCents: addon.priceCents,
      durationDays: addon.validMonths * 30,
      quota: { sessions: Math.floor(addon.minutes / 10), ttsChars: 0 },
      kind: 'addon' as const,
      minutes: addon.minutes,
    }));
  }

  private toOrder(order: MembershipOrderSummary, userId: string): OrderDto {
    const paymentChannel = order.paymentChannel === 'wechat' || order.paymentChannel === 'alipay' ? order.paymentChannel : 'reserved';
    return {
      id: order.id,
      userId,
      productId: order.planId,
      productName: order.productName,
      amountCents: order.amountCents,
      paymentChannel,
      status: this.toLegacyOrderStatus(order.status),
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      billingPeriod: order.billingPeriod,
      discountCents: order.discountCents,
    };
  }

  private toLegacyOrderStatus(status: MembershipOrderStatus): 'pending' | 'paid' | 'failed' | 'refunded' {
    if (status === MembershipOrderStatus.Paid) return 'paid';
    if (status === MembershipOrderStatus.Refunded) return 'refunded';
    if (status === MembershipOrderStatus.Failed || status === MembershipOrderStatus.Closed) return 'failed';
    return 'pending';
  }
}
