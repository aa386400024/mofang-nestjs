import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * 同步练习 entity — V2.0 §Tab2 同步练习分区.
 *
 * 设计:
 *   - 静态配置表 (V2.0 sample 5 个), 跟 HomeCompanionService 的同步练习复用同一份
 *     (V3 接 LLM 个性化推荐时, 改成 uid 关联 + 个性化配置)
 *   - 字段跟前端 SyncPractice entity 1:1, 缺字段兜底
 */
@Entity('companion_sync_practices')
@Index('idx_sync_practices_relation', ['relation'])
export class SyncPractice {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 80, name: 'title' })
  title!: string;

  @Column({ type: 'varchar', length: 200, name: 'subtitle', nullable: true })
  subtitle!: string | null;

  @Column({ type: 'tinyint', name: 'duration_minutes' })
  durationMinutes!: number;

  @Column({ type: 'varchar', length: 16, name: 'relation' })
  relation!: 'partner' | 'family' | 'friend' | 'other';

  @Column({ type: 'varchar', length: 32, name: 'accent_color_token', default: 'mintCyan' })
  accentColorToken!: string;

  @Column({ type: 'simple-json', name: 'steps' })
  steps!: string[];

  @Column({ type: 'varchar', length: 64, name: 'icon_key', nullable: true })
  iconKey!: string | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
