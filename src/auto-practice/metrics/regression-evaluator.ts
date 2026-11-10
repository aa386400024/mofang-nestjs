// V2026-11-11 WP-K (回归判定器):
//   职责: 比较基线批与候选批, 给出四态结论.
//   边界: 纯函数, 零 IO / 零框架.
//
//   最关键的纪律是 incomparable: 当两批"不是同一类东西"时, 必须拒绝硬比,
//   而不是输出一个看起来精确、实则错误的 improved/regressed.
//   半个真相 + 自信的结论, 比没有结论危险得多.

import { compareFingerprints, type ConfigSegment } from '../config-fingerprint.js';
import type { BatchMetricsV1 } from './batch-metrics.schema.js';
import { METRIC_BY_ID } from './metric-dictionary.js';

/** 四态结论. */
export type Verdict = 'improved' | 'neutral' | 'regressed' | 'incomparable';

/** 覆盖率门槛 (低于即不可比). */
export const COVERAGE_RATIO_MIN = 0.9;

/** 回归判定容差 (变化不超过此值视为 neutral, 防浮点噪声). */
export const REGRESSION_TOL = 0.01;

/** 单指标的对比结果. */
export interface RegressionItem {
  readonly metricId: string;
  readonly base: number | null;
  readonly candidate: number | null;
  readonly delta: number | null;
  readonly movement: 'improved' | 'neutral' | 'regressed';
}

/** 完整回归报告. */
export interface RegressionReport {
  readonly verdict: Verdict;
  readonly items: readonly RegressionItem[];
  /** incomparable 时的原因. */
  readonly reasons: readonly string[];
  /** 两批配置指纹发生变化的段. */
  readonly changedSegments: readonly ConfigSegment[];
}

/** 收集一批涉及的 counselorModeId 集合 (来自血缘). */
function modeIds(snapshot: BatchMetricsV1): Set<string> {
  return new Set(snapshot.lineage.map((entry) => entry.counselorModeId));
}

/** 收集一批涉及的角色 slug 集合 (来自血缘). */
function characterSlugs(snapshot: BatchMetricsV1): Set<string> {
  return new Set(snapshot.lineage.map((entry) => entry.characterSlug));
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

function coverageRatio(snapshot: BatchMetricsV1): number {
  const { expectedSessions, includedSessions } = snapshot.coverage;
  return expectedSessions > 0 ? includedSessions / expectedSessions : 0;
}

/**
 * 检查是否必须判 incomparable; 返回原因列表 (空 = 可比).
 */
function findIncomparableReasons(base: BatchMetricsV1, candidate: BatchMetricsV1): string[] {
  const reasons: string[] = [];

  // ① 判据段不同: 跨判据比 PASS/FAIL 无意义.
  if (base.fingerprint.acceptance !== candidate.fingerprint.acceptance) {
    reasons.push('两批验收判据 (acceptance) 不同');
  }

  // ② 任一批覆盖率不足.
  if (coverageRatio(base) < COVERAGE_RATIO_MIN) reasons.push('基线批覆盖率低于 0.9');
  if (coverageRatio(candidate) < COVERAGE_RATIO_MIN) reasons.push('候选批覆盖率低于 0.9');

  // ③ 咨询师模式集合不同: 比的是不同东西.
  if (!setsEqual(modeIds(base), modeIds(candidate))) {
    reasons.push('两批 counselorModeId 集合不同');
  }

  // ④ 角色集合不同: 聚合均值的角色基础不同, 直接比会得出假结论.
  if (!setsEqual(characterSlugs(base), characterSlugs(candidate))) {
    reasons.push('两批 characterSlug 集合不同');
  }

  // ⑤ 任一批配置指纹 combined 未知.
  if (base.fingerprint.combined === 'unknown') reasons.push('基线批配置指纹 combined=unknown');
  if (candidate.fingerprint.combined === 'unknown') reasons.push('候选批配置指纹 combined=unknown');

  return reasons;
}

/**
 * 评估两批的回归关系.
 *
 * @param args.base 基线批
 * @param args.candidate 候选批
 * @returns 四态报告
 */
export function evaluateRegression(args: { readonly base: BatchMetricsV1; readonly candidate: BatchMetricsV1 }): RegressionReport {
  const { base, candidate } = args;
  const changedSegments = compareFingerprints(base.fingerprint, candidate.fingerprint).changed;
  const reasons = findIncomparableReasons(base, candidate);
  if (reasons.length > 0) {
    return { verdict: 'incomparable', items: [], reasons, changedSegments };
  }

  const items: RegressionItem[] = [];
  const metricIds = new Set([...Object.keys(base.metrics), ...Object.keys(candidate.metrics)]);
  for (const metricId of metricIds) {
    const definition = METRIC_BY_ID.get(metricId);
    // 方向为 neutral 的指标 (事件计数/率、出口分布) 不参与好坏判定.
    if (!definition || definition.direction === 'neutral') continue;
    const baseValue = base.metrics[metricId] ?? null;
    const candidateValue = candidate.metrics[metricId] ?? null;
    if (baseValue === null || candidateValue === null) continue;
    const delta = candidateValue - baseValue;
    let movement: RegressionItem['movement'] = 'neutral';
    if (Math.abs(delta) > REGRESSION_TOL) {
      const positive = delta > 0;
      const better = definition.direction === 'higher_is_better' ? positive : !positive;
      movement = better ? 'improved' : 'regressed';
    }
    items.push({ metricId, base: baseValue, candidate: candidateValue, delta, movement });
  }

  // 保守综合: 任一指标回归即整批回归; 否则有改善即改善; 全中性才中性.
  const regressed = items.filter((item) => item.movement === 'regressed');
  const improved = items.filter((item) => item.movement === 'improved');
  let verdict: Verdict = 'neutral';
  if (regressed.length > 0) verdict = 'regressed';
  else if (improved.length > 0) verdict = 'improved';

  return { verdict, items, reasons: [], changedSegments };
}
