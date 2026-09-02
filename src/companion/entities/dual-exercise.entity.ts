import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * 双人协同练习 entity — V2.0 §Tab2 双人协同练习库 (V3.0 渐进解锁).
 *
 * 设计:
 *   - 静态配置表 (V2.0 sample 6 个: 伴侣 2 / 亲子 2 / 挚友 2)
 *   - relationScopes JSON 数组 (一个练习可适配多种关系)
 *   - steps JSON 数组 (用户 + 陪伴者各一行, 「我方 / 对方」用 / 分隔)
 *   - guardrails JSON 数组 (冲突暂停 / 隐私边界 等护栏)
 */
@Entity('companion_dual_exercises')
@Index('idx_dual_exercises_relation', ['relationScopes'])
export class DualExercise {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 80, name: 'title' })
  title!: string;

  @Column({ type: 'varchar', length: 200, name: 'subtitle', nullable: true })
  subtitle!: string | null;

  @Column({ type: 'simple-json', name: 'relation_scopes' })
  relationScopes!: string[];

  @Column({ type: 'varchar', length: 32, name: 'modality' })
  modality!: 'narrative' | 'communication' | 'defusion' | 'boundary';

  @Column({ type: 'tinyint', name: 'estimated_minutes' })
  estimatedMinutes!: number;

  @Column({ type: 'simple-json', name: 'steps' })
  steps!: string[];

  @Column({ type: 'simple-json', name: 'guardrails' })
  guardrails!: string[];

  @Column({ type: 'varchar', length: 32, name: 'accent_color_token', default: 'mistyPink' })
  accentColorToken!: string;

  @Column({ type: 'varchar', length: 64, name: 'icon_key', nullable: true })
  iconKey!: string | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
