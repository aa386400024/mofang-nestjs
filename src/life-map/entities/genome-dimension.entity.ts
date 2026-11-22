import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export const GENOME_DIMENSION_KEYS = [
  'security', // 安全感
  'self_esteem', // 自尊水平
  'autonomy', // 自主性
  'resilience', // 心理韧性
  'self_integration', // 自我整合
] as const;
export type GenomeDimensionKey = (typeof GENOME_DIMENSION_KEYS)[number];

/**
 * 心理基因维度盘点 — V3.0 §3 Tab3 心理地图核心表.
 *
 * 一行 = 一用户一维度 (UNIQUE user_id + key).
 *
 * V3.0 治本:
 *   - 5 个维度一次性写入, 减少前端请求次数
 *   - 加 deleted_at 软删
 *   - score 0-100, 必填
 *   - tier 由 score 自动计算 (gentle/balanced/stable/strong)
 */
@Entity('genome_dimensions')
@Index('idx_gd_user', ['userId'])
@Index('uniq_gd_user_key', ['userId', 'key'], { unique: true })
export class GenomeDimensionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'user_id' })
  userId!: string;

  @Column({ type: 'enum', enum: GENOME_DIMENSION_KEYS, name: 'key' })
  key!: GenomeDimensionKey;

  /** 维度得分 0-100. */
  @Column({ type: 'int', name: 'score' })
  score!: number;

  @Column({ type: 'varchar', length: 16, name: 'tier' })
  tier!: 'gentle' | 'balanced' | 'stable' | 'strong';

  @Column({ type: 'text', name: 'source', nullable: true })
  source?: string | null;

  @Column({ type: 'text', name: 'improvement', nullable: true })
  improvement?: string | null;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime', name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'datetime', name: 'deleted_at', nullable: true })
  deletedAt?: Date | null;
}
