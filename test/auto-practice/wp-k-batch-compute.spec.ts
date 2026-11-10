// V2026-11-11 WP-K (批次计算正确性 / 黄金样本 / 确定性 / 合规):
//   手工构造合规输入, 不起 Nest, 不连 DB.

import { describe, expect, it } from 'vitest';

import type { ConfigFingerprintSegments } from '../../src/auto-practice/config-fingerprint.js';
import {
  computeBatchSnapshot,
  type BatchComputeContext,
  type SessionComputationInput,
  type SkippedSession,
  type TraceInput,
} from '../../src/auto-practice/metrics/batch-metrics.compute.js';

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

function snapshot(overrides: Partial<TraceInput['bdiSnapshot']> = {}): TraceInput['bdiSnapshot'] {
  return {
    trust: 0.5,
    safety: 0.5,
    bond: 0.5,
    valence: 0,
    arousal: 0.5,
    resistanceVerbal: 0.4,
    resistanceDepth: 0.4,
    resistanceStyle: 0.4,
    ...overrides,
  };
}

function trace(turnIndex: number, overrides: Partial<TraceInput> = {}): TraceInput {
  return {
    turnIndex,
    bdiSnapshot: snapshot(),
    eventTags: [],
    strategy: 'recounting',
    degraded: false,
    ...overrides,
  };
}

function context(overrides: Partial<BatchComputeContext> = {}): BatchComputeContext {
  return {
    batchId: 'batch-test',
    transcriptRoot: 'data/debug-sessions',
    fingerprint: FP,
    pipeline: { llmCallRatio: 1, fallbackRatio: 0 },
    ...overrides,
  };
}

function session(overrides: Partial<SessionComputationInput> = {}): SessionComputationInput {
  return {
    debugSessionId: 'debug-1',
    characterSlug: 'vpt_test',
    counselorModeId: 'expert',
    status: 'completed',
    fileSha256: 'sha11111111111111',
    traces: [trace(1), trace(2)],
    ...overrides,
  };
}

describe('WP-K · 批次计算正确性', () => {
  it('neutral 场: 八维首末相同 → delta_avg=0, zero_motion 计数 1', () => {
    const result = computeBatchSnapshot([session()], [], 1, context());
    expect(result.metrics['dim.trust.delta_avg']).toBe(0);
    expect(result.metrics['session.zero_motion']).toBe(1);
    expect(result.metrics['event.neutral.rate']).toBe(0); // eventTags 为空, 不计 neutral
  });

  it('empathy 事件 + 末值变化 → 事件率与维度变化正确', () => {
    const s = session({
      debugSessionId: 'debug-2',
      traces: [
        trace(1, { eventTags: ['empathy'] }),
        trace(2, { bdiSnapshot: snapshot({ trust: 0.6, resistanceDepth: 0.3 }), eventTags: ['empathy'] }),
      ],
    });
    const result = computeBatchSnapshot([s], [], 1, context());
    expect(result.metrics['event.empathy.count']).toBe(2);
    expect(result.metrics['event.empathy.rate']).toBe(1);
    expect(result.metrics['dim.trust.delta_avg']).toBe(0.1);
    expect(result.metrics['dim.depth.delta_avg']).toBe(-0.1);
  });

  it('探索策略 → exploration.rate = 1', () => {
    const s = session({
      traces: [trace(1), trace(2, { strategy: 'affective_exploration', bdiSnapshot: snapshot({ valence: -0.2 }) })],
    });
    const result = computeBatchSnapshot([s], [], 1, context());
    expect(result.metrics['exploration.rate']).toBe(1);
    expect(result.metrics['strategy.affective_exploration.count']).toBe(1);
  });

  it('跳过场次进 coverage 且带原因', () => {
    const skipped: SkippedSession[] = [{ debugSessionId: 'debug-missing', reason: 'file_missing' }];
    const result = computeBatchSnapshot([session()], skipped, 2, context());
    expect(result.coverage.includedSessions).toBe(1);
    expect(result.coverage.skippedSessions).toBe(1);
    expect(result.coverage.skipReasons.file_missing).toBe(1);
  });

  it('分组 byMode / byCharacter 正确生成', () => {
    const result = computeBatchSnapshot([session()], [], 1, context());
    expect(result.byMode['expert'].sessions).toBe(1);
    expect(result.byCharacter['vpt_test'].sessions).toBe(1);
  });

  it('管道 fallback_ratio 为 null 时指标为 null', () => {
    const result = computeBatchSnapshot([session()], [], 1, context({ pipeline: { llmCallRatio: 1, fallbackRatio: null } }));
    expect(result.metrics['pipeline.fallback_ratio']).toBeNull();
  });
});

describe('WP-K · 黄金样本 (回归护栏)', () => {
  it('固定输入 → 关键字段逐字相等', () => {
    const result = computeBatchSnapshot([session()], [], 1, context());
    expect(result).toMatchObject({
      schemaVersion: 1,
      batchId: 'batch-test',
      coverage: { expectedSessions: 1, includedSessions: 1, skippedSessions: 0, totalTurns: 2 },
      lineage: [
        { debugSessionId: 'debug-1', characterSlug: 'vpt_test', counselorModeId: 'expert', turns: 2, fileSha256: 'sha11111111111111' },
      ],
    });
  });
});

describe('WP-K · 确定性与合规', () => {
  it('同输入两次深相等 (除 computedAt)', () => {
    const a = computeBatchSnapshot([session()], [], 1, context());
    const b = computeBatchSnapshot([session()], [], 1, context());
    expect({ ...a, computedAt: '' }).toEqual({ ...b, computedAt: '' });
  });

  it('快照内所有字符串值长度 ≤ 64 (挡住台词泄漏)', () => {
    const result = computeBatchSnapshot([session()], [], 1, context());
    const check = (value: unknown): void => {
      if (typeof value === 'string') {
        expect(value.length).toBeLessThanOrEqual(64);
      } else if (Array.isArray(value)) {
        for (const item of value) check(item);
      } else if (typeof value === 'object' && value !== null) {
        for (const item of Object.values(value)) check(item);
      }
    };
    check(result);
  });
});
