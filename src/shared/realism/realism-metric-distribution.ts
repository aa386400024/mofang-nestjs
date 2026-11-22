// V2026-11-23 建立 (AF-332 · 真人度短会话基线方差):
//   职责: 对同一 cell 的多次独立重复做纯统计, 给出均值/中位数/极值/窗口内计数.
//   边界: 纯函数, 零 IO / 零随机 / 零文本; 不修改 humanization-v1 阈值.

export interface MetricStatistics {
  readonly count: number;
  readonly mean: number | null;
  readonly median: number | null;
  readonly min: number | null;
  readonly max: number | null;
}

function finiteValues(values: readonly (number | null | undefined)[]): number[] {
  return values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

/**
 * 计算中位数 (偶数样本取中间两数均值).
 *
 * @param values 原始样本; 缺失/非有限值忽略
 * @returns 中位数; 无有效样本返回 null
 */
export function medianOf(values: readonly (number | null | undefined)[]): number | null {
  const finite = finiteValues(values).toSorted((left, right) => left - right);
  if (finite.length === 0) return null;
  const middle = Math.floor(finite.length / 2);
  if (finite.length % 2 === 1) return finite[middle];
  return (finite[middle - 1] + finite[middle]) / 2;
}

/**
 * 汇总一组样本的均值、中位数、最小值、最大值与样本数.
 *
 * @param values 原始样本; 缺失/非有限值忽略
 * @returns 统计结果; 无有效样本时除 count 外均为 null
 */
export function statisticsOf(values: readonly (number | null | undefined)[]): MetricStatistics {
  const finite = finiteValues(values);
  if (finite.length === 0) {
    return { count: 0, mean: null, median: null, min: null, max: null };
  }
  const sum = finite.reduce((total, value) => total + value, 0);
  return {
    count: finite.length,
    mean: sum / finite.length,
    median: medianOf(finite),
    min: Math.min(...finite),
    max: Math.max(...finite),
  };
}

/**
 * 统计落在区间内的样本数 (含容差, 与 humanization-v1 的 range 口径一致).
 *
 * @param values 原始样本
 * @param min 下界; undefined 表示不设下界
 * @param max 上界; undefined 表示不设上界
 * @param tol 容差
 * @returns 命中样本数
 */
export function countWithinWindow(
  values: readonly (number | null | undefined)[],
  min: number | undefined,
  max: number | undefined,
  tol: number,
): number {
  return finiteValues(values).filter((value) => {
    const aboveMin = min === undefined || value >= min - tol;
    const belowMax = max === undefined || value <= max + tol;
    return aboveMin && belowMax;
  }).length;
}

/**
 * 统计不超过上限的样本数 (含容差, 与 humanization-v1 的 max_value 口径一致).
 *
 * @param values 原始样本
 * @param max 上限
 * @param tol 容差
 * @returns 命中样本数
 */
export function countAtMost(values: readonly (number | null | undefined)[], max: number, tol: number): number {
  return finiteValues(values).filter((value) => value <= max + tol).length;
}
