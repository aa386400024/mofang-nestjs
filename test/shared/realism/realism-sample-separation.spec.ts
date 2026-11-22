// AF-335 · 分离度与阈值敏感性纯模块单测.
import { describe, expect, it } from 'vitest';

import { confusionAt, countAbove, separatingBand } from '../../../src/shared/realism/realism-sample-separation.js';

describe('realism-sample-separation', () => {
  it('完全分离时给出左闭右开区间与中点', () => {
    const band = separatingBand([1, 2, 3], [5, 6, 7]);
    expect(band).not.toBeNull();
    expect(band?.minThreshold).toBe(3);
    expect(band?.maxThresholdExclusive).toBe(5);
    expect(band?.midpoint).toBe(4);
  });

  it('两组重叠时不可分', () => {
    expect(separatingBand([1, 2, 4], [3, 5])).toBeNull();
  });

  it('边界相等 (maxNeg = minPos) 时不可分', () => {
    expect(separatingBand([1, 3], [3, 4])).toBeNull();
  });

  it('空样本或只有非有限值时不可分', () => {
    expect(separatingBand([], [1, 2])).toBeNull();
    expect(separatingBand([1, 2], [])).toBeNull();
    expect(separatingBand([Number.NaN], [Number.POSITIVE_INFINITY])).toBeNull();
  });

  it('单样本也能形成区间', () => {
    const band = separatingBand([2], [4]);
    expect(band?.minThreshold).toBe(2);
    expect(band?.maxThresholdExclusive).toBe(4);
    expect(band?.midpoint).toBe(3);
  });

  it('NaN 与非有限值被忽略, 不影响区间', () => {
    const band = separatingBand([1, Number.NaN, 3, Number.POSITIVE_INFINITY], [5, Number.NEGATIVE_INFINITY]);
    expect(band?.minThreshold).toBe(3);
    expect(band?.maxThresholdExclusive).toBe(5);
  });

  it('阈值等于负样本最大值时该样本仍判负 (值 > 阈值才为正)', () => {
    const matrix = confusionAt([3], [5], 3);
    expect(matrix.falsePositive).toBe(0);
    expect(matrix.trueNegative).toBe(1);
    expect(matrix.truePositive).toBe(1);
  });

  it('完全分离时混淆矩阵准确率为 1', () => {
    const matrix = confusionAt([1, 2, 3], [5, 6], 4);
    expect(matrix).toEqual({
      threshold: 4,
      truePositive: 2,
      falsePositive: 0,
      trueNegative: 3,
      falseNegative: 0,
      accuracy: 1,
    });
  });

  it('重叠样本在中间阈值上产生假阳性与假阴性', () => {
    const matrix = confusionAt([1, 4], [3, 6], 3.5);
    expect(matrix.falsePositive).toBe(1);
    expect(matrix.trueNegative).toBe(1);
    expect(matrix.truePositive).toBe(1);
    expect(matrix.falseNegative).toBe(1);
    expect(matrix.accuracy).toBeCloseTo(0.5, 6);
  });

  it('非有限阈值与空样本抛错', () => {
    expect(() => confusionAt([1], [2], Number.NaN)).toThrow('阈值不是有限数');
    expect(() => confusionAt([], [2], 1)).toThrow('混淆矩阵需要正负样本各至少一个有限值');
  });

  it('countAbove 只统计严格高于阈值的有限值', () => {
    expect(countAbove([1, 2, Number.NaN, 3], 2)).toBe(1);
    expect(() => countAbove([1], Number.NaN)).toThrow('阈值不是有限数');
  });
});
