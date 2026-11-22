import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * 双人协同会话 entity — V2.0 §Tab2 双人协同成长 (V3.0 新增).
 *
 * 设计:
 *   - 1:N with users (companion_uid + owner_uid 双外键, 不实际 FK 以避免循环依赖)
 *   - completedSteps JSON 数组 (存储已完成的步骤 index)
 *   - V2.0 占位: status 走 enum, V3 接 WS 时加 dual_ready_ws_payload JSON
 *
 * V3 升级: 接 WS 推送 (双方 ready 握手), 字段保留 notes / completedSteps.
 */
@Entity('companion_dual_sessions')
@Index('idx_dual_sessions_companion_status', ['companionUid', 'status'])
export class DualSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'char', length: 36, name: 'companion_uid' })
  companionUid!: string;

  @Column({ type: 'char', length: 36, name: 'owner_uid' })
  ownerUid!: string;

  @Column({ type: 'varchar', length: 64, name: 'exercise_id' })
  exerciseId!: string;

  @Column({ type: 'varchar', length: 32, name: 'status', default: 'invited' })
  status!: 'idle' | 'invited' | 'partnerAccepted' | 'inProgress' | 'pausedByConflictRisk' | 'completed' | 'declined';

  @Column({ type: 'simple-json', name: 'completed_steps', nullable: true })
  completedSteps!: number[] | null;

  @Column({ type: 'text', name: 'notes', nullable: true })
  notes!: string | null;

  @CreateDateColumn({ name: 'started_at' })
  startedAt!: Date;

  @Column({ type: 'datetime', name: 'completed_at', nullable: true })
  completedAt!: Date | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
