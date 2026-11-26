// AF-526 单测: 自动对练会话租约.
//   覆盖: acquire SET NX / 第二个持有者被拒 / hasActiveLease / owner-safe release /
//         owner-safe refresh / 心跳按间隔续租.
//   全替身: 不连真实 Redis, 不起 Nest 容器.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { PracticeSessionLeaseService, type PracticeLeaseOptions } from '../../src/auto-practice/practice-session-lease.service.js';
import type { RedisService } from '../../src/shared/infra/redis/redis.service.js';

interface FakeRedis {
  readonly store: Map<string, string>;
  readonly service: RedisService;
  readonly setCalls: number;
  readonly evalCalls: number;
}

function makeFakeRedis(prefix = 'mofang:test:'): FakeRedis {
  const store = new Map<string, string>();
  const counters = { setCalls: 0, evalCalls: 0 };

  const client = {
    async set(key: string, value: string, ...args: string[]): Promise<'OK' | null> {
      counters.setCalls += 1;
      const hasNx = args.includes('NX');
      if (hasNx && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    },
    async exists(key: string): Promise<number> {
      return store.has(key) ? 1 : 0;
    },
    async eval(script: string, _numKeys: number, key: string, ...args: string[]): Promise<number> {
      counters.evalCalls += 1;
      const owner = args[0];
      if (store.get(key) !== owner) return 0;
      if (script.includes("'DEL'")) {
        store.delete(key);
        return 1;
      }
      if (script.includes("'EXPIRE'")) {
        return 1;
      }
      return 0;
    },
  };

  const service = {
    getKeyPrefix: () => prefix,
    getBullClient: () => client,
  } as unknown as RedisService;

  return {
    store,
    service,
    get setCalls() {
      return counters.setCalls;
    },
    get evalCalls() {
      return counters.evalCalls;
    },
  };
}

const SHORT_OPTIONS: PracticeLeaseOptions = { ttlSeconds: 30, heartbeatIntervalMs: 1000 };

afterEach(() => {
  vi.useRealTimers();
});

describe('PracticeSessionLeaseService', () => {
  it('acquire 用 SET NX EX 写入带业务前缀的 key', async () => {
    const redis = makeFakeRedis();
    const lease = new PracticeSessionLeaseService(redis.service, SHORT_OPTIONS);

    await expect(lease.acquire('session-a')).resolves.toBe(true);
    expect(redis.store.has('mofang:test:practice:lease:session-a')).toBe(true);
    expect([...redis.store.values()][0]?.length).toBeGreaterThan(8);
  });

  it('同一场次第二个持有者被拒, hasActiveLease 反映真实占用', async () => {
    const redis = makeFakeRedis();
    const first = new PracticeSessionLeaseService(redis.service, SHORT_OPTIONS);
    const second = new PracticeSessionLeaseService(redis.service, SHORT_OPTIONS);

    await expect(first.acquire('session-a')).resolves.toBe(true);
    await expect(second.acquire('session-a')).resolves.toBe(false);
    await expect(second.hasActiveLease('session-a')).resolves.toBe(true);

    await first.release('session-a');
    await expect(second.hasActiveLease('session-a')).resolves.toBe(false);
  });

  it('release 只删自己的租约, 不会删掉别人刚抢到的 key', async () => {
    const redis = makeFakeRedis();
    const first = new PracticeSessionLeaseService(redis.service, SHORT_OPTIONS);
    const second = new PracticeSessionLeaseService(redis.service, SHORT_OPTIONS);

    await first.acquire('session-a');
    // 模拟 first 租约过期后 second 抢到同一场次.
    redis.store.clear();
    await second.acquire('session-a');

    await first.release('session-a');
    await expect(second.hasActiveLease('session-a')).resolves.toBe(true);

    await second.release('session-a');
    await expect(second.hasActiveLease('session-a')).resolves.toBe(false);
  });

  it('refresh 只续自己的租约, 别人刷新返回 false', async () => {
    const redis = makeFakeRedis();
    const first = new PracticeSessionLeaseService(redis.service, SHORT_OPTIONS);
    const second = new PracticeSessionLeaseService(redis.service, SHORT_OPTIONS);

    await first.acquire('session-a');
    await expect(first.refresh('session-a')).resolves.toBe(true);
    await expect(second.refresh('session-a')).resolves.toBe(false);
  });

  it('心跳按配置间隔自动续租, 释放后停止', async () => {
    vi.useFakeTimers();
    const redis = makeFakeRedis();
    const lease = new PracticeSessionLeaseService(redis.service, SHORT_OPTIONS);

    await lease.acquire('session-a');
    const before = redis.evalCalls;
    await vi.advanceTimersByTimeAsync(1000);
    expect(redis.evalCalls).toBeGreaterThan(before);

    await lease.release('session-a');
    const afterRelease = redis.evalCalls;
    await vi.advanceTimersByTimeAsync(2000);
    expect(redis.evalCalls).toBe(afterRelease);
  });
});
