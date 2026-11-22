import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 默契拼图题目组 — V2026-09-12 §6.4 共种默契拼图.
 *
 * 大厂 standard (跟前端 DualPuzzleSet 1:1):
 *   - title / subtitle (题目组描述)
 *   - questionIds JSON array (一组 5 题, 用 id 数组关联 question)
 *   - 一次性创建, 用作提交答案/取结果的 key
 *
 * 反双胞胎:
 *   - 不复用 rehab-item / soothing-card (无关业务)
 *
 * 设计决策: 用 questionIds JSON 而不是双表 FK, 因为题目一旦组成 set 就稳定
 * (前端 5 题一组), 不需要 JOIN 查询. 大厂 standard 简化读路径.
 */
@Entity('companion_dual_puzzle_sets')
@Index('idx_dual_puzzle_sets_created', ['createdAt'])
export class DualPuzzleSet {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 80, name: 'title' })
  title!: string;

  @Column({ type: 'varchar', length: 200, name: 'subtitle', nullable: true })
  subtitle!: string | null;

  @Column({ type: 'json', name: 'question_ids' })
  questionIds!: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
