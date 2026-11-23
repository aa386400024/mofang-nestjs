// AF-421 · 在场 delta 幅度扫描口径单测
//   钉住四件事：
//     ① 缩放只做一次乘法（1× 等于不传倍数；未知标签得零增量）；
//     ② 0× 档必须与「完全不叠加 presence」逐字相同（基线不漂）；
//     ③ 正维度增益随倍数单调不减（放大不会让增益反而变小）；
//     ④ 目标倍数解析取最低档，区间内不可达返回 null。
//   边界：不读 data/debug-sessions（合成 trace），不连 DB / 网络。

import { describe, expect, it } from 'vitest';

import {
  SWEEP_MULTIPLIERS,
  countCapBites,
  replayAtMultiplier,
  requiredMultiplierForTarget,
  sweepAmplitudes,
  sweepSession,
  summarizeMultiplier,
} from '../../../scripts/ops/quality/af421-presence-amplitude-sweep.mjs';
import { applyPresenceDelta, pickTracked, scaledPresenceDelta } from '../../../scripts/ops/quality/af418-presence-replay-calibration.mjs';

/** 合成一段"稳定在场但基线不动"的两轮 trace（首轮 safety 0.30）。 */
function syntheticSession(id = 'syn-1') {
  return {
    id,
    traces: [
      { turnIndex: 1, bdiSnapshot: { safety: 0.3, bond: 0.2, trust: 0.3, valence: 0.1, arousal: 0.4, resistanceVerbal: 0.5 } },
      { turnIndex: 2, bdiSnapshot: { safety: 0.3, bond: 0.2, trust: 0.3, valence: 0.1, arousal: 0.4, resistanceVerbal: 0.5 } },
    ],
    labelsByTurn: new Map([[2, 'holding_present']]),
  };
}

/** 合成一段已经贴到上界的 trace（用于触顶判定）。 */
function saturatedSession(id = 'syn-sat') {
  return {
    id,
    traces: [
      { turnIndex: 1, bdiSnapshot: { safety: 0.999, bond: 0.999, trust: 0.999, valence: 0.999, arousal: 0.5 } },
      { turnIndex: 2, bdiSnapshot: { safety: 0.999, bond: 0.999, trust: 0.999, valence: 0.999, arousal: 0.5 } },
    ],
    labelsByTurn: new Map([[2, 'holding_present']]),
  };
}

describe('AF-421 · 在场 delta 幅度扫描', () => {
  it('① 1× 缩放等于不传倍数；未知标签得零增量', () => {
    const state = pickTracked({ safety: 0.3, bond: 0.2, trust: 0.3, valence: 0.1, arousal: 0.4 });
    expect(applyPresenceDelta(state, 'holding_present', 1)).toEqual(applyPresenceDelta(state, 'holding_present'));
    expect(scaledPresenceDelta('unknown_label')).toEqual(
      Object.fromEntries(
        ['trust', 'safety', 'bond', 'valence', 'arousal', 'resistanceVerbal', 'resistanceDepth', 'resistanceStyle'].map((key) => [key, 0]),
      ),
    );
  });

  it('① 2× 是种子幅度的整数倍（含 valence 与阻抗维）', () => {
    const one = scaledPresenceDelta('holding_present', 1);
    const two = scaledPresenceDelta('holding_present', 2);
    expect(two.safety).toBeCloseTo(one.safety * 2, 12);
    expect(two.bond).toBeCloseTo(one.bond * 2, 12);
    expect(two.valence).toBeCloseTo(one.valence * 2, 12);
    expect(two.resistanceVerbal).toBeCloseTo(one.resistanceVerbal * 2, 12);
  });

  it('② 0× 档与「完全不叠加 presence」逐字相同（基线不漂）', () => {
    const session = syntheticSession();
    const zero = replayAtMultiplier(session.traces, new Map(), 1);
    const zeroScaled = replayAtMultiplier(session.traces, session.labelsByTurn, 0);
    expect(zeroScaled.final).toEqual(zero.final);
    const row = sweepSession(session, 0);
    expect(row.safetyGain).toBe(0);
    expect(row.bondGain).toBe(0);
  });

  it('③ 正维度增益随倍数单调不减', () => {
    const sessions = [syntheticSession('a'), syntheticSession('b'), saturatedSession('c')];
    const sweep = sweepAmplitudes(sessions);
    expect(sweep.map((row) => row.multiplier)).toEqual([...SWEEP_MULTIPLIERS]);
    for (let index = 1; index < sweep.length; index += 1) {
      expect(sweep[index].totalSafetyGain).toBeGreaterThanOrEqual(sweep[index - 1].totalSafetyGain);
      expect(sweep[index].totalBondGain).toBeGreaterThanOrEqual(sweep[index - 1].totalBondGain);
    }
  });

  it('③ 1× 档等于种子幅度直接叠加的结果（与 AF-418 单场口径同源）', () => {
    const session = syntheticSession();
    const one = sweepSession(session, 1);
    const last = pickTracked(session.traces.at(-1)?.bdiSnapshot);
    const direct = applyPresenceDelta(last, 'holding_present');
    expect(one.safetyGain).toBeCloseTo(direct.safety - last.safety, 9);
    expect(one.bondGain).toBeCloseTo(direct.bond - last.bond, 9);
  });

  it('触顶判定：已贴到上界的场次会被标出，未贴界的不会', () => {
    const safeRows = [sweepSession(syntheticSession(), 8)];
    expect(safeRows[0].clampedDims).toEqual([]);
    const satRows = [sweepSession(saturatedSession(), 8)];
    expect(satRows[0].clampedDims).toContain('safety');
    expect(summarizeMultiplier(satRows, 8).clampedSessions).toBe(1);
  });

  it('④ 目标倍数取最低档；区间内不可达返回 null', () => {
    const sweep = [
      summarizeMultiplier([sweepSession(syntheticSession(), 0.5)], 0.5),
      summarizeMultiplier([sweepSession(syntheticSession(), 1)], 1),
      summarizeMultiplier([sweepSession(syntheticSession(), 2)], 2),
    ];
    const reachable = requiredMultiplierForTarget(sweep, 0.001);
    expect(reachable).toBe(0.5);
    expect(requiredMultiplierForTarget(sweep, 0.5)).toBeNull();
  });

  it('⑤ cap 触发按「真实 delta + scaled presence」判：8× 越界、1× 不越界', () => {
    // 真实 delta safety 0.19 → 1× presence 0.004 合计 0.194 < 0.20；8× presence 0.032 合计 0.222 > 0.20。
    const traces = [
      { turnIndex: 1, bdiSnapshot: { safety: 0.3 }, delta: { safety: 0 } },
      { turnIndex: 2, bdiSnapshot: { safety: 0.49 }, delta: { safety: 0.19 } },
    ];
    const labels = new Map([[2, 'holding_present']]);
    expect(countCapBites(traces, labels, 1)).toBe(0);
    expect(countCapBites(traces, labels, 8)).toBe(1);
    expect(countCapBites(traces, new Map(), 8)).toBe(0);
  });
});
