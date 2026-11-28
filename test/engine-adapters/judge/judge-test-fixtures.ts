// AF-611 单测公用夹具 (不是 spec, 不会被 vitest 当测试文件收集).

import { computeJudgeInputFingerprint } from '../../../src/engine-adapters/judge/judge.fingerprint.js';
import {
  JUDGE_PROMPT_VERSION,
  JUDGE_RUBRIC_VERSION,
  computeJudgeRubricFingerprint,
} from '../../../src/engine-adapters/judge/judge.rubric.js';
import type { JudgeShadowSession, JudgeShadowTurn } from '../../../src/engine-adapters/judge/judge.shadow.js';
import type { JudgeReviewInput, JudgeReviewResult, ReviewJudgePort } from '../../../src/engine-adapters/judge/judge.types.js';
import { JUDGE_DIMENSIONS, JUDGE_MACHINE_PROXY_LABEL, JUDGE_SHADOW_MODE } from '../../../src/engine-adapters/judge/judge.types.js';

/** 造一轮. */
export function makeTurn(turnIndex: number, options: Partial<JudgeShadowTurn> = {}): JudgeShadowTurn {
  return {
    turnIndex,
    riskLevel: 'low',
    events: ['empathy'],
    before: { trust: 0.4, safety: 0.5, bond: 0.4 },
    after: { trust: 0.45, safety: 0.55, bond: 0.42 },
    ...options,
  };
}

/** 造一场. */
export function makeSession(sessionId: string, turns: readonly JudgeShadowTurn[]): JudgeShadowSession {
  return { sessionId, turns };
}

/** 造合法评审结果 (输入从 buildJudgeInput 得到的场次). */
export function makeValidResult(input: JudgeReviewInput, model = 'MiniMax-M3.1-Flash'): JudgeReviewResult {
  return {
    sessionId: input.sessionId,
    ratings: JUDGE_DIMENSIONS.map((dimension, index) => ({
      dimension,
      rating: (index % 3) as 0 | 1 | 2,
      reason: '可观察行为落在该档锚点, 论据仅引用给定片段',
      evidenceRefs: [
        {
          turnIndex: input.redactedExcerpts[0].turnIndex,
          excerptId: input.redactedExcerpts[0].excerptId,
          eventTags: input.l1[0]?.eventTags ?? [],
        },
      ],
      confidence: 0.6,
    })),
    overallConfidence: 0.6,
    disclaimer: JUDGE_MACHINE_PROXY_LABEL,
    lineage: {
      ...input.lineage,
      providerId: 'minimax',
      model,
      rubricVersion: JUDGE_RUBRIC_VERSION,
      promptVersion: JUDGE_PROMPT_VERSION,
      rubricFingerprint: computeJudgeRubricFingerprint(),
      inputFingerprint: computeJudgeInputFingerprint(input),
      generatedAt: '2026-11-29T00:00:00.000Z',
      mode: JUDGE_SHADOW_MODE,
      judgeKind: 'machine_proxy',
    },
  };
}

/** 成功端口替身. */
export function makeStubPort(model = 'MiniMax-M3.1-Flash'): ReviewJudgePort & { readonly calls: JudgeReviewInput[] } {
  const calls: JudgeReviewInput[] = [];
  return {
    providerId: 'minimax',
    model,
    calls,
    async review(input: JudgeReviewInput): Promise<JudgeReviewResult> {
      calls.push(input);
      return makeValidResult(input, model);
    },
  };
}
