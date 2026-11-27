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

/** 思考垫用词（口头的“起个头”，不是每轮都用）. */
const FILLERS = ['嗯，', '呃，', '我想想，', '其实，', '就是，', '这么说吧，'] as const;

/** AF-460: 思考段用词（带省略号，后面跟一个真实的长停顿）. */
const THINKING_FILLERS = ['嗯……', '呃……', '我想想……', '怎么说呢……'] as const;

/** AF-565: 长沉默中段穿插的思考声（只进 TTS；不重复“那个”，避免和模型台词撞车）. */
const INTERLUDE_FILLERS = ['嗯……', '呃……', '我想想……'] as const;

/** 已以填充词开头的句子不再加（防重复）. */
const FILLER_PREFIX = /^(?:嗯|呃|唉|那个|就是|怎么说呢)/;

/** 句内可断点（与 TTS 切句的次级标点一致）. */
const SOFT_BREAKS = new Set(['，', '、', '：', ',', ';', ':']);

/** 句末/不可发音字符（停顿两侧不能是它们）. */
const NON_SPEAKABLE = new Set(['。', '！', '？', '…', '；', '!', '?', '.', '\n', ' ', ']', '>', '#']);

/** pause 对句长的最低要求（太短的句子加停顿只会更碎）. */
const PAUSE_MIN_CHARS = 12;

/** AF-565: 句内短停也缩短半档；medium 保留一点“想一想”的余地，但不拖成 0.5s+. */
const PAUSE_CANDIDATES: Readonly<Record<'light' | 'medium', readonly number[]>> = {
  light: [200, 250, 300],
  medium: [280, 340, 400, 450],
};

/** 各强度下"句末拖音"的概率（百分比）；light 不开启. */
const TRAILOFF_CHANCE: Readonly<Record<'light' | 'medium', number>> = { light: 0, medium: 20 };

/** AF-460: 思考段概率（只在本轮第 0 句；light 更克制）. */
const THINKING_CHANCE: Readonly<Record<'light' | 'medium', number>> = { light: 9, medium: 18 };

/** AF-460: 长沉默概率（第 2 句起；只有 medium 开，且每轮最多一次）. */
const LONG_SILENCE_CHANCE: Readonly<Record<'light' | 'medium', number>> = { light: 0, medium: 16 };
/** 副语言低频，只在 medium 开；句首呼吸/叹气，避免每句都喘. */
const PARALINGUISTIC_CHANCE: Readonly<Record<'light' | 'medium', number>> = { light: 0, medium: 7 };

/** AF-460: 句末长沉默的最低句长（太短只会像断线）. */
const LONG_SILENCE_MIN_CHARS = 8;

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
  return FILLERS[rotateIndex(plan, FILLERS.length, 'filler')];
}

/**
 * AF-565: 口头语按轮次轮换 —— 同一场相邻两轮不会撞同一个词.
 *
 * @param plan 本轮计划
 * @param poolLength 词池长度
 * @param salt 区分填充词/思考声/长沉默
 * @returns 池下标
 */
function rotateIndex(plan: ProsodyTurnPlan, poolLength: number, salt: string): number {
  const hashAt = plan.seed.indexOf('#');
  const sessionKey = hashAt === -1 ? plan.seed : plan.seed.slice(0, hashAt);
  const base = plan.turnIndex ?? hash32(plan.seed);
  return (base + hash32(`${sessionKey}:${salt}`)) % poolLength;
}

/**
 * 生成思考段用词（确定性）.
 *
 * @param plan 本轮计划
 * @returns 思考段文本
 */
function thinkingFillerOf(plan: ProsodyTurnPlan): string {
  return THINKING_FILLERS[rotateIndex(plan, THINKING_FILLERS.length, 'thinking')];
}

/**
 * 在一个闭区间里按时长哈希取值.
 *
 * @param range 毫秒范围
 * @param seed 计划 seed
 * @param salt 额外区分
 * @returns 毫秒
 */
function durationInRange(range: readonly [number, number], seed: string, salt: string): number {
  const [min, max] = range;
  if (max <= min) return Math.max(0, min);
  return min + (hash32(`${seed}:${salt}`) % (max - min + 1));
}

/**
 * 生成思考段结果（句首「嗯……」+ 1.5–3.0s 停顿）.
 *
 * @param sentence 原句
 * @param plan 本轮计划
 * @param sentenceIndex 句序号
 * @returns 结果
 */
function thinkingResult(sentence: string, plan: ProsodyTurnPlan, sentenceIndex: number): ProsodySentenceResult {
  const text = thinkingFillerOf(plan);
  const range = plan.limits.thinkingPauseMs ?? [1200, 2200];
  const durationMs = durationInRange(range, plan.seed, `thinking:${sentenceIndex}`);
  const seconds = String(Number((durationMs / 1000).toFixed(2)));
  return {
    displayText: sentence,
    speechText: `${text}[beat:${seconds}]${sentence}`,
    events: [{ kind: 'thinking', anchor: 'sentence_start', text, durationMs }],
  };
}

/**
 * 生成长沉默结果（句末 `[silence:x]`）.
 *
 * @param sentence 原句
 * @param plan 本轮计划
 * @param sentenceIndex 句序号
 * @returns 结果
 */
function silenceResult(sentence: string, plan: ProsodyTurnPlan, sentenceIndex: number): ProsodySentenceResult {
  const range = plan.limits.longSilenceMs ?? [3000, 6000];
  const durationMs = durationInRange(range, plan.seed, `silence:${sentenceIndex}`);
  const seconds = String(Number((durationMs / 1000).toFixed(2)));
  // AF-565: 长沉默不再一口气静默到底 —— 先静默 leadMs，再由下一句的隐藏思考声接住.
  //   leadMs 夹在 0.9–1.6s：短于 0.9s 听不出“想了一会儿”，长于 1.6s 仍会像断线.
  const leadMs = Math.min(1600, Math.max(900, Math.round(durationMs / 2)));
  const thinkingText = INTERLUDE_FILLERS[rotateIndex(plan, INTERLUDE_FILLERS.length, 'interlude')];
  return {
    displayText: sentence,
    speechText: `${sentence}[silence:${seconds}]`,
    events: [{ kind: 'silence', anchor: 'sentence_end', durationMs, leadMs, thinkingText }],
  };
}

/**
 * 生成副语言结果（句首呼吸/叹气）.
 *
 * @param sentence 原句
 * @param plan 本轮计划
 * @param sentenceIndex 句序号
 * @returns 结果
 */
function paralinguisticResult(sentence: string, plan: ProsodyTurnPlan, sentenceIndex: number): ProsodySentenceResult {
  const kind = hash32(`${plan.seed}:para:${sentenceIndex}`) % 2 === 0 ? 'breath' : 'sigh';
  return {
    displayText: sentence,
    speechText: `[${kind}]${sentence}`,
    events: [{ kind, anchor: 'sentence_start', text: kind }],
  };
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

/** 单个阶段的结果：命中就返回；未命中返回下一个候选偏移. */
interface ProsodyStage {
  readonly result: ProsodySentenceResult | null;
  readonly nextOffset: number;
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
  const firstSentence = context.sentenceIndex === 0;
  let offset = 0;

  const thinking = thinkingStage(sentence, plan, context, level, roll, firstSentence, offset);
  if (thinking.result !== null) return thinking.result;
  offset = thinking.nextOffset;

  const filler = fillerStage(sentence, plan, level, roll, firstSentence, offset);
  if (filler.result !== null) return filler.result;
  offset = filler.nextOffset;

  const longSilence = longSilenceStage(sentence, plan, context, level, roll, firstSentence, offset);
  if (longSilence.result !== null) return longSilence.result;
  offset = longSilence.nextOffset;

  const pause = pauseStage(sentence, plan, context, roll, offset);
  if (pause.result !== null) return pause.result;
  offset = pause.nextOffset;

  const paralinguistic = paralinguisticStage(sentence, plan, context, level, roll, offset);
  if (paralinguistic.result !== null) return paralinguistic.result;
  offset = paralinguistic.nextOffset;

  return trailoffStage(sentence, plan, context, level, roll, offset) ?? untouched;
}

/** 阶段 1：第 0 句的思考段（带真实时长，优先级高于旧 filler）. */
function thinkingStage(
  sentence: string,
  plan: ProsodyTurnPlan,
  context: ProsodyApplyContext,
  level: 'light' | 'medium',
  roll: number,
  firstSentence: boolean,
  offset: number,
): ProsodyStage {
  if (!firstSentence || plan.limits.thinking !== true) return { result: null, nextOffset: offset };
  const maxThinking = plan.limits.maxThinkingBeats ?? 0;
  const usedThinking = context.appliedThinkingBeats ?? 0;
  const chance = THINKING_CHANCE[level];
  if (usedThinking < maxThinking && roll < chance && !FILLER_PREFIX.test(sentence)) {
    return { result: thinkingResult(sentence, plan, context.sentenceIndex), nextOffset: offset };
  }
  return { result: null, nextOffset: offset + chance };
}

/** 阶段 2：第 0 句的旧思考垫（不带走时长）. */
function fillerStage(
  sentence: string,
  plan: ProsodyTurnPlan,
  level: 'light' | 'medium',
  roll: number,
  firstSentence: boolean,
  offset: number,
): ProsodyStage {
  const chance = fillerChanceOf(plan, level);
  if (firstSentence && chance > 0 && roll >= offset && roll < offset + chance && !FILLER_PREFIX.test(sentence)) {
    const text = fillerOf(plan);
    return {
      result: { displayText: sentence, speechText: `${text}${sentence}`, events: [{ kind: 'filler', anchor: 'sentence_start', text }] },
      nextOffset: offset,
    };
  }
  return { result: null, nextOffset: firstSentence ? offset + chance : offset };
}

/** 旧思考垫的命中概率（medium 略低，因为已有真实思考段）. */
function fillerChanceOf(plan: ProsodyTurnPlan, level: 'light' | 'medium'): number {
  if (plan.limits.filler !== true) return 0;
  return level === 'medium' ? 33 : 39;
}

/** 阶段 3：第 2 句起的长沉默（句末，每轮最多一次）. */
function longSilenceStage(
  sentence: string,
  plan: ProsodyTurnPlan,
  context: ProsodyApplyContext,
  level: 'light' | 'medium',
  roll: number,
  firstSentence: boolean,
  offset: number,
): ProsodyStage {
  if (firstSentence || plan.limits.longSilence !== true) return { result: null, nextOffset: offset };
  const maxLong = plan.limits.maxLongSilences ?? 0;
  const usedLong = context.appliedLongSilences ?? 0;
  const chance = LONG_SILENCE_CHANCE[level];
  const hit =
    usedLong < maxLong &&
    chance > 0 &&
    roll >= offset &&
    roll < offset + chance &&
    sentence.length >= LONG_SILENCE_MIN_CHARS &&
    /[。！？]$/.test(sentence);
  if (hit) return { result: silenceResult(sentence, plan, context.sentenceIndex), nextOffset: offset };
  return { result: null, nextOffset: offset + chance };
}

/** 阶段 4：句内停顿（保留 AF-459 的合法位置约束）. */
function pauseStage(sentence: string, plan: ProsodyTurnPlan, context: ProsodyApplyContext, roll: number, offset: number): ProsodyStage {
  const chance = plan.limits.pause === true ? 30 : 0;
  const hit = chance > 0 && roll >= offset && roll < offset + chance;
  if (!hit) return { result: null, nextOffset: offset + chance };
  // 命中概率但找不到合法停顿位置时，按 AF-459 口径**到此为止**，不再叠副语言/拖音.
  const result = pauseResult(sentence, plan, context.sentenceIndex) ?? { displayText: sentence, speechText: sentence, events: [] };
  return { result, nextOffset: offset + chance };
}

/** 阶段 5：副语言（呼吸/叹气），只在 medium，低频，句首. */
function paralinguisticStage(
  sentence: string,
  plan: ProsodyTurnPlan,
  context: ProsodyApplyContext,
  level: 'light' | 'medium',
  roll: number,
  offset: number,
): ProsodyStage {
  if (plan.limits.paralinguistic !== true) return { result: null, nextOffset: offset };
  const maxPara = plan.limits.maxParalinguistic ?? 0;
  const usedPara = context.appliedParalinguistic ?? 0;
  const chance = PARALINGUISTIC_CHANCE[level];
  if (usedPara < maxPara && chance > 0 && roll >= offset && roll < offset + chance) {
    return { result: paralinguisticResult(sentence, plan, context.sentenceIndex), nextOffset: offset };
  }
  return { result: null, nextOffset: offset + chance };
}

/** 阶段 6：句末拖音（第 2 句起、只改句号）. */
function trailoffStage(
  sentence: string,
  plan: ProsodyTurnPlan,
  context: ProsodyApplyContext,
  level: 'light' | 'medium',
  roll: number,
  offset: number,
): ProsodySentenceResult | null {
  const chance = plan.limits.trailoff === true ? TRAILOFF_CHANCE[level] : 0;
  return trailoffResult(sentence, roll, offset, chance, context.sentenceIndex);
}
