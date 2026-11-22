import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Practice session entity — 一次练习会话生命周期.
 *
 * V2.0 范围:
 *   - start: 创建 status=in_progress 行, 记录 toolKey + targetDuration
 *   - complete: status=completed, 写入 actualDurationSeconds + feedbackSnapshot
 *   - cancel / expire: status=cancelled (前端走 delete, 不真删表)
 *
 * 大厂做法:
 *   - sessionId 主键, 后续 WS 实时引导接 Redis stream 时按 sessionId 订阅
 *   - INDEX (uid, status) 拉用户未完成会话
 *   - INDEX (uid, tool_key, completed_at) 用于 LLM 推荐 + 训练记录聚合
 */
@Entity('practice_sessions')
@Index('idx_practice_sessions_uid_status', ['uid', 'status'])
@Index('idx_practice_sessions_uid_tool_completed', ['uid', 'toolKey', 'completedAt'])
export class PracticeSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  @Column({ type: 'varchar', length: 64, name: 'tool_key' })
  toolKey!: string;

  @Column({ type: 'tinyint', name: 'target_duration_minutes' })
  targetDurationMinutes!: number;

  @Column({ type: 'int', name: 'actual_duration_seconds', default: 0 })
  actualDurationSeconds!: number;

  @Column({ type: 'varchar', length: 16, name: 'status', default: 'in_progress' })
  status!: 'in_progress' | 'completed' | 'cancelled';

  @Column({ type: 'simple-json', name: 'feedback_snapshot', nullable: true })
  feedbackSnapshot!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'started_at' })
  startedAt!: Date;

  @Column({ type: 'datetime', name: 'completed_at', nullable: true })
  completedAt!: Date | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
