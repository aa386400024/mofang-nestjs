// V2026-11-29 (Phase3 Judge Layer P0 · 首个现有厂商 Provider):
//   职责: 用后端**既有**结构化 JSON 出口 (CounselorLlmJsonClient) 调已连通厂商, 产出 Judge 结果.
//   边界: 不新增 SDK / 运行时依赖; 不新建 SSE / HTTP 拼装通道; 不接 DeepSeek.
//
//   为什么复用 CounselorLlmJsonClient:
//     仓库已有唯一的"prompt + schema → 已校验 JSON"出口 (剥 think / 剥围栏 / 错误当数据),
//     再写一套 streamChat + JSON.parse 就是双胞胎, 迟早两边解析口径分叉.
//
//   ProviderId / 模型:
//     P0 只登记后端现有已连通厂商 MiniMax; 模型沿用既有解析链
//     (env MINIMAX_COUNSELOR_LLM_MODEL → 默认 MiniMax-M3.1-Flash), 并在血缘里显式记录.
//     DeepSeek 不登记枚举 / 配置 / 适配, 运行时白名单 + 模型名双重拦截.

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  assertJudgeModelAllowed,
  assertJudgeProviderAllowed,
  assertJudgeReviewInput,
  assertJudgeReviewResult,
  JudgeContractError,
} from './judge.contract.js';
import {
  JUDGE_PROMPT_VERSION,
  JUDGE_RUBRIC_VERSION,
  JUDGE_RUBRIC,
  computeJudgeRubricFingerprint,
  renderJudgePrompt,
} from './judge.rubric.js';
import type { JudgeDimensionResult, JudgeEvidenceRef, JudgeReviewInput, JudgeReviewResult, ReviewJudgePort } from './judge.types.js';
import { JUDGE_DIMENSIONS, JUDGE_MACHINE_PROXY_LABEL, JUDGE_RATINGS, JUDGE_SHADOW_MODE } from './judge.types.js';
import { COUNSELOR_LLM_DEFAULT_MODEL, COUNSELOR_LLM_MODEL_ENV_KEY } from '../../counselor/config/counselor-llm.config.js';
import { CounselorLlmJsonClient } from '../../counselor/providers/llm-json.client.js';

/** P0 Provider id (与 JUDGE_PROVIDER_ALLOWLIST 对齐). */
export const JUDGE_PROVIDER_MINIMAX = 'minimax';

/** Judge 批处理租户 / 用户 (审计占位, 不携带真实用户身份). */
const JUDGE_TENANT_ID = 'system-judge';
const JUDGE_USER_ID = 'judge-shadow';

/** Provider 错误码. */
export type JudgeProviderErrorCode =
  'provider_input_invalid' | 'llm_error' | 'json_not_found' | 'json_parse_failed' | 'schema_validation_failed' | 'response_invalid';

/** Provider 错误 (Shadow 捕获后记 null). */
export class JudgeProviderError extends Error {
  constructor(
    readonly code: JudgeProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'JudgeProviderError';
  }
}

/** Provider 解析出的模型输出 (尚缺血缘). */
interface JudgeModelPayload {
  readonly ratings: readonly JudgeDimensionResult[];
  readonly overallConfidence: number;
}

/**
 * 判断普通对象.
 *
 * @param value 待判断值
 * @returns 是否普通对象
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 解析一条证据引用.
 *
 * @param raw 原始值
 * @returns 合法引用; 非法返回 null
 */
function parseEvidenceRef(raw: unknown): JudgeEvidenceRef | null {
  if (!isRecord(raw)) return null;
  const turnIndex = raw['turnIndex'];
  const excerptId = raw['excerptId'];
  const eventTags = raw['eventTags'];
  if (typeof turnIndex !== 'number' || !Number.isInteger(turnIndex) || turnIndex < 1) return null;
  if (typeof excerptId !== 'string' || excerptId.trim().length === 0) return null;
  if (!Array.isArray(eventTags) || eventTags.some((tag) => typeof tag !== 'string')) return null;
  return { turnIndex, excerptId, eventTags: eventTags as string[] };
}

/**
 * 解析单维结果.
 *
 * @param raw 原始值
 * @returns 合法单维结果; 非法返回 null
 */
function parseDimensionResult(raw: unknown): JudgeDimensionResult | null {
  if (!isRecord(raw)) return null;
  const dimension = raw['dimension'];
  if (!(JUDGE_DIMENSIONS as readonly string[]).includes(dimension as string)) return null;
  const rating = raw['rating'];
  if (!(JUDGE_RATINGS as readonly number[]).includes(rating as number)) return null;
  const reason = raw['reason'];
  if (typeof reason !== 'string' || reason.trim().length === 0) return null;
  const confidence = raw['confidence'];
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  const refsRaw = raw['evidenceRefs'];
  if (!Array.isArray(refsRaw) || refsRaw.length === 0) return null;
  const evidenceRefs: JudgeEvidenceRef[] = [];
  for (const ref of refsRaw) {
    const parsedRef = parseEvidenceRef(ref);
    if (parsedRef === null) return null;
    evidenceRefs.push(parsedRef);
  }
  return {
    dimension: dimension as JudgeDimensionResult['dimension'],
    rating: rating as JudgeDimensionResult['rating'],
    reason: reason.trim(),
    evidenceRefs,
    confidence,
  };
}

/**
 * 解析并校验模型 JSON 载荷 (字段级; 与输入的一致性由完整结果守卫兜底).
 *
 * @param raw 模型 JSON
 * @returns 合法载荷; 非法返回 null
 */
export function parseJudgeModelPayload(raw: unknown): JudgeModelPayload | null {
  if (!isRecord(raw)) return null;
  const ratingsRaw = raw['ratings'];
  if (!Array.isArray(ratingsRaw) || ratingsRaw.length !== JUDGE_DIMENSIONS.length) return null;
  const ratings: JudgeDimensionResult[] = [];
  const seen = new Set<string>();

  for (const item of ratingsRaw) {
    const parsed = parseDimensionResult(item);
    if (parsed === null) return null;
    if (seen.has(parsed.dimension)) return null;
    seen.add(parsed.dimension);
    ratings.push(parsed);
  }

  const overall = raw['overallConfidence'];
  if (typeof overall !== 'number' || !Number.isFinite(overall) || overall < 0 || overall > 1) return null;
  if (seen.size !== JUDGE_DIMENSIONS.length) return null;
  return { ratings, overallConfidence: overall };
}

/**
 * MiniMax Judge Provider.
 *
 * 只实现 ReviewJudgePort: 输入校验 → 渲染 Prompt → 既有结构化 JSON 出口 → 结果守卫.
 */
@Injectable()
export class MinimaxJudgeProvider implements ReviewJudgePort {
  readonly providerId = JUDGE_PROVIDER_MINIMAX;
  readonly model: string;

  constructor(
    private readonly client: CounselorLlmJsonClient,
    private readonly config: ConfigService,
  ) {
    this.model = this.config.get<string>(COUNSELOR_LLM_MODEL_ENV_KEY) ?? COUNSELOR_LLM_DEFAULT_MODEL;
    assertJudgeProviderAllowed(this.providerId);
    assertJudgeModelAllowed(this.model);
  }

  /**
   * 评审一场.
   *
   * @param input 脱敏后的场次输入
   * @returns 完整评审结果
   */
  async review(input: JudgeReviewInput): Promise<JudgeReviewResult> {
    try {
      assertJudgeReviewInput(input);
    } catch (error) {
      throw new JudgeProviderError('provider_input_invalid', error instanceof Error ? error.message : String(error));
    }
    if (input.lineage.providerId !== this.providerId) {
      throw new JudgeProviderError('provider_input_invalid', '输入血缘 Provider 与当前 Provider 不一致');
    }
    if (input.lineage.model !== this.model) {
      throw new JudgeProviderError('provider_input_invalid', '输入血缘模型与当前 Provider 不一致');
    }

    const prompt = renderJudgePrompt(input, JUDGE_RUBRIC);
    const response = await this.client.requestJson<JudgeModelPayload>({
      systemPrompt: prompt,
      userPrompt: '请按输出契约给出本场三维机器代理评审 JSON.',
      schemaDescription: JUDGE_RUBRIC.outputContract,
      validate: (raw) => parseJudgeModelPayload(raw),
      maxCompletionTokens: 4096,
      reasoningEffort: 'medium',
      timeoutMs: 60_000,
      tenantId: JUDGE_TENANT_ID,
      userId: JUDGE_USER_ID,
      traceId: `judge:${input.sessionId}`,
      model: this.model,
      temperature: 0,
    });

    if (!response.ok || response.data === null) {
      throw new JudgeProviderError(
        (response.errorCode as JudgeProviderErrorCode | null) ?? 'llm_error',
        response.errorMessage ?? 'Judge Provider 调用失败',
      );
    }

    const result: JudgeReviewResult = {
      sessionId: input.sessionId,
      ratings: response.data.ratings,
      overallConfidence: response.data.overallConfidence,
      disclaimer: JUDGE_MACHINE_PROXY_LABEL,
      lineage: {
        ...input.lineage,
        rubricVersion: JUDGE_RUBRIC_VERSION,
        promptVersion: JUDGE_PROMPT_VERSION,
        rubricFingerprint: computeJudgeRubricFingerprint(),
        generatedAt: new Date().toISOString(),
        mode: JUDGE_SHADOW_MODE,
        judgeKind: 'machine_proxy',
      },
    };

    try {
      assertJudgeReviewResult(result, input);
    } catch (error) {
      throw new JudgeProviderError('response_invalid', error instanceof JudgeContractError ? error.message : String(error));
    }
    return result;
  }
}
