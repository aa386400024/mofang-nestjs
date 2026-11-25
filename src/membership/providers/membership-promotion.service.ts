import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { IsNull, type FindOptionsWhere, type Repository } from 'typeorm';

import { BizCode } from '../../common/exceptions/biz-code.enum.js';
import { BizException } from '../../common/exceptions/biz.exception.js';
import { AuditEvent } from '../../user/enums/audit-event.enum.js';
import { AuditLogService } from '../../user/providers/audit-log.service.js';
import { BillingPeriod, MembershipPromotionAudience, MembershipPromotionStatus, MembershipTier } from '../domain/membership.enums.js';
import type {
  CreateMembershipPromotionDto,
  ListMembershipPromotionQueryDto,
  MembershipPromotionDto,
  MembershipPromotionStatsDto,
  UpdateMembershipPromotionDto,
} from '../dto/membership-promotion.dto.js';
import { MembershipPromotionRedemption } from '../entities/membership-promotion-redemption.entity.js';
import { MembershipPromotion } from '../entities/membership-promotion.entity.js';
import type { MembershipCampaignDefinition } from '../membership.constants.js';
import { MEMBERSHIP_PLANS } from '../membership.constants.js';
import { MembershipPromotionReservationService } from './membership-promotion-reservation.service.js';

const PAID_TIERS: readonly MembershipTier[] = [MembershipTier.Plus, MembershipTier.Pro, MembershipTier.Max];

/**
 * 活动主数据 + 运营统计。
 *
 * 职责边界：
 *   - 本服务只负责“活动是什么、还能不能用、用了多少”；
 *   - 价格计算仍走 MembershipPricingService，规则匹配仍走 PromotionEnginePort；
 *   - 任何写操作都在落库前做金额/底价/时间窗/预算校验，避免运营配出负毛利活动。
 */
@Injectable()
export class MembershipPromotionService {
  private readonly logger = new Logger(MembershipPromotionService.name);

  constructor(
    @InjectRepository(MembershipPromotion)
    private readonly promotionRepo: Repository<MembershipPromotion>,
    @InjectRepository(MembershipPromotionRedemption)
    private readonly redemptionRepo: Repository<MembershipPromotionRedemption>,
    @Optional()
    private readonly reservationService?: MembershipPromotionReservationService,
    @Optional()
    private readonly audit?: AuditLogService,
  ) {}

  async list(
    query: ListMembershipPromotionQueryDto,
  ): Promise<{ items: MembershipPromotionDto[]; total: number; page: number; pageSize: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: FindOptionsWhere<MembershipPromotion> = { deletedAt: IsNull() };
    if (query.status) where.status = query.status;
    if (query.billingPeriod) where.billingPeriod = query.billingPeriod;

    const [rows, total] = await this.promotionRepo.findAndCount({
      where,
      order: { priority: 'DESC', createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items: rows.map((row) => this.toDto(row)), total, page, pageSize };
  }

  async get(id: string): Promise<MembershipPromotionDto> {
    return this.toDto(await this.requirePromotion(id));
  }

  async create(adminUid: string | null, dto: CreateMembershipPromotionDto): Promise<MembershipPromotionDto> {
    const code = dto.code.trim().toUpperCase();
    if (!/^[A-Z0-9_]{3,64}$/.test(code)) throw this.invalid('活动码必须是 3-64 位大写字母/数字/下划线');
    const duplicate = await this.promotionRepo.findOne({ where: { code } });
    if (duplicate) throw this.invalid(`活动码 ${code} 已存在`);

    const values = this.validateAndNormalize({
      code,
      name: dto.name,
      description: dto.description ?? '',
      status: dto.status ?? MembershipPromotionStatus.Draft,
      billingPeriod: dto.billingPeriod,
      audience: dto.audience,
      autoApply: dto.autoApply,
      startsAt: dto.startsAt,
      endsAt: dto.endsAt,
      prices: dto.prices,
      floors: dto.floors,
      giftMinutes: dto.giftMinutes,
      budgetCents: dto.budgetCents ?? null,
      perUserLimit: dto.perUserLimit ?? 1,
      priority: dto.priority ?? 100,
      ruleVersion: dto.ruleVersion ?? 'membership-promotion-v1',
    });

    const row = this.promotionRepo.create({
      ...values,
      id: randomUUID(),
      createdBy: adminUid,
      deletedAt: null,
    });
    const saved = await this.promotionRepo.save(row);
    await this.auditWrite(AuditEvent.MembershipPromotionCreated, adminUid, saved, 'created');
    return this.toDto(saved);
  }

  async update(id: string, dto: UpdateMembershipPromotionDto, adminUid: string | null = null): Promise<MembershipPromotionDto> {
    const existing = await this.requirePromotion(id);
    if (dto.code && dto.code.trim().toUpperCase() !== existing.code) {
      throw this.invalid('活动码创建后不可修改；请新建活动并停用旧活动');
    }
    const merged = this.mergeForUpdate(existing, dto);

    Object.assign(existing, merged);
    const saved = await this.promotionRepo.save(existing);
    await this.auditWrite(AuditEvent.MembershipPromotionUpdated, adminUid, saved, 'updated');
    return this.toDto(saved);
  }

  async activate(id: string, adminUid: string | null = null): Promise<MembershipPromotionDto> {
    const existing = await this.requirePromotion(id);
    this.validateAndNormalize({
      code: existing.code,
      name: existing.name,
      description: existing.description,
      status: MembershipPromotionStatus.Active,
      billingPeriod: existing.billingPeriod,
      audience: existing.audience,
      autoApply: existing.autoApply,
      startsAt: existing.startsAt,
      endsAt: existing.endsAt,
      prices: existing.prices,
      floors: existing.floors ?? {},
      giftMinutes: existing.giftMinutes ?? {},
      budgetCents: existing.budgetCents,
      perUserLimit: existing.perUserLimit,
      priority: existing.priority,
      ruleVersion: existing.ruleVersion,
    });
    existing.status = MembershipPromotionStatus.Active;
    const saved = await this.promotionRepo.save(existing);
    await this.auditWrite(AuditEvent.MembershipPromotionActivated, adminUid, saved, 'activated');
    return this.toDto(saved);
  }

  async pause(id: string, adminUid: string | null = null): Promise<MembershipPromotionDto> {
    const existing = await this.requirePromotion(id);
    existing.status = MembershipPromotionStatus.Paused;
    const saved = await this.promotionRepo.save(existing);
    await this.auditWrite(AuditEvent.MembershipPromotionPaused, adminUid, saved, 'paused');
    return this.toDto(saved);
  }

  async remove(id: string, adminUid: string | null = null): Promise<void> {
    const existing = await this.requirePromotion(id);
    existing.status = MembershipPromotionStatus.Ended;
    existing.deletedAt = new Date();
    const saved = await this.promotionRepo.save(existing);
    await this.auditWrite(AuditEvent.MembershipPromotionDeleted, adminUid, saved, 'deleted');
  }

  async stats(id: string): Promise<MembershipPromotionStatsDto> {
    const promotion = await this.requirePromotion(id);
    const raw = await this.redemptionRepo
      .createQueryBuilder('r')
      .select('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(r.discountCents), 0)', 'discount')
      .addSelect('COALESCE(SUM(r.grantedMinutes), 0)', 'minutes')
      .where('r.promotionId = :id', { id })
      .andWhere('r.revokedAt IS NULL')
      .getRawOne<{ count: string; discount: string; minutes: string }>();
    const discountCents = Number(raw?.discount ?? 0);
    const reserved = await this.reservationService?.statsForPromotion(id, new Date());
    return {
      promotionId: id,
      redemptionCount: Number(raw?.count ?? 0),
      discountCents,
      grantedMinutes: Number(raw?.minutes ?? 0),
      budgetCents: promotion.budgetCents,
      budgetRemainingCents:
        promotion.budgetCents === null ? null : Math.max(0, promotion.budgetCents - discountCents - (reserved?.heldCents ?? 0)),
      perUserLimit: promotion.perUserLimit,
      reservedCount: reserved?.heldCount ?? 0,
      reservedCents: reserved?.heldCents ?? 0,
    };
  }

  /** 报价时取当前可售活动快照；时间窗由规则引擎再校验一次，防止跨秒边界。 */
  async listSellableCampaigns(billingPeriod: BillingPeriod, now: Date): Promise<MembershipCampaignDefinition[]> {
    const rows = await this.promotionRepo
      .createQueryBuilder('p')
      .where('p.deletedAt IS NULL')
      .andWhere('p.status = :status', { status: MembershipPromotionStatus.Active })
      .andWhere('p.billingPeriod = :billingPeriod', { billingPeriod })
      .andWhere('p.startsAt <= :now', { now })
      .andWhere('p.endsAt >= :now', { now })
      .orderBy('p.priority', 'DESC')
      .addOrderBy('p.createdAt', 'DESC')
      .getMany();
    return rows.map((row) => this.toCampaignDefinition(row));
  }

  async redemptionCountsByPromotion(uid: string): Promise<Record<string, number>> {
    const rows = await this.redemptionRepo
      .createQueryBuilder('r')
      .select('r.promotionId', 'promotionId')
      .addSelect('COUNT(*)', 'count')
      .where('r.uid = :uid', { uid })
      .andWhere('r.revokedAt IS NULL')
      .groupBy('r.promotionId')
      .getRawMany<{ promotionId: string; count: string }>();
    const paid = Object.fromEntries(rows.map((row) => [row.promotionId, Number(row.count)]));
    const held = (await this.reservationService?.heldCountsByUid(uid)) ?? {};
    for (const [promotionId, count] of Object.entries(held)) {
      paid[promotionId] = (paid[promotionId] ?? 0) + count;
    }
    return paid;
  }

  async budgetRemainingByPromotion(campaigns: readonly MembershipCampaignDefinition[]): Promise<Record<string, number | null>> {
    if (campaigns.length === 0) return {};
    const ids = campaigns.map((campaign) => campaign.id);
    const rows = await this.redemptionRepo
      .createQueryBuilder('r')
      .select('r.promotionId', 'promotionId')
      .addSelect('COALESCE(SUM(r.discountCents), 0)', 'spent')
      .where('r.promotionId IN (:...ids)', { ids })
      .andWhere('r.revokedAt IS NULL')
      .groupBy('r.promotionId')
      .getRawMany<{ promotionId: string; spent: string }>();
    const spentByPromotion = new Map(rows.map((row) => [row.promotionId, Number(row.spent)]));
    const heldByPromotion = (await this.reservationService?.reservedByPromotion(campaigns)) ?? {};
    const result: Record<string, number | null> = {};
    for (const campaign of campaigns) {
      result[campaign.id] =
        campaign.budgetCents === null
          ? null
          : Math.max(0, campaign.budgetCents - (spentByPromotion.get(campaign.id) ?? 0) - (heldByPromotion[campaign.id] ?? 0));
    }
    return result;
  }

  private async requirePromotion(id: string): Promise<MembershipPromotion> {
    const row = await this.promotionRepo.findOne({ where: { id, deletedAt: IsNull() } });
    if (!row) throw new BizException(BizCode.MembershipPromotionNotFound, `活动 ${id} 不存在或已删除`);
    return row;
  }

  private mergeForUpdate(existing: MembershipPromotion, dto: UpdateMembershipPromotionDto) {
    return this.validateAndNormalize({
      code: existing.code,
      name: dto.name ?? existing.name,
      description: dto.description ?? existing.description,
      status: dto.status ?? existing.status,
      billingPeriod: dto.billingPeriod ?? existing.billingPeriod,
      audience: dto.audience ?? existing.audience,
      autoApply: dto.autoApply ?? existing.autoApply,
      startsAt: dto.startsAt ?? existing.startsAt,
      endsAt: dto.endsAt ?? existing.endsAt,
      prices: dto.prices ?? existing.prices,
      floors: dto.floors ?? existing.floors ?? {},
      giftMinutes: dto.giftMinutes ?? existing.giftMinutes ?? {},
      budgetCents: dto.budgetCents === undefined ? existing.budgetCents : dto.budgetCents,
      perUserLimit: dto.perUserLimit ?? existing.perUserLimit,
      priority: dto.priority ?? existing.priority,
      ruleVersion: dto.ruleVersion ?? existing.ruleVersion,
    });
  }

  private validateAndNormalize(input: {
    code: string;
    name: string;
    description: string;
    status: MembershipPromotionStatus;
    billingPeriod: BillingPeriod;
    audience?: MembershipPromotionAudience;
    autoApply?: boolean;
    startsAt: Date;
    endsAt: Date;
    prices: Partial<Record<MembershipTier, number>>;
    floors?: Partial<Record<MembershipTier, number>>;
    giftMinutes?: Partial<Record<MembershipTier, number>>;
    budgetCents: number | null;
    perUserLimit: number;
    priority: number;
    ruleVersion: string;
  }): Pick<
    MembershipPromotion,
    | 'code'
    | 'name'
    | 'description'
    | 'status'
    | 'billingPeriod'
    | 'audience'
    | 'autoApply'
    | 'startsAt'
    | 'endsAt'
    | 'prices'
    | 'floors'
    | 'giftMinutes'
    | 'budgetCents'
    | 'perUserLimit'
    | 'priority'
    | 'ruleVersion'
  > {
    if (!input.name.trim()) throw this.invalid('活动名称不能为空');
    if (Number.isNaN(input.startsAt.getTime()) || Number.isNaN(input.endsAt.getTime())) throw this.invalid('活动时间不合法');
    if (input.startsAt.getTime() >= input.endsAt.getTime()) throw this.invalid('活动开始时间必须早于结束时间');
    if (input.budgetCents !== null && (!Number.isInteger(input.budgetCents) || input.budgetCents < 0))
      throw this.invalid('活动预算必须是非负整数分');
    if (!Number.isInteger(input.perUserLimit) || input.perUserLimit < 1) throw this.invalid('单用户限次必须是 >=1 的整数');
    if (!Number.isInteger(input.priority) || input.priority < 0) throw this.invalid('优先级必须是非负整数');

    const prices = this.normalizeTierMap(input.prices, '活动价');
    const floors = this.normalizeTierMap(input.floors, '底价');
    const gifts = this.normalizeTierMap(input.giftMinutes, '赠送分钟');
    this.validateTierPrices(prices, floors, input.billingPeriod);

    return {
      code: input.code,
      name: input.name.trim(),
      description: input.description.trim(),
      status: input.status,
      billingPeriod: input.billingPeriod,
      audience: input.audience ?? MembershipPromotionAudience.FirstPurchase,
      autoApply: input.autoApply ?? true,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      prices,
      floors,
      giftMinutes: gifts,
      budgetCents: input.budgetCents,
      perUserLimit: input.perUserLimit,
      priority: input.priority,
      ruleVersion: input.ruleVersion,
    };
  }

  /**
   * 活动价/底价护栏：不允许击穿会员档底价，也不允许高于原价。
   * 单独抽方法是为了把运营校验的复杂度留在金额规则本身，不污染主流程。
   */
  private validateTierPrices(
    prices: Partial<Record<MembershipTier, number>>,
    floors: Partial<Record<MembershipTier, number>>,
    billingPeriod: BillingPeriod,
  ): void {
    let hasPrice = false;
    const isAnnual = billingPeriod === BillingPeriod.Annual;
    for (const tier of PAID_TIERS) {
      const price = prices[tier];
      if (price === undefined) continue;
      hasPrice = true;
      const plan = MEMBERSHIP_PLANS[tier];
      const defaultFloor = isAnnual ? plan.annualFloorPriceCents : plan.floorPriceCents;
      const listPrice = isAnnual ? plan.listPriceCents * 12 : plan.listPriceCents;
      const floor = floors[tier] ?? defaultFloor;
      if (price < floor) throw this.invalid(`${tier} 活动价 ${price} 低于底价 ${floor}`);
      if (price > listPrice) throw this.invalid(`${tier} 活动价 ${price} 高于原价 ${listPrice}`);
      if (floor < defaultFloor) throw this.invalid(`${tier} 底价 ${floor} 低于会员档底价 ${defaultFloor}`);
    }
    if (!hasPrice) throw this.invalid('至少需要配置一个付费档位的活动价');
  }

  private normalizeTierMap(
    source: Partial<Record<MembershipTier, number>> | null | undefined,
    field: string,
  ): Partial<Record<MembershipTier, number>> {
    const result: Partial<Record<MembershipTier, number>> = {};
    for (const [key, value] of Object.entries(source ?? {})) {
      if (!PAID_TIERS.includes(key as MembershipTier)) throw this.invalid(`${field} 只能配置 plus/pro/max`);
      if (!Number.isInteger(value) || value < 0) throw this.invalid(`${field}.${key} 必须是非负整数`);
      result[key as MembershipTier] = value;
    }
    return result;
  }

  private toCampaignDefinition(row: MembershipPromotion): MembershipCampaignDefinition {
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      billingPeriod: row.billingPeriod,
      status: row.status,
      audience: row.audience,
      autoApply: row.autoApply,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      prices: row.prices,
      floors: row.floors ?? {},
      giftMinutes: row.giftMinutes ?? {},
      budgetCents: row.budgetCents,
      perUserLimit: row.perUserLimit,
      priority: row.priority,
      ruleVersion: row.ruleVersion,
    };
  }

  private toDto(row: MembershipPromotion): MembershipPromotionDto {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      status: row.status,
      billingPeriod: row.billingPeriod,
      audience: row.audience,
      autoApply: row.autoApply,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      prices: row.prices,
      floors: row.floors ?? {},
      giftMinutes: row.giftMinutes ?? {},
      budgetCents: row.budgetCents,
      perUserLimit: row.perUserLimit,
      priority: row.priority,
      ruleVersion: row.ruleVersion,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async auditWrite(event: AuditEvent, adminUid: string | null, promotion: MembershipPromotion, action: string): Promise<void> {
    if (!this.audit) return;
    try {
      await this.audit.log({
        userId: adminUid,
        event,
        metadata: {
          action,
          promotionId: promotion.id,
          code: promotion.code,
          status: promotion.status,
          billingPeriod: promotion.billingPeriod,
          ruleVersion: promotion.ruleVersion,
          actor: adminUid ? 'admin-user' : 'admin-basic',
        },
      });
    } catch (error) {
      // 审计是旁路：写审计失败不能让运营操作回滚，但必须留下可检索的告警。
      this.logger.warn(`活动审计写入失败 action=${action} promotion=${promotion.id} error=${(error as Error).message}`);
    }
  }

  private invalid(message: string): BizException {
    return new BizException(BizCode.MembershipPromotionInvalid, message);
  }
}
