// V2026-11-09 治本 (Phase2.5 WP-E · 自动评测 · 计算层):
//   职责: 指标计算 —— 触发质量 (P/R/F1) + 建议质量 (方向 macro F1 + 幅度 MAE) + 基线对比.
//   边界: **纯函数** —— 零 IO / 零 env / 零网络 / 零模型调用. 不起数据库就能单测.
//
//   为什么指标计算必须是纯函数 (与 WP-C 同一治本思路):
//     评测报告的数字要能**复现**: 同一份数据集 + 同一段代码 → 同一组分数.
//     只要计算里混进一次 IO (读时钟 / 读 Redis / 读 env), 复现性就没了 ——
//     而"跟上一版报告比"这件事**完全依赖**可复现.
//
//   口径说明 (任务单 §4.2):
//     · 方向: delta > 0.01 正 / < -0.01 负 / 其余平稳 (口径在 eval.types.ts 里只此一份).
//     · 方向准确率: 每个维度按 **三分类 (涨/平/跌) 算 macro F1**, 六维再取平均.
//       ⚠️ 为什么不是"方向命中率": 命中率在"几乎全是平稳轮"的会话上恒等于 1 ——
//       全押"平稳"的退化解能拿满分. macro F1 会把"该涨的没涨"重罚, 退化解拿不到分.
//     · 幅度 MAE: 只统计**方向对**的那些轮次 —— 方向都错了还谈幅度是噪声.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/eval/eval.metrics.spec.ts 覆盖 P/R/F1 / 方向 macro F1 / MAE / 基线对比

import {
  directionOf,
  EVAL_DIMENSIONS,
  type EvalBaselineComparison,
  type EvalDelta,
  type EvalDimension,
  type EvalDirection,
  type EvalDirectionScore,
  type EvalRunSnapshot,
  type EvalRunsSummary,
  type EvalSuggestionQuality,
  type EvalTriggerQuality,
} from './eval.types.js';

/** 触发质量的一对 (真值 / 预测). */
export interface EvalTriggerPair {
  /** 真值: 该不该跑. */
  readonly truth: boolean;
  /** 预测: 闸门实际跑了没. */
  readonly predicted: boolean;
}

/**
 * 计算触发质量 (任务单 §4.1).
 *
 * ⚠️ 分母为 0 时一律返回 0 —— 空数据不报 NaN (NaN 进 JSON 变成 null, 报告里看不出是"没数据").
 *
 * @param pairs 真值 / 预测对
 * @returns 触发质量指标
 */
export function computeTriggerQuality(pairs: readonly EvalTriggerPair[]): EvalTriggerQuality {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const pair of pairs) {
    if (pair.truth && pair.predicted) tp += 1;
    else if (!pair.truth && pair.predicted) fp += 1;
    else if (pair.truth && !pair.predicted) fn += 1;
    else tn += 1;
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, tp, fp, fn, tn, support: pairs.length };
}

/** 建议质量的一对 (预测 / 真值). */
export interface EvalSuggestionSample {
  /** 被测预测 (审议输出). */
  readonly predicted: EvalDelta | null;
  /** 人类真值 (督导标注). */
  readonly truth: EvalDelta | null;
}

/** 三分类混淆矩阵 (行 = 真值, 列 = 预测). */
type EvalConfusion = Record<EvalDirection, Record<EvalDirection, number>>;

function createEmptyConfusion(): EvalConfusion {
  return {
    up: { up: 0, flat: 0, down: 0 },
    flat: { up: 0, flat: 0, down: 0 },
    down: { up: 0, flat: 0, down: 0 },
  };
}

/**
 * 算单个维度的方向得分.
 *
 * @param samples 样本对
 * @param dimension 维度
 * @returns 得分 (无样本时为 null)
 */
export function computeDimensionScore(samples: readonly EvalSuggestionSample[], dimension: EvalDimension): EvalDirectionScore | null {
  const confusion = createEmptyConfusion();
  let total = 0;
  let correct = 0;
  let signalTurns = 0;
  let amplitudeSum = 0;
  let amplitudeCount = 0;

  for (const sample of samples) {
    if (!sample.predicted || !sample.truth) continue;
    const predictedValue = sample.predicted[dimension] ?? 0;
    const truthValue = sample.truth[dimension] ?? 0;
    const predictedDirection = directionOf(predictedValue);
    const truthDirection = directionOf(truthValue);
    confusion[truthDirection][predictedDirection] += 1;
    total += 1;
    if (truthDirection !== 'flat') signalTurns += 1;
    if (predictedDirection === truthDirection) {
      correct += 1;
      amplitudeSum += Math.abs(predictedValue - truthValue);
      amplitudeCount += 1;
    }
  }

  if (total === 0) return null;

  const directions: readonly EvalDirection[] = ['up', 'flat', 'down'];
  let macroF1Sum = 0;
  let macroF1Count = 0;
  for (const direction of directions) {
    // ⚠️ support = **行和** (真值落在该类的轮次数) —— 不要再额外加一次 confusion[direction][direction],
    //   否则 tp 被算两遍, recall 偏小, macro F1 虚低.
    const support = confusion[direction].up + confusion[direction].flat + confusion[direction].down;
    if (support === 0) continue;
    const tp = confusion[direction][direction];
    // ⚠️ 预测数 = **列和** (所有真值行里被预测成该类的数量) —— 不能再额外加一次 tp,
    //   否则 tp 被算两遍, precision 偏大, macro F1 虚高.
    const predictedCount = confusion.up[direction] + confusion.flat[direction] + confusion.down[direction];
    const precision = predictedCount === 0 ? 0 : tp / predictedCount;
    const recall = tp / support;
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    macroF1Sum += f1;
    macroF1Count += 1;
  }

  return {
    accuracy: correct / total,
    macroF1: macroF1Count === 0 ? 0 : macroF1Sum / macroF1Count,
    support: total,
    signalTurns,
    amplitudeMAE: amplitudeCount === 0 ? null : amplitudeSum / amplitudeCount,
  };
}

/**
 * 计算建议质量 (任务单 §4.2).
 *
 * ⚠️ 没有人类真值时返回 available=false + 原因, **不是** 一组 0 分:
 *   0 分会被当成"审议全错", 让人去调一个本来就没法调的参数.
 *
 * @param samples 样本对
 * @param unavailableReason 不可算的原因 (可算时传 null)
 * @returns 建议质量指标
 */
export function computeSuggestionQuality(
  samples: readonly EvalSuggestionSample[],
  unavailableReason: string | null = null,
): EvalSuggestionQuality {
  const usable = samples.filter((sample) => sample.predicted !== null && sample.truth !== null);
  const directionAccuracy = {} as Record<EvalDimension, number | null>;
  const perDimension = {} as Record<EvalDimension, EvalDirectionScore | null>;

  if (usable.length === 0 || unavailableReason !== null) {
    for (const dimension of EVAL_DIMENSIONS) {
      directionAccuracy[dimension] = null;
      perDimension[dimension] = null;
    }
    return {
      available: false,
      unavailableReason: unavailableReason ?? '没有可用于建议质量比较的样本 (缺督导真值或缺审议输出)',
      directionAccuracy,
      macroAverage: null,
      perDimension,
      amplitudeMAE: null,
      comparedTurns: usable.length,
    };
  }

  let macroSum = 0;
  let macroCount = 0;
  let amplitudeSum = 0;
  let amplitudeCount = 0;
  for (const dimension of EVAL_DIMENSIONS) {
    const score = computeDimensionScore(usable, dimension);
    perDimension[dimension] = score;
    // ⚠️ 只有**有信号**的维度 (真值出现过非平稳) 才进 macro 平均与幅度 MAE ——
    //   整场平稳的维度上, "全押平稳"就能拿满分, 算进去会把分数抬高.
    const hasSignal = score !== null && score.signalTurns > 0;
    directionAccuracy[dimension] = hasSignal ? score.macroF1 : null;
    if (hasSignal && score) {
      macroSum += score.macroF1;
      macroCount += 1;
      if (score.amplitudeMAE !== null) {
        amplitudeSum += score.amplitudeMAE;
        amplitudeCount += 1;
      }
    }
  }

  return {
    available: true,
    unavailableReason: null,
    directionAccuracy,
    macroAverage: macroCount === 0 ? null : macroSum / macroCount,
    perDimension,
    amplitudeMAE: amplitudeCount === 0 ? null : amplitudeSum / amplitudeCount,
    comparedTurns: usable.length,
  };
}

/**
 * 基线对比 (纯规则 vs 规则 + 审议).
 *
 * ⚠️ 两边必须**同一套真值** —— 拿规则跟真值比, 拿审议跟另一套真值比, 差值没有意义.
 *
 * @param baseline 基线指标 (规则输出)
 * @param subject 被测指标 (审议输出)
 * @returns 对比结果
 */
export function computeBaselineComparison(baseline: EvalSuggestionQuality, subject: EvalSuggestionQuality): EvalBaselineComparison {
  if (!baseline.available || !subject.available) {
    return {
      available: false,
      unavailableReason: baseline.unavailableReason ?? subject.unavailableReason ?? '基线或被测对象不可算',
      baselineDirectionAccuracy: baseline.macroAverage,
      subjectDirectionAccuracy: subject.macroAverage,
      directionAccuracyDelta: null,
      baselineAmplitudeMAE: baseline.amplitudeMAE,
      subjectAmplitudeMAE: subject.amplitudeMAE,
      amplitudeMAEDelta: null,
    };
  }
  const directionAccuracyDelta =
    baseline.macroAverage === null || subject.macroAverage === null ? null : subject.macroAverage - baseline.macroAverage;
  const amplitudeMaeDelta =
    baseline.amplitudeMAE === null || subject.amplitudeMAE === null ? null : subject.amplitudeMAE - baseline.amplitudeMAE;
  return {
    available: true,
    unavailableReason: null,
    baselineDirectionAccuracy: baseline.macroAverage,
    subjectDirectionAccuracy: subject.macroAverage,
    directionAccuracyDelta,
    baselineAmplitudeMAE: baseline.amplitudeMAE,
    subjectAmplitudeMAE: subject.amplitudeMAE,
    amplitudeMAEDelta: amplitudeMaeDelta,
  };
}

/**
 * 求均值 (忽略 null).
 *
 * @param values 数值列表
 * @returns 均值 (无可用值时为 null)
 */
function meanOrNull(values: readonly (number | null)[]): number | null {
  const usable = values.filter((value): value is number => value !== null);
  if (usable.length === 0) return null;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

/**
 * 求标准差 (总体标准差; 单个样本 = 0).
 *
 * ⚠️ 用**总体**标准差 (除以 n) 而不是样本标准差 (除以 n-1):
 *   报告里的标准差回答的是"这一批结果彼此差多少", 不是"总体方差的无偏估计" ——
 *   跑 3 次取均值时用总体口径更贴近"这 3 次的波动"这个问题.
 *
 * @param values 数值列表
 * @returns 标准差 (无可用值时为 null)
 */
export function computeStdDev(values: readonly (number | null)[]): number | null {
  const usable = values.filter((value): value is number => value !== null);
  if (usable.length === 0) return null;
  const mean = usable.reduce((sum, value) => sum + value, 0) / usable.length;
  const variance = usable.reduce((sum, value) => sum + (value - mean) ** 2, 0) / usable.length;
  return Math.sqrt(variance);
}

/**
 * 汇总多次运行的均值 / 标准差 (任务单 §6.2).
 *
 * @param runs 逐次运行的指标快照
 * @returns 均值 + 标准差
 */
export function computeRunsSummary(runs: readonly EvalRunSnapshot[]): EvalRunsSummary {
  const mean: EvalRunSnapshot = {
    triggerF1: meanOrNull(runs.map((run) => run.triggerF1)) ?? 0,
    precision: meanOrNull(runs.map((run) => run.precision)) ?? 0,
    recall: meanOrNull(runs.map((run) => run.recall)) ?? 0,
    directionAccuracy: meanOrNull(runs.map((run) => run.directionAccuracy)),
    amplitudeMAE: meanOrNull(runs.map((run) => run.amplitudeMAE)),
  };
  const stdDev: EvalRunSnapshot = {
    triggerF1: computeStdDev(runs.map((run) => run.triggerF1)) ?? 0,
    precision: computeStdDev(runs.map((run) => run.precision)) ?? 0,
    recall: computeStdDev(runs.map((run) => run.recall)) ?? 0,
    directionAccuracy: computeStdDev(runs.map((run) => run.directionAccuracy)),
    amplitudeMAE: computeStdDev(runs.map((run) => run.amplitudeMAE)),
  };
  return { count: runs.length, mean, stdDev };
}
