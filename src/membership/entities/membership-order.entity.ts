import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { BillingPeriod, MembershipOrderStatus, MembershipOrderType, PaymentChannel } from '../domain/membership.enums.js';

/**
 * 会员订单 — 订单状态机 + 价格快照 + 幂等键。
 *
 * 价格快照（list/discount/amount）在下单时冻结；活动规则版本随 promotionId 可追溯。
 * paymentChannel 未接真实通道时落 reserved，status 保持 pending，不伪造 paid。
 */
@Entity('membership_orders')
@Index('uniq_mo_uid_idem', ['uid', 'idempotencyKey'], { unique: true })
@Index('idx_mo_uid_created', ['uid', 'createdAt'])
@Index('idx_mo_status', ['status'])
export class MembershipOrder {
  @PrimaryColumn({ type: 'char', length: 36, name: 'id' })
  id!: string;

  @Column({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  @Column({ type: 'varchar', length: 32, name: 'plan_id' })
  planId!: string;

  @Column({ type: 'varchar', length: 16, name: 'order_type' })
  orderType!: MembershipOrderType;

  @Column({ type: 'varchar', length: 16, name: 'billing_period' })
  billingPeriod!: BillingPeriod;

  @Column({ type: 'int', name: 'list_amount_cents' })
  listAmountCents!: number;

  @Column({ type: 'int', name: 'discount_cents', default: 0 })
  discountCents!: number;

  @Column({ type: 'int', name: 'amount_cents' })
  amountCents!: number;

  @Column({ type: 'int', name: 'gift_minutes', default: 0 })
  giftMinutes!: number;

  @Column({ type: 'varchar', length: 8, name: 'currency', default: 'CNY' })
  currency!: 'CNY';

  @Column({ type: 'varchar', length: 16, name: 'status', default: MembershipOrderStatus.Pending })
  status!: MembershipOrderStatus;

  @Column({ type: 'varchar', length: 16, name: 'payment_channel', default: PaymentChannel.Reserved })
  paymentChannel!: PaymentChannel;

  @Column({ type: 'varchar', length: 128, name: 'idempotency_key', nullable: true })
  idempotencyKey!: string | null;

  @Column({ type: 'varchar', length: 64, name: 'promotion_id', nullable: true })
  promotionId!: string | null;

  @Column({ type: 'varchar', length: 64, name: 'coupon_code', nullable: true })
  couponCode!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'datetime', name: 'paid_at', nullable: true })
  paidAt!: Date | null;

  @Column({ type: 'datetime', name: 'expires_at', nullable: true })
  expiresAt!: Date | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
