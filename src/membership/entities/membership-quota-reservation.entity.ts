import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 配额预扣/结算记录 — 一场会话一行，sessionId 唯一保证幂等。
 *
 * allocations 存本次从哪些 lot 扣了多少，结算退款按原路退回；
 * shortfallMinutes 记录“实际用量超过可扣余额”的差额，余额永不为负，但审计可见。
 */
@Entity('membership_quota_reservations')
@Index('uniq_mqr_session', ['sessionId'], { unique: true })
@Index('idx_mqr_uid_status', ['uid', 'status'])
export class MembershipQuotaReservation {
  @PrimaryColumn({ type: 'char', length: 36, name: 'id' })
  id!: string;

  @Column({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  @Column({ type: 'varchar', length: 64, name: 'session_id' })
  sessionId!: string;

  @Column({ type: 'json', name: 'allocations' })
  allocations!: { lotId: string; minutes: number }[];

  @Column({ type: 'int', name: 'reserved_minutes' })
  reservedMinutes!: number;

  @Column({ type: 'int', name: 'settled_minutes', default: 0 })
  settledMinutes!: number;

  @Column({ type: 'int', name: 'shortfall_minutes', default: 0 })
  shortfallMinutes!: number;

  @Column({ type: 'varchar', length: 16, name: 'status', default: 'held' })
  status!: 'held' | 'settled' | 'released';

  @Column({ type: 'datetime', name: 'expires_at' })
  expiresAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
