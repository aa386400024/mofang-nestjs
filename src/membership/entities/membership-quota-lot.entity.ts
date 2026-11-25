import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { QuotaLotSource } from '../domain/membership.enums.js';

/**
 * 会员配额账本 lot — 一次发放一行，剩余分钟独立递减。
 *
 * 设计取舍：
 *   - 不把套餐分钟写进 user_memberships 单列，避免“套餐 + 活动 + 加包”三种来源混在一起无法审计；
 *   - 每行有独立 expiresAt，活动赠送过期自动失效，不侵蚀付费加包；
 *   - 扣减顺序由 QuotaLedgerService 按 source 优先级执行，DB 只存事实。
 */
@Entity('membership_quota_lots')
@Index('idx_mql_uid_expires', ['uid', 'expiresAt'])
@Index('idx_mql_source', ['source'])
@Index('idx_mql_order_ref', ['orderId', 'referenceKey'])
export class MembershipQuotaLot {
  @PrimaryColumn({ type: 'char', length: 36, name: 'id' })
  id!: string;

  @Column({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  @Column({ type: 'varchar', length: 16, name: 'source' })
  source!: QuotaLotSource;

  @Column({ type: 'int', name: 'minutes_total' })
  minutesTotal!: number;

  @Column({ type: 'int', name: 'minutes_remaining' })
  minutesRemaining!: number;

  @Column({ type: 'datetime', name: 'expires_at' })
  expiresAt!: Date;

  @Column({ type: 'char', length: 36, name: 'order_id', nullable: true })
  orderId!: string | null;

  /** 同订单多次发放（如年付按月）时的幂等子键，例如 plan:3。 */
  @Column({ type: 'varchar', length: 64, name: 'reference_key', nullable: true })
  referenceKey!: string | null;

  @Column({ type: 'varchar', length: 64, name: 'campaign_id', nullable: true })
  campaignId!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
