// V2026-11-29 (Phase3 Judge Layer P0 · 契约守卫):
//   职责: 对 Judge 输入 / Provider 输出 / 可选快照段做**手写**严格校验.
//   边界: 纯函数; 不引入 zod / json-schema 等新依赖 (仓库既有口径是手写校验).
//
//   为什么"不宽松通过":
//     Judge 结果会进入批次报告与快照. 一个 rating=3 / 空理由 / 空证据 / 缺血缘的结果
//     一旦被放过, 半年后没人能判断这条记录到底是不是同一把尺子量出来的.
//     所以非法结构一律抛错, 由 Shadow 编排记 null, 批次继续.

import { JUDGE_PROMPT_VERSION, JUDGE_RUBRIC_VERSION, computeJudgeRubricFingerprint } from './judge.rubric.js';
import { JUDGE_MACHINE_PROXY_LABEL, JUDGE_RATINGS, JUDGE_SHADOW_MODE, JUDGE_DIMENSIONS } from './judge.types.js';

import type { JudgeDimensionResult, JudgeEvidenceRef, JudgeReviewInput, JudgeReviewLineage, JudgeReviewResult } from './judge.types.js';
import { EMAIL_PATTERN, ID_CARD_PATTERN, PHONE_PATTERN } from '../../shared/infra/observability/pii-redactor.js';

/** P0 允许的 Provider (只含后端已连通厂商; DeepSeek 明确排除). */
export const JUDGE_PROVIDER_ALLOWLIST = ['minimax'] as const;

/** 契约错误码. */
export type JudgeContractErrorCode = 'provider_not_allowed' | 'model_not_allowed' | 'input_invalid' | 'review_invalid' | 'snapshot_invalid';

/** 契约错误. */
export class JudgeContractError extends Error {
  constructor(
    readonly code: JudgeContractErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'JudgeContractError';
  }
}

/**
 * 校验 Provider 是否在 P0 白名单内.
 *
 * @param providerId Provider id
 */
export function assertJudgeProviderAllowed(providerId: string): void {
  if (!(JUDGE_PROVIDER_ALLOWLIST as readonly string[]).includes(providerId)) {
    throw new JudgeContractError('provider_not_allowed', `Judge Provider 未登记或不在 P0 白名单: ${providerId}`);
  }
}

/**
 * 校验模型名是否被排除 (DeepSeek 不接入).
 *
 * @param model 模型名
 */
export function assertJudgeModelAllowed(model: string): void {
  if (/deepseek/i.test(model)) {
    throw new JudgeContractError('model_not_allowed', `DeepSeek 明确排除于 Judge P0: ${model}`);
  }
}

/**
 * 判断一个值是普通对象.
 *
 * @param value 待判断值
 * @returns 是否普通对象
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 判断一个值是非空字符串.
 *
 * @param value 待判断值
 * @returns 是否非空字符串
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 判断一个值是有限数字.
 *
 * @param value 待判断值
 * @returns 是否有限数字
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 判断一个值是非负整数.
 *
 * @param value 待判断值
 * @returns 是否非负整数
 */
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * 校验文本里不再出现原始 PII (纵深防御: 即使上层忘了脱敏, 也不放行).
 *
 * @param text 待检查文本
 * @param label 出错标识
 */
function assertNoRawPii(text: string, label: string): void {
  const patterns = [PHONE_PATTERN, ID_CARD_PATTERN, EMAIL_PATTERN];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const hit = pattern.test(text);
    pattern.lastIndex = 0;
    if (hit) throw new JudgeContractError('input_invalid', `${label} 仍含原始 PII`);
  }
}

/**
 * 校验数值字典.
 *
 * @param value 待校验值
 * @param label 出错标识
 */
function assertNumericRecord(value: unknown, label: string): void {
  if (!isRecord(value)) throw new JudgeContractError('input_invalid', `${label} 不是对象`);
  for (const [key, entry] of Object.entries(value)) {
    if (!isFiniteNumber(entry)) throw new JudgeContractError('input_invalid', `${label}.${key} 不是有限数字`);
  }
}

/**
 * 校验 L0 指标段.
 *
 * @param value 待校验值
 */
function assertL0(value: unknown): void {
  if (!isRecord(value)) throw new JudgeContractError('input_invalid', 'l0 缺失');
  assertNumericRecord(value['first'], 'l0.first');
  assertNumericRecord(value['last'], 'l0.last');
  assertNumericRecord(value['delta'], 'l0.delta');
  if (!isNonNegativeInteger(value['turnCount'])) throw new JudgeContractError('input_invalid', 'l0.turnCount 非法');
}

/**
 * 校验 L1 事件标签段.
 *
 * @param value 待校验值
 */
function assertL1(value: unknown): void {
  if (!Array.isArray(value)) throw new JudgeContractError('input_invalid', 'l1 不是数组');
  for (const [index, turn] of value.entries()) {
    if (!isRecord(turn) || !isNonNegativeInteger(turn['turnIndex'])) {
      throw new JudgeContractError('input_invalid', `l1[${index}] 非法`);
    }
    const eventTags = turn['eventTags'];
    if (!Array.isArray(eventTags) || eventTags.some((tag) => typeof tag !== 'string')) {
      throw new JudgeContractError('input_invalid', `l1[${index}].eventTags 非法`);
    }
  }
}

/**
 * 校验脱敏片段列表.
 *
 * @param value 待校验值
 */
function assertExcerptList(value: unknown): void {
  if (!Array.isArray(value)) throw new JudgeContractError('input_invalid', 'redactedExcerpts 不是数组');
  for (const [index, excerpt] of value.entries()) {
    if (!isRecord(excerpt)) throw new JudgeContractError('input_invalid', `redactedExcerpts[${index}] 非法`);
    if (!isNonEmptyString(excerpt['excerptId']) || !isNonNegativeInteger(excerpt['turnIndex'])) {
      throw new JudgeContractError('input_invalid', `redactedExcerpts[${index}] 缺 id/轮次`);
    }
    if (!isNonEmptyString(excerpt['text'])) throw new JudgeContractError('input_invalid', `redactedExcerpts[${index}] 缺文本`);
    if (!Array.isArray(excerpt['redactionTags'])) {
      throw new JudgeContractError('input_invalid', `redactedExcerpts[${index}] 缺脱敏标签`);
    }
    if (excerpt['structuredDigest'] !== true && excerpt['redactionTags'].length === 0) {
      throw new JudgeContractError('input_invalid', `redactedExcerpts[${index}] 未声明脱敏标签`);
    }
    assertNoRawPii(excerpt['text'], `redactedExcerpts[${index}]`);
  }
}

/**
 * 校验被排除轮次列表.
 *
 * @param value 待校验值
 */
function assertExcludedTurns(value: unknown): void {
  if (!Array.isArray(value)) throw new JudgeContractError('input_invalid', 'excludedTurns 不是数组');
  for (const [index, turn] of value.entries()) {
    if (!isRecord(turn) || !isNonNegativeInteger(turn['turnIndex'])) {
      throw new JudgeContractError('input_invalid', `excludedTurns[${index}] 非法`);
    }
    if (!isNonEmptyString(turn['riskLevel']) || !isNonEmptyString(turn['ruleRef'])) {
      throw new JudgeContractError('input_invalid', `excludedTurns[${index}] 缺风险等级或规则引用`);
    }
  }
}

/**
 * 校验血缘种子 (出境前).
 *
 * @param value 待校验值
 * @param sessionId 场次 id
 */
function assertLineageSeed(value: unknown, sessionId: string): void {
  if (!isRecord(value)) throw new JudgeContractError('input_invalid', 'lineage 缺失');
  for (const field of [
    'providerId',
    'model',
    'rubricVersion',
    'promptVersion',
    'rubricFingerprint',
    'inputFingerprint',
    'sessionId',
    'mode',
    'judgeKind',
  ] as const) {
    if (!isNonEmptyString(value[field])) throw new JudgeContractError('input_invalid', `lineage.${field} 缺失`);
  }
  if (value['rubricVersion'] !== JUDGE_RUBRIC_VERSION || value['promptVersion'] !== JUDGE_PROMPT_VERSION) {
    throw new JudgeContractError('input_invalid', 'Rubric / Prompt 版本与当前配置不一致, 不可出境');
  }
  if (value['rubricFingerprint'] !== computeJudgeRubricFingerprint()) {
    throw new JudgeContractError('input_invalid', 'Rubric 指纹与当前配置不一致');
  }
  if (value['sessionId'] !== sessionId) throw new JudgeContractError('input_invalid', 'lineage.sessionId 与输入不一致');
}

/**
 * 校验 Judge 输入 (出境前最后一道门).
 *
 * @param input 待校验输入
 */
export function assertJudgeReviewInput(input: unknown): asserts input is JudgeReviewInput {
  if (!isRecord(input)) throw new JudgeContractError('input_invalid', 'Judge 输入不是对象');
  if (!isNonEmptyString(input['sessionId'])) throw new JudgeContractError('input_invalid', 'sessionId 缺失');
  assertL0(input['l0']);
  assertL1(input['l1']);
  assertExcerptList(input['redactedExcerpts']);
  assertExcludedTurns(input['excludedTurns']);
  assertLineageSeed(input['lineage'], input['sessionId']);
}

/**
 * 校验血缘字段.
 *
 * @param lineage 待校验值
 * @param label 出错标识
 */
function assertLineageShape(lineage: unknown, label: string): asserts lineage is JudgeReviewLineage {
  if (!isRecord(lineage)) throw new JudgeContractError('review_invalid', `${label} 缺血缘`);
  for (const field of [
    'providerId',
    'model',
    'rubricVersion',
    'promptVersion',
    'rubricFingerprint',
    'inputFingerprint',
    'sessionId',
    'generatedAt',
    'mode',
    'judgeKind',
  ] as const) {
    if (!isNonEmptyString(lineage[field])) throw new JudgeContractError('review_invalid', `${label} 缺 ${field}`);
  }
  if (lineage['mode'] !== JUDGE_SHADOW_MODE || lineage['judgeKind'] !== 'machine_proxy') {
    throw new JudgeContractError('review_invalid', `${label} 的 mode/judgeKind 非法`);
  }
  assertJudgeModelAllowed(lineage['model'] as string);
}

/**
 * 校验证据引用.
 *
 * @param ref 待校验值
 * @param label 出错标识
 */
function assertEvidenceRef(ref: unknown, label: string): asserts ref is JudgeEvidenceRef {
  if (!isRecord(ref)) throw new JudgeContractError('review_invalid', `${label} 不是对象`);
  if (!isNonNegativeInteger(ref['turnIndex']) || ref['turnIndex'] < 1) {
    throw new JudgeContractError('review_invalid', `${label}.turnIndex 非法`);
  }
  if (!isNonEmptyString(ref['excerptId'])) throw new JudgeContractError('review_invalid', `${label}.excerptId 缺失`);
  if (!Array.isArray(ref['eventTags'])) throw new JudgeContractError('review_invalid', `${label}.eventTags 缺失`);
}

/**
 * 校验单维结果.
 *
 * @param rating 待校验值
 * @param input 对应输入 (可空; 空时只做形状校验)
 * @param label 出错标识
 */
function assertDimensionResult(rating: unknown, input: JudgeReviewInput | null, label: string): asserts rating is JudgeDimensionResult {
  if (!isRecord(rating)) throw new JudgeContractError('review_invalid', `${label} 不是对象`);
  if (!(JUDGE_DIMENSIONS as readonly string[]).includes(rating['dimension'] as string)) {
    throw new JudgeContractError('review_invalid', `${label}.dimension 非法`);
  }
  if (!(JUDGE_RATINGS as readonly number[]).includes(rating['rating'] as number)) {
    throw new JudgeContractError('review_invalid', `${label}.rating 必须是 0/1/2`);
  }
  if (!isNonEmptyString(rating['reason'])) throw new JudgeContractError('review_invalid', `${label}.reason 缺失`);
  const evidence = rating['evidenceRefs'];
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw new JudgeContractError('review_invalid', `${label}.evidenceRefs 至少一条`);
  }
  for (const [index, ref] of evidence.entries()) assertEvidenceRef(ref, `${label}.evidenceRefs[${index}]`);
  if (!isFiniteNumber(rating['confidence']) || rating['confidence'] < 0 || rating['confidence'] > 1) {
    throw new JudgeContractError('review_invalid', `${label}.confidence 越界`);
  }

  if (input === null) return;
  for (const [index, ref] of (evidence as JudgeEvidenceRef[]).entries()) {
    const excerpt = input.redactedExcerpts.find((item) => item.excerptId === ref.excerptId);
    if (!excerpt) throw new JudgeContractError('review_invalid', `${label}.evidenceRefs[${index}] 引用不存在的 excerpt`);
    if (excerpt.turnIndex !== ref.turnIndex) {
      throw new JudgeContractError('review_invalid', `${label}.evidenceRefs[${index}] 轮次与 excerpt 不一致`);
    }
  }
}

/**
 * 校验完整评审结果.
 *
 * @param result 待校验值
 * @param input 对应输入 (可空; 空时只做形状校验)
 */
export function assertJudgeReviewResult(result: unknown, input: JudgeReviewInput | null = null): asserts result is JudgeReviewResult {
  if (!isRecord(result)) throw new JudgeContractError('review_invalid', '评审结果不是对象');
  if (!isNonEmptyString(result['sessionId'])) throw new JudgeContractError('review_invalid', '评审结果缺 sessionId');
  const disclaimer = result['disclaimer'];
  if (!isNonEmptyString(disclaimer) || !disclaimer.includes(JUDGE_MACHINE_PROXY_LABEL)) {
    throw new JudgeContractError('review_invalid', '评审结果缺机器代理标注');
  }
  if (!isFiniteNumber(result['overallConfidence']) || result['overallConfidence'] < 0 || result['overallConfidence'] > 1) {
    throw new JudgeContractError('review_invalid', 'overallConfidence 越界');
  }
  const ratings = result['ratings'];
  if (!Array.isArray(ratings) || ratings.length !== JUDGE_DIMENSIONS.length) {
    throw new JudgeContractError('review_invalid', 'ratings 必须恰好三维');
  }
  const seen = new Set<string>();
  for (const [index, rating] of ratings.entries()) {
    assertDimensionResult(rating, input, `ratings[${index}]`);
    if (seen.has(rating.dimension)) throw new JudgeContractError('review_invalid', `维度重复: ${rating.dimension}`);
    seen.add(rating.dimension);
  }
  if (seen.size !== JUDGE_DIMENSIONS.length) throw new JudgeContractError('review_invalid', '存在维度缺失');

  const lineage = result['lineage'];
  assertLineageShape(lineage, '评审结果');
  if (input !== null) {
    if (lineage.sessionId !== input.sessionId) throw new JudgeContractError('review_invalid', '血缘 sessionId 不一致');
    if (lineage.inputFingerprint !== input.lineage.inputFingerprint) {
      throw new JudgeContractError('review_invalid', '血缘输入指纹不一致');
    }
    if (lineage.rubricVersion !== input.lineage.rubricVersion || lineage.promptVersion !== input.lineage.promptVersion) {
      throw new JudgeContractError('review_invalid', '血缘 Rubric/Prompt 版本不一致');
    }
    if (result['sessionId'] !== input.sessionId) throw new JudgeContractError('review_invalid', 'sessionId 不一致');
  }
}

/**
 * 校验快照计数自洽, 返回 attempted.
 *
 * @param value 快照段
 * @param label 出错标识
 * @returns attempted 场次数
 */
function assertSnapshotCounts(value: Record<string, unknown>, label: string): number {
  for (const field of ['attemptedSessions', 'reviewedSessions', 'failedSessions'] as const) {
    if (!isNonNegativeInteger(value[field])) throw new JudgeContractError('snapshot_invalid', `${label}.${field} 非法`);
  }
  const attempted = value['attemptedSessions'] as number;
  const reviewed = value['reviewedSessions'] as number;
  const failed = value['failedSessions'] as number;
  if (reviewed + failed !== attempted) throw new JudgeContractError('snapshot_invalid', `${label} 计数不自洽`);
  return attempted;
}

/**
 * 校验失败码计数表.
 *
 * @param value 失败码表
 * @param label 出错标识
 */
function assertFailureCodes(value: unknown, label: string): void {
  if (!isRecord(value)) throw new JudgeContractError('snapshot_invalid', `${label}.failureCodes 缺失`);
  for (const [code, count] of Object.entries(value)) {
    if (!isNonNegativeInteger(count)) throw new JudgeContractError('snapshot_invalid', `${label}.failureCodes.${code} 非法`);
  }
}

/**
 * 校验可选 Judge 快照段.
 *
 * ⚠️ undefined / null 都合法: 旧快照没有 Judge 段, 失败批次也允许整段为 null.
 *
 * @param value 待校验值
 * @param label 出错标识
 */
export function assertJudgeSnapshotSection(value: unknown, label = 'judge'): void {
  if (value === undefined || value === null) return;
  if (!isRecord(value)) throw new JudgeContractError('snapshot_invalid', `${label} 不是对象`);
  if (value['mode'] !== JUDGE_SHADOW_MODE) throw new JudgeContractError('snapshot_invalid', `${label}.mode 非法`);
  if (value['machineProxy'] !== true) throw new JudgeContractError('snapshot_invalid', `${label}.machineProxy 必须为 true`);
  const disclaimer = value['disclaimer'];
  if (!isNonEmptyString(disclaimer) || !disclaimer.includes(JUDGE_MACHINE_PROXY_LABEL)) {
    throw new JudgeContractError('snapshot_invalid', `${label}.disclaimer 缺机器代理标注`);
  }
  for (const field of ['providerId', 'model', 'rubricVersion', 'promptVersion', 'rubricFingerprint', 'generatedAt'] as const) {
    if (!isNonEmptyString(value[field])) throw new JudgeContractError('snapshot_invalid', `${label}.${field} 缺失`);
  }
  const attempted = assertSnapshotCounts(value, label);
  assertFailureCodes(value['failureCodes'], label);

  const reviews = value['reviews'];
  if (!Array.isArray(reviews) || reviews.length !== attempted) {
    throw new JudgeContractError('snapshot_invalid', `${label}.reviews 数量与 attemptedSessions 不一致`);
  }
  for (const review of reviews) {
    if (review === null) continue;
    assertJudgeReviewResult(review, null);
    assertJudgeProviderAllowed(review.lineage.providerId);
  }
}
