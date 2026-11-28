// AF-611 · v1 快照可选 Judge 段守卫: 旧快照缺省通过 / 合法段通过 / 非法评级·缺理由·缺血缘·缺证据拒绝.

import { describe, expect, it } from 'vitest';

import { makeSession, makeTurn, makeValidResult } from './judge-test-fixtures.js';
import { assertBatchMetricsV1 } from '../../../src/auto-practice/metrics/batch-metrics.schema.js';
import { assertJudgeSnapshotSection } from '../../../src/engine-adapters/judge/judge.contract.js';
import {
  JUDGE_PROMPT_VERSION,
  JUDGE_RUBRIC_VERSION,
  computeJudgeRubricFingerprint,
} from '../../../src/engine-adapters/judge/judge.rubric.js';
import { buildJudgeInput } from '../../../src/engine-adapters/judge/judge.shadow.js';
import type { JudgeSnapshotSection, JudgeReviewResult } from '../../../src/engine-adapters/judge/judge.types.js';
import { JUDGE_MACHINE_PROXY_LABEL } from '../../../src/engine-adapters/judge/judge.types.js';

/** 造一份最小合法 v1 快照. */
function makeSnapshot(judge?: unknown): Record<string, unknown> {
  return {
    schemaVersion: 1,
    computedAt: '2026-11-29T00:00:00.000Z',
    batchId: 'batch-af611',
    fingerprint: {},
    coverage: { expectedSessions: 1, includedSessions: 1, skippedSessions: 0, totalTurns: 2, transcriptRoot: 'data/x' },
    lineage: [],
    metrics: {},
    byMode: {},
    byCharacter: {},
    ...(judge === undefined ? {} : { judge }),
  };
}

/** 造合法 Judge 段. */
function makeSection(review: JudgeReviewResult): JudgeSnapshotSection {
  return {
    mode: 'shadow',
    machineProxy: true,
    disclaimer: JUDGE_MACHINE_PROXY_LABEL,
    providerId: 'minimax',
    model: 'MiniMax-M3.1-Flash',
    rubricVersion: JUDGE_RUBRIC_VERSION,
    promptVersion: JUDGE_PROMPT_VERSION,
    rubricFingerprint: computeJudgeRubricFingerprint(),
    attemptedSessions: 1,
    reviewedSessions: 1,
    failedSessions: 0,
    failureCodes: {},
    reviews: [review],
    generatedAt: '2026-11-29T00:00:00.000Z',
  };
}

/** 造一份合法评审. */
function makeReview(): JudgeReviewResult {
  const input = buildJudgeInput(makeSession('s-snapshot', [makeTurn(1), makeTurn(2)]), {
    providerId: 'minimax',
    model: 'MiniMax-M3.1-Flash',
  });
  if (input === null) throw new Error('fixture input missing');
  return makeValidResult(input);
}

describe('AF-611 · v1 快照可选 Judge 段', () => {
  it('旧快照没有 judge 字段 → 照常通过 (schemaVersion 保持 1)', () => {
    expect(() => assertBatchMetricsV1(makeSnapshot())).not.toThrow();
  });

  it('judge=null → 通过 (整段失败但快照仍合法)', () => {
    expect(() => assertBatchMetricsV1(makeSnapshot(null))).not.toThrow();
  });

  it('合法可选段 (评级/理由/证据/信心度/血缘齐备) → 通过', () => {
    expect(() => assertBatchMetricsV1(makeSnapshot(makeSection(makeReview())))).not.toThrow();
  });

  it('非法评级 (3) → 拒绝', () => {
    const review = makeReview();
    const broken = {
      ...makeSection(review),
      reviews: [{ ...review, ratings: review.ratings.map((item, index) => (index === 0 ? { ...item, rating: 3 } : item)) }],
    };
    expect(() => assertJudgeSnapshotSection(broken)).toThrow(/rating/);
  });

  it('缺理由 → 拒绝', () => {
    const review = makeReview();
    const broken = {
      ...makeSection(review),
      reviews: [{ ...review, ratings: review.ratings.map((item, index) => (index === 0 ? { ...item, reason: ' ' } : item)) }],
    };
    expect(() => assertJudgeSnapshotSection(broken)).toThrow(/reason/);
  });

  it('缺血缘 → 拒绝', () => {
    const review = makeReview();
    const broken = {
      ...makeSection(review),
      reviews: [{ ...review, lineage: undefined }],
    };
    expect(() => assertJudgeSnapshotSection(broken)).toThrow(/血缘/);
  });

  it('缺证据引用 → 拒绝', () => {
    const review = makeReview();
    const broken = {
      ...makeSection(review),
      reviews: [{ ...review, ratings: review.ratings.map((item, index) => (index === 0 ? { ...item, evidenceRefs: [] } : item)) }],
    };
    expect(() => assertJudgeSnapshotSection(broken)).toThrow(/evidenceRefs/);
  });

  it('计数不自洽 (reviewed+failed ≠ attempted) → 拒绝', () => {
    const section = { ...makeSection(makeReview()), attemptedSessions: 2 };
    expect(() => assertJudgeSnapshotSection(section)).toThrow(/计数/);
  });
});
