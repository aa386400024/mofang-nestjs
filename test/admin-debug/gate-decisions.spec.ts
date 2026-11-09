// V2026-11-09 治本 (Phase2.5 闸门 trace 查询接口 · 单测):
//   覆盖任务单验收标准里"能筛 / 能分页 / 能统计 / 双写一致"背后的**口径**:
//     ① 参数解析: 默认值 / 多选 / 非法值一律抛错 (不静默兜底);
//     ② 视图映射: id 转 number、阈值与 delta 归一化、时间戳按 **+08:00** 输出;
//     ③ 统计聚合: 数组与 dates **等长对齐**, byReason 恒含全部 12 个 reason;
//     ④ 写侧三写: Redis 热读 + Redis 日计数器 + MySQL 真相源, 互不影响;
//     ⑤ 查询装配: sessionId **双口径** (引擎侧 or 落库 id) + 学员隔离 + 分页参数.
//
//   全 mock: 不起 Nest 容器, 不连 DB, 不连 Redis, 不发网络.
//
//   验证: npx vitest run test/admin-debug/gate-decisions.spec.ts
//   时间戳: 2026-11-09

import { Brackets } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { GateTraceController } from '../../src/admin-debug/gate-trace.controller.js';
import { DeliberationGateTrace } from '../../src/engine-adapters/deliberation-gate/deliberation-gate.trace.js';
import {
  buildGateStatsDateKeys,
  buildGateStatsDailyKey,
  buildGateStatsResponse,
  GATE_STATS_MAX_WINDOW_DAYS,
} from '../../src/engine-adapters/deliberation-gate/gate-decision/gate-decision-stats.js';
import {
  parseGateTraceQuery,
  toGateTraceRecordView,
  toShanghaiIsoString,
  type GateTraceRow,
} from '../../src/engine-adapters/deliberation-gate/gate-decision/gate-decision-view.js';
import { GATE_REASON_VALUES } from '../../src/engine-adapters/deliberation-gate/deliberation-gate.types.js';
import type { RedisService } from '../../src/shared/infra/redis/redis.service.js';
import { shanghaiDateKey } from '../../src/shared/time/shanghai-date.js';

const SESSION = 'voice-session-1';
const DB_SESSION = 'b7f0f0a2-1111-4444-8888-abcdefabcdef';

/**
 * 假 Redis (只实现闸门 trace 用到的命令 + eval).
 */
class FakeRedis {
  readonly store = new Map<string, string>();
  readonly evalCalls: unknown[][] = [];

  readonly set = vi.fn(async (key: string, value: string): Promise<void> => {
    this.store.set(key, value);
  });

  readonly eval = vi.fn(async (...args: unknown[]): Promise<number> => {
    this.evalCalls.push(args);
    return 1;
  });

  /** pipeline 读到的日 key (按调用顺序). */
  readonly pipelineKeys: string[] = [];

  readonly pipeline = vi.fn(() => {
    const keys: string[] = [];
    return {
      hgetall: (key: string): null => {
        keys.push(key);
        this.pipelineKeys.push(key);
        return null;
      },
      exec: async (): Promise<[null, Record<string, string>][]> =>
        keys.map((key) => [null, key.endsWith(shanghaiDateKey(new Date())) ? { total: '3', 'decision:skip': '2' } : {}]),
    };
  });

  readonly getClient = vi.fn(() => ({ eval: this.eval, pipeline: this.pipeline }));
}

/**
 * 假查询构造器 (记录 where 子句与分页参数).
 */
class FakeQueryBuilder {
  readonly clauses: string[] = [];
  readonly params: Record<string, unknown> = {};
  orderByClause = '';
  skipValue: number | undefined;
  takeValue: number | undefined;

  andWhere(clause: unknown, params?: Record<string, unknown>): this {
    if (typeof clause === 'string') {
      this.clauses.push(clause);
      Object.assign(this.params, params ?? {});
      return this;
    }
    // Brackets: 把内层的条件也收集进来 (双口径的 OR 就靠它断言).
    if (clause instanceof Brackets) {
      clause.whereFactory(this as never);
      return this;
    }
    this.clauses.push(String(clause));
    return this;
  }

  where(clause: unknown, params?: Record<string, unknown>): this {
    return this.andWhere(clause, params);
  }

  orWhere(clause: unknown, params?: Record<string, unknown>): this {
    return this.andWhere(clause, params);
  }

  orderBy(clause: string): this {
    this.orderByClause = clause;
    return this;
  }

  addOrderBy(): this {
    return this;
  }

  skip(value: number): this {
    this.skipValue = value;
    return this;
  }

  take(value: number): this {
    this.takeValue = value;
    return this;
  }

  async getManyAndCount(): Promise<[GateTraceRow[], number]> {
    return [[buildRow()], 1];
  }

  async getOne(): Promise<GateTraceRow | null> {
    return buildRow();
  }
}

/**
 * 造一行闸门决策 (DB 行形状).
 *
 * @returns 行
 */
function buildRow(): GateTraceRow {
  return {
    id: '42',
    sessionId: SESSION,
    dbSessionId: DB_SESSION,
    userId: 'uid-1',
    turnIndex: 7,
    mode: 'effect',
    decision: 'skip',
    reason: 'cooldown',
    thresholdUsed: { alliance: 0.12, resistance: 0.08, calm: 0.05 },
    deltaSummary: { trust: 0.01, bond: -0.02 },
    elapsedMs: 13,
    recordedAt: new Date('2026-11-09T07:04:05.123Z'),
  };
}

describe('Phase2.5 · 闸门 trace 查询接口', () => {
  describe('① 参数解析 (非法一律抛错, 不静默兜底)', () => {
    it('缺省 → 默认第 1 页 / 每页 20 条 / 不过滤', () => {
      const filters = parseGateTraceQuery({});

      expect(filters.page).toBe(1);
      expect(filters.pageSize).toBe(20);
      expect(filters.sessionId).toBeUndefined();
      expect(filters.modes).toBeUndefined();
      expect(filters.reasons).toBeUndefined();
      expect(filters.decision).toBeUndefined();
      expect(filters.startDay).toBeUndefined();
    });

    it('多选 mode / reason (逗号分隔) → 解析成数组, 去重', () => {
      const filters = parseGateTraceQuery({ mode: 'shadow, effect,shadow', reason: 'cooldown,quota_exceeded' });

      expect(filters.modes).toEqual(['shadow', 'effect']);
      expect(filters.reasons).toEqual(['cooldown', 'quota_exceeded']);
    });

    it('单选 decision + 日期区间 → 解析成上海日键', () => {
      const filters = parseGateTraceQuery({
        decision: 'skip',
        startDate: '2026-11-01',
        endDate: '2026-11-09',
      });

      expect(filters.decision).toBe('skip');
      expect(filters.startDay).toBe('2026-11-01');
      expect(filters.endDay).toBe('2026-11-09');
    });

    it('非法 mode / reason / decision → 抛错 (不静默忽略)', () => {
      expect(() => parseGateTraceQuery({ mode: 'shadowh' })).toThrow(/mode/);
      expect(() => parseGateTraceQuery({ reason: 'not_a_reason' })).toThrow(/reason/);
      expect(() => parseGateTraceQuery({ decision: 'maybe' })).toThrow(/decision/);
    });

    it('非法日期 / 区间倒挂 / 非法分页 → 抛错', () => {
      expect(() => parseGateTraceQuery({ startDate: '2026-02-30' })).toThrow(/startDate/);
      expect(() => parseGateTraceQuery({ endDate: '20261109' })).toThrow(/endDate/);
      expect(() => parseGateTraceQuery({ startDate: '2026-11-09', endDate: '2026-11-01' })).toThrow(/startDate/);
      expect(() => parseGateTraceQuery({ page: '0' })).toThrow(/page/);
      expect(() => parseGateTraceQuery({ pageSize: '1000' })).toThrow(/pageSize/);
      expect(() => parseGateTraceQuery({ pageSize: 'abc' })).toThrow(/pageSize/);
    });
  });

  describe('② 视图映射 (契约形状)', () => {
    it('id 转 number / 阈值与 delta 归一化 / 时间戳带 +08:00', () => {
      const view = toGateTraceRecordView(buildRow());

      expect(view.id).toBe(42);
      expect(typeof view.id).toBe('number');
      expect(view.sessionId).toBe(SESSION);
      expect(view.dbSessionId).toBe(DB_SESSION);
      expect(view.mode).toBe('effect');
      expect(view.decision).toBe('skip');
      expect(view.reason).toBe('cooldown');
      expect(view.thresholdUsed).toEqual({ alliance: 0.12, resistance: 0.08, calm: 0.05 });
      expect(view.deltaSummary).toEqual({ trust: 0.01, bond: -0.02 });
      expect(view.elapsedMs).toBe(13);
      expect(view.recordedAt).toBe('2026-11-09T15:04:05.123+08:00');
    });

    it('阈值 / delta 缺失 → 补 0 与空对象 (不返 undefined)', () => {
      const view = toGateTraceRecordView({
        ...buildRow(),
        thresholdUsed: null,
        deltaSummary: null,
        dbSessionId: null,
      });

      expect(view.thresholdUsed).toEqual({ alliance: 0, resistance: 0, calm: 0 });
      expect(view.deltaSummary).toEqual({});
      expect(view.dbSessionId).toBeNull();
    });

    it('时间戳按 Asia/Shanghai 输出 (UTC 07:04 → 上海 15:04)', () => {
      expect(toShanghaiIsoString(new Date('2026-11-09T07:04:05.123Z'))).toBe('2026-11-09T15:04:05.123+08:00');
      // 上海日界: UTC 前一天 16:00 = 上海当天 00:00.
      expect(toShanghaiIsoString(new Date('2026-11-08T16:00:00.000Z'))).toBe('2026-11-09T00:00:00.000+08:00');
    });
  });

  describe('③ 统计口径 (数组与 dates 等长)', () => {
    it('缺失的桶补 0, byReason 恒含全部 12 个 reason', () => {
      const dates = ['2026-11-08', '2026-11-09'];
      const response = buildGateStatsResponse(dates, [
        { total: '3', 'decision:run': '1', 'decision:skip': '2', 'mode:shadow': '1', 'mode:effect': '2' },
        {},
      ]);

      expect(response.dates).toEqual(dates);
      expect(response.totalDecisions).toEqual([3, 0]);
      expect(response.runDecisions).toEqual([1, 0]);
      expect(response.skipDecisions).toEqual([2, 0]);
      expect(response.byMode.shadow).toEqual([1, 0]);
      expect(response.byMode.effect).toEqual([2, 0]);
      expect(Object.keys(response.byReason).sort()).toEqual([...GATE_REASON_VALUES].sort());
      expect(response.byReason.cooldown).toEqual([0, 0]);
      expect(response.byReason.gate_error).toEqual([0, 0]);
      for (const bucket of Object.values(response.byReason)) {
        expect(bucket).toHaveLength(dates.length);
      }
    });

    it('日期键: 最近 N 天 (含今天, Asia/Shanghai)', () => {
      const dates = buildGateStatsDateKeys(3, new Date('2026-11-09T07:00:00.000Z'));

      expect(dates).toEqual(['2026-11-07', '2026-11-08', '2026-11-09']);
      expect(buildGateStatsDailyKey('2026-11-09')).toBe('gate_stats:global:2026-11-09');
      expect(GATE_STATS_MAX_WINDOW_DAYS).toBe(90);
    });
  });

  describe('④ 写侧三写 (Redis 热读 + 日计数器 + MySQL 真相源)', () => {
    it('一条决策 → 三处都写到, 且带上两个会话口径', async () => {
      const redis = new FakeRedis();
      const written: unknown[] = [];
      const trace = new DeliberationGateTrace(redis as unknown as RedisService, {
        write: async (record): Promise<void> => {
          written.push(record);
        },
      });

      await trace.record({
        sessionId: SESSION,
        dbSessionId: DB_SESSION,
        userId: 'uid-1',
        turnIndex: 3,
        mode: 'effect',
        decision: 'skip',
        reason: 'cooldown',
        deltaSummary: { trust: 0.01 },
        thresholdUsed: { alliance: 0.12, resistance: 0.08, calm: 0.05 },
        elapsedMs: 7,
        recordedAt: Date.parse('2026-11-09T07:04:05.123Z'),
      });

      // ① Redis 热读 (每轮一个 key).
      const key = [...redis.store.keys()][0] ?? '';
      expect(key).toContain('deliberation:gate:trace');
      // ② 日计数器 (写时聚合).
      expect(redis.evalCalls).toHaveLength(1);
      expect(String(redis.evalCalls[0]?.[2])).toBe('gate_stats:global:2026-11-09');
      // ③ MySQL 真相源.
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({ sessionId: SESSION, dbSessionId: DB_SESSION, userId: 'uid-1', turnIndex: 3 });
    });

    it('落库失败 / 计数失败 → 不抛 (观察面挂了不许炸会话)', async () => {
      const redis = new FakeRedis();
      redis.eval.mockRejectedValueOnce(new Error('redis down'));
      const trace = new DeliberationGateTrace(redis as unknown as RedisService, {
        write: async (): Promise<void> => {
          throw new Error('db down');
        },
      });

      await expect(
        trace.record({
          sessionId: SESSION,
          turnIndex: 1,
          mode: 'shadow',
          decision: 'run',
          reason: 'first_turn_baseline',
          deltaSummary: {},
          thresholdUsed: { alliance: 0.1, resistance: 0.1, calm: 0.1 },
          elapsedMs: 1,
          recordedAt: Date.now(),
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('⑤ 查询装配 (双口径 + 学员隔离 + 分页)', () => {
    it('sessionId 同时匹配引擎侧与落库两种口径', async () => {
      const builder = new FakeQueryBuilder();
      const controller = new GateTraceController(
        { createQueryBuilder: () => builder } as never,
        new FakeRedis() as unknown as RedisService,
      );

      await controller.list({ adminBasicAuth: true } as never, { sessionId: DB_SESSION });

      expect(builder.clauses).toContain('g.sessionId = :sessionId');
      expect(builder.clauses).toContain('g.dbSessionId = :sessionId');
      expect(builder.params['sessionId']).toBe(DB_SESSION);
    });

    it('学员身份 → 按 user_id 隔离 (管理员不过滤)', async () => {
      const builder = new FakeQueryBuilder();
      const controller = new GateTraceController(
        { createQueryBuilder: () => builder } as never,
        new FakeRedis() as unknown as RedisService,
      );

      await controller.list({ user: { userId: 'uid-1' } } as never, {});
      expect(builder.clauses).toContain('g.userId = :ownerUserId');
      expect(builder.params['ownerUserId']).toBe('uid-1');

      const adminBuilder = new FakeQueryBuilder();
      const adminController = new GateTraceController(
        { createQueryBuilder: () => adminBuilder } as never,
        new FakeRedis() as unknown as RedisService,
      );
      await adminController.list({ adminBasicAuth: true } as never, {});
      expect(adminBuilder.clauses).not.toContain('g.userId = :ownerUserId');
    });

    it('分页参数落到 skip / take, 默认按 recordedAt 倒序', async () => {
      const builder = new FakeQueryBuilder();
      const controller = new GateTraceController(
        { createQueryBuilder: () => builder } as never,
        new FakeRedis() as unknown as RedisService,
      );

      const response = await controller.list({ adminBasicAuth: true } as never, { page: '3', pageSize: '50' });

      expect(builder.skipValue).toBe(100);
      expect(builder.takeValue).toBe(50);
      expect(builder.orderByClause).toBe('g.recordedAt');
      expect(response.total).toBe(1);
      expect(response.page).toBe(3);
      expect(response.pageSize).toBe(50);
      expect(response.items).toHaveLength(1);
      expect(response.items[0]?.id).toBe(42);
    });

    it('按天统计 → 读日计数器, 数组与 dates 等长', async () => {
      const redis = new FakeRedis();
      const controller = new GateTraceController(
        { createQueryBuilder: () => new FakeQueryBuilder() } as never,
        redis as unknown as RedisService,
      );

      const response = await controller.stats('2');

      expect(response.dates).toHaveLength(2);
      expect(response.dates[1]).toBe(shanghaiDateKey(new Date()));
      expect(response.totalDecisions).toEqual([0, 3]);
      expect(response.skipDecisions).toEqual([0, 2]);
      expect(response.byMode.shadow).toHaveLength(2);
      // 日计数器是**全局口径** (写时计数器没有归属维度) —— 与 /deliberation/stats 同款.
      expect(redis.pipelineKeys.length).toBeGreaterThan(0);
    });

    it('非法 days → 400; 超 90 天 → 截断 (不静默扩大窗口)', async () => {
      const controller = new GateTraceController(
        { createQueryBuilder: () => new FakeQueryBuilder() } as never,
        new FakeRedis() as unknown as RedisService,
      );

      await expect(controller.stats('abc')).rejects.toMatchObject({ code: 1001, status: 400 });
      const clamped = await controller.stats('365');
      expect(clamped.dates).toHaveLength(90);
    });

    it('非法参数 → 400 (BizCode.InvalidParameter)', async () => {
      const controller = new GateTraceController(
        { createQueryBuilder: () => new FakeQueryBuilder() } as never,
        new FakeRedis() as unknown as RedisService,
      );

      await expect(controller.list({ adminBasicAuth: true } as never, { mode: 'nope' })).rejects.toMatchObject({
        code: 1001,
        status: 400,
      });
      await expect(controller.detail({ adminBasicAuth: true } as never, 'abc')).rejects.toMatchObject({
        code: 1001,
        status: 400,
      });
    });
  });
});
