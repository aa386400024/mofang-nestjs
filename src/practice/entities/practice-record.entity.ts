import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Practice 训练记录 entity — V2.0 §Tab2 心理健身房训练记录 / Tab4 我的数据.
 *
 * V2.0 范围:
 *   - 由 PracticeSessionService.completeSession 写库
 *   - 前端 /practice/gym/records?since= 拉取历史记录
 *   - 后续 dashboard 模块会按 uid + completedAt 聚合 (本周分钟数 / 4 模块进度)
 *
 * 大厂做法:
 *   - module 字段冗余写库 (避免 join tool 表), 写多读少场景的性能 trade-off
 *   - INDEX (uid, completed_at DESC) — 训练记录按时间倒序查
 *   - 软删由 users.deleted_at FK cascade 触发 (不需要 deleted_at 字段)
 */
@Entity('practice_records')
@Index('idx_practice_records_uid_completed', ['uid', 'completedAt'])
@Index('idx_practice_records_uid_module_completed', ['uid', 'module', 'completedAt'])
export class PracticeRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  @Column({ type: 'varchar', length: 64, name: 'tool_key' })
  toolKey!: string;

  @Column({ type: 'varchar', length: 80, name: 'tool_title' })
  toolTitle!: string;

  @Column({ type: 'varchar', length: 32, name: 'module' })
  module!: string;

  @Column({ type: 'int', name: 'duration_minutes' })
  durationMinutes!: number;

  @CreateDateColumn({ name: 'completed_at' })
  completedAt!: Date;
}
