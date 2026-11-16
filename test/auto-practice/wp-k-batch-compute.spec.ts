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
import {
  EMPTY_DISFLUENCY_METRICS,
  type DisfluencyCounts,
  type DisfluencyMetrics,
} from '../../src/auto-practice/metrics/disfluency-lexicon.js';

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
    disfluency: EMPTY_DISFLUENCY_METRICS,
    ...overrides,
  };
}

/** 构造一份不流利数值 (纯数值, 与服务层投影同形状). */
function disfluency(counts: Partial<DisfluencyCounts>, normalizedLength = 100): DisfluencyMetrics {
  const merged: DisfluencyCounts = { ...EMPTY_DISFLUENCY_METRICS.counts, ...counts };
  const events = merged.filler + merged.pause + merged.repetition + merged.repair + merged.trailoff + merged.elongation;
  return { counts: merged, events, hasEvent: events > 0, normalizedLength };
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

describe('Phase3 P0 · text.disfluency.* 聚合 (纯数值投影)', () => {
  it('八指标: 全局与 byMode / byCharacter 切片一致', () => {
    const s = session({
      traces: [trace(1, { disfluency: disfluency({ filler: 2, pause: 1 }) }), trace(2, { disfluency: disfluency({ repair: 1 }) })],
    });
    const result = computeBatchSnapshot([s], [], 1, context());
    // 4 个事件 / 2 轮 = 2; 每轮 100 归一化字符 → 4 / 200 * 100 = 2.
    expect(result.metrics['text.disfluency.events_per_turn']).toBe(2);
    expect(result.metrics['text.disfluency.event_turn_rate']).toBe(1);
    expect(result.metrics['text.disfluency.density_per100']).toBe(2);
    expect(result.metrics['text.disfluency.filler_per_turn']).toBe(1);
    expect(result.metrics['text.disfluency.pause_per_turn']).toBe(0.5);
    expect(result.metrics['text.disfluency.repair_per_turn']).toBe(0.5);
    expect(result.metrics['text.disfluency.repetition_per_turn']).toBe(0);
    expect(result.metrics['text.disfluency.trailoff_per_turn']).toBe(0);
    expect(result.byMode['expert']?.metrics['text.disfluency.events_per_turn']).toBe(2);
    expect(result.byCharacter['vpt_test']?.metrics['text.disfluency.filler_per_turn']).toBe(1);
  });

  it('零值兜底轮次: 八指标为 0, 不留 null', () => {
    const result = computeBatchSnapshot([session()], [], 1, context());
    for (const id of [
      'text.disfluency.events_per_turn',
      'text.disfluency.event_turn_rate',
      'text.disfluency.density_per100',
      'text.disfluency.filler_per_turn',
      'text.disfluency.pause_per_turn',
      'text.disfluency.repair_per_turn',
      'text.disfluency.repetition_per_turn',
      'text.disfluency.trailoff_per_turn',
    ]) {
      expect(result.metrics[id]).toBe(0);
    }
  });

  it('elongation 计入事件总量, 但不单列 per-turn 指标', () => {
    const s = session({
      traces: [trace(1, { disfluency: disfluency({ elongation: 2 }) }), trace(2)],
    });
    const result = computeBatchSnapshot([s], [], 1, context());
    expect(result.metrics['text.disfluency.events_per_turn']).toBe(1);
    expect(result.metrics['text.disfluency.event_turn_rate']).toBe(0.5);
    expect(result.metrics['text.disfluency.elongation_per_turn']).toBeUndefined();
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

describe('C5-1 · 探索指标分层 (角色覆盖 · 纯观测)', () => {
  /** 跨角色 / 跨模式的固定场次: vpt_a 两场 (各含探索), vpt_b 一场 (无探索). */
  const MIXED = [
    session({
      debugSessionId: 'd1',
      characterSlug: 'vpt_a',
      counselorModeId: 'expert',
      traces: [trace(1, { strategy: 'affective_exploration' }), trace(2)],
    }),
    session({
      debugSessionId: 'd2',
      characterSlug: 'vpt_b',
      counselorModeId: 'expert',
      traces: [trace(1), trace(2)],
    }),
    session({
      debugSessionId: 'd3',
      characterSlug: 'vpt_a',
      counselorModeId: 'cold',
      traces: [trace(1, { strategy: 'cognitive_exploration' }), trace(2)],
    }),
  ];

  it('切片内 exploration.rate = 各自切片内的场次比例 (不只是 sessions 数)', () => {
    const result = computeBatchSnapshot(MIXED, [], 3, context());

    // 全局: 3 场里 2 场含探索 → 场次比例 2/3.
    expect(result.metrics['exploration.rate']).toBe(0.666667);
    // byMode[expert]: 2 场里 1 场含探索 → 1/2.
    expect(result.byMode['expert']?.metrics['exploration.rate']).toBe(0.5);
    // byMode[cold]: 1 场含探索 → 1.
    expect(result.byMode['cold']?.metrics['exploration.rate']).toBe(1);
    // byCharacter[vpt_a]: 2 场都含探索 → 1; byCharacter[vpt_b]: 0 场含探索 → 0.
    expect(result.byCharacter['vpt_a']?.metrics['exploration.rate']).toBe(1);
    expect(result.byCharacter['vpt_b']?.metrics['exploration.rate']).toBe(0);
  });

  it('覆盖率 a: 多角色仅一个含探索 → 1/N; 与场次比例 rate 口径不同 (两值分别断言)', () => {
    const result = computeBatchSnapshot(MIXED, [], 3, context());

    // 角色维度: 覆盖到的角色 = {vpt_a, vpt_b} = 2; 含探索的角色 = {vpt_a} = 1 → 1/2.
    expect(result.metrics['exploration.character_coverage']).toBe(0.5);
    // 场次维度: 3 场里 2 场含探索 → 2/3 (与覆盖率**不是**同一个数).
    expect(result.metrics['exploration.rate']).toBe(0.666667);
  });

  it('覆盖率 b: 全部角色都至少有 1 场探索 → 1', () => {
    const allExplored = [
      session({ characterSlug: 'vpt_a', traces: [trace(1, { strategy: 'affective_exploration' }), trace(2)] }),
      session({ characterSlug: 'vpt_b', traces: [trace(1, { strategy: 'cognitive_exploration' }), trace(2)] }),
    ];
    const result = computeBatchSnapshot(allExplored, [], 2, context());

    expect(result.metrics['exploration.character_coverage']).toBe(1);
    expect(result.metrics['exploration.rate']).toBe(1);
  });

  it('覆盖率 c: 空场次集合 → 0 (不抛错, 不为 null)', () => {
    const result = computeBatchSnapshot([], [], 0, context());

    expect(result.metrics['exploration.character_coverage']).toBe(0);
    expect(result.metrics['exploration.rate']).toBe(0);
    expect(result.byMode).toEqual({});
    expect(result.byCharacter).toEqual({});
  });

  it('覆盖率 d: 同一角色多场只算一个角色 (角色级去重, 不按场次重复计数)', () => {
    const result = computeBatchSnapshot(MIXED, [], 3, context());

    // vpt_a 跑了两场 —— 若按场次计, 分子分母会变成 2/3 = 0.333333.
    expect(result.metrics['exploration.character_coverage']).toBe(0.5);
    expect(result.metrics['exploration.rate']).toBe(0.666667);
  });

  it('覆盖率 e: 切片退化 —— byCharacter 切片值 ∈ {0, 1}; byMode 分组内口径正确', () => {
    const result = computeBatchSnapshot(MIXED, [], 3, context());

    // 单角色切片: 有探索 → 1, 无探索 → 0 (不是场次比例, 也不是 1/N).
    expect(result.byCharacter['vpt_a']?.metrics['exploration.character_coverage']).toBe(1);
    expect(result.byCharacter['vpt_b']?.metrics['exploration.character_coverage']).toBe(0);
    // byMode[expert] 内含 vpt_a / vpt_b 两个角色 → 1/2; byMode[cold] 内只有 vpt_a → 1.
    expect(result.byMode['expert']?.metrics['exploration.character_coverage']).toBe(0.5);
    expect(result.byMode['cold']?.metrics['exploration.character_coverage']).toBe(1);
  });

  it('覆盖率 f: 确定性 —— 同输入两次快照深相等 (除 computedAt), 新指标值一致', () => {
    const a = computeBatchSnapshot(MIXED, [], 3, context());
    const b = computeBatchSnapshot(MIXED, [], 3, context());

    expect({ ...a, computedAt: '' }).toEqual({ ...b, computedAt: '' });
    expect(a.metrics['exploration.character_coverage']).toBe(b.metrics['exploration.character_coverage']);
  });
});
