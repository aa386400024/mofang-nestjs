import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { DualPuzzleCategory } from '../enums/dual-puzzle-category.enum';

/**
 * 默契拼图题目 entity — V2026-09-12 §6.4 共种默契拼图.
 *
 * 大厂 standard:
 *   - prompt 题目正文
 *   - options JSON array (4 选 1, 跟前端严格 1:1)
 *   - category 分类 (大厂 standard: 索引加速分类过滤)
 *   - contextHint 副提示 (可选, 解释题目的场景)
 *
 * 反双胞胎:
 *   - 不复用 assessment/... 的 Question (那是测评题, 单人回答, 跟双作者无关)
 */
@Entity('companion_dual_puzzle_questions')
@Index('idx_dual_puzzle_questions_category', ['category'])
export class DualPuzzleQuestion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 200, name: 'prompt' })
  prompt!: string;

  @Column({ type: 'json', name: 'options' })
  options!: string[];

  @Column({
    type: 'enum',
    enum: DualPuzzleCategory,
    name: 'category',
  })
  category!: DualPuzzleCategory;

  @Column({ type: 'varchar', length: 200, name: 'context_hint', nullable: true })
  contextHint!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
