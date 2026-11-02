// V2026-10-22 治本 (V1.3 §7.5 — practice_custom_scenarios 用户私有场景表 entity):
//   原因: spec §7.5 原文「**不落 `practice_scenarios` 主表** (那是公共 seed 库);
//     练习时通过 §3.3 评判时按 `scenarioSource=custom` 路由到本表取 content」.
//     这条边界必须由**物理分表**来保证, 不能靠"在主表里用 user_id 区分"这种约定:
//       - 主表 practice_scenarios 的 user_id 语义是「共享库 user_id IS NULL,
//         自建 user_id = 本人」, 若把 §7 的自建场景也塞进去, 主表就同时承担
//         "审核过的公共题库" 与 "未审核的用户私有草稿" 两种语义, enabled 闸门
//         (审核开关) 立刻失去意义 —— 一个没被审核的 AI 产出和一个已审核题库混在同一列.
//       - §7.4 明确「该接口是唯一每次都调 LLM 的练习接口」, 它的产出**必然**未经审核,
//         物理隔离是唯一能保证「公共题库里的每一条都过审」这条不变式的做法.
//
//   修法 (跟 V1.3 §2.1 practice-scenario.entity.ts 风格一致):
//     - UUID PK + char(36) id
//     - tenant_id char(36) (A9 一人一租户; 私有场景天然属于本人)
//     - user_id char(36) NOT NULL (私有场景必属本人, 永不为 NULL)
//     - exercise_id char(36) NULL (spec §7.2 的 `exerciseId`: 关联 training_exercises
//       的那一道题, 用于 1:1 wire 客户端与审计; LLM 自行推断基本功时可为空)
//     - exercise_mode varchar(50) NOT NULL (**路由主键**: 10 档 TrainingExerciseMode,
//       决定三引擎与 rubric 口径; 不加它就得每次 JOIN training_exercises 反查 mode)
//     - difficulty int NOT NULL (1/2/3; LLM 自评难度, 服务端夹到合法区间)
//     - source_payload json NOT NULL (用户三问原文: visitorQuote / counselorReply /
//       stuckPoint / hintExerciseId —— **原样保留**, 不做脱敏改写:
//       这是用户自己的输入, 且 §7.3 的脱敏要求只针对"生成的对外内容")
//     - generated_scenario json NOT NULL (LLM 输出: persona / openingLine /
//       taskPrompt / rubric / referenceResponse / commonPitfalls)
//     - scenario_key varchar(80) UNIQUE (幂等键; 私有场景用随机 UUID 派生, 保证
//       与共享库的 slug 命名空间不冲突)
//     - enabled tinyint (默认 1; 私有场景不进公共库, 无审核闸门语义, 保留列是为将来
//       "用户主动归档/隐藏" 预留, 与主表列语义对齐避免两表结构漂移)
//     - 2 索引: PRIMARY + uniq_pcs_scenario_key + idx_pcs_user_created
//     - 软删 deletedAt (spec §6.4 硬约束)
//
//   反双胞胎:
//     - 不复用 practice_scenarios: 见上 (审核闸门语义冲突)
//     - 不加 score / is_correct 列: 零压红线 (spec §6.2), 本表存的是场景内容不是成绩
//     - 不加 DB-level FK: 跟 ADR-0003 一致 (跨表引用应用层校验)
//     - 不用 MySQL ENUM 列类型: 跟项目既有 pattern 一致 (varchar + 应用层 enum)
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW TABLES LIKE 'practice_custom_scenarios'; # 1 张表
//     2. SHOW INDEX FROM practice_custom_scenarios; # 3 索引
//     3. DESCRIBE practice_custom_scenarios; # 13 列
//     4. SHOW COLUMNS FROM practice_attempts LIKE 'scenario_source'; # 默认 'seed'
//
//   时间戳: 2026-10-22
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import type { PracticeCustomScenarioContent, PracticeCustomScenarioSourcePayload } from '../domain/practice/practice.types';
import { PracticeDifficulty } from '../enums/practice-difficulty.enum';
import { PracticeScenarioGenerationMode } from '../enums/practice-scenario-generation-mode.enum';
import { TrainingExerciseMode } from '../enums/training-exercise-mode.enum';

/**
 * practice_custom_scenarios 表 —— 用户私有练习场景 (「我遇到了真实情况」).
 *
 * spec §7.5 拍板. 与共享内容库 `practice_scenarios` **物理隔离**:
 * 共享库里的每一条都过审, 私有库里的每一条都只对本人可见且必然是 LLM 现场生成.
 */
@Entity('practice_custom_scenarios')
@Index('uniq_pcs_scenario_key', ['scenarioKey'], { unique: true })
@Index('idx_pcs_user_created', ['userId', 'createdAt'])
export class PracticeCustomScenario {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // V0.x: tenantId = userId (一人一租户, A9). 私有场景必然属于本人, 不存在哨兵值.
  @Column({ type: 'char', length: 36, name: 'tenant_id' })
  tenantId!: string;

  // 私有场景的归属人 (NOT NULL, 永不为 NULL —— 与主表的 user_id IS NULL 语义相反).
  @Column({ type: 'char', length: 36, name: 'user_id' })
  userId!: string;

  // 关联的 training_exercises 主键 (spec §7.2 响应体的 `exerciseId`).
  // NULL = 用户没给 hint 且由 LLM 自行推断基本功; 有值时必须是本库真实存在的题目.
  @Column({ type: 'char', length: 36, name: 'exercise_id', nullable: true })
  exerciseId!: string | null;

  // 归属基本功 (varchar 50, 1:1 wire 现有 TrainingExerciseMode 10 档, 不新增 enum).
  // 这是**路由主键**: 决定三引擎 (接话/改写/语音) 与 rubric 判定口径.
  @Column({ type: 'varchar', length: 50, name: 'exercise_mode' })
  exerciseMode!: TrainingExerciseMode;

  // 难度梯 1/2/3 (LLM 自评; 服务端在生成后夹到 [1,3] 合法区间).
  @Column({ type: 'int' })
  difficulty!: PracticeDifficulty;

  // 用户三问原文 (原样保留, 不脱敏 —— 这是用户自己的输入, 脱敏只针对生成内容).
  @Column({ type: 'json', name: 'source_payload' })
  sourcePayload!: PracticeCustomScenarioSourcePayload;

  // LLM 生成的场景内容 (persona / openingLine / taskPrompt / rubric / 参考回应 / 常见偏差).
  @Column({ type: 'json', name: 'generated_scenario' })
  generatedScenario!: PracticeCustomScenarioContent;

  // 生成方式: llm = 模型现场生成; template = LLM 不可用时的确定性模板降级.
  // 为什么要记: §7.4 要求"生成失败 → 降级为模板场景", 但降级产物与正常产物
  // 在库里长得一模一样 —— 事后无法区分"这条是模型写的"还是"这条是兜底的",
  // 运营就分不清"模型在退化"还是"用户描述本身就模糊". 记一列就能查.
  @Column({ type: 'varchar', length: 20, name: 'generation_mode', default: 'llm' })
  generationMode!: PracticeScenarioGenerationMode;

  // 稳定唯一键 (幂等 upsert 用; 私有场景用随机派生, 与共享库 slug 命名空间不冲突).
  @Column({ type: 'varchar', length: 80, name: 'scenario_key' })
  scenarioKey!: string;

  // 启用状态. 私有场景不进公共库, 无「审核闸门」语义; 保留列是为了将来支持
  // "用户主动归档/隐藏", 同时让两张表的列结构保持对称 (避免结构漂移).
  @Column({ type: 'tinyint', default: 1 })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // 软删 (spec §6.4; 跟 V3 其他模块一致).
  @Column({ type: 'datetime', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}
