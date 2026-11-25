import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * 活动兑换记录 — 预算、单用户上限、退款追回的事实表。
 *
 * 不存优惠券明文，只存活动 id 与订单 id；需要定位用户时走 uid。
 */
@Entity('membership_promotion_redemptions')
@Index('uniq_mpr_uid_promo_order', ['uid', 'promotionId', 'orderId'], { unique: true })
@Index('idx_mpr_promo_created', ['promotionId', 'createdAt'])
export class MembershipPromotionRedemption {
  @PrimaryColumn({ type: 'char', length: 36, name: 'id' })
  id!: string;

  @Column({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  @Column({ type: 'varchar', length: 64, name: 'promotion_id' })
  promotionId!: string;

  @Column({ type: 'char', length: 36, name: 'order_id' })
  orderId!: string;

  @Column({ type: 'int', name: 'discount_cents' })
  discountCents!: number;

  @Column({ type: 'int', name: 'granted_minutes', default: 0 })
  grantedMinutes!: number;

  @Column({ type: 'datetime', name: 'revoked_at', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
