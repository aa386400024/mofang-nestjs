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
//   验证: pnpm exec vitest run test/auto-practice/metrics/disfluency-analyzer.spec.ts

import {
  aggregateDisfluency,
  ELONGATION_PATTERN,
  EMPTY_DISFLUENCY_METRICS,
  FILLER_WORDS,
  normalizeForDetection,
  normalizeForLength,
  PUNCTUATION_SET,
  REPAIR_TRIGGERS,
  REPETITION_PATTERN,
  REPETITION_WHITELIST,
  SENTENCE_END_PUNCTUATION,
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
 * ① repair: 修正触发词命中 (最高优先级).
 *
 * @param normalized 识别用归一化文本
 * @param claimed 已占用区间 (原地追加)
 * @returns 命中次数
 */
function countRepairs(normalized: string, claimed: Span[]): number {
  let count = 0;
  for (const trigger of REPAIR_TRIGGERS) {
    let from = 0;
    for (;;) {
      const at = normalized.indexOf(trigger, from);
      if (at === -1) break;
      const end = at + trigger.length;
      if (!overlaps(claimed, at, end)) {
        claimed.push({ start: at, end });
        count += 1;
      }
      from = at + 1;
    }
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
