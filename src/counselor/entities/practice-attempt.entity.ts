// V2026-10-22 治本 (V1.3 §2.2 — practice_attempts 自由作答练习记录 entity, 1:1 wire §2.2):
//   原因: counselor-practice-engine-v1.3-freeform.md §2.2 原文「反双胞胎」:
//     「不复用 training_exercise_attempts (那是 MCQ 计分表, 有 selectedOptionIndex/score).
//       自由作答零压无分, schema 完全不同, 独立建表.」
//     两张表语义正交:
//       training_exercise_attempts = MCQ 计分 (有分数/对错/候选项索引)
//       practice_attempts          = 自由作答 (无分数/无对错, 只有技术批注)
//     若硬塞进同一张表, 就得给 MCQ 记录塞一堆恒为 null 的自由作字段, 或者反过来
//     给自由作答记录塞一个**永远为 null 的 score** —— 后者尤其糟糕:
//     一旦有 score 列, 客户端早晚会把它显示成"0 分", 零压红线当场破防.
//   修法 (跟 V1.1 §5.2 training-exercise-attempt.entity.ts 风格一致):
//     - UUID PK + char(36) id
//     - tenant_id / user_id / scenario_id char(36) (应用层校验关联, 不写 DB FK)
//     - submitted_text text (text 引擎 = 回应文本; rewrite = 改写后文本;
//       voiceMetric = ASR 转写文本, 可为空串)
//     - record_seconds int NULL + speech_rate_wpm float NULL (语音引擎专用)
//     - feedback json (零压批注: items / referenceResponse / commonPitfalls /
//       attemptOrdinal / source / visitorReaction)
//     - duration_seconds int (本次作答耗时, UI 与留存分析用)
//     - turn int (P2 多轮: 第几轮; 单轮恒为 1)
//     - 2 索引: PRIMARY + idx_pa_user_scenario (user_id, scenario_id) +
//       idx_pa_user_created (user_id, created_at, 最近 7 天活跃天数聚合用)
//     - 软删 deletedAt
//
//   反双胞胎:
//     - 不复用 training_exercise_attempts: 见上 (零压无分 vs MCQ 计分)
//     - 不加 score / is_correct / grade 列: spec §6.2「practice_attempts 不下发分数;
//       任何『评级』文案不进响应」. 表里没有分数列 = 物理上不可能下发分数
//     - 不加 status 状态机列: spec §2.2 的 attempt 表没有状态字段; 自由作答是
//       "提交即评判完成"的同步链路, 没有"待评判"的中间态需要持久化.
//       (spec §3.1 的 `completed` 语义 = 存在已落库的评判记录)
//     - 不用 MySQL ENUM 列类型: 跟项目既有 pattern 一致
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW TABLES LIKE 'practice_attempts'; # 1 张表
//     2. SHOW INDEX FROM practice_attempts; # 3 索引
//     3. DESCRIBE practice_attempts; # 12 列
//     4. 全表 grep 'score' 列名命中数 = 0 (零压红线物理校验)
//
//   时间戳: 2026-10-22
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type { PracticeFeedback } from '../domain/practice/practice.types';
import { PracticeScenarioSource } from '../enums/practice-scenario-source.enum';

/**
 * practice_attempts 表 —— 自由作答练习记录 (零压无分).
 *
 * 跟 TrainingExerciseAttempt (MCQ 计分表) 语义正交, 独立建表 (spec §2.2 反双胞胎).
 */
@Entity('practice_attempts')
@Index('idx_pa_user_scenario', ['userId', 'scenarioId'])
@Index('idx_pa_user_created', ['userId', 'createdAt'])
// §8.5 E1 治本: (user_id, scenario_id, attempt_ordinal) 唯一约束 ——
//   attemptOrdinal 之前只存在于 feedback JSON 里, 无法建索引, 于是"count() 再 insert"
//   的取号方式在并发双击下会给两条记录同一个序号. 抽成独立列 + 唯一约束后,
//   取号变成数据库可强制的唯一性约束 (取号失败 → 重试), 而不是"希望没并发".
@Index('uniq_pa_user_scenario_ordinal', ['userId', 'scenarioId', 'attemptOrdinal'], { unique: true })
// §7.6 P3-c: 练习记录回写五维画像的查询索引 (按用户 + 能力维度聚合信号).
@Index('idx_pa_user_ability', ['userId', 'abilityDimensionCode'])
export class PracticeAttempt {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // V0.x: tenantId = userId (一人一租户, A9).
  @Column({ type: 'char', length: 36, name: 'tenant_id' })
  tenantId!: string;

  // 冗余存储 userId 加速按用户聚合 (避免每次 JOIN scenarios).
  @Column({ type: 'char', length: 36, name: 'user_id' })
  userId!: string;

  // 场景 id (N:1 → practice_scenarios, 应用层校验, 不写 DB FK).
  @Column({ type: 'char', length: 36, name: 'scenario_id' })
  scenarioId!: string;

  // 用户提交内容 (text 引擎 = 回应文本; rewrite = 改写后文本; voiceMetric = ASR 转写文本).
  @Column({ type: 'text', name: 'submitted_text' })
  submittedText!: string;

  // 语音引擎专用: 录音时长 (秒).
  @Column({ type: 'int', name: 'record_seconds', nullable: true })
  recordSeconds!: number | null;

  // 语音引擎专用: 语速 (字/分, 由 ASR 文本长度与录音时长折算).
  @Column({ type: 'float', name: 'speech_rate_wpm', nullable: true })
  speechRateWpm!: number | null;

  // AI 评判产出 (零压批注, 无分数).
  @Column({ type: 'json' })
  feedback!: PracticeFeedback;

  // 本次作答耗时 (秒).
  @Column({ type: 'int', name: 'duration_seconds' })
  durationSeconds!: number;

  // P2 多轮: 第几轮 (单轮场景恒为 1).
  @Column({ type: 'int', default: 1 })
  turn!: number;

  // 该用户在本场景的第几次作答 (1-based).
  //
  // V2026-10-22 治本 (§8.5 E1 — 取号从 JSON 提到独立列):
  //   之前 attemptOrdinal 只存在 feedback JSON 里, 没法建唯一索引, 于是取号靠
  //   "count() 再 insert" —— 并发双击同场景会拿到相同序号, 且没有任何东西拦得住.
  //   抽成独立列后, (user_id, scenario_id, attempt_ordinal) 可以建 UNIQUE 约束,
  //   取号的正确性由数据库强制保证.
  @Column({ type: 'int', name: 'attempt_ordinal', default: 1 })
  attemptOrdinal!: number;

  // V1.3 §7.5: 场景来源表 (seed = 标准内容库 / custom = 用户私有场景).
  // 默认 'seed' = 存量行的语义正确, 不需要迁移旧数据.
  @Column({ type: 'varchar', length: 20, name: 'scenario_source', default: 'seed' })
  scenarioSource!: PracticeScenarioSource;

  // V1.3 §7.6 P3-c: 本次作答回写五维画像的能力子指标 code (NULL = 该基本功不参与画像回写).
  @Column({ type: 'varchar', length: 50, name: 'ability_dimension_code', nullable: true })
  abilityDimensionCode!: string | null;

  // V1.3 §7.6 P3-c: 本次作答对该子指标的信号强度 (0-100; NULL = 本次无可计入信号).
  //
  // 零压红线说明: 这两列是**内部**记账字段, 从不出现在任何 practice 出参 DTO 里
  //   (spec §6.2「practice_attempts 不下发分数」在出参层依然是结构性保证).
  //   它表达的是"用户在这个技能上的能力画像信号", 与"这次答得怎么样"是两件事 ——
  //   前者跨次累积成雷达图, 后者每次都是零压技术批注.
  @Column({ type: 'int', name: 'ability_signal', nullable: true })
  abilitySignal!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  // 软删 (跟 V3 其他模块一致).
  @Column({ type: 'datetime', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}
