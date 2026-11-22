import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * 陪伴者自我关怀记录 entity — 陪伴者专属 (大厂企业级 V3).
 *
 * V2.0 §Tab4 我的自我关怀记录页:
 *   - type: mood (情绪打卡) / relax (减压练习) / rest (休息提醒)
 *   - date: 日期
 *   - note: 备注 (optional, V2.0 UI 显示"开始练习"等卡片摘要)
 *
 * 大厂做法:
 *   - INDEX (uid, date DESC) — 时间倒序查
 *   - 1:N 关系, 软删由 users cascade
 *   - V3 接 BullMQ event bus, 累计提醒陪伴者自我关怀频率
 *     当连续 7 天没打卡 → 触发 burnout 预警
 */
@Entity('selfcare_records')
@Index('idx_selfcare_uid_date', ['uid', 'date'])
export class SelfcareRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 关联 users.uid (陪伴者). */
  @Column({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  /** mood / relax / rest — V2.0 §Tab4 三个快入口. */
  @Column({ type: 'varchar', length: 16, name: 'type' })
  type!: 'mood' | 'relax' | 'rest';

  @Column({ type: 'date', name: 'date' })
  date!: string;

  @Column({ type: 'varchar', length: 512, name: 'note', nullable: true })
  note!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
