// V2026-11-23 建立 (AF-335 · 真人度基线分离度与阈值敏感性):
//   职责: 判断两组样本在单一阈值上是否可分, 并给出混淆矩阵.
//   边界: 纯函数, 零 IO; 只做工程敏感性分析, 不生产 gate.

export interface SeparationBand {
  /** 阈值下界 (含): 负样本最大值. */
  readonly minThreshold: number;
  /** 阈值上界 (不含): 正样本最小值. */
  readonly maxThresholdExclusive: number;
  /** 建议的中间阈值, 仅在 band 存在时有意义. */
  readonly midpoint: number;
}

export interface ThresholdConfusion {
  readonly threshold: number;
  readonly truePositive: number;
  readonly falsePositive: number;
  readonly trueNegative: number;
  readonly falseNegative: number;
  readonly accuracy: number;
}

function finiteValues(values: readonly number[]): number[] {
  return values.filter((value) => Number.isFinite(value));
}

/**
 * 计算能把 negatives 与 positives 分开的阈值区间.
 *
 * 判定口径固定为 value > threshold 即正样本:
 *   - threshold ∈ [max(negatives), min(positives)) 时完全可分;
 *   - 两组有重叠或任一为空时返回 null.
 *
 * @param negatives 基线样本 (off)
 * @param positives 过量/候选样本
 * @returns 分离区间; 不可分返回 null
 */
export function separatingBand(negatives: readonly number[], positives: readonly number[]): SeparationBand | null {
  const negativeValues = finiteValues(negatives);
  const positiveValues = finiteValues(positives);
  if (negativeValues.length === 0 || positiveValues.length === 0) return null;

  const maxNegative = Math.max(...negativeValues);
  const minPositive = Math.min(...positiveValues);
  if (maxNegative >= minPositive) return null;

  return {
    minThreshold: maxNegative,
    maxThresholdExclusive: minPositive,
    midpoint: (maxNegative + minPositive) / 2,
  };
}

/**
 * 按单阈值计算混淆矩阵.
 *
 * @param negatives 基线样本
 * @param positives 过量/候选样本
 * @param threshold 判定阈值; value > threshold 为正
 * @returns 混淆矩阵; 空样本或非有限阈值抛错
 */
export function confusionAt(negatives: readonly number[], positives: readonly number[], threshold: number): ThresholdConfusion {
  if (!Number.isFinite(threshold)) throw new Error(`阈值不是有限数: ${String(threshold)}`);
  const negativeValues = finiteValues(negatives);
  const positiveValues = finiteValues(positives);
  if (negativeValues.length === 0 || positiveValues.length === 0) {
    throw new Error('混淆矩阵需要正负样本各至少一个有限值');
  }

  let truePositive = 0;
  let falsePositive = 0;
  for (const value of positiveValues) {
    if (value > threshold) truePositive += 1;
  }
  for (const value of negativeValues) {
    if (value > threshold) falsePositive += 1;
  }

  const trueNegative = negativeValues.length - falsePositive;
  const falseNegative = positiveValues.length - truePositive;
  const total = negativeValues.length + positiveValues.length;
  return {
    threshold,
    truePositive,
    falsePositive,
    trueNegative,
    falseNegative,
    accuracy: total === 0 ? 0 : (truePositive + trueNegative) / total,
  };
}

/**
 * 在样本范围内统计高于阈值的数量.
 *
 * @param values 样本
 * @param threshold 阈值 (value > threshold)
 * @returns 高于阈值的个数; 非有限值不参与
 */
export function countAbove(values: readonly number[], threshold: number): number {
  if (!Number.isFinite(threshold)) throw new Error(`阈值不是有限数: ${String(threshold)}`);
  return finiteValues(values).filter((value) => value > threshold).length;
}
