import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, LessThanOrEqual, MoreThan, type EntityManager, type Repository } from 'typeorm';

import { QuotaLedgerService } from './quota-ledger.service.js';
import { MembershipPlanGrantStatus, MembershipTier } from '../domain/membership.enums.js';
import { addMonths } from '../domain/membership.utils.js';
import { MembershipPlanGrantTerm } from '../entities/membership-plan-grant-term.entity.js';
import { MEMBERSHIP_PLANS } from '../membership.constants.js';

export interface CreateAnnualTermInput {
  readonly uid: string;
  readonly orderId: string;
  readonly tier: MembershipTier;
  readonly termStart: Date;
  readonly termEnd: Date;
  readonly monthsTotal: number;
  readonly firstMonthGranted: boolean;
}

/**
 * 年付套餐按月发放。
 *
 * 事实源是 `membership_plan_grant_terms`：一单一年付一条 term，`next_grant_at` 指向
 * 下一次应发月份。配额 lot 用 `order_id + reference_key=plan:N` 幂等，重复跑 cron 不叠加。
 */
@Injectable()
export class MembershipPlanGrantService {
  private readonly logger = new Logger(MembershipPlanGrantService.name);

  constructor(
    @InjectRepository(MembershipPlanGrantTerm)
    private readonly termRepo: Repository<MembershipPlanGrantTerm>,
    private readonly quotaLedger: QuotaLedgerService,
    private readonly dataSource: DataSource,
  ) {}

  /** 在支付开通事务内登记 term；同 orderId 重入直接返回已有 term。 */
  async createAnnualTerm(manager: EntityManager, input: CreateAnnualTermInput): Promise<MembershipPlanGrantTerm> {
    const repo = manager.getRepository(MembershipPlanGrantTerm);
    const existing = await repo.findOne({ where: { orderId: input.orderId } });
    if (existing) return existing;

    const nextGrantAt = addMonths(input.termStart, 1);
    const status =
      input.firstMonthGranted && nextGrantAt.getTime() < input.termEnd.getTime()
        ? MembershipPlanGrantStatus.Active
        : MembershipPlanGrantStatus.Completed;
    const term = repo.create({
      id: randomUUID(),
      uid: input.uid,
      orderId: input.orderId,
      tier: input.tier,
      monthlyMinutes: MEMBERSHIP_PLANS[input.tier].monthlyMinutes,
      termStart: input.termStart,
      termEnd: input.termEnd,
      nextGrantAt: status === MembershipPlanGrantStatus.Active ? nextGrantAt : null,
      monthsTotal: input.monthsTotal,
      monthsGranted: input.firstMonthGranted ? 1 : 0,
      status,
    });
    return repo.save(term);
  }

  /** 升档/重开周期时停掉旧 term，防止旧订单继续发放套餐分钟。 */
  async cancelActiveTerms(uid: string, exceptOrderId: string, manager: EntityManager): Promise<number> {
    const result = await manager
      .getRepository(MembershipPlanGrantTerm)
      .createQueryBuilder()
      .update(MembershipPlanGrantTerm)
      .set({ status: MembershipPlanGrantStatus.Cancelled, nextGrantAt: null })
      .where('uid = :uid', { uid })
      .andWhere('status = :status', { status: MembershipPlanGrantStatus.Active })
      .andWhere('orderId <> :exceptOrderId', { exceptOrderId })
      .execute();
    return result.affected ?? 0;
  }

  /** 读取当前账号到期 term 并补发；供会员总览即时刷新，避免 cron 间隔内少一个月。 */
  async refreshForUid(uid: string, now: Date = new Date()): Promise<number> {
    const due = await this.termRepo.find({
      where: {
        uid,
        status: MembershipPlanGrantStatus.Active,
        nextGrantAt: LessThanOrEqual(now),
        termEnd: MoreThan(now),
      },
      order: { nextGrantAt: 'ASC' },
    });
    return this.refreshTerms(due, now);
  }

  /** cron 入口：批量补发所有到期 term。 */
  async refreshDue(now: Date = new Date()): Promise<number> {
    const due = await this.termRepo.find({
      where: {
        status: MembershipPlanGrantStatus.Active,
        nextGrantAt: LessThanOrEqual(now),
        termEnd: MoreThan(now),
      },
      order: { nextGrantAt: 'ASC' },
      take: 500,
    });
    return this.refreshTerms(due, now);
  }

  private async refreshTerms(terms: readonly MembershipPlanGrantTerm[], now: Date): Promise<number> {
    let granted = 0;
    for (const term of terms) {
      try {
        granted += await this.dataSource.transaction((manager) => this.refreshOne(manager, term.id, now));
      } catch (error) {
        this.logger.error(`年付套餐发放失败 term=${term.id} uid=${term.uid}`, error instanceof Error ? error.stack : String(error));
      }
    }
    return granted;
  }

  private async refreshOne(manager: EntityManager, termId: string, now: Date): Promise<number> {
    const repo = manager.getRepository(MembershipPlanGrantTerm);
    const term = await repo.findOne({ where: { id: termId }, lock: { mode: 'pessimistic_write' } });
    if (!term || term.status !== MembershipPlanGrantStatus.Active || !term.nextGrantAt) return 0;

    let granted = 0;
    let cursor = term.nextGrantAt;
    while (cursor.getTime() <= now.getTime() && cursor.getTime() < term.termEnd.getTime() && term.monthsGranted < term.monthsTotal) {
      const monthIndex = term.monthsGranted + 1;
      const expiry = this.minDate(addMonths(term.termStart, monthIndex), term.termEnd);
      const plan = { ...MEMBERSHIP_PLANS[term.tier], monthlyMinutes: term.monthlyMinutes };
      await this.quotaLedger.grantPlan(term.uid, plan, term.orderId, expiry, manager, `plan:${monthIndex}`);
      term.monthsGranted = monthIndex;
      granted += 1;
      cursor = addMonths(term.termStart, monthIndex);
    }

    if (term.monthsGranted >= term.monthsTotal || cursor.getTime() >= term.termEnd.getTime()) {
      term.status = MembershipPlanGrantStatus.Completed;
      term.nextGrantAt = null;
    } else {
      term.nextGrantAt = cursor;
    }
    await repo.save(term);
    return granted;
  }

  private minDate(left: Date, right: Date): Date {
    return left.getTime() < right.getTime() ? left : right;
  }
}
