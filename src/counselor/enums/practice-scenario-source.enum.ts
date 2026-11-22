// V2026-10-22 治本 (V1.3 §7.5 — 练习场景来源枚举):
//   原因: spec §7.5 拍板「`practice_attempts` 增加 `scenario_source` 枚举列
//     (`seed` / `custom`), 默认 `seed`, 不迁移旧数据」. 这列不是装饰:
//     §2.1 的共享内容库与 §7.5 的用户私有场景**分属两张表**
//     (practice_scenarios / practice_custom_scenarios), 练习记录必须能自证
//     「这条记录练的是哪一侧的场景」, 否则:
//       - 统计私有场景练习量时要去 JOIN 两张表猜
//       - §7.5 要求的「评判时按 scenarioSource=custom 路由到本表取 content」
//         就没有可靠的判据
//     把它建成枚举 (而不是自由 varchar) 是为了让"来源"这件事在类型层就是封闭集合,
//     杜绝出现第三种来源 (比如 'ai' / 'shared' / 空串) 后路由逻辑静默走错分支.
//
//   修法: 单文件定义 2 档枚举 + 中文标签映射 (server 单一事实源, 客户端不二次定义),
//     供 practice_attempts.scenario_source 列 / 场景视图 PracticeScenarioView.source
//     / DTO 出参三处共用.
//
//   反双胞胎:
//     - 不用 MySQL ENUM 列类型: 跟项目既有 pattern 一致 (varchar + 应用层 enum),
//       避免 DB schema 跟枚举字符串 drift
//     - 不加第三档 'shared' / 'ai': 共享内容库就是 seed (人工题库 + 人工审核过的
//       AI 产出都落在同一张表, 审核状态由 practice_scenarios.enabled 表达,
//       不该在"来源"维度里再造一档)
//     - 不把"用户自建但尚未练习"也算一种来源: 来源只描述场景从哪来, 与是否练过无关
//
//   验证:
//     1. tsc 0 错
//     2. 全仓 grep 'practice_custom_scenario' 的 scenario_source 取值只可能是 seed / custom
//
//   时间戳: 2026-10-22

/**
 * 练习场景来源 (2 档封闭集合).
 *
 * - `seed`: 来自 `practice_scenarios` 共享内容库 (全局可见, 含人工题库与审核过的 AI 产出)
 * - `custom`: 来自 `practice_custom_scenarios` 用户私有场景 (仅本人可见, AI 按用户描述生成)
 */
export enum PracticeScenarioSource {
  /** 共享内容库 (practice_scenarios). */
  SEED = 'seed',
  /** 用户私有场景 (practice_custom_scenarios). */
  CUSTOM = 'custom',
}

/** 来源 → 中文标签 (server 单一事实源). */
export const PRACTICE_SCENARIO_SOURCE_LABELS: Record<PracticeScenarioSource, string> = {
  [PracticeScenarioSource.SEED]: '标准题库',
  [PracticeScenarioSource.CUSTOM]: '我的真实场景',
};

/** 全部合法来源取值 (供 DTO 出参 enum 注解复用). */
export const PRACTICE_SCENARIO_SOURCE_VALUES: readonly PracticeScenarioSource[] = [
  PracticeScenarioSource.SEED,
  PracticeScenarioSource.CUSTOM,
];

/**
 * 场景**内容出处** (2 档封闭集合).
 *
 * 与 `PracticeScenarioSource` 的区别 (两者不是一回事, 别混用):
 *   - `PracticeScenarioSource` 回答「这条记录存在哪张表里」→ 决定 §7.5 的评判路由
 *   - `PracticeScenarioOrigin` 回答「这份练习内容是谁写的」→ 决定 UI 上的角标与审核口径
 *
 * spec §7.2 的响应体里 `source: "user_generated"` 说的是**内容出处**,
 * 所以本枚举才是 §7.2 那个字段的落点; 而 `scenario_source` 列 (§7.5) 用的是
 * `PracticeScenarioSource`. 两个字段名不同、语义不同, 各司其职.
 */
export enum PracticeScenarioOrigin {
  /** 用户描述 + AI 生成 (spec §7.2 `source: "user_generated"`). */
  USER_GENERATED = 'user_generated',
  /** 标准内容库 (人工题库 / 审核过的 AI 产出). */
  STANDARD_LIBRARY = 'standard_library',
}

/** 内容出处 → 中文标签 (server 单一事实源). */
export const PRACTICE_SCENARIO_ORIGIN_LABELS: Record<PracticeScenarioOrigin, string> = {
  [PracticeScenarioOrigin.USER_GENERATED]: '我的真实场景',
  [PracticeScenarioOrigin.STANDARD_LIBRARY]: '标准题库',
};

/** 全部合法内容出处取值 (供 DTO 出参 enum 注解复用). */
export const PRACTICE_SCENARIO_ORIGIN_VALUES: readonly PracticeScenarioOrigin[] = [
  PracticeScenarioOrigin.USER_GENERATED,
  PracticeScenarioOrigin.STANDARD_LIBRARY,
];
