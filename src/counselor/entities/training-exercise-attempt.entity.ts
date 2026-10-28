// V2026-10-19 治本 (V1.1 §5.2 企业级 — training_exercise_attempts entity, 1:1 wire §5.2 + §6.5 拍板):
//   原因: counselor-mode-v1.1 §5.2 拍板专项技能 训练题模式 (选择题 + AI 评分 +
//     即时反馈), 跟 V0.5 stage 简化版 0 落地 1:1 阻断 §5.2 1:1 wire. 答题记录
//     entity 1:1 wire §5.2 拍板: 用户做题历史 + 评分结果 + 维度分 + AI 反馈, 跟
//     V0.5 TrainingSession 5 状态机 transcript 1:1 wire 拍板风格 (V0.3 §13 baseline
//     0 破坏).
//   修法 (跟 V0.5 training-session.entity.ts V2026-10-19 治本续 V8.3 1:1 wire 风格):
//     - UUID PK + char(36) id (跟 V0.5 1:1 wire 风格)
//     - tenantId + userId char(36) 双索引 (V0.x 多租户, A9 一人一租户)
//     - exercise_id char(36) (1:1 wire N:1 关系, 应用层校验, V0.x pattern 风格
//       不写 DB-level FK, 软删兼容)
//     - selected_option_index int (0-based, 用户选择的候选项索引)
//     - is_correct tinyint (1:1 wire §5.2 拍板 AI 评分正确性)
//     - score int 0-100 (1:1 wire §5.2 拍板总分)
//     - dimension_scores json (1:1 wire §5.2 拍板维度分, 跟 rubric.dimensions 1:1 wire)
//     - ai_feedback text (1:1 wire §5.2 拍板 AI 生成的即时反馈)
//     - status varchar 20 (5 档 enum 1:1 wire §5.2 拍板, pending/inProgress/
//       submitted/graded/abandoned)
//     - attempt_duration_seconds int (用户做题时长, UI 进度用)
//     - real_time_correction_used tinyint (1:1 wire §5.2.4 拍板)
//     - completed_at datetime nullable (用户提交时间, 1:1 wire §5.2 拍板)
//     - 4 索引: PRIMARY + idx_tea_user (userId) + idx_tea_exercise (exerciseId) +
//       idx_tea_status (status)
//     - 软删 deletedAt (跟 V3 其他模块一致)
//
//   反双胞胎:
//     - 不复用 V0.5 supervision_feedback (1:1 wire 0 破坏, 督导反馈是 §4.6
//       核心增量, 训练题答题是 §5.2 核心增量, 2 概念正交, 单独建 entity)
//     - 不加 polymorphic sessionId 字段 (训练题答题是独立概念, 跟 V0.5
//       训练会话 entity 1:1 wire 0 关联, 1:1 wire §5.2 拍板独立 entity)
//     - 不用 type: 'enum' 列类型 (V0.x pattern 风格走 varchar + 应用层 enum
//       校验, 跟 TrainingExercise 1:1 wire 拍板一致)
//     - 不存 vector 字段: V1.x JSON 足够 (dimensionScores), V2.x RAG 升级再切
//
//   验证 (大炮跑 pnpm migration:run + tsc 0 错):
//     1. SHOW TABLES LIKE 'training_exercise_attempts'; # 1 张表
//     2. SHOW INDEX FROM training_exercise_attempts; # 4 索引 (PRIMARY + 3 复合)
//     3. DESCRIBE training_exercise_attempts; # 17 列
//     4. SELECT * FROM training_exercise_attempts LIMIT 0; # 空表 (Phase 2 seed
//        后用户首次答题填数据)
//
//   时间戳: 2026-10-19
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { TrainingAttemptStatus } from '../enums/training-attempt-status.enum';

/**
 * training_exercise_attempts 表.
 *
 * 1:1 wire V1.1 §5.2 拍板 (跟 V0.5 supervision_feedback 1:1 wire 拍板风格,
 * V0.3 §13 baseline 0 破坏), 跟 TrainingExercise N:1 关系 (应用层校验).
 */
@Entity('training_exercise_attempts')
@Index('idx_tea_user', ['userId'])
@Index('idx_tea_exercise', ['exerciseId'])
@Index('idx_tea_status', ['status'])
export class TrainingExerciseAttempt {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // V0.x: tenantId = userId (一人一租户, A9). V1.x 多租户上线后 backfill.
  @Column({ type: 'char', length: 36, name: 'tenant_id' })
  tenantId!: string;

  // 冗余存储 userId 加速按 user 聚合 (避免跨 polymorphic 表 join), 跟 V0.5
  // supervision_feedback 1:1 wire 拍板风格.
  @Column({ type: 'char', length: 36, name: 'user_id' })
  userId!: string;

  // 训练题 id (1:1 wire §5.2 拍板, 应用层校验 N:1 关系)
  @Column({ type: 'char', length: 36, name: 'exercise_id' })
  exerciseId!: string;

  // 用户选择的候选项索引 (0-based)
  @Column({ type: 'int', name: 'selected_option_index' })
  selectedOptionIndex!: number;

  // 是否正确 (1:1 wire §5.2 拍板 AI 评分正确性)
  @Column({ type: 'tinyint', name: 'is_correct' })
  isCorrect!: boolean;

  // 总分 0-100 (1:1 wire §5.2 拍板)
  @Column({ type: 'int' })
  score!: number;

  // 维度分 (json, 1:1 wire §5.2 拍板, 跟 TrainingExercise.rubric.dimensions 1:1 wire)
  @Column({ type: 'json', name: 'dimension_scores' })
  dimensionScores!: Record<string, number>;

  // AI 反馈 (1:1 wire §5.2 拍板 AI 生成的即时反馈)
  @Column({ type: 'text', name: 'ai_feedback' })
  aiFeedback!: string;

  // 做题时长 (秒, UI 进度用)
  @Column({ type: 'int', name: 'attempt_duration_seconds', default: 0 })
  attemptDurationSeconds!: number;

  // 是否使用实时纠偏 (1:1 wire §5.2.4 拍板)
  @Column({ type: 'tinyint', name: 'real_time_correction_used', default: 0 })
  realTimeCorrectionUsed!: boolean;

  // 状态 (varchar 20, 5 档 enum 1:1 wire §5.2 拍板)
  @Column({ type: 'varchar', length: 20 })
  status!: TrainingAttemptStatus;

  // 完成时间 (用户提交时间, nullable 1:1 wire §5.2 拍板)
  @Column({ type: 'datetime', name: 'completed_at', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // 软删, 跟 V3 其他模块一致.
  @Column({ type: 'datetime', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}
