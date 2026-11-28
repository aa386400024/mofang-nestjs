// AF-611 · Judge Shadow 编排: 端口替身 / 危机相邻轮排除 / 失败回落 / 超时 / 全轮排除.

import { describe, expect, it } from 'vitest';

import { makeSession, makeStubPort, makeTurn, makeValidResult } from './judge-test-fixtures.js';
import { buildJudgeInput, runJudgeShadow, selectExcludedTurns } from '../../../src/engine-adapters/judge/judge.shadow.js';
import { JUDGE_MACHINE_PROXY_LABEL } from '../../../src/engine-adapters/judge/judge.types.js';

describe('AF-611 · Judge Shadow', () => {
  it('危机轮与相邻轮不进入外部请求, 只保留本地规则结论与引用', () => {
    const session = makeSession('s-crisis', [
      makeTurn(1),
      makeTurn(2, { riskLevel: 'high', events: ['crisis'], rawText: '我想自杀, 手机 13800138000' }),
      makeTurn(3),
      makeTurn(4, { events: ['open_probe'] }),
    ]);

    const selected = selectExcludedTurns(session.turns);
    expect([...selected.excludedIndexes].sort()).toEqual([0, 1, 2]);
    const noCrisisText = selected.findings.every((finding) => !('rawText' in finding));
    expect(noCrisisText).toBe(true);
    expect(selected.findings.some((finding) => finding.ruleRef === 'local-risk-rule')).toBe(true);
    expect(selected.findings.some((finding) => finding.adjacent)).toBe(true);

    const input = buildJudgeInput(session, { providerId: 'minimax', model: 'MiniMax-M3.1-Flash' });
    expect(input).not.toBeNull();
    expect(input?.l1).toHaveLength(1);
    expect(input?.l1[0]?.turnIndex).toBe(4);
    expect(input?.redactedExcerpts.map((excerpt) => excerpt.turnIndex)).toEqual([4]);
    expect(input?.redactedExcerpts[0]?.text).not.toContain('13800138000');
    expect(input?.excludedTurns).toHaveLength(3);
  });

  it('成功时返回完整评审与机器代理标注', async () => {
    const port = makeStubPort();
    const section = await runJudgeShadow({
      sessions: [makeSession('s-ok', [makeTurn(1), makeTurn(2)])],
      port,
      now: () => new Date('2026-11-29T00:00:00.000Z'),
    });

    expect(section.mode).toBe('shadow');
    expect(section.machineProxy).toBe(true);
    expect(section.disclaimer).toContain(JUDGE_MACHINE_PROXY_LABEL);
    expect(section.attemptedSessions).toBe(1);
    expect(section.reviewedSessions).toBe(1);
    expect(section.failedSessions).toBe(0);
    expect(section.reviews[0]?.lineage.providerId).toBe('minimax');
    expect(section.reviews[0]?.lineage.rubricVersion).toBe('judge-rubric-v1');
    expect(port.calls).toHaveLength(1);
  });

  it('Provider 抛错 → 该场记 null, 批次继续', async () => {
    const port = {
      providerId: 'minimax',
      model: 'MiniMax-M3.1-Flash',
      review: async (): Promise<never> => {
        throw new Error('upstream down');
      },
    };
    const section = await runJudgeShadow({
      sessions: [makeSession('s-a', [makeTurn(1)]), makeSession('s-b', [makeTurn(1)])],
      port,
    });

    expect(section.attemptedSessions).toBe(2);
    expect(section.reviewedSessions).toBe(0);
    expect(section.failedSessions).toBe(2);
    expect(section.failureCodes['provider_error']).toBe(2);
    expect(section.reviews).toEqual([null, null]);
  });

  it('非法评级 (3) → 该场记 null, 原因码 review_invalid', async () => {
    const port = {
      providerId: 'minimax',
      model: 'MiniMax-M3.1-Flash',
      review: async (input: Parameters<typeof makeValidResult>[0]) => {
        const valid = makeValidResult(input);
        const broken = {
          ...valid,
          ratings: valid.ratings.map((rating, index) => (index === 0 ? { ...rating, rating: 3 } : rating)),
        };
        return broken as unknown as typeof valid;
      },
    };
    const section = await runJudgeShadow({ sessions: [makeSession('s-bad', [makeTurn(1)])], port });

    expect(section.reviews).toEqual([null]);
    expect(section.failureCodes['review_invalid']).toBe(1);
  });

  it('超时 → 该场记 null, 原因码 timeout', async () => {
    const port = {
      providerId: 'minimax',
      model: 'MiniMax-M3.1-Flash',
      review: (): Promise<never> => new Promise(() => {}),
    };
    const section = await runJudgeShadow({ sessions: [makeSession('s-timeout', [makeTurn(1)])], port, timeoutMs: 5 });

    expect(section.reviews).toEqual([null]);
    expect(section.failureCodes['timeout']).toBe(1);
  });

  it('全场都是危机轮 → 不调用外部, 记 null 且原因码 crisis_all_turns_excluded', async () => {
    let called = 0;
    const port = {
      providerId: 'minimax',
      model: 'MiniMax-M3.1-Flash',
      review: async (): Promise<never> => {
        called += 1;
        throw new Error('should not be called');
      },
    };
    const section = await runJudgeShadow({
      sessions: [makeSession('s-all-crisis', [makeTurn(1, { riskLevel: 'high', events: ['self_harm'] })])],
      port,
    });

    expect(called).toBe(0);
    expect(section.failureCodes['crisis_all_turns_excluded']).toBe(1);
    expect(section.reviews).toEqual([null]);
  });
});
