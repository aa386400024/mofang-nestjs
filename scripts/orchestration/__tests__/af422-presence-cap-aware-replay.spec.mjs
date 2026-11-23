// AF-422 · cap 感知在场增益重放单测
//   钉四件事：
//     ① 脚本里的 cap 边界与内核 DEFAULT_DELTA_CAP_CONFIG 逐维一致（第三份拷贝靠断言兜住）；
//     ② 「cap(real+presence) − cap(real)」三条性质：有余量=全额、已封顶=0、临界=余量；
//     ③ 1× 档有效增益与 AF-421 未接 cap 口径逐字一致（当前数据 cap 损失为 0）；
//     ④ 0× 档零增益，正维度随倍数单调不减。
//   边界：不读 data/debug-sessions（合成 trace），不连 DB / 网络。

import { describe, expect, it } from 'vitest';

import { DEFAULT_DELTA_CAP_CONFIG } from '../../../src/engine-core/index.js';

import {
  CAP_BOUNDS,
  CAP_SWEEP_MULTIPLIERS,
  capDelta,
  presenceExtraUnderCap,
  replayCapAware,
  summarizeCapAware,
  sweepCapAware,
} from '../../../scripts/ops/quality/af422-presence-cap-aware-replay.mjs';
import { sweepAmplitudes } from '../../../scripts/ops/quality/af421-presence-amplitude-sweep.mjs';

/** 合成两轮 trace：真实 safety delta 可调。 */
function syntheticSession(realSafety, id = 'syn') {
  return {
    id,
    traces: [
      { turnIndex: 1, bdiSnapshot: { safety: 0.2, bond: 0.2, valence: 0.1 }, delta: { safety: 0 } },
      { turnIndex: 2, bdiSnapshot: { safety: 0.2 + realSafety, bond: 0.2, valence: 0.1 }, delta: { safety: realSafety } },
    ],
    labelsByTurn: new Map([[2, 'holding_present']]),
  };
}

describe('AF-422 · cap 感知在场增益重放', () => {
  it('① cap 边界与内核 DEFAULT_DELTA_CAP_CONFIG 逐维一致', () => {
    for (const [dim, bounds] of Object.entries(DEFAULT_DELTA_CAP_CONFIG)) {
      expect(CAP_BOUNDS[dim]).toEqual({ up: bounds.up, down: bounds.down });
    }
    expect(Object.keys(CAP_BOUNDS).sort()).toEqual(Object.keys(DEFAULT_DELTA_CAP_CONFIG).sort());
  });

  it('① capDelta 只砍越界方向，合法值原样保留', () => {
    const capped = capDelta({ safety: 0.5, trust: -0.5, bond: 0.01, positive: 0.2 });
    expect(capped.safety).toBe(0.2);
    expect(capped.trust).toBe(-0.3);
    expect(capped.bond).toBe(0.01);
    expect(capped.positive).toBe(0.15);
  });

  it('② 真实 delta 有余量 → presence 全额生效', () => {
    const { extra, full } = presenceExtraUnderCap({ safety: 0.05 }, 'holding_present', 1);
    expect(extra.safety).toBeCloseTo(full.safety, 12);
    expect(extra.safety).toBeCloseTo(0.004, 12);
  });

  it('② 真实 delta 已顶到 cap → presence 全被吃掉', () => {
    const { extra, full } = presenceExtraUnderCap({ safety: 0.2 }, 'holding_present', 8);
    expect(full.safety).toBeCloseTo(0.032, 12);
    expect(extra.safety).toBe(0);
  });

  it('② 临界余量 → 只生效剩下一半', () => {
    // 余量 0.01，presence 0.032 → 有效 0.01；被吃掉 0.022。
    const real = 0.19;
    const { extra, full } = presenceExtraUnderCap({ safety: real }, 'holding_present', 8);
    expect(full.safety).toBeCloseTo(0.032, 12);
    expect(extra.safety).toBeCloseTo(0.2 - real, 12);
  });

  it('③ 1× 档有效增益与 AF-421 未接 cap 口径一致（当前数据 cap 损失为 0）', () => {
    const sessions = [syntheticSession(0.02, 'a'), syntheticSession(0.005, 'b')];
    const cappedSweep = sweepCapAware(sessions, [1]);
    const plainSweep = sweepAmplitudes(sessions, [1]);
    expect(cappedSweep[0].totalSafetyGain).toBeCloseTo(plainSweep[0].totalSafetyGain, 9);
    expect(cappedSweep[0].totalBondGain).toBeCloseTo(plainSweep[0].totalBondGain, 9);
    expect(cappedSweep[0].lostDelta).toBe(0);
  });

  it('③ 8× 在真实余量不足时会记损失轮次', () => {
    const row = replayCapAware(syntheticSession(0.19), 8);
    expect(row.cappedTurns).toBe(1);
    expect(row.lostDelta).toBeCloseTo(0.022, 6);
  });

  it('④ 0× 零增益；正维度随倍数单调不减', () => {
    const sessions = [syntheticSession(0.02, 'a'), syntheticSession(0.19, 'c')];
    const sweep = sweepCapAware(sessions);
    expect(sweep.map((row) => row.multiplier)).toEqual([...CAP_SWEEP_MULTIPLIERS]);
    expect(sweep[0].totalSafetyGain).toBe(0);
    for (let index = 1; index < sweep.length; index += 1) {
      expect(sweep[index].totalSafetyGain).toBeGreaterThanOrEqual(sweep[index - 1].totalSafetyGain);
    }
    const clampedRow = sweep.at(-1);
    expect(summarizeCapAware([replayCapAware(syntheticSession(0.19), 8)], 8).meanSafetyGain).toBeCloseTo(
      clampedRow.totalSafetyGain - replayCapAware(syntheticSession(0.02), 8).safetyGain,
      6,
    );
  });
});
