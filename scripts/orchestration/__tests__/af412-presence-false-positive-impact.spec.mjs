import { describe, expect, it } from 'vitest';

import {
  isZeroMotionSnapshot,
  projectPresenceOnSnapshot,
  scaleImpactByErrorRate,
  summarizeImpact,
  summarizeSessionImpact,
} from '../../ops/quality/af412-presence-false-positive-impact.mjs';

const BASE = Object.freeze({
  trust: 0.25,
  safety: 0.25,
  bond: 0.2,
  valence: -0.55,
  arousal: 0.35,
  resistanceVerbal: 0.1,
  resistanceDepth: 0.1,
  resistanceStyle: 0.1,
});

describe('AF-412 全会话在场投影', () => {
  it('首末八维逐字相等才是零变化', () => {
    expect(isZeroMotionSnapshot(BASE, { ...BASE })).toBe(true);
    expect(isZeroMotionSnapshot(BASE, { ...BASE, safety: 0.254 })).toBe(false);
    expect(isZeroMotionSnapshot(BASE, { ...BASE, resistanceStyle: 0.100001 })).toBe(false);
  });

  it('两轮 holding → safety +0.008 / bond +0.004', () => {
    const result = projectPresenceOnSnapshot(['holding_present', 'holding_present'], BASE);
    expect(result.holding).toBe(2);
    expect(result.safetyGain).toBeCloseTo(0.008, 6);
    expect(result.bondGain).toBeCloseTo(0.004, 6);
    expect(result.safetyAfter).toBeCloseTo(0.258, 6);
    expect(result.bondAfter).toBeCloseTo(0.204, 6);
  });

  it('投影在 1.0 处截断（不越界）', () => {
    const result = projectPresenceOnSnapshot(
      Array.from({ length: 300 }, () => 'holding_present'),
      { ...BASE, safety: 0.9 },
    );
    expect(result.safetyAfter).toBe(1);
  });

  it('零变化场次 + 1 轮 holding → zero_motion 翻 false', () => {
    const row = summarizeSessionImpact({ id: 's1', labels: ['holding_present'], first: BASE, last: { ...BASE } });
    expect(row.currentlyZero).toBe(true);
    expect(row.projectedZero).toBe(false);
    expect(row.holding).toBe(1);
  });

  it('非零场次命中 holding → 不改变 zero_motion 判定（本就 false）', () => {
    const last = { ...BASE, trust: 0.3 };
    const row = summarizeSessionImpact({ id: 's2', labels: ['holding_present'], first: BASE, last });
    expect(row.currentlyZero).toBe(false);
    expect(row.projectedZero).toBe(false);
  });

  it('cold_absent 也会翻转零变化（负向投影同样可见）', () => {
    const row = summarizeSessionImpact({ id: 's3', labels: ['cold_absent'], first: BASE, last: { ...BASE } });
    expect(row.projectedZero).toBe(false);
    expect(row.safetyGain).toBeCloseTo(-0.002, 6);
  });

  it('批次汇总：翻转数、受影响场次、均值口径', () => {
    const rows = [
      summarizeSessionImpact({ id: 'a', labels: ['holding_present', 'holding_present'], first: BASE, last: { ...BASE } }),
      summarizeSessionImpact({ id: 'b', labels: [], first: BASE, last: { ...BASE } }),
      summarizeSessionImpact({ id: 'c', labels: ['neutral'], first: BASE, last: { ...BASE, trust: 0.3 } }),
    ];
    const summary = summarizeImpact(rows);
    expect(summary.sessions).toBe(3);
    expect(summary.holding).toBe(2);
    expect(summary.currentZero).toBe(2);
    expect(summary.projectedZero).toBe(1);
    expect(summary.flipped).toBe(1);
    expect(summary.affected).toBe(1);
    expect(summary.totalSafetyGain).toBeCloseTo(0.008, 6);
    expect(summary.meanSafetyGainPerAffected).toBeCloseTo(0.008, 6);
  });

  it('批次汇总：真翻转时 flipped 与 projectedZero 同步变化', () => {
    const rows = [
      summarizeSessionImpact({ id: 'a', labels: ['holding_present'], first: BASE, last: { ...BASE } }),
      summarizeSessionImpact({ id: 'b', labels: [], first: BASE, last: { ...BASE } }),
    ];
    const summary = summarizeImpact(rows);
    expect(summary.currentZero).toBe(2);
    expect(summary.projectedZero).toBe(1);
    expect(summary.flipped).toBe(1);
  });

  it('误判比例敏感性：50% → 增量减半，越界比例夹到 [0,1]', () => {
    const summary = summarizeImpact([
      summarizeSessionImpact({ id: 'a', labels: ['holding_present', 'holding_present'], first: BASE, last: { ...BASE } }),
    ]);
    expect(scaleImpactByErrorRate(summary, 0.5).safetyGain).toBeCloseTo(0.004, 6);
    expect(scaleImpactByErrorRate(summary, 2).safetyGain).toBeCloseTo(0.008, 6);
    expect(scaleImpactByErrorRate(summary, -1).safetyGain).toBe(0);
  });
});
