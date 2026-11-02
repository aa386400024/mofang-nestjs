// V2026-10-22 治本 (V1.3 §7.5 — 场景视图投影: 两张表 → 一个领域概念):
//   原因: §7.5 把用户私有场景拆到 `practice_custom_scenarios` 独立表, 于是
//     「一个可练习的场景」有了两个物理来源 (共享库 / 私有库).
//     而 §3.2 取场景 / §3.3 评判 / P2 来访者反应 三条链路**只关心场景的内容**,
//     不关心它存在哪张表.
//     投影若散落在各个 service 里, 就会出现两份"entity → 场景内容"的转换代码,
//     改了一处漏了另一处 = 私有场景的 rubric 少一个字段这种静默 bug.
//   修法: 本文件是**唯一**的投影处. 两个 entity 各自投影成 `PracticeScenarioView`,
//     上层 (scenario service / evaluator / attempt service) 只认 view.
//
//   反双胞胎:
//     - 不让 service 层直接吃 TypeORM entity: entity 带 createdAt/enabled/userId
//       等持久化细节, 评判链路不需要; 依赖 entity 等于把持久化模型泄漏进领域层
//     - 不用 union 类型 (PracticeScenario | PracticeCustomScenario):
//       调用方会到处写类型分支, 换个表就全链路报错; view 把差异**收敛在投影处**
//     - 不在投影里做业务判断 (比如"私有场景要不要过审"): 投影是纯映射, 无副作用,
//       业务判断留在 service
//
//   验证:
//     1. tsc 0 错
//     2. 投影出的 view 字段集合 = PracticeScenarioView 定义 (不多不少)
//
//   时间戳: 2026-10-22
import type { PracticeScenarioView } from './practice.types';
import type { PracticeCustomScenario } from '../../entities/practice-custom-scenario.entity';
import type { PracticeScenario } from '../../entities/practice-scenario.entity';
import { PracticeScenarioSource } from '../../enums/practice-scenario-source.enum';

/**
 * 共享内容库场景 → 领域视图.
 *
 * @param entity practice_scenarios 行
 * @returns 场景视图
 */
export function toScenarioView(entity: PracticeScenario): PracticeScenarioView {
  return {
    scenarioId: entity.id,
    scenarioKey: entity.scenarioKey,
    source: PracticeScenarioSource.SEED,
    exerciseMode: entity.exerciseMode,
    difficulty: entity.difficulty,
    persona: entity.persona,
    openingLine: entity.openingLine,
    taskPrompt: entity.taskPrompt,
    botchedUtterance: entity.botchedUtterance,
    voiceScript: entity.voiceScript,
    referenceResponse: entity.referenceResponse,
    commonPitfalls: entity.commonPitfalls,
    rubric: entity.rubric,
    expectedTurns: entity.expectedTurns,
  };
}

/**
 * 用户私有场景 → 领域视图.
 *
 * 私有场景没有 `expected_turns` 列 (单轮场景, 与 §7.4 的"当晚 1:1 还原重练"定位一致),
 * 这里固定为 1.
 *
 * @param entity practice_custom_scenarios 行
 * @returns 场景视图
 */
export function toCustomScenarioView(entity: PracticeCustomScenario): PracticeScenarioView {
  const content = entity.generatedScenario;
  return {
    scenarioId: entity.id,
    scenarioKey: entity.scenarioKey,
    source: PracticeScenarioSource.CUSTOM,
    exerciseMode: entity.exerciseMode,
    difficulty: entity.difficulty,
    persona: content.persona,
    openingLine: content.openingLine,
    taskPrompt: content.taskPrompt,
    botchedUtterance: content.botchedUtterance,
    voiceScript: content.voiceScript,
    referenceResponse: content.referenceResponse,
    commonPitfalls: content.commonPitfalls,
    rubric: content.rubric,
    expectedTurns: 1,
  };
}
