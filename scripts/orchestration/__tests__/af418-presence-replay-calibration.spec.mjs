// AF-418 · 在场投影同源校准单测
//   ① PRESENCE_DELTAS 与内核 aggregateTurnDelta 逐字段一致（防第三份拷贝漂移）
//   ② 11 维 presence delta 正确映射到八维快照
//   ③ 逐轮重放不含标签时逐字还原末轮快照
//   ④ 合成饱和场景：末轮单次加法与逐轮重放出现可检测差值
//   ⑤ 批次汇总正确统计饱和场次
//
//   验证: pnpm exec vitest run scripts/orchestration/__tests__/af418-presence-replay-calibration.spec.mjs

import { describe, expect, it } from 'vitest';

import { aggregateTurnDelta } from '../../../src/engine-core/index.js';
import { PRESENCE_DELTAS } from '../../ops/quality/af408-presence-calibration.mjs';
import {
  addClamped,
  applyPresenceDelta,
  diffTracked,
  pickTracked,
  replaySession,
  summarizeReplay,
  summarizeReplaySession,
  TRACKED_KEYS,
} from '../../ops/quality/af418-presence-replay-calibration.mjs';

/**
 * 构造八维快照.
 *
 * @param {Partial<Record<string, number>>} overrides 覆盖值
 * @returns {Record<string, number>} 八维快照
 */
function snapshot(overrides) {
  const base = {
    trust: 0.35,
    safety: 0.4,
    bond: 0.5,
    valence: -0.4,
    arousal: 0.72,
    resistanceVerbal: 0.55,
    resistanceDepth: 0.3,
    resistanceStyle: 0.3,
  };
  return { ...base, ...overrides };
}

/**
 * 构造带快照的 trace.
 *
 * @param {number} turnIndex 轮次
 * @param {Record<string, number>} body 八维快照
 * @returns {{turnIndex:number,bdiSnapshot:Record<string,number>}} trace
 */
function trace(turnIndex, body) {
  return { turnIndex, bdiSnapshot: snapshot(body) };
}

describe('AF-418 在场投影同源校准', () => {
  it('PRESENCE_DELTAS 与内核 aggregateTurnDelta 逐字段一致', () => {
    for (const label of ['holding_present', 'cold_absent']) {
      const kernel = aggregateTurnDelta([{ kind: label, matchedTerms: [], strength: 1 }]);
      expect(kernel, label).toMatchObject(PRESENCE_DELTAS[label]);
      expect(Object.keys(kernel).toSorted(), label).toEqual(Object.keys(PRESENCE_DELTAS[label]).toSorted());
    }
  });

  it('11 维 presence delta 映射到八维快照，并遵守阻抗三分量', () => {
    const before = snapshot({});
    const after = applyPresenceDelta(before, 'holding_present');
    expect(after.safety).toBeCloseTo(0.404, 10);
    expect(after.bond).toBeCloseTo(0.502, 10);
    expect(after.resistanceVerbal).toBeCloseTo(0.548, 10);
    expect(after.resistanceDepth).toBeCloseTo(0.3, 10);
    expect(after.resistanceStyle).toBeCloseTo(0.3, 10);
    expect(after.valence).toBeCloseTo(-0.396, 10);
    expect(after.trust).toBeCloseTo(0.35, 10);
  });

  it('逐轮重放不含标签时逐字还原末轮快照（含 valence 负值区间）', () => {
    const traces = [trace(1, { valence: 0.4 }), trace(2, { valence: -0.2 }), trace(3, { valence: -0.25 })];
    const result = replaySession(traces, new Map());
    expect(result.baseEqual).toBe(true);
    const last = pickTracked(traces.at(-1).bdiSnapshot);
    for (const key of TRACKED_KEYS) expect(result.replayFinal[key]).toBeCloseTo(last[key], 12);
  });

  it('合成饱和场景：末轮单次加法与逐轮重放出现可检测差值', () => {
    const traces = [trace(1, { safety: 0.998 }), trace(2, { safety: 1 }), trace(3, { safety: 1 })];
    const labels = new Map([
      [1, 'holding_present'],
      [2, 'holding_present'],
      [3, 'cold_absent'],
    ]);
    const result = replaySession(traces, labels);
    expect(result.flatFinal.safety).toBe(1);
    expect(result.replayFinal.safety).toBeCloseTo(0.998, 10);
    const row = summarizeReplaySession({ id: 'synthetic', traces, labelsByTurn: labels });
    expect(row.saturated).toBe(true);
    expect(row.safetyDiff).toBeCloseTo(0.002, 6);
  });

  it('批次汇总统计饱和场次与最大单场差', () => {
    const saturated = summarizeReplaySession({
      id: 'a',
      traces: [trace(1, { safety: 0.998 }), trace(2, { safety: 1 }), trace(3, { safety: 1 })],
      labelsByTurn: new Map([
        [1, 'holding_present'],
        [2, 'holding_present'],
        [3, 'cold_absent'],
      ]),
    });
    const plain = summarizeReplaySession({
      id: 'b',
      traces: [trace(1, { safety: 0.4 }), trace(2, { safety: 0.5 })],
      labelsByTurn: new Map([[1, 'holding_present']]),
    });
    const summary = summarizeReplay([saturated, plain]);
    expect(summary.sessions).toBe(2);
    expect(summary.saturatedSessions).toBe(1);
    expect(summary.maxSafetyDiff).toBeCloseTo(0.002, 6);
    expect(summary.baseDriftSessions).toBe(0);
  });

  it('addClamped 对 valence 用 [-1,1]，其余用 [0,1]', () => {
    const state = pickTracked(snapshot({ safety: 0.9, valence: -0.9 }));
    const next = addClamped(state, {
      safety: 0.5,
      valence: -0.5,
      trust: 0,
      bond: 0,
      arousal: 0,
      resistanceVerbal: 0,
      resistanceDepth: 0,
      resistanceStyle: 0,
    });
    expect(next.safety).toBe(1);
    expect(next.valence).toBe(-1);
  });

  it('flatProjection 与逐轮重放在无饱和时数值一致', () => {
    const traces = [trace(1, { safety: 0.4, bond: 0.5 }), trace(2, { safety: 0.41, bond: 0.51 })];
    const labelsByTurn = new Map([
      [1, 'holding_present'],
      [2, 'holding_present'],
    ]);
    const result = replaySession(traces, labelsByTurn);
    expect(result.replayFinal.safety).toBeCloseTo(result.flatFinal.safety, 10);
    expect(result.replayFinal.bond).toBeCloseTo(result.flatFinal.bond, 10);
    expect(diffTracked(traces[0].bdiSnapshot, traces[1].bdiSnapshot).safety).toBeCloseTo(0.01, 10);
  });
});
