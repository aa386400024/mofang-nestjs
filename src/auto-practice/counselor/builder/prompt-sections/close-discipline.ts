import { targetTurnsBandText, type SessionProfile } from '../../../session-profile.js';
import type { PromptSection } from '../../dto/counselor-types.js';

/** 收尾标记: 模型每轮必须在末尾选一个状态. */
export const CLOSE_TAG = '[[STATE:END]]';
export const CONTINUE_TAG = '[[STATE:MORE]]';

/**
 * AF-133 · 强制收束 cue.
 *
 * runner 在 maxTurns 之前最后 2 轮传 'forced' —— prompt 据此告诉模型
 * "本场即将结束, 这两轮内把收束三件套做完并输出 END".
 *
 * ⚠️ 为什么模型需要这个信号: AF-131 §2.2 发现 8/16 场次被 max_turns 硬切,
 *   而模型**无从知道**自己会被切 —— prompt 里那几条自相矛盾的指令
 *   ("把这一场做满" / "宁可收在上限以内") 让它既不敢收也收不到.
 */
export type ClosingCue = 'forced';

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
    '- **收尾必须做满三件事**：在准备输出 END 的最后 1-2 轮里，按顺序完成：',
    '  1. **总结本次理解**：用“我听到 / 我的理解”复述本次核心议题，并明确说“我们总结 / 回顾一下”；',
    '  2. **来访者带走的内容**：给来访者一句可以**带走**的话、一个可以**记住**的点，或一张可以**写下来**的卡片；',
    '  3. **下一步安排**：约定**下次**时间、一个**回去可以试着做**的小行动，或**接下来**的方向；',
    '  这三项要自然落在正文里，不能只输出 END 标记；不要为了凑结构伪造来访者发言，也不要重复空洞的共情来拖轮次。',
    '- **不得伪造来访者的发言**：只回应来访者真正说过的话，不要替来访者编造新的经历、情绪或意愿；',
    '- **不得强行拖轮次**：议题已经落地就收，宁可收在上限以内，也不要用重复提问、空洞共情或硬造话题来凑轮数；',
    `- 上面"该收就收"的那条在本场**不适用**：本场以做满 ${band} 轮为目标；`,
    `- 仍然按收尾纪律在最后一行标注状态标记，只是不早于第 ${profile.minTurnsBeforeClose} 轮。`,
    '',
    '### 收束三件套 · 硬模板',
    '上面三件事要落地时，**照着下面的句式说** —— 不是让你背稿，而是保证三件一件都不漏，',
    '并且把关键说法**原样留在正文里**（结构审计按这些说法判定，不要换成同义词，也不要只输出 END 标记）：',
    '1. **总结 / 回顾**（说法：总结 / 回顾 / 我听到 / 我的理解）：',
    '   “我们**回顾**一下 —— 我**听到**你这次最想说的是……，我的**理解**是……”',
    '2. **来访者带走的内容**（说法：带走 / 记住 / 写下来）：',
    '   “有一句话你可以**带走**：……；你也可以把它**写下来**。”',
    '3. **下一步安排**（说法：下次 / 回去可以试 / 下一步）：',
    '   “我们**下次**再谈……；**回去之后**你可以试着……，这是**下一步**。”',
    '',
    '### 输出 END 之前 · 自检三问',
    '准备输出 END 时，在心里过一遍这三问 —— **三问全是“是”才允许输出 END**：',
    '① 我这一轮是否**总结 / 回顾**了本次核心议题，并复述了我的理解（“我听到 / 我的理解”）？',
    '② 我是否给来访者留下了可以**带走 / 记住**的东西？',
    '③ 我是否说清了**下次**的安排，或一个**回去可以试**的小行动？',
    '任何一问答“不是”，**先把缺的那一项补进正文，再输出 END** —— 不要只丢一个 END 标记就结束。',
  ].join('\n');

  return {
    id: 'session-close-discipline',
    order: 35,
    enabled,
    content,
  };
}

/**
 * AF-133 · 强制收束块 (本场即将结束).
 *
 * ── 为什么需要它 ──────────────────────────────────────────────────────────
 *   AF-131 §2.2: 16 场 long packet 里有 8 场被 max_turns 硬切 —— 它们**结构上**
 *   走不到收尾, 而模型在合法窗口 (35-50 轮) 里没有请求 END. 根因不是模型不会收,
 *   是它**不知道**自己会被切: prompt 里"把这一场做满"和"宁可收在上限以内"互相打架,
 *   而 runner 没有任何"快到头了"的信号.
 *   这块就是那个信号: 最后几轮里明确告诉模型"本场即将结束, 把三件套做完并 END".
 *
 * ── 为什么对 legacy 关闭 ──────────────────────────────────────────────────
 *   legacy 是缺省档, prompt 必须与 2026-11-18 之前**逐字一致**; 而且 legacy 是
 *   15 轮短对练, 不存在 AF-131 那种"收尾不可达"的问题.
 *
 * @param profile 会话档案
 * @param forced runner 是否判定"本场即将结束"
 * @param remainingTurns 从本轮起还剩几轮 (含本轮); 缺省 = 不写具体数字
 * @returns prompt 纪律块 (legacy 档或未到收尾轮时 enabled=false)
 */
export function forcedCloseSection(profile: SessionProfile, forced: boolean, remainingTurns?: number): PromptSection {
  const enabled = forced && targetTurnsBandText(profile) !== null;
  const rounds =
    typeof remainingTurns === 'number' && remainingTurns > 0
      ? `从这一轮起，本场还剩 **${remainingTurns} 轮**（含本轮）`
      : '从这一轮起，本场就只剩最后几轮';
  const content = [
    '',
    '## 本场即将结束（强制收束）',
    `⚠️ **本场即将结束**：${rounds}。`,
    '- **在收尾轮之内把收束三件套做完**：总结 / 回顾、带走 / 记住、下次 / 回去可以试；',
    '- 做完后按上面的**自检三问**确认，三问全是“是”才输出 ' + CLOSE_TAG + '；',
    '- **不要再开新议题、不再追问细节、不再用重复共情拖轮次** —— 没说完的议题留给“下次”；',
    '- 三件套没做完就**先做完再 END**，不要为了赶结束只说一句“今天先到这里”。',
  ].join('\n');

  return {
    id: 'forced-close',
    order: 36,
    enabled,
    content,
  };
}
