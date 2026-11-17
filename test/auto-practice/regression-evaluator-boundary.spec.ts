// V2026-11-17 AF-067 (回归判定器四态边界回归测试):
//   职责: 钉死 evaluateRegression 的四态边界 —— 「不可比时绝不硬比」与「容差边界绝不抖动」.
//   边界: 只读生产纯函数 + 自带最小字面量夹具; 不依赖 computeBatchSnapshot / 容器 / DB / 网络.
//
//   与既有 wp-k-regression-evaluator.spec.ts 的分工 (不重复):
//   · 既有单测锁主路径 (由 computeBatchSnapshot 产出的真实快照) 与 schema 兼容;
//   · 本单只锁边界分支 —— 逐条钉死 incomparable 的五类原因、regressed 优先于 improved、
//     neutral 方向指标不参与好坏判定、REGRESSION_TOL 临界两侧, 以及缺失/未知指标不硬判.
//
//   纪律提醒 (与生产注释同源): 半个真相 + 自信的结论比没有结论危险得多.
//   故每个不可比用例都断言 reasons 原文, 不只断言 verdict —— 静默丢原因是更坏的失败模式.

import { describe, expect, it } from 'vitest';

import type { ConfigFingerprintSegments } from '../../src/auto-practice/config-fingerprint.js';
import type { BatchCoverage, BatchMetricsV1, SessionLineage } from '../../src/auto-practice/metrics/batch-metrics.schema.js';
import { COVERAGE_RATIO_MIN, evaluateRegression, REGRESSION_TOL } from '../../src/auto-practice/metrics/regression-evaluator.js';

/** 完整可比基线指纹: 7 段 + combined 全部已知, 两批一致. */
const FP: ConfigFingerprintSegments = {
  stateTransition: 'a111111111111111',
  alliance: 'b222222222222222',
  deltaTableConfig: 'c333333333333333',
  lexicon: 'd444444444444444',
  baselines: 'e555555555555555',
  prompts: 'f666666666666666',
  acceptance: 'a777777777777777',
  combined: 'c888888888888888',
};

/** 单场血缘 (counselorModeId=expert / characterSlug=vpt_test). */
const LINEAGE: readonly SessionLineage[] = [
  {
    debugSessionId: 'debug-1',
    characterSlug: 'vpt_test',
    counselorModeId: 'expert',
    turns: 2,
    fileSha256: 'sha11111111111111',
  },
];

/** 满覆盖快照 (10/10 = 1.0 ≥ 0.9). */
const COVERAGE_FULL: BatchCoverage = {
  expectedSessions: 10,
  includedSessions: 10,
  skippedSessions: 0,
  skipReasons: {},
  totalTurns: 20,
  transcriptRoot: 'data/debug-sessions',
};

/** 最小 BatchMetricsV1 夹具 (零 IO / 零框架). */
function makeSnapshot(overrides: Partial<BatchMetricsV1> = {}): BatchMetricsV1 {
  return {
    schemaVersion: 1,
    computedAt: '2026-11-17T00:00:00.000Z',
    batchId: 'batch-base',
    fingerprint: FP,
    coverage: COVERAGE_FULL,
    lineage: LINEAGE,
    metrics: {},
    byMode: {},
    byCharacter: {},
    ...overrides,
  };
}

/** 覆写指标表 (合并, 便于只写关心的键). */
function withMetrics(snapshot: BatchMetricsV1, metrics: Record<string, number | null>): BatchMetricsV1 {
  return { ...snapshot, metrics: { ...snapshot.metrics, ...metrics } };
}

/** 覆写覆盖率 (其余字段保持一致). */
function withCoverage(snapshot: BatchMetricsV1, expectedSessions: number, includedSessions: number): BatchMetricsV1 {
  return {
    ...snapshot,
    coverage: {
      ...snapshot.coverage,
      expectedSessions,
      includedSessions,
      skippedSessions: Math.max(0, expectedSessions - includedSessions),
    },
  };
}

/** 覆写血缘. */
function withLineage(snapshot: BatchMetricsV1, lineage: readonly SessionLineage[]): BatchMetricsV1 {
  return { ...snapshot, lineage };
}

/** 取某指标的单项对比结果 (断言用, 缺失即失败). */
function itemOf(report: ReturnType<typeof evaluateRegression>, metricId: string) {
  const found = report.items.find((item) => item.metricId === metricId);
  expect(found, `缺少指标 ${metricId} 的对比结果`).toBeDefined();
  return found!;
}

describe('AF-067 · incomparable · acceptance 判据段不同', () => {
  it('acceptance 段不同 → incomparable, reasons 精确且 items 为空', () => {
    const base = makeSnapshot();
    const candidate = makeSnapshot({
      batchId: 'batch-cand',
      fingerprint: { ...FP, acceptance: 'differentacceptseg' },
    });

    const report = evaluateRegression({ base, candidate });

    expect(report.verdict).toBe('incomparable');
    expect(report.reasons).toEqual(['两批验收判据 (acceptance) 不同']);
    expect(report.items).toEqual([]);
    expect(report.changedSegments).toContain('acceptance');
  });
});

describe('AF-067 · incomparable · 覆盖率不足', () => {
  it('基线批覆盖率 0.8 → incomparable, 理由指向基线批', () => {
    const base = withCoverage(makeSnapshot(), 10, 8);
    const candidate = makeSnapshot({ batchId: 'batch-cand' });

    const report = evaluateRegression({ base, candidate });

    expect(report.verdict).toBe('incomparable');
    expect(report.reasons).toEqual(['基线批覆盖率低于 0.9']);
    expect(report.items).toEqual([]);
  });

  it('候选批覆盖率 0.8 → incomparable, 理由指向候选批', () => {
    const base = makeSnapshot();
    const candidate = withCoverage(makeSnapshot({ batchId: 'batch-cand' }), 10, 8);

    const report = evaluateRegression({ base, candidate });

    expect(report.verdict).toBe('incomparable');
    expect(report.reasons).toEqual(['候选批覆盖率低于 0.9']);
    expect(report.items).toEqual([]);
  });

  it('覆盖率恰好等于阈值 0.9 → 可比 (低于才不可比)', () => {
    const base = withCoverage(makeSnapshot(), 10, 9);
    const candidate = withCoverage(makeSnapshot({ batchId: 'batch-cand' }), 100, 90);

    expect(base.coverage.includedSessions / base.coverage.expectedSessions).toBe(COVERAGE_RATIO_MIN);
    expect(candidate.coverage.includedSessions / candidate.coverage.expectedSessions).toBe(COVERAGE_RATIO_MIN);

    const report = evaluateRegression({ base, candidate });

    expect(report.verdict).toBe('neutral');
    expect(report.reasons).toEqual([]);
  });

  it('覆盖率 0.89 → 不可比 (阈值下侧)', () => {
    const base = makeSnapshot();
    const candidate = withCoverage(makeSnapshot({ batchId: 'batch-cand' }), 100, 89);

    expect(evaluateRegression({ base, candidate }).verdict).toBe('incomparable');
  });
});

describe('AF-067 · incomparable · 血缘集合不同', () => {
  it('counselorModeId 集合不同 → incomparable, 且不误报角色原因', () => {
    const base = makeSnapshot();
    const candidate = withLineage(makeSnapshot({ batchId: 'batch-cand' }), [{ ...LINEAGE[0], counselorModeId: 'other-mode' }]);

    const report = evaluateRegression({ base, candidate });

    expect(report.verdict).toBe('incomparable');
    expect(report.reasons).toEqual(['两批 counselorModeId 集合不同']);
    expect(report.reasons.join(';')).not.toContain('characterSlug');
    expect(report.items).toEqual([]);
  });

  it('characterSlug 集合不同 → incomparable, 且不误报模式原因', () => {
    const base = makeSnapshot();
    const candidate = withLineage(makeSnapshot({ batchId: 'batch-cand' }), [{ ...LINEAGE[0], characterSlug: 'vpt_other_character' }]);

    const report = evaluateRegression({ base, candidate });

    expect(report.verdict).toBe('incomparable');
    expect(report.reasons).toEqual(['两批 characterSlug 集合不同']);
    expect(report.reasons.join(';')).not.toContain('counselorModeId');
    expect(report.items).toEqual([]);
  });

  it('集合大小相同但成员不同 → 仍 incomparable (不只比 size)', () => {
    const base = withLineage(makeSnapshot(), [
      { ...LINEAGE[0], debugSessionId: 'debug-1', counselorModeId: 'expert' },
      { ...LINEAGE[0], debugSessionId: 'debug-2', counselorModeId: 'novice' },
    ]);
    const candidate = withLineage(makeSnapshot({ batchId: 'batch-cand' }), [
      { ...LINEAGE[0], debugSessionId: 'debug-1', counselorModeId: 'expert' },
      { ...LINEAGE[0], debugSessionId: 'debug-2', counselorModeId: 'novice-2' },
    ]);

    const report = evaluateRegression({ base, candidate });

    expect(report.verdict).toBe('incomparable');
    expect(report.reasons).toEqual(['两批 counselorModeId 集合不同']);
  });
});

describe('AF-067 · incomparable · 配置指纹 combined=unknown', () => {
  it('基线批 combined=unknown → incomparable', () => {
    const base = makeSnapshot({ fingerprint: { ...FP, combined: 'unknown' } });
    const candidate = makeSnapshot({ batchId: 'batch-cand' });

    const report = evaluateRegression({ base, candidate });

    expect(report.verdict).toBe('incomparable');
    expect(report.reasons).toEqual(['基线批配置指纹 combined=unknown']);
    expect(report.items).toEqual([]);
  });

  it('候选批 combined=unknown → incomparable', () => {
    const base = makeSnapshot();
    const candidate = makeSnapshot({ batchId: 'batch-cand', fingerprint: { ...FP, combined: 'unknown' } });

    const report = evaluateRegression({ base, candidate });

    expect(report.verdict).toBe('incomparable');
    expect(report.reasons).toEqual(['候选批配置指纹 combined=unknown']);
    expect(report.items).toEqual([]);
  });

  it('仅 combined 不同 → 7 段指纹无变化段 (combined 不参与段比较)', () => {
    const base = makeSnapshot();
    const candidate = makeSnapshot({ batchId: 'batch-cand', fingerprint: { ...FP, combined: 'unknown' } });

    expect(evaluateRegression({ base, candidate }).changedSegments).toEqual([]);
  });
});

describe('AF-067 · incomparable · 多条原因并存', () => {
  it('acceptance 不同 + 覆盖率不足 + combined 未知 → 四条原因齐出, 不吞并', () => {
    const base = withCoverage(makeSnapshot({ fingerprint: { ...FP, combined: 'unknown' } }), 10, 5);
    const candidate = withCoverage(
      makeSnapshot({ batchId: 'batch-cand', fingerprint: { ...FP, acceptance: 'differentacceptseg' } }),
      10,
      5,
    );

    const report = evaluateRegression({ base, candidate });

    expect(report.verdict).toBe('incomparable');
    // 原因按生产实现顺序逐条齐出 (acceptance → 覆盖率 → 血缘集合 → combined), 不做合并/去重.
    expect(report.reasons).toEqual([
      '两批验收判据 (acceptance) 不同',
      '基线批覆盖率低于 0.9',
      '候选批覆盖率低于 0.9',
      '基线批配置指纹 combined=unknown',
    ]);
    expect(report.items).toEqual([]);
  });
});

describe('AF-067 · 四态判定', () => {
  it('仅改善 → improved', () => {
    const base = withMetrics(makeSnapshot(), { 'dim.trust.delta_avg': 0.5 });
    const candidate = withMetrics(makeSnapshot({ batchId: 'batch-cand' }), { 'dim.trust.delta_avg': 0.6 });

    const report = evaluateRegression({ base, candidate });

    expect(report.verdict).toBe('improved');
    expect(report.reasons).toEqual([]);
    expect(itemOf(report, 'dim.trust.delta_avg').movement).toBe('improved');
  });

  it('regressed 优先于 improved (任一指标回归即整批回归)', () => {
    const base = withMetrics(makeSnapshot(), { 'dim.trust.delta_avg': 0.5, 'session.zero_motion': 2 });
    const candidate = withMetrics(makeSnapshot({ batchId: 'batch-cand' }), { 'dim.trust.delta_avg': 0.6, 'session.zero_motion': 5 });

    const report = evaluateRegression({ base, candidate });

    expect(report.verdict).toBe('regressed');
    expect(report.reasons).toEqual([]);
    expect(report.items).toHaveLength(2);
    expect(itemOf(report, 'dim.trust.delta_avg').movement).toBe('improved');
    expect(itemOf(report, 'session.zero_motion').movement).toBe('regressed');
  });

  it('全部落在容差内 → neutral (items 仍在, movement 全 neutral)', () => {
    const base = withMetrics(makeSnapshot(), { 'dim.trust.delta_avg': 0.5, 'session.zero_motion': 2 });
    const candidate = withMetrics(makeSnapshot({ batchId: 'batch-cand' }), { 'dim.trust.delta_avg': 0.5, 'session.zero_motion': 2 });

    const report = evaluateRegression({ base, candidate });

    expect(report.verdict).toBe('neutral');
    expect(report.items).toHaveLength(2);
    for (const item of report.items) expect(item.movement).toBe('neutral');
  });

  it('neutral 方向指标不参与好坏判定 (事件率/唤醒/出口/不流利 全部不进 items)', () => {
    const base = withMetrics(makeSnapshot(), {
      'event.empathy.rate': 0.2,
      'dim.arousal.delta_avg': 0.1,
      'session.outcome.completed': 3,
      'text.disfluency.filler_per_turn': 0.5,
    });
    const candidate = withMetrics(makeSnapshot({ batchId: 'batch-cand' }), {
      'event.empathy.rate': 0.9,
      'dim.arousal.delta_avg': -0.8,
      'session.outcome.completed': 12,
      'text.disfluency.filler_per_turn': 2,
    });

    const report = evaluateRegression({ base, candidate });

    expect(report.verdict).toBe('neutral');
    expect(report.items).toEqual([]);
    expect(report.reasons).toEqual([]);
  });

  it('neutral 指标剧烈变化不掩盖方向指标的改善', () => {
    const base = withMetrics(makeSnapshot(), { 'event.empathy.rate': 0.2, 'dim.trust.delta_avg': 0.5 });
    const candidate = withMetrics(makeSnapshot({ batchId: 'batch-cand' }), { 'event.empathy.rate': 0.95, 'dim.trust.delta_avg': 0.6 });

    const report = evaluateRegression({ base, candidate });

    expect(report.verdict).toBe('improved');
    expect(report.items).toHaveLength(1);
    expect(report.items[0]?.metricId).toBe('dim.trust.delta_avg');
  });
});

describe('AF-067 · REGRESSION_TOL 边界', () => {
  it('delta 恰好等于容差 → neutral (不判 movement)', () => {
    const base = withMetrics(makeSnapshot(), { 'dim.trust.delta_avg': 0 });
    const candidate = withMetrics(makeSnapshot({ batchId: 'batch-cand' }), { 'dim.trust.delta_avg': REGRESSION_TOL });

    const report = evaluateRegression({ base, candidate });

    expect(itemOf(report, 'dim.trust.delta_avg').delta).toBe(REGRESSION_TOL);
    expect(itemOf(report, 'dim.trust.delta_avg').movement).toBe('neutral');
    expect(report.verdict).toBe('neutral');
  });

  it('delta 略超容差 → improved (higher_is_better)', () => {
    const base = withMetrics(makeSnapshot(), { 'dim.trust.delta_avg': 0 });
    const candidate = withMetrics(makeSnapshot({ batchId: 'batch-cand' }), { 'dim.trust.delta_avg': REGRESSION_TOL + 1e-6 });

    const report = evaluateRegression({ base, candidate });

    expect(itemOf(report, 'dim.trust.delta_avg').movement).toBe('improved');
    expect(report.verdict).toBe('improved');
  });

  it('delta 略超容差且为负 → regressed (higher_is_better)', () => {
    const base = withMetrics(makeSnapshot(), { 'dim.trust.delta_avg': 0 });
    const candidate = withMetrics(makeSnapshot({ batchId: 'batch-cand' }), { 'dim.trust.delta_avg': -(REGRESSION_TOL + 1e-6) });

    const report = evaluateRegression({ base, candidate });

    expect(itemOf(report, 'dim.trust.delta_avg').movement).toBe('regressed');
    expect(report.verdict).toBe('regressed');
  });

  it('lower_is_better 指标: delta 恰好等于容差 → neutral', () => {
    const base = withMetrics(makeSnapshot(), { 'session.zero_motion': 0 });
    const candidate = withMetrics(makeSnapshot({ batchId: 'batch-cand' }), { 'session.zero_motion': REGRESSION_TOL });

    const report = evaluateRegression({ base, candidate });

    expect(itemOf(report, 'session.zero_motion').movement).toBe('neutral');
    expect(report.verdict).toBe('neutral');
  });

  it('lower_is_better 指标: delta 略超容差 → regressed', () => {
    const base = withMetrics(makeSnapshot(), { 'session.zero_motion': 0 });
    const candidate = withMetrics(makeSnapshot({ batchId: 'batch-cand' }), { 'session.zero_motion': REGRESSION_TOL + 1e-6 });

    const report = evaluateRegression({ base, candidate });

    expect(itemOf(report, 'session.zero_motion').movement).toBe('regressed');
    expect(report.verdict).toBe('regressed');
  });

  it('lower_is_better 指标: delta 略超容差且为负 → improved', () => {
    const base = withMetrics(makeSnapshot(), { 'session.zero_motion': 0 });
    const candidate = withMetrics(makeSnapshot({ batchId: 'batch-cand' }), { 'session.zero_motion': -(REGRESSION_TOL + 1e-6) });

    const report = evaluateRegression({ base, candidate });

    expect(itemOf(report, 'session.zero_motion').movement).toBe('improved');
    expect(report.verdict).toBe('improved');
  });

  it('十进制意义上的"恰好 0.01"在二进制下略大于容差 → 判为 movement (浮点现状锁定)', () => {
    const base = withMetrics(makeSnapshot(), { 'dim.trust.delta_avg': 0.5 });
    const candidate = withMetrics(makeSnapshot({ batchId: 'batch-cand' }), { 'dim.trust.delta_avg': 0.51 });

    const report = evaluateRegression({ base, candidate });
    const item = itemOf(report, 'dim.trust.delta_avg');

    expect(item.delta).toBeCloseTo(REGRESSION_TOL, 10);
    expect(item.delta).toBeGreaterThan(REGRESSION_TOL);
    expect(item.movement).toBe('improved');
  });
});

describe('AF-067 · 缺失/未知指标不硬判', () => {
  it('候选批缺该指标 → 跳过, 不产出 improved/regressed', () => {
    const base = withMetrics(makeSnapshot(), { 'dim.trust.delta_avg': 0.5 });
    const candidate = makeSnapshot({ batchId: 'batch-cand' });

    const report = evaluateRegression({ base, candidate });

    expect(report.verdict).toBe('neutral');
    expect(report.items).toEqual([]);
  });

  it('任一侧为 null → 跳过, 不产出 improved/regressed', () => {
    const base = withMetrics(makeSnapshot(), { 'dim.trust.delta_avg': null });
    const candidate = withMetrics(makeSnapshot({ batchId: 'batch-cand' }), { 'dim.trust.delta_avg': 0.9 });

    const report = evaluateRegression({ base, candidate });

    expect(report.verdict).toBe('neutral');
    expect(report.items).toEqual([]);
  });

  it('指标 id 不在字典中 → 跳过 (不硬比未知口径)', () => {
    const base = withMetrics(makeSnapshot(), { 'unknown.metric': 0.1 });
    const candidate = withMetrics(makeSnapshot({ batchId: 'batch-cand' }), { 'unknown.metric': 0.9 });

    const report = evaluateRegression({ base, candidate });

    expect(report.verdict).toBe('neutral');
    expect(report.items).toEqual([]);
  });
});
