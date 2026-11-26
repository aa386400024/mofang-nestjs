import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThanOrEqual, type EntityManager, type Repository } from 'typeorm';

import { MembershipPlanGrantService } from './membership-plan-grant.service.js';
import { QuotaLedgerService } from './quota-ledger.service.js';
import { Membership } from '../../profile/entities/membership.entity.js';
import {
  BillingPeriod,
  MembershipOrderStatus,
  MembershipOrderType,
  MembershipSource,
  MembershipStatus,
  MembershipTier,
} from '../domain/membership.enums.js';
import type {
  MembershipAccountSnapshot,
  MembershipOrderSummary,
  MembershipOverview,
  PaidOrderPayload,
} from '../domain/membership.types.js';
import { addMonths, addYears, currentPeriod, endOfDay, startOfDay } from '../domain/membership.utils.js';
import { MembershipOrder } from '../entities/membership-order.entity.js';
import { LEGACY_TIER_MAP, LEGACY_TIER_REVERSE_MAP, MEMBERSHIP_ADDONS, MEMBERSHIP_PLANS, getEntitlements } from '../membership.constants.js';

const LEGACY_BILLING_STATUS: Readonly<Record<MembershipTier, 'none' | 'monthly' | 'yearly'>> = {
  [MembershipTier.Free]: 'none',
  [MembershipTier.Plus]: 'monthly',
  [MembershipTier.Pro]: 'yearly',
  [MembershipTier.Max]: 'yearly',
};

/**
 * 会员账号服务 — 账号状态机、权益、旧字段兼容、订单开通。
 *
 * 单一真相源：tierV2 是唯一有效档位；tier 只是旧客户端镜像。
 * 订单开通在事务内完成，重复调用同一 orderId 幂等（订单状态由订单服务保证）。
 */
@Injectable()
export class MembershipAccountService {
  private readonly logger = new Logger(MembershipAccountService.name);

  constructor(
    @InjectRepository(Membership)
    private readonly repo: Repository<Membership>,
    @InjectRepository(MembershipOrder)
    private readonly orderRepo: Repository<MembershipOrder>,
    private readonly quotaLedger: QuotaLedgerService,
    private readonly dataSource: DataSource,
    @Optional()
    private readonly planGrantService?: MembershipPlanGrantService,
  ) {}

  /** 读取当前账号快照；不存在时初始化 Free 账号并发放 Free 月度/新人时长。 */
  async getAccount(uid: string, now: Date = new Date()): Promise<MembershipAccountSnapshot> {
    await this.planGrantService?.refreshForUid(uid, now);
    const membership = await this.ensureAccount(uid, now);
    await this.ensureFreeAllowance(membership, now);
    return this.toSnapshot(membership);
  }

  /**
   * 读取有效档位（语音/权益等下游只读入口）。
   *
   * 与 `getOverview().entitlements` 共用同一判定：仅 Active/Trial/Grace 且周期未到期
   * 才返回付费档，其余统一 Free。`periodEnd` 是订阅周期权威截止时间，缺失时才回落到
   * 旧 `expiresAt`，避免旧字段先行过期导致付费档被误降。
   */
  async getEffectiveTier(uid: string, now: Date = new Date()): Promise<MembershipTier> {
    await this.planGrantService?.refreshForUid(uid, now);
    const membership = await this.ensureAccount(uid, now);
    return this.resolveEffectiveTier(membership, now);
  }

  /** 会员总览：账号 + 配额 + 权益 + 可售档位/加包 + 最近订单。 */
  async getOverview(uid: string, now: Date = new Date()): Promise<MembershipOverview> {
    await this.planGrantService?.refreshForUid(uid, now);
    const membership = await this.ensureAccount(uid, now);
    await this.ensureFreeAllowance(membership, now);
    const effectiveTier = this.resolveEffectiveTier(membership, now);
    const plan = MEMBERSHIP_PLANS[effectiveTier];
    const quota = await this.quotaLedger.getBalance(uid, plan.monthlyMinutes, membership.periodStart, now);
    const recentOrders = await this.orderRepo.find({
      where: { uid },
      order: { createdAt: 'DESC' },
      take: 5,
    });

    return {
      account: this.toSnapshot(membership),
      quota,
      entitlements: getEntitlements(effectiveTier),
      availablePlans: Object.values(MEMBERSHIP_PLANS),
      availableAddons: MEMBERSHIP_ADDONS,
      recentOrders: recentOrders.map((order) => this.toOrderSummary(order)),
      paymentReserved: true,
      legacyStatus: LEGACY_BILLING_STATUS[effectiveTier],
      legacyTier: LEGACY_TIER_REVERSE_MAP[membership.tierV2 ?? effectiveTier],
    };
  }

  /**
   * 支付成功后开通/续费。订单服务只需要保证“已支付”事实，账号服务负责状态与发放。
   * 加包订单只发配额，不改会员档位与周期。
   *
   * 传入 manager 时复用调用方事务：订单 paid、账号开通、配额发放、活动兑换必须同生共死。
   */
  async applyPaidOrder(payload: PaidOrderPayload, manager?: EntityManager): Promise<MembershipAccountSnapshot> {
    if (manager) return this.applyPaidOrderInManager(manager, payload);
    return this.dataSource.transaction((transactionManager) => this.applyPaidOrderInManager(transactionManager, payload));
  }

  private async applyPaidOrderInManager(manager: EntityManager, payload: PaidOrderPayload): Promise<MembershipAccountSnapshot> {
    const membershipRepo = manager.getRepository(Membership);
    let membership = await membershipRepo.findOne({ where: { uid: payload.uid }, lock: { mode: 'pessimistic_write' } });
    membership ??= membershipRepo.create({
      uid: payload.uid,
      status: MembershipStatus.Inactive,
      tier: 'free',
      tierV2: MembershipTier.Free,
      legacyTier: 'free',
      source: MembershipSource.System,
      autoRenew: false,
    });

    if (payload.orderType === MembershipOrderType.Addon) {
      const addon = MEMBERSHIP_ADDONS.find((item) => item.id === payload.planId);
      if (!addon) throw new Error(`未知加包: ${payload.planId}`);
      await this.quotaLedger.grantAddon(payload.uid, addon, payload.orderId, payload.paidAt, manager);
      await membershipRepo.save(membership);
      return this.toSnapshot(membership);
    }

    const tier = this.parseTier(payload.planId);
    const plan = MEMBERSHIP_PLANS[tier];
    const previousTier = membership.tierV2;
    const nowActive = this.isActive(membership, payload.paidAt);
    const sameTier = previousTier === tier;
    const periodStart = nowActive && sameTier && membership.periodEnd ? membership.periodEnd : payload.paidAt;
    const periodEnd = payload.billingPeriod === BillingPeriod.Annual ? addYears(periodStart, 1) : addMonths(periodStart, 1);
    // 当前周期未结束时续费：periodStart 在未来，首期不能在今天提前发，否则用户同时拿到两个周期。
    const startsNow = periodStart.getTime() <= payload.paidAt.getTime();

    if (this.planGrantService && (!sameTier || !nowActive)) {
      await this.planGrantService.cancelActiveTerms(payload.uid, payload.orderId, manager);
    }

    membership.status = MembershipStatus.Active;
    membership.tierV2 = tier;
    membership.tier = LEGACY_TIER_REVERSE_MAP[tier];
    membership.legacyTier = previousTier ?? membership.legacyTier ?? membership.tier;
    membership.expiresAt = periodEnd;
    membership.periodStart = nowActive && sameTier && membership.periodStart ? membership.periodStart : periodStart;
    membership.periodEnd = periodEnd;
    membership.autoRenew = true;
    membership.source = MembershipSource.Order;
    membership.lastOrderId = payload.orderId;
    membership.quotaPeriod = currentPeriod(payload.paidAt);
    await membershipRepo.save(membership);

    await (payload.billingPeriod === BillingPeriod.Annual
      ? this.grantAnnual(manager, payload, plan, periodStart, periodEnd, startsNow)
      : this.grantMonthly(manager, payload, plan, periodStart, periodEnd, startsNow));
    if (payload.giftMinutes > 0 && payload.promotionId) {
      await this.quotaLedger.grantPromotion(payload.uid, payload.giftMinutes, payload.orderId, payload.promotionId, periodEnd, manager);
    }
    return this.toSnapshot(membership);
  }

  private async grantAnnual(
    manager: EntityManager,
    payload: PaidOrderPayload,
    plan: (typeof MEMBERSHIP_PLANS)[MembershipTier],
    periodStart: Date,
    periodEnd: Date,
    startsNow: boolean,
  ): Promise<void> {
    if (this.planGrantService) {
      if (startsNow) {
        const firstMonthEnd = this.minDate(addMonths(periodStart, 1), periodEnd);
        await this.quotaLedger.grantPlan(payload.uid, plan, payload.orderId, firstMonthEnd, manager, 'plan:1');
      }
      await this.planGrantService.createAnnualTerm(manager, {
        uid: payload.uid,
        orderId: payload.orderId,
        tier: this.parseTier(payload.planId),
        termStart: periodStart,
        termEnd: periodEnd,
        monthsTotal: 12,
        firstMonthGranted: startsNow,
      });
      return;
    }
    // 兼容没有 planGrantService 的旧单测/降级装配：退回一次性 12 个月，不静默少发。
    const fallbackPlan = { ...plan, monthlyMinutes: plan.monthlyMinutes * 12 };
    await this.quotaLedger.grantPlan(payload.uid, fallbackPlan, payload.orderId, periodEnd, manager, 'plan:fallback');
  }

  private async grantMonthly(
    manager: EntityManager,
    payload: PaidOrderPayload,
    plan: (typeof MEMBERSHIP_PLANS)[MembershipTier],
    periodStart: Date,
    periodEnd: Date,
    startsNow: boolean,
  ): Promise<void> {
    if (startsNow) {
      await this.quotaLedger.grantPlan(payload.uid, plan, payload.orderId, periodEnd, manager, 'plan:1');
      return;
    }
    if (this.planGrantService) {
      // 未来周期月付续费：登记 1 个月 term，由 cron 在周期起点发 plan:1。
      await this.planGrantService.createMonthlyTerm(manager, {
        uid: payload.uid,
        orderId: payload.orderId,
        tier: this.parseTier(payload.planId),
        termStart: periodStart,
        termEnd: periodEnd,
        firstMonthGranted: false,
      });
      return;
    }
    // 无 term 调度器的降级装配：只能即时发，保持旧行为。
    await this.quotaLedger.grantPlan(payload.uid, plan, payload.orderId, periodEnd, manager);
  }

  /** 退款：只有退款订单仍是当前生效订单时才回退会员状态，避免误伤后续续费。 */
  async markOrderRefunded(uid: string, orderId: string, now: Date = new Date(), manager?: EntityManager): Promise<void> {
    if (manager) return this.markOrderRefundedInManager(manager, uid, orderId, now);
    await this.dataSource.transaction((transactionManager) => this.markOrderRefundedInManager(transactionManager, uid, orderId, now));
  }

  private async markOrderRefundedInManager(manager: EntityManager, uid: string, orderId: string, now: Date): Promise<void> {
    const repo = manager.getRepository(Membership);
    const membership = await repo.findOne({ where: { uid }, lock: { mode: 'pessimistic_write' } });
    if (!membership || membership.lastOrderId !== orderId) return;
    membership.status = MembershipStatus.Refunded;
    membership.autoRenew = false;
    membership.expiresAt = now;
    membership.periodEnd = now;
    await repo.save(membership);
  }

  /** 到期扫描：active/grace 且已过期 → expired。不删档位，权益按 Free 解析。 */
  async expireDue(now: Date = new Date()): Promise<number> {
    const result = await this.repo.update(
      { status: In([MembershipStatus.Active, MembershipStatus.Grace]), expiresAt: LessThanOrEqual(now) },
      { status: MembershipStatus.Expired },
    );
    return result.affected ?? 0;
  }

  /** 用户是否从未付過订阅订单。 */
  async isFirstPurchase(uid: string): Promise<boolean> {
    const count = await this.orderRepo.count({
      where: { uid, orderType: MembershipOrderType.Subscription, status: MembershipOrderStatus.Paid },
    });
    return count === 0;
  }

  private async ensureAccount(uid: string, now: Date): Promise<Membership> {
    let membership = await this.repo.findOne({ where: { uid } });
    if (membership) {
      if (!membership.tierV2) {
        membership.tierV2 = LEGACY_TIER_MAP[membership.tier] ?? MembershipTier.Free;
        await this.repo.save(membership);
      }
      return membership;
    }
    try {
      membership = await this.repo.save(
        this.repo.create({
          uid,
          status: MembershipStatus.Inactive,
          tier: 'free',
          tierV2: MembershipTier.Free,
          legacyTier: 'free',
          source: MembershipSource.System,
          autoRenew: false,
          quotaPeriod: currentPeriod(now),
        }),
      );
      return membership;
    } catch {
      const retry = await this.repo.findOne({ where: { uid } });
      if (retry) return retry;
      throw new Error('ensureAccount race retry failed');
    }
  }

  /**
   * Free 月度 30 分钟 + 新用户一次性 50 分钟。
   *
   * 只有 Free 账号需要；付费账号的套餐分钟由订单开通时发放。
   * 两类 lot 都按 `uid + source + orderId` 幂等，重复调用不会叠加。
   */
  private async ensureFreeAllowance(membership: Membership, now: Date): Promise<void> {
    if (this.resolveEffectiveTier(membership, now) !== MembershipTier.Free) return;

    const period = currentPeriod(now);
    const monthEnd = endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    await this.quotaLedger.grantPlan(membership.uid, MEMBERSHIP_PLANS[MembershipTier.Free], `free-month-${period}`, monthEnd);

    const newUserExpiry = addMonths(startOfDay(now), 12);
    const isNewUser = membership.createdAt ? now.getTime() - membership.createdAt.getTime() <= 30 * 86_400_000 : false;
    if (isNewUser) {
      await this.quotaLedger.grantPromotion(
        membership.uid,
        MEMBERSHIP_PLANS[MembershipTier.Free].newUserBonusMinutes,
        `new-user-bonus-${membership.uid}`,
        'new_user_bonus',
        newUserExpiry,
      );
    }
  }

  private resolveEffectiveTier(membership: Membership, now: Date): MembershipTier {
    if (!this.isActive(membership, now)) return MembershipTier.Free;
    return membership.tierV2 ?? LEGACY_TIER_MAP[membership.tier] ?? MembershipTier.Free;
  }

  private isActive(membership: Membership, now: Date): boolean {
    if (![MembershipStatus.Active, MembershipStatus.Trial, MembershipStatus.Grace].includes(membership.status)) {
      return false;
    }
    // periodEnd 是 v2 订阅周期权威字段；老数据可能只有 expiresAt，按“有 periodEnd 以它为准”回落。
    const endsAt = membership.periodEnd ?? membership.expiresAt;
    return !endsAt || endsAt.getTime() > now.getTime();
  }

  private parseTier(planId: string): MembershipTier {
    const tier = Object.values(MembershipTier).find((item) => item === planId);
    if (!tier || tier === MembershipTier.Free) throw new Error(`未知或不可购买的档位: ${planId}`);
    return tier;
  }

  private minDate(left: Date, right: Date): Date {
    return left.getTime() < right.getTime() ? left : right;
  }

  private toSnapshot(membership: Membership): MembershipAccountSnapshot {
    return {
      uid: membership.uid,
      status: membership.status,
      tier: membership.tierV2 ?? LEGACY_TIER_MAP[membership.tier] ?? MembershipTier.Free,
      legacyTier: membership.tier,
      expiresAt: membership.expiresAt,
      periodStart: membership.periodStart,
      periodEnd: membership.periodEnd,
      autoRenew: membership.autoRenew,
      source: membership.source,
      lastOrderId: membership.lastOrderId,
    };
  }

  private toOrderSummary(order: MembershipOrder): MembershipOrderSummary {
    return {
      id: order.id,
      uid: order.uid,
      planId: order.planId,
      productName: this.orderProductName(order),
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

  private orderProductName(order: MembershipOrder): string {
    if (order.orderType === MembershipOrderType.Addon) {
      return MEMBERSHIP_ADDONS.find((item) => item.id === order.planId)?.name ?? order.planId;
    }
    const tier = Object.values(MembershipTier).find((item) => item === order.planId) ?? MembershipTier.Free;
    return MEMBERSHIP_PLANS[tier].name;
  }

  /** 调试用：输出当前账号的日志摘要，不包含心理内容。 */
  logSummary(snapshot: MembershipAccountSnapshot): void {
    this.logger.log(`membership uid=${snapshot.uid} tier=${snapshot.tier} status=${snapshot.status}`);
  }
}
