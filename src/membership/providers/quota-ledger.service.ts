import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, In, MoreThan, type EntityManager } from 'typeorm';

import { allocateQuota, refundAllocations } from './quota-allocator.js';
import { MembershipTier, QuotaLotSource } from '../domain/membership.enums.js';
import type {
  MembershipAddonDefinition,
  MembershipPlanDefinition,
  MembershipQuotaBalance,
  QuotaAllocation,
  QuotaLotSnapshot,
} from '../domain/membership.types.js';
import { addDays, addMonths, startOfDay } from '../domain/membership.utils.js';
import { MembershipQuotaLot } from '../entities/membership-quota-lot.entity.js';
import { MembershipQuotaReservation } from '../entities/membership-quota-reservation.entity.js';
import { MEMBERSHIP_PLANS, MEMBERSHIP_QUOTA_RULES } from '../membership.constants.js';

export class QuotaInsufficientError extends Error {
  constructor(
    public readonly requestedMinutes: number,
    public readonly availableMinutes: number,
  ) {
    super(`配额不足：需要 ${requestedMinutes} 分钟，可用 ${availableMinutes} 分钟`);
    this.name = 'QuotaInsufficientError';
  }
}

export class QuotaLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaLimitError';
  }
}

export class QuotaDailyLimitError extends QuotaLimitError {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaDailyLimitError';
  }
}

export class QuotaSessionLimitError extends QuotaLimitError {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaSessionLimitError';
  }
}

export class QuotaReservationNotFoundError extends QuotaLimitError {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaReservationNotFoundError';
  }
}

export interface ReserveResult {
  readonly reservationId: string;
  readonly reservedMinutes: number;
  readonly balance: MembershipQuotaBalance;
  readonly idempotent: boolean;
}

export interface SettleResult {
  readonly reservationId: string;
  readonly status: 'held' | 'settled' | 'released';
  readonly settledMinutes: number;
  readonly shortfallMinutes: number;
  readonly balance: MembershipQuotaBalance;
}

/**
 * 配额账本 — 发放 / 余额 / 预扣 / 结算 / 释放。
 *
 * 事务边界：所有扣减与写入在同一个 DataSource.transaction 内；
 * 并发预扣用 pessimistic_write 锁 lot，sessionId 唯一保证重复请求幂等。
 */
@Injectable()
export class QuotaLedgerService {
  private readonly logger = new Logger(QuotaLedgerService.name);

  constructor(private readonly dataSource: DataSource) {}

  /** 套餐发放：按订单 + 可选子键幂等（年付按月用 referenceKey=plan:N）。 */
  async grantPlan(
    uid: string,
    plan: MembershipPlanDefinition,
    orderId: string,
    periodEnd: Date,
    manager?: EntityManager,
    referenceKey: string | null = null,
  ): Promise<void> {
    if (plan.monthlyMinutes <= 0) return;
    await this.grantOnce(uid, QuotaLotSource.Plan, plan.monthlyMinutes, periodEnd, orderId, null, manager, referenceKey);
  }

  /** 加包发放：12 个月有效，按订单幂等。 */
  async grantAddon(uid: string, addon: MembershipAddonDefinition, orderId: string, now: Date, manager?: EntityManager): Promise<void> {
    const expiresAt = addMonths(now, addon.validMonths);
    await this.grantOnce(uid, QuotaLotSource.Addon, addon.minutes, expiresAt, orderId, addon.id, manager);
  }

  /** 活动赠送：按 campaign + order 幂等，过期时间由活动决定。 */
  async grantPromotion(
    uid: string,
    minutes: number,
    orderId: string,
    campaignId: string,
    expiresAt: Date,
    manager?: EntityManager,
  ): Promise<void> {
    if (minutes <= 0) return;
    await this.grantOnce(uid, QuotaLotSource.Promotion, minutes, expiresAt, orderId, campaignId, manager);
  }

  /** 迁移存量：一次性导入，不产生订单号。 */
  async grantMigration(uid: string, minutes: number, expiresAt: Date, referenceId: string, manager?: EntityManager): Promise<void> {
    if (minutes <= 0) return;
    await this.grantOnce(uid, QuotaLotSource.Migration, minutes, expiresAt, referenceId, 'legacy', manager);
  }

  /** 当前可用余额。 */
  async getBalance(
    uid: string,
    includedMinutesThisPeriod = 0,
    periodStart?: Date | null,
    now: Date = new Date(),
  ): Promise<MembershipQuotaBalance> {
    const lotRepo = this.dataSource.getRepository(MembershipQuotaLot);
    const lots = await lotRepo.find({
      where: { uid, minutesRemaining: MoreThan(0), expiresAt: MoreThan(now) },
    });

    const report: Record<QuotaLotSource, number> = {
      [QuotaLotSource.Plan]: 0,
      [QuotaLotSource.Promotion]: 0,
      [QuotaLotSource.Addon]: 0,
      [QuotaLotSource.Migration]: 0,
    };
    for (const lot of lots) {
      report[lot.source] += lot.minutesRemaining;
    }

    const reservationRepo = this.dataSource.getRepository(MembershipQuotaReservation);
    const periodStartDate = periodStart ?? new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const periodRows = await reservationRepo.find({
      where: { uid, createdAt: MoreThan(periodStartDate) },
    });
    const usedMinutesThisPeriod = periodRows.filter((row) => row.status === 'settled').reduce((sum, row) => sum + row.settledMinutes, 0);

    const dayRows = await reservationRepo.find({
      where: { uid, createdAt: MoreThan(startOfDay(now)), status: In(['held', 'settled']) },
    });
    const dailyUsedMinutes = dayRows.reduce((sum, row) => sum + (row.status === 'held' ? row.reservedMinutes : row.settledMinutes), 0);

    return {
      planMinutes: report[QuotaLotSource.Plan],
      promotionMinutes: report[QuotaLotSource.Promotion],
      addonMinutes: report[QuotaLotSource.Addon],
      migrationMinutes: report[QuotaLotSource.Migration],
      totalRemainingMinutes:
        report[QuotaLotSource.Plan] + report[QuotaLotSource.Promotion] + report[QuotaLotSource.Addon] + report[QuotaLotSource.Migration],
      includedMinutesThisPeriod,
      usedMinutesThisPeriod,
      dailyUsedMinutes,
      dailyLimitMinutes: MEMBERSHIP_QUOTA_RULES.dailyLimitMinutes,
      preDeductMinutes: MEMBERSHIP_QUOTA_RULES.preDeductMinutes,
      singleSessionLimitMinutes: MEMBERSHIP_QUOTA_RULES.singleSessionLimitMinutes,
    };
  }

  /**
   * 预扣：默认 10 分钟，最多 50 分钟；每日上限 180 分钟。
   * 同一 sessionId 重复调用返回原 reservation，不重复扣。
   */
  async reserve(
    uid: string,
    sessionId: string,
    requestedMinutes: number = MEMBERSHIP_QUOTA_RULES.preDeductMinutes,
    now: Date = new Date(),
  ): Promise<ReserveResult> {
    if (requestedMinutes <= 0 || requestedMinutes > MEMBERSHIP_QUOTA_RULES.singleSessionLimitMinutes) {
      throw new QuotaSessionLimitError(`单场预扣必须在 1-${MEMBERSHIP_QUOTA_RULES.singleSessionLimitMinutes} 分钟之间`);
    }

    return this.dataSource.transaction(async (manager) => {
      const reservationRepo = manager.getRepository(MembershipQuotaReservation);
      const existing = await reservationRepo.findOne({ where: { sessionId, uid }, lock: { mode: 'pessimistic_write' } });
      if (existing) {
        return {
          reservationId: existing.id,
          reservedMinutes: existing.reservedMinutes,
          balance: await this.getBalanceWithManager(manager, uid, now),
          idempotent: true,
        };
      }

      const dayRows = await reservationRepo.find({
        where: { uid, createdAt: MoreThan(startOfDay(now)), status: In(['held', 'settled']) },
      });
      const dailyUsed = dayRows.reduce((sum, row) => sum + (row.status === 'held' ? row.reservedMinutes : row.settledMinutes), 0);
      if (dailyUsed + requestedMinutes > MEMBERSHIP_QUOTA_RULES.dailyLimitMinutes) {
        throw new QuotaDailyLimitError(`今日剩余额度不足：已用 ${dailyUsed} 分钟，上限 ${MEMBERSHIP_QUOTA_RULES.dailyLimitMinutes} 分钟`);
      }

      const lots = await this.loadLotsForUpdate(manager, uid, now);
      const allocation = allocateQuota(lots, requestedMinutes, now);
      if (allocation.allocatedMinutes < requestedMinutes) {
        throw new QuotaInsufficientError(requestedMinutes, allocation.allocatedMinutes);
      }

      await this.applyAllocations(manager, allocation.allocations, -1, now);
      const reservation = reservationRepo.create({
        id: randomUUID(),
        uid,
        sessionId,
        allocations: [...allocation.allocations],
        reservedMinutes: allocation.allocatedMinutes,
        settledMinutes: 0,
        shortfallMinutes: 0,
        status: 'held',
        expiresAt: addDays(now, 1),
      });
      await reservationRepo.save(reservation);

      return {
        reservationId: reservation.id,
        reservedMinutes: reservation.reservedMinutes,
        balance: await this.getBalanceWithManager(manager, uid, now),
        idempotent: false,
      };
    });
  }

  /**
   * 结算：实际用量可小于/大于预扣。
   * 超出预扣时继续扣余额；余额不足则记录 shortfall，余额永不为负。
   */
  async settle(uid: string, reservationId: string, actualMinutes: number, now: Date = new Date()): Promise<SettleResult> {
    if (actualMinutes < 0 || actualMinutes > MEMBERSHIP_QUOTA_RULES.singleSessionLimitMinutes) {
      throw new QuotaSessionLimitError(`单场实际用量必须在 0-${MEMBERSHIP_QUOTA_RULES.singleSessionLimitMinutes} 分钟之间`);
    }

    return this.dataSource.transaction(async (manager) => {
      const reservationRepo = manager.getRepository(MembershipQuotaReservation);
      const reservation = await reservationRepo.findOne({ where: { id: reservationId, uid }, lock: { mode: 'pessimistic_write' } });
      if (!reservation) throw new QuotaReservationNotFoundError('预扣记录不存在');
      if (reservation.status !== 'held') {
        return {
          reservationId: reservation.id,
          status: reservation.status,
          settledMinutes: reservation.settledMinutes,
          shortfallMinutes: reservation.shortfallMinutes,
          balance: await this.getBalanceWithManager(manager, uid, now),
        };
      }

      let settledMinutes = reservation.reservedMinutes;
      let shortfallMinutes = 0;

      if (actualMinutes > reservation.reservedMinutes) {
        const extraNeeded = actualMinutes - reservation.reservedMinutes;
        const lots = await this.loadLotsForUpdate(manager, uid, now);
        const extra = allocateQuota(lots, extraNeeded, now);
        await this.applyAllocations(manager, extra.allocations, -1, now);
        settledMinutes += extra.allocatedMinutes;
        shortfallMinutes = actualMinutes - settledMinutes;
      } else if (actualMinutes < reservation.reservedMinutes) {
        const refundMinutes = reservation.reservedMinutes - actualMinutes;
        const refunds = refundAllocations(reservation.allocations, refundMinutes);
        await this.applyAllocations(manager, refunds, 1, now);
        settledMinutes = actualMinutes;
      }

      reservation.status = 'settled';
      reservation.settledMinutes = settledMinutes;
      reservation.shortfallMinutes = shortfallMinutes;
      await reservationRepo.save(reservation);

      if (shortfallMinutes > 0) {
        this.logger.warn(`配额结算出现 shortfall uid=${uid} reservation=${reservationId} shortfall=${shortfallMinutes}`);
      }

      return {
        reservationId: reservation.id,
        status: reservation.status,
        settledMinutes,
        shortfallMinutes,
        balance: await this.getBalanceWithManager(manager, uid, now),
      };
    });
  }

  /** 释放预扣：全额退回原路径，用于会话取消/启动失败。 */
  async release(uid: string, reservationId: string, now: Date = new Date()): Promise<SettleResult> {
    return this.dataSource.transaction(async (manager) => {
      const reservationRepo = manager.getRepository(MembershipQuotaReservation);
      const reservation = await reservationRepo.findOne({ where: { id: reservationId, uid }, lock: { mode: 'pessimistic_write' } });
      if (!reservation) throw new QuotaReservationNotFoundError('预扣记录不存在');
      if (reservation.status !== 'held') {
        return {
          reservationId: reservation.id,
          status: reservation.status,
          settledMinutes: reservation.settledMinutes,
          shortfallMinutes: reservation.shortfallMinutes,
          balance: await this.getBalanceWithManager(manager, uid, now),
        };
      }

      await this.applyAllocations(manager, reservation.allocations, 1, now);
      reservation.status = 'released';
      reservation.settledMinutes = 0;
      await reservationRepo.save(reservation);

      return {
        reservationId: reservation.id,
        status: reservation.status,
        settledMinutes: 0,
        shortfallMinutes: 0,
        balance: await this.getBalanceWithManager(manager, uid, now),
      };
    });
  }

  /** 退款时收回该订单发放且尚未使用的分钟；已使用部分由退款金额比例覆盖。 */
  async revokeOrderLots(uid: string, orderId: string, manager?: EntityManager): Promise<number> {
    const repo = manager ? manager.getRepository(MembershipQuotaLot) : this.dataSource.getRepository(MembershipQuotaLot);
    const result = await repo
      .createQueryBuilder()
      .update(MembershipQuotaLot)
      .set({ minutesRemaining: 0 })
      .where('uid = :uid', { uid })
      .andWhere('orderId = :orderId', { orderId })
      .andWhere('minutesRemaining > 0')
      .execute();
    return result.affected ?? 0;
  }

  /** 给旧 counselor / training 链路用的即时扣减，失败返回 false 而不抛。 */
  async consumeMinutes(
    uid: string,
    minutes: number,
    referenceId: string,
    now: Date = new Date(),
  ): Promise<{ success: boolean; remaining: number }> {
    if (minutes <= 0) return { success: true, remaining: -1 };
    let left = minutes;
    let index = 0;
    let remaining = 0;
    while (left > 0) {
      const chunk = Math.min(left, MEMBERSHIP_QUOTA_RULES.singleSessionLimitMinutes);
      const chunkRef = index === 0 ? referenceId : `${referenceId}:${index}`;
      try {
        const reserve = await this.reserve(uid, chunkRef, chunk, now);
        const settle = await this.settle(uid, reserve.reservationId, chunk, now);
        remaining = settle.balance.totalRemainingMinutes;
        if (settle.shortfallMinutes > 0) return { success: false, remaining };
      } catch (error) {
        if (error instanceof QuotaInsufficientError || error instanceof QuotaLimitError) {
          return { success: false, remaining: 0 };
        }
        throw error;
      }
      left -= chunk;
      index += 1;
    }
    return { success: true, remaining };
  }

  private async grantOnce(
    uid: string,
    source: QuotaLotSource,
    minutes: number,
    expiresAt: Date,
    orderId: string,
    campaignId: string | null,
    manager?: EntityManager,
    referenceKey: string | null = null,
  ): Promise<void> {
    const run = async (entityManager: EntityManager) => {
      const repo = entityManager.getRepository(MembershipQuotaLot);
      const existing = await repo
        .createQueryBuilder('lot')
        .where('lot.uid = :uid', { uid })
        .andWhere('lot.source = :source', { source })
        .andWhere('lot.orderId = :orderId', { orderId })
        .andWhere(
          referenceKey === null ? 'lot.referenceKey IS NULL' : 'lot.referenceKey = :referenceKey',
          referenceKey === null ? {} : { referenceKey },
        )
        .getOne();
      if (existing) return;

      const lot = repo.create({
        id: randomUUID(),
        uid,
        source,
        minutesTotal: minutes,
        minutesRemaining: minutes,
        expiresAt,
        orderId,
        referenceKey,
        campaignId,
      });
      await repo.save(lot);
    };

    if (manager) {
      await run(manager);
      return;
    }
    await this.dataSource.transaction(run);
  }

  private async loadLotsForUpdate(manager: EntityManager, uid: string, now: Date): Promise<QuotaLotSnapshot[]> {
    const lots = await manager
      .getRepository(MembershipQuotaLot)
      .createQueryBuilder('lot')
      .where('lot.uid = :uid', { uid })
      .andWhere('lot.minutesRemaining > 0')
      .andWhere('lot.expiresAt > :now', { now })
      .setLock('pessimistic_write')
      .getMany();

    return lots.map((lot) => ({
      id: lot.id,
      source: lot.source,
      minutesRemaining: lot.minutesRemaining,
      expiresAt: lot.expiresAt,
    }));
  }

  private async applyAllocations(
    manager: EntityManager,
    allocations: readonly QuotaAllocation[],
    direction: -1 | 1,
    now: Date,
  ): Promise<void> {
    void now;
    const repo = manager.getRepository(MembershipQuotaLot);
    for (const allocation of allocations) {
      if (allocation.minutes <= 0) continue;
      const lot = await repo.findOne({ where: { id: allocation.lotId }, lock: { mode: 'pessimistic_write' } });
      if (!lot) throw new QuotaLimitError(`配额 lot 不存在: ${allocation.lotId}`);
      const next = lot.minutesRemaining + direction * allocation.minutes;
      if (next < 0 || next > lot.minutesTotal) {
        throw new QuotaLimitError(`配额 lot 余额越界: ${allocation.lotId}`);
      }
      lot.minutesRemaining = next;
      await repo.save(lot);
    }
  }

  private async getBalanceWithManager(manager: EntityManager, uid: string, now: Date): Promise<MembershipQuotaBalance> {
    const lotRepo = manager.getRepository(MembershipQuotaLot);
    const lots = await lotRepo.find({
      where: { uid, minutesRemaining: MoreThan(0), expiresAt: MoreThan(now) },
    });
    const report: Record<QuotaLotSource, number> = {
      [QuotaLotSource.Plan]: 0,
      [QuotaLotSource.Promotion]: 0,
      [QuotaLotSource.Addon]: 0,
      [QuotaLotSource.Migration]: 0,
    };
    for (const lot of lots) report[lot.source] += lot.minutesRemaining;

    const reservationRepo = manager.getRepository(MembershipQuotaReservation);
    const dayRows = await reservationRepo.find({
      where: { uid, createdAt: MoreThan(startOfDay(now)), status: In(['held', 'settled']) },
    });
    const dailyUsedMinutes = dayRows.reduce((sum, row) => sum + (row.status === 'held' ? row.reservedMinutes : row.settledMinutes), 0);

    return {
      planMinutes: report[QuotaLotSource.Plan],
      promotionMinutes: report[QuotaLotSource.Promotion],
      addonMinutes: report[QuotaLotSource.Addon],
      migrationMinutes: report[QuotaLotSource.Migration],
      totalRemainingMinutes:
        report[QuotaLotSource.Plan] + report[QuotaLotSource.Promotion] + report[QuotaLotSource.Addon] + report[QuotaLotSource.Migration],
      includedMinutesThisPeriod: report[QuotaLotSource.Plan],
      usedMinutesThisPeriod: 0,
      dailyUsedMinutes,
      dailyLimitMinutes: MEMBERSHIP_QUOTA_RULES.dailyLimitMinutes,
      preDeductMinutes: MEMBERSHIP_QUOTA_RULES.preDeductMinutes,
      singleSessionLimitMinutes: MEMBERSHIP_QUOTA_RULES.singleSessionLimitMinutes,
    };
  }
}

/** 对外保留档位到分钟数的纯映射，便于旧链路标注。 */
export function planMinutesForTier(tier: MembershipTier): number {
  return MEMBERSHIP_PLANS[tier].monthlyMinutes;
}
