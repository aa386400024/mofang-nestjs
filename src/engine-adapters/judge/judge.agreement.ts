// V2026-11-29 (Phase3 Judge Layer P1-A · 双 Judge 同场配对一致率纯度量):
//   职责: 把「同场两场机器代理评审」配对成逐维 0/1/2 一致率、整体一致集合、
//         两侧整体信心差与分歧维度清单, 再聚合为批次级观测报告.
//   边界: 纯 TS, 零 @nestjs / 零 IO / 零 env / 零 vendor SDK; 不发起任何 Provider 调用.
//
//   三条硬边界:
//     ① 一致率只描述两场机器代理评审的对齐程度, 不是分数 / 及格线 / 临床诊断;
//     ② 样本不足时一致率记 null, 不产出达标 / 不达标结论, 保持 neutral 观测属性;
//     ③ 只引用两侧既有 lineage, 不重新采集 Provider / 模型 / Rubric / Prompt 血缘.

import type {
  JudgeAgreementLineageRef,
  JudgeAgreementSection,
  JudgeDimension,
  JudgeRating,
  JudgeReviewLineage,
  JudgeReviewResult,
} from './judge.types.js';
import { JUDGE_DIMENSIONS } from './judge.types.js';

/** 默认最小配对场次门槛: 低于该值只留观测, 不给一致率数值. */
export const DEFAULT_JUDGE_AGREEMENT_MIN_PAIRS = 5;

/** 单维配对结果. */
export interface JudgeDimensionAgreement {
  /** 维度. */
  readonly dimension: JudgeDimension;
  /** 左侧 0/1/2 主评. */
  readonly leftRating: JudgeRating;
  /** 右侧 0/1/2 主评. */
  readonly rightRating: JudgeRating;
  /** 两侧是否同档. */
  readonly agree: boolean;
}

/** 单场配对结果. */
export interface JudgeAgreementPair {
  /** 场次 id (两侧一致). */
  readonly sessionId: string;
  /** 左场评审结果. */
  readonly left: JudgeReviewResult;
  /** 右场评审结果. */
  readonly right: JudgeReviewResult;
  /** 逐维配对. */
  readonly dimensionAgreements: readonly JudgeDimensionAgreement[];
  /** 三维是否全部同档. */
  readonly overallAgree: boolean;
  /** 两侧整体信心度绝对差 (已 round6). */
  readonly confidenceDelta: number;
  /** 分歧维度清单 (按 JUDGE_DIMENSIONS 顺序). */
  readonly disagreementDimensions: readonly JudgeDimension[];
}

/** 批次级一致率观测报告 (无 pass / fail 结论). */
export interface JudgeAgreementAggregate {
  /** 最小配对场次门槛. */
  readonly minPairs: number;
  /** 实际配对场次数. */
  readonly pairedSessions: number;
  /** 是否低于最小场次门槛. */
  readonly lowSample: boolean;
  /** 整体一致率 [0,1]; 低样本或无配对时为 null. */
  readonly overallAgreementRate: number | null;
  /** 逐维一致率 [0,1]; 低样本或无配对时均为 null. */
  readonly dimensionAgreementRates: Readonly<Record<JudgeDimension, number | null>>;
  /** 逐维分歧场次数 (分歧维度分布). */
  readonly disagreementDimensionCounts: Readonly<Record<JudgeDimension, number>>;
}

/** 一致率子段构建选项. */
export interface JudgeAgreementOptions {
  /** 最小配对场次门槛; 默认 DEFAULT_JUDGE_AGREEMENT_MIN_PAIRS. */
  readonly minPairs?: number;
}

/** round6: 与指标字典跨机器复算口径一致. */
function round6(value: number): number {
  return Number(value.toFixed(6));
}

/** 取某维评级; 契约要求三维齐全, 缺失视为非法输入. */
function ratingOf(review: JudgeReviewResult, dimension: JudgeDimension): JudgeRating {
  const item = review.ratings.find((entry) => entry.dimension === dimension);
  if (item === undefined) throw new Error(`judge agreement: ${review.sessionId} 缺维度 ${dimension}`);
  return item.rating;
}

/**
 * 同场配对两侧评审结果.
 *
 * 规则:
 *   - 任一侧为 null 的场次不计入配对分母;
 *   - 只配对 sessionId 相同的场次, 不按数组下标硬对齐;
 *   - 同一侧出现重复 sessionId 视为非法输入, 直接抛错 (避免静默选错).
 *
 * @param left 左侧评审结果 (可按任意顺序, 可含 null)
 * @param right 右侧评审结果 (可按任意顺序, 可含 null)
 * @returns 按左侧顺序排列的配对结果
 */
export function pairJudgeReviews(
  left: readonly (JudgeReviewResult | null)[],
  right: readonly (JudgeReviewResult | null)[],
): readonly JudgeAgreementPair[] {
  const rightBySession = new Map<string, JudgeReviewResult>();
  for (const review of right) {
    if (review === null) continue;
    if (rightBySession.has(review.sessionId)) throw new Error(`judge agreement: 右侧重复 sessionId ${review.sessionId}`);
    rightBySession.set(review.sessionId, review);
  }
  const seenLeft = new Set<string>();
  const pairs: JudgeAgreementPair[] = [];
  for (const review of left) {
    if (review === null) continue;
    if (seenLeft.has(review.sessionId)) throw new Error(`judge agreement: 左侧重复 sessionId ${review.sessionId}`);
    seenLeft.add(review.sessionId);
    const counterpart = rightBySession.get(review.sessionId);
    if (counterpart === undefined) continue;
    pairs.push(computePair(review, counterpart));
  }
  return pairs;
}

/** 计算单场配对结果. */
export function computePair(left: JudgeReviewResult, right: JudgeReviewResult): JudgeAgreementPair {
  if (left.sessionId !== right.sessionId) throw new Error(`judge agreement: sessionId 不一致 ${left.sessionId} / ${right.sessionId}`);
  const dimensionAgreements = JUDGE_DIMENSIONS.map((dimension) => {
    const leftRating = ratingOf(left, dimension);
    const rightRating = ratingOf(right, dimension);
    return { dimension, leftRating, rightRating, agree: leftRating === rightRating };
  });
  const disagreementDimensions = dimensionAgreements.filter((item) => !item.agree).map((item) => item.dimension);
  return {
    sessionId: left.sessionId,
    left,
    right,
    dimensionAgreements,
    overallAgree: disagreementDimensions.length === 0,
    confidenceDelta: round6(Math.abs(left.overallConfidence - right.overallConfidence)),
    disagreementDimensions,
  };
}

/** 归一化并校验最小场次门槛. */
function normalizeMinPairs(options: JudgeAgreementOptions = {}): number {
  const minPairs = options.minPairs ?? DEFAULT_JUDGE_AGREEMENT_MIN_PAIRS;
  if (!Number.isInteger(minPairs) || minPairs < 0) throw new Error(`judge agreement: minPairs 非法 ${minPairs}`);
  return minPairs;
}

/**
 * 批次级聚合.
 *
 * 低样本口径: pairedSessions < minPairs 时, 整体与逐维一致率全部记 null;
 * 分歧维度分布仍保留原始计数, 供观测排查, 但不构成达标 / 不达标结论.
 *
 * @param pairs 已配对结果
 * @param options 最小场次门槛
 * @returns 批次级观测报告
 */
export function aggregateJudgeAgreement(
  pairs: readonly JudgeAgreementPair[],
  options: JudgeAgreementOptions = {},
): JudgeAgreementAggregate {
  const minPairs = normalizeMinPairs(options);
  const pairedSessions = pairs.length;
  const lowSample = pairedSessions < minPairs;
  const dimensionAgreementRates = {} as Record<JudgeDimension, number | null>;
  const disagreementDimensionCounts = {} as Record<JudgeDimension, number>;
  for (const dimension of JUDGE_DIMENSIONS) {
    const comparable = pairs.length;
    const agreeCount = pairs.filter((pair) => pair.dimensionAgreements.some((item) => item.dimension === dimension && item.agree)).length;
    dimensionAgreementRates[dimension] = lowSample || comparable === 0 ? null : round6(agreeCount / comparable);
    disagreementDimensionCounts[dimension] = pairs.filter((pair) => pair.disagreementDimensions.includes(dimension)).length;
  }
  const overallAgreeCount = pairs.filter((pair) => pair.overallAgree).length;
  const overallAgreementRate = lowSample || pairedSessions === 0 ? null : round6(overallAgreeCount / pairedSessions);
  return {
    minPairs,
    pairedSessions,
    lowSample,
    overallAgreementRate,
    dimensionAgreementRates,
    disagreementDimensionCounts,
  };
}

/** 从既有评审血缘裁剪出可落快照的只读引用. */
function toLineageRef(lineage: JudgeReviewLineage): JudgeAgreementLineageRef {
  return {
    providerId: lineage.providerId,
    model: lineage.model,
    rubricVersion: lineage.rubricVersion,
    promptVersion: lineage.promptVersion,
    rubricFingerprint: lineage.rubricFingerprint,
  };
}

/** 构建快照可选一致率子段; 无配对时血缘引用为 null. */
export function buildJudgeAgreementSection(
  pairs: readonly JudgeAgreementPair[],
  options: JudgeAgreementOptions = {},
): JudgeAgreementSection {
  const aggregate = aggregateJudgeAgreement(pairs, options);
  const first = pairs[0];
  return {
    minPairs: aggregate.minPairs,
    pairedSessions: aggregate.pairedSessions,
    overallAgreementRate: aggregate.overallAgreementRate,
    dimensionAgreementRates: aggregate.dimensionAgreementRates,
    disagreementDimensionCounts: aggregate.disagreementDimensionCounts,
    leftLineage: pairs.length === 0 ? null : toLineageRef(first.left.lineage),
    rightLineage: pairs.length === 0 ? null : toLineageRef(first.right.lineage),
  };
}

/** 非负整数. */
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** 非空字符串. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** 对象. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 比率: null 或 [0,1] 有限数. */
function isRateOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1);
}

/** 校验血缘引用. */
function assertLineageRef(value: unknown, label: string): void {
  if (!isRecord(value)) throw new Error(`${label} 不是对象`);
  for (const field of ['providerId', 'model', 'rubricVersion', 'promptVersion', 'rubricFingerprint'] as const) {
    if (!isNonEmptyString(value[field])) throw new Error(`${label}.${field} 非法`);
  }
}

/** 校验逐维键集合, 不允许缺键或夹带未知键. */
function assertExactDimensionKeys(value: Record<string, unknown>, label: string): void {
  const expected = new Set<string>(JUDGE_DIMENSIONS);
  for (const dimension of JUDGE_DIMENSIONS) {
    if (!(dimension in value)) throw new Error(`${label}.${dimension} 缺失`);
  }
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) throw new Error(`${label}.${key} 非法维度`);
  }
}

/** 校验逐维一致率: 键集合完整, 低样本必须 null, 低样本外必须为 [0,1]. */
function assertDimensionRates(value: unknown, lowSample: boolean, label: string): void {
  if (!isRecord(value)) throw new Error(`${label} 不是对象`);
  assertExactDimensionKeys(value, label);
  for (const dimension of JUDGE_DIMENSIONS) {
    const rate = value[dimension];
    if (!isRateOrNull(rate)) throw new Error(`${label}.${dimension} 非法`);
    if (lowSample && rate !== null) throw new Error(`${label}.${dimension} 低样本必须为 null`);
    if (!lowSample && rate === null) throw new Error(`${label}.${dimension} 低样本外不得为 null`);
  }
}

/** 校验逐维分歧计数: 键集合完整, 非负整数且不超过配对场次. */
function assertDisagreementCounts(value: unknown, pairedSessions: number, label: string): void {
  if (!isRecord(value)) throw new Error(`${label} 不是对象`);
  assertExactDimensionKeys(value, label);
  for (const dimension of JUDGE_DIMENSIONS) {
    const count = value[dimension];
    if (!isNonNegativeInteger(count) || count > pairedSessions) throw new Error(`${label}.${dimension} 非法`);
  }
}

/** 校验两侧血缘: 有配对必须为对象, 无配对必须为 null. */
function assertAgreementLineages(value: Record<string, unknown>, pairedSessions: number, label: string): void {
  if (pairedSessions > 0) {
    assertLineageRef(value['leftLineage'], `${label}.leftLineage`);
    assertLineageRef(value['rightLineage'], `${label}.rightLineage`);
    return;
  }
  if (value['leftLineage'] !== null || value['rightLineage'] !== null) throw new Error(`${label} 无配对时血缘必须为 null`);
}

/**
 * 校验快照内的可选一致率子段.
 *
 * undefined / null 都合法 (旧快照 / 整段失败); 对象则严格校验:
 *   - 计数与门槛自洽;
 *   - 低样本时一致率必须为 null, 不允许伪造数值;
 *   - 逐维键集合完整且无未知键;
 *   - pairedSessions > 0 时必须带两侧血缘, = 0 时必须为 null.
 *
 * @param value 待校验值
 * @param label 出错标识
 */
export function assertJudgeAgreementSection(value: unknown, label = 'judge.agreement'): void {
  if (value === undefined || value === null) return;
  if (!isRecord(value)) throw new Error(`${label} 不是对象`);
  if (!isNonNegativeInteger(value['minPairs'])) throw new Error(`${label}.minPairs 非法`);
  if (!isNonNegativeInteger(value['pairedSessions'])) throw new Error(`${label}.pairedSessions 非法`);
  if (!isRateOrNull(value['overallAgreementRate'])) throw new Error(`${label}.overallAgreementRate 非法`);
  const pairedSessions = value['pairedSessions'];
  const minPairs = value['minPairs'];
  const lowSample = pairedSessions < minPairs || pairedSessions === 0;
  if (lowSample && value['overallAgreementRate'] !== null) throw new Error(`${label}.overallAgreementRate 低样本必须为 null`);
  if (!lowSample && value['overallAgreementRate'] === null) throw new Error(`${label}.overallAgreementRate 低样本外不得为 null`);
  assertDimensionRates(value['dimensionAgreementRates'], lowSample, `${label}.dimensionAgreementRates`);
  assertDisagreementCounts(value['disagreementDimensionCounts'], pairedSessions, `${label}.disagreementDimensionCounts`);
  assertAgreementLineages(value, pairedSessions, label);
}
