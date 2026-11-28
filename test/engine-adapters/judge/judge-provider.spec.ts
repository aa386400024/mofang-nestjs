// AF-611 · Provider: 输入校验 / 既有 JSON 出口复用 / 失败映射 / DeepSeek 排除.

import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { makeSession, makeTurn, makeValidResult } from './judge-test-fixtures.js';
import type { CounselorLlmJsonClient } from '../../../src/counselor/providers/llm-json.client.js';
import { JudgeContractError } from '../../../src/engine-adapters/judge/judge.contract.js';
import { JudgeProviderError, MinimaxJudgeProvider, parseJudgeModelPayload } from '../../../src/engine-adapters/judge/judge.provider.js';
import { buildJudgeInput } from '../../../src/engine-adapters/judge/judge.shadow.js';

const MODEL = 'MiniMax-M3.1-Flash';

/** requestJson 替身签名. */
type RequestJsonStub = (input: unknown) => Promise<unknown>;

/** 造 Provider (可替换 client 返回值). */
function makeProvider(requestJson: RequestJsonStub, model = MODEL): MinimaxJudgeProvider {
  const client = { requestJson } as unknown as CounselorLlmJsonClient;
  const config = { get: () => model } as unknown as ConfigService;
  return new MinimaxJudgeProvider(client, config);
}

describe('AF-611 · Judge Provider', () => {
  it('输入血缘与 Provider 一致 → 复用既有 JSON 出口产出完整结果', async () => {
    const input = buildJudgeInput(makeSession('s-provider', [makeTurn(1), makeTurn(2)]), { providerId: 'minimax', model: MODEL });
    expect(input).not.toBeNull();
    const valid = makeValidResult(input!, MODEL);

    const provider = makeProvider(async (_request) => ({
      ok: true,
      data: { ratings: valid.ratings, overallConfidence: valid.overallConfidence },
      rawText: JSON.stringify({ ratings: valid.ratings }),
      errorCode: null,
      errorMessage: null,
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    }));
    const result = await provider.review(input!);

    expect(result.sessionId).toBe('s-provider');
    expect(result.ratings).toHaveLength(3);
    expect(result.lineage.providerId).toBe('minimax');
    expect(result.lineage.model).toBe(MODEL);
    expect(result.lineage.rubricVersion).toBe('judge-rubric-v1');
    expect(result.lineage.inputFingerprint).toBe(input?.lineage.inputFingerprint);
    expect(result.disclaimer).toContain('机器代理评审');
  });

  it('Provider 返回 llm_error → 抛 JudgeProviderError(llm_error)', async () => {
    const input = buildJudgeInput(makeSession('s-llm', [makeTurn(1)]), { providerId: 'minimax', model: MODEL });
    const provider = makeProvider(async () => ({
      ok: false,
      data: null,
      rawText: '',
      errorCode: 'llm_error',
      errorMessage: 'upstream 502',
      usage: null,
    }));

    await expect(provider.review(input!)).rejects.toMatchObject({
      name: 'JudgeProviderError',
      code: 'llm_error',
    });
  });

  it('非法评级 / 缺理由 / 置信度越界 → 解析为 null (交给 JSON 出口报 schema_validation_failed)', () => {
    const valid = {
      ratings: [
        {
          dimension: 'empathic_attunement',
          rating: 3,
          reason: 'x',
          evidenceRefs: [{ turnIndex: 1, excerptId: 't1', eventTags: [] }],
          confidence: 0.5,
        },
        {
          dimension: 'safety_boundary',
          rating: 1,
          reason: 'x',
          evidenceRefs: [{ turnIndex: 1, excerptId: 't1', eventTags: [] }],
          confidence: 0.5,
        },
        {
          dimension: 'intervention_structure',
          rating: 1,
          reason: 'x',
          evidenceRefs: [{ turnIndex: 1, excerptId: 't1', eventTags: [] }],
          confidence: 0.5,
        },
      ],
      overallConfidence: 0.5,
    };
    expect(parseJudgeModelPayload(valid)).toBeNull();

    const missingReason = {
      ...valid,
      ratings: valid.ratings.map((rating) => ({ ...rating, reason: ' '.repeat(3) })),
    };
    expect(parseJudgeModelPayload(missingReason)).toBeNull();

    const confidenceOut = {
      ...valid,
      ratings: valid.ratings.map((rating) => ({ ...rating, confidence: 2 })),
    };
    expect(parseJudgeModelPayload(confidenceOut)).toBeNull();

    const missingEvidence = {
      ...valid,
      ratings: valid.ratings.map((rating) => ({ ...rating, evidenceRefs: [] })),
    };
    expect(parseJudgeModelPayload(missingEvidence)).toBeNull();
  });

  it('输入仍含原始 PII → 在调用 Provider 前被拒 (provider_input_invalid)', async () => {
    const input = buildJudgeInput(makeSession('s-pii', [makeTurn(1)]), { providerId: 'minimax', model: MODEL });
    expect(input).not.toBeNull();
    const dirty = {
      ...input!,
      redactedExcerpts: input!.redactedExcerpts.map((excerpt) => ({
        ...excerpt,
        text: `${excerpt.text} 13800138000`,
      })),
    };
    let called = 0;
    const provider = makeProvider(async () => {
      called += 1;
      throw new Error('should not be called');
    });

    await expect(provider.review(dirty)).rejects.toMatchObject({ code: 'provider_input_invalid' });
    expect(called).toBe(0);
  });

  it('DeepSeek 模型在构造期即被拒 (不登记枚举 / 不建适配)', () => {
    expect(() =>
      makeProvider(async () => {
        throw new Error('unused');
      }, 'deepseek-chat'),
    ).toThrow(JudgeContractError);
  });

  it('JudgeProviderError 携带稳定错误码', () => {
    const error = new JudgeProviderError('response_invalid', 'bad');
    expect(error.code).toBe('response_invalid');
  });
});
