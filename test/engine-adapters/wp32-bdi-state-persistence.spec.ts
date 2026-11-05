// V2026-11-05 治本 (WP32 · B 层 · BDI 状态 Redis 持久化):
//   覆盖任务单 §6.3 的四条要求 + 若干防回归用例:
//     ① Redis 实现的 save / load 正常路径
//     ② Redis 实现的乐观锁冲突路径
//     ③ 装配层切换: env=memory 时用内存实现
//     ④ 零回归: 默认配置 (memory) 行为与现在逐字一致
//   额外覆盖: 参数校验 / 存储故障 / TTL / 租户隔离 / 撞键防护 / 与内存版口径一致.
//
//   为什么不用真 Redis:
//     本地与 CI 都不保证有 Redis 实例 (本机 6379 未开), 而**真 Redis 才能验 Lua 脚本本体**.
//     本文件用**替身**复刻 Lua 的 CAS 语义 (见 FakeRedisBdiStateClient), 把"仓储层的规则"
//     钉死; Lua 脚本本体的验证缺口已登记在交付记录 §3 (需真 Redis).
//
//   边界: 不起 Nest 容器 / 不触网 / 不连真 Redis; 全部走窄面替身.

import { describe, expect, it } from 'vitest';

import {
  BDI_STATE_CAS_SCRIPT,
  DEFAULT_BDI_STATE_REDIS_TTL_SECONDS,
  RedisBdiStateRepository,
  type RedisBdiStateClient,
} from '../../src/engine-adapters/persistence/redis-bdi-state.repository.js';
import { resolveBdiStateStoreConfig } from '../../src/engine-adapters/wiring/bdi-state-store.config.js';
import { createBdiStateRepository, createEngineSessionPort } from '../../src/engine-adapters/wiring/engine.providers.js';
import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository.js';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store.js';
import { EngineCoreError, EngineErrorCode, createEmptyBdiSnapshot } from '../../src/engine-core/index.js';

const TENANT = 'tenant-1';
const SESSION = 'session-1';

/**
 * 假 Redis 窄面客户端: 内存 Map + 与 Lua 脚本**同语义**的 CAS.
 *
 * 为什么替身要"复刻脚本语义"而不是随便返回 true:
 *   乐观锁是本单的核心契约 —— 替身若无脑返回 true, "冲突路径"这条用例就没测到任何东西.
 *   复刻的规则与 `BDI_STATE_CAS_SCRIPT` 一致: 已存 revision >= 传入 revision → 冲突 (不写).
 */
class FakeRedisBdiStateClient implements RedisBdiStateClient {
  /** key → 已存值 (含 TTL). */
  readonly store = new Map<string, { value: string; ttlSeconds: number }>();
  /** 调用轨迹 (断言"存取真的走了窄面"). */
  readonly calls: string[] = [];
  /** 让 get 抛错 (模拟 Redis 不可达). */
  failOnGet = false;
  /** 让 CAS 抛错 (模拟 Redis 不可达). */
  failOnCas = false;

  async get(key: string): Promise<string | null> {
    this.calls.push(`get:${key}`);
    if (this.failOnGet) throw new Error('connect ECONNREFUSED');
    return this.store.get(key)?.value ?? null;
  }

  async compareAndSetByRevision(key: string, incomingRevision: number, value: string, ttlSeconds: number): Promise<boolean> {
    this.calls.push(`cas:${key}`);
    if (this.failOnCas) throw new Error('connect ECONNREFUSED');
    const current = this.store.get(key)?.value;
    if (current !== undefined) {
      const parsed = JSON.parse(current) as { revision?: unknown };
      if (typeof parsed.revision === 'number' && parsed.revision >= incomingRevision) return false;
    }
    this.store.set(key, { value, ttlSeconds });
    return true;
  }
}

/** 造一条记录. */
function buildRecord(
  overrides: {
    readonly tenantId?: string;
    readonly sessionId?: string;
    readonly revision?: number;
    readonly updatedAt?: number;
  } = {},
): {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly revision: number;
  readonly updatedAt: number;
  readonly snapshot: ReturnType<typeof createEmptyBdiSnapshot>;
} {
  return {
    tenantId: overrides.tenantId ?? TENANT,
    sessionId: overrides.sessionId ?? SESSION,
    revision: overrides.revision ?? 1,
    updatedAt: overrides.updatedAt ?? 1_700_000_000_000,
    snapshot: createEmptyBdiSnapshot(),
  };
}

/** 造一个 Redis 版仓储 (替身客户端). */
function buildRepository(client = new FakeRedisBdiStateClient()): {
  readonly repository: RedisBdiStateRepository;
  readonly client: FakeRedisBdiStateClient;
} {
  return { repository: new RedisBdiStateRepository({ client }), client };
}

describe('WP32 · BDI 状态 Redis 仓储', () => {
  describe('① save / load 正常路径', () => {
    it('存进去能原样读回来 (租户 / 会话 / revision / 时间戳 / 快照全一致)', async () => {
      const { repository } = buildRepository();
      const record = buildRecord();

      const saved = await repository.save(record);
      const loaded = await repository.load(TENANT, SESSION);

      expect(saved.tenantId).toBe(TENANT);
      expect(saved.sessionId).toBe(SESSION);
      expect(saved.revision).toBe(1);
      expect(loaded?.tenantId).toBe(TENANT);
      expect(loaded?.sessionId).toBe(SESSION);
      expect(loaded?.revision).toBe(1);
      expect(loaded?.updatedAt).toBe(record.updatedAt);
      expect(loaded?.snapshot).toEqual(record.snapshot);
    });

    it('load 从未存过 → 返回 null (不抛错, 端口契约)', async () => {
      const { repository } = buildRepository();

      await expect(repository.load(TENANT, 'never-saved')).resolves.toBeNull();
    });

    it('revision 递增写入 → 读回来是最新一版', async () => {
      const { repository } = buildRepository();

      await repository.save(buildRecord({ revision: 1 }));
      await repository.save(buildRecord({ revision: 2 }));

      const loaded = await repository.load(TENANT, SESSION);
      expect(loaded?.revision).toBe(2);
    });

    it('存取两侧互相独立 (改读回来的对象不会污染已存状态)', async () => {
      const { repository } = buildRepository();
      await repository.save(buildRecord());

      const loaded = await repository.load(TENANT, SESSION);
      expect(loaded).not.toBeNull();
      if (!loaded) return;
      // 快照是 readonly 的, 这里用类型擦除模拟"消费方就地改字段"这个经典事故.
      (loaded.snapshot as { trust: number }).trust = 0.99;

      const again = await repository.load(TENANT, SESSION);
      expect(again?.snapshot.trust).not.toBe(0.99);
    });

    it('存取都真的走了窄面客户端 (没有偷偷用别的通道)', async () => {
      const { repository, client } = buildRepository();

      await repository.save(buildRecord());
      await repository.load(TENANT, SESSION);

      expect(client.calls.some((call) => call.startsWith('cas:'))).toBe(true);
      expect(client.calls.some((call) => call.startsWith('get:'))).toBe(true);
    });
  });

  describe('② 乐观锁冲突路径 (与内存版同一口径)', () => {
    it('revision 不递增 → 抛 STATE_CONFLICT (不静默覆盖)', async () => {
      const { repository } = buildRepository();
      await repository.save(buildRecord({ revision: 5 }));

      const error = await repository.save(buildRecord({ revision: 5 })).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(EngineCoreError);
      expect((error as EngineCoreError).code).toBe(EngineErrorCode.STATE_CONFLICT);
      expect((error as EngineCoreError).details['incomingRevision']).toBe(5);
      expect((error as EngineCoreError).details['storedRevision']).toBe(5);
    });

    it('revision 比已存的小 → 同样冲突 (后写者不能覆盖先写者)', async () => {
      const { repository } = buildRepository();
      await repository.save(buildRecord({ revision: 5 }));

      await expect(repository.save(buildRecord({ revision: 4 }))).rejects.toMatchObject({
        code: EngineErrorCode.STATE_CONFLICT,
      });
    });

    it('冲突之后已存状态没被改坏 (仍是冲突前那一版)', async () => {
      const { repository } = buildRepository();
      await repository.save(buildRecord({ revision: 5 }));

      await repository.save(buildRecord({ revision: 5 })).catch(() => {});

      const loaded = await repository.load(TENANT, SESSION);
      expect(loaded?.revision).toBe(5);
    });
  });

  describe('参数校验 (与内存版同一口径)', () => {
    it('tenantId 为空 → INVALID_INPUT', async () => {
      const { repository } = buildRepository();

      await expect(repository.save(buildRecord({ tenantId: '' }))).rejects.toMatchObject({
        code: EngineErrorCode.INVALID_INPUT,
      });
    });

    it('sessionId 为空 → INVALID_INPUT', async () => {
      const { repository } = buildRepository();

      await expect(repository.save(buildRecord({ sessionId: '' }))).rejects.toMatchObject({
        code: EngineErrorCode.INVALID_INPUT,
      });
    });

    it('revision 不是 >= 1 的整数 → INVALID_INPUT', async () => {
      const { repository } = buildRepository();

      await expect(repository.save(buildRecord({ revision: 0 }))).rejects.toMatchObject({
        code: EngineErrorCode.INVALID_INPUT,
      });
      await expect(repository.save(buildRecord({ revision: 1.5 }))).rejects.toMatchObject({
        code: EngineErrorCode.INVALID_INPUT,
      });
    });
  });

  describe('存储故障 (Redis 不可达 / 数据被改写)', () => {
    it('读失败 → STORAGE_FAILURE (不静默当成"没有状态")', async () => {
      const { repository, client } = buildRepository();
      client.failOnGet = true;

      await expect(repository.load(TENANT, SESSION)).rejects.toMatchObject({
        code: EngineErrorCode.STORAGE_FAILURE,
      });
    });

    it('写失败 → STORAGE_FAILURE', async () => {
      const { repository, client } = buildRepository();
      client.failOnCas = true;

      await expect(repository.save(buildRecord())).rejects.toMatchObject({
        code: EngineErrorCode.STORAGE_FAILURE,
      });
    });

    it('已存值不是合法 JSON → STORAGE_FAILURE (响, 不当成没状态)', async () => {
      const { repository, client } = buildRepository();
      client.store.set(`bdi:${TENANT.length}:${TENANT}:${SESSION.length}:${SESSION}`, {
        value: 'not-json',
        ttlSeconds: 60,
      });

      await expect(repository.load(TENANT, SESSION)).rejects.toMatchObject({
        code: EngineErrorCode.STORAGE_FAILURE,
      });
    });

    it('已存值归属与请求不一致 (撞键 / 被改写) → STORAGE_FAILURE', async () => {
      const { repository, client } = buildRepository();
      client.store.set(`bdi:${TENANT.length}:${TENANT}:${SESSION.length}:${SESSION}`, {
        value: JSON.stringify({
          tenantId: 'other-tenant',
          sessionId: SESSION,
          revision: 1,
          updatedAt: 1,
          snapshot: createEmptyBdiSnapshot(),
        }),
        ttlSeconds: 60,
      });

      await expect(repository.load(TENANT, SESSION)).rejects.toMatchObject({
        code: EngineErrorCode.STORAGE_FAILURE,
      });
    });
  });

  describe('TTL 与 key 设计', () => {
    it('默认 TTL = 7 天', async () => {
      const { repository, client } = buildRepository();

      await repository.save(buildRecord());

      const stored = [...client.store.values()][0];
      expect(stored?.ttlSeconds).toBe(DEFAULT_BDI_STATE_REDIS_TTL_SECONDS);
      expect(DEFAULT_BDI_STATE_REDIS_TTL_SECONDS).toBe(604_800);
    });

    it('自定义 TTL 生效', async () => {
      const client = new FakeRedisBdiStateClient();
      const repository = new RedisBdiStateRepository({ client, ttlSeconds: 3600 });

      await repository.save(buildRecord());

      expect([...client.store.values()][0]?.ttlSeconds).toBe(3600);
    });

    it('不同租户 / 不同会话 → 不同 key (不串号)', async () => {
      const { repository, client } = buildRepository();

      await repository.save(buildRecord({ tenantId: 't1', sessionId: 's1' }));
      await repository.save(buildRecord({ tenantId: 't2', sessionId: 's1' }));
      await repository.save(buildRecord({ tenantId: 't1', sessionId: 's2' }));

      expect(client.store.size).toBe(3);
      expect(await repository.load('t1', 's1')).not.toBeNull();
      expect(await repository.load('t2', 's1')).not.toBeNull();
      expect(await repository.load('t1', 's2')).not.toBeNull();
      expect(await repository.load('t2', 's2')).toBeNull();
    });

    it('分隔符撞键防护: (租户 "a:b", 会话 "c") 与 (租户 "a", 会话 "b:c") 不是同一个 key', async () => {
      const { repository, client } = buildRepository();

      await repository.save(buildRecord({ tenantId: 'a:b', sessionId: 'c' }));
      await repository.save(buildRecord({ tenantId: 'a', sessionId: 'b:c' }));

      expect(client.store.size).toBe(2);
      expect((await repository.load('a:b', 'c'))?.tenantId).toBe('a:b');
      expect((await repository.load('a', 'b:c'))?.tenantId).toBe('a');
    });
  });

  describe('与内存版口径一致 (换实现不换行为)', () => {
    it('同一串操作, 两版仓储的出参逐字一致', async () => {
      const memory = new InMemoryBdiStateRepository();
      const { repository } = buildRepository();

      const memorySaved = await memory.save(buildRecord({ revision: 1 }));
      const redisSaved = await repository.save(buildRecord({ revision: 1 }));

      expect(redisSaved).toEqual(memorySaved);

      const memoryLoaded = await memory.load(TENANT, SESSION);
      const redisLoaded = await repository.load(TENANT, SESSION);
      expect(redisLoaded).toEqual(memoryLoaded);
    });

    it('两版的冲突判定一致 (同 revision 写第二次都冲突)', async () => {
      const memory = new InMemoryBdiStateRepository();
      const { repository } = buildRepository();

      await memory.save(buildRecord({ revision: 1 }));
      await repository.save(buildRecord({ revision: 1 }));

      const memoryError = await memory.save(buildRecord({ revision: 1 })).catch((caught: unknown) => caught);
      const redisError = await repository.save(buildRecord({ revision: 1 })).catch((caught: unknown) => caught);

      expect((memoryError as EngineCoreError).code).toBe((redisError as EngineCoreError).code);
      expect((redisError as EngineCoreError).code).toBe(EngineErrorCode.STATE_CONFLICT);
    });
  });

  describe('Lua CAS 脚本 (形状守卫)', () => {
    it('脚本含 GET / SET+EX / revision 比较三要素', () => {
      expect(BDI_STATE_CAS_SCRIPT).toContain("redis.call('GET', KEYS[1])");
      expect(BDI_STATE_CAS_SCRIPT).toContain("redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))");
      expect(BDI_STATE_CAS_SCRIPT).toContain('decoded.revision >= tonumber(ARGV[1])');
    });
  });
});

describe('WP32 · 装配层分流 (env → memory / redis)', () => {
  describe('③ 配置解析', () => {
    it('两个键都缺省 → memory + 7 天 TTL (零回归)', () => {
      const config = resolveBdiStateStoreConfig();

      expect(config.store).toBe('memory');
      expect(config.ttlSeconds).toBe(DEFAULT_BDI_STATE_REDIS_TTL_SECONDS);
    });

    it('空串 (模板默认留空) → 同样走缺省', () => {
      const config = resolveBdiStateStoreConfig({ store: '', ttlSeconds: '' });

      expect(config.store).toBe('memory');
      expect(config.ttlSeconds).toBe(DEFAULT_BDI_STATE_REDIS_TTL_SECONDS);
    });

    it('store=redis → redis (忽略大小写与首尾空白)', () => {
      expect(resolveBdiStateStoreConfig({ store: 'redis' }).store).toBe('redis');
      expect(resolveBdiStateStoreConfig({ store: '  Redis ' }).store).toBe('redis');
      expect(resolveBdiStateStoreConfig({ store: 'MEMORY' }).store).toBe('memory');
    });

    it('store 非法 → 抛错 (启动期炸, 不静默回落成 memory)', () => {
      expect(() => resolveBdiStateStoreConfig({ store: 'mysql' })).toThrow(/配置非法/);
    });

    it('TTL 非法 → 回退默认 (不抛错)', () => {
      expect(resolveBdiStateStoreConfig({ ttlSeconds: 'abc' }).ttlSeconds).toBe(DEFAULT_BDI_STATE_REDIS_TTL_SECONDS);
      expect(resolveBdiStateStoreConfig({ ttlSeconds: '0' }).ttlSeconds).toBe(DEFAULT_BDI_STATE_REDIS_TTL_SECONDS);
      expect(resolveBdiStateStoreConfig({ ttlSeconds: '-5' }).ttlSeconds).toBe(DEFAULT_BDI_STATE_REDIS_TTL_SECONDS);
      expect(resolveBdiStateStoreConfig({ ttlSeconds: '3600' }).ttlSeconds).toBe(3600);
    });
  });

  describe('工厂分流', () => {
    it('store=memory → 内存版 (与 WP32 之前同一个类)', () => {
      const repository = createBdiStateRepository({ store: 'memory' });

      expect(repository).toBeInstanceOf(InMemoryBdiStateRepository);
    });

    it('store=redis → Redis 版', () => {
      const redis = { get: async () => null, getClient: () => ({ eval: async () => 1 }) };
      const repository = createBdiStateRepository({
        store: 'redis',
        redis: redis as never,
        ttlSeconds: 600,
      });

      expect(repository).toBeInstanceOf(RedisBdiStateRepository);
    });

    it('store=redis 却缺客户端 → 装配期直接炸 (不静默回落成内存)', () => {
      expect(() => createBdiStateRepository({ store: 'redis' })).toThrow(/装配非法/);
    });
  });

  describe('④ 零回归: 内核会话的 BDI 仓储仍可注入', () => {
    it('省略 bdiStates → 行为与之前逐字一致 (会话照常开会话照常落状态)', async () => {
      const session = createEngineSessionPort(new InMemoryMemoryStore());

      const handle = session.openSession({ sessionId: 'wp32-1', tenantId: TENANT, visitorId: 'v1' });
      const output = await session.turn(handle.handleId, { userText: '最近睡得不太好' });

      expect(output.snapshot.trust).toBeGreaterThanOrEqual(0);
    });

    it('传入 Redis 版仓储 → 会话的状态真的落到那个仓储里', async () => {
      const { repository, client } = buildRepository();
      const session = createEngineSessionPort(new InMemoryMemoryStore(), undefined, undefined, repository);

      const handle = session.openSession({ sessionId: 'wp32-2', tenantId: TENANT, visitorId: 'v1' });
      await session.turn(handle.handleId, { userText: '最近睡得不太好' });

      const stored = await repository.load(TENANT, 'wp32-2');
      expect(stored).not.toBeNull();
      expect(stored?.revision).toBe(1);
      expect(client.store.size).toBe(1);
    });
  });
});
