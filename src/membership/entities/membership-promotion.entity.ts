import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { BillingPeriod, MembershipPromotionAudience, MembershipPromotionStatus, MembershipTier } from '../domain/membership.enums.js';

/**
 * 会员活动 — 运营可管理的活动主数据。
 *
 * 规则只做结构匹配；价格、底价、预算、单用户限次由服务层在落单前二次校验。
 * JSON 字段结构：
 *   prices        { plus: 6800, pro: 16800, max: 32800 }
 *   floors        { plus: 6800, ... }
 *   giftMinutes   { plus: 0, ... }
 */
@Entity('membership_promotions')
@Index('uniq_mp_code', ['code'], { unique: true })
@Index('idx_mp_status_period', ['status', 'billingPeriod', 'startsAt', 'endsAt'])
export class MembershipPromotion {
  @PrimaryColumn({ type: 'char', length: 36, name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'code' })
  code!: string;

  @Column({ type: 'varchar', length: 128, name: 'name' })
  name!: string;

  @Column({ type: 'varchar', length: 512, name: 'description', default: '' })
  description!: string;

  @Column({ type: 'varchar', length: 16, name: 'status', default: MembershipPromotionStatus.Draft })
  status!: MembershipPromotionStatus;

  @Column({ type: 'varchar', length: 16, name: 'billing_period' })
  billingPeriod!: BillingPeriod;

  @Column({ type: 'varchar', length: 16, name: 'audience', default: MembershipPromotionAudience.FirstPurchase })
  audience!: MembershipPromotionAudience;

  @Column({ type: 'boolean', name: 'auto_apply', default: true })
  autoApply!: boolean;

  @Column({ type: 'datetime', name: 'starts_at' })
  startsAt!: Date;

  @Column({ type: 'datetime', name: 'ends_at' })
  endsAt!: Date;

  @Column({ type: 'json', name: 'prices' })
  prices!: Partial<Record<MembershipTier, number>>;

  @Column({ type: 'json', name: 'floors', nullable: true })
  floors!: Partial<Record<MembershipTier, number>> | null;

  @Column({ type: 'json', name: 'gift_minutes', nullable: true })
  giftMinutes!: Partial<Record<MembershipTier, number>> | null;

  @Column({ type: 'int', name: 'budget_cents', nullable: true })
  budgetCents!: number | null;

  @Column({ type: 'int', name: 'per_user_limit', default: 1 })
  perUserLimit!: number;

  @Column({ type: 'int', name: 'priority', default: 100 })
  priority!: number;

  @Column({ type: 'varchar', length: 64, name: 'rule_version', default: 'membership-promotion-v1' })
  ruleVersion!: string;

  @Column({ type: 'char', length: 36, name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'datetime', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}
