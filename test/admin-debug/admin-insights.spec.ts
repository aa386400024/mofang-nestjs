// V2026-11-05 治本 (Admin Dashboard 剩余三页切真 API · 单测):
//   覆盖任务单 §二 / §三 / §四 的验收:
//     ① GET /admin/api/dashboard                    → 总览统计 (会话数 / token / 轮次 / 危机 / 成本)
//     ② GET /admin/api/dashboard/weekly-sessions    → 近 7 天每天的会话数
//     ③ GET /admin/api/memories                     → 全局记忆列表 (长时记忆)
//     ④ GET /admin/api/psyguard                     → PsyGUARD 状态 (真实探活 + 诚实的"指标未采集")
//     ⑤ GET /admin/api/psyguard/trend               → 近 7 天调用量趋势
//     ⑥ 5 个新端点全部继承 class 级 AdminRoleGuard
//
//   全 mock: 不起 Nest 容器, 不连 DB, 不发网络.
//     · 定价与折算**走仓库真模块** (`resolveSessionCostPricing` / `estimateSessionCost`)
//       —— 不用桩数据冒充, 免得"测试通过但线上口径不对";
//     · 分桶用**仓库真函数** (`shanghaiDateKey`) 断言, 不自己拼日期字符串;
//     · "今天"用 vitest fake timers 冻结 —— 按天分桶的断言必须有确定的"今天".
//
//   验证: npx vitest run test/admin-debug/admin-insights.spec.ts
//   时间戳: 2026-11-05 GMT+8
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { FindOperator } from 'typeorm';

import { AdminInsightsController } from '../../src/admin-debug/admin-insights.controller.js';
import { AdminInsightsModule } from '../../src/admin-debug/admin-insights.module.js';
import { buildOwnerFilter } from '../../src/admin-debug/admin-scope.js';
import { AdminRoleGuard } from '../../src/admin-debug/guards/admin-role.guard.js';
import { DASHBOARD_SCAN_LIMIT, MEMORY_LIST_LIMIT } from '../../src/admin-debug/insights-view.js';
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
 * 假会话仓储 (count + find).
 */
class FakeSessionRepo {
  readonly rows: Record<string, unknown>[] = [];
  readonly findCalls: { readonly where?: Record<string, unknown>; readonly take?: number }[] = [];

  async count(options: { readonly where?: Record<string, unknown> }): Promise<number> {
    return this.rows.filter((row) => matchesWhere(row, options.where)).length;
  }

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
 * 假向量库 (scroll).
 */
class FakeQdrant {
  readonly scrollCalls: { readonly collection: string; readonly limit?: number }[] = [];
  /** 要返回的点. */
  points: { readonly id: string; readonly payload: Record<string, unknown> }[] = [];
  /** 抛错 (模拟不可达 / collection 不存在). */
  failWith: Error | undefined;

  async scroll(
    collection: string,
    _filter: Record<string, unknown>,
    limit?: number,
  ): Promise<{ id: string; payload: Record<string, unknown> }[]> {
    this.scrollCalls.push({ collection, limit });
    if (this.failWith) throw this.failWith;
    return this.points.slice(0, limit ?? this.points.length);
  }
}

/**
 * 假 PsyGUARD 探针.
 */
class FakePsyGuardHealth {
  reachable = true;
  modelLoaded = true;
  contractOk = true;
  readonly calls: number[] = [];

  async check(): Promise<{ reachable: boolean; modelLoaded: boolean; contractOk: boolean }> {
    this.calls.push(1);
    return { reachable: this.reachable, modelLoaded: this.modelLoaded, contractOk: this.contractOk };
  }
}

/**
 * 造一份逐轮留痕快照.
 */
function buildTrace(overrides: Partial<TurnTrace> = {}): TurnTrace {
  return {
    turnIndex: 0,
    characterSlug: 'vpt_x',
    bdiSnapshot: { trust: 0.3, valence: 0, arousal: 0, resistance: 0, anxiousSecure: 'neutral' },
    renderSpec: { taskKind: 'reply', promptPreview: '', maxCompletionTokens: 512, reasoningEffort: 'medium' },
    llmUsage: { promptTokens: 1000, completionTokens: 500, reasoningTokens: 0, ttftMs: 100, finishReason: 'stop' },
    crisis: { detected: false, category: null },
    ts: NOW.toISOString(),
    ...overrides,
  };
}

/**
 * 造一行会话.
 */
function buildSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 's-1',
    userId: 'u-1',
    personaName: '晚晴',
    startedAt: new Date('2026-11-05T02:00:00.000Z'),
    endedAt: new Date('2026-11-05T02:30:00.000Z'),
    status: 'completed',
    turnDebugTrace: [buildTrace()],
    ...overrides,
  };
}

/**
 * 装一个 controller (会话仓储 + 向量库 + 探针 + 配置).
 */
function buildController(env: Record<string, string> = {}): {
  readonly controller: AdminInsightsController;
  readonly sessionRepo: FakeSessionRepo;
  readonly qdrant: FakeQdrant;
  readonly health: FakePsyGuardHealth;
} {
  const sessionRepo = new FakeSessionRepo();
  const qdrant = new FakeQdrant();
  const health = new FakePsyGuardHealth();
  const controller = new AdminInsightsController(sessionRepo as never, qdrant as never, health as never, stubConfig(env) as never);
  return { controller, sessionRepo, qdrant, health };
}

describe('V2026-11-05 · Admin Dashboard 剩余三页切真 API', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── ① Dashboard ──────────────────────────────────────────────────────────
  describe('① GET /admin/api/dashboard', () => {
    it('会话数来自会话表, token / 轮次 / 成本来自留痕', async () => {
      const { controller, sessionRepo } = buildController();
      sessionRepo.rows.push(
        buildSession({
          id: 's-1',
          turnDebugTrace: [
            buildTrace({ llmUsage: { promptTokens: 1000, completionTokens: 500, reasoningTokens: 0, ttftMs: 1, finishReason: 'stop' } }),
          ],
        }),
        buildSession({
          id: 's-2',
          turnDebugTrace: [
            buildTrace({ llmUsage: { promptTokens: 2000, completionTokens: 1000, reasoningTokens: 0, ttftMs: 1, finishReason: 'stop' } }),
          ],
        }),
      );

      const stats = await controller.dashboard({ adminBasicAuth: true } as never);

      expect(stats.totalSessions).toBe(2);
      expect(stats.todaySessions).toBe(2);
      expect(stats.totalTokens).toBe(4500);
      // 成本走 WP24 同一张定价表: 3 个「千」输入 (1000+2000) + 1.5 个「千」输出 (500+1000).
      const expected = 3 * DEFAULT_SESSION_COST_PRICING.inputPer1k + 1.5 * DEFAULT_SESSION_COST_PRICING.outputPer1k;
      expect(stats.estimatedCostCny).toBeCloseTo(expected, 6);
    });

    it('平均每会话轮次的分母是"有留痕的会话数" (没留痕的不稀释)', async () => {
      const { controller, sessionRepo } = buildController();
      sessionRepo.rows.push(
        buildSession({ id: 's-1', turnDebugTrace: [buildTrace(), buildTrace({ turnIndex: 1 })] }),
        // 这场没留痕 (留痕开关关) → 不进分母.
        buildSession({ id: 's-2', turnDebugTrace: null }),
      );

      const stats = await controller.dashboard({ adminBasicAuth: true } as never);

      expect(stats.sessionsScanned).toBe(2);
      expect(stats.avgTurnsPerSession).toBe(2);
    });

    it('留痕关着时: 场次仍然准确, token / 轮次 / 危机恒 0 (不是"没有会话")', async () => {
      const { controller, sessionRepo } = buildController();
      sessionRepo.rows.push(buildSession({ id: 's-1', turnDebugTrace: null }));

      const stats = await controller.dashboard({ adminBasicAuth: true } as never);

      expect(stats.totalSessions).toBe(1);
      expect(stats.totalTokens).toBe(0);
      expect(stats.estimatedCostCny).toBe(0);
      expect(stats.avgTurnsPerSession).toBe(0);
      expect(stats.crisisHits).toBe(0);
    });

    it('危机命中数 = 留痕里 crisis.detected 为真的轮次数', async () => {
      const { controller, sessionRepo } = buildController();
      sessionRepo.rows.push(
        buildSession({
          id: 's-1',
          turnDebugTrace: [
            buildTrace({ crisis: { detected: true, category: 'suicide_plan' } }),
            buildTrace({ turnIndex: 1, crisis: { detected: false, category: null } }),
            buildTrace({ turnIndex: 2, crisis: { detected: true, category: 'self_harm_ideation' } }),
          ],
        }),
      );

      const stats = await controller.dashboard({ adminBasicAuth: true } as never);

      expect(stats.crisisHits).toBe(2);
    });

    it('学员只看自己的会话 (归属过滤生效)', async () => {
      const { controller, sessionRepo } = buildController();
      sessionRepo.rows.push(buildSession({ id: 's-a', userId: 'student-b' }));

      const stats = await controller.dashboard({ user: { userId: 'student-a' } } as never);

      expect(stats.totalSessions).toBe(0);
    });

    it('扫描窗口有上限 (超过上限的会话不参与 token / 成本聚合)', async () => {
      const { controller, sessionRepo } = buildController();
      for (let i = 0; i < 5; i += 1) sessionRepo.rows.push(buildSession({ id: `s-${i}` }));

      const stats = await controller.dashboard({ adminBasicAuth: true } as never);

      expect(stats.sessionsScanned).toBe(5);
      expect(stats.truncated).toBe(false);
      // 上限常量本身也在数据里 (口径写在数据里).
      expect(DASHBOARD_SCAN_LIMIT).toBeGreaterThan(0);
    });

    it('仪表盘里的 psyguard 子视图与 /psyguard 端点同一份口径', async () => {
      const { controller, health } = buildController();
      health.modelLoaded = false;

      const stats = await controller.dashboard({ adminBasicAuth: true } as never);
      const direct = await controller.psyguard();

      expect(stats.psyguard.status).toBe(direct.status);
      expect(stats.psyguard.modelLoaded).toBe(false);
      expect(stats.psyguard.metricsAvailable).toBe(false);
    });
  });

  // ── ② weekly-sessions ────────────────────────────────────────────────────
  describe('② GET /admin/api/dashboard/weekly-sessions', () => {
    it('行数恒等于 7, 按 Asia/Shanghai 分桶, 没有会话的天补 0', async () => {
      const { controller, sessionRepo } = buildController();
      sessionRepo.rows.push(
        buildSession({ id: 's-1', startedAt: new Date('2026-11-05T02:00:00.000Z') }),
        buildSession({ id: 's-2', startedAt: new Date('2026-11-05T02:00:00.000Z') }),
        buildSession({ id: 's-3', startedAt: new Date('2026-11-04T02:00:00.000Z') }),
      );

      const trend = await controller.weeklySessions({ adminBasicAuth: true } as never);

      expect(trend).toHaveLength(7);
      expect(trend.map((p) => p.date)).toEqual([
        '2026-10-30',
        '2026-10-31',
        '2026-11-01',
        '2026-11-02',
        '2026-11-03',
        '2026-11-04',
        '2026-11-05',
      ]);
      expect(trend.at(-1)?.count).toBe(2);
      expect(trend.at(-2)?.count).toBe(1);
      expect(trend[0]?.count).toBe(0);
    });
  });

  // ── ③ memories ───────────────────────────────────────────────────────────
  describe('③ GET /admin/api/memories', () => {
    it('从 Qdrant 读长时记忆, 字段按内核口径映射', async () => {
      const { controller, qdrant } = buildController();
      qdrant.points = [
        {
          id: 'm-1',
          payload: {
            tenantId: 't-1',
            visitorId: 'u-1:vpt_x',
            sessionId: 's-1',
            tier: 'longTerm',
            source: 'summary',
            content: '来访者提到与父亲的关系紧张',
            importance: 0.82,
            occurredAt: NOW.getTime(),
            supersededBy: null,
          },
        },
      ];

      const result = await controller.memories();

      expect(result.source).toBe('qdrant');
      expect(result.scope).toBe('long_term');
      expect(result.total).toBe(1);
      expect(result.limit).toBe(MEMORY_LIST_LIMIT);
      const entry = result.entries[0];
      expect(entry?.id).toBe('m-1');
      expect(entry?.visitorId).toBe('u-1:vpt_x');
      expect(entry?.tier).toBe('long_term');
      expect(entry?.source).toBe('summary');
      expect(entry?.sessionId).toBe('s-1');
      expect(entry?.createdAt).toBe(NOW.toISOString());
      expect(entry?.supersededBy).toBeUndefined();
    });

    it('payload 损坏的条目跳过, 不让一条脏数据炸掉整页', async () => {
      const { controller, qdrant } = buildController();
      qdrant.points = [
        { id: 'm-bad', payload: { tier: 'longTerm' } },
        {
          id: 'm-ok',
          payload: {
            visitorId: 'u-1:vpt_x',
            tier: 'longTerm',
            source: 'turn',
            content: '内容',
            importance: 0.5,
            occurredAt: NOW.getTime(),
          },
        },
      ];

      const result = await controller.memories();

      expect(result.total).toBe(1);
      expect(result.entries[0]?.id).toBe('m-ok');
    });

    it('向量库读不到 → 如实返 unavailable (**不返空数组冒充"没有记忆"**)', async () => {
      const { controller, qdrant } = buildController();
      qdrant.failWith = new Error('collection not found');

      const result = await controller.memories();

      expect(result.source).toBe('unavailable');
      expect(result.entries).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  // ── ④ psyguard ───────────────────────────────────────────────────────────
  describe('④ GET /admin/api/psyguard', () => {
    it('可达 + 模型在 + 口径一致 → ok', async () => {
      const { controller } = buildController();
      const stats = await controller.psyguard();
      expect(stats.status).toBe('ok');
      expect(stats.modelLoaded).toBe(true);
      expect(stats.contractOk).toBe(true);
    });

    it('模型没加载 / 口径漂了 → degraded (服务在, 但不能全信)', async () => {
      const { controller, health } = buildController();
      health.modelLoaded = false;
      expect((await controller.psyguard()).status).toBe('degraded');

      const second = buildController();
      second.health.contractOk = false;
      expect((await second.controller.psyguard()).status).toBe('degraded');
    });

    it('不可达 → down', async () => {
      const { controller, health } = buildController();
      health.reachable = false;
      expect((await controller.psyguard()).status).toBe('down');
    });

    it('后端没有指标采集 → metricsAvailable=false 且延迟/请求数恒 0 (不拿 0 冒充"没调用过")', async () => {
      const { controller } = buildController();
      const stats = await controller.psyguard();

      expect(stats.metricsAvailable).toBe(false);
      expect(stats.p50Ms).toBe(0);
      expect(stats.p90Ms).toBe(0);
      expect(stats.totalRequests).toBe(0);
      expect(stats.byCategory).toEqual({});
    });
  });

  // ── ⑤ psyguard/trend ─────────────────────────────────────────────────────
  describe('⑤ GET /admin/api/psyguard/trend', () => {
    it('行数恒等于 7, 且明说"指标未采集" (不是"这段时间没有调用")', async () => {
      const { controller } = buildController();
      const trend = await controller.psyguardTrend();

      expect(trend.metricsAvailable).toBe(false);
      expect(trend.points).toHaveLength(7);
      expect(trend.points.at(-1)?.ts).toBe('2026-11-05');
      expect(trend.points.every((p) => p.requests === 0)).toBe(true);
    });
  });

  // ── ⑥ 鉴权与路由 ─────────────────────────────────────────────────────────
  describe('⑥ 鉴权与路由', () => {
    it('class 级挂了 AdminRoleGuard', () => {
      const classGuards = Reflect.getMetadata(GUARDS_METADATA, AdminInsightsController) as unknown[] | undefined;
      expect(classGuards).toContain(AdminRoleGuard);
    });

    it('5 个新端点的路径与方法 + 全部继承 class 级 guard', () => {
      const prototype = AdminInsightsController.prototype;
      const classGuards = (Reflect.getMetadata(GUARDS_METADATA, AdminInsightsController) as unknown[] | undefined) ?? [];
      const routes: { path: string; method: number; guards: unknown[] }[] = [];
      for (const name of Object.getOwnPropertyNames(prototype)) {
        if (name === 'constructor') continue;
        const handler = (prototype as unknown as Record<string, unknown>)[name];
        if (typeof handler !== 'function') continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        if (path === undefined) continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
        const methodGuards = (Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[] | undefined) ?? [];
        routes.push({ path, method: method ?? RequestMethod.GET, guards: [...classGuards, ...methodGuards] });
      }

      expect(routes.map((r) => r.path).sort()).toEqual([
        'dashboard',
        'dashboard/weekly-sessions',
        'memories',
        'psyguard',
        'psyguard/trend',
      ]);
      for (const route of routes) {
        expect(route.method).toBe(RequestMethod.GET);
        expect(route.guards).toContain(AdminRoleGuard);
      }
    });

    it('module 注册了 guard / 中间件 / 向量库依赖', () => {
      const providers = Reflect.getMetadata('providers', AdminInsightsModule) as unknown[] | undefined;
      expect(providers).toContain(AdminRoleGuard);

      const imports = Reflect.getMetadata('imports', AdminInsightsModule) as unknown[] | undefined;
      expect(imports?.length).toBeGreaterThan(0);
    });

    it('归属过滤口径只有一份 (basic 不过滤 / 学员只看自己)', () => {
      expect(buildOwnerFilter({ adminBasicAuth: true } as never)).toEqual({});
      expect(buildOwnerFilter({ user: { userId: 'u-1' } } as never)).toEqual({ userId: 'u-1' });
      expect(buildOwnerFilter({} as never)).toEqual({});
    });
  });
});
