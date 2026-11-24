// AF-459: 句级韵律注入（纯函数）——把确定性计划落到具体句子的可读语义标记上.
//
// 注入规则（逐条都能被单测钉死）：
//   · filler：只在本轮**第 0 句**句首，且原句不以填充词开头（防"嗯，嗯"）
//   · pause：只插在**句内次级标点之后**（，、：,;:），两侧必须是可发音文本；
//            不在句首/句尾（MiniMax 要求停顿夹在两个可发音文本之间）
//   · trailoff：只改句末"。"为"……"，且从第 2 句起（避免一开口就拖音）
//   · 每句最多 1 条，每轮受 maxEventsPerTurn 与 minSentenceGap 约束
//
// 为什么用确定性哈希而不是 Math.random：
//   同一段台词重播时韵律必须一致（否则用户会听到"刚才不是这样说的"），
//   且单测能直接断言某个 seed 的具体输出，不需要 mock 随机源.

import type { ProsodyApplyContext, ProsodyEvent, ProsodySentenceResult, ProsodyTurnPlan } from './prosody.types.js';

/** 思考垫用词（按风格固定的三条，够用且都可自然念出）. */
const FILLERS = ['嗯，', '呃，', '那个，'] as const;

/** 已以填充词开头的句子不再加（防重复）. */
const FILLER_PREFIX = /^(?:嗯|呃|唉|那个|就是)/;

/** 句内可断点（与 TTS 切句的次级标点一致）. */
const SOFT_BREAKS = new Set(['，', '、', '：', ',', ';', ':']);

/** 句末/不可发音字符（停顿两侧不能是它们）. */
const NON_SPEAKABLE = new Set(['。', '！', '？', '…', '；', '!', '?', '.', '\n', ' ', ']', '>', '#']);

/** pause 对句长的最低要求（太短的句子加停顿只会更碎）. */
const PAUSE_MIN_CHARS = 12;

/** 不同强度的停顿候选时长（毫秒）. */
const PAUSE_CANDIDATES: Readonly<Record<'light' | 'medium', readonly number[]>> = {
  light: [300, 350, 400],
  medium: [400, 450, 500, 550],
};

/** 各强度下"第 0 句加思考垫"的概率（百分比）.
 *
 * 三个概率必须**互斥**（filler + pause + trailoff ≤ 100），否则后段号段永远取不到.
 * 当前口径：light 45/35/0（合计 80，保留 20 的静默余量）；
 *           medium 45/35/20（合计 100）.
 */
const FILLER_CHANCE: Readonly<Record<'light' | 'medium', number>> = { light: 45, medium: 45 };

/** 各强度下"可断句加停顿"的概率（百分比）. */
const PAUSE_CHANCE: Readonly<Record<'light' | 'medium', number>> = { light: 35, medium: 35 };

/** 各强度下"句末拖音"的概率（百分比）；light 不开启. */
const TRAILOFF_CHANCE: Readonly<Record<'light' | 'medium', number>> = { light: 0, medium: 20 };

/**
 * FNV-1a 32 位哈希（短字符串足够均匀，且实现稳定跨平台）.
 *
 * @param input 输入字符串
 * @returns 无符号 32 位整数
 */
function hash32(input: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.codePointAt(index) ?? 0;

    hash = Math.imul(hash, 16_777_619);
  }

  return hash >>> 0;
}

/**
 * 取 0–99 的确定性桶号.
 *
 * @param seed 计划 seed
 * @param salt 额外区分（句序号）
 * @returns 0–99
 */
function bucket(seed: string, salt: string): number {
  return hash32(`${seed}:${salt}`) % 100;
}

/**
 * 找句内可插停顿的位置（返回插入下标；-1 = 本句不能插）.
 *
 * @param text 原句
 * @returns 插入下标
 */
function findPauseIndex(text: string): number {
  if (text.length < PAUSE_MIN_CHARS) return -1;
  for (let index = 2; index < text.length - 1; index += 1) {
    if (!SOFT_BREAKS.has(text[index])) continue;
    const prev = text[index - 1];
    const next = text[index + 1];
    if (NON_SPEAKABLE.has(prev) || NON_SPEAKABLE.has(next)) continue;
    if (SOFT_BREAKS.has(next)) continue;
    return index + 1;
  }
  return -1;
}

/**
 * 生成一条 pause 事件（时长按哈希在候选里挑）.
 *
 * @param plan 本轮计划
 * @param sentenceIndex 句序号
 * @returns 时长（毫秒）
 */
function pauseDurationOf(plan: ProsodyTurnPlan, sentenceIndex: number): number {
  const candidates = PAUSE_CANDIDATES[plan.level === 'medium' ? 'medium' : 'light'];
  return candidates[hash32(`${plan.seed}:dur:${sentenceIndex}`) % candidates.length];
}

/**
 * 生成 filler 事件（选词同样确定性）.
 *
 * @param plan 本轮计划
 * @returns 填充词
 */
function fillerOf(plan: ProsodyTurnPlan): string {
  return FILLERS[hash32(`${plan.seed}:filler`) % FILLERS.length];
}

/**
 * 本轮配额是否已用尽（事件数上限 / 句间隔）.
 *
 * @param plan 本轮计划
 * @param context 句序号与配额
 * @returns true = 本句不能再加事件
 */
function prosodyExhausted(plan: ProsodyTurnPlan, context: ProsodyApplyContext): boolean {
  const { limits } = plan;
  if (context.appliedEvents >= limits.maxEventsPerTurn) return true;
  return context.lastEventSentenceIndex >= 0 && context.sentenceIndex - context.lastEventSentenceIndex < limits.minSentenceGap;
}

/**
 * 尝试生成句内停顿结果.
 *
 * @param sentence 原句
 * @param plan 本轮计划
 * @param sentenceIndex 句序号
 * @returns 结果；本句没有合法断点则返回 null
 */
function pauseResult(sentence: string, plan: ProsodyTurnPlan, sentenceIndex: number): ProsodySentenceResult | null {
  const at = findPauseIndex(sentence);
  if (at <= 0) return null;
  const durationMs = pauseDurationOf(plan, sentenceIndex);
  const seconds = String(Number((durationMs / 1000).toFixed(2)));
  const event: ProsodyEvent = { kind: 'pause', anchor: 'sentence_mid', durationMs };
  return { displayText: sentence, speechText: `${sentence.slice(0, at)}[pause:${seconds}]${sentence.slice(at)}`, events: [event] };
}

/**
 * 尝试生成句末拖音结果（第 2 句起，只改句号）.
 *
 * @param sentence 原句
 * @param roll 本句桶号
 * @param offset 拖音号段起点
 * @param chance 拖音概率
 * @param sentenceIndex 句序号
 * @returns 结果；不命中返回 null
 */
function trailoffResult(
  sentence: string,
  roll: number,
  offset: number,
  chance: number,
  sentenceIndex: number,
): ProsodySentenceResult | null {
  const hit = sentenceIndex >= 2 && roll >= offset && roll < offset + chance;
  if (!hit || !sentence.endsWith('。') || sentence.endsWith('……')) return null;
  const event: ProsodyEvent = { kind: 'trailoff', anchor: 'sentence_end', text: '……' };
  return { displayText: sentence, speechText: `${sentence.slice(0, -1)}……`, events: [event] };
}

/**
 * 把计划落到一句话上.
 *
 * @param sentence 原句（已清洗过厂商标记）
 * @param plan 本轮计划
 * @param context 句序号与配额
 * @returns 展示文本 / 语义形态 / 本句事件
 */
export function applyProsodyToSentence(sentence: string, plan: ProsodyTurnPlan, context: ProsodyApplyContext): ProsodySentenceResult {
  const untouched: ProsodySentenceResult = { displayText: sentence, speechText: sentence, events: [] };
  if (plan.level === 'off' || sentence.trim().length === 0 || prosodyExhausted(plan, context)) return untouched;

  const level = plan.level === 'medium' ? 'medium' : 'light';
  const roll = bucket(plan.seed, `s${context.sentenceIndex}`);

  // 1) 第 0 句的思考垫
  const fillerChance = plan.limits.filler ? FILLER_CHANCE[level] : 0;
  if (context.sentenceIndex === 0 && roll < fillerChance && !FILLER_PREFIX.test(sentence)) {
    const text = fillerOf(plan);
    return { displayText: sentence, speechText: `${text}${sentence}`, events: [{ kind: 'filler', anchor: 'sentence_start', text }] };
  }

  // 2) 句内停顿（号段紧跟思考垫，互不重叠）
  const pauseChance = plan.limits.pause ? PAUSE_CHANCE[level] : 0;
  const pauseOffset = fillerChance;
  if (pauseChance > 0 && roll >= pauseOffset && roll < pauseOffset + pauseChance) {
    return pauseResult(sentence, plan, context.sentenceIndex) ?? untouched;
  }

  // 3) 句末拖音
  const trailoffChance = plan.limits.trailoff ? TRAILOFF_CHANCE[level] : 0;
  return trailoffResult(sentence, roll, pauseOffset + pauseChance, trailoffChance, context.sentenceIndex) ?? untouched;
}
