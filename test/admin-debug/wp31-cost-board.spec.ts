// V2026-11-05 治本 (WP31 · 成本看板切真 API · 单测):
//   覆盖任务单 §五 的验收:
//     ① GET /admin/api/cost/trend?days=N     → 按天聚合 (tokens / costCny / sessions)
//     ② GET /admin/api/cost/sessions?limit=N → 会话成本列表 (含成本口径 costBasis)
//     ③ 成本单价走 env (LLM_PRICE_*), 有默认值
//     ④ 4 个新端点全部继承 class 级 AdminRoleGuard
//     ⑤ 留痕关着时的行为 (sessions 有数 / tokens 为 0) 与 Asia/Shanghai 分桶
//
//   全 mock: 不起 Nest 容器, 不连 DB, 不发网络.
//     · 定价与折算**走仓库真模块** (`resolveSessionCostPricing` / `estimateSessionCost`)
//       —— 不用桩数据冒充, 免得"测试通过但线上口径不对".
//     · "今天"用 vitest fake timers 冻结 (`vi.setSystemTime`) —— 按天分桶的断言
//       必须有确定的"今天", 否则跨天跑就会飘.
//
//   验证: npx vitest run test/admin-debug/wp31-cost-board.spec.ts
//   时间戳: 2026-11-05 GMT+8
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { FindOperator } from 'typeorm';

import { AdminDebugController } from '../../src/admin-debug/admin-debug.controller.js';
import { aggregateSessionCost, buildCostTrend, shanghaiDateKey, shanghaiDayStartUtc } from '../../src/admin-debug/cost-view.js';
import { AdminRoleGuard } from '../../src/admin-debug/guards/admin-role.guard.js';
import type { TurnTrace } from '../../src/admin-debug/trace-recorder.service.js';
import { DEFAULT_SESSION_COST_PRICING } from '../../src/engine-adapters/observability/session-cost.js';

/** 冻结的"现在": 2026-11-05 12:00Z = 上海 2026-11-05 20:00. */
const NOW = new Date('2026-11-05T12:00:00.000Z');

/**
 * 假配置服务 (只回 env 字典).
 */
function stubConfig(env: Record<string, string>): { get<T>(key: string): T | undefined } {
  return {
    get<T>(key: string): T | undefined {
      return env[key] as T | undefined;
    },
  };
}

/**
 * where 条件匹配 (等值 + IsNull + MoreThanOrEqual).
 *
 * 为什么支持 `MoreThanOrEqual`: 成本趋势的窗口过滤就写的是它 ——
 * stub 若不认这个算子, "窗口外的会话被排除" 的用例会假失败.
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
 * 假会话仓储 (查列表; 按 startedAt 倒序并遵守 take).
 */
class FakeSessionRepo {
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

  async findOne(options: { readonly where?: Record<string, unknown> }): Promise<Record<string, unknown> | null> {
    this.findCalls.push(options);
    return this.rows.find((row) => matchesWhere(row, options.where)) ?? null;
  }
}

/**
 * 造一份逐轮留痕快照 (只给成本相关的字段).
 */
function buildTrace(llmUsage: { promptTokens: number; completionTokens: number; reasoningTokens?: number }): TurnTrace {
  return {
    turnIndex: 0,
    characterSlug: 'vpt_x',
    bdiSnapshot: { trust: 0.3, valence: 0, arousal: 0, resistance: 0, anxiousSecure: 'neutral' },
    renderSpec: { taskKind: 'reply', promptPreview: '', maxCompletionTokens: 512, reasoningEffort: 'medium' },
    llmUsage: {
      promptTokens: llmUsage.promptTokens,
      completionTokens: llmUsage.completionTokens,
      reasoningTokens: llmUsage.reasoningTokens ?? 0,
      ttftMs: 100,
      finishReason: 'stop',
    },
    crisis: { detected: false, category: null },
    ts: NOW.toISOString(),
  };
}

/**
 * 装一个 controller (会话仓储 + 角色仓储 + 配置).
 */
function buildController(env: Record<string, string> = {}): {
  readonly controller: AdminDebugController;
  readonly sessionRepo: FakeSessionRepo;
} {
  const sessionRepo = new FakeSessionRepo();
  const characterRepo = { find: async () => [], findOne: async () => null };
  const controller = new AdminDebugController(sessionRepo as never, characterRepo as never, stubConfig(env) as never);
  return { controller, sessionRepo };
}

/**
 * 造一行会话 (默认带留痕).
 */
function buildSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 's-1',
    personaName: '晚晴',
    startedAt: new Date('2026-11-05T02:00:00.000Z'),
    endedAt: new Date('2026-11-05T02:30:00.000Z'),
    status: 'completed',
    turnDebugTrace: [buildTrace({ promptTokens: 1000, completionTokens: 500 })],
    ...overrides,
  };
}

describe('WP31 · 成本看板切真 API', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('① GET /admin/api/cost/trend — 按天聚合', () => {
    it('按 Asia/Shanghai 分桶, 补齐没有数据的天 (行数恒等于 days)', async () => {
      const { controller, sessionRepo } = buildController();
      sessionRepo.rows.push(
        // 上海 2026-11-05 10:00 (UTC 02:00)
        buildSession({
          id: 's-a',
          startedAt: new Date('2026-11-05T02:00:00.000Z'),
          turnDebugTrace: [
            buildTrace({ promptTokens: 1000, completionTokens: 500 }),
            buildTrace({ promptTokens: 2000, completionTokens: 1000 }),
          ],
        }),
        // 上海 2026-11-04 10:00
        buildSession({
          id: 's-b',
          startedAt: new Date('2026-11-04T02:00:00.000Z'),
          turnDebugTrace: [buildTrace({ promptTokens: 0, completionTokens: 800 })],
        }),
        // 上海 2026-11-03 04:00 (UTC 2026-11-02T20:00) —— 跨 UTC 日界, 分桶必须落 11-03
        buildSession({
          id: 's-c',
          startedAt: new Date('2026-11-02T20:00:00.000Z'),
          turnDebugTrace: [buildTrace({ promptTokens: 400, completionTokens: 200 })],
        }),
        // 留痕关着的会话: 没有 trace → 有场次, 0 token
        buildSession({ id: 's-d', startedAt: new Date('2026-11-05T03:00:00.000Z'), turnDebugTrace: null }),
        // 窗口外 (上海 11-02) → 不该出现
        buildSession({ id: 's-out', startedAt: new Date('2026-11-01T10:00:00.000Z') }),
      );

      const trend = await controller.costTrend({ adminBasicAuth: true } as never, '3');

      expect(trend).toHaveLength(3);
      expect(trend.map((p) => p.date)).toEqual(['2026-11-03', '2026-11-04', '2026-11-05']);

      const day3 = trend[0];
      expect(day3.sessions).toBe(1);
      expect(day3.tokens).toBe(600);
      expect(day3.costCny).toBeCloseTo(0.0015, 6);

      const day4 = trend[1];
      expect(day4.sessions).toBe(1);
      expect(day4.tokens).toBe(800);

      const day5 = trend[2];
      expect(day5.sessions).toBe(2); // s-a + 留痕关着的 s-d
      expect(day5.tokens).toBe(4500);
      expect(day5.costCny).toBeCloseTo(0.01125, 6);
    });

    it('留痕关着时: sessions 仍准确, tokens / costCny 恒 0 (不是"没有会话")', async () => {
      const { controller, sessionRepo } = buildController();
      sessionRepo.rows.push(buildSession({ id: 's-a', turnDebugTrace: null }));

      const trend = await controller.costTrend({ adminBasicAuth: true } as never, '1');

      expect(trend).toHaveLength(1);
      expect(trend[0]?.sessions).toBe(1);
      expect(trend[0]?.tokens).toBe(0);
      expect(trend[0]?.costCny).toBe(0);
    });

    it('缺省 days = 7; 非法 days 回退缺省 (不把 NaN 传下去)', async () => {
      const { controller, sessionRepo } = buildController();
      sessionRepo.rows.push(buildSession());

      const byDefault = await controller.costTrend({ adminBasicAuth: true } as never);
      expect(byDefault).toHaveLength(7);

      const byGarbage = await controller.costTrend({ adminBasicAuth: true } as never, 'abc');
      expect(byGarbage).toHaveLength(7);

      const byZero = await controller.costTrend({ adminBasicAuth: true } as never, '0');
      expect(byZero).toHaveLength(1);

      const byHuge = await controller.costTrend({ adminBasicAuth: true } as never, '9999');
      expect(byHuge).toHaveLength(90);
    });

    it('学员只看自己的会话 (ownerFilter 生效)', async () => {
      const { controller, sessionRepo } = buildController();
      sessionRepo.rows.push(buildSession({ id: 's-a', userId: 'student-b' }));

      const trend = await controller.costTrend({ user: { userId: 'student-a' } } as never, '1');

      expect(trend[0]?.sessions).toBe(0);
      expect(sessionRepo.findCalls.at(-1)?.where?.['userId']).toBe('student-a');
    });
  });

  describe('② GET /admin/api/cost/sessions — 会话成本列表', () => {
    it('返回每场的 token / 成本 / 口径', async () => {
      const { controller, sessionRepo } = buildController();
      sessionRepo.rows.push(
        buildSession({
          id: 's-a',
          startedAt: new Date('2026-11-05T02:00:00.000Z'),
          turnDebugTrace: [buildTrace({ promptTokens: 1000, completionTokens: 500 })],
        }),
        buildSession({
          id: 's-b',
          startedAt: new Date('2026-11-04T02:00:00.000Z'),
          turnDebugTrace: [buildTrace({ promptTokens: 0, completionTokens: 800 })],
        }),
      );

      const rows = await controller.sessionCosts({ adminBasicAuth: true } as never, '20');

      expect(rows).toHaveLength(2);
      expect(rows[0]?.sessionId).toBe('s-a');
      expect(rows[0]?.visitorAlias).toBe('晚晴');
      expect(rows[0]?.totalTokens).toBe(1500);
      expect(rows[0]?.costCny).toBeCloseTo(0.00375, 6);
      // 输入侧可得 → full
      expect(rows[0]?.costBasis).toBe('full');

      expect(rows[1]?.sessionId).toBe('s-b');
      expect(rows[1]?.totalTokens).toBe(800);
      // 上游没报输入侧 → 只算输出侧, 口径如实落成 output_only (下界)
      expect(rows[1]?.costBasis).toBe('output_only');
      expect(rows[1]?.costCny).toBeCloseTo(0.0036, 6);
    });

    it('缺省 limit = 20; 非法 limit 回退缺省; 超上限被夹住', async () => {
      const { controller, sessionRepo } = buildController();
      for (let i = 0; i < 30; i += 1) {
        sessionRepo.rows.push(buildSession({ id: `s-${i}` }));
      }

      const byDefault = await controller.sessionCosts({ adminBasicAuth: true } as never);
      expect(byDefault).toHaveLength(20);

      const byGarbage = await controller.sessionCosts({ adminBasicAuth: true } as never, 'abc');
      expect(byGarbage).toHaveLength(20);

      const byHuge = await controller.sessionCosts({ adminBasicAuth: true } as never, '9999');
      expect(byHuge).toHaveLength(30); // 表里只有 30 场, 上限 50
    });

    it('没有留痕的会话 → 0 token / 0 成本, 但仍然列出 (场次是事实)', async () => {
      const { controller, sessionRepo } = buildController();
      sessionRepo.rows.push(buildSession({ id: 's-a', turnDebugTrace: null }));

      const rows = await controller.sessionCosts({ adminBasicAuth: true } as never, '20');

      expect(rows).toHaveLength(1);
      expect(rows[0]?.totalTokens).toBe(0);
      expect(rows[0]?.costCny).toBe(0);
      expect(rows[0]?.costBasis).toBe('output_only');
    });
  });

  describe('③ 成本单价走 env (LLM_PRICE_*)', () => {
    it('env 配了 → 用 env 的价 (看板与单场成本日志同一张定价表)', async () => {
      const { controller, sessionRepo } = buildController({
        LLM_PRICE_INPUT_PER_1K: '0.002',
        LLM_PRICE_OUTPUT_PER_1K: '0.006',
      });
      sessionRepo.rows.push(buildSession({ id: 's-a', turnDebugTrace: [buildTrace({ promptTokens: 1000, completionTokens: 1000 })] }));

      const rows = await controller.sessionCosts({ adminBasicAuth: true } as never, '20');

      // 1 * 0.002 + 1 * 0.006 = 0.008
      expect(rows[0]?.costCny).toBeCloseTo(0.008, 6);
    });

    it('env 没配 → 走默认单价 (DEFAULT_SESSION_COST_PRICING)', async () => {
      const { controller, sessionRepo } = buildController();
      sessionRepo.rows.push(buildSession({ id: 's-a', turnDebugTrace: [buildTrace({ promptTokens: 1000, completionTokens: 1000 })] }));

      const rows = await controller.sessionCosts({ adminBasicAuth: true } as never, '20');

      // 1000 token = 1 个「千」→ 费用 = 输入价 + 输出价.
      const expected = DEFAULT_SESSION_COST_PRICING.inputPer1k + DEFAULT_SESSION_COST_PRICING.outputPer1k;
      expect(rows[0]?.costCny).toBeCloseTo(expected, 6);
    });

    it('env 非法值 → 回退默认, 不抛 (填错 env 不该让服务起不来)', async () => {
      const { controller, sessionRepo } = buildController({
        LLM_PRICE_INPUT_PER_1K: 'abc',
        LLM_PRICE_OUTPUT_PER_1K: '-1',
      });
      sessionRepo.rows.push(buildSession({ id: 's-a', turnDebugTrace: [buildTrace({ promptTokens: 1000, completionTokens: 1000 })] }));

      const rows = await controller.sessionCosts({ adminBasicAuth: true } as never, '20');

      const expected = DEFAULT_SESSION_COST_PRICING.inputPer1k + DEFAULT_SESSION_COST_PRICING.outputPer1k;
      expect(rows[0]?.costCny).toBeCloseTo(expected, 6);
    });
  });

  describe('④ 纯函数口径 (cost-view)', () => {
    it('聚合: totalTokens = 输入 + 输出 (思考 token 不重复计)', () => {
      const aggregate = aggregateSessionCost(
        [buildTrace({ promptTokens: 1000, completionTokens: 500, reasoningTokens: 200 })],
        DEFAULT_SESSION_COST_PRICING,
      );

      expect(aggregate.turnCount).toBe(1);
      expect(aggregate.promptTokens).toBe(1000);
      expect(aggregate.completionTokens).toBe(500);
      expect(aggregate.reasoningTokens).toBe(200);
      expect(aggregate.totalTokens).toBe(1500);
      expect(aggregate.costBasis).toBe('full');
    });

    it('没有留痕 → 0 token / 0 成本, 不报错', () => {
      const aggregate = aggregateSessionCost([], DEFAULT_SESSION_COST_PRICING);

      expect(aggregate.turnCount).toBe(0);
      expect(aggregate.totalTokens).toBe(0);
      expect(aggregate.costCny).toBe(0);
      expect(aggregate.costBasis).toBe('output_only');
    });

    it('趋势: 没有会话的那天也要有一行 (补 0, 时间轴连续)', () => {
      const trend = buildCostTrend([], DEFAULT_SESSION_COST_PRICING, 3, NOW);

      expect(trend).toHaveLength(3);
      expect(trend.map((p) => p.date)).toEqual(['2026-11-03', '2026-11-04', '2026-11-05']);
      expect(trend.every((p) => p.sessions === 0 && p.tokens === 0 && p.costCny === 0)).toBe(true);
    });

    it('时区: 上海 00:00 之前开的场归前一天, 且不落进窗口', () => {
      // 上海 2026-11-04 03:00 = UTC 2026-11-03T19:00 → 按 UTC 会落 11-03, 按上海应落 11-04.
      expect(shanghaiDateKey(new Date('2026-11-03T19:00:00.000Z'))).toBe('2026-11-04');
      // 窗口起点 = 上海 11-03 00:00 = UTC 2026-11-02T16:00.
      expect(shanghaiDayStartUtc(NOW, 2).toISOString()).toBe('2026-11-02T16:00:00.000Z');
    });
  });

  describe('⑤ 守卫继承', () => {
    it('controller 类级挂了 AdminRoleGuard (新增端点自动继承)', () => {
      const classGuards = Reflect.getMetadata(GUARDS_METADATA, AdminDebugController) as unknown[] | undefined;

      expect(classGuards).toContain(AdminRoleGuard);
    });

    it('2 个新端点都是 GET 且有效 guard 含 AdminRoleGuard', () => {
      const prototype = AdminDebugController.prototype;
      const classGuards = (Reflect.getMetadata(GUARDS_METADATA, AdminDebugController) as unknown[] | undefined) ?? [];
      const routes: { readonly path: string; readonly method: number; readonly guards: unknown[] }[] = [];
      for (const name of Object.getOwnPropertyNames(prototype)) {
        if (name === 'constructor') continue;
        const handler = (prototype as unknown as Record<string, unknown>)[name];
        if (typeof handler !== 'function') continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        if (path === undefined) continue;
        const methodGuards = (Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[] | undefined) ?? [];
        routes.push({
          path,
          method: Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined,
          guards: [...classGuards, ...methodGuards],
        });
      }

      const paths = routes.map((route) => route.path);
      expect(paths).toContain('cost/trend');
      expect(paths).toContain('cost/sessions');
      for (const route of routes) {
        expect(route.method).toBe(RequestMethod.GET);
        expect(route.guards).toContain(AdminRoleGuard);
      }
    });
  });
});
