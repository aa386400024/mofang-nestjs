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
//   V2026-11-08 治本 (影子模式统计面板 · 时间窗口扩展):
//     新增覆盖:
//     ① 写入侧: 全局 key 与当日日 key **同时**累加 + 日 key TTL 90 天;
//     ② 日 key 的日期口径 = Asia/Shanghai (UTC+8), 跨天按**结束时间**归天;
//     ③ 读取侧: days / from+to 窗口聚合 (求和 vs 取大 vs 桶累加 vs 分布累加);
//     ④ 不传窗口参数 → 全局累计 (兼容现有行为); 非法参数 → 400;
//     ⑤ `window` 口径字段 (含 daysCovered = 窗口内有日 key 的天数).
//
//   ⚠️ **Lua 脚本本身没有真 Redis 验证** —— 本仓库没有真 Redis 测试基础设施
//     (无 ioredis-mock / 无 testcontainers; BDI 的 CAS 脚本同样未测).
//     本文件的假 Redis **按脚本文档化的语义**实现 (ARGV 编排 + HINCRBYFLOAT + 取大
//     + EXPIRE), 所以这里验证的是 **TS 侧的参数编排 + 聚合口径**, 不是 Lua 语法.
//     Lua 语法由两条护栏兜底: ① 本文件里的"块配平体检"; ② 真 Redis 集成测试
//     (`deliberation-stats-redis.integration.spec.ts`, 需 `TEST_REDIS_URL`, 部署前跑).
//
//   验证: npx vitest run test/admin-debug/deliberation-stats.spec.ts

import { Logger, RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { AdminDebugController } from '../../src/admin-debug/admin-debug.controller.js';
import { AdminRoleGuard } from '../../src/admin-debug/guards/admin-role.guard.js';
import { BizException } from '../../src/common/exceptions/biz.exception.js';
import type { CounselorLlmJsonClient } from '../../src/counselor/providers/llm-json.client.js';
import {
  DELIBERATION_LATENCY_BUCKET_BOUNDS,
  DELIBERATION_STATS_DAILY_TTL_SECONDS,
  DELIBERATION_STATS_KEY_PREFIX,
  DELIBERATION_STATS_LUA_SCRIPT,
  DELIBERATION_STATS_MAX_WINDOW_DAYS,
  aggregateDeliberationStatsHashes,
  applyDeliberationStats,
  buildDeliberationStatsDateKeys,
  buildDeliberationStatsDateKeysBetween,
  buildDeliberationStatsDayKeys,
  buildDeliberationStatsDeltas,
  buildDeliberationStatsKey,
  buildDeliberationStatsResponse,
  parseDeliberationStatsWindow,
  resolveDeliberationStatsDay,
} from '../../src/engine-adapters/deliberation/deliberation-stats.js';
import {
  DELIBERATION_CIRCUIT_OPEN_ERROR_CODE,
  LlmDeliberationService,
  type DeliberationShadowInput,
  type DeliberationTraceRecord,
} from '../../src/engine-adapters/deliberation/llm-deliberation.service.js';
import type { BdiStateRepository } from '../../src/engine-core/index.js';
import type { RedisService } from '../../src/shared/infra/redis/redis.service.js';
import { shanghaiDateKey } from '../../src/shared/time/shanghai-date.js';
import { buildTestStructuredInput } from '../engine-adapters/deliberation-fixtures.js';

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
 * ⚠️ `eval` 是**按脚本文档化的语义**实现的 (两个 key + ARGV 编排 + HINCRBYFLOAT
 *   + 取大 + EXPIRE): 本仓库没有真 Redis 测试基础设施 (无 ioredis-mock / 无
 *   testcontainers), 所以这里验证的是 **TS 侧的参数编排 + 聚合口径**, **不是 Lua 语法**.
 */
class FakeRedis {
  /** 各 key 的 hash 内容. */
  readonly hashes = new Map<string, Record<string, string>>();
  /** 各 key 的 TTL (秒). */
  readonly ttls = new Map<string, number>();
  /** eval 调用记录. */
  readonly evalCalls: {
    readonly script: string;
    readonly numKeys: number;
    readonly keys: string[];
    readonly args: (string | number)[];
  }[] = [];

  /** 让 eval / pipeline 抛错 (测 "统计写失败不炸审议"). */
  failWith: Error | undefined;

  /** 取 (必要时创建) 某个 key 的 hash. */
  ensureHash(key: string): Record<string, string> {
    const existing = this.hashes.get(key);
    if (existing) return existing;
    const created: Record<string, string> = {};
    this.hashes.set(key, created);
    return created;
  }

  getClient(): {
    eval(script: string, numKeys: number, ...rest: (string | number)[]): Promise<number>;
    pipeline(): { hgetall(key: string): unknown; exec(): Promise<[Error | null, unknown][]> };
  } {
    const store = this;
    return {
      eval: async (script, numKeys, ...rest) => {
        store.evalCalls.push({
          script,
          numKeys,
          keys: rest.slice(0, numKeys).map(String),
          args: rest.slice(numKeys),
        });
        if (store.failWith) throw store.failWith;
        applyScriptTo(store, rest.slice(0, numKeys).map(String), rest.slice(numKeys));
        return 1;
      },
      pipeline: () => store.createPipeline(),
    };
  }

  /** 造一个"批量读" pipeline (只支持 hgetall). */
  private createPipeline(): { hgetall(key: string): unknown; exec(): Promise<[Error | null, unknown][]> } {
    const store = this;
    const reads: string[] = [];
    const pipeline = {
      hgetall(key: string): unknown {
        reads.push(key);
        return pipeline;
      },
      async exec(): Promise<[Error | null, unknown][]> {
        if (store.failWith) throw store.failWith;
        return reads.map((key) => [null, { ...store.hashes.get(key) }]);
      },
    };
    return pipeline;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    if (this.failWith) throw this.failWith;
    return { ...this.hashes.get(key) };
  }
}

/**
 * 把 Lua 脚本的语义在 TS 里复刻一遍 (HINCRBYFLOAT 累加 + 取大 + EXPIRE).
 *
 * ⚠️ 这是**假 Redis 的执行器** —— 它按脚本注释里的 ARGV 布局解析参数:
 *   [日 key TTL 秒数, 计数器对数, (字段, 增量) × n, 取大对数, (字段, 值) × m].
 */
function applyScriptTo(redis: FakeRedis, keys: string[], argv: readonly (string | number)[]): void {
  let i = 0;
  const ttl = Number(argv[i++]);
  const counterCount = Number(argv[i++]);
  const counters: [string, number][] = [];
  for (let k = 0; k < counterCount; k++) {
    counters.push([String(argv[i++]), Number(argv[i++])]);
  }
  const maxCount = Number(argv[i++]);
  const maxima: [string, number][] = [];
  for (let k = 0; k < maxCount; k++) {
    maxima.push([String(argv[i++]), Number(argv[i++])]);
  }

  for (const key of keys) {
    const hash = redis.ensureHash(key);
    for (const [field, delta] of counters) {
      hash[field] = String(Number(hash[field] ?? 0) + delta);
    }
    for (const [field, value] of maxima) {
      const current = hash[field] === undefined ? undefined : Number(hash[field]);
      if (current === undefined || current < value) hash[field] = String(value);
    }
  }

  // EXPIRE 只作用在**日 key** (脚本里 KEYS[2]).
  redis.ttls.set(keys[1], Math.floor(ttl));
}

/** 把 ARGV 拆回 TTL / 计数器 / 取大三张表 (按脚本文档化的布局). */
function parseArgs(argv: readonly (string | number)[]): {
  ttl: number;
  counters: Record<string, number>;
  maxima: Record<string, number>;
} {
  let i = 0;
  const ttl = Number(argv[i++]);
  const counters: Record<string, number> = {};
  const maxima: Record<string, number> = {};
  const counterCount = Number(argv[i++]);
  for (let k = 0; k < counterCount; k++) {
    counters[String(argv[i++])] = Number(argv[i++]);
  }
  const maxCount = Number(argv[i++]);
  for (let k = 0; k < maxCount; k++) {
    maxima[String(argv[i++])] = Number(argv[i++]);
  }
  return { ttl, counters, maxima };
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
    // ⚠️ **不写死任何日期** (V2026-11-08 治本): 原来写死 '2026-11-07T00:00:00.000Z',
    //   断言却按 `todayKey()` (墙上时钟) 取"今天" —— 交付当天恰好是 11-07 所以绿,
    //   跨过零点后**永久红** (夹具吃绝对日期, 不是环境问题).
    //   现在时间戳跟"当下"走, 断言一律从 `record.timestamp` 推导 (见下方用例) → 与时钟无关.
    timestamp: new Date().toISOString(),
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
    // WP-A: 结构化输入 (零对话原文) —— 走真实的装配函数.
    structured: buildTestStructuredInput({
      counselorText: '你最近睡得怎么样?',
      visitorText: '有点累, 夜里老醒.',
      characterBrief: '依恋风格: 回避型',
      ruleStrategy: 'simple_response',
    }),
    ruleDelta: ZERO_DELTA,
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

/** 今天的上海日期键 (测试里跟"现在"对齐, 免得测试自己算日期算错). */
function todayKey(): string {
  return shanghaiDateKey(new Date());
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

      const hash = redis.ensureHash(buildDeliberationStatsKey());
      expect(hash['total_turns']).toBe('1');
      expect(hash['success_turns']).toBe('1');
      expect(hash['failure_turns']).toBeUndefined();
      expect(hash['total_duration_ms']).toBe('1200');
      expect(hash['max_duration_ms']).toBe('1200');
      expect(hash['total_retry_count']).toBe('2');
      expect(hash['total_prompt_tokens']).toBe('100');
      expect(hash['total_completion_tokens']).toBe('50');
      expect(hash['stale_turns']).toBe('1');
      // deltaDiff 绝对值之和 = 0.25 + 0.5 + 0.125 = 0.875 (逐维取绝对值后**求和**)
      expect(hash['sum_delta_diff_abs']).toBe('0.875');
      expect(hash['max_delta_diff_abs']).toBe('0.5');
      expect(hash['cap_trust']).toBe('1');
      expect(hash['clinical_alliance_positive_spike']).toBe('1');
      expect(hash['flagged_turns']).toBe('1');
      // 延迟桶: 1200ms 落在 [1000, 1500) → 第 7 个桶 (上界 1500)
      expect(hash['latency_b7']).toBe('1');
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

      const hash = redis.ensureHash(buildDeliberationStatsKey());
      expect(hash['total_turns']).toBe('1');
      expect(hash['failure_turns']).toBe('1');
      expect(hash['success_turns']).toBeUndefined();
      // ⚠️ 失败轮次**也有**耗时 / 重试 —— 一并累加 (平均值的分母是总轮次).
      //   (任务单 §4.3 的失败清单漏了这两项, 照抄会让分子分母对不上.)
      expect(hash['total_duration_ms']).toBe('120');
      expect(hash['total_retry_count']).toBe('1');
      // 失败轮次没有 deltaDiff / 砍幅 / 临床标记 / 过期的语义 —— 一个都不记
      expect(hash['sum_delta_diff_abs']).toBeUndefined();
      expect(hash['max_delta_diff_abs']).toBeUndefined();
      expect(hash['stale_turns']).toBeUndefined();
      expect(hash['flagged_turns']).toBeUndefined();
      expect(hash['cap_trust']).toBeUndefined();
      expect(hash['clinical_alliance_positive_spike']).toBeUndefined();
      // 失败原因分布 (答 "失败的主要原因是什么")
      expect(hash['error_json_parse_failed']).toBe('1');
      // 延迟桶: 120ms 落在 [100, 200) → 第 2 个桶 (上界 200)
      expect(hash['latency_b2']).toBe('1');
    });

    it('取大字段: 后一轮的更小值不会覆盖前一轮的最大值', async () => {
      const redis = new FakeRedis();

      await applyDeliberationStats(redis as unknown as RedisService, buildRecord({ durationMs: 1200 }));
      await applyDeliberationStats(redis as unknown as RedisService, buildRecord({ durationMs: 100 }));

      expect(redis.ensureHash(buildDeliberationStatsKey())['max_duration_ms']).toBe('1200');
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
      // ⚠️ **两个 key**: 全局累计 + 当日日 key (一次脚本原子写完)
      expect(call.numKeys).toBe(2);
      expect(call.keys[0]).toBe(buildDeliberationStatsKey());
      expect(call.keys[1]).toMatch(/^deliberation_stats:global:\d{4}-\d{2}-\d{2}$/);
      const { ttl, counters, maxima } = parseArgs(call.args);
      expect(ttl).toBe(DELIBERATION_STATS_DAILY_TTL_SECONDS);
      expect(Object.keys(counters)).toHaveLength(12);
      expect(counters['total_turns']).toBe(1);
      expect(counters['success_turns']).toBe(1);
      expect(counters['total_duration_ms']).toBe(1200);
      expect(counters['total_retry_count']).toBe(2);
      expect(counters['stale_turns']).toBe(1);
      expect(counters['sum_delta_diff_abs']).toBe(0.875);
      expect(counters['cap_trust']).toBe(1);
      expect(counters['clinical_alliance_positive_spike']).toBe(1);
      expect(counters['flagged_turns']).toBe(1);
      // 取大字段**不进**计数器表 (两者在脚本里走的是两段不同的循环)
      expect(counters['max_duration_ms']).toBeUndefined();
      expect(maxima['max_duration_ms']).toBe(1200);
      expect(maxima['max_delta_diff_abs']).toBe(0.5);
    });

    it('脚本形状与假实现同源 (改了 Lua 的 ARGV 布局, 这条会红)', () => {
      const script = DELIBERATION_STATS_LUA_SCRIPT;

      expect(script).toContain("redis.call('HINCRBYFLOAT', key, pair[1], pair[2])");
      expect(script).toContain("redis.call('HGET', key, pair[1])");
      expect(script).toContain("redis.call('HSET', key, pair[1], pair[2])");
      // 日 key 的 TTL 由脚本设置 (90 天)
      expect(script).toContain("redis.call('EXPIRE', dailyKey, math.floor(dailyTtl))");
      // 两个 key 都参与累加
      expect(script).toContain('for _, key in ipairs({ globalKey, dailyKey }) do');
    });

    it('Lua 块结构体检: do/end、if/end、for/end 配平 (少一个 end 就红)', () => {
      const script = DELIBERATION_STATS_LUA_SCRIPT;
      // 去掉字符串字面量 (脚本里没有多行字符串, 但引号里的内容不能当关键字数)
      const code = script.replaceAll(/'[^']*'/g, "''");

      const opens = code
        .split('\n')
        .filter((line) => !/^\s*(--)/.test(line))
        .reduce((count, line) => {
          const hasBlock = /\b(function|if|for|while)\b/.test(line);
          // `for ... do` / `while ... do` 的 do 属于块头, 不能重复计数
          const hasStandaloneDo = /\bdo\b/.test(line) && !/\b(for|while)\b/.test(line);
          return count + (hasBlock ? 1 : 0) + (hasStandaloneDo ? 1 : 0);
        }, 0);
      const ends = (code.match(/\bend\b/g) ?? []).length;

      expect(ends).toBe(opens);
      // 括号配平 (脚本里没有字符串里的括号 —— 上一步已把字面量替换掉)
      expect(code.match(/\(/g) ?? []).toHaveLength((code.match(/\)/g) ?? []).length);
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
      expect(first.counters['total_turns']).toBe(1);
      expect(first.maxima['max_duration_ms']).toBe(1200);
    });
  });

  describe('② 写入侧 · 日 key (时间窗口扩展)', () => {
    it('全局 key 与当日日 key **同时**累加 (一次脚本, 两个 key)', async () => {
      const redis = new FakeRedis();

      const record = buildRecord({ durationMs: 300 });

      await applyDeliberationStats(redis as unknown as RedisService, record);

      const globalHash = redis.ensureHash(buildDeliberationStatsKey());
      // ⚠️ 日 key 从**这条记录自己的 timestamp** 推导 —— 断言不跟墙上时钟走
      //   (写入侧与断言侧必须同源, 否则跨零点就分家)
      const dailyKey = `${buildDeliberationStatsKey()}:${resolveDeliberationStatsDay(record.timestamp)}`;
      const dailyHash = redis.ensureHash(dailyKey);
      expect(dailyHash['total_turns']).toBe('1');
      expect(dailyHash['success_turns']).toBe('1');
      expect(dailyHash['total_duration_ms']).toBe('300');
      expect(dailyHash['max_duration_ms']).toBe('300');
      expect(globalHash['total_turns']).toBe('1');
    });

    it('日 key 的 TTL = 90 天 (保留期)', async () => {
      const redis = new FakeRedis();

      const record = buildRecord();

      await applyDeliberationStats(redis as unknown as RedisService, record);

      // ⚠️ 同上: 日 key 从记录自己的 timestamp 推导 (不取墙上时钟)
      const dailyKey = `${buildDeliberationStatsKey()}:${resolveDeliberationStatsDay(record.timestamp)}`;
      expect(redis.ttls.get(dailyKey)).toBe(DELIBERATION_STATS_DAILY_TTL_SECONDS);
      expect(DELIBERATION_STATS_DAILY_TTL_SECONDS).toBe(90 * 24 * 60 * 60);
      // 全局 key **不设 TTL** —— 累计值要一直留着
      expect(redis.ttls.get(buildDeliberationStatsKey())).toBeUndefined();
    });

    it('日期口径 = Asia/Shanghai (UTC+8): 北京时间 08:00 前算前一天', () => {
      // 2026-11-07T16:30Z = 上海 2026-11-08 00:30 → 落进 11-08
      expect(resolveDeliberationStatsDay('2026-11-07T16:30:00.000Z')).toBe('2026-11-08');
      // 2026-11-07T15:59Z = 上海 2026-11-07 23:59 → 落进 11-07
      expect(resolveDeliberationStatsDay('2026-11-07T15:59:59.000Z')).toBe('2026-11-07');
    });

    it('跨天会话按**结束时间**归天 (23:50 → 00:10 落进第二天)', async () => {
      const redis = new FakeRedis();
      // 会话从上海 23:50 开始, 结束于次日 00:10
      const record = buildRecord({ timestamp: '2026-11-07T16:10:00.000Z' });

      await applyDeliberationStats(redis as unknown as RedisService, record);

      const dailyKey = 'deliberation_stats:global:2026-11-08';
      expect(redis.ensureHash(dailyKey)['total_turns']).toBe('1');
      expect(redis.hashes.get('deliberation_stats:global:2026-11-07')).toBeUndefined();
    });

    it('坏时间戳不炸统计 (落进当前这一天)', () => {
      expect(resolveDeliberationStatsDay('not-a-date')).toBe(todayKey());
      expect(resolveDeliberationStatsDay(void 0)).toBe(todayKey());
    });
  });

  describe('③ 读取侧 (闸门 7-10)', () => {
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
        // WP-A: 被合规闸门拦下的轮次 (高风险轮次压根没跑 LLM 审议) —— 看板要能减掉它.
        'riskSkippedTurns',
        'staleRate',
        'successRate',
        'successTurns',
        'totalTurns',
        // V2026-11-08: 窗口口径 (仓库纪律: 口径要写在数据里, 不能只靠看文档的人记得)
        'window',
      ]);
    });

    it('成功率 = success_turns / total_turns, 计算正确', async () => {
      const redis = new FakeRedis();
      for (let i = 0; i < 3; i++) {
        await applyDeliberationStats(redis as unknown as RedisService, buildRecord({ durationMs: 100 + i }));
      }
      await applyDeliberationStats(redis as unknown as RedisService, buildRecord({ ok: false, errorCode: 'http_401', durationMs: 100 }));

      const response = buildDeliberationStatsResponse(await redis.hgetall(buildDeliberationStatsKey()));

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

      const response = buildDeliberationStatsResponse(await redis.hgetall(buildDeliberationStatsKey()));

      expect(response.avgDurationMs).toBe(250);
      expect(response.maxDurationMs).toBe(400);
    });

    it('空数据不崩: 全 0 而不是 NaN', () => {
      const response = buildDeliberationStatsResponse({});

      for (const value of Object.values(response)) {
        if (typeof value === 'number') expect(Number.isNaN(value)).toBe(false);
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

      const response = buildDeliberationStatsResponse(await redis.hgetall(buildDeliberationStatsKey()));

      expect(response.totalTurns).toBe(20);
      expect(response.p50DurationMs).toBe(DELIBERATION_LATENCY_BUCKET_BOUNDS[2]);
      expect(response.p95DurationMs).toBe(DELIBERATION_LATENCY_BUCKET_BOUNDS[7]);
    });

    it('失败原因分布: 按错误码聚合 (答 "失败的主要原因是什么")', async () => {
      const redis = new FakeRedis();
      await applyDeliberationStats(redis as unknown as RedisService, buildRecord({ ok: false, errorCode: 'json_parse_failed' }));
      await applyDeliberationStats(redis as unknown as RedisService, buildRecord({ ok: false, errorCode: 'json_parse_failed' }));
      await applyDeliberationStats(redis as unknown as RedisService, buildRecord({ ok: false, errorCode: 'http_429' }));

      const response = buildDeliberationStatsResponse(await redis.hgetall(buildDeliberationStatsKey()));

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

      const response = buildDeliberationStatsResponse(await redis.hgetall(buildDeliberationStatsKey()));

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

      const response = buildDeliberationStatsResponse(await redis.hgetall(buildDeliberationStatsKey()));

      expect(response.avgRetryCount).toBe(3);
      expect(response.avgPromptTokens).toBe(50);
      expect(response.avgCompletionTokens).toBe(25);
      // 过期率 = staleTurns / successTurns (失败轮次没有 "过期" 这个概念)
      expect(response.staleRate).toBe(1);
      expect(response.flaggedTurnRate).toBe(0);
    });
  });

  describe('④ 时间窗口聚合 (时间窗口扩展)', () => {
    it('多日聚合: 计数器求和, 取大字段取最大, 桶累加, 分布累加', () => {
      const merged = aggregateDeliberationStatsHashes([
        { total_turns: '3', success_turns: '2', total_duration_ms: '600', max_duration_ms: '300', latency_b2: '2', error_http_429: '1' },
        {
          total_turns: '4',
          success_turns: '4',
          total_duration_ms: '1000',
          max_duration_ms: '150',
          latency_b2: '1',
          latency_b7: '2',
          error_http_429: '2',
        },
      ]);

      expect(merged['total_turns']).toBe('7');
      expect(merged['success_turns']).toBe('6');
      expect(merged['total_duration_ms']).toBe('1600');
      // ⚠️ 取大字段**取最大值**, 不是求和 (求和 = "最慢的那轮" + "别的轮次", 语义就错了)
      expect(merged['max_duration_ms']).toBe('300');
      // 延迟桶逐桶累加
      expect(merged['latency_b2']).toBe('3');
      expect(merged['latency_b7']).toBe('2');
      // 分布按 key 累加
      expect(merged['error_http_429']).toBe('3');
    });

    it('多日聚合后比率仍然自洽 (分母口径不变)', () => {
      const merged = aggregateDeliberationStatsHashes([
        { total_turns: '10', success_turns: '9', stale_turns: '1', total_duration_ms: '1000' },
        { total_turns: '10', success_turns: '8', stale_turns: '2', total_duration_ms: '3000' },
      ]);

      const response = buildDeliberationStatsResponse(merged);

      expect(response.totalTurns).toBe(20);
      expect(response.successTurns).toBe(17);
      expect(response.successRate).toBeCloseTo(0.85, 10);
      expect(response.avgDurationMs).toBe(200);
      expect(response.staleRate).toBeCloseTo(3 / 17, 10);
    });

    it('浮点求和不留小数尾巴 (与单日直接累加一致)', () => {
      const merged = aggregateDeliberationStatsHashes([{ sum_delta_diff_abs: '0.1' }, { sum_delta_diff_abs: '0.2' }]);

      expect(merged['sum_delta_diff_abs']).toBe('0.3');
    });

    it('最近 N 天的日期键: 含今天, 升序, 上海日界', () => {
      const now = new Date('2026-11-08T03:00:00.000Z'); // 上海 2026-11-08 11:00
      const dateKeys = buildDeliberationStatsDateKeys(3, now);

      expect(dateKeys).toEqual(['2026-11-06', '2026-11-07', '2026-11-08']);
      expect(buildDeliberationStatsDayKeys(dateKeys)).toEqual([
        'deliberation_stats:global:2026-11-06',
        'deliberation_stats:global:2026-11-07',
        'deliberation_stats:global:2026-11-08',
      ]);
    });

    it('自定义区间: 闭区间, 升序', () => {
      expect(buildDeliberationStatsDateKeysBetween('2026-11-01', '2026-11-03')).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    });

    it('窗口参数解析: 不传 = 全局累计 (兼容现有行为)', () => {
      expect(parseDeliberationStatsWindow({})).toEqual({ kind: 'all' });
      expect(parseDeliberationStatsWindow({ days: '' })).toEqual({ kind: 'all' });
      expect(parseDeliberationStatsWindow({ days: '7' })).toEqual({ kind: 'days', days: 7 });
    });

    it('窗口参数解析: days 超过 90 天按上限截断 (实际生效值写进 window)', () => {
      expect(parseDeliberationStatsWindow({ days: '365' })).toEqual({
        kind: 'days',
        days: DELIBERATION_STATS_MAX_WINDOW_DAYS,
      });
    });

    it('窗口参数解析: 非法参数抛错 (不静默兜底成全局累计)', () => {
      expect(() => parseDeliberationStatsWindow({ days: 'abc' })).toThrow(/days 参数不合法/);
      expect(() => parseDeliberationStatsWindow({ days: '0' })).toThrow(/days 参数不合法/);
      expect(() => parseDeliberationStatsWindow({ days: '-1' })).toThrow(/days 参数不合法/);
      expect(() => parseDeliberationStatsWindow({ from: '2026-11-01' })).toThrow(/必须成对传/);
      expect(() => parseDeliberationStatsWindow({ from: '2026-11-01', to: '2026-11-02' })).not.toThrow();
      expect(() => parseDeliberationStatsWindow({ from: '2026-13-01', to: '2026-11-02' })).toThrow(/格式不合法/);
      expect(() => parseDeliberationStatsWindow({ from: '2026-02-30', to: '2026-11-02' })).toThrow(/格式不合法/);
      expect(() => parseDeliberationStatsWindow({ from: '2026-11-05', to: '2026-11-01' })).toThrow(/from 不能晚于 to/);
      expect(() => parseDeliberationStatsWindow({ from: '2026-01-01', to: '2026-11-02' })).toThrow(/最长/);
      expect(() => parseDeliberationStatsWindow({ days: '7', from: '2026-11-01', to: '2026-11-02' })).toThrow(/不能同时传/);
    });
  });

  describe('⑤ 端点接线 · 窗口', () => {
    it('不传窗口参数 → 返回全局累计值 (与改造前行为一致)', async () => {
      const redis = new FakeRedis();
      const controller = buildController(redis);
      await applyDeliberationStats(redis as unknown as RedisService, buildRecord({ durationMs: 500 }));

      const response = await controller.deliberationStats();

      expect(response.totalTurns).toBe(1);
      expect(response.avgDurationMs).toBe(500);
      expect(response.window.mode).toBe('all');
      expect(response.window.days).toBeNull();
      expect(response.window.daysCovered).toBeNull();
    });

    it('days=7 → 聚合最近 7 天的日 key', async () => {
      const redis = new FakeRedis();
      const controller = buildController(redis);
      // 往"今天"与"昨天"的日 key 各写一次 (全局 key 也被写, 但窗口查询**不看**它)
      // ⚠️ 记录时刻显式取 now; "昨天"按**这条记录自己的日期**往前推一天 ——
      //   两天必然是不同 key (原来"昨天"取墙上时钟, 撞上夹具那一天就会互相覆盖:
      //   夹具写进去的 1 被覆盖成 5 → 期望 6 实得 5)
      const now = new Date();
      const record = buildRecord({ durationMs: 100, timestamp: now.toISOString() });
      await applyDeliberationStats(redis as unknown as RedisService, record);
      const recordDay = resolveDeliberationStatsDay(record.timestamp);
      const yesterday = buildDeliberationStatsDateKeys(2, now)[0];
      // 断言前提: 两天不是同一天 (否则上面那个覆盖问题会复活)
      expect(yesterday).not.toBe(recordDay);
      redis.ensureHash(`deliberation_stats:global:${yesterday}`)['total_turns'] = '5';

      const response = await controller.deliberationStats('7');

      expect(response.totalTurns).toBe(6);
      expect(response.window.mode).toBe('days');
      expect(response.window.days).toBe(7);
      expect(response.window.daysCovered).toBe(2);
      expect(response.window.to).toBe(todayKey());
    });

    it('窗口查询**只看日 key**, 不会把全局累计混进来', async () => {
      const redis = new FakeRedis();
      const controller = buildController(redis);
      // 只写全局 key (模拟"日 key 之前的历史数据"), 窗口查询看不到它
      redis.ensureHash(buildDeliberationStatsKey())['total_turns'] = '999';

      const response = await controller.deliberationStats('7');

      expect(response.totalTurns).toBe(0);
      expect(response.window.daysCovered).toBe(0);
    });

    it('from/to → 自定义区间聚合', async () => {
      const redis = new FakeRedis();
      const controller = buildController(redis);
      const today = todayKey();
      redis.ensureHash(`deliberation_stats:global:${today}`)['total_turns'] = '2';

      const response = await controller.deliberationStats(undefined, today, today);

      expect(response.totalTurns).toBe(2);
      expect(response.window.mode).toBe('range');
      expect(response.window.from).toBe(today);
      expect(response.window.to).toBe(today);
      expect(response.window.daysCovered).toBe(1);
    });

    it('非法窗口参数 → 400 (BizException), 不返回一份"看起来正常"的数', async () => {
      const controller = buildController(new FakeRedis());

      await expect(controller.deliberationStats('abc')).rejects.toThrow(BizException);
      await expect(controller.deliberationStats('0')).rejects.toThrow(BizException);
      // from/to 只给一个端点 → 400
      await expect(controller.deliberationStats(undefined, '2026-11-01')).rejects.toThrow(BizException);
      // 区间超过 90 天 (日 key 保留期) → 400
      await expect(controller.deliberationStats(undefined, '2026-01-01', '2026-11-05')).rejects.toThrow(BizException);
    });

    it('窗口查询的 Redis 读失败直接抛错 (不兜底成 0)', async () => {
      const redis = new FakeRedis();
      redis.failWith = new Error('redis down');
      const controller = buildController(redis);

      await expect(controller.deliberationStats('7')).rejects.toThrow('redis down');
    });
  });

  describe('⑥ 端点接线', () => {
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

  describe('⑦ 写入侧接线 (writeTrace 内)', () => {
    it('审议写 trace 时同步累加计数器 (全局 + 日 key)', async () => {
      const redis = new FakeRedis();
      const { service, set } = buildService(redis);

      await service.recordCircuitOpen(buildInput());

      expect(set).toHaveBeenCalledTimes(1);
      expect(redis.ensureHash(buildDeliberationStatsKey())['total_turns']).toBe('1');
      expect(redis.ensureHash(buildDeliberationStatsKey())['failure_turns']).toBe('1');
      expect(redis.ensureHash(buildDeliberationStatsKey())['error_' + DELIBERATION_CIRCUIT_OPEN_ERROR_CODE]).toBe('1');
      expect(redis.ensureHash(`${buildDeliberationStatsKey()}:${todayKey()}`)['total_turns']).toBe('1');
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
