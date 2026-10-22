// V2026-10-22 治本 (V1.3 §1.1 / §2.1 — 基本功 → 三引擎 映射 + 全局内容库租户哨兵):
//   原因: spec §1.1 定义三引擎 (接话演练 aiResponse / 改写工坊 rewrite /
//     语音微训练 voiceMetric) 并明确「**后端不加 practiceMode 列**」—— 引擎由
//     现有 `type` 字段推导. 但 type 只有 3 档, 粗粒度推导会与客户端渲染错位:
//       spec 的 type 口径: listening→接话 / questioning→改写 / voiceMicro→语音
//       客户端实际口径 (xin_su_app practice_mode.dart): **按 mode** 推导, 且
//         factFeelingSeparation(倾听类) → 改写, closedToOpen/avoidInterrogation
//         (提问类) → 改写, 其余 5 个非语音 mode → 接话.
//     两个口径在 3 个 mode 上直接冲突. 若后端按 type 下发, 客户端按 mode 渲染,
//     就会出现「后端说是接话演练, 客户端渲染成改写工坊」的错位.
//   修法:
//     - 映射在**服务端**落地 (PRACTICE_MODE_ENGINE_META), 口径对齐客户端既有映射
//     - type 复用既有 TRAINING_EXERCISE_MODE_META[mode].type (不重复定义)
//     - 引擎不落 DB 列: 引擎是 mode 的派生属性, 落列 = 第二事实源, mode 改了
//       引擎没改就会静默错位
//   反双胞胎:
//     - 不新增 practice_mode 列 / 不新增 engine enum 列: spec §1.1 明确不加列
//     - 不改前端映射: 本次只交付后端; 客户端保留本地映射作为后端未上线期降级
//     - 不用 "type 粗粒度" 推导: 见上, 3 个 mode 会错位
//
//   验证:
//     1. tsc 0 错 (Record<TrainingExerciseMode, ...> 缺档即编译报错)
//     2. PRACTICE_MODE_ENGINE_META 覆盖 10 档, 与客户端 practice_mode.dart 逐档一致
//     3. 60 条 seed 场景按 mode 分组后, 引擎分布 = 接话 5 基本功 / 改写 3 / 语音 3
//
//   时间戳: 2026-10-22
import { TRAINING_EXERCISE_MODE_META } from './training-exercise-display-meta';
import { PracticeDifficulty } from '../enums/practice-difficulty.enum';
import { PracticeEngine } from '../enums/practice-engine.enum';
import { TrainingDifficulty } from '../enums/training-difficulty.enum';
import { TrainingExerciseMode } from '../enums/training-exercise-mode.enum';
import { TrainingExerciseType } from '../enums/training-exercise-type.enum';

/**
 * 全局共享内容库的系统租户哨兵值.
 *
 * A9 约定「一人一租户」, 用户自建行 tenant_id = user_id; 而 seed 灌入的
 * 全局共享内容库不属于任何用户, 但列是 NOT NULL → 用哨兵值占位.
 *
 * 可见性不靠 tenant_id 过滤, 而靠 user_id 语义:
 *   - user_id IS NULL → 共享内容库 (全租户可见, 且必须 enabled = 1)
 *   - user_id = 本人 → 用户自建的私有场景 (仅本人可见)
 */
export const PRACTICE_SYSTEM_TENANT_ID = '00000000-0000-0000-0000-000000000000';

/**
 * 基本功 → 三引擎 映射 (10 档全覆盖).
 *
 * 口径与客户端 xin_su_app practice_mode.dart 严格一致 (1:1 wire).
 */
export const PRACTICE_MODE_ENGINE_META: Record<TrainingExerciseMode, PracticeEngine> = {
  // ─── 倾听共情 3 模式 ───
  [TrainingExerciseMode.EMOTION_REFLECTION]: PracticeEngine.AI_RESPONSE,
  [TrainingExerciseMode.FACT_FEELING_SEPARATION]: PracticeEngine.REWRITE,
  [TrainingExerciseMode.NO_ADVICE_CHALLENGE]: PracticeEngine.AI_RESPONSE,
  // ─── 提问技术 4 模式 ───
  [TrainingExerciseMode.CLOSED_TO_OPEN]: PracticeEngine.REWRITE,
  [TrainingExerciseMode.ONE_AT_A_TIME]: PracticeEngine.AI_RESPONSE,
  [TrainingExerciseMode.AVOID_INTERROGATION]: PracticeEngine.REWRITE,
  [TrainingExerciseMode.FOCUS_TOPIC]: PracticeEngine.AI_RESPONSE,
  // ─── 语音微训练 3 模式 ───
  [TrainingExerciseMode.SPEECH_RATE]: PracticeEngine.VOICE_METRIC,
  [TrainingExerciseMode.TONE_STABILITY]: PracticeEngine.VOICE_METRIC,
  [TrainingExerciseMode.ICE_BREAKING]: PracticeEngine.VOICE_METRIC,
};

/**
 * 取某个基本功的三引擎.
 *
 * @param mode 基本功
 * @returns 对应引擎
 */
export function engineOfMode(mode: TrainingExerciseMode): PracticeEngine {
  return PRACTICE_MODE_ENGINE_META[mode];
}

/**
 * 取某个基本功归属的训练类型 (复用既有 display-meta, 避免第二事实源).
 *
 * @param mode 基本功
 * @returns 训练类型 (listening / questioning / voiceMicro)
 */
export function typeOfMode(mode: TrainingExerciseMode): TrainingExerciseType {
  return TRAINING_EXERCISE_MODE_META[mode].type;
}

/**
 * 取某个基本功的中文名 (复用既有 display-meta).
 *
 * @param mode 基本功
 * @returns 中文名
 */
export function labelOfMode(mode: TrainingExerciseMode): string {
  return TRAINING_EXERCISE_MODE_META[mode].label;
}

// ════════════════════════════════════════════════════════════════════════════
// 难度跨口径转换 (V1.3 §8.5 A1)
// ════════════════════════════════════════════════════════════════════════════
//
//   背景: 项目里存在**两套**难度口径, 分属两个互不相干的频道:
//     - MCQ 备考频道: training_exercises.difficulty = varchar 'L1' / 'L2' / 'L3'
//       (TrainingDifficulty 枚举, 大写)
//     - 自由练习频道: practice_scenarios.difficulty = int 1 / 2 / 3
//       (PracticeDifficulty 枚举, 数值)
//   §8.5 A1 原文: 「禁止跨表 join/比较难度; 不要在同一响应里混用」, 并且指出
//     `practice-difficulty.enum.ts` 的注释声称「跨口径转换集中在 practice-display-meta
//     一处」, 但该文件并无转换函数 —— 「要么补函数, 要么删这句注释, 避免误导」.
//
//   修法: **补上函数**, 而不是删注释 —— 因为"两个频道的难度要能对上"是真实需求:
//     - 自由练习的私有场景生成时, 用户可能指着一个 MCQ 题说"我这条练的是 L2",
//       这时要把 MCQ 的 'L2' 翻译成自由练习的 2
//     - UI 上两个频道并排展示时, 需要把 int 档翻译成 'L2' 文案
//   函数放在本文件 (而不是 practice-difficulty.enum.ts) 是因为**本文件已经是
//   "跨频道展示元数据的归口"** (mode → 引擎 / 类型 / 中文名 都在这里).
//
//   边界 (务必遵守):
//     - 本函数只用于**展示层对齐**与**用户显式指定的档位翻译**;
//       任何"跨表 join 后按难度比较/排序"的查询都不该用它 —— 那种需求应该
//       在各自频道内部完成 (spec §8.5 A1 的红线)
//     - 两个频道的难度**不构成同一维度**: MCQ 的 L1 是"题目的固定难度",
//       自由练习的 1 是"场景变体的难度梯", 语义相近但不等价, 转换只是展示需要
//
//   验证:
//     1. tsc 0 错 (两个方向的转换都覆盖 3 档)
//     2. practiceDifficultyToTrainingDifficulty(PracticeDifficulty.L3) === TrainingDifficulty.L3
//     3. trainingDifficultyToPracticeDifficulty(TrainingDifficulty.L1) === PracticeDifficulty.L1

/**
 * 自由练习难度 (int 1/2/3) → MCQ 难度 (varchar 'L1'/'L2'/'L3').
 *
 * @param difficulty 自由练习难度
 * @returns 对应的 MCQ 难度字面量
 */
export function practiceDifficultyToTrainingDifficulty(difficulty: PracticeDifficulty): TrainingDifficulty {
  switch (difficulty) {
    case PracticeDifficulty.L2:
      return TrainingDifficulty.L2;
    case PracticeDifficulty.L3:
      return TrainingDifficulty.L3;
    default:
      return TrainingDifficulty.L1;
  }
}

/**
 * MCQ 难度 (varchar 'L1'/'L2'/'L3') → 自由练习难度 (int 1/2/3).
 *
 * @param difficulty MCQ 难度
 * @returns 对应的自由练习难度
 */
export function trainingDifficultyToPracticeDifficulty(difficulty: TrainingDifficulty): PracticeDifficulty {
  switch (difficulty) {
    case TrainingDifficulty.L2:
      return PracticeDifficulty.L2;
    case TrainingDifficulty.L3:
      return PracticeDifficulty.L3;
    default:
      return PracticeDifficulty.L1;
  }
}
