// V2026-11-07 治本 (degraded 会话打标 · 单测):
//   覆盖任务单 `docs/worklog/completed/phase2/session-degraded-flag-2026-11-07.md`
//   §八 的 6 条闸门 (⑤ migration / ⑥⑦⑧ 写入侧 / ⑨ 读取侧 / ⑩ 边界) + 判定规则的边界:
//
//     判定 (纯函数, 见 src/counselor/domain/session-degraded.ts):
//       · 失败率 40% → high_failure_rate;
//       · 连续失败 3 轮 → consecutive_failures (规则 2 优先于规则 1);
//       · 正常场次 → 不打标;
//       · 失败率**正好** 30% → 不打标 (严格大于);
//       · 空场次 / 不带 degraded 标记 → 不打标 (向后兼容).
//
//     写入侧 (会话结束一次性判定):
//       · 命中 → 只写 degraded + degraded_reason 两列 (不碰 status / ended_at);
//       · 未命中 → 一行都不写 (degraded 是终态, 不自动恢复);
//       · 会话行不在了 → 记 warn 不抛 (收尾不能被标记搞挂).
//
//     读取侧 (考核 / 统计过滤):
//       · 考核列表 (listMine) 排除 degraded 会话;
//       · 成长档案总览 / 趋势排除 degraded 会话;
//       · 能力雷达排除 degraded 会话的快评信号;
//       · 单场评估 (findBySession) **不过滤** —— 督导能看, 只是不计入考核.
//
//   全 mock: 不起 Nest 容器, 不发网络, 不碰数据库.
//
//   验证: npx vitest run test/counselor/session-degraded.spec.ts
//
//   时间戳: 2026-11-07
import { In, IsNull, Not, type Repository } from 'typeorm';

import { BizException } from '../../src/common/exceptions/biz.exception.js';
import { evaluateSessionDegraded } from '../../src/counselor/domain/session-degraded.js';
import { SessionEvaluation } from '../../src/counselor/entities/session-evaluation.entity.js';
import { TrainingSession } from '../../src/counselor/entities/training-session.entity.js';
import { SessionEvaluationService } from '../../src/counselor/evaluation/session-evaluation.service.js';
import { AbilityAggregateService } from '../../src/counselor/providers/ability-aggregate.service.js';
import { GrowthArchiveService } from '../../src/counselor/providers/growth-archive.service.js';
import { SessionAbilitySyncService } from '../../src/counselor/providers/session-ability-sync.service.js';
import { SessionDegradedService, loadDegradedSessionExclusion } from '../../src/counselor/providers/session-degraded.service.js';
import {
  SessionEvaluationRegistry,
  type SessionEvaluationSessionInput,
  type SessionEvaluationTurnInput,
} from '../../src/voice/session-evaluation-slot.js';

const USER_ID = 'user-1';

/**
 * 造一轮评估输入 (只写本单关心的差异项).
 *
 * @param degraded 本轮是否渲染降级
 * @param turnIndex 轮次号
 * @returns 一轮评估输入
 */
function makeTurn(degraded: boolean, turnIndex = 1): SessionEvaluationTurnInput {
  return {
    turnIndex,
    trust: 0.5,
    safety: 0.5,
    bond: 0.5,
    resistance: 0.5,
    valence: 0,
    arousal: 0.3,
    events: [],
    safetyLevel: 'pass',
    safetyCategories: [],
    degraded,
  };
}

/**
 * 按"每轮是否失败"的布尔序列造一轮数组.
 *
 * @param flags 每轮是否失败
 * @returns 逐轮评估输入
 */
function makeTurns(flags: readonly boolean[]): SessionEvaluationTurnInput[] {
  return flags.map((degraded, index) => makeTurn(degraded, index + 1));
}

/**
 * 造一场会话的评估输入.
 *
 * @param turns 逐轮输入
 * @param overrides 差异项
 * @returns 一场会话的评估输入
 */
function makeSession(
  turns: SessionEvaluationTurnInput[],
  overrides: Partial<SessionEvaluationSessionInput> = {},
): SessionEvaluationSessionInput {
  return {
    sessionId: 'voice-1',
    dbSessionId: 'sess-1',
    userId: USER_ID,
    tenantId: 'tenant-1',
    turns,
    ...overrides,
  };
}

/**
 * 造一个假仓储 (只实现本单用到的方法).
 *
 * @param overrides 差异项
 * @returns 假仓储
 */
function makeRepo<T>(overrides: Record<string, unknown> = {}): Repository<T> {
  const repo = {
    find: async (): Promise<never[]> => [],
    findOne: async (): Promise<null> => null,
    findAndCount: async (): Promise<[never[], number]> => [[], 0],
    count: async (): Promise<number> => 0,
    update: async (): Promise<{ affected: number }> => ({ affected: 1 }),
    ...overrides,
  };
  return repo as unknown as Repository<T>;
}

/**
 * 造一份快评行 (只写本单用到的字段).
 *
 * @param sessionId 会话 id
 * @returns 快评行
 */
function makeEvaluationRow(sessionId: string): SessionEvaluation {
  return {
    sessionId,
    userId: USER_ID,
    overallScore: 70,
    technicalScores: {
      empathy: 80,
      openProbe: 60,
      judgment: 100,
      preaching: 100,
      minimizing: 100,
      boundaryCross: 20,
      normalization: 40,
      acceptance: 50,
      affirmation: 30,
      average: 64,
    },
    bdiDeltaScores: { trust: 60, safety: 55, resistance: 50, valence: 45, average: 53 },
    ethicsScores: { crisisCount: 1, warnCount: 1, blockCount: 0, label: 'warning', score: 80 },
    createdAt: new Date('2026-11-01T10:00:00.000Z'),
  } as SessionEvaluation;
}

describe('degraded · 判定规则 (纯函数)', () => {
  it('闸门 ⑥: 失败率 40% → high_failure_rate', () => {
    // 10 轮里失败 4 轮 (分散失败, 不构成 3 连) = 40%.
    const verdict = evaluateSessionDegraded(makeTurns([true, false, true, false, true, false, true, false, false, false]));
    expect(verdict.degraded).toBe(true);
    expect(verdict.reason).toBe('high_failure_rate');
    expect(verdict.totalTurns).toBe(10);
    expect(verdict.failedTurns).toBe(4);
  });

  it('闸门 ⑦: 连续失败 3 轮 → consecutive_failures', () => {
    const verdict = evaluateSessionDegraded(makeTurns([false, false, false, false, false, true, true, true]));
    expect(verdict.degraded).toBe(true);
    expect(verdict.reason).toBe('consecutive_failures');
    expect(verdict.maxConsecutiveFailures).toBe(3);
  });

  it('闸门 ⑧: 正常会话 → 不打标', () => {
    const verdict = evaluateSessionDegraded(makeTurns([false, false, false]));
    expect(verdict.degraded).toBe(false);
    expect(verdict.reason).toBeNull();
    expect(verdict.failedTurns).toBe(0);
  });

  it('闸门 ⑩: 失败率正好 30% → 不打标 (严格大于)', () => {
    const verdict = evaluateSessionDegraded(makeTurns([true, false, true, false, true, false, false, false, false, false]));
    expect(verdict.failedTurns).toBe(3);
    expect(verdict.totalTurns).toBe(10);
    expect(verdict.degraded).toBe(false);
    expect(verdict.reason).toBeNull();
  });

  it('规则 2 优先于规则 1 (两条同时命中时取更特异的连续失败)', () => {
    // 5 轮正常 + 3 轮连续失败 = 8 轮里 3 轮失败 = 37.5% (> 30%) → 两条都命中.
    const verdict = evaluateSessionDegraded(makeTurns([false, false, false, false, false, true, true, true]));
    expect(verdict.failureRate).toBeCloseTo(0.375, 6);
    expect(verdict.reason).toBe('consecutive_failures');
  });

  it('连续失败 2 轮 + 失败率正好 30% → 两条规则都不命中 → 不打标', () => {
    // 10 轮里失败 3 轮 (= 30%, 不严格大于阈值), 且最多只连着失败 2 轮.
    const verdict = evaluateSessionDegraded(makeTurns([true, false, true, true, false, false, false, false, false, false]));
    expect(verdict.failedTurns).toBe(3);
    expect(verdict.maxConsecutiveFailures).toBe(2);
    expect(verdict.degraded).toBe(false);
    expect(verdict.reason).toBeNull();
  });

  it('空场次 → 不打标 (没有事实就不给结论)', () => {
    const verdict = evaluateSessionDegraded([]);
    expect(verdict.degraded).toBe(false);
    expect(verdict.reason).toBeNull();
    expect(verdict.totalTurns).toBe(0);
    expect(verdict.failureRate).toBe(0);
  });

  it('不带 degraded 标记的轮次 → 视为未降级 (插槽字段是可选的, 向后兼容)', () => {
    const verdict = evaluateSessionDegraded([{ degraded: undefined }, { degraded: undefined }]);
    expect(verdict.degraded).toBe(false);
    expect(verdict.failedTurns).toBe(0);
  });
});

describe('degraded · 写入侧 (会话结束一次性判定)', () => {
  it('闸门 ⑥: 失败率 40% 的会话 → degraded=1 + reason=high_failure_rate', async () => {
    const updates: { criteria: unknown; row: unknown }[] = [];
    const service = new SessionDegradedService(
      makeRepo<TrainingSession>({
        update: async (criteria: unknown, row: unknown) => {
          updates.push({ criteria, row });
          return { affected: 1 };
        },
      }),
      new SessionEvaluationRegistry(),
    );
    await service.finalize(makeSession(makeTurns([true, false, true, false, true, false, true, false, false, false])));
    expect(updates).toHaveLength(1);
    expect(updates[0]?.row).toEqual({ degraded: 1, degradedReason: 'high_failure_rate' });
    expect(updates[0]?.criteria).toEqual({ id: 'sess-1' });
  });

  it('闸门 ⑦: 连续失败 3 轮的会话 → degraded=1 + reason=consecutive_failures', async () => {
    const updates: unknown[] = [];
    const service = new SessionDegradedService(
      makeRepo<TrainingSession>({
        update: async (_criteria: unknown, row: unknown) => {
          updates.push(row);
          return { affected: 1 };
        },
      }),
      new SessionEvaluationRegistry(),
    );
    await service.finalize(makeSession(makeTurns([false, false, false, false, false, true, true, true])));
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({ degraded: 1, degradedReason: 'consecutive_failures' });
  });

  it('闸门 ⑧: 正常会话 → 一行都不写 (degraded 保持 0, reason 保持 null)', async () => {
    const updates: unknown[] = [];
    const service = new SessionDegradedService(
      makeRepo<TrainingSession>({
        update: async (_criteria: unknown, row: unknown) => {
          updates.push(row);
          return { affected: 1 };
        },
      }),
      new SessionEvaluationRegistry(),
    );
    await service.finalize(makeSession(makeTurns([false, false, false])));
    expect(updates).toHaveLength(0);
  });

  it('闸门 ⑩: 失败率正好 30% → 一行都不写', async () => {
    const updates: unknown[] = [];
    const service = new SessionDegradedService(
      makeRepo<TrainingSession>({
        update: async (_criteria: unknown, row: unknown) => {
          updates.push(row);
          return { affected: 1 };
        },
      }),
      new SessionEvaluationRegistry(),
    );
    await service.finalize(makeSession(makeTurns([true, false, true, false, true, false, false, false, false, false])));
    expect(updates).toHaveLength(0);
  });

  it('一轮都没跑 / 没有业务会话 id → 一行都不写', async () => {
    const updates: unknown[] = [];
    const service = new SessionDegradedService(
      makeRepo<TrainingSession>({
        update: async (_criteria: unknown, row: unknown) => {
          updates.push(row);
          return { affected: 1 };
        },
      }),
      new SessionEvaluationRegistry(),
    );
    await service.finalize(makeSession([]));
    await service.finalize(makeSession(makeTurns([true, true, true]), { dbSessionId: '' }));
    expect(updates).toHaveLength(0);
  });

  it('会话行不在了 → 不抛 (收尾不能被标记搞挂)', async () => {
    const service = new SessionDegradedService(
      makeRepo<TrainingSession>({ update: async () => ({ affected: 0 }) }),
      new SessionEvaluationRegistry(),
    );
    await expect(service.finalize(makeSession(makeTurns([true, true, true])))).resolves.toBeUndefined();
  });

  it('注册到 voice 层插槽 → 由插槽统一交办 (业务侧提供实现, 引擎侧只认插槽)', async () => {
    const registry = new SessionEvaluationRegistry();
    const updates: unknown[] = [];
    const service = new SessionDegradedService(
      makeRepo<TrainingSession>({
        update: async (_criteria: unknown, row: unknown) => {
          updates.push(row);
          return { affected: 1 };
        },
      }),
      registry,
    );
    service.onModuleInit();
    await registry.finalize(makeSession(makeTurns([true, true, true])));
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({ degraded: 1, degradedReason: 'consecutive_failures' });
  });
});

describe('degraded · 读取侧 (考核 / 统计过滤)', () => {
  it('排除算子: 没有 degraded 会话 → 返回 null (调用方据此不加过滤, 避免 IN ())', async () => {
    const exclusion = await loadDegradedSessionExclusion(makeRepo<TrainingSession>(), USER_ID);
    expect(exclusion).toBeNull();
  });

  it('排除算子: 有 degraded 会话 → 返回 NOT IN 算子', async () => {
    const exclusion = await loadDegradedSessionExclusion(makeRepo<TrainingSession>({ find: async () => [{ id: 'sess-bad' }] }), USER_ID);
    expect(exclusion).toEqual(Not(In(['sess-bad'])));
  });

  it('闸门 ⑨: 考核列表排除 degraded 会话', async () => {
    const wheres: Record<string, unknown>[] = [];
    const service = new SessionEvaluationService(
      makeRepo<SessionEvaluation>({
        findAndCount: async (options: { where: Record<string, unknown> }) => {
          wheres.push(options.where);
          return [[], 0];
        },
      }),
      new SessionEvaluationRegistry(),
      makeRepo<TrainingSession>({ find: async () => [{ id: 'sess-bad' }] }),
    );
    await service.listMine(USER_ID, { page: 1, pageSize: 20 });
    expect(wheres).toHaveLength(1);
    expect(wheres[0]).toEqual({ userId: USER_ID, sessionId: Not(In(['sess-bad'])) });
  });

  it('没有 degraded 会话 → 考核列表不加过滤条件', async () => {
    const wheres: Record<string, unknown>[] = [];
    const service = new SessionEvaluationService(
      makeRepo<SessionEvaluation>({
        findAndCount: async (options: { where: Record<string, unknown> }) => {
          wheres.push(options.where);
          return [[], 0];
        },
      }),
      new SessionEvaluationRegistry(),
      makeRepo<TrainingSession>(),
    );
    await service.listMine(USER_ID, { page: 1, pageSize: 20 });
    expect(wheres[0]).toEqual({ userId: USER_ID });
  });

  it('单场评估不过滤 (督导能看, 只是不计入考核)', async () => {
    const wheres: Record<string, unknown>[] = [];
    const service = new SessionEvaluationService(
      makeRepo<SessionEvaluation>({
        findOne: async (options: { where: Record<string, unknown> }) => {
          wheres.push(options.where);
          return null;
        },
      }),
      new SessionEvaluationRegistry(),
      makeRepo<TrainingSession>({ find: async () => [{ id: 'sess-bad' }] }),
    );
    await expect(service.findBySession(USER_ID, 'sess-bad')).rejects.toBeInstanceOf(BizException);
    expect(wheres[0]).toEqual({ sessionId: 'sess-bad', userId: USER_ID });
  });

  it('成长档案总览排除 degraded 会话 (快评 + 场次)', async () => {
    const evaluationWheres: Record<string, unknown>[] = [];
    const countWheres: Record<string, unknown>[] = [];
    const archive = new GrowthArchiveService(
      makeRepo<SessionEvaluation>({
        find: async (options: { where: Record<string, unknown> }) => {
          evaluationWheres.push(options.where);
          return [];
        },
      }),
      makeRepo<TrainingSession>({
        find: async () => [{ id: 'sess-bad' }],
        count: async (options: { where: Record<string, unknown> }) => {
          countWheres.push(options.where);
          return 3;
        },
      }),
      { syncFromSessions: async () => ({ syncedCount: 0, outcomes: [] }) } as unknown as SessionAbilitySyncService,
    );
    await archive.overview(USER_ID);
    expect(evaluationWheres[0]).toEqual({ userId: USER_ID, sessionId: Not(In(['sess-bad'])) });
    expect(countWheres[0]).toEqual({ userId: USER_ID, degraded: 0, deletedAt: IsNull() });
  });

  it('成长档案趋势排除 degraded 会话', async () => {
    const evaluationWheres: Record<string, unknown>[] = [];
    const archive = new GrowthArchiveService(
      makeRepo<SessionEvaluation>({
        find: async (options: { where: Record<string, unknown> }) => {
          evaluationWheres.push(options.where);
          return [];
        },
      }),
      makeRepo<TrainingSession>({ find: async () => [{ id: 'sess-bad' }] }),
      { syncFromSessions: async () => ({ syncedCount: 0, outcomes: [] }) } as unknown as SessionAbilitySyncService,
    );
    await archive.trend(USER_ID, 30);
    expect(evaluationWheres[0]?.['sessionId']).toEqual(Not(In(['sess-bad'])));
  });

  it('能力雷达排除 degraded 会话的快评信号', async () => {
    const aggregate = new AbilityAggregateService(
      makeRepo(),
      makeRepo(),
      makeRepo(),
      makeRepo<SessionEvaluation>({ find: async () => [makeEvaluationRow('sess-bad'), makeEvaluationRow('sess-good')] }),
      makeRepo<TrainingSession>({
        find: async () => [
          { id: 'sess-bad', tenantId: 'tenant-1', degraded: 1 },
          { id: 'sess-good', tenantId: 'tenant-1', degraded: 0 },
        ],
      }),
      { findBySessionIds: async () => new Map() } as unknown as never,
    );
    const bundle = await aggregate.loadSignals(USER_ID);
    const sourceIds = bundle.sourceIdsByDimension.get('skill_empathy_precision') ?? [];
    expect(sourceIds).toContain('sess-good');
    expect(sourceIds).not.toContain('sess-bad');
  });
});
