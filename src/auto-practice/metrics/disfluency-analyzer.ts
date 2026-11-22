// V2026-11-12 Phase3 P0 (文字层真人度 · 不流利分类纯函数 · 纯模块):
//   职责: 把一句来访者台词判成六类不流利的计数 (filler / pause / repetition /
//         repair / trailoff / elongation), 只出数字, 不出原文.
//   边界: 零 IO / 零框架依赖 / 零随机; 同输入逐字节相同.
//
// ── 隐私分层 (蓝图 §5.2.3, 本单最高优先级约束) ──────────────────────────────
//   本模块是**唯一接触台词原文**的模块; 它只在服务层 (batch-metrics.service.ts,
//   IO 层) 被调用. 纯计算层 batch-metrics.compute.ts **不得 import 本模块**,
//   只消费 disfluency-lexicon.js 里的纯数值契约. 投影后全链路无任何对话原文.
//
// ── 消歧纪律 (蓝图 §5.1) ───────────────────────────────────────────────────
//   ① 一个文本位置只归一类, 优先级: repair > trailoff > repetition > pause > filler > elongation;
//   ② 叠词白名单不计 repetition;
//   ③ 填充词只统计句首或被标点隔离的命中;
//   ④ 拖音保守识别 (只认显式「词干 + 破折号」);
//   ⑤ 连续标点合并为一次停顿.
//
// ── AF-204 · repair 口径纠偏 ────────────────────────────────────────────────
//   repair 从「REPAIR_TRIGGERS 子串命中」改成严格规则集: 只有真正的改口/重述
//   才计一次; 「是不是」「我不是本地人」这类否定判断不再误计.
//   旧口径保留在 countLooseRepairs 里, 只供口径审计对照.
//
//   验证: pnpm exec vitest run test/auto-practice/metrics/disfluency-analyzer.spec.ts

import {
  aggregateDisfluency,
  ELONGATION_PATTERN,
  EMPTY_DISFLUENCY_METRICS,
  FILLER_WORDS,
  LOOKAHEAD_STOP_CHARS,
  normalizeForDetection,
  normalizeForLength,
  PUNCTUATION_SET,
  REPAIR_FOLLOWUP_CUES,
  REPAIR_NEGATION_PUNCTUATION,
  REPAIR_NEGATION_STRONG_FOLLOWERS,
  REPAIR_NEGATION_WEAK_FOLLOWERS,
  REPAIR_TRIGGERS,
  REPETITION_PATTERN,
  REPETITION_WHITELIST,
  SENTENCE_END_PUNCTUATION,
  STRICT_REPAIR_BOUNDARY_MARKERS,
  STRICT_REPAIR_MARKERS,
  STRICT_REPAIR_WAIT_MARKERS,
  TRAILOFF_MIN_CHARS,
  type DisfluencyCounts,
  type DisfluencyMetrics,
} from './disfluency-lexicon.js';

export { aggregateDisfluency, EMPTY_DISFLUENCY_METRICS };
export type { DisfluencyCounts, DisfluencyMetrics };

/** 已占用区间 (一个文本位置只归一类). */
interface Span {
  readonly start: number;
  readonly end: number;
}

/**
 * 区间是否与已占用区间重叠.
 *
 * @param claimed 已占用区间
 * @param start 起点 (含)
 * @param end 终点 (不含)
 * @returns 重叠即 true
 */
function overlaps(claimed: readonly Span[], start: number, end: number): boolean {
  for (const span of claimed) {
    if (start < span.end && span.start < end) return true;
  }
  return false;
}

/**
 * 叠词是否在白名单里 (合法叠词不计 repetition).
 *
 * 三条判据:
 *   ① 命中片段本身在白名单 (如「看看」);
 *   ② 命中片段**左扩一字**后构成白名单词 (如「一点点」命中的是「点点」);
 *   ③ 命中片段**右扩一字**后构成白名单词.
 *
 * @param text 识别用归一化文本
 * @param start 命中起点
 * @param end 命中终点 (不含)
 * @returns 在白名单即 true
 */
function isWhitelistedReduplication(text: string, start: number, end: number): boolean {
  if (REPETITION_WHITELIST.has(text.slice(start, end))) return true;
  if (REPETITION_WHITELIST.has(text.slice(Math.max(0, start - 1), end))) return true;
  return REPETITION_WHITELIST.has(text.slice(start, Math.min(text.length, end + 1)));
}

/**
 * 句末停顿前那一截的字数 (半截话启发式的输入).
 *
 * @param text 识别用归一化文本
 * @param pauseIndex 末尾停顿的位置
 * @returns 该截的字数
 */
function trailingFragmentLength(text: string, pauseIndex: number): number {
  const boundaries = [
    text.lastIndexOf('。'),
    text.lastIndexOf('！'),
    text.lastIndexOf('？'),
    text.lastIndexOf('；'),
    text.lastIndexOf('…', pauseIndex - 1),
  ];
  return pauseIndex - (Math.max(...boundaries) + 1);
}

/**
 * ① repair: 自我修正命中 (最高优先级).
 *
 * ── AF-204 口径纠偏 ────────────────────────────────────────────────────────
 *   旧口径 = REPAIR_TRIGGERS 子串命中, 把「是不是」「我不是本地人」这类
 *   **否定判断**误计为自我修正 (repair_per_turn 系统性虚高).
 *   现口径 = 四类严格规则:
 *     ① 无条件显式改口标记 ("应该是" / "换个说法");
 *     ② 子句开头 **或** 后接纠正线索的改口标记 ("不对" / "算了");
 *     ③ 必须后接纠正线索的等待型标记 ("等等，我刚说错了");
 *     ④ 否定词「不是」只在真正的改口上下文里计 (见 countNegationRepairs).
 *
 * @param normalized 识别用归一化文本
 * @param claimed 已占用区间 (原地追加)
 * @returns 命中次数
 */
function countRepairs(normalized: string, claimed: Span[]): number {
  let count = 0;
  // ① 无条件显式改口标记.
  for (const marker of STRICT_REPAIR_MARKERS) {
    count += claimOccurrences(normalized, marker, claimed);
  }
  // ② 子句开头 **或** 后接纠正线索才计.
  for (const marker of STRICT_REPAIR_BOUNDARY_MARKERS) {
    count += claimConditional(normalized, marker, claimed, (at, end) => isClauseStart(normalized, at) || hasFollowupCue(normalized, end));
  }
  // ③ 等待型标记: 必须后接纠正线索.
  for (const marker of STRICT_REPAIR_WAIT_MARKERS) {
    count += claimConditional(normalized, marker, claimed, (_at, end) => hasFollowupCue(normalized, end));
  }
  // ④ 否定词「不是」: 只在真正的改口上下文里计.
  count += countNegationRepairs(normalized, claimed);
  return count;
}

/**
 * ④ 否定词「不是」: 只在真正的自我修正上下文里计一次.
 *
 * 不计 (旧口径的假阳性):
 *   · 「是不是」       → 疑问句;
 *   · 「我不是本地人」 → 普通否定判断 (不在子句开头, 后面也不是纠正引导);
 *   · 「不是什么」     → 普通否定.
 * 计:
 *   · 「不是 A 而是 B」        (强引导, 不限位置);
 *   · 「其实不是这样」          (「其实」+ 弱引导);
 *   · 「不是，其实……」         (子句开头 + 纠正引导).
 *
 * @param normalized 识别用归一化文本
 * @param claimed 已占用区间 (原地追加)
 * @returns 命中次数
 */
function countNegationRepairs(normalized: string, claimed: Span[]): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = normalized.indexOf('不是', from);
    if (at === -1) break;
    from = at + 1;
    const end = at + 2;
    if (overlaps(claimed, at, end)) continue;
    // 疑问句「是不是」→ 不是改口.
    if (normalized[end] === '是') continue;
    const clauseStart = isClauseStart(normalized, at);
    const weak = REPAIR_NEGATION_WEAK_FOLLOWERS.some((follower) => normalized.startsWith(follower, end));
    const punctuated = REPAIR_NEGATION_PUNCTUATION.has(normalized[end] ?? '');
    // 相邻的「不是 A 而是 B」→ 明确的改口 (不限位置).
    const adjacentContrast = REPAIR_NEGATION_STRONG_FOLLOWERS.some((follower) => normalized.startsWith(follower, end));
    // 「不是……而是……」: 否定词必须在子句开头 (否则是事实对比, 不是改口).
    const clauseContrast = hasFollowupToken(normalized, end, '而是');
    if (adjacentContrast) {
      claimed.push({ start: at, end });
      count += 1;
      continue;
    }
    // 「其实不是这样 / 其实不是，……」: 前面有「其实」且后面是纠正引导.
    if (at >= 2 && normalized.startsWith('其实', at - 2)) {
      if (weak || punctuated) {
        claimed.push({ start: at, end });
        count += 1;
      }
      continue;
    }
    // 子句开头的「不是」+ 纠正引导.
    if (clauseStart && (weak || punctuated || clauseContrast)) {
      claimed.push({ start: at, end });
      count += 1;
    }
  }
  return count;
}

/**
 * 是否位于子句开头 (文本起点, 或紧跟任意标点).
 *
 * @param normalized 识别用归一化文本
 * @param at 命中起点
 * @returns 是子句开头即 true
 */
function isClauseStart(normalized: string, at: number): boolean {
  if (at <= 0) return true;
  return PUNCTUATION_SET.has(normalized[at - 1] ?? '');
}

/**
 * 从 `from` 起、同一子句内的文本切片 (前瞻边界 = 句末标点 + 省略号).
 *
 * @param normalized 识别用归一化文本
 * @param from 起点 (不含)
 * @returns 子句切片
 */
function clauseSlice(normalized: string, from: number): string {
  let end = from;
  while (end < normalized.length && !LOOKAHEAD_STOP_CHARS.has(normalized[end])) end += 1;
  return normalized.slice(from, end);
}

/**
 * 从 `from` 起、同一子句内有没有纠正线索.
 *
 * @param normalized 识别用归一化文本
 * @param from 起点 (不含)
 * @returns 有纠正线索即 true
 */
function hasFollowupCue(normalized: string, from: number): boolean {
  const clause = clauseSlice(normalized, from);
  return REPAIR_FOLLOWUP_CUES.some((cue) => clause.includes(cue));
}

/**
 * 从 `from` 起、同一子句内有没有指定引导词.
 *
 * @param normalized 识别用归一化文本
 * @param from 起点 (不含)
 * @param token 引导词
 * @returns 有该引导词即 true
 */
function hasFollowupToken(normalized: string, from: number, token: string): boolean {
  return clauseSlice(normalized, from).includes(token);
}

/**
 * 找出某个标记的全部出现位置, 占用命中区间并计数 (原地追加到 claimed).
 *
 * @param normalized 识别用归一化文本
 * @param marker 标记
 * @param claimed 已占用区间 (原地追加)
 * @returns 未与已占用区间重叠的命中次数
 */
function claimOccurrences(normalized: string, marker: string, claimed: Span[]): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = normalized.indexOf(marker, from);
    if (at === -1) break;
    from = at + 1;
    const end = at + marker.length;
    if (overlaps(claimed, at, end)) continue;
    claimed.push({ start: at, end });
    count += 1;
  }
  return count;
}

/**
 * 只在满足判定条件时才占用的标记命中.
 *
 * @param normalized 识别用归一化文本
 * @param marker 标记
 * @param claimed 已占用区间 (原地追加)
 * @param accept 命中判定 (位置 + 终点)
 * @returns 命中次数
 */
function claimConditional(normalized: string, marker: string, claimed: Span[], accept: (at: number, end: number) => boolean): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = normalized.indexOf(marker, from);
    if (at === -1) break;
    from = at + 1;
    const end = at + marker.length;
    if (overlaps(claimed, at, end)) continue;
    if (!accept(at, end)) continue;
    claimed.push({ start: at, end });
    count += 1;
  }
  return count;
}

/**
 * ② trailoff: 句末停顿 + 「话说一半」启发式 (与句末 pause 互斥归类).
 *
 * @param normalized 识别用归一化文本
 * @param claimed 已占用区间 (原地追加)
 * @returns 命中次数
 */
function countTrailoffs(normalized: string, claimed: Span[]): number {
  if (!normalized.endsWith('…')) return 0;
  const pauseIndex = normalized.length - 1;
  if (trailingFragmentLength(normalized, pauseIndex) < TRAILOFF_MIN_CHARS) return 0;
  claimed.push({ start: pauseIndex, end: normalized.length });
  return 1;
}

/**
 * ③ repetition: 相邻 1-2 字重复, 叠词白名单除外.
 *
 * 位置纪律 (本单口径, 保守方向): 只认**子句开头**的重复 (句首或紧跟标点).
 * 原因: 中文没有词边界, 「今天天气」这类跨词边界的叠字会被相邻重复规则误判,
 * 逐轮误计会让 repetition_per_turn 系统性偏高. 代价是句中口吃式重复会漏计 ——
 * 这是 P1 基线批次要量化的已知取舍 (见交付记录「遗留项」).
 *
 * @param normalized 识别用归一化文本
 * @param claimed 已占用区间 (原地追加)
 * @returns 命中次数
 */
function countRepetitions(normalized: string, claimed: Span[]): number {
  let count = 0;
  REPETITION_PATTERN.lastIndex = 0;
  for (;;) {
    const match = REPETITION_PATTERN.exec(normalized);
    if (!match) break;
    const start = match.index;
    const end = start + match[0].length;
    const atClauseStart = start === 0 || PUNCTUATION_SET.has(normalized[start - 1] ?? '');
    if (!atClauseStart) continue;
    if (overlaps(claimed, start, end)) continue;
    if (isWhitelistedReduplication(normalized, start, end)) continue;
    claimed.push({ start, end });
    count += 1;
  }
  return count;
}

/**
 * ④ pause: 归一后的单个省略号 (连续标点已合并); 已被 trailoff 占用的句末停顿不计.
 *
 * @param normalized 识别用归一化文本
 * @param claimed 已占用区间 (原地追加)
 * @returns 命中次数
 */
function countPauses(normalized: string, claimed: Span[]): number {
  let count = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index] !== '…') continue;
    if (overlaps(claimed, index, index + 1)) continue;
    claimed.push({ start: index, end: index + 1 });
    count += 1;
  }
  return count;
}

/**
 * ⑤ filler: 只统计句首或被标点隔离的命中 (句中正常承接不计).
 *
 * @param normalized 识别用归一化文本
 * @param claimed 已占用区间 (原地追加)
 * @returns 命中次数
 */
function countFillers(normalized: string, claimed: Span[]): number {
  let count = 0;
  for (const word of FILLER_WORDS) {
    let from = 0;
    for (;;) {
      const at = normalized.indexOf(word, from);
      if (at === -1) break;
      const end = at + word.length;
      const before = at > 0 ? normalized[at - 1] : '';
      const after = end < normalized.length ? normalized[end] : '';
      const sentenceStart = at === 0 || SENTENCE_END_PUNCTUATION.has(before);
      const isolated = before !== '' && after !== '' && PUNCTUATION_SET.has(before) && PUNCTUATION_SET.has(after);
      const qualifies = sentenceStart || isolated;
      if (qualifies && !overlaps(claimed, at, end)) {
        claimed.push({ start: at, end });
        count += 1;
      }
      from = at + 1;
    }
  }
  return count;
}

/**
 * ⑥ elongation (最低优先级): 显式「词干 + 破折号拖长」; 与高优先级命中重叠则不计.
 *
 * @param normalized 识别用归一化文本
 * @param claimed 已占用区间 (原地追加)
 * @returns 命中次数
 */
function countElongations(normalized: string, claimed: Span[]): number {
  let count = 0;
  ELONGATION_PATTERN.lastIndex = 0;
  for (;;) {
    const match = ELONGATION_PATTERN.exec(normalized);
    if (!match) break;
    const start = match.index;
    const end = start + match[0].length;
    if (!overlaps(claimed, start, end)) {
      claimed.push({ start, end });
      count += 1;
    }
  }
  return count;
}

/**
 * 分析一句台词的不流利计数 (纯函数).
 *
 * @param text 原始台词
 * @returns 纯数值度量 (不含任何文本片段)
 */
export function analyzeDisfluency(text: string): DisfluencyMetrics {
  const source = typeof text === 'string' ? text : '';
  const normalizedLength = normalizeForLength(source).length;
  const normalized = normalizeForDetection(source);
  if (normalized.length === 0) {
    return { counts: { ...EMPTY_DISFLUENCY_METRICS.counts }, events: 0, hasEvent: false, normalizedLength };
  }
  const claimed: Span[] = [];
  const repair = countRepairs(normalized, claimed);
  const trailoff = countTrailoffs(normalized, claimed);
  const repetition = countRepetitions(normalized, claimed);
  const pause = countPauses(normalized, claimed);
  const filler = countFillers(normalized, claimed);
  const elongation = countElongations(normalized, claimed);
  const counts: DisfluencyCounts = { filler, pause, repetition, repair, trailoff, elongation };
  const events = filler + pause + repetition + repair + trailoff + elongation;
  return { counts, events, hasEvent: events > 0, normalizedLength };
}

/**
 * 严格口径的自我修正计数 (AF-204 主口径 · 可审计).
 *
 * 与 analyzeDisfluency 里 counts.repair 同源同口径, 单独暴露成纯函数,
 * 便于审计脚本 / 回归测试直接对一句台词求值 (不构造完整度量对象).
 *
 * @param text 原始台词
 * @returns 严格口径的改口次数
 */
export function countStrictRepairs(text: string): number {
  const source = typeof text === 'string' ? text : '';
  const normalized = normalizeForDetection(source);
  if (normalized.length === 0) return 0;
  return countRepairs(normalized, []);
}

/**
 * 宽松口径的自我修正计数 (历史遗留 · ⚠️ 含已知假阳性).
 *
 * AF-204 之前的口径: `REPAIR_TRIGGERS` 子串命中即计一次.
 * 「是不是」「我不是本地人」这类否定判断会被误计 —— 本函数**只用于口径审计对照**,
 * 业务指标一律走 countStrictRepairs / analyzeDisfluency.
 *
 * @param text 原始台词
 * @returns 宽松口径的改口次数
 */
export function countLooseRepairs(text: string): number {
  const source = typeof text === 'string' ? text : '';
  const normalized = normalizeForDetection(source);
  if (normalized.length === 0) return 0;
  const claimed: Span[] = [];
  let count = 0;
  for (const trigger of REPAIR_TRIGGERS) {
    count += claimOccurrences(normalized, trigger, claimed);
  }
  return count;
}
