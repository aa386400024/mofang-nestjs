// V2026-11-05 治本 (WP67 · B 层 · 审议熔断与降级策略):
//   覆盖任务单 §5 的 17 条 + 若干防漂移用例:
//     ① 熔断状态判断 (4 例) —— 三态纯函数
//     ② 入队判断 (3 例) —— closed 入队 / open 不入队 + 写 trace / half-open 入队并消费机会
//     ③ 状态更新 (4 例) —— 成功清零 / 失败累加 / 首次熔断记 openedAt / 熔断中保留 openedAt
//     ④ 配置 (3 例) —— 阈值与冷却默认值 / 非法值回退
//     ⑤ 边界 (3 例) —— 开关关闭不跑熔断 / key 撞键防护 / 内核零改动
//   额外覆盖 (防漂移):
//     · 值得重试的失败 → 记失败**并原样抛出** (BullMQ 才能重试);
//     · 不值得重试的失败 → 记失败**不抛**;
//     · `skipped` (开关关掉没跑) → **不动**熔断状态 (没烧钱);
//     · 半开失败 → **重置**冷却时间 (不留原来的 openedAt);
//     · 熔断状态的 TTL = 冷却时长的 2 倍 (单位: 秒);
//     · 编排门面零改动.
//
//   ⚠️ 关于"成败怎么传给 processor" (与任务单的出入, 见交付记录 §2.1):
//     WP66 之后, 非重试类失败 (fetch_error / http_401) 是被 service **吞掉**的 ——
//     只看"有没有抛异常"分不清成功与失败, 熔断对最常见的"LLM 挂了"永远不触发.
//     所以 WP67 起 `executeShadowMode` **返回结局**, processor 据此记账.
//
//   边界: 全 mock, 不起 Nest 容器, 不发网络, 不连 Redis ——
//     bullmq (Queue/Worker) / RedisService / LLM service / ConfigService 全是极小替身.
//
//   验证: npx vitest run test/engine-adapters/wp67-deliberation-circuit-breaker.spec.ts

import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildTestStructuredInput } from './deliberation-fixtures.js';
import type { DeliberationOutput } from '../../src/engine-adapters/deliberation/deliberation-types.js';
import {
  DEFAULT_DELIBERATION_COOLDOWN_MS,
  DEFAULT_DELIBERATION_FAILURE_THRESHOLD,
  DELIBERATION_JOB_NAME,
  DeliberationProcessor,
  buildDeliberationCircuitKey,
  resolveCircuitStatus,
  type DeliberationCircuitState,
} from '../../src/engine-adapters/deliberation/deliberation.processor.js';
import {
  DELIBERATION_CIRCUIT_OPEN_ERROR_CODE,
  DeliberationRetryableError,
  type DeliberationOutcome,
  type DeliberationShadowInput,
} from '../../src/engine-adapters/deliberation/llm-deliberation.service.js';
import { type DeltaVector } from '../../src/engine-core/index.js';
import { QUEUE_NAMES } from '../../src/shared/infra/redis/redis.constants.js';
import type { RedisService } from '../../src/shared/infra/redis/redis.service.js';
import { resetTestDoubles } from '../helpers/index.js';

// ── bullmq 替身 (Queue / Worker) ────────────────────────────────────────────
const bull = vi.hoisted(() => ({
  add: vi.fn(async (): Promise<{ id: string }> => ({ id: 'job-1' })),
  queueClose: vi.fn(async (): Promise<void> => {}),
  workerClose: vi.fn(async (): Promise<void> => {}),
  workerOn: vi.fn(),
  queueCtor: vi.fn(),
  workerCtor: vi.fn(),
}));

vi.mock('bullmq', () => ({
  Queue: class {
    constructor(name: string, options: unknown) {
      bull.queueCtor(name, options);
    }

    readonly add = bull.add;
    readonly close = bull.queueClose;
  },
  Worker: class {
    constructor(name: string, processor: (job: unknown) => Promise<void>, options: unknown) {
      bull.workerCtor(name, processor, options);
    }

    readonly on = bull.workerOn;
    readonly close = bull.workerClose;
  },
}));

const TENANT = 'tenant-1';
const SESSION = 'session-1';
const USER = 'user-1';
const THRESHOLD = DEFAULT_DELIBERATION_FAILURE_THRESHOLD;
const COOLDOWN = DEFAULT_DELIBERATION_COOLDOWN_MS;

/** 规则算子这一轮的实际 delta (测试基准). */
const RULE_DELTA: DeltaVector = {
  trust: 0.05,
  safety: 0.02,
  bond: 0.01,
  valence: -0.01,
  arousal: 0,
  verbal: 0,
  depth: 0,
  style: 0,
  positive: 0,
  negative: 0,
  dependency: 0,
};

/** 造一份影子审议入参 (基准). */
function buildInput(overrides: Partial<DeliberationShadowInput> = {}): DeliberationShadowInput {
  return {
    sessionId: SESSION,
    tenantId: TENANT,
    userId: USER,
    turnIndex: 3,
    mode: 'freeform',
    // WP-A: 结构化输入 (零对话原文) —— 走真实的装配函数.
    structured: buildTestStructuredInput({
      counselorText: '你最近睡得怎么样？',
      visitorText: '有点累，夜里老醒。',
      characterBrief: '依恋风格: 回避型',
      // WP68: 意图锁定需要知道"规则算子本轮选的策略" (门面从内核意图传进来).
      ruleStrategy: 'recounting',
    }),
    ruleDelta: RULE_DELTA,
    // WP65: 本轮审议对应的快照版本号 (切灰度时判断审议结果有没有过期).
    baseRevision: 1,
    ...overrides,
  };
}

/** 一次"成功"的结局. */
function okOutcome(): DeliberationOutcome {
  const output: DeliberationOutput = { deltas: [], summary: 's', confidence: 0.5, intentionShift: null };
  return {
    kind: 'ok',
    validated: { output, rejectedEntries: [] },
    usage: null,
  };
}

/** 一次"失败"的结局 (非重试类: service 已吞掉, 靠返回值告诉 processor). */
function failedOutcome(errorCode = 'fetch_error'): DeliberationOutcome {
  return { kind: 'failed', errorCode, usage: null };
}

/** 假 Redis (只实现熔断器用到的三个命令). */
class FakeRedis {
  readonly store = new Map<string, string>();
  readonly get = vi.fn(async (key: string): Promise<string | null> => this.store.get(key) ?? null);
  readonly set = vi.fn(async (key: string, value: string): Promise<void> => {
    this.store.set(key, value);
  });

  readonly del = vi.fn(async (key: string): Promise<number> => (this.store.delete(key) ? 1 : 0));

  /** 塞一份熔断状态. */
  seed(state: DeliberationCircuitState, key = buildDeliberationCircuitKey(TENANT, SESSION)): void {
    this.store.set(key, JSON.stringify(state));
  }

  /** 读回熔断状态. */
  read(key = buildDeliberationCircuitKey(TENANT, SESSION)): DeliberationCircuitState | null {
    const raw = this.store.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as DeliberationCircuitState);
  }
}

/** 装一个 processor (依赖全是极小替身). */
function buildProcessor(options: { env?: Record<string, string>; outcome?: DeliberationOutcome; throwError?: Error; redis?: FakeRedis }): {
  processor: DeliberationProcessor;
  redis: FakeRedis;
  executeShadowMode: ReturnType<typeof vi.fn>;
  recordCircuitOpen: ReturnType<typeof vi.fn>;
} {
  const env = options.env ?? {};
  const redis = options.redis ?? new FakeRedis();
  const config = { get: (key: string): string | undefined => env[key] } as unknown as ConfigService;
  const redisService = {
    getBullClient: () => ({}),
    get: redis.get,
    set: redis.set,
    del: redis.del,
    // ⚠️ WP65 后半段: per-session mutex (SETNX) —— 默认总是拿到锁.
    setnx: vi.fn(async (): Promise<boolean> => true),
  } as unknown as RedisService;
  const executeShadowMode = vi.fn(async (): Promise<DeliberationOutcome> => {
    if (options.throwError) throw options.throwError;
    return options.outcome ?? okOutcome();
  });
  const recordCircuitOpen = vi.fn(async (): Promise<void> => {});
  const llm = { executeShadowMode, recordCircuitOpen } as unknown as LlmDeliberationServiceLike;
  return { processor: new DeliberationProcessor(redisService, llm, config), redis, executeShadowMode, recordCircuitOpen };
}

/** service 替身的最小类型 (只需要这两个方法). */
type LlmDeliberationServiceLike = ConstructorParameters<typeof DeliberationProcessor>[1];

/** 取 Worker 注册的处理函数 (最后一次构造的那个). */
function workerProcessor(): (job: unknown) => Promise<void> {
  const calls = bull.workerCtor.mock.calls as [string, (job: unknown) => Promise<void>, unknown][];
  const call = calls.at(-1);
  return call![1];
}

// V2026-11-13 (TD-9 · T-1): 统一复位钩子 (与 wp65 同口径).
//   原先这里只有 mockClear + vi.restoreAllMocks —— 一次性实现 (mockRejectedValueOnce 等)
//   不会被清掉; 改走 resetTestDoubles: 还原 spy + 把替身复位回 vi.fn 工厂默认实现.
beforeEach(() => {
  resetTestDoubles(bull);
});

describe('WP67 · 审议熔断与降级策略', () => {
  describe('① 熔断状态判断 (4 例)', () => {
    it('①-1 failureCount < threshold → closed', () => {
      expect(resolveCircuitStatus({ failureCount: THRESHOLD - 1, openedAt: null }, THRESHOLD, COOLDOWN)).toBe('closed');
      expect(resolveCircuitStatus({ failureCount: 0, openedAt: null }, THRESHOLD, COOLDOWN)).toBe('closed');
    });

    it('①-2 failureCount >= threshold 且距 openedAt 还没到冷却 → open', () => {
      const openedAt = Date.now() - 1000;
      expect(resolveCircuitStatus({ failureCount: THRESHOLD, openedAt }, THRESHOLD, COOLDOWN)).toBe('open');
    });

    it('①-3 failureCount >= threshold 且冷却已过 → half-open', () => {
      const openedAt = Date.now() - COOLDOWN - 1;
      expect(resolveCircuitStatus({ failureCount: THRESHOLD, openedAt }, THRESHOLD, COOLDOWN)).toBe('half-open');
    });

    it('①-4 状态不存在 → closed (默认闭合)', () => {
      expect(resolveCircuitStatus(null, THRESHOLD, COOLDOWN)).toBe('closed');
      // 防御: 到阈值却没有 openedAt → 也算闭合 (不能因此把会话永久熔断).
      expect(resolveCircuitStatus({ failureCount: THRESHOLD, openedAt: null }, THRESHOLD, COOLDOWN)).toBe('closed');
    });
  });

  describe('② 入队判断 (3 例)', () => {
    it('②-5 closed 状态 → 正常入队', async () => {
      const { processor, redis } = buildProcessor({ env: { ENGINE_DELIBERATION_ENABLED: 'true' } });
      await processor.onModuleInit();

      const ok = await processor.enqueue(buildInput());

      expect(ok).toBe(true);
      expect(bull.add).toHaveBeenCalledTimes(1);
      expect(redis.get).toHaveBeenCalledTimes(1);
    });

    it('②-6 open 状态 → 不入队, 写一条 circuit_open 的 trace', async () => {
      const redis = new FakeRedis();
      redis.seed({ failureCount: THRESHOLD, openedAt: Date.now() - 1000 });
      const { processor, recordCircuitOpen } = buildProcessor({ env: { ENGINE_DELIBERATION_ENABLED: 'true' }, redis });
      await processor.onModuleInit();

      const ok = await processor.enqueue(buildInput());

      expect(ok).toBe(false);
      expect(bull.add).not.toHaveBeenCalled();
      expect(recordCircuitOpen).toHaveBeenCalledTimes(1);
    });

    it('②-7 half-open 状态 → 正常入队 (放一个请求试试), 且**消费掉**这次半开机会', async () => {
      const redis = new FakeRedis();
      redis.seed({ failureCount: THRESHOLD, openedAt: Date.now() - COOLDOWN - 1 });
      const { processor } = buildProcessor({ env: { ENGINE_DELIBERATION_ENABLED: 'true' }, redis });
      await processor.onModuleInit();

      const first = await processor.enqueue(buildInput({ turnIndex: 3 }));
      expect(first).toBe(true);
      expect(bull.add).toHaveBeenCalledTimes(1);
      // 半开机会被消费 → openedAt 刷新成 now → 下一个请求看到的是 open.
      const afterClaim = redis.read();
      expect(afterClaim?.openedAt).toBeGreaterThan(Date.now() - 1000);

      const second = await processor.enqueue(buildInput({ turnIndex: 4 }));
      expect(second).toBe(false);
      expect(bull.add).toHaveBeenCalledTimes(1);
    });
  });

  describe('③ 状态更新 (4 例)', () => {
    it('③-8 成功 → 清零 (删掉 key)', async () => {
      const redis = new FakeRedis();
      redis.seed({ failureCount: 2, openedAt: null });
      const { processor } = buildProcessor({ env: { ENGINE_DELIBERATION_ENABLED: 'true' }, redis });
      await processor.onModuleInit();

      await workerProcessor()({ data: buildInput(), attemptsMade: 0 });

      expect(redis.del).toHaveBeenCalledTimes(1);
      expect(redis.read()).toBeNull();
    });

    it('③-9 失败 → failureCount + 1', async () => {
      const redis = new FakeRedis();
      const { processor } = buildProcessor({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        redis,
        outcome: failedOutcome(),
      });
      await processor.onModuleInit();

      await workerProcessor()({ data: buildInput(), attemptsMade: 0 });

      const state = redis.read();
      expect(state?.failureCount).toBe(1);
      expect(state?.openedAt).toBeNull();
    });

    it('③-10 连续失败达到阈值 → 记 openedAt', async () => {
      const redis = new FakeRedis();
      redis.seed({ failureCount: THRESHOLD - 1, openedAt: null });
      const { processor } = buildProcessor({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        redis,
        outcome: failedOutcome(),
      });
      await processor.onModuleInit();

      await workerProcessor()({ data: buildInput(), attemptsMade: 0 });

      const state = redis.read();
      expect(state?.failureCount).toBe(THRESHOLD);
      expect(state?.openedAt).toBeGreaterThan(Date.now() - 5000);
    });

    it('③-11 已经在熔断中再失败 → 保留原来的 openedAt, 不重置', async () => {
      const openedAt = Date.now() - 1000;
      const redis = new FakeRedis();
      redis.seed({ failureCount: THRESHOLD, openedAt });
      const { processor } = buildProcessor({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        redis,
        outcome: failedOutcome(),
      });
      await processor.onModuleInit();

      await workerProcessor()({ data: buildInput(), attemptsMade: 0 });

      const state = redis.read();
      expect(state?.failureCount).toBe(THRESHOLD + 1);
      expect(state?.openedAt).toBe(openedAt);
    });
  });

  describe('④ 配置 (3 例)', () => {
    it('④-12 ENGINE_DELIBERATION_FAILURE_THRESHOLD 默认 3', async () => {
      const redis = new FakeRedis();
      redis.seed({ failureCount: 2, openedAt: null });
      const { processor } = buildProcessor({ env: { ENGINE_DELIBERATION_ENABLED: 'true' }, redis });
      await processor.onModuleInit();

      // 连续失败 2 次还没熔断 (failureCount=2 < 3), 第 3 次才熔断.
      await processor.enqueue(buildInput({ turnIndex: 1 }));
      expect(redis.read()?.openedAt).toBeNull();
      expect(DEFAULT_DELIBERATION_FAILURE_THRESHOLD).toBe(3);
    });

    it('④-13 ENGINE_DELIBERATION_COOLDOWN_MS 默认 600000 (10 分钟)', () => {
      expect(DEFAULT_DELIBERATION_COOLDOWN_MS).toBe(600_000);
      // 冷却内的 openedAt → open; 冷却外的 → half-open.
      const inside = Date.now() - DEFAULT_DELIBERATION_COOLDOWN_MS + 1000;
      expect(resolveCircuitStatus({ failureCount: 3, openedAt: inside }, 3, DEFAULT_DELIBERATION_COOLDOWN_MS)).toBe('open');
      const outside = Date.now() - DEFAULT_DELIBERATION_COOLDOWN_MS - 1000;
      expect(resolveCircuitStatus({ failureCount: 3, openedAt: outside }, 3, DEFAULT_DELIBERATION_COOLDOWN_MS)).toBe('half-open');
    });

    it('④-14 env 配非法值时回退默认, 不抛错', async () => {
      for (const value of ['', '  ', 'abc', '0', '-1']) {
        const redis = new FakeRedis();
        const { processor } = buildProcessor({
          env: {
            ENGINE_DELIBERATION_ENABLED: 'true',
            ENGINE_DELIBERATION_FAILURE_THRESHOLD: value,
            ENGINE_DELIBERATION_COOLDOWN_MS: value,
          },
          redis,
          outcome: failedOutcome(),
        });
        await expect(processor.onModuleInit()).resolves.toBeUndefined();
        await workerProcessor()({ data: buildInput(), attemptsMade: 0 });
        // 非法阈值回退 3 → 第 1 次失败不该熔断; 非法冷却回退 600000 → TTL = 1200 秒.
        expect(redis.read()?.failureCount).toBe(1);
        expect(redis.read()?.openedAt).toBeNull();
        expect(redis.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), 1200);
      }
    });
  });

  describe('⑤ 边界 (3 例)', () => {
    it('⑤-15 开关关闭时: 不跑熔断判断 (Redis 都不碰), 直接不入队', async () => {
      const redis = new FakeRedis();
      redis.seed({ failureCount: THRESHOLD, openedAt: Date.now() - 1000 });
      const { processor } = buildProcessor({ env: { ENGINE_DELIBERATION_ENABLED: 'false' }, redis });
      await processor.onModuleInit();

      const ok = await processor.enqueue(buildInput());

      expect(ok).toBe(false);
      expect(bull.add).not.toHaveBeenCalled();
      expect(redis.get).not.toHaveBeenCalled();
    });

    it('⑤-16 Redis key 带租户与会话长度前缀 (撞键防护)', () => {
      const key = buildDeliberationCircuitKey('a:b', 'c');
      expect(key).toBe('deliberation_circuit:3:a:b:1:c');
      // 撞键对照: (租户="a:b", 会话="c") 与 (租户="a", 会话="b:c") 必须**不同** key.
      expect(buildDeliberationCircuitKey('a:b', 'c')).not.toBe(buildDeliberationCircuitKey('a', 'b:c'));
    });

    it('⑤-17 内核树里零审议**实现** (R9: 内核只留一个**纯类型端口**, 实现全在适配层)', () => {
      const kernelRoot = path.join(__dirname, '../../src/engine-core');
      const hits: string[] = [];
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir)) {
          const full = path.join(dir, entry);
          if (statSync(full).isDirectory()) {
            walk(full);
            continue;
          }
          if (!entry.endsWith('.ts')) continue;
          if (readFileSync(full, 'utf8').toLowerCase().includes('deliberat')) {
            hits.push(path.relative(kernelRoot, full).replaceAll('\\', '/'));
          }
        }
      };
      walk(kernelRoot);

      // ⚠️ V2026-11-08 (R9) 治本: 这条断言从「整棵内核树不含 deliberat」**收紧**为
      //   「只含下面这三处, 且这三处是**纯类型**的」.
      //   为什么改: R9 要让审议建议**真的生效**, 就必须在内核留一道「落库前改 delta」的口子 ——
      //   适配层拿到的是落库**之后**的快照, 事后改快照会破坏「一轮一次落库」的
      //   不变量 (版本号跳两跳, 乐观锁语义变味). 所以内核新增一个**纯类型端口**.
      //   ⚠️ 这不是放宽: 白名单**显式且最小** (多一处即红), 且下面追加了三条**更严**的断言
      //     (端口零实现 / 端口零外部引用 / 白名单恰好三处).
      const allowed = new Set([
        'runtime/deliberation-hook.port.ts', // 纯类型端口 (零实现)
        'in-memory/in-memory-engine-session.ts', // 调用端口的那一行
        'index.ts', // 端口类型的 barrel 再导出
      ]);
      expect(hits.filter((file) => !allowed.has(file))).toEqual([]);

      // 端口必须是**纯类型契约**: 零 class / 零 function / 零 const (只有形状, 没有实现).
      const portSource = readFileSync(path.join(kernelRoot, 'runtime/deliberation-hook.port.ts'), 'utf8');
      expect(/export\s+(class|function|const)\b/.test(portSource)).toBe(false);
      // 端口**不得**引用适配层 / 框架 (审议的实现必须留在适配层).
      expect(portSource).not.toMatch(/from\s+['"][^'"]*(engine-adapters|@nestjs|typeorm)/);
      // 白名单里的三处必须**都**在 (少一处 = 内核里还留着别处的审议痕迹, 或端口被删了).
      expect([...allowed].filter((file) => hits.includes(file)).sort()).toEqual([...allowed].sort());
    });
  });

  describe('⑥ 防漂移 (失败分类 / 半开重置 / 门面零改动)', () => {
    it('⑥-a 值得重试的失败 → 记失败**并原样抛出** (BullMQ 才能重试)', async () => {
      const redis = new FakeRedis();
      const { processor } = buildProcessor({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        redis,
        throwError: new DeliberationRetryableError('json_parse_failed', 'boom'),
      });
      await processor.onModuleInit();

      await expect(workerProcessor()({ data: buildInput(), attemptsMade: 0 })).rejects.toBeInstanceOf(DeliberationRetryableError);

      expect(redis.read()?.failureCount).toBe(1);
    });

    it('⑥-b 不值得重试的失败 → 记失败**不抛**', async () => {
      const redis = new FakeRedis();
      const { processor } = buildProcessor({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        redis,
        outcome: failedOutcome('fetch_error'),
      });
      await processor.onModuleInit();

      await expect(workerProcessor()({ data: buildInput(), attemptsMade: 0 })).resolves.toBeUndefined();

      expect(redis.read()?.failureCount).toBe(1);
    });

    it('⑥-c skipped (开关关掉没跑) → 不动熔断状态 (这一轮没烧钱)', async () => {
      const redis = new FakeRedis();
      redis.seed({ failureCount: 2, openedAt: null });
      const { processor } = buildProcessor({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        redis,
        outcome: { kind: 'skipped' },
      });
      await processor.onModuleInit();

      await workerProcessor()({ data: buildInput(), attemptsMade: 0 });

      expect(redis.read()?.failureCount).toBe(2);
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('⑥-d 半开失败 → 重置冷却时间 (不留原来的 openedAt)', async () => {
      const oldOpenedAt = Date.now() - COOLDOWN - 1000;
      const redis = new FakeRedis();
      redis.seed({ failureCount: THRESHOLD, openedAt: oldOpenedAt });
      const { processor } = buildProcessor({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        redis,
        outcome: failedOutcome(),
      });
      await processor.onModuleInit();

      await workerProcessor()({ data: buildInput(), attemptsMade: 0 });

      const state = redis.read();
      expect(state?.openedAt).not.toBe(oldOpenedAt);
      expect(state?.openedAt).toBeGreaterThan(Date.now() - 5000);
    });

    it('⑥-e 熔断 trace 用独立的 errorCode (能区分"根本没跑"与"跑了但失败")', () => {
      expect(DELIBERATION_CIRCUIT_OPEN_ERROR_CODE).toBe('circuit_open');
    });

    it('⑥-f 编排门面零改动: 门面只认端口, 不知道熔断的存在', () => {
      const source = readFileSync(path.join(__dirname, '../../src/engine-adapters/rendering/turn-render-orchestrator.ts'), 'utf8');
      expect(source).toContain('DeliberationShadowPort');
      expect(source).not.toContain('DeliberationProcessor');
      expect(source).not.toContain('circuit');
    });

    it('⑥-g 队列名与 job 名不变 (WP65 的契约不被 WP67 改动)', async () => {
      const { processor } = buildProcessor({ env: { ENGINE_DELIBERATION_ENABLED: 'true' } });
      await processor.onModuleInit();

      const calls = bull.queueCtor.mock.calls as [string, unknown][];
      expect(calls[0][0]).toBe(QUEUE_NAMES.deliberation);
      expect(QUEUE_NAMES.deliberation).toBe('deliberation-shadow');
      expect(DELIBERATION_JOB_NAME).toBe('shadow');
    });

    it('⑥-h 熔断日志只出定位信息, 不出审议原文 (隐私红线)', async () => {
      const logs: string[] = [];
      vi.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => {
        logs.push(typeof message === 'string' ? message : String(message));
      });

      const redis = new FakeRedis();
      redis.seed({ failureCount: THRESHOLD, openedAt: Date.now() - 1000 });
      const { processor } = buildProcessor({ env: { ENGINE_DELIBERATION_ENABLED: 'true' }, redis });
      await processor.onModuleInit();

      await processor.enqueue(buildInput({ structured: buildTestStructuredInput({ counselorText: '我最近很想自杀' }) }));

      const joined = logs.join('\n');
      expect(joined).not.toContain('我最近很想自杀');
      expect(joined).toContain('deliberation_circuit_open');
      expect(joined).toContain(SESSION);
    });
  });
});
