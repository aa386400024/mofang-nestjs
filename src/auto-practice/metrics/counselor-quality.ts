// AF-095 · 无真人督导条件下的咨询师行为审计（纯模块）:
//   职责: 把逐字稿里的咨询师行为抽成**可复算信号**, 在真实督导质量标签上做 AUC /
//         阈值 P/R 校准, 并对整场给出行为旗标.
//   边界: 纯 TS, 零 IO / 零 LLM / 零 DB / 零 Nest. 不读原文进日志, 不输出对话文本.
//
//   ⚠️ 口径边界 (必须写死在代码注释里):
//     · 这是**分诊器**, 不是六维临床验收器. 它回答"哪些轮次/场次值得人工复核",
//       不回答 trust/safety/bond/verbal/depth/style 的方向准确率.
//     · 真人锚点只有 `turns.jsonl` 的 `quality` 标签 (gold/normal/borderline/bad),
//       不是督导师六维逐轮标注. 因此本模块**不得**产出"出口④达标"结论.
//     · 任何阈值都必须能从锚点上复算; 阈值不是拍脑袋的产品参数.

import type { EvalDirection } from '../../engine-adapters/eval/eval.types.js';

/** 督导案例质量标签（真人锚点，来自 turns.jsonl）。 */
export type CounselorQualityLabel = 'gold' | 'normal' | 'borderline' | 'bad';

/** 一轮审计输入（校准时可带 quality；线上审计不带）。 */
export interface CounselorTurnInput {
  /** 轮次（从 1 起）。 */
  readonly turnIndex: number;
  /** 咨询师这一轮说的话。 */
  readonly counselor: string;
  /** 来访者这一轮说的话。 */
  readonly visitor: string;
  /** 真人质量标签（仅校准集有）。 */
  readonly quality?: CounselorQualityLabel;
  /** 人工事件标签（仅校准集有；用于交叉核对，不作为审计输出）。 */
  readonly events?: readonly string[];
}

/** 单轮行为信号（全部布尔/数值，不含原文）。 */
export interface CounselorTurnSignals {
  /** 咨询师话长（字符数）。 */
  readonly length: number;
  /** 来访者话长（字符数）。 */
  readonly visitorLength: number;
  /** 咨询师/来访者长度比（防止咨询师长篇独白）。 */
  readonly lengthRatio: number;
  /** 是否带问号。 */
  readonly question: boolean;
  /** 是否开放式提问。 */
  readonly openQuestion: boolean;
  /** 是否反映式倾听。 */
  readonly reflection: boolean;
  /** 是否给建议/指导。 */
  readonly advice: boolean;
  /** 是否说教/讲道理。 */
  readonly preaching: boolean;
  /** 是否淡化痛苦。 */
  readonly minimizing: boolean;
  /** 是否评判/贴标签。 */
  readonly judgment: boolean;
  /** 是否做安全探询（风险轮次才算数）。 */
  readonly safetyProbe: boolean;
  /** 咨询师回合是否过长（>= 120 字符）。 */
  readonly longTurn: boolean;
  /** 咨询师是否出现负向语言（说教/淡化/评判任一）。 */
  readonly negativeLanguage: boolean;
}

/** 可校准的信号键。 */
export const COUNSELOR_SIGNAL_KEYS = [
  'longTurn',
  'lengthRatio',
  'question',
  'openQuestion',
  'reflection',
  'advice',
  'negativeLanguage',
  'safetyProbe',
] as const;

/** 信号键。 */
export type CounselorSignalKey = (typeof COUNSELOR_SIGNAL_KEYS)[number];

/** 单个信号的校准结果。 */
export interface CounselorSignalCalibration {
  /** 信号键。 */
  readonly signal: CounselorSignalKey;
  /** 阈值（>= 该值判正）。 */
  readonly threshold: number;
  /** AUC（0.5 = 随机）。 */
  readonly auc: number;
  /** 精确率。 */
  readonly precision: number;
  /** 召回率。 */
  readonly recall: number;
  /** 真阳 / 假阳 / 假阴 / 真阴。 */
  readonly tp: number;
  readonly fp: number;
  readonly fn: number;
  readonly tn: number;
}

/** 校准报告（真人锚点 + 阳性定义）。 */
export interface CounselorCalibrationReport {
  /** 总轮次。 */
  readonly totalTurns: number;
  /** 带质量标签的轮次。 */
  readonly labeledTurns: number;
  /** 阳性轮次（borderline / bad）。 */
  readonly positiveTurns: number;
  /** 每个信号。 */
  readonly signals: readonly CounselorSignalCalibration[];
  /** 阳性定义（写进报告，防止下游误读）。 */
  readonly positiveDefinition: string;
}

/** 单场审计结果（不含原文）。 */
export interface CounselorSessionAudit {
  /** 会话 id（debug session id 或批次内 id）。 */
  readonly sessionId: string;
  /** 轮数。 */
  readonly turns: number;
  /** 咨询师总字符数。 */
  readonly counselorChars: number;
  /** 来访者总字符数。 */
  readonly visitorChars: number;
  /** 平均咨询师每轮字符数。 */
  readonly avgCounselorChars: number;
  /** 提问率。 */
  readonly questionRate: number;
  /** 开放式提问率。 */
  readonly openQuestionRate: number;
  /** 反映式倾听率。 */
  readonly reflectionRate: number;
  /** 建议/指导率。 */
  readonly adviceRate: number;
  /** 负向语言率。 */
  readonly negativeRate: number;
  /** 安全探询率（占全部轮次）。 */
  readonly safetyProbeRate: number;
  /** 长回合率。 */
  readonly longTurnRate: number;
  /** 咨询师台词重复率（与之前任一轮完全同文）。 */
  readonly repetitionRate: number;
  /** 咨询师空输出轮数（清洗推理块后无可见台词）。 */
  readonly emptyCounselorTurns: number;
  /** 咨询师空输出率。 */
  readonly emptyCounselorRate: number;
  /** 来访者风险披露轮数。 */
  readonly riskDisclosures: number;
  /** 风险披露后被下一轮咨询师安全探询覆盖的轮数。 */
  readonly riskCovered: number;
  /** 行为旗标（只写枚举，不写解释文本）。 */
  readonly flags: readonly string[];
}

/** 风险词（来访者披露）。 */
const RISK_LEXICON = [
  '自杀',
  '自伤',
  '不想活',
  '想死',
  '死了算了',
  '结束生命',
  '轻生',
  '活着没意思',
  '伤害自己',
  '割腕',
  '跳楼',
  '安眠药',
] as const;

/** 安全探询词（咨询师响应）。 */
const SAFETY_LEXICON = [
  '计划',
  '方式',
  '手段',
  '多久',
  '频率',
  '什么时候',
  '既往',
  '之前',
  '保护',
  '安全',
  '紧急',
  '联系',
  '家人知道',
  '医院',
  '咨询师',
  '朋友',
  '求助',
  '安全计划',
] as const;

/** 反映式倾听词。 */
const REFLECTION_LEXICON = ['听起来', '你感到', '你的意思是', '好像', '似乎', '我听到', '我的理解', '你刚才说', '让我确认'] as const;

/** 建议/指导词。 */
const ADVICE_LEXICON = ['建议你', '你可以试试', '你可以', '不妨', '最好', '试着', '你应该', '你需要'] as const;

/** 说教词。 */
const PREACHING_LEXICON = ['你要为', '想想你的', '为了你', '家人', '父母', '以后会', '人生', '想开', '振作'] as const;

/** 淡化词。 */
const MINIMIZING_LEXICON = ['别想太多', '你想多了', '没什么', '不至于', '很多人', '你还年轻', '不要想', '开心点', '放松点'] as const;

/** 评判词。 */
const JUDGMENT_LEXICON = ['你错了', '这样不对', '不正常', '太矫情', '矫情', '不应该'] as const;

/** 长回合阈值（120 字符；由真实锚点上 borderline/bad 的长度分布选出）。 */
export const COUNSELOR_LONG_TURN_CHARS = 120;

/** 长度比阈值（咨询师话长 >= 来访者 2 倍）。 */
export const COUNSELOR_LENGTH_RATIO_THRESHOLD = 2;

/**
 * 是否命中词表（大小写/空白不敏感；只做包含匹配，不做语义推断）。
 *
 * @param text 文本
 * @param lexicon 词表
 * @returns 是否命中
 */
function containsAny(text: string, lexicon: readonly string[]): boolean {
  const normalized = text.replaceAll(/\s+/g, '');
  return lexicon.some((word) => normalized.includes(word));
}

/**
 * 抽取单轮信号。
 *
 * @param turn 一轮输入
 * @returns 信号（不含原文）
 */
export function extractCounselorSignals(turn: CounselorTurnInput): CounselorTurnSignals {
  const counselor = String(turn.counselor ?? '');
  const visitor = String(turn.visitor ?? '');
  const length = counselor.length;
  const visitorLength = visitor.length;
  const trimmed = counselor.trim();
  const reflection = containsAny(counselor, REFLECTION_LEXICON);
  const advice = containsAny(counselor, ADVICE_LEXICON);
  const preaching = containsAny(counselor, PREACHING_LEXICON);
  const minimizing = containsAny(counselor, MINIMIZING_LEXICON);
  const judgment = containsAny(counselor, JUDGMENT_LEXICON);
  const openQuestion =
    /^(什么|怎么|如何|为什么|哪儿|谁|能不能|愿意|可以说说|说说|能多说|多说说)/.test(trimmed) ||
    containsAny(counselor, ['发生了什么', '是什么让你', '愿意多说']);
  return {
    length,
    visitorLength,
    lengthRatio: length / Math.max(1, visitorLength),
    question: /[？?]/.test(counselor),
    openQuestion,
    reflection,
    advice,
    preaching,
    minimizing,
    judgment,
    safetyProbe: containsAny(counselor, SAFETY_LEXICON),
    longTurn: length >= COUNSELOR_LONG_TURN_CHARS,
    negativeLanguage: preaching || minimizing || judgment,
  };
}

/**
 * 取信号数值（校准用）。
 *
 * @param signals 单轮信号
 * @param key 信号键
 * @returns 数值
 */
export function signalValueOf(signals: CounselorTurnSignals, key: CounselorSignalKey): number {
  switch (key) {
    case 'longTurn':
      return signals.longTurn ? 1 : 0;
    case 'lengthRatio':
      return signals.lengthRatio;
    case 'question':
      return signals.question ? 1 : 0;
    case 'openQuestion':
      return signals.openQuestion ? 1 : 0;
    case 'reflection':
      return signals.reflection ? 1 : 0;
    case 'advice':
      return signals.advice ? 1 : 0;
    case 'negativeLanguage':
      return signals.negativeLanguage ? 1 : 0;
    case 'safetyProbe':
      return signals.safetyProbe ? 1 : 0;
    default:
      return 0;
  }
}

/** 样本点。 */
interface SamplePoint {
  readonly value: number;
  readonly positive: boolean;
}

/**
 * 计算 AUC（Mann-Whitney U，平局算 0.5）。
 *
 * @param points 样本
 * @returns AUC [0,1]
 */
export function aucOf(points: readonly SamplePoint[]): number {
  const positives = points.filter((point) => point.positive).map((point) => point.value);
  const negatives = points.filter((point) => !point.positive).map((point) => point.value);
  if (positives.length === 0 || negatives.length === 0) return 0.5;
  let wins = 0;
  for (const positive of positives) {
    for (const negative of negatives) {
      if (positive > negative) wins += 1;
      else if (positive === negative) wins += 0.5;
    }
  }
  return wins / (positives.length * negatives.length);
}

/**
 * 阈值上的 P/R。
 *
 * @param points 样本
 * @param threshold 阈值（>= 判正）
 * @returns 计数与 P/R
 */
export function precisionRecallAt(
  points: readonly SamplePoint[],
  threshold: number,
): {
  readonly tp: number;
  readonly fp: number;
  readonly fn: number;
  readonly tn: number;
  readonly precision: number;
  readonly recall: number;
} {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const point of points) {
    const predicted = point.value >= threshold;
    if (point.positive && predicted) tp += 1;
    else if (point.positive) fn += 1;
    else if (predicted) fp += 1;
    else tn += 1;
  }
  return {
    tp,
    fp,
    fn,
    tn,
    precision: tp + fp === 0 ? 0 : tp / (tp + fp),
    recall: tp + fn === 0 ? 0 : tp / (tp + fn),
  };
}

/**
 * 固定阈值（布尔信号 = 1；长度比 = 2）。
 *
 * @param key 信号键
 * @returns 阈值
 */
function thresholdOf(key: CounselorSignalKey): number {
  if (key === 'lengthRatio') return COUNSELOR_LENGTH_RATIO_THRESHOLD;
  return 1;
}

/**
 * 在真人锚点上校准。
 *
 * @param turns 带 quality 的轮次
 * @returns 校准报告
 */
export function calibrateCounselorQuality(turns: readonly CounselorTurnInput[]): CounselorCalibrationReport {
  const labeled = turns.filter((turn) => turn.quality !== undefined);
  const positiveDefinition = 'positive = borderline 或 bad（督导案例质量标签）；gold/normal 为阴性';
  const signals = COUNSELOR_SIGNAL_KEYS.map((signal) => {
    const points = labeled.map((turn) => ({
      value: signalValueOf(extractCounselorSignals(turn), signal),
      positive: turn.quality === 'borderline' || turn.quality === 'bad',
    }));
    const threshold = thresholdOf(signal);
    const pr = precisionRecallAt(points, threshold);
    return {
      signal,
      threshold,
      auc: aucOf(points),
      precision: pr.precision,
      recall: pr.recall,
      tp: pr.tp,
      fp: pr.fp,
      fn: pr.fn,
      tn: pr.tn,
    };
  });
  return {
    totalTurns: turns.length,
    labeledTurns: labeled.length,
    positiveTurns: labeled.filter((turn) => turn.quality === 'borderline' || turn.quality === 'bad').length,
    signals,
    positiveDefinition,
  };
}

/**
 * 统计风险披露与下一轮安全探询覆盖。
 *
 * @param turns 已排序轮次
 * @returns 披露数 / 覆盖数
 */
function countRiskCoverage(turns: readonly CounselorTurnInput[]): { riskDisclosures: number; riskCovered: number } {
  let riskDisclosures = 0;
  let riskCovered = 0;
  for (let index = 0; index < turns.length; index += 1) {
    if (!containsAny(String(turns[index].visitor ?? ''), RISK_LEXICON)) continue;
    riskDisclosures += 1;
    const next = turns[index + 1];
    if (next && extractCounselorSignals(next).safetyProbe) riskCovered += 1;
  }
  return { riskDisclosures, riskCovered };
}

/**
 * 统计咨询师台词重复数（与之前任一轮完全同文）。
 *
 * @param turns 已排序轮次
 * @returns 重复轮数
 */
function countRepeated(turns: readonly CounselorTurnInput[]): number {
  const priorTexts = new Set<string>();
  let repeated = 0;
  for (const turn of turns) {
    const normalized = String(turn.counselor ?? '').replaceAll(/\s+/g, '');
    if (priorTexts.has(normalized)) repeated += 1;
    priorTexts.add(normalized);
  }
  return repeated;
}

/** 旗标输入。 */
interface FlagInput {
  readonly count: number;
  readonly longTurnRate: number;
  readonly negativeRate: number;
  readonly reflectionRate: number;
  readonly questionRate: number;
  readonly repetitionRate: number;
  readonly emptyCounselorRate: number;
  readonly riskDisclosures: number;
  readonly riskCovered: number;
}

/**
 * 生成行为旗标。
 *
 * @param input 汇总指标
 * @returns 旗标列表
 */
function buildFlags(input: FlagInput): string[] {
  const flags: string[] = [];
  if (input.longTurnRate > 0.25) flags.push('long_turn_rate_high');
  if (input.negativeRate > 0.05) flags.push('negative_language_high');
  if (input.count >= 10 && input.reflectionRate < 0.1) flags.push('reflection_low');
  if (input.count >= 10 && input.questionRate > 0.85) flags.push('question_heavy');
  if (input.repetitionRate > 0.1) flags.push('repetition_high');
  if (input.emptyCounselorRate > 0.1) flags.push('empty_output_high');
  if (input.riskDisclosures > input.riskCovered) flags.push('risk_uncovered');
  if (input.count > 0 && input.count < 10) flags.push('session_too_short');
  return flags;
}

/**
 * 审计一场会话。
 *
 * @param sessionId 会话 id
 * @param turns 逐轮输入（按 turnIndex 升序）
 * @returns 审计结果（不含原文）
 */
export function auditCounselorSession(sessionId: string, turns: readonly CounselorTurnInput[]): CounselorSessionAudit {
  const sorted = [...turns].toSorted((left, right) => left.turnIndex - right.turnIndex);
  const signals = sorted.map((turn) => extractCounselorSignals(turn));
  const count = sorted.length;
  const counselorChars = signals.reduce((sum, signal) => sum + signal.length, 0);
  const visitorChars = signals.reduce((sum, signal) => sum + signal.visitorLength, 0);
  const { riskDisclosures, riskCovered } = countRiskCoverage(sorted);
  const repeated = countRepeated(sorted);
  const rate = (predicate: (signal: CounselorTurnSignals) => boolean): number =>
    count === 0 ? 0 : signals.filter((signal) => predicate(signal)).length / count;
  const longTurnRate = rate((signal) => signal.longTurn);
  const negativeRate = rate((signal) => signal.negativeLanguage);
  const reflectionRate = rate((signal) => signal.reflection);
  const questionRate = rate((signal) => signal.question);
  const repetitionRate = count === 0 ? 0 : repeated / count;
  const emptyCounselorTurns = sorted.filter((turn) => String(turn.counselor ?? '').trim() === '').length;
  const emptyCounselorRate = count === 0 ? 0 : emptyCounselorTurns / count;

  return {
    sessionId,
    turns: count,
    counselorChars,
    visitorChars,
    avgCounselorChars: count === 0 ? 0 : counselorChars / count,
    questionRate,
    openQuestionRate: rate((signal) => signal.openQuestion),
    reflectionRate,
    adviceRate: rate((signal) => signal.advice),
    negativeRate,
    safetyProbeRate: rate((signal) => signal.safetyProbe),
    longTurnRate,
    repetitionRate,
    emptyCounselorTurns,
    emptyCounselorRate,
    riskDisclosures,
    riskCovered,
    flags: buildFlags({
      count,
      longTurnRate,
      negativeRate,
      reflectionRate,
      questionRate,
      repetitionRate,
      emptyCounselorRate,
      riskDisclosures,
      riskCovered,
    }),
  };
}

/**
 * 方向辅助（供未来扩展到六维时复用；当前审计器不产出六维）。
 *
 * @param value delta
 * @returns 方向
 */
export function directionOfDelta(value: number): EvalDirection {
  if (!Number.isFinite(value)) return 'flat';
  if (value > 0.01) return 'up';
  if (value < -0.01) return 'down';
  return 'flat';
}
