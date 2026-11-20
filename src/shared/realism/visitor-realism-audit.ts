// V2026-11-20 建立 (AF-208 · R2 生成侧真人度):
//   职责: 对**已经生成**的来访者台词做确定性审计 —— 是否明显违背了本轮话轮形态、
//         是否把不流利痕迹用超了。只有明确违约才触发重试，避免"为了指标而改台词"。
//
//   边界:
//     · 纯函数，零 IO / 零 env / 零 LLM；
//     · 只判"可观察的硬违约"，不判"像不像人"这种主观维度；
//     · 不返回原文，只返回原因与计数，调用方日志不会带台词。

import type { RealismEventKind, RealismEventPlan } from './realism-event-plan.js';
import type { VisitorTurnShape } from './turn-shape-selector.js';

/** 审计用的 profile 面（避免把整个 profile 类型耦合进来）。 */
export interface RealismAuditProfile {
  readonly state: 'steady' | 'guarded' | 'flooded' | 'risk';
  readonly shape: VisitorTurnShape;
}

/** 审计结果。 */
export interface RealismAuditResult {
  readonly ok: boolean;
  readonly reasons: readonly RealismViolation[];
  /** 软信号：只记录、不触发重试。用于观察 prompt 引导是否生效，避免机械规则逼出假台词。 */
  readonly signals: readonly RealismSignal[];
  readonly counts: Readonly<Record<RealismEventKind, number>>;
  readonly totalEvents: number;
}

export type RealismViolation = 'too_long' | 'missing_question_back' | 'missing_repair' | 'over_quota';
export type RealismSignal = 'missing_deflection';

interface Span {
  readonly start: number;
  readonly end: number;
}

const EMPTY_COUNTS: Record<RealismEventKind, number> = {
  filler: 0,
  pause: 0,
  repair: 0,
  trailoff: 0,
  repetition: 0,
  elongation: 0,
};

/** 合法叠词白名单：这些重复不是不流利。 */
const REPETITION_WHITELIST: ReadonlySet<string> = new Set([
  '看看',
  '想想',
  '说说',
  '试试',
  '聊聊',
  '走走',
  '坐坐',
  '慢慢',
  '常常',
  '刚刚',
  '妈妈',
  '爸爸',
  '谢谢',
  '再见',
  '一点点',
  '一些些',
  '好好',
  '多多',
  '少少',
  '轻轻',
  '静静',
  '深深',
]);

function overlaps(claimed: readonly Span[], start: number, end: number): boolean {
  for (const span of claimed) {
    if (start < span.end && span.start < end) return true;
  }
  return false;
}

function claimMatches(
  pattern: RegExp,
  text: string,
  claimed: Span[],
  kind: RealismEventKind,
  counts: Record<RealismEventKind, number>,
  accept?: (match: RegExpMatchArray) => boolean,
): void {
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    const end = start + match[0].length;
    if (start === end || overlaps(claimed, start, end)) continue;
    if (accept && !accept(match)) continue;
    claimed.push({ start, end });
    counts[kind] += 1;
  }
}

function countSentences(text: string): number {
  return text
    .split(/[。！？!?]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0).length;
}

function countClauses(text: string): number {
  return text
    .split(/[，,；;]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0).length;
}

function visibleLength(text: string): number {
  return text.replaceAll(/\s+/g, '').length;
}

const FRAGMENT_MARKERS = ['……', '...', '…', '——'] as const;

/** 戒备挡回的软信号词：只是观察 prompt 引导是否生效，不参与重试。 */
const DEFLECTION_MARKERS = ['不想说', '不太想说', '先不说', '换个话题', '还没准备好', '以后再说', '这个……'] as const;

function hasDeflectionMarker(text: string): boolean {
  return DEFLECTION_MARKERS.some((marker) => text.includes(marker));
}

function trailingFragmentMarker(text: string): string | undefined {
  const trimmed = text.trim();
  return FRAGMENT_MARKERS.find((marker) => trimmed.endsWith(marker));
}

/**
 * 统计六类文字层口语事件。
 *
 * 与 Phase3 度量保持同一优先级：repair > trailoff > repetition > elongation > pause > filler，
 * 一个文本位置只归一类，避免同一处标点被重复计数。
 */
export function countRealismEvents(text: string): {
  readonly counts: Readonly<Record<RealismEventKind, number>>;
  readonly totalEvents: number;
} {
  const counts: Record<RealismEventKind, number> = { ...EMPTY_COUNTS };
  const claimed: Span[] = [];
  const trimmed = text.trim();

  // ① repair：严格改口标记；不把疑问「是不是」和普通否定算进来。
  claimMatches(/不对[，,]\s*我是说|我是说|应该是|换个说法|不是[，,]\s*(?:我是说|而是)|不是.{0,10}而是/g, text, claimed, 'repair', counts);

  // ② trailoff：句尾留下省略号 / 破折号 / 英文省略点。
  const tail = trailingFragmentMarker(trimmed);
  if (tail) {
    claimed.push({ start: trimmed.length - tail.length, end: trimmed.length });
    counts.trailoff += 1;
  }

  // ③ repetition：相邻重复词；白名单（看看 / 慢慢 / 谢谢）不算。
  claimMatches(/([\u4E00-\u9FFF]{1,2})\1/g, text, claimed, 'repetition', counts, (match) => {
    return !REPETITION_WHITELIST.has(match[0]);
  });

  // ④ elongation：一个词后接破折号；整句用破折号留给 pause。
  claimMatches(/([\u4E00-\u9FFF])——/g, text, claimed, 'elongation', counts);

  // ⑤ pause：连续省略号 / 破折号 / 英文省略点，合并为一次停顿。
  claimMatches(/……|…|——|\.{3,}/g, text, claimed, 'pause', counts);

  // ⑥ filler：句首或标点后的短填充词；「那个」只在后面紧跟停顿/标点时才算。
  claimMatches(/(?:^|[，。！？；、…—])\s*[嗯呃唉哎呵](?=[，。！？；、…—]|$)/g, text, claimed, 'filler', counts);
  claimMatches(/(?:^|[，。！？；、…—])\s*(那个)(?=[，。…—])/g, text, claimed, 'filler', counts);

  return {
    counts,
    totalEvents: Object.values(counts).reduce((sum, value) => sum + value, 0),
  };
}

function isShortAnswerTooLong(trimmed: string): boolean {
  return countSentences(trimmed) > 2 || countClauses(trimmed) > 4 || visibleLength(trimmed) > 100;
}

function isTextTooLong(trimmed: string): boolean {
  return countSentences(trimmed) > 3 || visibleLength(trimmed) > 140;
}

function isFragmentTooLong(trimmed: string): boolean {
  return visibleLength(trimmed) > 100;
}

function hasQuestionMark(trimmed: string): boolean {
  return trimmed.includes('？') || trimmed.includes('?');
}

function collectShapeViolations(
  trimmed: string,
  shape: VisitorTurnShape,
  counts: Readonly<Record<RealismEventKind, number>>,
): RealismViolation[] {
  const reasons: RealismViolation[] = [];

  switch (shape) {
    case 'short_answer_then_silence':
      if (isShortAnswerTooLong(trimmed)) reasons.push('too_long');
      break;
    case 'fragment_then_stop':
      if (isFragmentTooLong(trimmed)) reasons.push('too_long');
      break;
    case 'text_short':
      if (isTextTooLong(trimmed)) reasons.push('too_long');
      break;
    case 'question_back':
      if (!hasQuestionMark(trimmed)) reasons.push('missing_question_back');
      break;
    case 'correct_self_mid_sentence':
      if (counts.repair < 1) reasons.push('missing_repair');
      break;
    default:
      break;
  }

  // 全局上限：超过三句或明显长段，已经不符合"来访者一次说一到三句"的硬规则。
  if (countSentences(trimmed) > 3 || visibleLength(trimmed) > 260) reasons.push('too_long');
  return reasons;
}

function collectQuotaViolations(
  counts: Readonly<Record<RealismEventKind, number>>,
  totalEvents: number,
  plan: RealismEventPlan,
): RealismViolation[] {
  const reasons: RealismViolation[] = [];
  if (totalEvents > plan.maxEvents) reasons.push('over_quota');
  for (const option of plan.options) {
    if (counts[option.kind] > option.maxCount) reasons.push('over_quota');
  }
  return reasons;
}

/**
 * 软信号：话轮形态是“可选建议”，不是逐字合同。
 * 这里只记录疑似未遵循，供批次观察；不触发重试，避免机械逼出假台词。
 */
function collectShapeSignals(trimmed: string, shape: VisitorTurnShape): RealismSignal[] {
  if (shape === 'guarded_deflection' && !hasDeflectionMarker(trimmed)) return ['missing_deflection'];
  return [];
}

/**
 * 审计一段来访者台词是否明显违背本轮话轮形态 / 配额。
 *
 * 只审计明确可判的违约；concrete_detail / emotional_detail / indirect_barb 这类
 * 需要语义判断的形态不在此列，避免误伤。
 */
export function inspectVisitorRealism(text: string, profile: RealismAuditProfile, plan: RealismEventPlan): RealismAuditResult {
  const trimmed = text.trim();
  const { counts, totalEvents } = countRealismEvents(trimmed);

  if (trimmed.length === 0 || profile.state === 'risk') {
    return { ok: true, reasons: [], signals: [], counts, totalEvents };
  }

  const reasons = [...collectShapeViolations(trimmed, profile.shape, counts), ...collectQuotaViolations(counts, totalEvents, plan)];

  return {
    ok: reasons.length === 0,
    reasons: [...new Set(reasons)],
    signals: collectShapeSignals(trimmed, profile.shape),
    counts,
    totalEvents,
  };
}

/**
 * 把违约转成重试时追加的一句要求。
 *
 * @param reasons 违约类型
 * @param plan 事件计划
 * @param shape 话轮形态
 * @returns 重试要求；无违约返回空串
 */
export function buildRealismRetryInstruction(
  reasons: readonly RealismViolation[],
  plan: RealismEventPlan,
  shape: VisitorTurnShape,
): string {
  if (reasons.length === 0) return '';
  const lines = ['上一版太像写好的台词，或者超出了这一轮的说话形态。按下面的要求重说一次，只输出来访者这一轮说的话，不要解释。'];
  for (const reason of reasons) {
    switch (reason) {
      case 'too_long':
        lines.push(shape === 'text_short' ? '最多三句，像文字咨询里的短消息。' : '最多两句，能短就短，不要铺开解释。');
        break;
      case 'missing_question_back':
        lines.push('这一轮把问题轻轻抛回去一次，只一次，不要盘问对方。');
        break;
      case 'missing_repair':
        lines.push('这一轮必须自然改一次口，例如「不对，我是说……」，不要用书面连接词。');
        break;
      case 'over_quota':
        lines.push(`不流利痕迹超了，六类合计控制在 ${plan.maxEvents} 处以内；没有自然发生的地方就删掉。`);
        break;
      default:
        break;
    }
  }
  return lines.join('\n');
}
