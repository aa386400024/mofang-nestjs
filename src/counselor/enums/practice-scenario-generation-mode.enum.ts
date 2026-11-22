// V2026-10-22 治本 (V1.3 §7.4 — 私有场景的生成方式):
//   原因: spec §7.4 要求「生成失败 / 超时 8s → 降级为本地模板场景, 不阻塞用户」.
//     降级产物与正常产物在库里长得一模一样 (都是一条 practice_custom_scenarios 行),
//     事后无法区分"这条是模型写的"还是"这条是兜底的". 运营因此分不清:
//       - "模型在退化" (LLM 质量掉了) —— 该修 prompt / 换模型
//       - "用户描述本身就模糊" —— 该改产品引导
//     这两种情况在降级产物上长得一样, 就没法分开排查.
//   修法: 单列记账. 2 档封闭集合, 跟其它 practice 枚举风格一致.
//
//   反双胞胎:
//     - 不用布尔 isTemplate: 以后若增加第三种生成方式 (如"从历史记录改写"),
//       布尔得改成整列迁移, 枚举只需加一档
//     - 不把生成方式写进 generated_scenario JSON: JSON 里塞枚举值等于把
//       "数据库列的语义"藏进一个不受 schema 约束的袋子里, 查不出来也约束不住
//
//   验证:
//     1. tsc 0 错
//     2. SELECT generation_mode, COUNT(*) FROM practice_custom_scenarios GROUP BY 1
//        → 能直接看出模型退化比例
//
//   时间戳: 2026-10-22

/**
 * 私有场景的生成方式 (2 档封闭集合).
 */
export enum PracticeScenarioGenerationMode {
  /** 模型现场生成 (§7.2 主路径). */
  LLM = 'llm',
  /** LLM 不可用 / 超时时的确定性模板降级 (§7.4). */
  TEMPLATE = 'template',
}

/** 全部合法生成方式取值 (供 DTO / 统计出参复用). */
export const PRACTICE_SCENARIO_GENERATION_MODE_VALUES: readonly PracticeScenarioGenerationMode[] = [
  PracticeScenarioGenerationMode.LLM,
  PracticeScenarioGenerationMode.TEMPLATE,
];
