import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { MembershipPlanGrantStatus, MembershipTier } from '../domain/membership.enums.js';

/**
 * 年付套餐发放 term — 一单一年付对应一条，按自然月发放套餐分钟。
 *
 * 幂等键由 (order_id, months_granted + 1) 组成，写入 quota lot 的 reference_key = plan:N；
 * 同一订单退款时按 order_id 一次性收回全部未使用套餐 lot。
 */
@Entity('membership_plan_grant_terms')
@Index('uniq_mpgt_order', ['orderId'], { unique: true })
@Index('idx_mpgt_status_next', ['status', 'nextGrantAt'])
export class MembershipPlanGrantTerm {
  @PrimaryColumn({ type: 'char', length: 36, name: 'id' })
  id!: string;

  @Column({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  @Column({ type: 'char', length: 36, name: 'order_id' })
  orderId!: string;

  @Column({ type: 'varchar', length: 16, name: 'tier' })
  tier!: MembershipTier;

  @Column({ type: 'int', name: 'monthly_minutes' })
  monthlyMinutes!: number;

  @Column({ type: 'datetime', name: 'term_start' })
  termStart!: Date;

  @Column({ type: 'datetime', name: 'term_end' })
  termEnd!: Date;

  @Column({ type: 'datetime', name: 'next_grant_at', nullable: true })
  nextGrantAt!: Date | null;

  @Column({ type: 'int', name: 'months_total' })
  monthsTotal!: number;

  @Column({ type: 'int', name: 'months_granted', default: 0 })
  monthsGranted!: number;

  @Column({ type: 'varchar', length: 16, name: 'status', default: MembershipPlanGrantStatus.Active })
  status!: MembershipPlanGrantStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
