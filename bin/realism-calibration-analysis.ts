// V2026-11-21 建立 (AF-229 · R6-D2 AI 层面校准与 thinking 对照):
//   职责: 用留出锚点 packet 拟合 MiniMax↔豆包仿射校准，在独立评测 packet 上复核；
//         并在同一批评测 packet 上成对比较豆包 thinking disabled / auto。
//   边界: 纯函数、零 IO；只处理数值分数与 packet 元信息，不接触台词原文；
//         不修改既有 R6-D 阈值，不把模型分数合并成临床总分，不做真人达标声明。

import { analyzeCrossModel, type CrossModelAnalysis, type PacketScoreSet, type RaterScoreSet } from './realism-cross-model-analysis.js';
import { REALISM_DIMENSIONS, type RealismDimension, type RealismAgreement } from '../src/auto-practice/metrics/visitor-realism-rating.js';
import type { RealismScene } from '../src/shared/realism/turn-shape-selector.js';

export type CalibrationArm = 'disabled' | 'auto';
export type CalibrationTemperatureSlot = 't01' | 't05';
export type CalibrationSplit = 'anchor' | 'eval';

export interface CalibrationRow {
  readonly packetId: string;
  readonly scene: RealismScene;
  readonly split: CalibrationSplit;
  readonly minimax: Readonly<Record<CalibrationTemperatureSlot, RaterScoreSet>>;
  readonly doubao: Readonly<Record<CalibrationArm, Readonly<Record<CalibrationTemperatureSlot, RaterScoreSet>>>>;
}

export interface AffineCalibration {
  readonly n: number;
  readonly slope: number;
  readonly intercept: number;
  readonly r2: number;
  readonly mae: number;
  readonly rmse: number;
}

export interface CalibrationSlotFit {
  readonly overall: AffineCalibration;
  readonly dimensions: Readonly<Record<RealismDimension, AffineCalibration>>;
}

export interface CalibrationFit {
  readonly arm: CalibrationArm;
  readonly anchorN: number;
  readonly slots: Readonly<Record<CalibrationTemperatureSlot, CalibrationSlotFit>>;
}

export interface LeaveOneOutSummary {
  readonly n: number;
  readonly overallMae: number;
  readonly overallRmse: number;
  readonly overallMaxAbsError: number;
  readonly dimensionMae: Readonly<Record<RealismDimension, number>>;
  readonly slopeMin: number;
  readonly slopeMax: number;
  readonly interceptMin: number;
  readonly interceptMax: number;
}

export interface CalibrationVerdict {
  readonly verdict: 'pass' | 'conditional' | 'fail';
  readonly reasons: readonly string[];
}

export interface CalibrationEvaluation {
  readonly arm: CalibrationArm;
  readonly anchorN: number;
  readonly evalN: number;
  readonly fit: CalibrationFit;
  readonly loo: LeaveOneOutSummary;
  readonly pre: CrossModelAnalysis;
  readonly post: CrossModelAnalysis;
  readonly meanAbsDeltaImprovement: number | null;
  readonly preOverallStd: number;
  readonly postOverallStd: number;
  readonly discriminationRetention: number;
  readonly judgment: CalibrationVerdict;
}

export interface ThinkingArmMetrics {
  readonly arm: CalibrationArm;
  readonly intraKappa: number | null;
  readonly intraExact: number;
  readonly intraWithinOne: number;
  readonly crossT01Kappa: number | null;
  readonly crossT05Kappa: number | null;
  readonly crossT01Exact: number;
  readonly crossT05Exact: number;
  readonly crossT01WithinOne: number;
  readonly crossT05WithinOne: number;
  readonly meanAbsDelta: number | null;
  readonly overallMean: number | null;
  readonly overallStd: number;
  readonly overallUniqueValues: number;
  readonly averageDimensionStd: number;
}

export interface ThinkingComparison {
  readonly disabled: ThinkingArmMetrics;
  readonly auto: ThinkingArmMetrics;
  readonly discriminationDelta: number;
  readonly recommendation: 'prefer-auto' | 'keep-disabled' | 'inconclusive';
  readonly reasons: readonly string[];
}

export interface BootstrapSummary {
  readonly iterations: number;
  readonly meanAbsDeltaP025: number | null;
  readonly meanAbsDeltaP50: number | null;
  readonly meanAbsDeltaP975: number | null;
  readonly crossKappaP025: number | null;
  readonly crossKappaP50: number | null;
  readonly crossKappaP975: number | null;
}

/** 校准判据；只用于 AI 层面尺子对齐，不等于临床达标。 */
export const CALIBRATION_THRESHOLDS = {
  minPackets: 24,
  overallKappa: 0.4,
  dimensionWithinOne: 0.8,
  overallMeanAbsDelta: 0.3,
  looMeanAbsError: 0.5,
  conditionalKappa: 0.3,
  minOverallSlope: 0.5,
  maxOverallSlope: 2,
  minDiscriminationRetention: 0.8,
} as const;

/** thinking 对照判据；只用于选择评分档，不做临床判定。 */
export const THINKING_THRESHOLDS = {
  crossKappa: 0.4,
  maxMeanAbsDelta: 0.4,
  discriminationGain: 0.05,
} as const;

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function std(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  return round(Math.sqrt(variance));
}

function overallStd(rows: readonly PacketScoreSet[]): number {
  return std(rows.flatMap((row) => [row.doubao.t01.overall, row.doubao.t05.overall]));
}

function clampScore(value: number): number {
  return Math.min(5, Math.max(1, Math.round(value)));
}

function valuesOf(rows: readonly CalibrationRow[], arm: CalibrationArm, slot: CalibrationTemperatureSlot): RaterScoreSet[] {
  return rows.map((row) => row.doubao[arm][slot]);
}

function referenceValues(rows: readonly CalibrationRow[], slot: CalibrationTemperatureSlot): RaterScoreSet[] {
  return rows.map((row) => row.minimax[slot]);
}

/**
 * 最小二乘仿射校准：reference = slope * source + intercept。
 *
 * 方差为 0 时斜率不可辨识，退化为只校正均值偏移（slope=1），并在 r2=0 标记。
 */
export function fitAffineCalibration(pairs: readonly { readonly reference: number; readonly source: number }[]): AffineCalibration {
  if (pairs.length < 2) throw new Error('校准至少需要 2 个配对样本');
  const n = pairs.length;
  const meanSource = pairs.reduce((sum, pair) => sum + pair.source, 0) / n;
  const meanReference = pairs.reduce((sum, pair) => sum + pair.reference, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const pair of pairs) {
    const dx = pair.source - meanSource;
    const dy = pair.reference - meanReference;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const slope = sxx > 1e-9 ? sxy / sxx : 1;
  const intercept = sxx > 1e-9 ? meanReference - slope * meanSource : meanReference - meanSource;
  let sse = 0;
  let sae = 0;
  for (const pair of pairs) {
    const predicted = slope * pair.source + intercept;
    const residual = pair.reference - predicted;
    sse += residual * residual;
    sae += Math.abs(residual);
  }
  return {
    n,
    slope: round(slope),
    intercept: round(intercept),
    r2: round(sxx > 1e-9 && syy > 1e-9 ? 1 - sse / syy : 0),
    mae: round(sae / n),
    rmse: round(Math.sqrt(sse / n)),
  };
}

function fitSlot(rows: readonly CalibrationRow[], arm: CalibrationArm, slot: CalibrationTemperatureSlot): CalibrationSlotFit {
  const references = referenceValues(rows, slot);
  const sources = valuesOf(rows, arm, slot);
  const overall = fitAffineCalibration(
    references.map((reference, index) => ({ reference: reference.overall, source: sources[index].overall })),
  );
  const dimensions = {} as Record<RealismDimension, AffineCalibration>;
  for (const dimension of REALISM_DIMENSIONS) {
    dimensions[dimension] = fitAffineCalibration(
      references.map((reference, index) => ({
        reference: reference.dimensions[dimension],
        source: sources[index].dimensions[dimension],
      })),
    );
  }
  return { overall, dimensions };
}

export function fitCalibration(anchorRows: readonly CalibrationRow[], arm: CalibrationArm): CalibrationFit {
  if (anchorRows.length < 2) throw new Error('锚点不足，无法拟合校准');
  return {
    arm,
    anchorN: anchorRows.length,
    slots: {
      t01: fitSlot(anchorRows, arm, 't01'),
      t05: fitSlot(anchorRows, arm, 't05'),
    },
  };
}

function applySlot(score: RaterScoreSet, fit: CalibrationSlotFit): RaterScoreSet {
  const dimensions = {} as Record<RealismDimension, number>;
  for (const dimension of REALISM_DIMENSIONS) {
    const parameter = fit.dimensions[dimension];
    dimensions[dimension] = clampScore(score.dimensions[dimension] * parameter.slope + parameter.intercept);
  }
  return {
    overall: clampScore(score.overall * fit.overall.slope + fit.overall.intercept),
    dimensions,
  };
}

/** 把校准参数应用到指定 arm，输出可直接喂给既有 2×2 分析器的行。 */
export function applyCalibration(rows: readonly CalibrationRow[], fit: CalibrationFit): PacketScoreSet[] {
  return rows.map((row) => ({
    packetId: row.packetId,
    scene: row.scene,
    minimax: { t01: row.minimax.t01, t05: row.minimax.t05 },
    doubao: {
      t01: applySlot(row.doubao[fit.arm].t01, fit.slots.t01),
      t05: applySlot(row.doubao[fit.arm].t05, fit.slots.t05),
    },
  }));
}

export function toPacketScoreSet(rows: readonly CalibrationRow[], arm: CalibrationArm): PacketScoreSet[] {
  return rows.map((row) => ({
    packetId: row.packetId,
    scene: row.scene,
    minimax: { t01: row.minimax.t01, t05: row.minimax.t05 },
    doubao: { t01: row.doubao[arm].t01, t05: row.doubao[arm].t05 },
  }));
}

function calibrateValue(source: number, fit: AffineCalibration): number {
  return clampScore(source * fit.slope + fit.intercept);
}

/**
 * 锚点留一法：每次留出 1 个 packet 拟合，再预测被留出的样本。
 *
 * 用来判断 24 个锚点拟合出的校准是否稳定，不是评测集成绩。
 */
export function leaveOneOutCalibration(anchorRows: readonly CalibrationRow[], arm: CalibrationArm): LeaveOneOutSummary {
  if (anchorRows.length < 3) throw new Error('留一法至少需要 3 个锚点');
  const overallErrors: number[] = [];
  const dimensionErrors = {} as Record<RealismDimension, number[]>;
  for (const dimension of REALISM_DIMENSIONS) dimensionErrors[dimension] = [];
  const slopes: number[] = [];
  const intercepts: number[] = [];

  for (let index = 0; index < anchorRows.length; index += 1) {
    const training = anchorRows.filter((_, rowIndex) => rowIndex !== index);
    const held = anchorRows[index];
    for (const slot of ['t01', 't05'] as const) {
      const fit = fitSlot(training, arm, slot);
      slopes.push(fit.overall.slope);
      intercepts.push(fit.overall.intercept);
      const predictedOverall = calibrateValue(held.doubao[arm][slot].overall, fit.overall);
      overallErrors.push(Math.abs(predictedOverall - held.minimax[slot].overall));
      for (const dimension of REALISM_DIMENSIONS) {
        const predicted = calibrateValue(held.doubao[arm][slot].dimensions[dimension], fit.dimensions[dimension]);
        dimensionErrors[dimension].push(Math.abs(predicted - held.minimax[slot].dimensions[dimension]));
      }
    }
  }

  const mae = mean(overallErrors) ?? 0;
  return {
    n: anchorRows.length,
    overallMae: mae,
    overallRmse: round(Math.sqrt(overallErrors.reduce((sum, value) => sum + value * value, 0) / overallErrors.length)),
    overallMaxAbsError: round(Math.max(...overallErrors)),
    dimensionMae: Object.fromEntries(REALISM_DIMENSIONS.map((dimension) => [dimension, mean(dimensionErrors[dimension]) ?? 0])) as Record<
      RealismDimension,
      number
    >,
    slopeMin: round(Math.min(...slopes)),
    slopeMax: round(Math.max(...slopes)),
    interceptMin: round(Math.min(...intercepts)),
    interceptMax: round(Math.max(...intercepts)),
  };
}

export function evaluateCalibration(
  anchorRows: readonly CalibrationRow[],
  evalRows: readonly CalibrationRow[],
  arm: CalibrationArm,
): CalibrationEvaluation {
  const preRows = toPacketScoreSet(evalRows, arm);
  const pre = analyzeCrossModel(preRows);
  const fit = fitCalibration(anchorRows, arm);
  const calibratedRows = applyCalibration(evalRows, fit);
  const post = analyzeCrossModel(calibratedRows);
  const loo = leaveOneOutCalibration(anchorRows, arm);
  const preDelta = pre.absoluteDelta.meanOverall;
  const postDelta = post.absoluteDelta.meanOverall;
  const improvement = preDelta === null || postDelta === null ? null : round(preDelta - postDelta);
  const preOverallStd = overallStd(preRows);
  const postOverallStd = overallStd(calibratedRows);
  const discriminationRetention = preOverallStd > 0 ? round(postOverallStd / preOverallStd) : 1;

  const reasons: string[] = [];
  if (evalRows.length < CALIBRATION_THRESHOLDS.minPackets) {
    reasons.push(`评测 packet 不足 ${CALIBRATION_THRESHOLDS.minPackets}（实际 ${evalRows.length}）`);
  }
  if (postDelta === null || postDelta > CALIBRATION_THRESHOLDS.overallMeanAbsDelta) {
    reasons.push(`校准后总体绝对差=${postDelta ?? 'null'} > ${CALIBRATION_THRESHOLDS.overallMeanAbsDelta}`);
  }
  const kappa = post.agreement.crossPrimary.overall.linearWeightedKappa;
  if (kappa === null || kappa < CALIBRATION_THRESHOLDS.overallKappa) {
    reasons.push(`校准后跨模型 κ=${kappa ?? 'null'} < ${CALIBRATION_THRESHOLDS.overallKappa}`);
  }
  for (const dimension of REALISM_DIMENSIONS) {
    const within = post.agreement.crossPrimary.dimensions[dimension].withinOneAgreement;
    if (within < CALIBRATION_THRESHOLDS.dimensionWithinOne) {
      reasons.push(`校准后 ${dimension} within±1=${within} < ${CALIBRATION_THRESHOLDS.dimensionWithinOne}`);
    }
  }
  if (post.sceneDirectionFlipped.length > 0) {
    reasons.push(`校准后场景方向翻转：${post.sceneDirectionFlipped.join(',')}`);
  }
  if (loo.overallMae > CALIBRATION_THRESHOLDS.looMeanAbsError) {
    reasons.push(`锚点留一法 MAE=${loo.overallMae} > ${CALIBRATION_THRESHOLDS.looMeanAbsError}`);
  }
  if (loo.slopeMin <= 0) {
    reasons.push(`锚点留一法出现非正斜率（min=${loo.slopeMin}）`);
  }
  for (const slot of ['t01', 't05'] as const) {
    const slope = fit.slots[slot].overall.slope;
    if (slope < CALIBRATION_THRESHOLDS.minOverallSlope || slope > CALIBRATION_THRESHOLDS.maxOverallSlope) {
      reasons.push(
        `${slot} 总体校准斜率=${slope} 超出 [${CALIBRATION_THRESHOLDS.minOverallSlope}, ${CALIBRATION_THRESHOLDS.maxOverallSlope}]`,
      );
    }
  }
  if (preOverallStd > 0 && discriminationRetention < CALIBRATION_THRESHOLDS.minDiscriminationRetention) {
    reasons.push(
      `校准后区分度保留=${discriminationRetention} < ${CALIBRATION_THRESHOLDS.minDiscriminationRetention}（preStd=${preOverallStd}, postStd=${postOverallStd}）`,
    );
  }

  const hardFail =
    evalRows.length < CALIBRATION_THRESHOLDS.minPackets ||
    kappa === null ||
    kappa < CALIBRATION_THRESHOLDS.conditionalKappa ||
    post.sceneDirectionFlipped.length > 0;
  const verdict: CalibrationVerdict['verdict'] = hardFail ? 'fail' : reasons.length === 0 ? 'pass' : 'conditional';

  return {
    arm,
    anchorN: anchorRows.length,
    evalN: evalRows.length,
    fit,
    loo,
    pre,
    post,
    meanAbsDeltaImprovement: improvement,
    preOverallStd,
    postOverallStd,
    discriminationRetention,
    judgment: { verdict, reasons },
  };
}

function armMetrics(analysis: CrossModelAnalysis, rows: readonly CalibrationRow[], arm: CalibrationArm): ThinkingArmMetrics {
  const scores = rows.flatMap((row) => [row.doubao[arm].t01.overall, row.doubao[arm].t05.overall]);
  const dimensions = REALISM_DIMENSIONS.map((dimension) =>
    std(rows.flatMap((row) => [row.doubao[arm].t01.dimensions[dimension], row.doubao[arm].t05.dimensions[dimension]])),
  );
  return {
    arm,
    intraKappa: analysis.agreement.intraDoubao.overall.linearWeightedKappa,
    intraExact: analysis.agreement.intraDoubao.overall.exactAgreement,
    intraWithinOne: analysis.agreement.intraDoubao.overall.withinOneAgreement,
    crossT01Kappa: analysis.agreement.crossPrimary.overall.linearWeightedKappa,
    crossT05Kappa: analysis.agreement.crossSecondary.overall.linearWeightedKappa,
    crossT01Exact: analysis.agreement.crossPrimary.overall.exactAgreement,
    crossT05Exact: analysis.agreement.crossSecondary.overall.exactAgreement,
    crossT01WithinOne: analysis.agreement.crossPrimary.overall.withinOneAgreement,
    crossT05WithinOne: analysis.agreement.crossSecondary.overall.withinOneAgreement,
    meanAbsDelta: analysis.absoluteDelta.meanOverall,
    overallMean: mean(scores),
    overallStd: std(scores),
    overallUniqueValues: new Set(scores).size,
    averageDimensionStd: mean(dimensions) ?? 0,
  };
}

/**
 * 在同一批评测 packet 上比较 disabled 与 auto。
 *
 * 选择规则只用于评分档建议：跨模型 κ 过线、绝对差不高于 0.4，且区分度有实质提升才建议 auto。
 */
export function compareThinkingArms(
  disabledAnalysis: CrossModelAnalysis,
  autoAnalysis: CrossModelAnalysis,
  evalRows: readonly CalibrationRow[],
): ThinkingComparison {
  const disabled = armMetrics(disabledAnalysis, evalRows, 'disabled');
  const auto = armMetrics(autoAnalysis, evalRows, 'auto');
  const discriminationDelta = round(auto.overallStd - disabled.overallStd);
  const reasons: string[] = [];
  const crossPass =
    auto.crossT01Kappa !== null &&
    auto.crossT05Kappa !== null &&
    auto.crossT01Kappa >= THINKING_THRESHOLDS.crossKappa &&
    auto.crossT05Kappa >= THINKING_THRESHOLDS.crossKappa;
  const deltaPass = auto.meanAbsDelta !== null && auto.meanAbsDelta <= THINKING_THRESHOLDS.maxMeanAbsDelta;
  if (!crossPass) reasons.push('auto 跨模型 κ 未同时过 0.4');
  if (!deltaPass) reasons.push(`auto 总体绝对差=${auto.meanAbsDelta ?? 'null'} > ${THINKING_THRESHOLDS.maxMeanAbsDelta}`);

  let recommendation: ThinkingComparison['recommendation'];
  if (!crossPass || !deltaPass) {
    recommendation = 'keep-disabled';
  } else if (discriminationDelta >= THINKING_THRESHOLDS.discriminationGain) {
    recommendation = 'prefer-auto';
    reasons.push(`auto 总体分标准差提升 ${discriminationDelta}`);
  } else {
    recommendation = 'inconclusive';
    reasons.push(`auto 区分度提升不足（Δstd=${discriminationDelta}）`);
  }

  return { disabled, auto, discriminationDelta, recommendation, reasons };
}

function quantile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return round(sorted[lower]);
  return round(sorted[lower] * (upper - index) + sorted[upper] * (index - lower));
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 1_831_565_813) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** 固定校准参数后，对评测 packet 做确定性 bootstrap，给出偏移与 κ 的 95% 区间。 */
export function bootstrapCalibration(
  evalRows: readonly CalibrationRow[],
  fit: CalibrationFit,
  iterations = 2000,
  seed = 20_261_121,
): BootstrapSummary {
  if (evalRows.length < 2) throw new Error('bootstrap 至少需要 2 个评测样本');
  const random = mulberry32(seed);
  const deltas: number[] = [];
  const kappas: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sample = Array.from({ length: evalRows.length }, () => evalRows[Math.floor(random() * evalRows.length)]);
    const analysis = analyzeCrossModel(applyCalibration(sample, fit));
    if (analysis.absoluteDelta.meanOverall !== null) deltas.push(analysis.absoluteDelta.meanOverall);
    const kappa = analysis.agreement.crossPrimary.overall.linearWeightedKappa;
    if (kappa !== null) kappas.push(kappa);
  }
  deltas.sort((left, right) => left - right);
  kappas.sort((left, right) => left - right);
  return {
    iterations,
    meanAbsDeltaP025: quantile(deltas, 0.025),
    meanAbsDeltaP50: quantile(deltas, 0.5),
    meanAbsDeltaP975: quantile(deltas, 0.975),
    crossKappaP025: quantile(kappas, 0.025),
    crossKappaP50: quantile(kappas, 0.5),
    crossKappaP975: quantile(kappas, 0.975),
  };
}

/** 用于报告场景表：返回指定 arm 的每场景均值，避免消费端各算一套。 */
export function sceneMeansByArm(analysis: CrossModelAnalysis): Readonly<Record<RealismScene, number | null>> {
  return {
    in_person: analysis.sceneSlices.doubao.in_person.overallMean,
    online_voice: analysis.sceneSlices.doubao.online_voice.overallMean,
    online_text: analysis.sceneSlices.doubao.online_text.overallMean,
  };
}

/** 单维 agreement 的便捷读数，供报告与测试复用。 */
export function crossAgreementFor(analysis: CrossModelAnalysis, dimension: RealismDimension): RealismAgreement {
  return analysis.agreement.crossPrimary.dimensions[dimension];
}
