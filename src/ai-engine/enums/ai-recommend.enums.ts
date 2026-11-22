// V2026-09-04 治本 (V6.0 §3.2 + audit P0-1):
//   AI 推荐枚举 — 6 推荐类型 + 4 排序阶段.
//   原因: 前端 AIRecommendation / AIRecommendPhase 已定义 enum, 后端保持对齐.
//   修复: code 字符串字面量与前端 AIRecommendKindX.code / AIRecommendPhaseX.code
//         一一对应.
//   如何验证: GET /ai/recommend 返回 items[].kind 字符串能被前端
//             AIRecommendKind.fromCode() 解析.

/**
 * 推荐项类型 — V6.0 §3.2 全场景覆盖.
 *
 * - tool: 循证工具 (呼吸/认知解离/...)
 * - article: 科普文章
 * - course: 课程
 * - path: 成长路径 (AI 定制)
 * - gamified: 趣味模块
 * - commerce: 商业化 (会员/单次增值)
 */
export enum AIRecommendKind {
  TOOL = 'tool',
  ARTICLE = 'article',
  COURSE = 'course',
  PATH = 'path',
  GAMIFIED = 'gamified',
  COMMERCE = 'commerce',
}

/**
 * 4 阶段排序 — §3.2 「召回-粗排-精排-重排」.
 *
 * - recall: 候选 ~50-200 条 (协同 + 内容)
 * - coarse: 候选 ~20 条 (相关性粗排)
 * - fine: 候选 ~5 条 (精排打分)
 * - rerank: 最终 ~3 条 (多样性 + 业务规则重排, 默认对外)
 */
export enum AIRecommendPhase {
  RECALL = 'recall',
  COARSE = 'coarse',
  FINE = 'fine',
  RERANK = 'rerank',
}

/** 默认对外暴露的最终阶段 — §3.2 推荐结果. */
export const DEFAULT_RECOMMEND_PHASE: AIRecommendPhase = AIRecommendPhase.RERANK;
