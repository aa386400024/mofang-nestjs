// V2026-09-04 治本 (V6.0 §11.2 + audit P0-1):
//   危机干预枚举 — 4 等级 + 3 信号来源.
//   原因: 前端 CrisisLevelX / CrisisSignalSourceX.code 已定义 enum, 后端对齐.
//   修复: code 字符串字面量与前端一致.
//   如何验证: POST /v1/chat/completions chunk crisis_signal.level 字符串能被前端
//             CrisisLevelX.fromCode() 解析; GET /ai/crisis/events 返回 source 字段
//             被 CrisisSignalSourceX.fromCode() 解析.

/**
 * 4 级危机等级 — V6.0 §11.2 三级风险响应机制 + 1 级无信号.
 *
 * - none: 无危机信号 — 业务正常流.
 * - low: 一级 — 情绪安抚 + 自助急救工具入口 (§11.2 一级响应).
 * - medium: 二级 — AI 深度陪伴 + 公益心理热线推荐.
 * - high: 三级 — 强制弹窗危机热线 + 引导专业就医 (§11.3 不伤害原则强制介入).
 */
export enum CrisisLevel {
  NONE = 'none',
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

/**
 * 是否需要强制干预 — §11.2 二级及以上触发引导专业转介.
 * 前端 CrisisLevel.requiresIntervention 对齐.
 */
export function crisisRequiresIntervention(level: CrisisLevel): boolean {
  return level === CrisisLevel.MEDIUM || level === CrisisLevel.HIGH;
}

/**
 * 危机信号来源 — 审计用 (端侧拦截 / LLM 分类 / 用户主动).
 */
export enum CrisisSignalSource {
  /** 端侧关键词拦截 — CrisisDetector. */
  KEYWORD = 'keyword',

  /** LLM 分类器识别 — 后端 chat completions 返回的 crisis_signal. */
  LLM_CLASSIFIER = 'llm_classifier',

  /** 用户主动求助 — 客户端 report 按钮. */
  USER_REPORT = 'user_report',
}
