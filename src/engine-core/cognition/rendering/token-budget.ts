// V2026-10-28 治本 (WP5 · 引擎内核 · Token 预算与上下文裁剪):
//   职责: 三件事 —— 保守估算 token 数、按预算裁剪最近对话、归一单轮完成上限.
//         纯函数, 无状态, 无 IO, 无随机.
//   边界: 不装 tiktoken, 不读模型配置, 不作计费依据 —— 只回答"塞不塞得下".
//
//   为什么不装 tiktoken:
//     内核第 0 原则是零新第三方依赖 (目前只允许 { nanoid } + node:*).
//     tiktoken 体积不小、要模型词表, 而内核要的只是"够不够塞"的工程判断 ——
//     为此给内核加一个带词表的依赖, 不值. 字符率集中为一个常量, 后期装配轮
//     换成真实编码器时, 只改这一处.
//
//   为什么估算要**保守** (偏多估):
//     少估 → 实际塞不下 → 模型侧静默截断或报错, 而内核以为裁好了 ——
//     这是"以为做了防护其实没做"的典型; 多估 → 少塞一点上下文, 只是浪费几个 token.
//     失败方向必须是安全的那一侧.
//
//   裁剪方向 (为什么保留尾部):
//     对话的新近性最重要 —— 最近几轮才是本轮要回应的对象.
//     所以超预算时**从最旧的一轮开始整轮丢弃**, 而不是从最新开始.
//     最后一轮 (当前轮) 永不整轮丢弃: 装不下就从**头部截断字符、保留尾部**
//     (尾部是这句话真正要说的部分), 并计 truncatedTurns.
//
//   反双胞胎:
//     - 不自己写"保留几轮"的经验值: 裁剪只认 token 预算, 不认轮数 ——
//       轮数与 token 数不是一回事 (一句 500 字和一句 5 字差 100 倍).
//     - 不在别处再写一份字符率: CHARS_PER_TOKEN 是内核里唯一的口径.
//     - resolveCompletionTokens 越界**回落不抛**: 一条脏配置不该炸掉整场对话.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-core/wp5-rendering.spec.ts 覆盖估算/整轮丢弃/单轮截断/上限归一

import type { RenderContextTurn } from '../../domain/rendering/render-types';

/**
 * 保守 token 估算种子 (中文为主; 内核不装 tiktoken, 字符率集中此处, 后期可替换为编码器).
 */
export const DEFAULT_COMPLETION_TOKENS = 160;

/**
 * 每 token 保守估算字符数 (中文按 ~1.6 字符/token 的保守口径; 偏宁可多估不可少估).
 */
export const CHARS_PER_TOKEN = 1.6;

/**
 * 保守估算文本 token 数 (无编码器时的工程近似, 仅供预算裁剪, 不作计费).
 *
 * @param text 待估算文本
 * @returns 估算 token 数 (空串 → 0)
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * 按 contextTokens 预算裁剪最近对话: 尾部保留最近轮, 超预算从最旧往前丢整轮;
 * 单轮仍放不下时按字符从头部截断 (保留尾部), 返回裁剪后序列与丢弃/截断计数.
 *
 * @param turns 原始对话序列 (旧 → 新)
 * @param budgetTokens 上下文 token 预算
 * @returns 裁剪后的序列与统计
 */
export function fitContextToBudget(
  turns: readonly RenderContextTurn[],
  budgetTokens: number,
): { turns: RenderContextTurn[]; droppedTurns: number; truncatedTurns: number } {
  if (turns.length === 0) return { turns: [], droppedTurns: 0, truncatedTurns: 0 };

  const budget = Number.isFinite(budgetTokens) && budgetTokens > 0 ? budgetTokens : 0;
  let used = turns.reduce((sum, turn) => sum + estimateTokens(turn.text), 0);
  let start = 0;
  let droppedTurns = 0;

  // 从最旧的一轮开始整轮丢弃 (最后一轮永不整轮丢).
  while (start < turns.length - 1 && used > budget) {
    used -= estimateTokens(turns[start]?.text ?? '');
    start += 1;
    droppedTurns += 1;
  }

  const kept = turns.slice(start);
  if (kept.length === 1 && used > budget) {
    // 单轮单独就超预算 → 头部截断字符, 保留尾部 (尾部才是这句话要说的部分).
    return { turns: [truncateTurn(kept[0], budget)], droppedTurns, truncatedTurns: 1 };
  }
  return { turns: kept, droppedTurns, truncatedTurns: 0 };
}

/**
 * 单轮完成上限归一: 越界 / NaN / ≤0 → 回落 default(DEFAULT_COMPLETION_TOKENS), 不抛.
 *
 * @param raw 原始上限
 * @param fallback 回落值 (非法时再回落 DEFAULT_COMPLETION_TOKENS)
 * @returns 归一后的上限
 */
export function resolveCompletionTokens(raw: number | undefined, fallback: number = DEFAULT_COMPLETION_TOKENS): number {
  if (raw !== undefined && Number.isFinite(raw) && raw > 0) return raw;
  return Number.isFinite(fallback) && fallback > 0 ? fallback : DEFAULT_COMPLETION_TOKENS;
}

/**
 * 单轮头部截断 (保留尾部).
 *
 * @param turn 待截断的一轮
 * @param budgetTokens 该轮可用的 token 预算
 * @returns 截断后的一轮
 */
function truncateTurn(turn: RenderContextTurn, budgetTokens: number): RenderContextTurn {
  const maxChars = Math.max(0, Math.floor(budgetTokens * CHARS_PER_TOKEN));
  if (turn.text.length <= maxChars) return turn;
  return { role: turn.role, text: turn.text.slice(turn.text.length - maxChars) };
}
