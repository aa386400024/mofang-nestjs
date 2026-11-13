// V2026-11-09 治本 (Phase2.5 WP-F · 成本看板合并两个数据源 · 单测):
//   覆盖任务单 §七 的验收:
//     ① 趋势合并: 总量 + 分来源字段 (sessionsFormal / costAutoPractice / ...)
//     ② 会话计数规则: 成本照算 (failed 也算钱), sessions 只算跑成的场次
//     ③ limit 语义: 每源先取 N, 合并后最多 2N 行
//     ④ 学员隔离: 学员请求**完全不含**自动对练源 (连查询都不发)
//     ⑤ 历史场次 (没有成本记录) → 口径 `estimated`, 成本 0
//   全 mock: 不起 Nest 容器, 不连 DB, 不发网络.
//
//   验证: npx vitest run test/admin-debug/wp-f-cost-board-merge.spec.ts
//   时间戳: 2026-11-09 GMT+8

import { FindOperator } from 'typeorm';
import { vi } from 'vitest';

import { AdminDebugController } from '../../src/admin-debug/admin-debug.controller.js';
import { AutoPracticeCostSource } from '../../src/admin-debug/cost-source.auto-practice.js';
import { FormalCostSource } from '../../src/admin-debug/cost-source.formal.js';
import { buildMergedCostTrend, buildMergedSessionList, type CostSourceSession } from '../../src/admin-debug/cost-view.js';
import type { TurnTrace } from '../../src/admin-debug/trace-recorder.service.js';
import { DEFAULT_SESSION_COST_PRICING } from '../../src/engine-adapters/observability/session-cost.js';

// TD-10 · T-2: 真实 ioredis 不进 import 阶段 (适配层仍是真实现; 替身口径见 test/helpers/sdk-stubs.ts).
vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../helpers/sdk-stubs.js');
  return createIoredisStub();
});

/** 冻结的"现在": 2026-11-09 12:00Z = 上海 2026-11-09 20:00. */
const NOW = new Date('2026-11-09T12:00:00.000Z');

/** 假配置服务 (只回 env 字典). */
function stubConfig(env: Record<string, string>): { get<T>(key: string): T | undefined } {
  return {
    get<T>(key: string): T | undefined {
      return env[key] as T | undefined;
    },
  };
}

/** 假 Redis (既有端点才碰; 成本端点不用). */
function stubRedis(): { hgetall(): Promise<Record<string, string>> } {
  return {
    async hgetall(): Promise<Record<string, string>> {
      return {};
    },
  };
}

/**
 * where 条件匹配 (等值 + IsNull + MoreThanOrEqual).
 */
function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, expected]) => {
    if (expected instanceof FindOperator) {
      if (expected.type === 'isNull') return row[key] === null || row[key] === undefined;
      if (expected.type === 'moreThanOrEqual') {
        const actual = row[key];
        if (!(actual instanceof Date)) return false;
        return actual.getTime() >= (expected.value as Date).getTime();
      }
      return true;
    }
    if (expected === null || expected === undefined) return true;
    return row[key] === expected;
  });
}

/**
 * 假仓储 (查列表; 按 startedAt 倒序并遵守 take).
 */
class FakeRepo {
  readonly rows: Record<string, unknown>[] = [];
  readonly findCalls: { readonly where?: Record<string, unknown>; readonly take?: number }[] = [];

  async find(options: { readonly where?: Record<string, unknown>; readonly take?: number }): Promise<Record<string, unknown>[]> {
    this.findCalls.push(options);
    const matched = this.rows.filter((row) => matchesWhere(row, options.where));
    const sorted = [...matched].sort((a, b) => {
      const left = a['startedAt'] instanceof Date ? a['startedAt'].getTime() : 0;
      const right = b['startedAt'] instanceof Date ? b['startedAt'].getTime() : 0;
      return right - left;
    });
    return options.take === undefined ? sorted : sorted.slice(0, options.take);
  }
}

/**
 * 造一份逐轮留痕快照 (只给成本相关的字段).
 */
function buildTrace(llmUsage: { promptTokens: number; completionTokens: number }): TurnTrace {
  return {
    turnIndex: 0,
    characterSlug: 'vpt_x',
    bdiSnapshot: { trust: 0.3, valence: 0, arousal: 0, resistance: 0, anxiousSecure: 'neutral' },
    renderSpec: { taskKind: 'reply', promptPreview: '', maxCompletionTokens: 512, reasoningEffort: 'medium' },
    llmUsage: {
      promptTokens: llmUsage.promptTokens,
      completionTokens: llmUsage.completionTokens,
      reasoningTokens: 0,
      ttftMs: 100,
      finishReason: 'stop',
    },
    crisis: { detected: false, category: null },
    ts: NOW.toISOString(),
  };
}

/** 造一行正式训练会话 (默认带留痕). */
function buildFormalSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'f-1',
    personaName: '晚晴',
    startedAt: new Date('2026-11-09T02:00:00.000Z'),
    status: 'completed',
    turnDebugTrace: [buildTrace({ promptTokens: 1000, completionTokens: 500 })],
    ...overrides,
  };
}

/**
 * 造一行自动对练场次.
 *
 * ⚠️ `totalCostCny` 用**字符串**模拟 DECIMAL 列的真实返回 (mysql2 驱动取 DECIMAL 给字符串).
 */
function buildPracticeSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ap-1',
    characterSlug: 'vpt_test',
    counselorModeId: 'expert',
    batchId: null,
    status: 'completed',
    startedAt: new Date('2026-11-09T03:00:00.000Z'),
    promptTokens: 2000,
    completionTokens: 1000,
    reasoningTokens: 0,
    totalTokens: 3000,
    totalCostCny: '0.0075',
    costBasis: 'full',
    ...overrides,
  };
}

/** 装一个 controller (两个来源都注入). */
function buildController(): {
  readonly controller: AdminDebugController;
  readonly sessionRepo: FakeRepo;
  readonly practiceRepo: FakeRepo;
} {
  const sessionRepo = new FakeRepo();
  const practiceRepo = new FakeRepo();
  const characterRepo = { find: async () => [], findOne: async () => null };
  const controller = new AdminDebugController(
    sessionRepo as never,
    characterRepo as never,
    stubConfig({}) as never,
    stubRedis() as never,
    new FormalCostSource(sessionRepo as never),
    new AutoPracticeCostSource(practiceRepo as never),
  );
  return { controller, sessionRepo, practiceRepo };
}

describe('WP-F · 成本看板合并两个数据源', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('① 趋势合并 — 总量 + 分来源字段', () => {
    it('两个源的总量与分来源字段都对得上', async () => {
      const { controller, sessionRepo, practiceRepo } = buildController();
      sessionRepo.rows.push(buildFormalSession());
      practiceRepo.rows.push(buildPracticeSession());

      const trend = await controller.costTrend({ adminBasicAuth: true } as never, '1');

      expect(trend).toHaveLength(1);
      const day = trend[0];
      expect(day?.sessions).toBe(2);
      expect(day?.sessionsFormal).toBe(1);
      expect(day?.sessionsAutoPractice).toBe(1);
      expect(day?.tokens).toBe(1500 + 3000);
      expect(day?.tokensFormal).toBe(1500);
      expect(day?.tokensAutoPractice).toBe(3000);
      // 正式训练成本 = 1000 token 输入 (1 个千) + 500 token 输出 (半个千), 按默认单价.
      const formalCost = DEFAULT_SESSION_COST_PRICING.inputPer1k * 1 + DEFAULT_SESSION_COST_PRICING.outputPer1k * 0.5;
      expect(day?.costFormal).toBeCloseTo(formalCost, 6);
      expect(day?.costAutoPractice).toBeCloseTo(0.0075, 6);
      expect(day?.costCny).toBeCloseTo(formalCost + 0.0075, 6);
    });

    it('failed / canceled 的场次: 成本照算, 但不计 session', async () => {
      const { controller, practiceRepo } = buildController();
      practiceRepo.rows.push(
        buildPracticeSession({ id: 'ap-failed', status: 'failed', totalCostCny: '0.0042' }),
        buildPracticeSession({ id: 'ap-canceled', status: 'canceled', totalCostCny: '0.0010' }),
      );

      const trend = await controller.costTrend({ adminBasicAuth: true } as never, '1');

      expect(trend[0]?.sessions).toBe(0);
      expect(trend[0]?.sessionsAutoPractice).toBe(0);
      // 钱还是照算 —— 花了就是花了.
      expect(trend[0]?.costAutoPractice).toBeCloseTo(0.0052, 6);
      expect(trend[0]?.costCny).toBeCloseTo(0.0052, 6);
    });

    it('没有成本记录的历史场次 → 口径 estimated, 成本 0 (不假装免费)', async () => {
      const { controller, practiceRepo } = buildController();
      practiceRepo.rows.push(buildPracticeSession({ id: 'ap-old', totalCostCny: null, costBasis: null, totalTokens: 0 }));

      const trend = await controller.costTrend({ adminBasicAuth: true } as never, '1');
      expect(trend[0]?.costAutoPractice).toBe(0);

      const rows = await controller.sessionCosts({ adminBasicAuth: true } as never, '20');
      expect(rows[0]?.costBasis).toBe('estimated');
    });
  });

  describe('② 会话列表 — 合并 + 排序 + 来源', () => {
    it('两源混合, 按 startedAt 倒序, 每行带 source', async () => {
      const { controller, sessionRepo, practiceRepo } = buildController();
      sessionRepo.rows.push(buildFormalSession({ id: 'f-1', startedAt: new Date('2026-11-09T02:00:00.000Z') }));
      practiceRepo.rows.push(buildPracticeSession({ id: 'ap-1', startedAt: new Date('2026-11-09T03:00:00.000Z') }));

      const rows = await controller.sessionCosts({ adminBasicAuth: true } as never, '20');

      expect(rows).toHaveLength(2);
      expect(rows[0]?.sessionId).toBe('ap-1');
      expect(rows[0]?.source).toBe('auto_practice');
      expect(rows[0]?.visitorAlias).toBe('vpt_test');
      expect(rows[0]?.status).toBe('completed');
      expect(rows[0]?.totalTokens).toBe(3000);
      expect(rows[1]?.sessionId).toBe('f-1');
      expect(rows[1]?.source).toBe('formal');
      expect(rows[1]?.visitorAlias).toBe('晚晴');
    });

    it('limit 语义: 每源各取 N, 合并后最多 2N 行 (不在合并后二次截断)', async () => {
      const { controller, sessionRepo, practiceRepo } = buildController();
      for (let i = 0; i < 5; i += 1) {
        sessionRepo.rows.push(buildFormalSession({ id: `f-${i}`, startedAt: new Date(`2026-11-09T0${i}:00:00.000Z`) }));
        practiceRepo.rows.push(buildPracticeSession({ id: `ap-${i}`, startedAt: new Date(`2026-11-09T0${i}:30:00.000Z`) }));
      }

      const rows = await controller.sessionCosts({ adminBasicAuth: true } as never, '2');

      expect(rows).toHaveLength(4);
      expect(sessionRepo.findCalls.at(-1)?.take).toBe(2);
      expect(practiceRepo.findCalls.at(-1)?.take).toBe(2);
    });
  });

  describe('③ 学员隔离 — 学员请求完全不含自动对练源', () => {
    it('学员请求: 连自动对练表都不查 (不越权, 也不白查)', async () => {
      const { controller, sessionRepo, practiceRepo } = buildController();
      sessionRepo.rows.push(buildFormalSession({ userId: 'student-a' }));
      practiceRepo.rows.push(buildPracticeSession());

      const trend = await controller.costTrend({ user: { userId: 'student-a' } } as never, '1');

      expect(trend[0]?.sessionsAutoPractice).toBe(0);
      expect(trend[0]?.costAutoPractice).toBe(0);
      expect(practiceRepo.findCalls).toHaveLength(0);
      // 正式训练那边照旧按归属过滤.
      expect(sessionRepo.findCalls.at(-1)?.where?.['userId']).toBe('student-a');
    });
  });

  describe('④ 纯函数层 — 合并口径只有一份实现', () => {
    it('空天补 0 (行数恒等于 days)', () => {
      const trend = buildMergedCostTrend([], 3, NOW);

      expect(trend).toHaveLength(3);
      expect(trend.map((point) => point.date)).toEqual(['2026-11-07', '2026-11-08', '2026-11-09']);
      expect(trend.every((point) => point.sessions === 0 && point.tokens === 0 && point.costCny === 0)).toBe(true);
    });

    it('列表: 没有开场时刻的排最后 (放最前会让人以为是最新的一场)', () => {
      const rows: CostSourceSession[] = [
        {
          source: 'formal',
          sessionId: 'a',
          visitorAlias: 'x',
          startedAt: null,
          totalTokens: 0,
          costCny: 0,
          costBasis: 'estimated',
          countsAsSession: true,
        },
        {
          source: 'formal',
          sessionId: 'b',
          visitorAlias: 'y',
          startedAt: new Date('2026-11-01T00:00:00.000Z'),
          totalTokens: 0,
          costCny: 0,
          costBasis: 'estimated',
          countsAsSession: true,
        },
      ];

      const list = buildMergedSessionList(rows);

      expect(list.map((row) => row.sessionId)).toEqual(['b', 'a']);
    });
  });
});
