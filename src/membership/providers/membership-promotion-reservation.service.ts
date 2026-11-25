import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { In, IsNull, MoreThan, type EntityManager, type Repository } from 'typeorm';

import { BizCode } from '../../common/exceptions/biz-code.enum.js';
import { BizException } from '../../common/exceptions/biz.exception.js';
import { MetricsService } from '../../shared/infra/metrics/index.js';
import { MembershipPromotionReservationStatus } from '../domain/membership.enums.js';
import { MembershipPromotionRedemption } from '../entities/membership-promotion-redemption.entity.js';
import { MembershipPromotionReservation } from '../entities/membership-promotion-reservation.entity.js';
import { MembershipPromotion } from '../entities/membership-promotion.entity.js';
import type { MembershipCampaignDefinition } from '../membership.constants.js';

export interface ReservePromotionInput {
  readonly uid: string;
  readonly promotionId: string;
  readonly orderId: string;
  readonly discountCents: number;
  readonly giftMinutes: number;
  readonly expiresAt: Date;
  readonly now?: Date;
}

/**
 * 活动预算/限次预占服务。
 *
 * 事务边界由调用方（订单服务）控制：reserve 必须和订单写入在同一个事务；
 * consume / release 也在支付、退款事务内调用，避免“订单状态变了但预占没变”。
 */
@Injectable()
export class MembershipPromotionReservationService {
  private readonly logger = new Logger(MembershipPromotionReservationService.name);

  constructor(
    @InjectRepository(MembershipPromotionReservation)
    private readonly reservationRepo: Repository<MembershipPromotionReservation>,
    @Optional()
    private readonly metrics?: MetricsService,
  ) {}

  /**
   * 下单预占：锁活动行 → 校验预算/限次 → 写 held。
   *
   * 同一订单重复调用直接返回已有预占，不重复占用。
   */
  async reserve(manager: EntityManager, input: ReservePromotionInput): Promise<MembershipPromotionReservation | null> {
    const reservationRepo = manager.getRepository(MembershipPromotionReservation);
    const existing = await reservationRepo.findOne({ where: { orderId: input.orderId } });
    if (existing) return existing;

    const promotionRepo = manager.getRepository(MembershipPromotion);
    const promotion = await promotionRepo.findOne({
      where: { id: input.promotionId, deletedAt: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });
    if (!promotion || promotion.status !== 'active') {
      // 活动在下单瞬间被下架：不静默给活动价，让客户端重新报价。
      this.incReservation('rejected');
      throw new BizException(BizCode.MembershipPromotionInvalid, '活动已下架，请重新报价');
    }

    const now = input.now ?? new Date();
    const spentCents = await this.sumSpent(manager, input.promotionId);
    const heldCents = await this.sumHeld(manager, input.promotionId, now);
    if (promotion.budgetCents !== null && spentCents + heldCents + Math.max(0, input.discountCents) > promotion.budgetCents) {
      this.incReservation('rejected');
      throw new BizException(BizCode.MembershipPromotionBudgetExhausted, '活动名额已用完，请重新报价');
    }

    const paidCount = await manager.getRepository(MembershipPromotionRedemption).count({
      where: { uid: input.uid, promotionId: input.promotionId, revokedAt: IsNull() },
    });
    const heldCount = await reservationRepo.count({
      where: {
        uid: input.uid,
        promotionId: input.promotionId,
        status: MembershipPromotionReservationStatus.Held,
        expiresAt: MoreThan(now),
      },
    });
    if (paidCount + heldCount >= promotion.perUserLimit) {
      this.incReservation('rejected');
      throw new BizException(BizCode.MembershipPromotionPerUserLimit, `该活动每位用户限 ${promotion.perUserLimit} 次`);
    }

    const row = reservationRepo.create({
      id: randomUUID(),
      uid: input.uid,
      promotionId: input.promotionId,
      orderId: input.orderId,
      discountCents: Math.max(0, input.discountCents),
      giftMinutes: Math.max(0, input.giftMinutes),
      status: MembershipPromotionReservationStatus.Held,
      expiresAt: input.expiresAt,
    });
    const saved = await reservationRepo.save(row);
    this.incReservation('held');
    return saved;
  }

  /** 支付成功：held → consumed。缺预占（旧订单/无活动）直接跳过。 */
  async consume(orderId: string, manager: EntityManager): Promise<number> {
    const result = await manager
      .getRepository(MembershipPromotionReservation)
      .update({ orderId, status: MembershipPromotionReservationStatus.Held }, { status: MembershipPromotionReservationStatus.Consumed });
    if ((result.affected ?? 0) > 0) this.incReservation('consumed');
    return result.affected ?? 0;
  }

  /** 退款/取消：held 或 consumed → released，释放预算与限次。 */
  async release(orderId: string, manager: EntityManager): Promise<number> {
    const result = await manager
      .getRepository(MembershipPromotionReservation)
      .update(
        { orderId, status: In([MembershipPromotionReservationStatus.Held, MembershipPromotionReservationStatus.Consumed]) },
        { status: MembershipPromotionReservationStatus.Released },
      );
    if ((result.affected ?? 0) > 0) this.incReservation('released');
    return result.affected ?? 0;
  }

  /** 报价用：按活动汇总未过期 held 金额。 */
  async reservedByPromotion(campaigns: readonly MembershipCampaignDefinition[], now: Date = new Date()): Promise<Record<string, number>> {
    if (campaigns.length === 0) return {};
    const ids = campaigns.map((campaign) => campaign.id);
    const rows = await this.reservationRepo
      .createQueryBuilder('r')
      .select('r.promotionId', 'promotionId')
      .addSelect('COALESCE(SUM(r.discountCents), 0)', 'held')
      .where('r.promotionId IN (:...ids)', { ids })
      .andWhere('r.status = :status', { status: MembershipPromotionReservationStatus.Held })
      .andWhere('r.expiresAt > :now', { now })
      .groupBy('r.promotionId')
      .getRawMany<{ promotionId: string; held: string }>();
    return Object.fromEntries(rows.map((row) => [row.promotionId, Number(row.held)]));
  }

  /** 报价用：按活动汇总用户未过期 held 次数，避免 pending 订单绕过单用户限次。 */
  async heldCountsByUid(uid: string, now: Date = new Date()): Promise<Record<string, number>> {
    const rows = await this.reservationRepo
      .createQueryBuilder('r')
      .select('r.promotionId', 'promotionId')
      .addSelect('COUNT(*)', 'count')
      .where('r.uid = :uid', { uid })
      .andWhere('r.status = :status', { status: MembershipPromotionReservationStatus.Held })
      .andWhere('r.expiresAt > :now', { now })
      .groupBy('r.promotionId')
      .getRawMany<{ promotionId: string; count: string }>();
    return Object.fromEntries(rows.map((row) => [row.promotionId, Number(row.count)]));
  }

  /** 统计用：活动当前 held 预占金额与笔数。 */
  async statsForPromotion(promotionId: string, now: Date = new Date()): Promise<{ heldCents: number; heldCount: number }> {
    const raw = await this.reservationRepo
      .createQueryBuilder('r')
      .select('COALESCE(SUM(r.discountCents), 0)', 'heldCents')
      .addSelect('COUNT(*)', 'heldCount')
      .where('r.promotionId = :promotionId', { promotionId })
      .andWhere('r.status = :status', { status: MembershipPromotionReservationStatus.Held })
      .andWhere('r.expiresAt > :now', { now })
      .getRawOne<{ heldCents: string; heldCount: string }>();
    return { heldCents: Number(raw?.heldCents ?? 0), heldCount: Number(raw?.heldCount ?? 0) };
  }

  /** cron：释放已过期 held 的安全网；保留 1 小时宽限，确保订单过期关闭 cron 先跑。 */
  async cleanupExpired(now: Date = new Date()): Promise<number> {
    // 订单过期关闭 cron 每 10 分钟跑一次；这里再留 1 小时宽限，避免预占先于订单关闭被释放，
    // 造成“额度已回池、订单仍 pending 可支付”的超卖窗口。订单事务失败超过 1 小时才由本 cron 兜底。
    const cutoff = new Date(now.getTime() - 60 * 60 * 1000);
    const result = await this.reservationRepo
      .createQueryBuilder()
      .update(MembershipPromotionReservation)
      .set({ status: MembershipPromotionReservationStatus.Released })
      .where('status = :status', { status: MembershipPromotionReservationStatus.Held })
      .andWhere('expiresAt <= :cutoff', { cutoff })
      .execute();
    const affected = result.affected ?? 0;
    if (affected > 0) {
      this.incReservation('expired', affected);
      this.logger.log(`活动预占超时释放 rows=${affected}`);
    }
    return affected;
  }

  private async sumSpent(manager: EntityManager, promotionId: string): Promise<number> {
    const raw = await manager
      .getRepository(MembershipPromotionRedemption)
      .createQueryBuilder('r')
      .select('COALESCE(SUM(r.discountCents), 0)', 'spent')
      .where('r.promotionId = :promotionId', { promotionId })
      .andWhere('r.revokedAt IS NULL')
      .getRawOne<{ spent: string }>();
    return Number(raw?.spent ?? 0);
  }

  private async sumHeld(manager: EntityManager, promotionId: string, now: Date): Promise<number> {
    const raw = await manager
      .getRepository(MembershipPromotionReservation)
      .createQueryBuilder('r')
      .select('COALESCE(SUM(r.discountCents), 0)', 'held')
      .where('r.promotionId = :promotionId', { promotionId })
      .andWhere('r.status = :status', { status: MembershipPromotionReservationStatus.Held })
      .andWhere('r.expiresAt > :now', { now })
      .getRawOne<{ held: string }>();
    return Number(raw?.held ?? 0);
  }

  private incReservation(result: 'held' | 'consumed' | 'released' | 'expired' | 'rejected', count = 1): void {
    this.metrics?.incMembershipPromotionReservation(result, count);
  }
}
