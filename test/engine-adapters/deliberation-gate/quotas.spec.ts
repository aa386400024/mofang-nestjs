// V2026-11-09 治本 (Phase2.5 WP-C · 触发式审议闸门 · 配额 / 熔断 / 入口链路单测):
//   目的: 把"状态存取"与"入口链路"钉死 —— 冷却记在哪、配额怎么算、熔断怎么开怎么关,
//         以及 Redis 挂掉时闸门**放行**而不是停摆.
//
//   边界: 用假 Redis 替身 (不连真 Redis); 不起 Nest 容器, 不发网络.
//
//   验证: npx vitest run test/engine-adapters/deliberation-gate/

import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { resolveDeliberationGateConfig } from '../../../src/engine-adapters/deliberation-gate/deliberation-gate.config.js';
import {
  DeliberationGateQuotas,
  buildGateCircuitFailCountKey,
  buildGateCircuitOpenUntilKey,
  buildGateGlobalRpmKey,
  buildGateSessionKey,
} from '../../../src/engine-adapters/deliberation-gate/deliberation-gate.quotas.js';
import { DeliberationGateService } from '../../../src/engine-adapters/deliberation-gate/deliberation-gate.service.js';
import { DeliberationGateTrace, buildGateTraceKey } from '../../../src/engine-adapters/deliberation-gate/deliberation-gate.trace.js';
import type { GateInput } from '../../../src/engine-adapters/deliberation-gate/deliberation-gate.types.js';
import { createEmptyBdiSnapshot } from '../../../src/engine-core/domain/bdi-snapshot.js';
import type { RedisService } from '../../../src/shared/infra/redis/redis.service.js';

// TD-10 · T-2: 真实 ioredis 不进 import 阶段 (适配层仍是真实现; 替身口径见 test/helpers/sdk-stubs.ts).
vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../../helpers/sdk-stubs.js');
  return createIoredisStub();
});

const SESSION = 'session-1';

/** 假 Redis (只实现闸门用到的命令). */
class FakeRedis {
  readonly store = new Map<string, string>();
  /** 读失败开关 (模拟 Redis 抖动). */
  failing = false;

  readonly get = vi.fn(async (key: string): Promise<string | null> => {
    if (this.failing) throw new Error('redis down');
    return this.store.get(key) ?? null;
  });

  readonly set = vi.fn(async (key: string, value: string): Promise<void> => {
    if (this.failing) throw new Error('redis down');
    this.store.set(key, value);
  });

  readonly del = vi.fn(async (key: string): Promise<number> => {
    if (this.failing) throw new Error('redis down');
    return this.store.delete(key) ? 1 : 0;
  });

  readonly incr = vi.fn(async (key: string): Promise<number> => {
    if (this.failing) throw new Error('redis down');
    const next = Number(this.store.get(key) ?? '0') + 1;
    this.store.set(key, String(next));
    return next;
  });

  readonly expire = vi.fn(async (): Promise<void> => undefined);

  // V2026-11-09 (闸门 trace 查询接口): 闸门决策现在**三写** —— Redis 热读 + Redis 日计数器
  //   (写时聚合, 走 EVAL) + MySQL 真相源. 这里补上 eval 替身, 让写侧链路在本单里可测.
  /** EVAL 调用记录 (脚本 + key + 参数). */
  readonly evalCalls: unknown[][] = [];

  readonly eval = vi.fn(async (...args: unknown[]): Promise<number> => {
    this.evalCalls.push(args);
    return 1;
  });

  /** 原始 client (只暴露 eval). */
  readonly getClient = vi.fn(() => ({ eval: this.eval }));
}

/** 假配置服务. */
function fakeConfig(values: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string): string | undefined => values[key],
  } as unknown as ConfigService;
}

/**
 * 造一份闸门输入 (缺省 = 第 N 轮 / 低风险 / 常规共情 / 状态没动).
 *
 * @param overrides 要改的字段
 * @returns 闸门输入
 */
function buildInput(overrides: Partial<GateInput> = {}): GateInput {
  const stateBefore = createEmptyBdiSnapshot();
  return {
    sessionId: SESSION,
    turnIndex: 5,
    stateBefore,
    stateAfter: stateBefore,
    events: ['empathy'],
    safety: { riskLevel: 'low' },
    mode: 'effect',
    ...overrides,
  };
}

/**
 * 装一套闸门 (假 Redis + 真实现).
 *
 * @param env env 覆盖
 * @returns 服务 + 假 Redis + 配额器
 */
function buildGate(env: Record<string, string> = {}): {
  readonly service: DeliberationGateService;
  readonly redis: FakeRedis;
  readonly quotas: DeliberationGateQuotas;
} {
  const redis = new FakeRedis();
  const client = redis as unknown as RedisService;
  const quotas = new DeliberationGateQuotas(client);
  const service = new DeliberationGateService({
    config: resolveDeliberationGateConfig(fakeConfig(env)),
    quotas,
    trace: new DeliberationGateTrace(client),
  });
  return { service, redis, quotas };
}

describe('WP-C · 触发式审议闸门 · 配额 / 冷却 / 熔断', () => {
  describe('冷却', () => {
    it('记下跑的轮次, 下次判定读得到', async () => {
      const { quotas } = buildGate();
      await quotas.recordRun(SESSION, 'effect', 3, 1000);
      expect(await quotas.readLastTurn(SESSION, 'effect')).toBe(3);
    });

    it('影子与生效的冷却互不干扰', async () => {
      const { quotas } = buildGate();
      await quotas.recordRun(SESSION, 'effect', 3, 1000);
      expect(await quotas.readLastTurn(SESSION, 'shadow')).toBeNull();
      expect(await quotas.readLastTurn(SESSION, 'effect')).toBe(3);
    });

    it('没跑过 → lastTurn 为 null', async () => {
      const { quotas } = buildGate();
      expect(await quotas.readLastTurn(SESSION, 'effect')).toBeNull();
    });
  });

  describe('会话计数', () => {
    it('跑一次记一次', async () => {
      const { quotas } = buildGate();
      await quotas.recordRun(SESSION, 'effect', 1, 1000);
      await quotas.recordRun(SESSION, 'effect', 5, 2000);
      expect(await quotas.readSessionRunCount(SESSION, 'effect')).toBe(2);
    });

    it('影子与生效的计数互不干扰', async () => {
      const { quotas } = buildGate();
      await quotas.recordRun(SESSION, 'effect', 1, 1000);
      expect(await quotas.readSessionRunCount(SESSION, 'shadow')).toBe(0);
      expect(await quotas.readSessionRunCount(SESSION, 'effect')).toBe(1);
    });
  });

  describe('全局每分钟配额', () => {
    it('生效模式占全局配额', async () => {
      const { quotas } = buildGate();
      await quotas.recordRun(SESSION, 'effect', 1, 1000);
      expect(await quotas.readGlobalRunCount(1000)).toBe(1);
    });

    it('影子模式不占全局配额 (影子不限额)', async () => {
      const { quotas } = buildGate();
      await quotas.recordRun(SESSION, 'shadow', 1, 1000);
      expect(await quotas.readGlobalRunCount(1000)).toBe(0);
    });

    it('换分钟桶 → 计数归零', async () => {
      const { quotas } = buildGate();
      await quotas.recordRun(SESSION, 'effect', 1, 1000);
      expect(await quotas.readGlobalRunCount(120_000)).toBe(0);
    });
  });

  describe('熔断', () => {
    it('连续失败到阈值 → 熔断打开', async () => {
      const { quotas } = buildGate();
      await quotas.recordCircuitFailure(3, 600_000, 1000);
      await quotas.recordCircuitFailure(3, 600_000, 1000);
      expect(await quotas.readCircuitOpen(1000)).toBe(false);
      await quotas.recordCircuitFailure(3, 600_000, 1000);
      expect(await quotas.readCircuitOpen(1000)).toBe(true);
    });

    it('冷却期结束后 → 自动闭合 (半开)', async () => {
      const { quotas } = buildGate();
      for (let i = 0; i < 3; i += 1) await quotas.recordCircuitFailure(3, 600_000, 1000);
      expect(await quotas.readCircuitOpen(1000)).toBe(true);
      expect(await quotas.readCircuitOpen(1000 + 600_001)).toBe(false);
    });

    it('成功一次 → 连续失败计数与截止时间都清掉', async () => {
      const { quotas, redis } = buildGate();
      for (let i = 0; i < 3; i += 1) await quotas.recordCircuitFailure(3, 600_000, 1000);
      await quotas.resetCircuit();
      expect(await quotas.readCircuitOpen(1000)).toBe(false);
      expect(redis.store.has(buildGateCircuitFailCountKey())).toBe(false);
      expect(redis.store.has(buildGateCircuitOpenUntilKey())).toBe(false);
    });
  });

  describe('Redis 抖动 → 放行 (不阻断审议)', () => {
    it('读失败时状态取最宽松缺省', async () => {
      const { quotas, redis } = buildGate();
      redis.failing = true;
      expect(await quotas.readLastTurn(SESSION, 'effect')).toBeNull();
      expect(await quotas.readSessionRunCount(SESSION, 'effect')).toBe(0);
      expect(await quotas.readGlobalRunCount(1000)).toBe(0);
      expect(await quotas.readCircuitOpen(1000)).toBe(false);
    });

    it('写失败不抛 (观察面 / 辅助面挂了就挂了)', async () => {
      const { quotas, redis } = buildGate();
      redis.failing = true;
      await expect(quotas.recordRun(SESSION, 'effect', 1, 1000)).resolves.toBeUndefined();
      await expect(quotas.recordCircuitFailure(3, 600_000, 1000)).resolves.toBeUndefined();
    });
  });

  describe('入口链路 (service)', () => {
    it('首轮 → run, 并记账 (冷却轮次 + 次数)', async () => {
      const { service, quotas } = buildGate();
      const output = await service.evaluate(buildInput({ turnIndex: 1 }));
      expect(output.decision).toBe('run');
      expect(output.reason).toBe('first_turn_baseline');
      expect(await quotas.readLastTurn(SESSION, 'effect')).toBe(1);
      expect(await quotas.readSessionRunCount(SESSION, 'effect')).toBe(1);
    });

    it('跑完之后进入冷却 → skip(cooldown)', async () => {
      const { service } = buildGate();
      await service.evaluate(buildInput({ turnIndex: 1 }));
      const second = await service.evaluate(buildInput({ turnIndex: 2 }));
      expect(second.decision).toBe('skip');
      expect(second.reason).toBe('cooldown');
    });

    it('危机轮次 → skip, 且不记账 (危机轮永不跑 LLM 审议)', async () => {
      const { service, quotas } = buildGate();
      const output = await service.evaluate(buildInput({ turnIndex: 1, safety: { riskLevel: 'high' } }));
      expect(output.decision).toBe('skip');
      expect(output.reason).toBe('crisis_skip');
      expect(await quotas.readSessionRunCount(SESSION, 'effect')).toBe(0);
    });

    it('每次判定都留 trace (决策 + 理由 + 阈值)', async () => {
      const { service, redis } = buildGate();
      await service.evaluate(buildInput({ turnIndex: 1 }));
      const raw = redis.store.get(buildGateTraceKey(SESSION, 1, 'effect'));
      expect(raw).toBeDefined();
      const trace = JSON.parse(raw ?? '{}') as { decision?: string; reason?: string; elapsedMs?: number };
      expect(trace.decision).toBe('run');
      expect(trace.reason).toBe('first_turn_baseline');
      expect(typeof trace.elapsedMs).toBe('number');
    });

    it('闸门自身出故障 → 放行 (run + gate_error), 绝不抛', async () => {
      const service = new DeliberationGateService({
        config: resolveDeliberationGateConfig(fakeConfig()),
        quotas: {
          loadRuntimeState: async () => {
            throw new Error('boom');
          },
        } as unknown as DeliberationGateQuotas,
        trace: new DeliberationGateTrace(new FakeRedis() as unknown as RedisService),
      });
      const output = await service.evaluate(buildInput());
      expect(output.decision).toBe('run');
      expect(output.reason).toBe('gate_error');
    });

    it('影子与生效两条路各自记账 (互不污染)', async () => {
      const { service, quotas } = buildGate();
      await service.evaluate(buildInput({ turnIndex: 1, mode: 'shadow' }));
      expect(await quotas.readLastTurn(SESSION, 'shadow')).toBe(1);
      expect(await quotas.readLastTurn(SESSION, 'effect')).toBeNull();
    });
  });

  describe('Redis key 构造', () => {
    it('会话 key 带长度前缀 + 模式段 (防跨会话撞键)', () => {
      const key = buildGateSessionKey(SESSION, 'effect', 'last_turn');
      expect(key).toBe(`deliberation:gate:${SESSION.length}:${SESSION}:effect:last_turn`);
      expect(buildGateSessionKey(SESSION, 'shadow', 'last_turn')).not.toBe(key);
    });

    it('全局配额 key 按分钟分桶', () => {
      expect(buildGateGlobalRpmKey(12)).toBe('deliberation:gate:global:rpm:12');
    });

    it('trace key 带轮次与模式', () => {
      expect(buildGateTraceKey(SESSION, 7, 'shadow')).toBe(`deliberation:gate:trace:${SESSION.length}:${SESSION}:7:shadow`);
    });
  });
});
