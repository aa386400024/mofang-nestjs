// V2026-11-11 WP-K (指标字典自洽测试):
//   守住"单一真相源"不被悄悄改坏: id 唯一、bounds 合法、枚举与字典覆盖一致.
//   纯静态校验, 不起 Nest, 不连 DB.

import { describe, expect, it } from 'vitest';

import {
  METRIC_DICTIONARY,
  METRIC_BY_ID,
  METRIC_DICTIONARY_VERSION,
  NON_NULLABLE_IDS,
  POSITIVE_EVENTS,
  SESSION_OUTCOMES,
  TRACKED_DIMENSIONS,
  TRACKED_EVENTS,
  TRACKED_STRATEGIES,
} from '../../src/auto-practice/metrics/metric-dictionary.js';

describe('WP-K · 指标字典自洽', () => {
  it('id 全局唯一', () => {
    const ids = METRIC_DICTIONARY.map((metric) => metric.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每个指标都有非空 label / definition', () => {
    for (const metric of METRIC_DICTIONARY) {
      expect(metric.label.length).toBeGreaterThan(0);
      expect(metric.definition.length).toBeGreaterThan(0);
    }
  });

  it('bounds 合法: min ≤ max (计数类无界为 null)', () => {
    for (const metric of METRIC_DICTIONARY) {
      if (metric.bounds) expect(metric.bounds.min).toBeLessThanOrEqual(metric.bounds.max);
    }
  });

  it('METRIC_BY_ID 与数组内容一致', () => {
    expect(METRIC_BY_ID.size).toBe(METRIC_DICTIONARY.length);
    for (const metric of METRIC_DICTIONARY) {
      expect(METRIC_BY_ID.get(metric.id)).toBe(metric);
    }
  });

  it('NON_NULLABLE_IDS 恰好是所有 nullable=false 的指标', () => {
    const expected = METRIC_DICTIONARY.filter((metric) => !metric.nullable)
      .map((metric) => metric.id)
      .sort();
    expect([...NON_NULLABLE_IDS].sort()).toEqual(expected);
  });

  it('八个维度各有 6 个指标 (首/末/变化/速率/p10/p90)', () => {
    for (const dim of TRACKED_DIMENSIONS) {
      const ids = METRIC_DICTIONARY.filter((metric) => metric.id.startsWith(`dim.${dim}.`)).map((metric) => metric.id);
      expect(ids).toHaveLength(6);
    }
  });

  it('13 个事件、8 个策略各有 count + rate', () => {
    for (const kind of TRACKED_EVENTS) {
      expect(METRIC_BY_ID.has(`event.${kind}.count`)).toBe(true);
      expect(METRIC_BY_ID.has(`event.${kind}.rate`)).toBe(true);
    }
    for (const name of TRACKED_STRATEGIES) {
      expect(METRIC_BY_ID.has(`strategy.${name}.count`)).toBe(true);
      expect(METRIC_BY_ID.has(`strategy.${name}.rate`)).toBe(true);
    }
  });

  it('正事件集合是事件枚举的子集', () => {
    for (const kind of POSITIVE_EVENTS) expect(TRACKED_EVENTS).toContain(kind);
  });

  it('出口状态枚举非空且互不重复', () => {
    expect(new Set(SESSION_OUTCOMES).size).toBe(SESSION_OUTCOMES.length);
  });
});

describe('Phase3 P0 · text.disfluency.* 指标 (dict-v2 起)', () => {
  const DISFLUENCY_IDS = [
    'text.disfluency.events_per_turn',
    'text.disfluency.event_turn_rate',
    'text.disfluency.density_per100',
    'text.disfluency.filler_per_turn',
    'text.disfluency.pause_per_turn',
    'text.disfluency.repair_per_turn',
    'text.disfluency.repetition_per_turn',
    'text.disfluency.trailoff_per_turn',
  ];

  it('字典版本已升到 dict-v4 (C5-1 探索指标分层后; 版本必须跟着字典内容走)', () => {
    expect(METRIC_DICTIONARY_VERSION).toBe('dict-v4');
  });

  it('八个新键齐备, 全部 nullable=false 且方向 neutral', () => {
    for (const id of DISFLUENCY_IDS) {
      const metric = METRIC_BY_ID.get(id);
      expect(metric).toBeDefined();
      expect(metric?.nullable).toBe(false);
      expect(metric?.direction).toBe('neutral');
      expect(metric?.definition.length).toBeGreaterThan(0);
      expect(metric?.label.length).toBeGreaterThan(0);
    }
  });

  it('单位与蓝图 §5.2.2 表一致 (per_turn / ratio / count)', () => {
    expect(METRIC_BY_ID.get('text.disfluency.events_per_turn')?.unit).toBe('per_turn');
    expect(METRIC_BY_ID.get('text.disfluency.event_turn_rate')?.unit).toBe('ratio');
    expect(METRIC_BY_ID.get('text.disfluency.density_per100')?.unit).toBe('count');
    for (const id of DISFLUENCY_IDS.filter((item) => item.endsWith('_per_turn'))) {
      expect(METRIC_BY_ID.get(id)?.unit).toBe('per_turn');
    }
  });

  it('bounds 纪律: per_turn / ratio 给 [0,1], density 首版无界', () => {
    expect(METRIC_BY_ID.get('text.disfluency.events_per_turn')?.bounds).toEqual({ min: 0, max: 1 });
    expect(METRIC_BY_ID.get('text.disfluency.event_turn_rate')?.bounds).toEqual({ min: 0, max: 1 });
    expect(METRIC_BY_ID.get('text.disfluency.density_per100')?.bounds).toBeNull();
  });

  it('八键全部进 NON_NULLABLE_IDS (计算层缺赋值即失败)', () => {
    for (const id of DISFLUENCY_IDS) {
      expect(NON_NULLABLE_IDS).toContain(id);
    }
  });
});

describe('D-2 · 两类在场状态事件的指标登记 (dict-v3)', () => {
  it('两类新 kind 各有 count + rate, 方向 neutral (不参与好坏判定)', () => {
    for (const kind of ['holding_present', 'cold_absent'] as const) {
      expect(METRIC_BY_ID.has(`event.${kind}.count`)).toBe(true);
      expect(METRIC_BY_ID.has(`event.${kind}.rate`)).toBe(true);
      expect(METRIC_BY_ID.get(`event.${kind}.count`)?.direction).toBe('neutral');
      expect(METRIC_BY_ID.get(`event.${kind}.rate`)?.direction).toBe('neutral');
    }
  });

  it('字典版本已随内容升到 dict-v4 (两份字典不共用同一版本号)', () => {
    expect(METRIC_DICTIONARY_VERSION).toBe('dict-v4');
  });
});

describe('C5-1 · 探索角色覆盖指标 (dict-v4)', () => {
  it('新键齐备: ratio / neutral / nullable=false / bounds [0,1]', () => {
    const metric = METRIC_BY_ID.get('exploration.character_coverage');

    expect(metric).toBeDefined();
    expect(metric?.id).toBe('exploration.character_coverage');
    expect(metric?.unit).toBe('ratio');
    expect(metric?.direction).toBe('neutral');
    expect(metric?.nullable).toBe(false);
    expect(metric?.bounds).toEqual({ min: 0, max: 1 });
    expect(metric?.label.length).toBeGreaterThan(0);
    expect(metric?.definition.length).toBeGreaterThan(0);
  });

  it('新键进 NON_NULLABLE_IDS (计算层缺赋值即失败)', () => {
    expect(NON_NULLABLE_IDS).toContain('exploration.character_coverage');
  });

  it('方向 neutral → 不参与跨批回归的好坏判定 (回归判定器整条跳过 neutral 指标)', () => {
    expect(METRIC_BY_ID.get('exploration.character_coverage')?.direction).toBe('neutral');
  });

  it('旧键 exploration.rate 仍在且口径未改 (场次比例), 只补了长会话档位标注', () => {
    const old = METRIC_BY_ID.get('exploration.rate');

    expect(old).toBeDefined();
    expect(old?.unit).toBe('ratio');
    expect(old?.direction).toBe('higher_is_better');
    expect(old?.definition).toContain('场次数 ÷ 纳入场次数');
    expect(old?.definition).toContain('40 轮档');
  });
});
