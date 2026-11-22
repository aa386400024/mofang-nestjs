import { describe, expect, it } from 'vitest';

import { aggregateEventTypeProfiles, dominantEventType } from '../../../src/shared/realism/realism-event-type-profile.js';

describe('realism-event-type-profile', () => {
  it('空输入返回空数组', () => {
    expect(aggregateEventTypeProfiles([])).toEqual([]);
  });

  it('单样本的每轮频次与占比正确', () => {
    const [profile] = aggregateEventTypeProfiles([
      { persona: 'anxious', arm: 'full', turns: 12, counts: { filler: 4, pause: 6, repair: 2 } },
    ]);
    expect(profile.turns).toBe(12);
    expect(profile.totalEvents).toBe(12);
    expect(profile.eventsPerTurn).toBe(1);
    expect(profile.byType.filler.perTurn).toBeCloseTo(4 / 12);
    expect(profile.byType.pause.perTurn).toBeCloseTo(6 / 12);
    expect(profile.byType.repair.perTurn).toBeCloseTo(2 / 12);
    expect(profile.byType.filler.share).toBeCloseTo(4 / 12);
    expect(profile.repairPerTurn).toBeCloseTo(2 / 12);
  });

  it('同组多样本累加计数与轮次', () => {
    const [profile] = aggregateEventTypeProfiles([
      { persona: 'guarded', arm: 'off', turns: 12, counts: { pause: 3 } },
      { persona: 'guarded', arm: 'off', turns: 12, counts: { pause: 5, trailoff: 2 } },
    ]);
    expect(profile.turns).toBe(24);
    expect(profile.byType.pause.count).toBe(8);
    expect(profile.byType.pause.perTurn).toBeCloseTo(8 / 24);
    expect(profile.totalEvents).toBe(10);
  });

  it('不同 persona 或 arm 分组, 且排序稳定', () => {
    const profiles = aggregateEventTypeProfiles([
      { persona: 'guarded', arm: 'full', turns: 12, counts: { pause: 1 } },
      { persona: 'anxious', arm: 'minimal', turns: 12, counts: { filler: 1 } },
      { persona: 'anxious', arm: 'full', turns: 12, counts: { repair: 1 } },
    ]);
    expect(profiles.map((profile) => `${profile.persona}/${profile.arm}`)).toEqual(['anxious/full', 'anxious/minimal', 'guarded/full']);
  });

  it('缺失、NaN、负数计数按 0 处理', () => {
    const [profile] = aggregateEventTypeProfiles([
      { persona: 'anxious', arm: 'off', turns: 12, counts: { filler: Number.NaN, pause: -3, repair: undefined } },
    ]);
    expect(profile.byType.filler.count).toBe(0);
    expect(profile.byType.pause.count).toBe(0);
    expect(profile.byType.repair.count).toBe(0);
    expect(profile.totalEvents).toBe(0);
    expect(profile.byType.filler.share).toBeNull();
  });

  it('轮次为 0 时频次与占比为 null, 计数保留', () => {
    const [profile] = aggregateEventTypeProfiles([{ persona: 'anxious', arm: 'off', turns: 0, counts: { pause: 4 } }]);
    expect(profile.turns).toBe(0);
    expect(profile.byType.pause.count).toBe(4);
    expect(profile.byType.pause.perTurn).toBeNull();
    expect(profile.eventsPerTurn).toBeNull();
    expect(profile.byType.pause.share).toBeCloseTo(1);
  });

  it('空 persona / arm 归入 unknown 且不修改输入', () => {
    const sample = { persona: '  ', arm: '', turns: 12, counts: { filler: 1 } };
    const [profile] = aggregateEventTypeProfiles([sample]);
    expect(profile.persona).toBe('unknown');
    expect(profile.arm).toBe('unknown');
    expect(sample.persona).toBe('  ');
  });

  it('dominantEventType 返回每轮频次最高的类型', () => {
    const [profile] = aggregateEventTypeProfiles([
      { persona: 'anxious', arm: 'full', turns: 12, counts: { filler: 2, pause: 6, repair: 3 } },
    ]);
    expect(dominantEventType(profile)).toEqual({ id: 'pause', perTurn: 0.5 });
  });

  it('dominantEventType 在无事件或轮次无效时返回 null', () => {
    const [profile] = aggregateEventTypeProfiles([{ persona: 'guarded', arm: 'off', turns: 0, counts: { pause: 2 } }]);
    expect(dominantEventType(profile)).toBeNull();
  });
});
