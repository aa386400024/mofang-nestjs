// V2026-10-22 治本 (V1.3 §2.1 — practice_scenarios 场景变体库 entity, 1:1 wire §2.1):
//   原因: counselor-practice-engine-v1.3-freeform.md §1.2 定义「1 个基本功 = 6 个场景
//     变体」, 变体由「主诉槽位 × 防御风格槽位」组合而来, 每个变体是一个**独立来访者**
//     (不同的人 / 不同的开场 / 不同的参考回应). §2.1 拍板建独立表 practice_scenarios,
//     与 §4 「反双胞胎对账」明确: `training_exercises` (MCQ 计分表) **一行不改**,
//     自由作答的零压无分记录另落 practice_attempts.
//   修法 (跟 V1.1 §5.2 training-exercise.entity.ts 风格一致):
//     - UUID PK + char(36) id
//     - tenant_id char(36) (A9 一人一租户; 全局共享内容库用系统租户哨兵值, 见
//       PRACTICE_SYSTEM_TENANT_ID)
//     - user_id char(36) NULL (内容库全局共享 → NULL; V2/P3 用户自建场景 → 本人 id)
//     - exercise_mode varchar 50 (1:1 wire 现有 TrainingExerciseMode 10 档,
//       **不新增 enum**: spec §1.1 明确「后端不加 practiceMode 列」)
//     - scenario_key varchar 80 UNIQUE (幂等 upsert 键; 改名等同换场景, 会丢历史)
//     - difficulty int (1/2/3, 数值枚举 PracticeDifficulty, 与 §2.1 的 int 列逐字节一致)
//     - is_ai_generated tinyint (0 = 手工题库 / 1 = AI 生成; 内容审核责任在生成方)
//     - persona json (来访者画像: 姓名/年龄/性别/职业/防御风格/情绪负荷/背景)
//     - opening_line / task_prompt / botched_utterance / voice_script /
//       reference_response text (场景内容 5 段)
//     - common_pitfalls json (常见偏差, 批注卡「留意避免」)
//     - rubric json (评判锚点: LLM 评判的结构化输入 + P0 降级判定依据)
//     - expected_turns int (P2 多轮: 该场景期望的往返轮数, 单轮恒为 1)
//     - enabled tinyint (共享内容库的**审核闸门**: AI 产出的共享内容先置 0,
//       待持证咨询师审核后置 1; 延续 v1.2 §11.1)
//     - 4 索引: PRIMARY + uniq_ps_scenario_key (scenario_key UNIQUE) +
//       idx_ps_mode_enabled (exercise_mode, enabled) + idx_ps_user (user_id)
//     - 软删 deletedAt (跟 V3 其他模块一致)
//
//   反双胞胎:
//     - 不复用 training_exercises: 那是 MCQ 计分表 (有 correctOptionIndex / score),
//       自由作答零压无分, schema 完全不同 (spec §2.2 原文「反双胞胎」段)
//     - 不用 MySQL ENUM 列类型: 跟项目既有的 varchar + 应用层 enum pattern 一致,
//       避免 DB schema 跟枚举字符串 drift
//     - 不加 DB-level FK: 跟 ADR-0003 一致 (跨表引用应用层校验)
//     - 不把引擎 (三引擎) 落列: 引擎是 mode 的派生属性, 落列会产生第二事实源
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW TABLES LIKE 'practice_scenarios'; # 1 张表
//     2. SHOW INDEX FROM practice_scenarios; # 4 索引 (PRIMARY + uniq key + mode_enabled + user)
//     3. DESCRIBE practice_scenarios; # 20 列
//     4. npm run seed:practice → 60 行; 连跑两次行数不变 (幂等)
//
//   时间戳: 2026-10-22
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import type { PracticeScenarioPersona, PracticeScenarioRubric } from '../domain/practice/practice.types';
import { PracticeDifficulty } from '../enums/practice-difficulty.enum';
import { TrainingExerciseMode } from '../enums/training-exercise-mode.enum';

/**
 * practice_scenarios 表 —— 微技能自由练习的**场景变体库**.
 *
 * 1:1 wire V1.3 §2.1 拍板. 内容由 bin/seed-practice-scenarios.ts 按 scenario_key
 * 幂等 upsert 灌入 (spec §6.3: 内容库 seed 走独立脚本, 不进 migration).
 */
@Entity('practice_scenarios')
@Index('uniq_ps_scenario_key', ['scenarioKey'], { unique: true })
@Index('idx_ps_mode_enabled', ['exerciseMode', 'enabled'])
@Index('idx_ps_user', ['userId'])
export class PracticeScenario {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // V0.x: tenantId = userId (一人一租户, A9). 全局共享内容库用系统租户哨兵值.
  @Column({ type: 'char', length: 36, name: 'tenant_id' })
  tenantId!: string;

  // 内容库全局共享时为 NULL; 用户自建场景 (V2/P3) 填本人 id.
  @Column({ type: 'char', length: 36, name: 'user_id', nullable: true })
  userId!: string | null;

  // 所属基本功 (varchar 50, 1:1 wire 现有 TrainingExerciseMode 10 档, 不新增 enum).
  @Column({ type: 'varchar', length: 50, name: 'exercise_mode' })
  exerciseMode!: TrainingExerciseMode;

  // 稳定 slug (seed 幂等 upsert 键, e.g. emotion_reflection_l1_01).
  // 改名等同于换场景 —— 会丢历史练习记录, 发布后即是对外契约.
  // 唯一索引走 @Index('uniq_ps_scenario_key', ..., { unique: true }), 不用列级
  // unique: true —— 后者生成的索引名是 TypeORM 内部哈希, 与 migration 里的具名
  // 索引对不上, 排查 schema drift 时两边名字不一致.
  @Column({ type: 'varchar', length: 80, name: 'scenario_key' })
  scenarioKey!: string;

  // 难度梯 1/2/3 (数值枚举, 落库即 int).
  @Column({ type: 'int' })
  difficulty!: PracticeDifficulty;

  // 是否 AI 生成 (0 = 手工题库; 1 = AI 生成, 内容审核责任在生成方).
  @Column({ type: 'tinyint', name: 'is_ai_generated', default: 0 })
  isAiGenerated!: boolean;

  // 来访者画像 (表层人设, 跟 v1.2 M1 浅表层同口径).
  @Column({ type: 'json' })
  persona!: PracticeScenarioPersona;

  // 来访者开场白 (来访者第一句话, 客户端气泡直接展示).
  @Column({ type: 'text', name: 'opening_line' })
  openingLine!: string;

  // 训练任务说明 (给用户看的一句话: 如「用你自己的话, 把他此刻的情绪反射回去」).
  @Column({ type: 'text', name: 'task_prompt' })
  taskPrompt!: string;

  // rewrite 引擎专用: 被砸了的原话 (AI 来访刚说了这句糟糕回应, 用户改写).
  @Column({ type: 'text', name: 'botched_utterance', nullable: true })
  botchedUtterance!: string | null;

  // voiceMetric 引擎专用: 要求用户朗读的文本.
  @Column({ type: 'text', name: 'voice_script', nullable: true })
  voiceScript!: string | null;

  // 参考回应 (批注卡「可以参考这样回应」).
  @Column({ type: 'text', name: 'reference_response' })
  referenceResponse!: string;

  // 常见偏差 (批注卡「留意避免」).
  @Column({ type: 'json', name: 'common_pitfalls' })
  commonPitfalls!: string[];

  // 评判 rubric (AI 评判 prompt 的结构化锚点; P0 降级路径做关键词匹配).
  @Column({ type: 'json' })
  rubric!: PracticeScenarioRubric;

  // P2 多轮: 该场景期望的往返轮数 (单轮场景恒为 1).
  @Column({ type: 'int', name: 'expected_turns', default: 1 })
  expectedTurns!: number;

  // 启用状态 (tinyint). 共享内容库里同时充当**审核闸门**:
  //   AI 产出的共享内容先置 0, 待持证咨询师审核后置 1 (延续 v1.2 §11.1).
  //   用户自建的私有场景置 1, 但仅本人可见 (user_id 过滤).
  @Column({ type: 'tinyint', default: 1 })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // 软删 (跟 V3 其他模块一致).
  @Column({ type: 'datetime', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}
