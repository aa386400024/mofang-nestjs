// V2026-11-11 WP-K (schema 兼容 + 回归判定四态):
//   legacy 识别不抛错; 四态尤其 incomparable 的各触发条件.

import { describe, expect, it } from 'vitest';

import type { ConfigFingerprintSegments } from '../../src/auto-practice/config-fingerprint.js';
import {
  computeBatchSnapshot,
  type BatchComputeContext,
  type SessionComputationInput,
} from '../../src/auto-practice/metrics/batch-metrics.compute.js';
import { assertBatchMetricsV1, isBatchMetricsV1, type BatchMetricsV1 } from '../../src/auto-practice/metrics/batch-metrics.schema.js';
import { evaluateRegression } from '../../src/auto-practice/metrics/regression-evaluator.js';

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

const CTX: BatchComputeContext = {
  batchId: 'batch-base',
  transcriptRoot: 'data/debug-sessions',
  fingerprint: FP,
  pipeline: { llmCallRatio: 1, fallbackRatio: 0 },
};

const SESSION: SessionComputationInput = {
  debugSessionId: 'debug-1',
  characterSlug: 'vpt_test',
  counselorModeId: 'expert',
  status: 'completed',
  fileSha256: 'sha11111111111111',
  traces: [
    {
      turnIndex: 1,
      bdiSnapshot: {
        trust: 0.5,
        safety: 0.5,
        bond: 0.5,
        valence: 0,
        arousal: 0.5,
        resistanceVerbal: 0.4,
        resistanceDepth: 0.4,
        resistanceStyle: 0.4,
      },
      eventTags: [],
      strategy: 'recounting',
      degraded: false,
    },
    {
      turnIndex: 2,
      bdiSnapshot: {
        trust: 0.5,
        safety: 0.5,
        bond: 0.5,
        valence: 0,
        arousal: 0.5,
        resistanceVerbal: 0.4,
        resistanceDepth: 0.4,
        resistanceStyle: 0.4,
      },
      eventTags: [],
      strategy: 'recounting',
      degraded: false,
    },
  ],
};

function baseSnapshot(overrides: Partial<BatchMetricsV1> = {}): BatchMetricsV1 {
  return { ...computeBatchSnapshot([SESSION], [], 1, CTX), ...overrides };
}

function withMetrics(snapshot: BatchMetricsV1, metrics: Record<string, number | null>): BatchMetricsV1 {
  return { ...snapshot, metrics: { ...snapshot.metrics, ...metrics } };
}

describe('WP-K · schema 兼容', () => {
  it('合法 v1 → 识别且 assert 通过', () => {
    const snapshot = baseSnapshot();
    expect(isBatchMetricsV1(snapshot)).toBe(true);
    expect(() => assertBatchMetricsV1(snapshot, 'x')).not.toThrow();
  });

  it('缺 schemaVersion → 识别为 legacy (不抛错)', () => {
    const { schemaVersion: _omit, ...legacy } = baseSnapshot();
    expect(isBatchMetricsV1(legacy)).toBe(false);
    expect(() => assertBatchMetricsV1(legacy, 'x')).toThrow();
  });

  it('非对象 → legacy false, 不抛错', () => {
    expect(isBatchMetricsV1(null)).toBe(false);
    expect(isBatchMetricsV1('x')).toBe(false);
  });
});

describe('WP-K · 回归判定四态', () => {
  it('trust 超 tol 升高 → improved (higher_is_better)', () => {
    const candidate = withMetrics(baseSnapshot({ batchId: 'cand' }), { 'dim.trust.delta_avg': 0.12 });
    const report = evaluateRegression({ base: baseSnapshot(), candidate });
    expect(report.verdict).toBe('improved');
  });

  it('trust 超 tol 下降 → regressed', () => {
    const candidate = withMetrics(baseSnapshot({ batchId: 'cand' }), { 'dim.trust.delta_avg': -0.12 });
    expect(evaluateRegression({ base: baseSnapshot(), candidate }).verdict).toBe('regressed');
  });

  it('变化在 tol 内 → neutral', () => {
    const candidate = withMetrics(baseSnapshot({ batchId: 'cand' }), { 'dim.trust.delta_avg': 0.005 });
    expect(evaluateRegression({ base: baseSnapshot(), candidate }).verdict).toBe('neutral');
  });

  it('候选覆盖率不足 → incomparable (reasons 含覆盖率)', () => {
    const candidate = baseSnapshot({
      batchId: 'cand',
      coverage: { ...baseSnapshot().coverage, expectedSessions: 10, includedSessions: 5 },
    });
    const report = evaluateRegression({ base: baseSnapshot(), candidate });
    expect(report.verdict).toBe('incomparable');
    expect(report.reasons.join(';')).toContain('覆盖率');
  });

  it('acceptance 段不同 → incomparable', () => {
    const candidate = baseSnapshot({
      batchId: 'cand',
      fingerprint: { ...FP, acceptance: 'differentacceptseg' },
    });
    expect(evaluateRegression({ base: baseSnapshot(), candidate }).verdict).toBe('incomparable');
  });

  it('counselorModeId 集合不同 → incomparable', () => {
    const candidate = baseSnapshot({
      batchId: 'cand',
      lineage: [{ ...baseSnapshot().lineage[0], counselorModeId: 'other-mode' }],
    });
    expect(evaluateRegression({ base: baseSnapshot(), candidate }).verdict).toBe('incomparable');
  });

  it('characterSlug 集合不同 → incomparable (聚合角色基础不同)', () => {
    const candidate = baseSnapshot({
      batchId: 'cand',
      lineage: [{ ...baseSnapshot().lineage[0], characterSlug: 'vpt_other_character' }],
    });
    const report = evaluateRegression({ base: baseSnapshot(), candidate });
    expect(report.verdict).toBe('incomparable');
    expect(report.reasons.join(';')).toContain('characterSlug');
  });

  it('combined unknown → incomparable', () => {
    const candidate = baseSnapshot({
      batchId: 'cand',
      fingerprint: { ...FP, combined: 'unknown' },
    });
    expect(evaluateRegression({ base: baseSnapshot(), candidate }).verdict).toBe('incomparable');
  });

  it('阻抗 depth 变化超 tol 也不触发 regressed (K-2: 按 neutral 处理)', () => {
    const candidate = withMetrics(baseSnapshot({ batchId: 'cand' }), { 'dim.depth.delta_avg': -0.2 });
    const report = evaluateRegression({ base: baseSnapshot(), candidate });
    expect(report.verdict).toBe('neutral');
    expect(report.items.find((item) => item.metricId === 'dim.depth.delta_avg')).toBeUndefined();
  });
});
