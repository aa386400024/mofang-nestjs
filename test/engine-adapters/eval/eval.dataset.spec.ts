// V2026-11-09 治本 (Phase2.5 WP-E · 数据清洗单测):
//   目的: 把任务单 §5.1 的四条清洗门槛**逐条钉死** —— 轮次不足 / 中途报错 /
//         BDI 状态异常 / 闸门 trace 缺失, 以及"扔了多少、为什么扔"的统计口径.
//
//   为什么清洗门槛必须有单测:
//     清洗规则一旦漂移, 同一份数据集两次评测的分数就不可比 —— 而"跟上一版比"
//     正是这条流水线的存在理由. 门槛变了必须有人被拦下.
//
//   边界: 纯判定 + 少量文件系统读写 (临时目录), 不起 Nest 容器, 不连数据库.
//
//   验证: npx vitest run test/engine-adapters/eval/eval.dataset.spec.ts

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  cleanEvalDataset,
  DEFAULT_EVAL_CLEANING_THRESHOLDS,
  detectBdiAnomaly,
  detectSessionError,
  listEvalDatasetVersions,
  loadEvalDatasetFromDirectory,
  parseSupervisorCases,
  toBdiSnapshot,
} from '../../../src/engine-adapters/eval/eval.dataset.js';
import type { EvalCompactState, EvalDataset, EvalSessionRecord, EvalTurnRecord } from '../../../src/engine-adapters/eval/eval.types.js';

/** 造一份中性状态. */
function neutralState(overrides: Partial<EvalCompactState> = {}): EvalCompactState {
  return {
    trust: 0.5,
    safety: 0.5,
    bond: 0.5,
    valence: 0,
    arousal: 0.3,
    verbal: 0.3,
    depth: 0.3,
    style: 0.3,
    positive: 0.05,
    negative: 0.05,
    dependency: 0.05,
    ...overrides,
  };
}

/** 造一轮记录 (默认: 平静轮, 有闸门 trace). */
function makeTurn(turnIndex: number, overrides: Partial<EvalTurnRecord> = {}): EvalTurnRecord {
  // ⚠️ 状态必须**逐轮微动**: 整场不变会被"连续 3 轮全维度不变"判成引擎卡死 (脏数据).
  const before = neutralState({ trust: 0.5 + turnIndex * 0.001 });
  const after = neutralState({ trust: 0.5 + (turnIndex + 1) * 0.001 });
  return {
    turnIndex,
    before,
    after,
    events: ['empathy'],
    riskLevel: 'low',
    ruleDelta: { trust: 0.01 },
    llmDelta: { trust: 0.02 },
    gateDecision: 'run',
    gateReason: 'alliance_delta_high',
    degraded: false,
    hasError: false,
    totalTokens: 500,
    ...overrides,
  };
}

/** 造一场会话 (默认 6 轮, 全干净). */
function makeSession(sessionId: string, turnCount = 6, overrides: Partial<EvalTurnRecord> = {}): EvalSessionRecord {
  const turns: EvalTurnRecord[] = [];
  for (let index = 1; index <= turnCount; index += 1) {
    turns.push(makeTurn(index, overrides));
  }
  return { sessionId, split: 'validation', turns };
}

/** 造一个数据集. */
function makeDataset(sessions: EvalSessionRecord[]): EvalDataset {
  return { version: 'test-v1', split: 'validation', synthetic: true, sessions };
}

describe('cleanEvalDataset', () => {
  it('干净的会话全部保留', () => {
    const result = cleanEvalDataset(makeDataset([makeSession('s1'), makeSession('s2')]));
    expect(result.quality.totalSessions).toBe(2);
    expect(result.quality.validSessions).toBe(2);
    expect(result.quality.droppedSessions).toBe(0);
    expect(result.dataset.sessions).toHaveLength(2);
  });

  it('轮次不足的会话被丢掉 (too_short)', () => {
    const result = cleanEvalDataset(makeDataset([makeSession('short', DEFAULT_EVAL_CLEANING_THRESHOLDS.minTurns - 1)]));
    expect(result.quality.dropReasons.too_short).toBe(1);
    expect(result.quality.validSessions).toBe(0);
    expect(result.dropped[0].reason).toBe('too_short');
  });

  it('中途报错 / 降级的会话被丢掉 (has_error)', () => {
    const errored = makeSession('err', 6, { hasError: true });
    const degraded = makeSession('deg', 6, { degraded: true });
    const result = cleanEvalDataset(makeDataset([errored, degraded]));
    expect(result.quality.dropReasons.has_error).toBe(2);
    expect(result.quality.validSessions).toBe(0);
  });

  it('BDI 状态异常的会话被丢掉 (bdi_anomaly)', () => {
    const turns = [makeTurn(1), makeTurn(2), makeTurn(3), makeTurn(4), makeTurn(5)];
    // trust 单轮跳 0.5 (>= 阈值) = 状态突变.
    turns[2] = makeTurn(3, { before: neutralState({ trust: 0.45 }), after: neutralState({ trust: 0.95 }) });
    const result = cleanEvalDataset(makeDataset([{ sessionId: 'anomaly', split: 'validation', turns }]));
    expect(result.quality.dropReasons.bdi_anomaly).toBe(1);
    expect(result.dropped[0].detail).toContain('跳变');
  });

  it('闸门 trace 全缺失的会话被丢掉 (missing_gate_trace), 部分缺失只计数', () => {
    const noTrace = makeSession('no-trace', 6, { gateDecision: null });
    const partial = makeSession('partial', 6);
    const partialTurns = partial.turns.map((turn, index) => (index === 0 ? { ...turn, gateDecision: null } : turn));
    const result = cleanEvalDataset(makeDataset([noTrace, { sessionId: 'partial', split: 'validation', turns: partialTurns }]));
    expect(result.quality.dropReasons.missing_gate_trace).toBe(1);
    expect(result.quality.validSessions).toBe(1);
    // 6 轮 (全缺 trace 的那场) + 1 轮 (部分缺失的那场) = 7.
    expect(result.quality.turnsWithMissingGateTrace).toBe(7);
  });

  it('四条门槛的丢弃原因互不串台', () => {
    const result = cleanEvalDataset(
      makeDataset([
        makeSession('a', 2),
        makeSession('b', 6, { hasError: true }),
        {
          sessionId: 'c',
          split: 'validation',
          turns: [makeTurn(1), makeTurn(2), makeTurn(3), makeTurn(4), makeTurn(5, { after: neutralState({ trust: 1.2 }) })],
        },
        makeSession('d', 6, { gateDecision: null }),
      ]),
    );
    expect(result.quality.dropReasons).toEqual({
      too_short: 1,
      has_error: 1,
      bdi_anomaly: 1,
      missing_gate_trace: 1,
    });
    expect(result.quality.droppedSessions).toBe(4);
    expect(result.quality.validSessions).toBe(0);
  });
});

describe('detectBdiAnomaly', () => {
  it('连续多轮全维度不变 = 引擎卡死', () => {
    // 四轮状态完全不动 (before == after) → 连续 3 轮不变 → 判为引擎卡死.
    const flat = { before: neutralState({ trust: 0.5 }), after: neutralState({ trust: 0.5 }) };
    const turns = [makeTurn(1, flat), makeTurn(2, flat), makeTurn(3, flat), makeTurn(4, flat)];
    const detail = detectBdiAnomaly(turns, DEFAULT_EVAL_CLEANING_THRESHOLDS);
    expect(detail).toContain('不变');
  });

  it('正常演化的会话没有异常', () => {
    const turns = [
      makeTurn(1, { after: neutralState({ trust: 0.52 }) }),
      makeTurn(2, { after: neutralState({ trust: 0.55 }) }),
      makeTurn(3, { after: neutralState({ trust: 0.54 }) }),
    ];
    expect(detectBdiAnomaly(turns, DEFAULT_EVAL_CLEANING_THRESHOLDS)).toBeNull();
  });

  it('越界值被判为异常', () => {
    const turns = [makeTurn(1, { after: neutralState({ safety: 1.4 }) })];
    expect(detectBdiAnomaly(turns, DEFAULT_EVAL_CLEANING_THRESHOLDS)).toContain('越界');
  });
});

describe('detectSessionError', () => {
  it('干净会话没有错误', () => {
    expect(detectSessionError([makeTurn(1)])).toBeNull();
  });
  it('降级也算脏数据', () => {
    expect(detectSessionError([makeTurn(1, { degraded: true })])).toContain('降级');
  });
});

describe('parseSupervisorCases', () => {
  it('把督导标注解析成真值, 逐字稿不进数据集', () => {
    const dataset = parseSupervisorCases(
      {
        caseId: 'case-001',
        counselorTurns: ['第一句', '第二句'],
        visitorTurns: ['回应一', '回应二'],
        supervisorNotes: [{ turnIndex: 2, issue: '过早给建议', expectedDeltas: { trust: -0.05, bond: -0.03 } }],
      },
      'supervisor-v1',
    );
    expect(dataset.split).toBe('validation');
    expect(dataset.synthetic).toBe(false);
    expect(dataset.sessions).toHaveLength(1);
    const turns = dataset.sessions[0].turns;
    expect(turns).toHaveLength(2);
    expect(turns[0].expectedShouldRun).toBe(false);
    expect(turns[1].expectedShouldRun).toBe(true);
    expect(turns[1].expectedDeltas).toEqual({ trust: -0.05, bond: -0.03 });
    expect(JSON.stringify(dataset)).not.toContain('过早给建议');
    expect(JSON.stringify(dataset)).not.toContain('第一句');
  });
});

describe('数据集读写', () => {
  it('能列出版本并读出数据集', () => {
    const root = mkdtempSync(join(tmpdir(), 'eval-dataset-'));
    try {
      const dir = join(root, 'demo-v1');
      mkdirSync(dir);
      writeFileSync(join(dir, 'dataset.json'), JSON.stringify(makeDataset([makeSession('s1')])), 'utf8');
      expect(listEvalDatasetVersions(root)).toContain('demo-v1');
      const dataset = loadEvalDatasetFromDirectory(dir);
      expect(dataset.version).toBe('test-v1');
      expect(dataset.sessions).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('toBdiSnapshot', () => {
  it('紧凑状态还原成内核快照 (维度齐全)', () => {
    const snapshot = toBdiSnapshot(neutralState({ trust: 0.7, safety: 0.6, bond: 0.55, verbal: 0.4 }));
    expect(snapshot.trust).toBe(0.7);
    expect(snapshot.safety).toBe(0.6);
    expect(snapshot.bond).toBe(0.55);
    expect(snapshot.resistance.verbal).toBe(0.4);
    expect(snapshot.emotion.valence).toBe(0);
    // 内核槽位一个都不能少 (少一个 = buildStateComparison 少算一维).
    expect(Array.isArray(snapshot.coreBeliefs)).toBe(true);
    expect(Array.isArray(snapshot.underlyingDesires)).toBe(true);
  });
});
