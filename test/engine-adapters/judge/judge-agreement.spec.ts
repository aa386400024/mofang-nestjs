// AF-616 · Judge P1-A 双评审同场配对一致率纯度量:
//   完全一致 / 逐维分歧 / 单侧 null / 双侧 null / 低样本 null / 信心差与分歧清单 /
//   v1 快照 agreement 可选子段兼容与拒绝 / 指标字典 dict-v5.

import { describe, expect, it } from 'vitest';

import { assertBatchMetricsV1 } from '../../../src/auto-practice/metrics/batch-metrics.schema.js';
import { METRIC_BY_ID, METRIC_DICTIONARY_VERSION } from '../../../src/auto-practice/metrics/metric-dictionary.js';
import {
  aggregateJudgeAgreement,
  assertJudgeAgreementSection,
  buildJudgeAgreementSection,
  computePair,
  pairJudgeReviews,
} from '../../../src/engine-adapters/judge/judge.agreement.js';
import {
  JUDGE_PROMPT_VERSION,
  JUDGE_RUBRIC_VERSION,
  computeJudgeRubricFingerprint,
} from '../../../src/engine-adapters/judge/judge.rubric.js';
import {
  JUDGE_DIMENSIONS,
  JUDGE_MACHINE_PROXY_LABEL,
  JUDGE_SHADOW_MODE,
  type JudgeDimension,
  type JudgeRating,
  type JudgeReviewResult,
  type JudgeSnapshotSection,
} from '../../../src/engine-adapters/judge/judge.types.js';

/** 造一场合法评审 (只关心评级 / 信心 / 血缘, 证据引用固定占位). */
function makeReview(
  sessionId: string,
  ratings: readonly JudgeRating[],
  overallConfidence: number,
  model = 'MiniMax-M3.1-Flash',
): JudgeReviewResult {
  if (ratings.length !== JUDGE_DIMENSIONS.length) throw new Error('fixture ratings length');
  return {
    sessionId,
    ratings: JUDGE_DIMENSIONS.map((dimension, index) => ({
      dimension,
      rating: ratings[index],
      reason: '可观察行为落在该档锚点, 论据仅引用给定片段',
      evidenceRefs: [{ turnIndex: 1, excerptId: `excerpt-${sessionId}`, eventTags: ['empathy'] }],
      confidence: 0.6,
    })),
    overallConfidence,
    disclaimer: JUDGE_MACHINE_PROXY_LABEL,
    lineage: {
      providerId: 'minimax',
      model,
      rubricVersion: JUDGE_RUBRIC_VERSION,
      promptVersion: JUDGE_PROMPT_VERSION,
      rubricFingerprint: computeJudgeRubricFingerprint(),
      inputFingerprint: `input-${sessionId}`,
      sessionId,
      generatedAt: '2026-11-29T00:00:00.000Z',
      mode: JUDGE_SHADOW_MODE,
      judgeKind: 'machine_proxy',
    },
  };
}

/** 造三维同档评审. */
function sameReview(sessionId: string, rating: JudgeRating, confidence = 0.6): JudgeReviewResult {
  return makeReview(sessionId, [rating, rating, rating], confidence);
}

/** 造合法 Judge 快照段 (agreement 可选). */
function makeJudgeSection(reviews: readonly JudgeReviewResult[], agreement?: unknown): JudgeSnapshotSection {
  return {
    mode: 'shadow',
    machineProxy: true,
    disclaimer: JUDGE_MACHINE_PROXY_LABEL,
    providerId: 'minimax',
    model: 'MiniMax-M3.1-Flash',
    rubricVersion: JUDGE_RUBRIC_VERSION,
    promptVersion: JUDGE_PROMPT_VERSION,
    rubricFingerprint: computeJudgeRubricFingerprint(),
    attemptedSessions: reviews.length,
    reviewedSessions: reviews.length,
    failedSessions: 0,
    failureCodes: {},
    reviews,
    ...(agreement === undefined ? {} : { agreement: agreement as JudgeSnapshotSection['agreement'] }),
    generatedAt: '2026-11-29T00:00:00.000Z',
  };
}

/** 造最小 v1 快照. */
function makeSnapshot(judge?: unknown): Record<string, unknown> {
  return {
    schemaVersion: 1,
    computedAt: '2026-11-29T00:00:00.000Z',
    batchId: 'batch-af616',
    fingerprint: {},
    coverage: { expectedSessions: 1, includedSessions: 1, skippedSessions: 0, totalTurns: 2, transcriptRoot: 'data/x' },
    lineage: [],
    metrics: {},
    byMode: {},
    byCharacter: {},
    judge,
  };
}

describe('AF-616 · 同场配对与一致判定', () => {
  it('按 sessionId 配对, 单侧 null 不计入分母, 顺序不强制', () => {
    const left = [sameReview('s-a', 1), null, sameReview('s-b', 2)];
    const right = [sameReview('s-b', 2), sameReview('s-a', 1), null];
    const pairs = pairJudgeReviews(left, right);

    expect(pairs.map((pair) => pair.sessionId)).toEqual(['s-a', 's-b']);
    expect(pairs.every((pair) => pair.overallAgree)).toBe(true);
  });

  it('完全一致: 三维全同档 → overallAgree=true, 分歧清单空, 信心差为 0', () => {
    const pair = computePair(sameReview('s-same', 1, 0.5), sameReview('s-same', 1, 0.5));

    expect(pair.dimensionAgreements.map((item) => item.agree)).toEqual([true, true, true]);
    expect(pair.overallAgree).toBe(true);
    expect(pair.disagreementDimensions).toEqual([]);
    expect(pair.confidenceDelta).toBe(0);
  });

  it('逐维分歧: 只有安全边界不同档 → 整体不一致, 分歧清单只含该维', () => {
    const left = makeReview('s-diff', [2, 1, 2], 0.7);
    const right = makeReview('s-diff', [2, 0, 2], 0.4);
    const pair = computePair(left, right);

    expect(pair.overallAgree).toBe(false);
    expect(pair.disagreementDimensions).toEqual(['safety_boundary']);
    expect(pair.confidenceDelta).toBe(0.3);
    expect(pair.dimensionAgreements.find((item) => item.dimension === 'safety_boundary')).toMatchObject({
      leftRating: 1,
      rightRating: 0,
      agree: false,
    });
  });
});

describe('AF-616 · 批次聚合与低样本守卫', () => {
  it('单侧 null: 3 场里只有 2 场两侧齐全 → 配对场次 2, 分母按 2 算', () => {
    const pairs = pairJudgeReviews(
      [sameReview('s-1', 1), sameReview('s-2', 2), null],
      [sameReview('s-1', 1), sameReview('s-2', 1), sameReview('s-3', 1)],
    );
    const report = aggregateJudgeAgreement(pairs, { minPairs: 2 });

    expect(report.pairedSessions).toBe(2);
    expect(report.lowSample).toBe(false);
    expect(report.overallAgreementRate).toBe(0.5);
    expect(report.dimensionAgreementRates.empathic_attunement).toBe(0.5);
    expect(report.disagreementDimensionCounts.empathic_attunement).toBe(1);
  });

  it('双侧 null / 无同场交集 → 配对场次 0, 一致率为 null, 不伪造 0', () => {
    const report = aggregateJudgeAgreement(pairJudgeReviews([null], [null]), { minPairs: 5 });

    expect(report.pairedSessions).toBe(0);
    expect(report.lowSample).toBe(true);
    expect(report.overallAgreementRate).toBeNull();
    expect(report.dimensionAgreementRates.empathic_attunement).toBeNull();
    expect(report.disagreementDimensionCounts).toStrictEqual({
      empathic_attunement: 0,
      safety_boundary: 0,
      intervention_structure: 0,
    });
  });

  it('低样本: 2 < 门槛 5 → 三维与整体一致率全 null, 分歧分布仍保留原始计数', () => {
    const pairs = [
      computePair(sameReview('s-low-1', 1), sameReview('s-low-1', 2)),
      computePair(sameReview('s-low-2', 2), sameReview('s-low-2', 2)),
    ];
    const report = aggregateJudgeAgreement(pairs, { minPairs: 5 });

    expect(report.lowSample).toBe(true);
    expect(report.overallAgreementRate).toBeNull();
    for (const dimension of JUDGE_DIMENSIONS) {
      expect(report.dimensionAgreementRates[dimension]).toBeNull();
    }
    expect(report.disagreementDimensionCounts.empathic_attunement).toBe(1);
  });

  it('达到门槛: 4/5 整体一致 → 0.8, 逐维分歧分布可追到具体维度', () => {
    const pairs = [
      computePair(makeReview('s-hi-1', [1, 1, 1], 0.5), makeReview('s-hi-1', [1, 1, 1], 0.5)),
      computePair(makeReview('s-hi-2', [1, 1, 1], 0.5), makeReview('s-hi-2', [1, 1, 1], 0.5)),
      computePair(makeReview('s-hi-3', [1, 1, 1], 0.5), makeReview('s-hi-3', [1, 1, 1], 0.5)),
      computePair(makeReview('s-hi-4', [1, 1, 1], 0.5), makeReview('s-hi-4', [1, 1, 1], 0.5)),
      computePair(makeReview('s-hi-5', [1, 1, 1], 0.5), makeReview('s-hi-5', [1, 2, 1], 0.5)),
    ];
    const report = aggregateJudgeAgreement(pairs, { minPairs: 5 });

    expect(report.overallAgreementRate).toBe(0.8);
    expect(report.dimensionAgreementRates.empathic_attunement).toBe(1);
    expect(report.dimensionAgreementRates.safety_boundary).toBe(0.8);
    expect(report.disagreementDimensionCounts.safety_boundary).toBe(1);
  });
});

describe('AF-616 · 快照 v1 可选 agreement 子段', () => {
  const left = sameReview('s-1', 1);
  const right = sameReview('s-1', 1);
  const pairs = pairJudgeReviews([left, sameReview('s-2', 2)], [right, sameReview('s-2', 2)]);
  const section = buildJudgeAgreementSection(pairs, { minPairs: 2 });

  it('旧快照没有 judge / 没有 agreement 子段 → 照常通过, schemaVersion 仍为 1', () => {
    expect(() => assertBatchMetricsV1(makeSnapshot())).not.toThrow();
    expect(() => assertBatchMetricsV1(makeSnapshot(makeJudgeSection([left, right])))).not.toThrow();
    expect(() => assertBatchMetricsV1(makeSnapshot(makeJudgeSection([left, right], section)))).not.toThrow();
  });

  it('合法 agreement 子段直接校验通过 (三维键齐全, 血缘非空)', () => {
    expect(() => assertJudgeAgreementSection(section)).not.toThrow();
  });

  it('缺维度键 → 拒绝', () => {
    const broken = { ...section, dimensionAgreementRates: { empathic_attunement: 1, safety_boundary: 1 } };
    expect(() => assertJudgeAgreementSection(broken)).toThrow(/intervention_structure/);
  });

  it('低样本却填数值 → 拒绝; 低样本记 null → 通过', () => {
    const low = buildJudgeAgreementSection([computePair(sameReview('s-low', 1), sameReview('s-low', 1))], { minPairs: 3 });
    expect(() => assertJudgeAgreementSection(low)).not.toThrow();
    expect(() => assertJudgeAgreementSection({ ...low, overallAgreementRate: 1 })).toThrow(/低样本/);
  });

  it('无配对却带血缘 / 配对却缺血缘 → 拒绝', () => {
    const empty = buildJudgeAgreementSection([]);
    expect(() => assertJudgeAgreementSection(empty)).not.toThrow();
    expect(() => assertJudgeAgreementSection({ ...empty, leftLineage: section.leftLineage })).toThrow(/血缘/);
    expect(() => assertJudgeAgreementSection({ ...section, leftLineage: null })).toThrow(/leftLineage/);
  });

  it('非法段经 BatchMetricsV1 入口也被拒绝 (batch schema 串接新守卫)', () => {
    const broken = { ...section, dimensionAgreementRates: { empathic_attunement: 1 } };
    expect(() => assertBatchMetricsV1(makeSnapshot(makeJudgeSection([left, right], broken)))).toThrow(/dimensionAgreementRates/);
  });
});

describe('AF-616 · 指标字典 dict-v5', () => {
  const ids = [
    'judge.agreement.paired_sessions',
    'judge.agreement.overall_rate',
    'judge.agreement.empathic_attunement.rate',
    'judge.agreement.empathic_attunement.disagreement_count',
    'judge.agreement.safety_boundary.rate',
    'judge.agreement.safety_boundary.disagreement_count',
    'judge.agreement.intervention_structure.rate',
    'judge.agreement.intervention_structure.disagreement_count',
  ];

  it('版本升到 dict-v5', () => {
    expect(METRIC_DICTIONARY_VERSION).toBe('dict-v5');
  });

  it('八项 agreement 指标齐备, 全部 neutral + nullable', () => {
    for (const id of ids) {
      const metric = METRIC_BY_ID.get(id);
      expect(metric).toBeDefined();
      expect(metric?.direction).toBe('neutral');
      expect(metric?.nullable).toBe(true);
      expect(metric?.definition.length).toBeGreaterThan(0);
    }
  });

  it('一致率类指标 bounds 为 [0,1], 计数类无界', () => {
    expect(METRIC_BY_ID.get('judge.agreement.overall_rate')?.bounds).toStrictEqual({ min: 0, max: 1 });
    expect(METRIC_BY_ID.get('judge.agreement.empathic_attunement.rate')?.bounds).toStrictEqual({ min: 0, max: 1 });
    expect(METRIC_BY_ID.get('judge.agreement.paired_sessions')?.bounds).toBeNull();
    expect(METRIC_BY_ID.get('judge.agreement.safety_boundary.disagreement_count')?.bounds).toBeNull();
  });
});

// 显式引用维度类型, 防止 type-only 导入被 lint 误判为未使用.
const _dimensionTypeCheck: JudgeDimension = 'safety_boundary';
void _dimensionTypeCheck;
