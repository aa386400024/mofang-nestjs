import { targetTurnsBandText, type SessionProfile } from '../../../session-profile.js';
import type { PromptSection } from '../../dto/counselor-types.js';

/** 收尾标记: 模型每轮必须在末尾选一个状态. */
export const CLOSE_TAG = '[[STATE:END]]';
export const CONTINUE_TAG = '[[STATE:MORE]]';

/**
 * 收尾纪律: 每轮末尾强制二选一 (END / MORE).
 *
 * 为什么用"强制二选一"而不是"可选标记": 实测可选标记几乎不会被输出,
 * 强制每轮表态才会真的执行.
 */
export const CLOSE_DISCIPLINE: PromptSection = {
  id: 'close-discipline',
  order: 30,
  enabled: true,
  content: [
    '',
    '## 收尾纪律',
    '每一轮回复的**最后一行**都必须只写一个状态标记（正文与标记之间空一行）：',
    `- ${CONTINUE_TAG} —— 议题还在展开，本轮结束后还要继续；`,
    `- ${CLOSE_TAG} —— 本轮你说的话就是这次咨询的收尾：已经做了总结、给了方向或约定了下一步，`,
    '  来访者的主要议题已经落地，再来一轮就是没必要的拖长。',
    '判断标准偏向"该收就收"：真人在这种情况会说"今天先到这里"，而不是继续追问细节。',
    '标记只能出现在最后一行，正文里不要解释它、不要复述它。',
  ].join('\n'),
};

/**
 * 长会话收尾纪律 (AF-091 · 按会话档案动态生成).
 *
 * ── 为什么需要它 ──────────────────────────────────────────────────────────
 *   legacy 档的收尾纪律明确鼓励"该收就收", 且最早第 5 轮就能收尾 ——
 *   对 15 轮的短对练是对的, 对 50 分钟的咨询是错的:
 *   咨询师会在第 6-8 轮就"总结 + 约下次", 于是 50 分钟只跑 20 多轮.
 *
 * ── 为什么这一块对 legacy 是**关闭**的 ────────────────────────────────────
 *   legacy 是缺省档, 它的行为必须与 2026-11-18 之前**逐字一致** ——
 *   包括 prompt 的字节. 所以这里不是"改文案", 而是"按档案开/关一块纪律".
 *
 * ── 它不是万能的 ──────────────────────────────────────────────────────────
 *   真正的硬闸门在 runner 侧 (closeAllowed = 轮次 ≥ minTurnsBeforeClose):
 *   35 轮之前咨询师即使输出 END 也不会生效. prompt 这一块的作用是让模型
 *   **知道**自己处在长会话里, 别在第 6 轮就提议收尾.
 *
 * @param profile 会话档案
 * @param turnIndex 当前轮次 (咨询师即将说出的这一轮; 缺省 = 未知)
 * @returns prompt 纪律块 (legacy 档时 enabled=false)
 */
export function sessionCloseDisciplineSection(profile: SessionProfile, turnIndex?: number): PromptSection {
  const band = targetTurnsBandText(profile);
  const enabled = band !== null;
  const currentTurn = typeof turnIndex === 'number' && turnIndex > 0 ? `当前是第 ${turnIndex} 轮。` : '';
  const content = [
    '',
    '## 长会话收尾纪律',
    `这是一场**长会话**：目标 ${band} 轮，轮数上限 ${profile.maxTurns} 轮。${currentTurn}`,
    `- **第 ${profile.minTurnsBeforeClose} 轮之前不得输出 ${CLOSE_TAG}**：即使来访者说"今天先到这里"、"我们下次再聊"，`,
    '  也要继续 —— 把话题拉回当下，或问一个能把议题往下走的问题；',
    `- 目标是把这一场**做满**：在 ${band} 轮之间自然收尾，不要刚过第 ${profile.minTurnsBeforeClose} 轮就草草结束；`,
    '- **不得伪造来访者的发言**：只回应来访者真正说过的话，不要替来访者编造新的经历、情绪或意愿；',
    '- **不得强行拖轮次**：议题已经落地就收，宁可收在上限以内，也不要用重复提问、空洞共情或硬造话题来凑轮数；',
    `- 上面"该收就收"的那条在本场**不适用**：本场以做满 ${band} 轮为目标；`,
    `- 仍然按收尾纪律在最后一行标注状态标记，只是不早于第 ${profile.minTurnsBeforeClose} 轮。`,
  ].join('\n');

  return {
    id: 'session-close-discipline',
    order: 35,
    enabled,
    content,
  };
}
