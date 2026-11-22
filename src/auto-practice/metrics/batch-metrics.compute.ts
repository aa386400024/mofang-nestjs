// V2026-11-11 WP-K (批次指标纯计算):
//   职责: 从合规投影后的场次数据, 确定性地算出指标 map / 分组切片.
//   边界: 纯函数, 零 IO / 零框架 / 零随机. 同输入必须逐字节相同.
//
//   这里消费的 TraceInput 已在服务层做过"合规投影" —— 不含 messages / renderSpec /
//   intention.rationale, 物理上接触不到对话文本.

import type { ConfigFingerprintSegments } from '../config-fingerprint.js';
import type { ZeroMotionBreakdown } from './acceptance-thresholds.js';
import type { BatchMetricsV1, MetricsSlice, SessionLineage, SkipReason } from './batch-metrics.schema.js';
import { aggregateDisfluency, type DisfluencyMetrics } from './disfluency-lexicon.js';
import {
  POSITIVE_EVENTS,
  SESSION_OUTCOMES,
  TRACKED_DIMENSIONS,
  TRACKED_EVENTS,
  TRACKED_STRATEGIES,
  type SessionOutcome,
  type TrackedDimension,
} from './metric-dictionary.js';
import { round6 } from './round.js';

/** 单轮的合规投影 (只含计算所需字段). */
export interface TraceInput {
  readonly turnIndex: number;
  readonly bdiSnapshot: {
    readonly trust: number;
    readonly safety: number;
    readonly bond: number;
    readonly valence: number;
    readonly arousal: number;
    readonly resistanceVerbal: number;
    readonly resistanceDepth: number;
    readonly resistanceStyle: number;
  };
  readonly eventTags: readonly string[];
  readonly strategy: string;
  readonly degraded: boolean;
  /**
   * 文字层不流利的**纯数值**投影 (Phase3 P0).
   *
   * 隐私分层: 台词原文的判读在服务层 (IO 层) 完成, 本层只聚合数字.
   * 本字段物理上不含任何文本引用 —— 只有六类计数 / events / hasEvent / 归一化字符数.
   */
  readonly disfluency: DisfluencyMetrics;
}

/** 一场的计算输入. */
export interface SessionComputationInput {
  readonly debugSessionId: string;
  readonly characterSlug: string;
  readonly counselorModeId: string;
  readonly status: string;
  readonly fileSha256: string;
  readonly traces: readonly TraceInput[];
}

/** 管道健康值 (从 DB 聚合注入, 不在此重算). */
export interface PipelineContext {
  readonly llmCallRatio: number;
  readonly fallbackRatio: number | null;
}

/** 整批计算上下文. */
export interface BatchComputeContext {
  readonly batchId: string;
  readonly transcriptRoot: string;
  readonly fingerprint: ConfigFingerprintSegments;
  readonly pipeline: PipelineContext;
}

/** 被跳过的场次 (用于 coverage). */
export interface SkippedSession {
  readonly debugSessionId: string;
  readonly reason: SkipReason;
}

/** 追踪维度 → 逐字稿扁平快照键 的映射. */
const DIMENSION_SNAPSHOT_KEY: Readonly<Record<TrackedDimension, keyof TraceInput['bdiSnapshot']>> = {
  trust: 'trust',
  safety: 'safety',
  bond: 'bond',
  valence: 'valence',
  arousal: 'arousal',
  verbal: 'resistanceVerbal',
  depth: 'resistanceDepth',
  style: 'resistanceStyle',
};

/**
 * 线性插值百分位 (与 numpy 默认 'linear' 一致).
 *
 * @param sortedAsc 已升序排列的样本
 * @param percentile 0..100
 * @returns 百分位值
 */
function percentile(sortedAsc: readonly number[], percentileValue: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const rank = (percentileValue / 100) * (sortedAsc.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sortedAsc[lower];
  const weight = rank - lower;
  return sortedAsc[lower] * (1 - weight) + sortedAsc[upper] * weight;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

/** 探索策略集合. */
const EXPLORATION_STRATEGIES = new Set(['affective_exploration', 'cognitive_exploration']);

/**
 * 计算一组场次的指标 map (全场与分组切片共用此函数).
 *
 * @param sessions 场次
 * @param pipeline 管道健康
 * @returns 指标 id → 值
 */
function computeDimensionMetrics(sessions: readonly SessionComputationInput[], metrics: Record<string, number | null>): void {
  for (const dim of TRACKED_DIMENSIONS) {
    const key = DIMENSION_SNAPSHOT_KEY[dim];
    const firstValues: number[] = [];
    const lastValues: number[] = [];
    const deltas: number[] = [];
    const perTurn: number[] = [];
    for (const session of sessions) {
      const first = session.traces[0]?.bdiSnapshot[key] ?? 0;
      const last = session.traces.at(-1)?.bdiSnapshot[key] ?? first;
      const delta = last - first;
      firstValues.push(first);
      lastValues.push(last);
      deltas.push(delta);
      perTurn.push(session.traces.length > 0 ? delta / session.traces.length : 0);
    }
    const sortedLast = lastValues.toSorted((a, b) => a - b);
    metrics[`dim.${dim}.first_avg`] = round6(mean(firstValues));
    metrics[`dim.${dim}.last_avg`] = round6(mean(lastValues));
    metrics[`dim.${dim}.delta_avg`] = round6(mean(deltas));
    metrics[`dim.${dim}.per_turn_rate`] = round6(mean(perTurn));
    metrics[`dim.${dim}.p10`] = round6(percentile(sortedLast, 10));
    metrics[`dim.${dim}.p90`] = round6(percentile(sortedLast, 90));
  }
}

function computeEventMetrics(
  sessions: readonly SessionComputationInput[],
  totalTurns: number,
  metrics: Record<string, number | null>,
): void {
  const eventCounts: Record<string, number> = {};
  for (const kind of TRACKED_EVENTS) eventCounts[kind] = 0;
  for (const session of sessions) {
    for (const trace of session.traces) {
      for (const tag of trace.eventTags) {
        if (tag in eventCounts) eventCounts[tag] += 1;
      }
    }
  }
  let positiveEventTurns = 0;
  for (const kind of TRACKED_EVENTS) {
    const count = eventCounts[kind];
    metrics[`event.${kind}.count`] = count;
    metrics[`event.${kind}.rate`] = round6(totalTurns > 0 ? count / totalTurns : 0);
    if ((POSITIVE_EVENTS as readonly string[]).includes(kind)) positiveEventTurns += count;
  }
  metrics['event.positive.rate'] = round6(totalTurns > 0 ? positiveEventTurns / totalTurns : 0);
}

function computeStrategyMetrics(
  sessions: readonly SessionComputationInput[],
  totalTurns: number,
  metrics: Record<string, number | null>,
): void {
  const counts: Record<string, number> = {};
  for (const name of TRACKED_STRATEGIES) counts[name] = 0;
  for (const session of sessions) {
    for (const trace of session.traces) {
      if (trace.strategy in counts) counts[trace.strategy] += 1;
    }
  }
  for (const name of TRACKED_STRATEGIES) {
    const count = counts[name];
    metrics[`strategy.${name}.count`] = count;
    metrics[`strategy.${name}.rate`] = round6(totalTurns > 0 ? count / totalTurns : 0);
  }
}

function isZeroMotion(session: SessionComputationInput): boolean {
  return TRACKED_DIMENSIONS.every((dim) => {
    const key = DIMENSION_SNAPSHOT_KEY[dim];
    const first = session.traces[0]?.bdiSnapshot[key] ?? 0;
    const last = session.traces.at(-1)?.bdiSnapshot[key] ?? first;
    return first === last;
  });
}

/**
 * 判定一场的事件层是否存在**非 neutral** 事件 (I-22 豁免的依据).
 *
 * 数据来源: 逐字稿合规投影里的 traces[].eventTags (只有事件标签, 不含对话原文).
 * 口径: 只要有一轮挂着非 neutral 的事件标签, 该场就算"事件层有动作";
 * 全程只有 neutral (或没有任何事件标签) → 纯 neutral 空转.
 */
function hasNonNeutralEvent(session: SessionComputationInput): boolean {
  for (const trace of session.traces) {
    for (const tag of trace.eventTags) {
      if (tag !== 'neutral') return true;
    }
  }
  return false;
}

/**
 * 零变化场次细分 (I-22): 区分"合理封闭"与"纯 neutral 空转".
 *
 * · total   = 零变化场次总数 (与 session.zero_motion 同值, 同口径);
 * · closure = 其中事件层存在非 neutral 事件的场次 (**合理封闭**, 按任务单口径豁免);
 * · idle    = 其中纯 neutral 空转的场次 (**计入失效**).
 *
 * 逐场判定, 纯函数, 零 IO.
 *
 * @param sessions 场次
 * @returns 细分
 */
function computeZeroMotionBreakdown(sessions: readonly SessionComputationInput[]): ZeroMotionBreakdown {
  let total = 0;
  let closure = 0;
  for (const session of sessions) {
    if (!isZeroMotion(session)) continue;
    total += 1;
    if (hasNonNeutralEvent(session)) closure += 1;
  }
  return { total, closure, idle: total - closure };
}

/**
 * 角色级探索覆盖 (C5-1 · I-16 / I-24).
 *
 * 分子: 至少一场含探索策略的**角色**数; 分母: 本批纳入场次覆盖到的不同角色数.
 * 角色级去重 —— 同一角色跑多场只算一个角色 (分子分母同口径).
 * 空集 (无纳入场次) → 0 (不 null、不抛错).
 *
 * 为什么与 `exploration.rate` 并存: rate 是**场次比例** (含探索的场次 ÷ 场次),
 * 回答"多少场有探索"; coverage 是**角色比例**, 回答"多少角色完全 0 探索" ——
 * I-16 的结构问题 (一人 100% 探索掩盖其余 7 人 0 探索) 只有后者能复算.
 *
 * 纯函数: 只读 `characterSlug` 与 `traces[].strategy` (合规投影字段),
 * 不接触台词 / prompt / kernelState / 展示名.
 */
function computeCharacterExplorationCoverage(sessions: readonly SessionComputationInput[]): number {
  const characters = new Set<string>();
  const exploredCharacters = new Set<string>();
  for (const session of sessions) {
    characters.add(session.characterSlug);
    if (session.traces.some((trace) => EXPLORATION_STRATEGIES.has(trace.strategy))) exploredCharacters.add(session.characterSlug);
  }
  return characters.size > 0 ? exploredCharacters.size / characters.size : 0;
}

function computeSummaryMetrics(
  sessions: readonly SessionComputationInput[],
  pipeline: PipelineContext,
  metrics: Record<string, number | null>,
  zeroMotionBreakdown: ZeroMotionBreakdown,
): void {
  let explorationSessions = 0;
  for (const session of sessions) {
    if (session.traces.some((trace) => EXPLORATION_STRATEGIES.has(trace.strategy))) explorationSessions += 1;
  }
  metrics['exploration.rate'] = round6(sessions.length > 0 ? explorationSessions / sessions.length : 0);
  // C5-1 (I-16 / I-24): 角色级探索覆盖 —— 回答"多少角色完全 0 探索".
  //   与 `exploration.rate` (场次比例) 口径**不同**, 两者并存, 互不替代.
  metrics['exploration.character_coverage'] = round6(computeCharacterExplorationCoverage(sessions));
  metrics['session.zero_motion'] = zeroMotionBreakdown.total;

  const outcomeCounts: Record<string, number> = {};
  for (const outcome of SESSION_OUTCOMES) outcomeCounts[outcome] = 0;
  for (const session of sessions) {
    if (session.status in outcomeCounts) outcomeCounts[session.status] += 1;
  }
  for (const outcome of SESSION_OUTCOMES) {
    metrics[`session.outcome.${outcome}`] = outcomeCounts[outcome];
  }

  metrics['pipeline.llm_call_ratio'] = round6(pipeline.llmCallRatio);
  metrics['pipeline.fallback_ratio'] = pipeline.fallbackRatio === null ? null : round6(pipeline.fallbackRatio);
}

/**
 * 文字层不流利指标 (Phase3 P0) —— 纯数值聚合.
 *
 * 只读 TraceInput.disfluency 的数字; 本层不 import 分析器、不接触任何文本.
 * 口径: 见 metric-dictionary.ts 里 text.disfluency.* 八项的 definition.
 *
 * @param sessions 场次
 * @param metrics 指标 map (原地写入)
 */
function computeDisfluencyMetrics(sessions: readonly SessionComputationInput[], metrics: Record<string, number | null>): void {
  const turns: DisfluencyMetrics[] = [];
  for (const session of sessions) {
    for (const trace of session.traces) turns.push(trace.disfluency);
  }
  const aggregate = aggregateDisfluency(turns);
  const turnCount = turns.length;
  const perTurn = (value: number): number => (turnCount > 0 ? round6(value / turnCount) : 0);
  metrics['text.disfluency.events_per_turn'] = aggregate.eventsPerTurn;
  metrics['text.disfluency.event_turn_rate'] = aggregate.eventTurnRate;
  metrics['text.disfluency.density_per100'] = aggregate.densityPer100Chars;
  metrics['text.disfluency.filler_per_turn'] = perTurn(aggregate.typeCounts.filler);
  metrics['text.disfluency.pause_per_turn'] = perTurn(aggregate.typeCounts.pause);
  metrics['text.disfluency.repair_per_turn'] = perTurn(aggregate.typeCounts.repair);
  metrics['text.disfluency.repetition_per_turn'] = perTurn(aggregate.typeCounts.repetition);
  metrics['text.disfluency.trailoff_per_turn'] = perTurn(aggregate.typeCounts.trailoff);
  // elongation 只计入事件总量, 按蓝图 §5.2.2 不单列 per-turn 指标.
}

function computeMetricMap(
  sessions: readonly SessionComputationInput[],
  pipeline: PipelineContext,
): {
  readonly metrics: Record<string, number | null>;
  readonly zeroMotionBreakdown: ZeroMotionBreakdown;
} {
  const metrics: Record<string, number | null> = {};
  const totalTurns = sessions.reduce((acc, session) => acc + session.traces.length, 0);
  computeDimensionMetrics(sessions, metrics);
  computeEventMetrics(sessions, totalTurns, metrics);
  computeStrategyMetrics(sessions, totalTurns, metrics);
  const zeroMotionBreakdown = computeZeroMotionBreakdown(sessions);
  computeSummaryMetrics(sessions, pipeline, metrics, zeroMotionBreakdown);
  computeDisfluencyMetrics(sessions, metrics);
  return { metrics, zeroMotionBreakdown };
}

/** 构建一个分组切片. */
function buildSlice(sessions: readonly SessionComputationInput[], pipeline: PipelineContext): MetricsSlice {
  const { metrics, zeroMotionBreakdown } = computeMetricMap(sessions, pipeline);
  return {
    sessions: sessions.length,
    turns: sessions.reduce((acc, session) => acc + session.traces.length, 0),
    metrics,
    zeroMotionBreakdown,
  };
}

function groupBy(
  sessions: readonly SessionComputationInput[],
  key: (session: SessionComputationInput) => string,
): Record<string, SessionComputationInput[]> {
  const groups: Record<string, SessionComputationInput[]> = {};
  for (const session of sessions) {
    const groupKey = key(session);
    (groups[groupKey] ??= []).push(session);
  }
  return groups;
}

/**
 * 计算整批快照 v1.
 *
 * @param included 成功纳入的场次
 * @param skipped 被跳过的场次
 * @param expectedCount 期望场次总数
 * @param context 上下文
 * @returns 完整快照
 */
export function computeBatchSnapshot(
  included: readonly SessionComputationInput[],
  skipped: readonly SkippedSession[],
  expectedCount: number,
  context: BatchComputeContext,
): BatchMetricsV1 {
  const skipReasons: Partial<Record<SkipReason, number>> = {};
  for (const item of skipped) {
    skipReasons[item.reason] = (skipReasons[item.reason] ?? 0) + 1;
  }
  const totalTurns = included.reduce((acc, session) => acc + session.traces.length, 0);

  const lineage: SessionLineage[] = included.map((session) => ({
    debugSessionId: session.debugSessionId,
    characterSlug: session.characterSlug,
    counselorModeId: session.counselorModeId,
    turns: session.traces.length,
    fileSha256: session.fileSha256,
  }));

  const byModeGroups = groupBy(included, (session) => session.counselorModeId);
  const byCharacterGroups = groupBy(included, (session) => session.characterSlug);
  const byMode: Record<string, MetricsSlice> = {};
  const byCharacter: Record<string, MetricsSlice> = {};
  for (const [mode, sessions] of Object.entries(byModeGroups)) byMode[mode] = buildSlice(sessions, context.pipeline);
  for (const [character, sessions] of Object.entries(byCharacterGroups)) byCharacter[character] = buildSlice(sessions, context.pipeline);

  const global = computeMetricMap(included, context.pipeline);

  return {
    schemaVersion: 1,
    computedAt: new Date().toISOString(),
    batchId: context.batchId,
    fingerprint: context.fingerprint,
    coverage: {
      expectedSessions: expectedCount,
      includedSessions: included.length,
      skippedSessions: skipped.length,
      skipReasons,
      totalTurns,
      transcriptRoot: context.transcriptRoot,
    },
    lineage,
    metrics: global.metrics,
    zeroMotionBreakdown: global.zeroMotionBreakdown,
    byMode,
    byCharacter,
  };
}

/** 校验某状态值是否属于已知出口 (服务层投影用). */
export function isKnownOutcome(status: string): status is SessionOutcome {
  return (SESSION_OUTCOMES as readonly string[]).includes(status);
}
