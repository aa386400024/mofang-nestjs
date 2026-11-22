// V2026-11-21 建立 (AF-227 · 跨模型评分统计):
//   职责: 对同一批 packet 的两模型各两位评分员做一致性、偏移与场景方向判定。
//   边界: 纯函数，零 IO；阈值单点定义；不把两个模型分数合并成临床总分。

import {
  REALISM_DIMENSIONS,
  summarizeRealismAgreement,
  type RealismAgreement,
  type RealismDimension,
  type RealismRating,
} from '../src/auto-practice/metrics/visitor-realism-rating.js';
import type { RealismScene } from '../src/shared/realism/turn-shape-selector.js';

export type CrossModelName = 'minimax' | 'doubao';
export type CrossModelTemperatureSlot = 't01' | 't05';

/** 预登记判定阈值；任何报告、测试与 CLI 都读这里，不另抄。 */
export const CROSS_MODEL_THRESHOLDS = {
  overallKappa: 0.4,
  dimensionWithinOne: 0.8,
  overallMeanAbsDelta: 0.3,
  conditionalKappa: 0.3,
  conditionalMeanAbsDelta: 0.4,
} as const;

export interface RaterScoreSet {
  readonly overall: number;
  readonly dimensions: Readonly<Record<RealismDimension, number>>;
}

export interface PacketScoreSet {
  readonly packetId: string;
  readonly scene: RealismScene;
  readonly minimax: Readonly<Record<CrossModelTemperatureSlot, RaterScoreSet>>;
  readonly doubao: Readonly<Record<CrossModelTemperatureSlot, RaterScoreSet>>;
}

export interface CrossModelAgreementBlock {
  readonly overall: RealismAgreement;
  readonly dimensions: Readonly<Record<RealismDimension, RealismAgreement>>;
}

export interface ModelDistribution {
  readonly nRatings: number;
  readonly overallMean: number | null;
  readonly dimensions: Readonly<Record<RealismDimension, number | null>>;
}

export interface AbsoluteDeltaBlock {
  readonly primaryOverall: number | null;
  readonly secondaryOverall: number | null;
  readonly meanOverall: number | null;
  readonly primaryDimensions: Readonly<Record<RealismDimension, number | null>>;
  readonly secondaryDimensions: Readonly<Record<RealismDimension, number | null>>;
  readonly meanDimensions: Readonly<Record<RealismDimension, number | null>>;
}

export interface SceneSlice {
  readonly n: number;
  readonly overallMean: number | null;
  readonly dimensions: Readonly<Record<RealismDimension, number | null>>;
}

export interface SceneDirection {
  readonly onlineVoiceMinusInPerson: number | null;
  readonly onlineTextMinusInPerson: number | null;
}

export interface CrossModelVerdict {
  readonly verdict: 'pass' | 'conditional' | 'fail';
  readonly reasons: readonly string[];
}

export interface CrossModelAnalysis {
  readonly packetCount: number;
  readonly ratingCount: number;
  readonly agreement: {
    readonly intraMinimax: CrossModelAgreementBlock;
    readonly intraDoubao: CrossModelAgreementBlock;
    readonly crossPrimary: CrossModelAgreementBlock;
    readonly crossSecondary: CrossModelAgreementBlock;
  };
  readonly distribution: Readonly<Record<CrossModelName, ModelDistribution>>;
  readonly absoluteDelta: AbsoluteDeltaBlock;
  readonly sceneSlices: Readonly<Record<CrossModelName, Readonly<Record<RealismScene, SceneSlice>>>>;
  readonly sceneDirection: Readonly<Record<CrossModelName, SceneDirection>>;
  readonly sceneDirectionFlipped: readonly string[];
  readonly packetRows: readonly {
    readonly packetId: string;
    readonly scene: RealismScene;
    readonly minimax: Readonly<Record<CrossModelTemperatureSlot, number>>;
    readonly doubao: Readonly<Record<CrossModelTemperatureSlot, number>>;
    readonly meanAbsDelta: number;
  }[];
  readonly judgment: CrossModelVerdict;
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function averageAbs(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return average(values.map((value) => Math.abs(value)));
}

/** 从评分对象抽出纯数值，便于统计与测试。 */
export function scoreSetFromRating(rating: RealismRating): RaterScoreSet {
  const dimensions = {} as Record<RealismDimension, number>;
  for (const dimension of REALISM_DIMENSIONS) {
    dimensions[dimension] = rating.dimensions[dimension].score;
  }
  return { overall: rating.overall, dimensions };
}

function agreementBlock(values1: readonly RaterScoreSet[], values2: readonly RaterScoreSet[]): CrossModelAgreementBlock {
  const dimensions = {} as Record<RealismDimension, RealismAgreement>;
  for (const dimension of REALISM_DIMENSIONS) {
    dimensions[dimension] = summarizeRealismAgreement(
      values1.map((item) => item.dimensions[dimension]),
      values2.map((item) => item.dimensions[dimension]),
    );
  }
  return {
    overall: summarizeRealismAgreement(
      values1.map((item) => item.overall),
      values2.map((item) => item.overall),
    ),
    dimensions,
  };
}

function modelDistribution(ratings: readonly RaterScoreSet[]): ModelDistribution {
  const dimensions = {} as Record<RealismDimension, number | null>;
  for (const dimension of REALISM_DIMENSIONS) {
    dimensions[dimension] = average(ratings.map((item) => item.dimensions[dimension]));
  }
  return {
    nRatings: ratings.length,
    overallMean: average(ratings.map((item) => item.overall)),
    dimensions,
  };
}

function sceneSlices(rows: readonly PacketScoreSet[], model: CrossModelName): Readonly<Record<RealismScene, SceneSlice>> {
  const slices = {} as Record<RealismScene, SceneSlice>;
  for (const scene of ['in_person', 'online_voice', 'online_text'] as const) {
    const sceneRows = rows.filter((row) => row.scene === scene);
    const perPacket = sceneRows.map((row) => ({
      overall: (row[model].t01.overall + row[model].t05.overall) / 2,
      dimensions: Object.fromEntries(
        REALISM_DIMENSIONS.map((dimension) => [
          dimension,
          (row[model].t01.dimensions[dimension] + row[model].t05.dimensions[dimension]) / 2,
        ]),
      ) as Record<RealismDimension, number>,
    }));
    const dimensions = {} as Record<RealismDimension, number | null>;
    for (const dimension of REALISM_DIMENSIONS) {
      dimensions[dimension] = average(perPacket.map((item) => item.dimensions[dimension]));
    }
    slices[scene] = {
      n: sceneRows.length,
      overallMean: average(perPacket.map((item) => item.overall)),
      dimensions,
    };
  }
  return slices;
}

function sceneDirection(slices: Readonly<Record<RealismScene, SceneSlice>>): SceneDirection {
  const inPerson = slices.in_person.overallMean;
  if (inPerson === null) {
    return { onlineVoiceMinusInPerson: null, onlineTextMinusInPerson: null };
  }
  const onlineVoice = slices.online_voice.overallMean;
  const onlineText = slices.online_text.overallMean;
  return {
    onlineVoiceMinusInPerson: onlineVoice === null ? null : round(onlineVoice - inPerson),
    onlineTextMinusInPerson: onlineText === null ? null : round(onlineText - inPerson),
  };
}

function sign(value: number | null): -1 | 0 | 1 | null {
  if (value === null) return null;
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

function detectSceneFlip(directions: Readonly<Record<CrossModelName, SceneDirection>>): readonly string[] {
  const flipped: string[] = [];
  for (const key of ['onlineVoiceMinusInPerson', 'onlineTextMinusInPerson'] as const) {
    const left = sign(directions.minimax[key]);
    const right = sign(directions.doubao[key]);
    if (left !== null && right !== null && left !== 0 && right !== 0 && left !== right) {
      flipped.push(key);
    }
  }
  return flipped;
}

/**
 * 计算 2×2 跨模型分析。
 *
 * 输入只包含数值分数与 packet 元信息，不含台词原文。
 */
export function analyzeCrossModel(rows: readonly PacketScoreSet[]): CrossModelAnalysis {
  const mmT01 = rows.map((row) => row.minimax.t01);
  const mmT05 = rows.map((row) => row.minimax.t05);
  const dbT01 = rows.map((row) => row.doubao.t01);
  const dbT05 = rows.map((row) => row.doubao.t05);

  const agreement = {
    intraMinimax: agreementBlock(mmT01, mmT05),
    intraDoubao: agreementBlock(dbT01, dbT05),
    crossPrimary: agreementBlock(mmT01, dbT01),
    crossSecondary: agreementBlock(mmT05, dbT05),
  };

  const distribution = {
    minimax: modelDistribution([...mmT01, ...mmT05]),
    doubao: modelDistribution([...dbT01, ...dbT05]),
  };

  const primaryOverall: number[] = [];
  const secondaryOverall: number[] = [];
  const meanOverall: number[] = [];
  const primaryDimensions = {} as Record<RealismDimension, number[]>;
  const secondaryDimensions = {} as Record<RealismDimension, number[]>;
  const meanDimensions = {} as Record<RealismDimension, number[]>;
  for (const dimension of REALISM_DIMENSIONS) {
    primaryDimensions[dimension] = [];
    secondaryDimensions[dimension] = [];
    meanDimensions[dimension] = [];
  }
  const packetRows: {
    readonly packetId: string;
    readonly scene: RealismScene;
    readonly minimax: Readonly<Record<CrossModelTemperatureSlot, number>>;
    readonly doubao: Readonly<Record<CrossModelTemperatureSlot, number>>;
    readonly meanAbsDelta: number;
  }[] = [];
  for (const row of rows) {
    const primary = row.minimax.t01.overall - row.doubao.t01.overall;
    const secondary = row.minimax.t05.overall - row.doubao.t05.overall;
    primaryOverall.push(primary);
    secondaryOverall.push(secondary);
    meanOverall.push((primary + secondary) / 2);
    for (const dimension of REALISM_DIMENSIONS) {
      const d1 = row.minimax.t01.dimensions[dimension] - row.doubao.t01.dimensions[dimension];
      const d2 = row.minimax.t05.dimensions[dimension] - row.doubao.t05.dimensions[dimension];
      primaryDimensions[dimension].push(d1);
      secondaryDimensions[dimension].push(d2);
      meanDimensions[dimension].push((d1 + d2) / 2);
    }
    packetRows.push({
      packetId: row.packetId,
      scene: row.scene,
      minimax: { t01: row.minimax.t01.overall, t05: row.minimax.t05.overall },
      doubao: { t01: row.doubao.t01.overall, t05: row.doubao.t05.overall },
      meanAbsDelta: round((Math.abs(primary) + Math.abs(secondary)) / 2),
    });
  }

  const absoluteDelta: AbsoluteDeltaBlock = {
    primaryOverall: averageAbs(primaryOverall),
    secondaryOverall: averageAbs(secondaryOverall),
    meanOverall: averageAbs(meanOverall),
    primaryDimensions: Object.fromEntries(
      REALISM_DIMENSIONS.map((dimension) => [dimension, averageAbs(primaryDimensions[dimension])]),
    ) as Record<RealismDimension, number | null>,
    secondaryDimensions: Object.fromEntries(
      REALISM_DIMENSIONS.map((dimension) => [dimension, averageAbs(secondaryDimensions[dimension])]),
    ) as Record<RealismDimension, number | null>,
    meanDimensions: Object.fromEntries(REALISM_DIMENSIONS.map((dimension) => [dimension, averageAbs(meanDimensions[dimension])])) as Record<
      RealismDimension,
      number | null
    >,
  };

  const slices = {
    minimax: sceneSlices(rows, 'minimax'),
    doubao: sceneSlices(rows, 'doubao'),
  };
  const directions = {
    minimax: sceneDirection(slices.minimax),
    doubao: sceneDirection(slices.doubao),
  };
  const sceneDirectionFlipped = detectSceneFlip(directions);

  const reasons: string[] = [];
  if (rows.length < 24) reasons.push(`packet 不足 24（实际 ${rows.length}）`);
  const overallKappa = agreement.crossPrimary.overall.linearWeightedKappa;
  if (overallKappa === null || overallKappa < CROSS_MODEL_THRESHOLDS.overallKappa) {
    reasons.push(`跨模型总体 κ=${overallKappa ?? 'null'} < ${CROSS_MODEL_THRESHOLDS.overallKappa}`);
  }
  for (const dimension of REALISM_DIMENSIONS) {
    const within = agreement.crossPrimary.dimensions[dimension].withinOneAgreement;
    if (within < CROSS_MODEL_THRESHOLDS.dimensionWithinOne) {
      reasons.push(`${dimension} within±1=${within} < ${CROSS_MODEL_THRESHOLDS.dimensionWithinOne}`);
    }
  }
  const delta = absoluteDelta.meanOverall;
  if (delta === null || delta > CROSS_MODEL_THRESHOLDS.overallMeanAbsDelta) {
    reasons.push(`总体绝对差均值=${delta ?? 'null'} > ${CROSS_MODEL_THRESHOLDS.overallMeanAbsDelta}`);
  }
  if (sceneDirectionFlipped.length > 0) {
    reasons.push(`场景方向翻转：${sceneDirectionFlipped.join(',')}`);
  }

  let verdict: CrossModelVerdict['verdict'] = 'pass';
  const hardFail =
    rows.length < 24 ||
    overallKappa === null ||
    overallKappa < CROSS_MODEL_THRESHOLDS.conditionalKappa ||
    datasetSceneDirectionFail(sceneDirectionFlipped);
  if (hardFail) {
    verdict = 'fail';
  } else if (reasons.length > 0) {
    verdict = 'conditional';
  }

  return {
    packetCount: rows.length,
    ratingCount: rows.length * 4,
    agreement,
    distribution,
    absoluteDelta,
    sceneSlices: slices,
    sceneDirection: directions,
    sceneDirectionFlipped,
    packetRows,
    judgment: { verdict, reasons },
  };
}

function datasetSceneDirectionFail(flipped: readonly string[]): boolean {
  return flipped.length > 0;
}
