// V2026-11-07 治本 (影子模式数据统计面板 · 后端接口):
//   覆盖任务单 §八 的闸门 5-10 + 若干防漂移用例:
//     5. 写入侧: 成功轮次跑一次, 计数器各字段累加正确
//     6. 写入侧: 失败轮次跑一次, total_turns / failure_turns 累加, 其它语义字段不累加
//     7. 读取侧: 接口返回的字段形状与任务单 §5.1 一致 (不多不少)
//     8. 读取侧: 成功率 = success_turns / total_turns, 计算正确
//     9. 读取侧: 平均耗时 = total_duration_ms / total_turns, 计算正确
//     10. 边界: 空数据 (计数器全是 0) 时接口不崩, 返回 0 而不是 NaN
//   额外覆盖: Lua 参数编排 / 取大字段不被小值覆盖 / 失败错误码分布 /
//             延迟分位数 (桶上界) / 统计写失败不炸审议 / 端点路由与 guard 继承.
//
//   ⚠️ **Lua 脚本本身没有真 Redis 验证** —— 本仓库没有真 Redis 测试基础设施
//     (无 ioredis-mock / 无 testcontainers; BDI 的 CAS 脚本同样未测).
//     本文件的假 Redis **按脚本文档化的语义**实现 (ARGV 编排 + HINCRBYFLOAT + 取大),
//     所以这里验证的是 **TS 侧的参数编排 + 聚合口径**, 不是 Lua 语法.
//     脚本形状另有一条用例盯着 (改了 Lua 的 ARGV 布局它会红) —— 残余风险登记在交付记录里.
//
//   验证: npx vitest run test/admin-debug/deliberation-stats.spec.ts

import { Logger, RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { AdminDebugController } from '../../src/admin-debug/admin-debug.controller.js';
import { AdminRoleGuard } from '../../src/admin-debug/guards/admin-role.guard.js';
import type { CounselorLlmJsonClient } from '../../src/counselor/providers/llm-json.client.js';
import {
  DELIBERATION_LATENCY_BUCKET_BOUNDS,
  DELIBERATION_STATS_KEY_PREFIX,
  DELIBERATION_STATS_LUA_SCRIPT,
  applyDeliberationStats,
  buildDeliberationStatsDeltas,
  buildDeliberationStatsKey,
  buildDeliberationStatsResponse,
} from '../../src/engine-adapters/deliberation/deliberation-stats.js';
import {
  DELIBERATION_CIRCUIT_OPEN_ERROR_CODE,
  LlmDeliberationService,
  type DeliberationShadowInput,
  type DeliberationTraceRecord,
} from '../../src/engine-adapters/deliberation/llm-deliberation.service.js';
import { createEmptyBdiSnapshot, type BdiStateRepository } from '../../src/engine-core/index.js';
import type { RedisService } from '../../src/shared/infra/redis/redis.service.js';

/** 11 维全零的 delta (内核 DeltaVector 的形状). */
const ZERO_DELTA = {
  trust: 0,
  safety: 0,
  bond: 0,
  valence: 0,
  arousal: 0,
  verbal: 0,
  depth: 0,
  style: 0,
  positive: 0,
  negative: 0,
  dependency: 0,
};

/**
 * 假 Redis (只实现统计端点用到的命令).
 *
 * ⚠️ `eval` 是**按脚本文档化的语义**实现的 (ARGV 编排 + HINCRBYFLOAT + 取大):
 *   本仓库没有真 Redis 测试基础设施 (无 ioredis-mock / 无 testcontainers),
 *   所以这里验证的是 **TS 侧的参数编排 + 聚合口径**, **不是 Lua 语法**.
 *   脚本形状另有一条用例盯着 —— 改了 Lua 的 ARGV 布局, 它会红.
 */
class FakeRedis {
  readonly hash: Record<string, string> = {};
  readonly evalCalls: { readonly script: string; readonly numKeys: number; readonly key: string; readonly args: (string | number)[] }[] =
    [];

  /** 让 eval 抛错 (测 "统计写失败不炸审议"). */
  failWith: Error | undefined;

  getClient(): {
    eval(script: string, numKeys: number, key: string, ...args: (string | number)[]): Promise<number>;
  } {
    return {
      eval: async (script, numKeys, key, ...args) => {
        this.evalCalls.push({ script, numKeys, key, args });
        if (this.failWith) throw this.failWith;
        applyScriptTo(this.hash, args);
        return 1;
      },
    };
  }

  async hgetall(): Promise<Record<string, string>> {
    return { ...this.hash };
  }
}

/**
 * 把 Lua 脚本的语义在 TS 里复刻一遍 (HINCRBYFLOAT 累加 + 取大).
 *
 * ⚠️ 这是**假 Redis 的执行器** —— 它按脚本注释里的 ARGV 布局解析参数:
 *   [计数器对数, (字段, 增量) × n, 取大对数, (字段, 值) × m].
 */
function applyScriptTo(hash: Record<string, string>, argv: readonly (string | number)[]): void {
  let i = 0;
  const counterCount = Number(argv[i++]);
  for (let k = 0; k < counterCount; k++) {
    const field = String(argv[i++]);
    const delta = Number(argv[i++]);
    hash[field] = String(Number(hash[field] ?? 0) + delta);
  }
  const maxCount = Number(argv[i++]);
  for (let k = 0; k < maxCount; k++) {
    const field = String(argv[i++]);
    const value = Number(argv[i++]);
    const current = hash[field] === undefined ? undefined : Number(hash[field]);
    if (current === undefined || current < value) hash[field] = String(value);
  }
}

/** 把 ARGV 拆回计数器 / 取大两张表 (按脚本文档化的布局). */
function parseArgs(argv: readonly (string | number)[]): {
  counters: Record<string, number>;
  maxima: Record<string, number>;
} {
  const counters: Record<string, number> = {};
  const maxima: Record<string, number> = {};
  let i = 0;
  const counterCount = Number(argv[i++]);
  for (let k = 0; k < counterCount; k++) {
    counters[String(argv[i++])] = Number(argv[i++]);
  }
  const maxCount = Number(argv[i++]);
  for (let k = 0; k < maxCount; k++) {
    maxima[String(argv[i++])] = Number(argv[i++]);
  }
  return { counters, maxima };
}

/** 一条审议 trace (成功为基准, 覆盖字段改口径). */
function buildRecord(overrides: Partial<DeliberationTraceRecord> = {}): DeliberationTraceRecord {
  return {
    tenantId: 'tenant-1',
    sessionId: 'session-1',
    turnIndex: 1,
    baseRevision: 7,
    stale: false,
    currentRevision: 7,
    timestamp: '2026-11-07T00:00:00.000Z',
    ok: true,
    errorCode: null,
    retryCount: 0,
    durationMs: 100,
    mode: 'freeform',
    tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    ruleDelta: ZERO_DELTA,
    deliberationDelta: {},
    deltaDiff: { ...ZERO_DELTA },
    capEntries: [],
    clinicalFlags: [],
    operatorTags: [],
    reason: null,
    confidence: null,
    summary: null,
    entries: [],
    rejectedEntries: [],
    ruleStrategy: 'simple_response',
    llmIntentionShift: null,
    lockedStrategy: 'simple_response',
    llmIntentionAccepted: false,
    ...overrides,
  };
}

/** 影子审议入参 (基准). */
function buildInput(overrides: Partial<DeliberationShadowInput> = {}): DeliberationShadowInput {
  return {
    sessionId: 'session-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    turnIndex: 3,
    baseRevision: 7,
    mode: 'freeform',
    baseSnapshot: createEmptyBdiSnapshot(),
    counselorText: '你最近睡得怎么样?',
    visitorText: '有点累, 夜里老醒.',
    characterBrief: '依恋风格: 回避型',
    ruleDelta: ZERO_DELTA,
    ruleStrategy: 'simple_response',
    ...overrides,
  };
}

/** 装一个 controller (统计端点只用到 Redis). */
function buildController(redis: FakeRedis): AdminDebugController {
  const sessionRepo = { find: async () => [], findOne: async () => null };
  const characterRepo = { find: async () => [], findOne: async () => null };
  const config = { get: () => {} };
  return new AdminDebugController(sessionRepo as never, characterRepo as never, config as never, redis as unknown as RedisService);
}

/** 装一个审议服务 (依赖全是极小替身). */
function buildService(redis: FakeRedis): { service: LlmDeliberationService; set: ReturnType<typeof vi.fn> } {
  const set = vi.fn(async (): Promise<void> => undefined);
  const config = { get: () => {} };
  const llm = { requestJson: vi.fn() };
  const bdiStates = { load: vi.fn(async () => null) };
  const redisStub = {
    set,
    get: vi.fn(async (): Promise<string | null> => null),
    getClient: () => redis.getClient(),
  };
  return {
    service: new LlmDeliberationService(
      llm as unknown as CounselorLlmJsonClient,
      config as unknown as ConfigService,
      redisStub as unknown as RedisService,
      bdiStates as unknown as BdiStateRepository,
    ),
    set,
  };
}

describe('影子模式数据统计面板 · 后端接口', () => {
  describe('① 写入侧 (闸门 5-6)', () => {
    it('成功轮次: 各字段累加正确', async () => {
      const redis = new FakeRedis();
      const record = buildRecord({
        ok: true,
        durationMs: 1200,
        retryCount: 2,
        stale: true,
        tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        deltaDiff: { ...ZERO_DELTA, trust: 0.25, safety: -0.5, bond: 0.125 },
        capEntries: [{ dimension: 'trust', raw: 0.3, capped: 0.2 }],
        clinicalFlags: [{ rule: 'alliance_positive_spike', dimension: 'bond', value: 0.4, threshold: 0.3, severity: 'warn' }],
      });

      await applyDeliberationStats(redis as unknown as RedisService, record);

      expect(redis.hash.total_turns).toBe('1');
      expect(redis.hash.success_turns).toBe('1');
      expect(redis.hash.failure_turns).toBeUndefined();
      expect(redis.hash.total_duration_ms).toBe('1200');
      expect(redis.hash.max_duration_ms).toBe('1200');
      expect(redis.hash.total_retry_count).toBe('2');
      expect(redis.hash.total_prompt_tokens).toBe('100');
      expect(redis.hash.total_completion_tokens).toBe('50');
      expect(redis.hash.stale_turns).toBe('1');
      // deltaDiff 绝对值之和 = 0.25 + 0.5 + 0.125 = 0.875 (逐维取绝对值后**求和**)
      expect(redis.hash.sum_delta_diff_abs).toBe('0.875');
      expect(redis.hash.max_delta_diff_abs).toBe('0.5');
      expect(redis.hash.cap_trust).toBe('1');
      expect(redis.hash.clinical_alliance_positive_spike).toBe('1');
      expect(redis.hash.flagged_turns).toBe('1');
      // 延迟桶: 1200ms 落在 [1000, 1500) → 第 7 个桶 (上界 1500)
      expect(redis.hash.latency_b7).toBe('1');
    });

    it('失败轮次: total_turns / failure_turns 累加, 其它语义字段不累加', async () => {
      const redis = new FakeRedis();
      const record = buildRecord({
        ok: false,
        errorCode: 'json_parse_failed',
        durationMs: 120,
        retryCount: 1,
        tokenUsage: null,
        stale: false,
        deltaDiff: { ...ZERO_DELTA },
        capEntries: [],
        clinicalFlags: [],
      });

      await applyDeliberationStats(redis as unknown as RedisService, record);

      expect(redis.hash.total_turns).toBe('1');
      expect(redis.hash.failure_turns).toBe('1');
      expect(redis.hash.success_turns).toBeUndefined();
      // ⚠️ 失败轮次**也有**耗时 / 重试 —— 一并累加 (平均值的分母是总轮次).
      //   (任务单 §4.3 的失败清单漏了这两项, 照抄会让分子分母对不上.)
      expect(redis.hash.total_duration_ms).toBe('120');
      expect(redis.hash.total_retry_count).toBe('1');
      // 失败轮次没有 deltaDiff / 砍幅 / 临床标记 / 过期的语义 —— 一个都不记
      expect(redis.hash.sum_delta_diff_abs).toBeUndefined();
      expect(redis.hash.max_delta_diff_abs).toBeUndefined();
      expect(redis.hash.stale_turns).toBeUndefined();
      expect(redis.hash.flagged_turns).toBeUndefined();
      expect(redis.hash.cap_trust).toBeUndefined();
      expect(redis.hash.clinical_alliance_positive_spike).toBeUndefined();
      // 失败原因分布 (答 "失败的主要原因是什么")
      expect(redis.hash.error_json_parse_failed).toBe('1');
      // 延迟桶: 120ms 落在 [100, 200) → 第 2 个桶 (上界 200)
      expect(redis.hash.latency_b2).toBe('1');
    });

    it('取大字段: 后一轮的更小值不会覆盖前一轮的最大值', async () => {
      const redis = new FakeRedis();

      await applyDeliberationStats(redis as unknown as RedisService, buildRecord({ durationMs: 1200 }));
      await applyDeliberationStats(redis as unknown as RedisService, buildRecord({ durationMs: 100 }));

      expect(redis.hash.max_duration_ms).toBe('1200');
    });

    it('Lua 参数编排: 一次脚本调用带齐全部计数器与取大字段', async () => {
      const redis = new FakeRedis();
      const record = buildRecord({
        durationMs: 1200,
        retryCount: 2,
        stale: true,
        tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        deltaDiff: { ...ZERO_DELTA, trust: 0.25, safety: -0.5, bond: 0.125 },
        capEntries: [{ dimension: 'trust', raw: 0.3, capped: 0.2 }],
        clinicalFlags: [{ rule: 'alliance_positive_spike', dimension: 'bond', value: 0.4, threshold: 0.3, severity: 'warn' }],
      });

      await applyDeliberationStats(redis as unknown as RedisService, record);

      expect(redis.evalCalls).toHaveLength(1);
      const call = redis.evalCalls[0];
      expect(call.script).toBe(DELIBERATION_STATS_LUA_SCRIPT);
      expect(call.numKeys).toBe(1);
      expect(call.key).toBe(buildDeliberationStatsKey());
      const { counters, maxima } = parseArgs(call.args);
      expect(Object.keys(counters)).toHaveLength(12);
      expect(counters.total_turns).toBe(1);
      expect(counters.success_turns).toBe(1);
      expect(counters.total_duration_ms).toBe(1200);
      expect(counters.total_retry_count).toBe(2);
      expect(counters.stale_turns).toBe(1);
      expect(counters.sum_delta_diff_abs).toBe(0.875);
      expect(counters.cap_trust).toBe(1);
      expect(counters.clinical_alliance_positive_spike).toBe(1);
      expect(counters.flagged_turns).toBe(1);
      // 取大字段**不进**计数器表 (两者在脚本里走的是两段不同的循环)
      expect(counters.max_duration_ms).toBeUndefined();
      expect(maxima.max_duration_ms).toBe(1200);
      expect(maxima.max_delta_diff_abs).toBe(0.5);
    });

    it('脚本形状与假实现同源 (改了 Lua 的 ARGV 布局, 这条会红)', () => {
      const script = DELIBERATION_STATS_LUA_SCRIPT;

      expect(script).toContain("redis.call('HINCRBYFLOAT', key, field, delta)");
      expect(script).toContain("redis.call('HGET', key, field)");
      expect(script).toContain("redis.call('HSET', key, field, value)");
      // 两段平铺循环, 每段一次 "i = i + 2" (每对参数占两个 ARGV)
      expect(script.split('i = i + 2').length - 1).toBe(2);
      // 累加段在取大段之前 (脚本顺序 = 假实现的解析顺序)
      expect(script.indexOf('HINCRBYFLOAT')).toBeLessThan(script.indexOf('HGET'));
    });

    it('统计 key 命名与仓库既有范式一致', () => {
      expect(DELIBERATION_STATS_KEY_PREFIX).toBe('deliberation_stats');
      expect(buildDeliberationStatsKey()).toBe('deliberation_stats:global');
    });

    it('纯函数: 同一份记录算出的增量是确定的', () => {
      const record = buildRecord({ durationMs: 1200, retryCount: 2 });

      const first = buildDeliberationStatsDeltas(record);
      const second = buildDeliberationStatsDeltas(record);

      expect(first).toEqual(second);
      expect(first.counters.total_turns).toBe(1);
      expect(first.maxima.max_duration_ms).toBe(1200);
    });
  });

  describe('② 读取侧 (闸门 7-10)', () => {
    it('接口返回的字段形状与任务单 §5.1 一致 (且不多不少)', async () => {
      const controller = buildController(new FakeRedis());

      const response = await controller.deliberationStats();

      expect(Object.keys(response).sort()).toEqual([
        'avgCompletionTokens',
        'avgDeltaDiffAbs',
        'avgDurationMs',
        'avgPromptTokens',
        'avgRetryCount',
        'capByDimension',
        'clinicalByRule',
        'failureByErrorCode',
        'failureTurns',
        'flaggedTurnRate',
        'maxDeltaDiffAbs',
        'maxDurationMs',
        'p50DurationMs',
        'p95DurationMs',
        'staleRate',
        'successRate',
        'successTurns',
        'totalTurns',
      ]);
    });

    it('成功率 = success_turns / total_turns, 计算正确', async () => {
      const redis = new FakeRedis();
      for (let i = 0; i < 3; i++) {
        await applyDeliberationStats(redis as unknown as RedisService, buildRecord({ durationMs: 100 + i }));
      }
      await applyDeliberationStats(redis as unknown as RedisService, buildRecord({ ok: false, errorCode: 'http_401', durationMs: 100 }));

      const response = buildDeliberationStatsResponse(await redis.hgetall());

      expect(response.totalTurns).toBe(4);
      expect(response.successTurns).toBe(3);
      expect(response.failureTurns).toBe(1);
      expect(response.successRate).toBe(0.75);
    });

    it('平均耗时 = total_duration_ms / total_turns, 计算正确', async () => {
      const redis = new FakeRedis();
      for (const durationMs of [100, 200, 300, 400]) {
        await applyDeliberationStats(redis as unknown as RedisService, buildRecord({ durationMs }));
      }

      const response = buildDeliberationStatsResponse(await redis.hgetall());

      expect(response.avgDurationMs).toBe(250);
      expect(response.maxDurationMs).toBe(400);
    });

    it('空数据不崩: 全 0 而不是 NaN', async () => {
      const response = buildDeliberationStatsResponse({});

      for (const value of Object.values(response)) {
        expect(Number.isNaN(value)).toBe(false);
      }
      expect(response.totalTurns).toBe(0);
      expect(response.successRate).toBe(0);
      expect(response.avgDurationMs).toBe(0);
      expect(response.staleRate).toBe(0);
      expect(response.flaggedTurnRate).toBe(0);
      expect(response.p50DurationMs).toBe(0);
      expect(response.p95DurationMs).toBe(0);
      expect(response.capByDimension).toEqual({});
      expect(response.clinicalByRule).toEqual({});
      expect(response.failureByErrorCode).toEqual({});
    });

    it('空数据时端点也不崩', async () => {
      const controller = buildController(new FakeRedis());

      const response = await controller.deliberationStats();

      expect(response.totalTurns).toBe(0);
      expect(response.successRate).toBe(0);
    });

    it('延迟分位数: 按桶分布算, 返回命中桶的上界 (偏保守, 不把慢轮次报快)', async () => {
      const redis = new FakeRedis();
      for (let i = 0; i < 18; i++) {
        await applyDeliberationStats(redis as unknown as RedisService, buildRecord({ durationMs: 100 }));
      }
      for (let i = 0; i < 2; i++) {
        await applyDeliberationStats(redis as unknown as RedisService, buildRecord({ durationMs: 1200 }));
      }

      const response = buildDeliberationStatsResponse(await redis.hgetall());

      expect(response.totalTurns).toBe(20);
      expect(response.p50DurationMs).toBe(DELIBERATION_LATENCY_BUCKET_BOUNDS[2]);
      expect(response.p95DurationMs).toBe(DELIBERATION_LATENCY_BUCKET_BOUNDS[7]);
    });

    it('失败原因分布: 按错误码聚合 (答 "失败的主要原因是什么")', async () => {
      const redis = new FakeRedis();
      await applyDeliberationStats(redis as unknown as RedisService, buildRecord({ ok: false, errorCode: 'json_parse_failed' }));
      await applyDeliberationStats(redis as unknown as RedisService, buildRecord({ ok: false, errorCode: 'json_parse_failed' }));
      await applyDeliberationStats(redis as unknown as RedisService, buildRecord({ ok: false, errorCode: 'http_429' }));

      const response = buildDeliberationStatsResponse(await redis.hgetall());

      expect(response.failureByErrorCode).toEqual({ json_parse_failed: 2, http_429: 1 });
    });

    it('砍幅 / 临床标记: 按维度与规则聚合', async () => {
      const redis = new FakeRedis();
      await applyDeliberationStats(
        redis as unknown as RedisService,
        buildRecord({
          capEntries: [
            { dimension: 'trust', raw: 0.3, capped: 0.2 },
            { dimension: 'safety', raw: 0.4, capped: 0.2 },
          ],
          clinicalFlags: [{ rule: 'alliance_positive_spike', dimension: 'bond', value: 0.4, threshold: 0.3, severity: 'warn' }],
        }),
      );

      const response = buildDeliberationStatsResponse(await redis.hgetall());

      expect(response.capByDimension).toEqual({ trust: 1, safety: 1 });
      expect(response.clinicalByRule).toEqual({ alliance_positive_spike: 1 });
      expect(response.flaggedTurnRate).toBe(1);
    });

    it('分母口径: 平均重试 / 平均 token 用总轮次, 过期率 / flagged 率用成功轮次', async () => {
      const redis = new FakeRedis();
      await applyDeliberationStats(
        redis as unknown as RedisService,
        buildRecord({ retryCount: 2, stale: true, tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } }),
      );
      await applyDeliberationStats(
        redis as unknown as RedisService,
        buildRecord({ ok: false, errorCode: 'http_401', retryCount: 4, tokenUsage: null }),
      );

      const response = buildDeliberationStatsResponse(await redis.hgetall());

      expect(response.avgRetryCount).toBe(3);
      expect(response.avgPromptTokens).toBe(50);
      expect(response.avgCompletionTokens).toBe(25);
      // 过期率 = staleTurns / successTurns (失败轮次没有 "过期" 这个概念)
      expect(response.staleRate).toBe(1);
      expect(response.flaggedTurnRate).toBe(0);
    });
  });

  describe('③ 端点接线', () => {
    it('端点路径是 GET /admin/api/deliberation/stats', () => {
      const handler = AdminDebugController.prototype.deliberationStats;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;

      expect(path).toBe('deliberation/stats');
      expect(method).toBe(RequestMethod.GET);
    });

    it('端点继承 class 级 AdminRoleGuard (非 admin → 403)', () => {
      const classGuards = Reflect.getMetadata(GUARDS_METADATA, AdminDebugController) as unknown[] | undefined;

      expect(classGuards).toContain(AdminRoleGuard);
    });

    it('端点读的就是统计计数器那个 key', async () => {
      const redis = new FakeRedis();
      const controller = buildController(redis);
      await applyDeliberationStats(redis as unknown as RedisService, buildRecord({ durationMs: 500 }));

      const response = await controller.deliberationStats();

      expect(response.totalTurns).toBe(1);
      expect(response.avgDurationMs).toBe(500);
    });

    it('Redis 读失败不兜底成 0 (直接抛错, 免得看板装作一切正常)', async () => {
      const redis = new FakeRedis();
      redis.hgetall = async (): Promise<Record<string, string>> => {
        throw new Error('redis down');
      };
      const controller = buildController(redis);

      await expect(controller.deliberationStats()).rejects.toThrow('redis down');
    });
  });

  describe('④ 写入侧接线 (writeTrace 内)', () => {
    it('审议写 trace 时同步累加计数器', async () => {
      const redis = new FakeRedis();
      const { service, set } = buildService(redis);

      await service.recordCircuitOpen(buildInput());

      expect(set).toHaveBeenCalledTimes(1);
      expect(redis.hash.total_turns).toBe('1');
      expect(redis.hash.failure_turns).toBe('1');
      expect(redis.hash['error_' + DELIBERATION_CIRCUIT_OPEN_ERROR_CODE]).toBe('1');
    });

    it('统计写失败不炸审议 (影子模式: 观察面挂了, 会话照跑)', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      const redis = new FakeRedis();
      redis.failWith = new Error('redis down');
      const { service, set } = buildService(redis);

      await expect(service.recordCircuitOpen(buildInput())).resolves.toBeUndefined();

      // trace 照写 (主产物没丢), 统计失败只打 warn —— 不往上抛
      expect(set).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
