// V2026-10-22 治本 (V1.3 §1.3 / §2.2 — practice_attempts.feedback.items[].tone 3 档 enum):
//   原因: spec §1.3 零压反馈红线: 反馈固定为清单批注三态 ——
//     ✅ (positive) 动作达成 / ⚠️ (warning) 可以留意 / ℹ️ (info) 技术提示.
//     这三态是**唯一的**反馈语气维度: 不存在"得分"档, 不存在"错误"档.
//     枚举化后, 客户端只需按 tone 决定图标与颜色, 不需要解析文案判断语义;
//     同时服务端可以在校验层**硬拦**任何越界语气 (见 practice-evaluator 的零压红线守门).
//   修法: 定义 PracticeFeedbackTone 3 档 enum, 字符串值 1:1 wire 客户端 PracticeFeedbackTone.
//
//   反双胞胎:
//     - 不加 "incorrect" / "wrong" 档: 与 §1.3 零压红线直接冲突, 加了就是给
//       "对错判定"留后门 (哪怕当下不用, 也会被后来的需求滥用)
//     - 不加 "score" 档: 同上; 分数不是语气, 是量表, spec §6.2 明令不下发
//     - 不用 int 数值: 字符串枚举可读、可 diff、可跨端 1:1
//
//   验证:
//     1. tsc 0 错
//     2. LLM 输出的 tone 若不在 3 档内 → 校验失败 → 降级到确定性关键词评判
//     3. 全链路响应体 grep "score" / "correct" 命中数为 0
//
//   时间戳: 2026-10-22

/**
 * 反馈批注语气 3 档 (V1.3 §1.3 零压红线拍板).
 */
export enum PracticeFeedbackTone {
  /** ✅ 动作达成 */
  POSITIVE = 'positive',
  /** ⚠️ 可以留意 */
  WARNING = 'warning',
  /** ℹ️ 技术提示 */
  INFO = 'info',
}

/** 语气 → 前端图标映射建议 (server 下发, 避免客户端各写一份). */
export const PRACTICE_FEEDBACK_TONE_ICONS: Record<PracticeFeedbackTone, string> = {
  [PracticeFeedbackTone.POSITIVE]: '✅',
  [PracticeFeedbackTone.WARNING]: '⚠️',
  [PracticeFeedbackTone.INFO]: 'ℹ️',
};
