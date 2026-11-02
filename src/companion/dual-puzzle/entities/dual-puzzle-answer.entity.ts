import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 默契拼图作答 entity — V2026-09-12 §6.4 共种默契拼图.
 *
 * 大厂 standard:
 *   - 联合主键 (setId + userId) — 1 人 1 组只能答 1 次
 *   - choiceByQuestionId JSON (questionId → 选项 index 0..3)
 *   - 当双方都答完 → 算 chemistryScore (不存, 用结果查询时算)
 *
 * 反双胞胎:
 *   - 不复用 assessment/answer (那是单人测评答案, 跟双作者无关)
 */
@Entity('Companion_dual_puzzle_answers')
@Index('idx_dual_puzzle_answers_set_user', ['setId', 'userId'], { unique: true })
export class DualPuzzleAnswer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'set_id' })
  setId!: string;

  @Column({ type: 'varchar', length: 64, name: 'user_id' })
  userId!: string;

  /**
   * questionId → 选项 index (0..3).
   */
  @Column({ type: 'json', name: 'choice_by_question_id' })
  choiceByQuestionId!: Record<string, number>;

  @CreateDateColumn({ name: 'completed_at' })
  completedAt!: Date;
}
