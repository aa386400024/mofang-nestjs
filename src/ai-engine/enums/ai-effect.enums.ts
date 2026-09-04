// V2026-09-04 治本 (V6.0 §3.4 + audit P0-1):
//   AI 干预效果追踪枚举 — 3 档时间维度.
//   原因: 前端 AIEffectHorizonX.code 已定义 enum, 后端对齐.
//   修复: code 字符串字面量与前端一致.
//   如何验证: GET /ai/effect/weekly / /monthly 返回 horizon 字段能被前端
//             AIEffectHorizonX.fromCode() 解析.

/**
 * 短 / 中 / 长 3 维效果 — V6.0 §3.4.
 *
 * - immediate: 短期 — 练习前后情绪变化 / 生理指标变化 (即时记录).
 * - weekly: 中期 — 周维度情绪稳定性 / 认知模式变化 (cron 聚合).
 * - monthly: 长期 — 月维度心理特质 / 人生阶段任务完成度 (cron 聚合).
 */
export enum AIEffectHorizon {
  IMMEDIATE = 'immediate',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

export const ALL_EFFECT_HORIZONS: readonly AIEffectHorizon[] = [
  AIEffectHorizon.IMMEDIATE,
  AIEffectHorizon.WEEKLY,
  AIEffectHorizon.MONTHLY,
] as const;
