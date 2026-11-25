import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { MembershipPromotionReservationStatus } from '../domain/membership.enums.js';

/**
 * 活动预算/限次预占 — 下单时占位，支付时确认，退款/超时释放。
 *
 * 为什么必须有这一层：
 *   - 预算只按已支付兑换统计，pending 订单不占额度；并发支付可以让活动超卖。
 *   - 单用户限次同理，用户可以同时挂多笔 pending 订单，支付时全部命中。
 *   - 预占把“未支付但已占用的额度”显式落库，报价、统计、支付确认都以 DB 事实为准。
 *
 * 状态机：
 *   held → consumed（支付成功）
 *   held → released（订单超时/用户取消）
 *   consumed → released（退款追回）
 */
@Entity('membership_promotion_reservations')
@Index('uniq_mprsv_order', ['orderId'], { unique: true })
@Index('idx_mprsv_promo_status', ['promotionId', 'status', 'expiresAt'])
@Index('idx_mprsv_status_expires', ['status', 'expiresAt'])
export class MembershipPromotionReservation {
  @PrimaryColumn({ type: 'char', length: 36, name: 'id' })
  id!: string;

  @Column({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  @Column({ type: 'varchar', length: 64, name: 'promotion_id' })
  promotionId!: string;

  @Column({ type: 'char', length: 36, name: 'order_id' })
  orderId!: string;

  /** 本单占用的活动优惠金额（分），用于预算预占。 */
  @Column({ type: 'int', name: 'discount_cents', default: 0 })
  discountCents!: number;

  /** 本单占用的赠送分钟，退款时与 lot 一起追回。 */
  @Column({ type: 'int', name: 'gift_minutes', default: 0 })
  giftMinutes!: number;

  @Column({ type: 'varchar', length: 16, name: 'status', default: MembershipPromotionReservationStatus.Held })
  status!: MembershipPromotionReservationStatus;

  @Column({ type: 'datetime', name: 'expires_at' })
  expiresAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
