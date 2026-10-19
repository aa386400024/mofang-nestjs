// V2026-10-19 治本 (V1.1 §5.2 企业级 — training_exercises entity, 1:1 wire §5.2 + §6.5 拍板):
//   原因: counselor-mode-v1.1 §5.2 拍板专项技能 10 训练项, V0.5 stage 简化版
//     0 落地 1:1 阻断 §5.2 1:1 wire (大炮 16:10 "A, 要企业级的方案, 不要凑活"
//     1:1 反馈). 跟 V0.5 counselor_training_session entity (V2026-10-19 治本
//     §6.5 1:1 wire 落地) 拍板风格一致: UUID PK + char(36) id + enum 3 个
//     (type/mode/difficulty) + 字段 14+ 1:1 wire §5.2.1/5.2.2/5.2.3 拍板 10 训练项
//     + AI 评分标准 (rubric) + 专家反馈 (expertFeedback) + 实时纠偏开关
//     (realTimeCorrectionEnabled).
//   修法 (跟 V0.5 training-session.entity.ts V2026-10-19 治本续 V8.3 1:1 wire 风格):
//     - UUID PK + char(36) id (跟 V0.5 1:1 wire 风格)
//     - type varchar 50 (3 档 enum, 1:1 wire V0.5 client TrainingExerciseType)
//     - mode varchar 50 (10 档 enum, 1:1 wire V0.5 client TrainingExerciseMode)
//     - difficulty varchar 20 (3 档 enum, 1:1 wire V0.5 client TrainingDifficulty)
//     - scenario_context text (1:1 wire §5.2 给定来访者陈述)
//     - options json (1:1 wire §5.2 候咨询师回应选项, 4-6 个候选项 JSON 数组)
//     - correct_option_index int (0-based, 1:1 wire §5.2 拍板)
//     - rubric json (1:1 wire §5.2 评分标准: 维度分 + 关键词 + 错误模式 + 改进建议)
//     - expert_feedback text (1:1 wire §5.2 拍板 专家反馈)
//     - real_time_correction_enabled tinyint (1:1 wire §5.2.4 拍板 默认 0)
//     - duration_minutes int (V0.5 stage 简化 L1=5 / L2=8 / L3=10)
//     - persona_name varchar 100 + persona_background text (跟 V0.5
//       TrainingSession 1:1 wire 拍板)
//     - enabled tinyint 默认 1 (V0.5 culture 1:1 wire 软删, 跟 V3 其他模块一致)
//     - 5 索引: PRIMARY + idx_te_type_mode (type, mode) + idx_te_difficulty +
//       idx_te_type_diff (type, difficulty) + idx_te_enabled (enabled)
//     - 软删 deletedAt (跟 V3 其他模块一致)
//
//   反双胞胎:
//     - 不复用 V0.5 TrainingSession (1:1 wire 0 破坏 V0.3 §13 baseline, 训练题跟
//       训练对话页 5 状态机是正交概念, 单独建 entity 1:1 wire §5.2 拍板)
//     - 不用 type: 'enum' 列类型 (V0.x pattern 风格走 varchar + 应用层 enum
//       校验, V0.5 治本 V2026-10-12 1:1 wire 一致, 避免 DB schema 跟 enum 字符串
//       drift)
//     - 不存 vector 字段: V1.x JSON 足够 (options/rubric 数组), V2.x RAG 升级再切
//     - 不加 polymorphic sessionType 字段: 训练题是独立 entity, 跟 V0.5 训练
//       会话 entity 1:1 wire 0 关联 (V0.5 V2026-10-19 §6.5 拍板 training_sessions 表
//       跟本表 1:1 wire 0 交叉)
//     - 不引用 V0.5 supervision_feedback (1:1 wire 0 破坏, 督导反馈是 §4.6
//       核心增量, 训练题是 §5.2 核心增量, 2 概念正交)
//
//   验证 (大炮跑 pnpm migration:run + tsc 0 错):
//     1. SHOW TABLES LIKE 'training_exercises'; # 1 张表
//     2. SHOW INDEX FROM training_exercises; # 5 索引 (PRIMARY + 4 复合)
//     3. DESCRIBE training_exercises; # 19 列 (id + 14 字段 + createdAt/updatedAt/
//        deletedAt + 5 索引覆盖列)
//     4. SELECT * FROM training_exercises LIMIT 0; # 空表 (Phase 2 seed 后填数据)
//
//   时间戳: 2026-10-19
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { TrainingExerciseMode } from '../enums/training-exercise-mode.enum';
import { TrainingExerciseType } from '../enums/training-exercise-type.enum';
import { TrainingDifficulty } from '../enums/training-difficulty.enum';

/**
 * 训练题评分标准 (rubric json 字段 1:1 wire, 跟 xin_su_app TrainingExerciseRubric 1:1 wire).
 *
 * 1:1 wire V1.1 §5.2 拍板: 评分维度 + 关键词命中 + 错误模式 + 改进建议.
 */
export interface TrainingExerciseRubric {
  /** 评分维度 (e.g. [{'name': '情绪反射准确度', 'weight': 0.4}, ...]) */
  dimensions: Array<{ name: string; weight: number }>;
  /** 关键词命中 (e.g. ['共情', '倾听', '情绪反射']) */
  keywords: string[];
  /** 错误模式 (e.g. ['过早给建议', '打断', '价值判断']) */
  errorPatterns: string[];
  /** 改进建议 (e.g. ['先确认对方情绪再给出回应']) */
  improvementHints: string[];
}

/**
 * training_exercises 表.
 *
 * 1:1 wire V1.1 §5.2 拍板 10 训练项 (倾听共情 3 + 提问技术 4 + 语音微训练 3).
 * 跟 V0.5 xin_su_app TrainingExercise entity 1:1 wire 拍板.
 */
@Entity('training_exercises')
@Index('idx_te_type_mode', ['type', 'mode'])
@Index('idx_te_difficulty', ['difficulty'])
@Index('idx_te_type_diff', ['type', 'difficulty'])
@Index('idx_te_enabled', ['enabled'])
export class TrainingExercise {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // 训练题类型 (varchar 50, 1:1 wire V0.5 client TrainingExerciseType 3 档 enum)
  @Column({ type: 'varchar', length: 50 })
  type!: TrainingExerciseType;

  // 训练题子模式 (varchar 50, 1:1 wire V0.5 client TrainingExerciseMode 10 档 enum)
  @Column({ type: 'varchar', length: 50 })
  mode!: TrainingExerciseMode;

  // 难度 (varchar 20, 1:1 wire V0.5 client TrainingDifficulty enum)
  @Column({ type: 'varchar', length: 20 })
  difficulty!: TrainingDifficulty;

  // 给定来访者陈述 (V1.1 §5.2 拍板, 训练题上下文)
  @Column({ type: 'text', name: 'scenario_context' })
  scenarioContext!: string;

  // 候咨询师回应选项 (json 数组, 1:1 wire §5.2 拍板)
  @Column({ type: 'json' })
  options!: string[];

  // 正确答案索引 (0-based, 1:1 wire §5.2 拍板)
  @Column({ type: 'int', name: 'correct_option_index' })
  correctOptionIndex!: number;

  // 评分标准 (json, 1:1 wire §5.2 拍板)
  @Column({ type: 'json' })
  rubric!: TrainingExerciseRubric;

  // 专家反馈 (改进建议 + 优秀回答示例, 1:1 wire §5.2 拍板)
  @Column({ type: 'text', name: 'expert_feedback' })
  expertFeedback!: string;

  // 时长 (分钟, V0.5 stage 简化 L1=5 / L2=8 / L3=10)
  @Column({ type: 'int', name: 'duration_minutes' })
  durationMinutes!: number;

  // 来访者姓名 (跟 V0.5 TrainingSession.personaName 1:1 wire 拍板)
  @Column({ type: 'varchar', length: 100, name: 'persona_name' })
  personaName!: string;

  // 来访者背景 (跟 V0.5 TrainingSession.personaBackground 1:1 wire 拍板)
  @Column({ type: 'text', name: 'persona_background' })
  personaBackground!: string;

  // 实时纠偏开关 (1:1 wire §5.2.4 拍板, 默认 0)
  @Column({ type: 'tinyint', name: 'real_time_correction_enabled', default: 0 })
  realTimeCorrectionEnabled!: boolean;

  // 启用状态 (V0.5 culture 1:1 wire 软删, 默认 1)
  @Column({ type: 'tinyint', default: 1 })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // 软删 (跟 V3 其他模块一致)
  @Column({ type: 'datetime', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}
