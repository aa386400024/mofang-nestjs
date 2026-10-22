// V2026-10-22 治本 (V1.3 §2.1 — 场景变体 seed 记录的领域类型):
//   原因: 场景内容库 (60 条) 是**内容**, 不是代码逻辑. 它以独立文件承载, 通过
//     幂等 seed 脚本按 scenario_key upsert 进 practice_scenarios 表 (spec §6.3:
//     「内容库 seed 走独立脚本按 scenario_key upsert, 不进 migration」).
//     但内容是 TS 字面量, 就必须有类型约束 —— 否则内容编辑者写错一个字段名
//     (persona.defenseStlye) 只有运行时才发现, 而 seed 脚本跑的是**生产库**.
//     本文件给内容记录一份强类型契约, 让编译期挡住字段名/枚举值的错.
//
//   反双胞胎:
//     - 不把类型写在 3 个内容文件里各自定义: 同一契约写 3 遍必然漂移, 且 barrel
//       无法用统一类型收口
//     - 不用 `as const` 整个对象树 + 类型推导: 推导出的字面量类型在跨文件汇合时
//       会退化成联合字面量, 后续按字段取值时类型爆炸; 显式 interface 更可维护
//     - 不引入 zod / 类校验库: 大炮红线禁自动装依赖; 手写校验函数跟既有 pattern 一致
//
//   验证:
//     1. tsc 0 错 (字段名写错 / 枚举值写错, 编译期即报)
//     2. 3 个内容文件的数组标注为 readonly PracticeScenarioSeed[], 越界即报错
//     3. barrel 汇总后 scenarioKey 全局唯一 (运行时断言, 见 practice-scenario-seeds.ts)
//
//   时间戳: 2026-10-22

import type { PracticeScenarioPersona, PracticeScenarioRubric } from './practice.types';
import { PracticeDifficulty } from '../../enums/practice-difficulty.enum';
import { TrainingExerciseMode } from '../../enums/training-exercise-mode.enum';

/**
 * 一条场景变体的 seed 记录 (V1.3 §2.1 practice_scenarios 表的内容投影).
 *
 * 字段与 practice_scenarios 表列一一对应 (除 id / tenant_id / user_id /
 * is_ai_generated / enabled / created_at / updated_at / deleted_at 这些由
 * seed 运行时统一填充的列外).
 */
export interface PracticeScenarioSeed {
  /**
   * 稳定 slug (幂等 upsert 键).
   *
   * 命名约定: `<mode 的 snake_case>_l<难度档>_<两位序号>`,
   * 例: `emotion_reflection_l1_01`.
   * **改名等同于换场景** (会丢历史练习记录), 发布后即是对外契约.
   */
  scenarioKey: string;

  /** 所属基本功 (10 档 TrainingExerciseMode, 不新增 enum). */
  exerciseMode: TrainingExerciseMode;

  /** 难度梯 (1/2/3). */
  difficulty: PracticeDifficulty;

  /** 来访者画像 (表层人设). */
  persona: PracticeScenarioPersona;

  /** 来访者开场白 (来访者第一句话, 客户端气泡直接展示). */
  openingLine: string;

  /** 训练任务说明 (给用户看的一句话). */
  taskPrompt: string;

  /** rewrite 引擎专用: 被砸了的原话 (非改写引擎恒为 null). */
  botchedUtterance: string | null;

  /** voiceMetric 引擎专用: 要求用户朗读的文本 (非语音引擎恒为 null). */
  voiceScript: string | null;

  /** 参考回应 (批注卡「可以参考这样回应」). */
  referenceResponse: string;

  /** 常见偏差 (批注卡「留意避免」). */
  commonPitfalls: string[];

  /** 评判 rubric (LLM 评判锚点 + P0 降级判定依据). */
  rubric: PracticeScenarioRubric;
}
