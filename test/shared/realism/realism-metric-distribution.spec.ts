import { describe, expect, it } from 'vitest';

import { countAtMost, countWithinWindow, medianOf, statisticsOf } from '../../../src/shared/realism/realism-metric-distribution.js';

describe('realism-metric-distribution', () => {
  it('奇数样本中位数取中间值', () => {
    expect(medianOf([3, 1, 2])).toBe(2);
  });

  it('偶数样本中位数取中间两数均值', () => {
    expect(medianOf([4, 1, 3, 2])).toBe(2.5);
  });

  it('缺失值与非有限值不参与中位数', () => {
    expect(medianOf([null, 2, undefined, 4, Number.NaN, Number.POSITIVE_INFINITY])).toBe(3);
  });

  it('空样本返回 null', () => {
    expect(medianOf([])).toBeNull();
    expect(statisticsOf([])).toEqual({ count: 0, mean: null, median: null, min: null, max: null });
  });

  it('单样本的均值、中位数、极值相同', () => {
    expect(statisticsOf([2.5])).toEqual({ count: 1, mean: 2.5, median: 2.5, min: 2.5, max: 2.5 });
  });

  it('多样本统计均值和极值', () => {
    expect(statisticsOf([1, 2, 3, 4])).toEqual({ count: 4, mean: 2.5, median: 2.5, min: 1, max: 4 });
  });

  it('全部缺失时统计为空', () => {
    expect(statisticsOf([null, undefined, Number.NaN])).toEqual({ count: 0, mean: null, median: null, min: null, max: null });
  });

  it('窗口计数包含上下界与容差', () => {
    expect(countWithinWindow([0.1, 0.16, 0.18, 2.5, 2.54, 2.56], 0.2, 2.5, 0.05)).toBe(4);
  });

  it('窗口计数忽略缺失值', () => {
    expect(countWithinWindow([null, 1, Number.NaN, 2], 0.2, 2.5, 0.05)).toBe(2);
  });

  it('上限计数包含容差且不把缺失当通过', () => {
    expect(countAtMost([0.1, 0.79, 0.82, 0.83, null, Number.NaN], 0.8, 0.02)).toBe(3);
  });

  it('无样本时窗口与上限计数都为 0', () => {
    expect(countWithinWindow([], 0.2, 2.5, 0.05)).toBe(0);
    expect(countAtMost([], 0.8, 0.02)).toBe(0);
  });

  it('统计不修改传入数组', () => {
    const input = [3, 1, 2];
    statisticsOf(input);
    expect(input).toEqual([3, 1, 2]);
  });
});
