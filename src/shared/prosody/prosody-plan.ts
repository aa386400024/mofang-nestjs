// AF-459: 韵律计划（纯函数）——按来访者风格/难度/轮次决定本轮强度与配额.
//
// 规则来源（临床取向，不是拍脑袋的平均值）：
//   · cooperative：配合度高，表达相对流畅 → light（只保留少量思考垫与句内停顿）
//   · mixed：一半配合一半回避 → light
//   · defensive / resistant / avoidant：开口前先掂量、句中断句多 → medium
//   · L3 难度：来访者更"难被打开"，至少 medium（不允许比 L2 更顺）
//
// 风险轮（危机/阻断）不走这里：voice 层在阻断轮根本不出声，所以本模块不需要
// 再读风险等级——避免在纯层引入第二套风险口径。

import type { ProsodyLevel, ProsodyPlanInput, ProsodyTurnLimits, ProsodyTurnPlan } from './prosody.types.js';

/** 强度档 → 配额. */
const LEVEL_LIMITS: Readonly<Record<Exclude<ProsodyLevel, 'off'>, ProsodyTurnLimits>> = {
  light: {
    maxEventsPerTurn: 2,
    minSentenceGap: 1,
    filler: true,
    pause: true,
    trailoff: false,
    // AF-460: light 只保留一次很短的思考段，不给长沉默/副语言，避免"随便聊两句也像在演".
    thinking: true,
    longSilence: false,
    paralinguistic: false,
    maxThinkingBeats: 1,
    maxLongSilences: 0,
    maxParalinguistic: 0,
    thinkingPauseMs: [800, 1500],
    longSilenceMs: [0, 0],
  },
  medium: {
    maxEventsPerTurn: 3,
    minSentenceGap: 1,
    filler: true,
    pause: true,
    trailoff: true,
    // AF-460: 阻抗/回避才允许思考段、长沉默与低频呼吸，且每轮有硬上限.
    thinking: true,
    longSilence: true,
    paralinguistic: true,
    maxThinkingBeats: 2,
    maxLongSilences: 1,
    maxParalinguistic: 2,
    thinkingPauseMs: [1500, 2800],
    longSilenceMs: [3500, 7000],
  },
};

/** 默认（无风格信息）按 light，宁可少一点也不要"每句都顿". */
const DEFAULT_LEVEL: Exclude<ProsodyLevel, 'off'> = 'light';

/**
 * 风格 → 强度档.
 *
 * @param style 来访者风格（可能为空）
 * @returns 强度档（不含 off）
 */
function levelOfStyle(style: string | undefined): Exclude<ProsodyLevel, 'off'> {
  switch (style) {
    case 'defensive':
    case 'resistant':
    case 'avoidant':
      return 'medium';
    case 'cooperative':
    case 'mixed':
      return 'light';
    default:
      return DEFAULT_LEVEL;
  }
}

/**
 * 构建一轮韵律计划.
 *
 * 确定性：seed 只由 sessionId + turnIndex 拼成，同输入永远同结果——
 * 这让"同一段台词重放时韵律漂移"不可能发生，也让单测可以钉死具体行为.
 *
 * @param input 计划输入
 * @returns 本轮计划
 */
export function buildProsodyPlan(input: ProsodyPlanInput): ProsodyTurnPlan {
  const seed = `${input.sessionId}#${input.turnIndex}`;
  if (!input.enabled) {
    return { level: 'off', seed, style: input.style ?? 'unknown', limits: { ...LEVEL_LIMITS.light, maxEventsPerTurn: 0 } };
  }
  let level = levelOfStyle(input.style);
  // L3：难被打开 → 至少 medium（只升级不降级，避免"难度越高反而越顺"）
  if (input.difficulty === 'L3' && level === 'light') {
    level = 'medium';
  }
  const base = LEVEL_LIMITS[level];
  // AF-460: L3 的沉默可以更长（5–9s），但仍受每轮 1 次 + 句间隔约束；
  //   普通 medium 保持 3.5–7s，避免把"阻抗"演成"断线".
  const limits = input.difficulty === 'L3' && level === 'medium' ? { ...base, longSilenceMs: [5000, 9000] as const } : base;
  return { level, seed, style: input.style ?? 'unknown', limits };
}
