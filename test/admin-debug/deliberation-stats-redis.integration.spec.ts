// V2026-11-08 治本 (影子模式统计面板 · 时间窗口扩展):
//   **真 Redis 集成验证** —— Lua 脚本的语法与语义, 只有真 Redis 能验.
//
//   ⚠️ 本仓库**没有**真 Redis 测试基础设施 (无 ioredis-mock / 无 testcontainers),
//     所以常规单测只能验"TS 侧的参数编排", 验不了 Lua 本身.
//     任务单 §5.2 明确要求: "这次改脚本要注意脚本语法正确性, 部署前在 dev 环境跑一轮
//     真 Redis 验证" —— 这一份就是那一轮的可重复版本.
//
//   怎么跑 (dev 环境):
//     # PowerShell
//     $env:TEST_REDIS_URL = "redis://127.0.0.1:6379/15"
//     npx vitest run test/admin-debug/deliberation-stats-redis.integration.spec.ts
//
//   ⚠️ **没设 TEST_REDIS_URL 就整份跳过** —— CI 不连 Redis, 也不该连.
//   ⚠️ 用的是 **db 15** 之类的临时库 + 每次跑随机 key 前缀, 跑完自动删 —— 不碰生产数据.
//
//   验证:
//     1. 脚本语法正确 (Redis 会编译脚本, 语法错直接报错)
//     2. 两个 key 同时累加
//     3. 取大字段不被小值覆盖
//     4. 日 key 的 TTL 被设置, 全局 key 不设 TTL
//     5. **ioredis 的 keyPrefix 对 EVAL 的 key 也生效** —— 写入与读取命中同一个 key
//        (这条是读写两侧口径一致的前提; 读侧走 HGETALL, 写侧走 EVAL)

import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DELIBERATION_STATS_DAILY_TTL_SECONDS,
  DELIBERATION_STATS_LUA_SCRIPT,
} from '../../src/engine-adapters/deliberation/deliberation-stats.js';

const TEST_REDIS_URL = process.env['TEST_REDIS_URL'];

/** 每次跑用随机前缀 —— 互不干扰, 也不碰任何真实 key. */
const RUN_ID = `itest_${Date.now()}_${randomUUID().slice(0, 8)}`;
const GLOBAL_KEY = `deliberation_stats:itest:global:${RUN_ID}`;
const DAILY_KEY = `deliberation_stats:itest:daily:${RUN_ID}`;

/** 按脚本文档化的 ARGV 布局拼参数: [TTL, 计数器对数, (字段, 增量)…, 取大对数, (字段, 值)…]. */
function buildArgs(): (string | number)[] {
  return [DELIBERATION_STATS_DAILY_TTL_SECONDS, 2, 'total_turns', 1, 'total_duration_ms', 1200, 1, 'max_duration_ms', 1200];
}

describe.skipIf(!TEST_REDIS_URL)('审议统计 · Lua 脚本 · 真 Redis 集成验证', () => {
  let redis: Redis;

  beforeAll(async () => {
    redis = new Redis(TEST_REDIS_URL!, { maxRetriesPerRequest: 3 });
    await redis.ping();
  });

  afterAll(async () => {
    if (!redis) return;
    await redis.del(GLOBAL_KEY, DAILY_KEY);
    await redis.quit();
  });

  it('脚本语法正确 + 两个 key 同时累加 + 日 key TTL 生效', async () => {
    await redis.eval(DELIBERATION_STATS_LUA_SCRIPT, 2, GLOBAL_KEY, DAILY_KEY, ...buildArgs());

    const globalHash = await redis.hgetall(GLOBAL_KEY);
    const dailyHash = await redis.hgetall(DAILY_KEY);

    expect(globalHash).toMatchObject({ total_turns: '1', total_duration_ms: '1200', max_duration_ms: '1200' });
    expect(dailyHash).toMatchObject({ total_turns: '1', total_duration_ms: '1200', max_duration_ms: '1200' });

    // 日 key 有 TTL (允许几秒的执行耗时), 全局 key **不设** TTL
    const dailyTtl = await redis.ttl(DAILY_KEY);
    expect(dailyTtl).toBeGreaterThan(DELIBERATION_STATS_DAILY_TTL_SECONDS - 60);
    expect(dailyTtl).toBeLessThanOrEqual(DELIBERATION_STATS_DAILY_TTL_SECONDS);
    expect(await redis.ttl(GLOBAL_KEY)).toBe(-1);
  });

  it('取大字段: 后一轮的更小值不会覆盖前一轮的最大值', async () => {
    const args = buildArgs();
    // 把 max 的候选值改小 (1200 → 100), 其余不变
    const maxIndex = args.indexOf('max_duration_ms') + 1;
    args[maxIndex] = 100;

    await redis.eval(DELIBERATION_STATS_LUA_SCRIPT, 2, GLOBAL_KEY, DAILY_KEY, ...args);

    const globalHash = await redis.hgetall(GLOBAL_KEY);
    const dailyHash = await redis.hgetall(DAILY_KEY);

    expect(globalHash['max_duration_ms']).toBe('1200');
    expect(dailyHash['max_duration_ms']).toBe('1200');
    // 计数器照常累加 (取大与累加是两条独立的路)
    expect(globalHash['total_turns']).toBe('2');
    expect(dailyHash['total_turns']).toBe('2');
  });

  it('浮点增量: HINCRBYFLOAT 存出来的形态与整数增量一致 (不补 ".0")', async () => {
    const floatKey = `${DAILY_KEY}:float`;
    await redis.eval(
      DELIBERATION_STATS_LUA_SCRIPT,
      2,
      GLOBAL_KEY,
      floatKey,
      DELIBERATION_STATS_DAILY_TTL_SECONDS,
      2,
      'total_turns',
      1,
      'sum_delta_diff_abs',
      0.875,
      0,
    );

    const hash = await redis.hgetall(floatKey);
    expect(hash['total_turns']).toBe('1');
    expect(hash['sum_delta_diff_abs']).toBe('0.875');

    await redis.del(floatKey);
  });

  it('ioredis 的 keyPrefix 对 EVAL 的 key 也生效 (写入与读取命中同一个 key)', async () => {
    const prefix = `${RUN_ID}:prefixed:`;
    const prefixed = new Redis(TEST_REDIS_URL!, { keyPrefix: prefix, maxRetriesPerRequest: 3 });
    const raw = new Redis(TEST_REDIS_URL!, { maxRetriesPerRequest: 3 });
    try {
      const logicalGlobal = 'deliberation_stats:global';
      const logicalDaily = 'deliberation_stats:global:2026-11-08';

      await prefixed.eval(DELIBERATION_STATS_LUA_SCRIPT, 2, logicalGlobal, logicalDaily, ...buildArgs());

      // 走同一个带前缀的连接读 → 读得到 (说明 EVAL 写的就是 HGETALL 读的那个 key)
      expect(await prefixed.hgetall(logicalDaily)).toMatchObject({ total_turns: '1' });

      // 用**不带前缀**的连接读物理 key → 证明前缀真的加上了
      const physical = await raw.hgetall(`${prefix}${logicalDaily}`);
      expect(physical).toMatchObject({ total_turns: '1' });

      await raw.del(`${prefix}${logicalGlobal}`, `${prefix}${logicalDaily}`);
    } finally {
      await prefixed.quit();
      await raw.quit();
    }
  });
});
