import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 微干预执行历史 — 心塑「场景化微干预」埋点 + 复盘.
 *
 * 写路径:
 *   - 用户点「立即开始」→ POST /home/micro-intervention/:id/start 写 started_at
 *   - 用户执行完 → POST /home/micro-intervention/:id/complete 写 completed_at + duration_seconds
 *   - 用户点 × → POST /home/micro-intervention/:id/dismiss 写 dismissed_at
 *
 * 大厂做法:
 *   - INDEX (uid, created_at) — 用户最近触发流
 *   - 状态机: started → completed / dismissed (单字段 status 表达, 避免稀疏列)
 *   - 频控去重: 服务端去重 (1 分钟内同 trigger 不重复弹), 数据层只保留最终态
 */
@Entity('micro_intervention_history')
@Index('idx_mi_history_uid_created_at', ['uid', 'createdAt'])
export class MicroInterventionHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  @Column({ type: 'varchar', length: 64, name: 'intervention_id' })
  interventionId!: string;

  @Column({ type: 'varchar', length: 32, name: 'status', default: 'started' })
  status!: 'started' | 'completed' | 'dismissed';

  @Column({ type: 'int', name: 'duration_seconds', nullable: true })
  durationSeconds!: number | null;

  @Column({ type: 'datetime', name: 'started_at', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'datetime', name: 'completed_at', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'datetime', name: 'dismissed_at', nullable: true })
  dismissedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
