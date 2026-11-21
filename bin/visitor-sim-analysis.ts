// V2026-11-22 建立 (AF-232 · 来访者模拟器影子对照分析):
//   职责: 纯函数统计来访者生成质量、过度配合、延迟与盲评一致性.
//   边界: 不联网、不写文件、不输出任何台词原文.

import {
  REALISM_DIMENSIONS,
  summarizeRealismAgreement,
  type RealismAgreement,
  type RealismDimension,
} from '../src/auto-practice/metrics/visitor-realism-rating.js';

export type SimProvider = 'minimax' | 'doubao';
export type SimPromptVariant = 'shared' | 'seed-v1' | 'seed-v2';
export type SimDifficulty = 'L1' | 'L2' | 'L3';

export interface SimTurnRecord {
  readonly turnIndex: number;
  readonly counselor: string;
  readonly visitor: string;
  /** 未投影的原始来访者输出；用于统计括号动作等“不可朗读”缺陷. */
  readonly visitorRaw?: string;
  readonly firstTokenMs: number;
  readonly totalMs: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly reasoningTokens: number;
  readonly finishReason: string;
}

export interface SimSessionRecord {
  readonly sessionId: string;
  readonly arm: string;
  readonly provider: SimProvider;
  readonly model: string;
  readonly promptVariant: SimPromptVariant;
  readonly personaId: string;
  readonly personaLabel: string;
  readonly difficulty: SimDifficulty;
  readonly scene: 'in_person' | 'online_voice' | 'online_text';
  readonly turns: readonly SimTurnRecord[];
}

export interface SimObjectiveMetrics {
  readonly sessions: number;
  readonly turns: number;
  readonly aiRevealCount: number;
  readonly adviceCount: number;
  readonly summaryCount: number;
  readonly plotCount: number;
  readonly stageDirectionCount: number;
  readonly rawStageDirectionCount: number;
  readonly personaConflictCount: number;
  readonly longTurnCount: number;
  readonly veryLongTurnCount: number;
  readonly questionTurnCount: number;
  readonly shortTurnCount: number;
  readonly avoidanceTurnCount: number;
  readonly tagErrorCount: number;
  readonly duplicateTurnCount: number;
  readonly truncationCount: number;
  readonly aiRevealRate: number;
  readonly longTurnRate: number;
  readonly veryLongTurnRate: number;
  readonly questionRate: number;
  readonly stageDirectionRate: number;
  readonly rawStageDirectionRate: number;
  readonly shortTurnRate: number;
  readonly avoidanceRate: number;
  readonly tagErrorRate: number;
  readonly duplicateTurnRate: number;
  readonly truncationRate: number;
  readonly cooperationIndex: number;
  readonly meanVisibleChars: number;
  readonly visibleCharsStd: number;
  readonly firstTokenP50Ms: number;
  readonly firstTokenP95Ms: number;
  readonly totalP50Ms: number;
  readonly totalP95Ms: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly reasoningTokens: number;
}

export interface SimDifficultyObjective extends SimObjectiveMetrics {
  readonly difficulty: SimDifficulty;
}

export interface SimArmObjective {
  readonly arm: string;
  readonly provider: SimProvider;
  readonly model: string;
  readonly promptVariant: SimPromptVariant;
  readonly overall: SimObjectiveMetrics;
  readonly byDifficulty: readonly SimDifficultyObjective[];
}

export interface SimRaterScore {
  readonly raterId: 'R1' | 'R2';
  readonly provider: SimProvider;
  readonly model: string;
  readonly dimensions: Readonly<Record<RealismDimension, number>>;
  readonly overall: number;
  readonly parseRetries: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly reasoningTokens: number;
}

export interface SimScoredSession {
  readonly sessionId: string;
  readonly arm: string;
  readonly difficulty: SimDifficulty;
  readonly scores: readonly SimRaterScore[];
}

export interface SimArmScores {
  readonly arm: string;
  readonly sessions: number;
  readonly meanOverall: number;
  readonly meanDimensions: Readonly<Record<RealismDimension, number>>;
  readonly scoreStd: number;
  readonly distribution: Readonly<Record<string, number>>;
  readonly fourRate: number;
  readonly agreement: RealismAgreement;
  readonly meanAbsOverallDelta: number;
  readonly dimensionAgreement: Readonly<Record<RealismDimension, RealismAgreement>>;
}

export interface SimGateResult {
  readonly id: string;
  readonly kind: 'hard' | 'soft';
  readonly arm: string;
  readonly passed: boolean;
  readonly observed: string;
  readonly threshold: string;
}

export interface SimVerdict {
  readonly arm: string;
  readonly hardPassed: boolean;
  readonly softPassed: boolean;
  readonly hardFailures: readonly string[];
  readonly softFailures: readonly string[];
  readonly recommendation: 'pass' | 'conditional' | 'fail';
}

const AI_REVEAL_PATTERNS: readonly RegExp[] = [
  /(?:^|\W)AI(?:$|\W)/iu,
  /人工智能/u,
  /语言模型/u,
  /大模型/u,
  /模型设定/u,
  /机器人/u,
  /提示词/u,
  /系统设定/u,
  /扮演/u,
  /生成/u,
];

const ADVICE_PATTERNS: readonly RegExp[] = [/你应该/u, /建议你/u, /你可以试着/u, /你可以试试/u, /你需要/u, /不如你/u, /最好你/u, /试试看/u];

const SUMMARY_PATTERNS: readonly RegExp[] = [/你刚才说/u, /你前面说/u, /听起来你/u, /我总结一下/u, /你的意思是/u];

const PLOT_PATTERNS: readonly RegExp[] = [/^[（(*]/u, /突然，/u, /接着，/u, /于是，/u, /镜头/u, /旁白/u, /舞台/u];

const AVOIDANCE_PATTERNS: readonly RegExp[] = [/不知道/u, /还行/u, /没什么/u, /没事/u, /不想说/u, /说不清/u, /嗯/u, /\.\.\./u];
const STAGE_DIRECTION_PATTERN = /(?:^|[\s])(?:（[^）]{1,30}）|\([^)]{1,30}\)|【[^】]{1,30}】|\*[^*]{1,30}\*)/u;

const TAG_PATTERN = /\[[^\]]{1,40}\]/gu;
const LEGAL_TAGS = new Set(['[sigh]', '[breath]', '[laugh]', '[emm]']);
const PAUSE_TAG = /^\[pause:\d+(?:\.\d+)?\]$/u;
const EMOTION_TAG = /^\[emotion:(?:happy|sad|angry|fearful|disgusted|surprised|calm)\]$/u;

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function std(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const avg = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - avg) ** 2)));
}

/** 去掉思考块、外层引号与角色前缀，只留可评的台词. */
export function sanitizeVisitorText(raw: string): string {
  let text = raw.replaceAll(/<think>[\s\S]*?<\/think>/giu, '').trim();
  text = text.replace(/^(?:来访者|来访|visitor|assistant)\s*[:：]\s*/iu, '');
  text = text.replace(/^["“]([\s\S]*?)["”]$/u, '$1').trim();
  return text;
}

/** 可见字数（不计语义标记）. */
export function visibleLength(text: string): number {
  return text.replaceAll(TAG_PATTERN, '').replaceAll(/\s+/gu, '').length;
}

/**
 * 语音投影：把 screenplay 风格的括号动作 / 星号动作剥掉，只留可朗读台词.
 *
 * Seed Character 在情绪高点或沉默轮会写“（低头）”“（沉默片刻）”等舞台说明；
 * 这类文本进 TTS 会被念出来，必须在进入对练前确定性投影，而不是指望 prompt 完全约束.
 */
export function projectVisitorSpeech(raw: string): string {
  const sanitized = sanitizeVisitorText(raw);
  const projected = sanitized
    .replaceAll(/（[^）]{1,80}）/gu, '')
    .replaceAll(/\([^)]{1,80}\)/gu, '')
    .replaceAll(/【[^】]{1,80}】/gu, '')
    .replaceAll(/\*[^*]{1,80}\*/gu, '')
    .trim();
  if (visibleLength(projected) === 0) return /…|\.{2,}/u.test(sanitized) ? '……' : '[pause:0.5]';
  return projected;
}

/** 提取并校验语义标记；返回非法标记列表. */
export function invalidSemanticTags(text: string): readonly string[] {
  const tags = text.match(TAG_PATTERN) ?? [];
  return tags.filter((tag) => !LEGAL_TAGS.has(tag) && !PAUSE_TAG.test(tag) && !EMOTION_TAG.test(tag));
}

/** 粗略检测人设年龄冲突：自报年龄超出模板年龄区间 ±2 岁即算. */
export function hasAgeConflict(text: string, ageRange: string): boolean {
  const match = /(?:我|今年|才)\s*(\d{2})\s*岁/u.exec(text);
  if (match === null) return false;
  const numbers = ageRange.match(/\d+/g)?.map(Number) ?? [];
  if (numbers.length === 0) return false;
  const low = Math.min(...numbers);
  const high = Math.max(...numbers);
  const age = Number(match[1]);
  return age < low - 2 || age > high + 2;
}

function hasAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function duplicateRate(texts: readonly string[]): number {
  if (texts.length === 0) return 0;
  const seen = new Set<string>();
  let duplicates = 0;
  for (const text of texts) {
    const normalized = text.replaceAll(/[^\p{Script=Han}a-zA-Z0-9]/gu, '');
    if (normalized.length === 0) continue;
    if (seen.has(normalized)) duplicates += 1;
    seen.add(normalized);
  }
  return round6(duplicates / texts.length);
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- 单轮指标需要在一个循环内同步累计十多个互斥计数，拆开反而增加状态传递成本
function metricsFor(turns: readonly SimTurnRecord[], ageRange: string): SimObjectiveMetrics {
  const visitorTurns = turns.length;
  let aiRevealCount = 0;
  let adviceCount = 0;
  let summaryCount = 0;
  let plotCount = 0;
  let stageDirectionCount = 0;
  let rawStageDirectionCount = 0;
  let personaConflictCount = 0;
  let longTurnCount = 0;
  let veryLongTurnCount = 0;
  let questionTurnCount = 0;
  let shortTurnCount = 0;
  let avoidanceTurnCount = 0;
  let tagErrorCount = 0;
  let truncationCount = 0;
  const lengths: number[] = [];

  for (const turn of turns) {
    const text = turn.visitor;
    const raw = turn.visitorRaw ?? text;
    const length = visibleLength(text);
    lengths.push(length);
    if (hasAny(text, AI_REVEAL_PATTERNS)) aiRevealCount += 1;
    if (hasAny(text, ADVICE_PATTERNS)) adviceCount += 1;
    if (hasAny(text, SUMMARY_PATTERNS)) summaryCount += 1;
    if (hasAny(text, PLOT_PATTERNS)) plotCount += 1;
    if (STAGE_DIRECTION_PATTERN.test(text)) stageDirectionCount += 1;
    if (STAGE_DIRECTION_PATTERN.test(raw)) rawStageDirectionCount += 1;
    if (hasAgeConflict(text, ageRange)) personaConflictCount += 1;
    if (length > 50) longTurnCount += 1;
    if (length > 80) veryLongTurnCount += 1;
    if (/[？?]/u.test(text)) questionTurnCount += 1;
    if (length <= 12) shortTurnCount += 1;
    if (hasAny(text, AVOIDANCE_PATTERNS)) avoidanceTurnCount += 1;
    tagErrorCount += invalidSemanticTags(text).length;
    if (turn.finishReason === 'length') truncationCount += 1;
  }

  const firstTokens = turns.map((turn) => turn.firstTokenMs);
  const totals = turns.map((turn) => turn.totalMs);
  const cooperationTurns = adviceCount + summaryCount + plotCount + questionTurnCount + longTurnCount;
  return {
    sessions: 1,
    turns: visitorTurns,
    aiRevealCount,
    adviceCount,
    summaryCount,
    plotCount,
    stageDirectionCount,
    rawStageDirectionCount,
    personaConflictCount,
    longTurnCount,
    veryLongTurnCount,
    questionTurnCount,
    shortTurnCount,
    avoidanceTurnCount,
    tagErrorCount,
    duplicateTurnCount: Math.round(duplicateRate(turns.map((turn) => turn.visitor)) * visitorTurns),
    truncationCount,
    aiRevealRate: round6(aiRevealCount / Math.max(1, visitorTurns)),
    longTurnRate: round6(longTurnCount / Math.max(1, visitorTurns)),
    veryLongTurnRate: round6(veryLongTurnCount / Math.max(1, visitorTurns)),
    questionRate: round6(questionTurnCount / Math.max(1, visitorTurns)),
    stageDirectionRate: round6(stageDirectionCount / Math.max(1, visitorTurns)),
    rawStageDirectionRate: round6(rawStageDirectionCount / Math.max(1, visitorTurns)),
    shortTurnRate: round6(shortTurnCount / Math.max(1, visitorTurns)),
    avoidanceRate: round6(avoidanceTurnCount / Math.max(1, visitorTurns)),
    tagErrorRate: round6(tagErrorCount / Math.max(1, visitorTurns)),
    duplicateTurnRate: duplicateRate(turns.map((turn) => turn.visitor)),
    truncationRate: round6(truncationCount / Math.max(1, visitorTurns)),
    cooperationIndex: round6(cooperationTurns / Math.max(1, visitorTurns)),
    meanVisibleChars: round6(mean(lengths)),
    visibleCharsStd: round6(std(lengths)),
    firstTokenP50Ms: percentile(firstTokens, 50),
    firstTokenP95Ms: percentile(firstTokens, 95),
    totalP50Ms: percentile(totals, 50),
    totalP95Ms: percentile(totals, 95),
    promptTokens: turns.reduce((sum, turn) => sum + turn.promptTokens, 0),
    completionTokens: turns.reduce((sum, turn) => sum + turn.completionTokens, 0),
    reasoningTokens: turns.reduce((sum, turn) => sum + turn.reasoningTokens, 0),
  };
}

function mergeMetrics(
  items: readonly SimObjectiveMetrics[],
  turnDurations: readonly Pick<SimTurnRecord, 'firstTokenMs' | 'totalMs'>[] = [],
): SimObjectiveMetrics {
  if (items.length === 0) {
    return metricsFor([], '0-0');
  }
  const sumFields = [
    'sessions',
    'turns',
    'aiRevealCount',
    'adviceCount',
    'summaryCount',
    'plotCount',
    'stageDirectionCount',
    'rawStageDirectionCount',
    'personaConflictCount',
    'longTurnCount',
    'veryLongTurnCount',
    'questionTurnCount',
    'shortTurnCount',
    'avoidanceTurnCount',
    'tagErrorCount',
    'duplicateTurnCount',
    'truncationCount',
    'promptTokens',
    'completionTokens',
    'reasoningTokens',
  ] as const;
  const summed = Object.fromEntries(sumFields.map((field) => [field, items.reduce((sum, item) => sum + item[field], 0)])) as Record<
    (typeof sumFields)[number],
    number
  >;
  const sessions = Number(summed.sessions ?? 0);
  const turns = Number(summed.turns ?? 0);
  const weightedMean = (field: 'meanVisibleChars' | 'visibleCharsStd'): number => round6(mean(items.map((item) => item[field])));
  const firstTokens = turnDurations.map((turn) => turn.firstTokenMs);
  const totalDurations = turnDurations.map((turn) => turn.totalMs);
  const sampleLength = firstTokens.length;
  const p50 = sampleLength > 0 ? Math.round(percentile(firstTokens, 50)) : Math.round(mean(items.map((item) => item.firstTokenP50Ms)));
  const p95 =
    sampleLength > 0 ? Math.round(percentile(firstTokens, 95)) : Math.round(Math.max(...items.map((item) => item.firstTokenP95Ms)));
  const totalP50 = sampleLength > 0 ? Math.round(percentile(totalDurations, 50)) : Math.round(mean(items.map((item) => item.totalP50Ms)));
  const totalP95 =
    sampleLength > 0 ? Math.round(percentile(totalDurations, 95)) : Math.round(Math.max(...items.map((item) => item.totalP95Ms)));
  return {
    ...(summed as unknown as SimObjectiveMetrics),
    sessions,
    turns,
    aiRevealRate: round6(Number(summed.aiRevealCount) / Math.max(1, turns)),
    longTurnRate: round6(Number(summed.longTurnCount) / Math.max(1, turns)),
    veryLongTurnRate: round6(Number(summed.veryLongTurnCount) / Math.max(1, turns)),
    questionRate: round6(Number(summed.questionTurnCount) / Math.max(1, turns)),
    stageDirectionRate: round6(Number(summed.stageDirectionCount) / Math.max(1, turns)),
    rawStageDirectionRate: round6(Number(summed.rawStageDirectionCount) / Math.max(1, turns)),
    shortTurnRate: round6(Number(summed.shortTurnCount) / Math.max(1, turns)),
    avoidanceRate: round6(Number(summed.avoidanceTurnCount) / Math.max(1, turns)),
    tagErrorRate: round6(Number(summed.tagErrorCount) / Math.max(1, turns)),
    duplicateTurnRate: round6(Number(summed.duplicateTurnCount) / Math.max(1, turns)),
    truncationRate: round6(Number(summed.truncationCount) / Math.max(1, turns)),
    cooperationIndex: round6(
      (Number(summed.adviceCount) +
        Number(summed.summaryCount) +
        Number(summed.plotCount) +
        Number(summed.questionTurnCount) +
        Number(summed.longTurnCount)) /
        Math.max(1, turns),
    ),
    meanVisibleChars: weightedMean('meanVisibleChars'),
    visibleCharsStd: weightedMean('visibleCharsStd'),
    firstTokenP50Ms: p50,
    firstTokenP95Ms: p95,
    totalP50Ms: totalP50,
    totalP95Ms: totalP95,
  };
}

/** 汇总一个 arm 的客观指标（总体与分难度）. */
export function analyzeArmObjective(sessions: readonly SimSessionRecord[]): SimArmObjective {
  if (sessions.length === 0) throw new Error('analyzeArmObjective: 空会话');
  const first = sessions[0];
  const perSession = sessions.map((session) => ({
    session,
    metrics: metricsFor(session.turns, ageRangeForPersona(session.personaId)),
  }));
  const overall = mergeMetrics(
    perSession.map((item) => item.metrics),
    perSession.flatMap((item) => item.session.turns),
  );
  const byDifficulty: SimDifficultyObjective[] = (['L1', 'L2', 'L3'] as const).map((difficulty) => {
    const subset = perSession.filter((item) => item.session.difficulty === difficulty);
    return {
      difficulty,
      ...mergeMetrics(
        subset.map((item) => item.metrics),
        subset.flatMap((item) => item.session.turns),
      ),
    };
  });
  return {
    arm: first.arm,
    provider: first.provider,
    model: first.model,
    promptVariant: first.promptVariant,
    overall,
    byDifficulty,
  };
}

/** 年龄区间用于人设冲突检测；由调用方在 session 里带不到时按常见区间兜底. */
function ageRangeForPersona(personaId: string): string {
  if (personaId.includes('self_worth')) return '24-30';
  if (personaId.includes('intimate_avoidance')) return '28-35';
  if (personaId.includes('parenting')) return '38-45';
  if (personaId.includes('grief')) return '46-58';
  return '18-60';
}

/** 汇总一个 arm 的盲评分数. */
export function analyzeArmScores(sessions: readonly SimScoredSession[]): SimArmScores {
  if (sessions.length === 0) throw new Error('analyzeArmScores: 空会话');
  const first = sessions[0];
  const r1 = sessions.map((session) => session.scores.find((score) => score.raterId === 'R1')?.overall ?? 0);
  const r2 = sessions.map((session) => session.scores.find((score) => score.raterId === 'R2')?.overall ?? 0);
  const all = [...r1, ...r2];
  const distribution: Record<string, number> = {};
  for (const score of all) distribution[String(score)] = (distribution[String(score)] ?? 0) + 1;
  const dimensions = Object.fromEntries(
    REALISM_DIMENSIONS.map((dimension) => [
      dimension,
      round6(mean(sessions.flatMap((session) => session.scores.map((score) => score.dimensions[dimension] ?? 0)))),
    ]),
  ) as Record<RealismDimension, number>;
  const dimensionAgreement = Object.fromEntries(
    REALISM_DIMENSIONS.map((dimension) => [
      dimension,
      summarizeRealismAgreement(
        sessions.map((session) => session.scores.find((score) => score.raterId === 'R1')?.dimensions[dimension] ?? 0),
        sessions.map((session) => session.scores.find((score) => score.raterId === 'R2')?.dimensions[dimension] ?? 0),
      ),
    ]),
  ) as Record<RealismDimension, RealismAgreement>;
  return {
    arm: first.arm,
    sessions: sessions.length,
    meanOverall: round6(mean(all)),
    meanDimensions: dimensions,
    scoreStd: round6(std(all)),
    distribution,
    fourRate: round6((distribution['4'] ?? 0) / Math.max(1, all.length)),
    agreement: summarizeRealismAgreement(r1, r2),
    meanAbsOverallDelta: round6(mean(r1.map((score, index) => Math.abs(score - (r2[index] ?? 0))))),
    dimensionAgreement,
  };
}

/** 按预登记门槛判定每个 Seed arm，baseline 为 A. */
export function evaluateGates(input: {
  readonly objectives: readonly SimArmObjective[];
  readonly scores: readonly SimArmScores[];
  readonly baselineArm: string;
  readonly seedArms: readonly string[];
  readonly thinkingDisabled: boolean;
}): { readonly gates: readonly SimGateResult[]; readonly verdicts: readonly SimVerdict[] } {
  const baselineObjective = input.objectives.find((arm) => arm.arm === input.baselineArm);
  if (baselineObjective === undefined) throw new Error(`缺少 baseline arm ${input.baselineArm}`);
  const baselineScore = input.scores.find((arm) => arm.arm === input.baselineArm);
  const gates: SimGateResult[] = [];

  const push = (arm: string, id: string, kind: 'hard' | 'soft', passed: boolean, observed: string, threshold: string): void => {
    gates.push({ id, kind, arm, passed, observed, threshold });
  };

  for (const arm of input.seedArms) {
    const objective = input.objectives.find((item) => item.arm === arm);
    const score = input.scores.find((item) => item.arm === arm);
    if (objective === undefined) {
      push(arm, 'missing-arm', 'hard', false, 'missing', 'arm 存在');
      continue;
    }
    const o = objective.overall;
    push(arm, 'ai-reveal-zero', 'hard', o.aiRevealCount === 0, String(o.aiRevealCount), '= 0');
    push(arm, 'advice-zero', 'hard', o.adviceCount === 0, String(o.adviceCount), '= 0');
    push(arm, 'summary-zero', 'hard', o.summaryCount === 0, String(o.summaryCount), '= 0');
    push(arm, 'plot-zero', 'hard', o.plotCount === 0, String(o.plotCount), '= 0');
    push(arm, 'stage-direction-zero', 'hard', o.stageDirectionCount === 0, String(o.stageDirectionCount), '= 0');
    push(arm, 'persona-conflict-zero', 'hard', o.personaConflictCount === 0, String(o.personaConflictCount), '= 0');
    push(arm, 'long-turn-rate', 'hard', o.longTurnRate < 0.05, String(o.longTurnRate), '< 0.05');
    const baselineL3 = baselineObjective.byDifficulty.find((item) => item.difficulty === 'L3');
    const armL3 = objective.byDifficulty.find((item) => item.difficulty === 'L3');
    const l3Ratio =
      armL3 === undefined || baselineL3 === undefined ? 0 : armL3.shortTurnRate / Math.max(0.000001, baselineL3.shortTurnRate);
    push(arm, 'l3-short-vs-baseline', 'hard', l3Ratio >= 0.8, String(round6(l3Ratio)), '>= 0.8');
    push(arm, 'tag-error-rate', 'hard', o.tagErrorRate < 0.01, String(o.tagErrorRate), '< 0.01');
    if (input.thinkingDisabled) {
      push(arm, 'first-token-p95', 'hard', o.firstTokenP95Ms < 1500, String(o.firstTokenP95Ms), '< 1500ms');
    }
    if (score === undefined) {
      push(arm, 'blind-score-missing', 'hard', false, 'missing', '盲评包可用');
      continue;
    }
    if (baselineScore === undefined) {
      push(arm, 'baseline-score-missing', 'soft', false, 'missing', 'baseline 盲评可用');
      continue;
    }
    push(
      arm,
      'mean-vs-baseline',
      'soft',
      score.meanOverall >= baselineScore.meanOverall - 0.2,
      String(score.meanOverall),
      `>= ${round6(baselineScore.meanOverall - 0.2)}`,
    );
    push(
      arm,
      'cross-rater-kappa',
      'soft',
      (score.agreement.linearWeightedKappa ?? 0) >= 0.4,
      String(score.agreement.linearWeightedKappa ?? 'null'),
      '>= 0.4',
    );
    push(arm, 'mean-abs-delta', 'soft', score.meanAbsOverallDelta <= 0.3, String(score.meanAbsOverallDelta), '<= 0.3');
    push(arm, 'length-std', 'soft', o.visibleCharsStd >= 0.5, String(o.visibleCharsStd), '>= 0.5');
    push(arm, 'four-rate', 'soft', score.fourRate < 0.7, String(score.fourRate), '< 0.7');
    push(
      arm,
      'cooperation-vs-baseline',
      'soft',
      o.cooperationIndex <= baselineObjective.overall.cooperationIndex,
      String(o.cooperationIndex),
      `<= ${baselineObjective.overall.cooperationIndex}`,
    );
  }

  const verdicts = input.seedArms.map((arm) => {
    const armGates = gates.filter((gate) => gate.arm === arm);
    const hardFailures = armGates.filter((gate) => gate.kind === 'hard' && !gate.passed).map((gate) => gate.id);
    const softFailures = armGates.filter((gate) => gate.kind === 'soft' && !gate.passed).map((gate) => gate.id);
    const recommendation: SimVerdict['recommendation'] =
      hardFailures.length > 0 ? 'fail' : softFailures.length > 0 ? 'conditional' : 'pass';
    return {
      arm,
      hardPassed: hardFailures.length === 0,
      softPassed: softFailures.length === 0,
      hardFailures,
      softFailures,
      recommendation,
    };
  });
  return { gates, verdicts };
}
