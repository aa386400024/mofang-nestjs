// V2026-11-13 Phase3 P1 (文字层真人度 · 审计基线 · D7 纯模块):
//   职责: 把逐轮不流利度量汇成整场 / 批次级**纯数值**, 渲染 D7 报告段,
//         组装基线 JSON (只含数字与批次 id).
//   边界: 零 IO / 零台词原文 / 零随机; 同输入逐字节相同.
//
//   ⚠️ **隐私分层** (蓝图 §5.2.3): 本模块**不 import analyzer** ——
//     台词原文只由 visitor-quality-audit.ts (IO 层离线工具) 调 analyzeDisfluency 取;
//     本模块只消费 P0 的**纯数值契约** (disfluency-lexicon.js), 与 batch-metrics.compute.ts 同层同权.
//
//   口径 (与 P0 快照同源):
//     · 合计口径为准 —— 合计事件 ÷ 合计纳入轮数 (= aggregateDisfluency 的公式);
//     · 跨场均值只作参考, 不与合计口径混用;
//     · 五类 per_turn 与字典 dict-v2 八键一一对应;
//       **elongation 只入事件总量, 无 per_turn 键** (P0 偏差 5).
//
//   种子区间 (蓝图 §5.2.4): 工程种子值, **P2 才接判据**; 本单只并列对照, 不出 PASS/FAIL.

import path from 'node:path';
import {
  aggregateDisfluency,
  type DisfluencyCounts,
  type DisfluencyMetrics,
} from '../../../src/auto-practice/metrics/disfluency-lexicon.js';
import { round6 } from '../../../src/auto-practice/metrics/round.js';

/** 五类 per_turn (elongation 只入事件总量, 无 per_turn 键 —— P0 偏差 5). */
export interface DisfluencyPerTurn {
  readonly filler: number;
  readonly pause: number;
  readonly repair: number;
  readonly repetition: number;
  readonly trailoff: number;
}

/** 整场不流利汇总 (纯数值, 无任何文本引用). */
export interface SessionDisfluencySummary {
  /** 纳入轮数 (visitor 台词条数). */
  readonly turns: number;
  /** 不流利事件总数 (六类之和). */
  readonly events: number;
  /** 含至少一次不流利的轮数. */
  readonly eventTurns: number;
  /** 归一化字符总数 (密度分母). */
  readonly normalizedChars: number;
  readonly eventsPerTurn: number;
  readonly eventTurnRate: number;
  readonly densityPer100Chars: number;
  /** 六类事件计数. */
  readonly typeCounts: DisfluencyCounts;
  /** 五类 per_turn. */
  readonly perTurn: DisfluencyPerTurn;
}

/** 批次级汇总 (合计口径 + 跨场均值). */
export interface BatchDisfluencySummary {
  readonly sessions: number;
  readonly turns: number;
  readonly events: number;
  readonly eventTurns: number;
  readonly normalizedChars: number;
  /** 合计口径: 合计事件 ÷ 合计纳入轮数. */
  readonly eventsPerTurn: number;
  readonly eventTurnRate: number;
  readonly densityPer100Chars: number;
  readonly typeCounts: DisfluencyCounts;
  readonly perTurn: DisfluencyPerTurn;
  /** 跨场均值 (参考口径, 不与合计口径混用). */
  readonly meanEventsPerTurn: number;
  readonly meanEventTurnRate: number;
  readonly meanDensityPer100Chars: number;
}

/** 种子区间规格 (工程种子值 · P2 才接判据). */
export interface SeedRangeSpec {
  readonly metric: string;
  /** 展示用区间描述. */
  readonly label: string;
  readonly min?: number;
  readonly max?: number;
  readonly bound: 'range' | 'upper';
}

/** 蓝图 §5.2.4 的三条种子区间 (只读对照常量, 不接门禁). */
export const DISFLUENCY_SEED_RANGES: readonly SeedRangeSpec[] = [
  { metric: 'event_turn_rate', label: '区间 [0.20, 0.55]', min: 0.2, max: 0.55, bound: 'range' },
  { metric: 'events_per_turn', label: '上限 ≤ 0.8', max: 0.8, bound: 'upper' },
  { metric: 'repair_per_turn', label: '上限 ≤ 0.25', max: 0.25, bound: 'upper' },
];

/** 种子区间对照行 (三列形态: 种子区间 / 实测值 / 是否落在区间内; **无 PASS/FAIL**). */
export interface SeedComparisonRow {
  readonly metric: string;
  readonly seedLabel: string;
  readonly measured: number;
  readonly inside: boolean;
}

/** 可变形态的六类计数 (DisfluencyCounts 的只读去掉版, 仅供本地累加). */
type MutableCounts = { -readonly [K in keyof DisfluencyCounts]: DisfluencyCounts[K] };

/** 空的六类计数. */
function emptyCounts(): MutableCounts {
  return { filler: 0, pause: 0, repetition: 0, repair: 0, trailoff: 0, elongation: 0 };
}

/** 安全的除法 (分母为 0 → 0, 不出 NaN / Infinity). */
function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return round6(numerator / denominator);
}

/**
 * 汇总整场的不流利数值 (纯数值).
 *
 * 聚合公式直接走 P0 的 aggregateDisfluency (不另写复算逻辑);
 * 五类 per_turn = 该类事件总数 ÷ 纳入轮数 (分母为 0 → 0, 与聚合函数空态一致).
 *
 * @param metrics 逐轮不流利度量
 * @returns 整场汇总
 */
export function summarizeDisfluency(metrics: readonly DisfluencyMetrics[]): SessionDisfluencySummary {
  const aggregate = aggregateDisfluency(metrics);
  let events = 0;
  let eventTurns = 0;
  let normalizedChars = 0;
  for (const metric of metrics) {
    events += metric.events;
    if (metric.hasEvent) eventTurns += 1;
    normalizedChars += metric.normalizedLength;
  }
  const turns = metrics.length;
  return {
    turns,
    events,
    eventTurns,
    normalizedChars,
    eventsPerTurn: aggregate.eventsPerTurn,
    eventTurnRate: aggregate.eventTurnRate,
    densityPer100Chars: aggregate.densityPer100Chars,
    typeCounts: aggregate.typeCounts,
    perTurn: {
      filler: ratio(aggregate.typeCounts.filler, turns),
      pause: ratio(aggregate.typeCounts.pause, turns),
      repair: ratio(aggregate.typeCounts.repair, turns),
      repetition: ratio(aggregate.typeCounts.repetition, turns),
      trailoff: ratio(aggregate.typeCounts.trailoff, turns),
    },
  };
}

/**
 * 汇总批次级的不流利数值 (合计口径 + 跨场均值).
 *
 * 合计口径 = 把全部场的轮次合并后再算 (与 aggregateDisfluency 对全量轮次同源),
 * 与 P0 批次快照里的 text.disfluency.* 口径一致.
 *
 * @param summaries 各场汇总
 * @returns 批次汇总
 */
export function aggregateDisfluencyBatch(summaries: readonly SessionDisfluencySummary[]): BatchDisfluencySummary {
  let turns = 0;
  let events = 0;
  let eventTurns = 0;
  let normalizedChars = 0;
  const typeCounts = emptyCounts();
  for (const summary of summaries) {
    turns += summary.turns;
    events += summary.events;
    eventTurns += summary.eventTurns;
    normalizedChars += summary.normalizedChars;
    typeCounts.filler += summary.typeCounts.filler;
    typeCounts.pause += summary.typeCounts.pause;
    typeCounts.repetition += summary.typeCounts.repetition;
    typeCounts.repair += summary.typeCounts.repair;
    typeCounts.trailoff += summary.typeCounts.trailoff;
    typeCounts.elongation += summary.typeCounts.elongation;
  }
  const mean = (pick: (summary: SessionDisfluencySummary) => number): number =>
    summaries.length > 0 ? round6(summaries.reduce((acc, summary) => acc + pick(summary), 0) / summaries.length) : 0;
  return {
    sessions: summaries.length,
    turns,
    events,
    eventTurns,
    normalizedChars,
    eventsPerTurn: ratio(events, turns),
    eventTurnRate: ratio(eventTurns, turns),
    densityPer100Chars: normalizedChars > 0 ? round6((events / normalizedChars) * 100) : 0,
    typeCounts,
    perTurn: {
      filler: ratio(typeCounts.filler, turns),
      pause: ratio(typeCounts.pause, turns),
      repair: ratio(typeCounts.repair, turns),
      repetition: ratio(typeCounts.repetition, turns),
      trailoff: ratio(typeCounts.trailoff, turns),
    },
    meanEventsPerTurn: mean((summary) => summary.eventsPerTurn),
    meanEventTurnRate: mean((summary) => summary.eventTurnRate),
    meanDensityPer100Chars: mean((summary) => summary.densityPer100Chars),
  };
}

/**
 * 与种子区间并列对照 (只出三列形态, **不输出 PASS / FAIL 判定**).
 *
 * @param batch 批次汇总
 * @returns 对照行
 */
export function compareWithSeedRanges(batch: BatchDisfluencySummary): SeedComparisonRow[] {
  const measured: Readonly<Record<string, number>> = {
    event_turn_rate: batch.eventTurnRate,
    events_per_turn: batch.eventsPerTurn,
    repair_per_turn: batch.perTurn.repair,
  };
  return DISFLUENCY_SEED_RANGES.map((spec) => {
    const value = measured[spec.metric] ?? 0;
    const inside =
      spec.bound === 'range'
        ? value >= (spec.min ?? 0) && value <= (spec.max ?? Number.POSITIVE_INFINITY)
        : value <= (spec.max ?? Number.POSITIVE_INFINITY);
    return { metric: spec.metric, seedLabel: spec.label, measured: value, inside };
  });
}

/**
 * 渲染 D7 报告段 (只出数字与标签, 无台词).
 *
 * @param batch 批次汇总
 * @param options 场次口径信息
 * @returns 报告文本 (多行)
 */
export function renderD7Report(batch: BatchDisfluencySummary, options: { readonly sessions: number }): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('[D7] 不流利分布（Phase3 P1 · 观测对照，不接门禁）');
  lines.push(`  有效场次 ${options.sessions} / 纳入轮次 ${batch.turns}`);
  lines.push(`  events_per_turn      ${batch.eventsPerTurn.toFixed(4)}   (批次合计口径 · 与 P0 快照同源)`);
  lines.push(`  event_turn_rate      ${batch.eventTurnRate.toFixed(4)}`);
  lines.push(`  density_per100       ${batch.densityPer100Chars.toFixed(4)}`);
  lines.push(`  filler_per_turn      ${batch.perTurn.filler.toFixed(4)}`);
  lines.push(`  pause_per_turn       ${batch.perTurn.pause.toFixed(4)}`);
  lines.push(`  repair_per_turn      ${batch.perTurn.repair.toFixed(4)}`);
  lines.push(`  repetition_per_turn  ${batch.perTurn.repetition.toFixed(4)}`);
  lines.push(`  trailoff_per_turn    ${batch.perTurn.trailoff.toFixed(4)}`);
  lines.push(
    `  跨场均值 (参考) events_per_turn ${batch.meanEventsPerTurn.toFixed(4)} / event_turn_rate ${batch.meanEventTurnRate.toFixed(4)} / density_per100 ${batch.meanDensityPer100Chars.toFixed(4)}`,
  );
  lines.push(
    `  六类事件合计 filler ${batch.typeCounts.filler} / pause ${batch.typeCounts.pause} / repetition ${batch.typeCounts.repetition} / repair ${batch.typeCounts.repair} / trailoff ${batch.typeCounts.trailoff} / elongation ${batch.typeCounts.elongation}`,
  );
  lines.push('  种子区间对照 (工程种子值 · P2 才接判据 · 只观测不判定):');
  for (const row of compareWithSeedRanges(batch)) {
    lines.push(
      `    ${row.metric}  种子区间 ${row.seedLabel}  实测 ${row.measured.toFixed(4)}  ${row.inside ? '落在区间内' : '落在区间外'}`,
    );
  }
  return lines.join('\n');
}

/**
 * 组装基线 JSON 载荷 (只含数字与批次 id; 无台词 / 无 matchedTerms / 无解释文本).
 *
 * @param batchId 批次 id (目录名去 debug-sessions- 前缀)
 * @param batchDir 批次目录名
 * @param batch 批次汇总
 * @returns 可 JSON 序列化的载荷
 */
export function buildDisfluencyBaselinePayload(batchId: string, batchDir: string, batch: BatchDisfluencySummary): Record<string, unknown> {
  const seedComparison: Record<string, Record<string, number | boolean>> = {};
  for (const row of compareWithSeedRanges(batch)) {
    const spec = DISFLUENCY_SEED_RANGES.find((item) => item.metric === row.metric);
    const entry: Record<string, number | boolean> = { measured: row.measured, inside: row.inside };
    if (spec?.min !== undefined) entry['min'] = spec.min;
    if (spec?.max !== undefined) entry['max'] = spec.max;
    seedComparison[row.metric] = entry;
  }
  return {
    batchId,
    batchDir,
    sessions: batch.sessions,
    turns: batch.turns,
    events: batch.events,
    eventTurns: batch.eventTurns,
    normalizedChars: batch.normalizedChars,
    events_per_turn: batch.eventsPerTurn,
    event_turn_rate: batch.eventTurnRate,
    density_per100: batch.densityPer100Chars,
    filler_per_turn: batch.perTurn.filler,
    pause_per_turn: batch.perTurn.pause,
    repair_per_turn: batch.perTurn.repair,
    repetition_per_turn: batch.perTurn.repetition,
    trailoff_per_turn: batch.perTurn.trailoff,
    type_counts: { ...batch.typeCounts },
    mean_events_per_turn: batch.meanEventsPerTurn,
    mean_event_turn_rate: batch.meanEventTurnRate,
    mean_density_per100: batch.meanDensityPer100Chars,
    seed_comparison: seedComparison,
  };
}

/**
 * 从归档目录名推导批次 id (去 debug-sessions- 前缀).
 *
 * @param dirPath 归档目录路径
 * @returns 批次 id
 */
export function batchIdOf(dirPath: string): string {
  const name = path.basename(path.resolve(dirPath));
  return name.startsWith('debug-sessions-') ? name.slice('debug-sessions-'.length) : name;
}
