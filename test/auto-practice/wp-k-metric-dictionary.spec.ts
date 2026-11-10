// V2026-11-11 WP-K (指标字典自洽测试):
//   守住"单一真相源"不被悄悄改坏: id 唯一、bounds 合法、枚举与字典覆盖一致.
//   纯静态校验, 不起 Nest, 不连 DB.

import { describe, expect, it } from 'vitest';

import {
  METRIC_DICTIONARY,
  METRIC_BY_ID,
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

  it('11 个事件、8 个策略各有 count + rate', () => {
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
