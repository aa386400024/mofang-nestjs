// V2026-11-06 治本 (WP44 · 成长档案体系 — 单测):
//   覆盖两件事:
//     ① 写入侧: 对练评分 → 能力雷达 5 个子指标的**映射口径**与**统一聚合**;
//     ② 读取侧: 成长档案总览卡片 + 趋势曲线.
//
//   锁死的口径 (改错就是静默的错, 不会抛异常):
//     · 边界意识**方向翻转** (越界次数 → 100 - 次数);
//     · 倾听准确率 = 督导 activeListening + response 取均值 (快评无来源);
//     · 三来源 (刷题 attempt 信号 / 快评 / 督导) 合并取均值;
//     · 重算幂等: 同样的输入 → 同样的分 (不会"越刷越高");
//     · 没有信号 → 不写这一行 (不用 0 分污染画像);
//     · 没数据 → 返 null 而不是 0 ("一场没练" ≠ "练了 0 分").
//
//   全 mock: 不起 Nest 容器, 不发网络, 不碰数据库.
//
//   验证: npx vitest run test/counselor/wp44-growth-archive.spec.ts
//
//   时间戳: 2026-11-06
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { Repository } from 'typeorm';

import type { SupervisionReportRow } from '../../src/agent/supervisor/supervisor.types.js';
import { SESSION_ABILITY_MAPPING } from '../../src/counselor/config/session-ability-mapping.js';
import { CounselorGrowthController } from '../../src/counselor/controllers/counselor-growth.controller.js';
import { AbilityDimension } from '../../src/counselor/entities/ability-dimension.entity.js';
import { AbilityScore } from '../../src/counselor/entities/ability-score.entity.js';
import { PracticeAttempt } from '../../src/counselor/entities/practice-attempt.entity.js';
import { SessionEvaluation } from '../../src/counselor/entities/session-evaluation.entity.js';
import { TrainingSession } from '../../src/counselor/entities/training-session.entity.js';
import { AbilityAggregateService } from '../../src/counselor/providers/ability-aggregate.service.js';
import { GrowthArchiveService } from '../../src/counselor/providers/growth-archive.service.js';
import { SessionAbilitySyncService } from '../../src/counselor/providers/session-ability-sync.service.js';

const USER_ID = 'user-1';

/**
 * 造一个**本地时区**的日期 (趋势按本地日期分组, 用 UTC 构造会随时区漂).
 *
 * @param year 年
 * @param month 月 (1-12)
 * @param day 日
 * @returns 本地日期
 */
function localDate(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 10, 0, 0);
}

/**
 * 造一份快评行 (只写本单用到的字段).
 *
 * @param overrides 差异项
 * @returns 快评行
 */
function makeEvaluation(overrides: Partial<SessionEvaluation> = {}): SessionEvaluation {
  return {
    sessionId: 'sess-1',
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
    ...overrides,
  } as SessionEvaluation;
}

/**
 * 造一份督导报告行.
 *
 * @param overrides 差异项
 * @returns 报告行
 */
function makeReport(overrides: Partial<SupervisionReportRow> = {}): SupervisionReportRow {
  return {
    sessionId: 'sess-1',
    status: 'completed',
    dimensions: { empathy: 90, activeListening: 70, questioning: 60, boundary: 85, response: 50, professionalism: 75 },
    ...overrides,
  } as SupervisionReportRow;
}

/**
 * 造一个假仓储.
 *
 * @param overrides 差异项
 * @returns 假仓储
 */
function makeRepo(overrides: Record<string, unknown> = {}): Repository<never> {
  return {
    find: async (): Promise<never[]> => [],
    findOne: async (): Promise<null> => null,
    count: async (): Promise<number> => 0,
    create: (row: unknown) => row,
    save: async (): Promise<void> => undefined,
    ...overrides,
  } as unknown as Repository<never>;
}

/**
 * 装一个被测的聚合器 (全 mock).
 *
 * @param overrides 仓储差异项
 * @returns 聚合器 + 写入记录
 */
function buildAggregator(overrides: Record<string, unknown> = {}): {
  readonly aggregate: AbilityAggregateService;
  readonly saved: AbilityScore[];
} {
  const saved: AbilityScore[] = [];
  const aggregate = new AbilityAggregateService(
    makeRepo({
      findOne: async () => ({ id: 'dim-1', subIndicatorCode: 'skill_empathy_precision' }),
    }),
    makeRepo({
      findOne: async () => null,
      create: (row: unknown) => row,
      save: async (row: unknown) => {
        saved.push(row as AbilityScore);
      },
    }),
    makeRepo(overrides['attemptRepo'] ?? {}),
    makeRepo(overrides['evaluationRepo'] ?? {}),
    makeRepo(overrides['sessionRepo'] ?? {}),
    {
      findBySessionIds: async (): Promise<Map<string, SupervisionReportRow>> => new Map(overrides['reports']),
    } as unknown as never,
  );
  return { aggregate, saved };
}

describe('WP44 · 对练信号 → 能力子指标 映射口径', () => {
  it('边界意识方向: 快评的 boundaryCross 已是得分 (越高越好), 不能再翻一次', () => {
    const rule = SESSION_ABILITY_MAPPING.find((item) => item.dimensionCode === 'skill_boundary_awareness');
    expect(rule).toBeDefined();
    const evaluation = makeEvaluation();
    // 0 次越界 → WP43 给 100 分 → 边界意识 100 分.
    const clean = rule?.fromEvaluation({
      technical: { ...evaluation.technicalScores, boundaryCross: 100 },
      ethics: evaluation.ethicsScores,
    });
    expect(clean).toBe(100);
    // 越界到 0 分 (2 次越界) → 边界意识 0 分.
    const crossed = rule?.fromEvaluation({
      technical: { ...evaluation.technicalScores, boundaryCross: 0 },
      ethics: evaluation.ethicsScores,
    });
    expect(crossed).toBe(0);
  });

  it('倾听准确率 = 督导两维均值, 快评无来源', () => {
    const rule = SESSION_ABILITY_MAPPING.find((item) => item.dimensionCode === 'skill_listening_accuracy');
    expect(rule?.fromEvaluation({ technical: makeEvaluation().technicalScores, ethics: makeEvaluation().ethicsScores })).toBeNull();
    expect(rule?.fromReport({ empathy: 90, activeListening: 70, questioning: 60, boundary: 85, response: 50, professionalism: 75 })).toBe(
      60,
    );
  });

  it('其余 4 个子指标: 快评 + 督导各一份来源', () => {
    const evaluation = makeEvaluation();
    const view = { technical: evaluation.technicalScores, ethics: evaluation.ethicsScores };
    const empathy = SESSION_ABILITY_MAPPING.find((item) => item.dimensionCode === 'skill_empathy_precision');
    expect(empathy?.fromEvaluation(view)).toBe(80);
    const questioning = SESSION_ABILITY_MAPPING.find((item) => item.dimensionCode === 'skill_questioning_openness');
    expect(questioning?.fromEvaluation(view)).toBe(60);
    const ethics = SESSION_ABILITY_MAPPING.find((item) => item.dimensionCode === 'knowledge_ethics_mastery');
    expect(ethics?.fromEvaluation(view)).toBe(80);
  });

  it('督导六维缺字段 → 当"没有信号", 不当 0 分', () => {
    const rule = SESSION_ABILITY_MAPPING.find((item) => item.dimensionCode === 'skill_empathy_precision');
    const partial = { empathy: undefined } as unknown as Parameters<NonNullable<typeof rule>['fromReport']>[0];
    expect(rule?.fromReport(partial)).toBeNull();
  });
});

describe('WP44 · 统一聚合器 (刷题 + 快评 + 督导 合并)', () => {
  it('三来源合并取均值 (刷题 100 / 快评 60 / 督导 80 → 80)', async () => {
    const { aggregate, saved } = buildAggregator({
      attemptRepo: {
        find: async () => [{ id: 'attempt-1', abilityDimensionCode: 'skill_empathy_precision', abilitySignal: 100 }],
      },
      evaluationRepo: {
        find: async () => [makeEvaluation()],
      },
      reports: [['sess-1', makeReport()]],
    });
    const outcome = await aggregate.syncDimension(USER_ID, 'skill_empathy_precision');
    // 刷题 100 + 快评 80 (technicalScores.empathy) + 督导 90 → (100+80+90)/3 = 90.
    expect(outcome.synced).toBe(true);
    expect(outcome.score).toBe(90);
    expect(saved).toHaveLength(1);
  });

  it('重算幂等: 同样的输入 → 同样的分 (不会越刷越高)', async () => {
    const { aggregate } = buildAggregator({
      evaluationRepo: { find: async () => [makeEvaluation()] },
    });
    const first = await aggregate.syncDimension(USER_ID, 'skill_empathy_precision');
    const second = await aggregate.syncDimension(USER_ID, 'skill_empathy_precision');
    expect(first.score).toBe(second.score);
    expect(first.score).toBe(80);
  });

  it('没有信号 → 不写这一行 (不用 0 分污染画像)', async () => {
    const { aggregate, saved } = buildAggregator();
    const outcome = await aggregate.syncDimension(USER_ID, 'skill_empathy_precision');
    expect(outcome.synced).toBe(false);
    expect(outcome.score).toBeNull();
    expect(saved).toHaveLength(0);
  });

  it('子指标不存在 → 跳过 (不写)', async () => {
    const { saved } = buildAggregator();
    const missing = new AbilityAggregateService(
      makeRepo({ findOne: async () => null }),
      makeRepo(),
      makeRepo({
        find: async () => [{ id: 'attempt-1', abilityDimensionCode: 'skill_empathy_precision', abilitySignal: 100 }],
      }),
      makeRepo(),
      makeRepo(),
      { findBySessionIds: async () => new Map() } as unknown as never,
    );
    const outcome = await missing.syncDimension(USER_ID, 'skill_empathy_precision');
    expect(outcome.synced).toBe(false);
    expect(saved).toHaveLength(0);
  });

  it('督导 parse_error 的报告不取信号', async () => {
    const { aggregate } = buildAggregator({
      reports: [['sess-1', makeReport({ status: 'parse_error' })]],
    });
    const outcome = await aggregate.syncDimension(USER_ID, 'skill_empathy_precision');
    expect(outcome.synced).toBe(false);
  });
});

describe('WP44 · 对练回写入口', () => {
  it('5 个可喂养子指标逐个同步', async () => {
    const { aggregate } = buildAggregator({
      evaluationRepo: { find: async () => [makeEvaluation()] },
    });
    const sync = new SessionAbilitySyncService(aggregate);
    const result = await sync.syncFromSessions(USER_ID);
    expect(result.outcomes).toHaveLength(5);
    // 快评能喂 4 个 (倾听准确率只有督导来源) → 至少 4 个写回成功.
    expect(result.syncedCount).toBeGreaterThanOrEqual(4);
  });

  it('聚合失败 → 只记 warn, 不抛 (不能搞挂成长档案)', async () => {
    const broken = {
      loadSignals: async () => {
        throw new Error('db down');
      },
    } as unknown as AbilityAggregateService;
    const sync = new SessionAbilitySyncService(broken);
    const result = await sync.syncFromSessions(USER_ID);
    expect(result.syncedCount).toBe(0);
  });
});

describe('WP44 · 成长档案读取侧', () => {
  /**
   * 装一个被测的档案服务.
   *
   * @param evaluations 快评行
   * @param totalSessions 总场次
   * @returns 档案服务 + 同步触发次数
   */
  function buildArchive(
    evaluations: SessionEvaluation[],
    totalSessions: number,
  ): {
    readonly archive: GrowthArchiveService;
    readonly syncCalls: number[];
  } {
    const syncCalls: number[] = [];
    const archive = new GrowthArchiveService(
      // 真库是 order by created_at DESC —— mock 照做, 否则"最近一场"取错行.
      makeRepo({
        find: async () => [...evaluations].toSorted((left, right) => right.createdAt.getTime() - left.createdAt.getTime()),
      }),
      makeRepo({ count: async () => totalSessions }),
      {
        syncFromSessions: async (userId: string) => {
          syncCalls.push(1);
          return { syncedCount: 0, outcomes: [] };
        },
      } as unknown as SessionAbilitySyncService,
    );
    return { archive, syncCalls };
  }

  it('总览: 总场次 / 均分 / 最近 / 最高 / 三大维度 / crisis', async () => {
    const { archive, syncCalls } = buildArchive(
      [
        makeEvaluation({ sessionId: 'sess-1', overallScore: 60, createdAt: localDate(2026, 11, 1) }),
        makeEvaluation({ sessionId: 'sess-2', overallScore: 80, createdAt: localDate(2026, 11, 2) }),
      ],
      42,
    );
    const result = await archive.overview(USER_ID);
    expect(result.totalSessions).toBe(42);
    expect(result.avgOverallScore).toBe(70);
    expect(result.latestScore).toBe(80);
    expect(result.highestScore).toBe(80);
    expect(result.averageByCategory.technical).toBe(64);
    expect(result.averageByCategory.ethics).toBe(80);
    expect(result.crisisCount).toBe(2);
    // 读侧聚合时同步一次能力雷达.
    expect(syncCalls).toHaveLength(1);
  });

  it('一场都没练 → 分数返 null (不是 0 分)', async () => {
    const { archive } = buildArchive([], 0);
    const result = await archive.overview(USER_ID);
    expect(result.totalSessions).toBe(0);
    expect(result.avgOverallScore).toBeNull();
    expect(result.latestScore).toBeNull();
    expect(result.highestScore).toBeNull();
    expect(result.averageByCategory.technical).toBeNull();
    expect(result.crisisCount).toBe(0);
  });

  it('趋势: 按天分组取均值, 按日期升序', async () => {
    const { archive } = buildArchive(
      [
        makeEvaluation({ sessionId: 'sess-1', overallScore: 60, createdAt: localDate(2026, 11, 2) }),
        makeEvaluation({ sessionId: 'sess-2', overallScore: 80, createdAt: localDate(2026, 11, 1) }),
        makeEvaluation({ sessionId: 'sess-3', overallScore: 90, createdAt: localDate(2026, 11, 1) }),
      ],
      3,
    );
    const result = await archive.trend(USER_ID, 30);
    expect(result.points).toHaveLength(2);
    expect(result.points[0]?.date).toBe('2026-11-01');
    // 同一天两场 (80 + 90) → 取平均 85.
    expect(result.points[0]?.overall).toBe(85);
    expect(result.points[1]?.date).toBe('2026-11-02');
    expect(result.points[1]?.overall).toBe(60);
  });

  it('趋势: 没有数据的日期不出点 (不补 0)', async () => {
    const { archive } = buildArchive([makeEvaluation({ createdAt: localDate(2026, 11, 2) })], 1);
    const result = await archive.trend(USER_ID, 30);
    expect(result.points).toHaveLength(1);
  });
});

describe('WP44 · 端点契约 (前端 AI 对接面)', () => {
  /**
   * 取某个 controller 处理器上的路由元数据.
   *
   * @param target controller 类
   * @param methodName 处理器方法名
   * @returns 路径 + HTTP 方法
   */
  function routeOf(target: unknown, methodName: string): { path: string; method: number } {
    const handler = (target as Record<string, unknown>)[methodName];
    const path = Reflect.getMetadata(PATH_METADATA, handler as object) as string;
    const method = Reflect.getMetadata(METHOD_METADATA, handler as object) as number;
    return { path, method };
  }

  it.each([
    ['getArchiveOverview', 'archive-overview'],
    ['getTrend', 'trend'],
    ['getOverview', 'overview'],
  ])('%s → %s', (methodName, expectedPath) => {
    const route = routeOf(CounselorGrowthController.prototype, methodName);
    expect(route.path).toBe(expectedPath);
    expect(route.method).toBe(RequestMethod.GET);
  });
});
