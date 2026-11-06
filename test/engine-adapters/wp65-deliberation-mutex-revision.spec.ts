// V2026-11-06 治本 (WP65 后半段 · per-session mutex + 快照版本号传递):
//   覆盖任务单 §九 的机制闸门 ⑤/⑥/⑦/⑧ + 传递链端到端.
//
//   覆盖清单:
//     ① baseRevision 传递链 (6 例)
//        ①-1 内核 turn 出参带 revision = 落库后的版本号 (逐轮递增)
//        ①-2 出参的 revision 与仓储里存的那一版**一致** (不是本地另算一个)
//        ①-3 门面把 revision 原样传成审议入参的 baseRevision (端到端)
//        ①-4 内核没填 revision → 门面兜底传 0 (安全的失败方向)
//        ①-5 service 把 baseRevision 原样写进 trace (成功路径)
//        ①-6 service 把 baseRevision 原样写进 trace (失败路径)
//
//     ② per-session mutex (10 例)
//        ②-1 入队前 SETNX 拿锁: key / value / TTL 三要素都对
//        ②-2 同一会话并发入队: 只有第一个进去, 后面的被拦下 (闸门 ⑤)
//        ②-3 拿不到锁 → 不入队 + 打 warn (只有定位信息)
//        ②-4 Redis 不可用 → 放行入队 (fail-open, 与熔断器同纪律)
//        ②-5 入队失败 → 立刻释放锁 (不连累这场会话后面 30 秒)
//        ②-6 Worker 跑完 → 锁一定释放 (成功 / 失败 / 异常, 闸门 ⑥)
//        ②-7 释放时只删自己的锁 (锁值不是本轮序号 → 不删)
//        ②-8 值得重试的失败 → 锁跨重试持有 (退避窗口里不再进一个)
//        ②-9 重试次数用完 → 锁释放 (不会永久锁死)
//        ②-10 mutex key 带租户 + 会话长度前缀 (撞键防护) + TTL 兜底 (闸门 ⑦)
//
//     ③ 端到端: 入队时的 baseRevision 与 trace 里记的一致 (闸门 ⑧)
//     ④ RedisService.setnx 的原子性契约 (2 例)
//     ⑤ 隐私边界 (1 例)
//
//   边界: 全 mock, 不起 Nest 容器, 不发网络, 不连 Redis ——
//     bullmq (Queue / Worker) / RedisService / LLM client / ConfigService 全是极小替身.
//
//   验证: npx vitest run test/engine-adapters/wp65-deliberation-mutex-revision.spec.ts

import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CounselorLlmJsonClient } from '../../src/counselor/providers/llm-json.client.js';
import {
  DELIBERATION_MUTEX_KEY_PREFIX,
  DELIBERATION_MUTEX_TTL_SECONDS,
  DeliberationProcessor,
  buildDeliberationMutexKey,
} from '../../src/engine-adapters/deliberation/deliberation.processor.js';
import {
  DeliberationRetryableError,
  LlmDeliberationService,
  type DeliberationShadowInput,
  type DeliberationShadowPort,
  type DeliberationTokenUsage,
  type DeliberationTraceRecord,
  type ValidatedDeliberation,
} from '../../src/engine-adapters/deliberation/llm-deliberation.service.js';
import { TurnRenderOrchestrator, type TurnSessionContext } from '../../src/engine-adapters/rendering/turn-render-orchestrator.js';
import { createEngineSessionPort } from '../../src/engine-adapters/wiring/engine.providers.js';
import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository.js';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store.js';
import {
  createEmptyBdiSnapshot,
  type BdiStateRepository,
  type DeltaVector,
  type EngineSessionHandle,
  type EngineSessionPort,
  type EngineTurnInput,
  type EngineTurnOutput,
  type Intention,
  type MemoryEntry,
  type MemoryHit,
  type MemoryStore,
  type OpenEngineSessionInput,
  type RenderPort,
  type RenderResult,
  type RenderSpec,
} from '../../src/engine-core/index.js';
import { RedisService } from '../../src/shared/infra/redis/redis.service.js';

// ── bullmq 替身 (Queue / Worker) ────────────────────────────────────────────
//   vi.hoisted: 工厂函数会被 vitest 提升到 import 之前, 所以共享状态必须先 hoisted.
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
const VISITOR = 'visitor-1';
const HANDLE_ID = 'handle-1';
const REPLY = '有点累，夜里老醒。';

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

/** 会话归属 (审议端口要求 userId 非空, 否则门面直接跳过这一轮). */
const CONTEXT: TurnSessionContext = {
  tenantId: TENANT,
  sessionId: SESSION,
  visitorId: VISITOR,
  userId: USER,
};

/**
 * 假 Redis —— SETNX / GET / DEL 走**真实语义** (Map 当存储).
 *
 * ⚠️ 为什么要真实语义: mutex 的价值全在"只有一个人拿到锁"上 ——
 *   用一个恒返回 true 的假 setnx, 并发用例就测不出任何东西.
 */
class FakeRedis {
  readonly store = new Map<string, string>();

  readonly setnx = vi.fn(async (key: string, value: string): Promise<boolean> => {
    if (this.store.has(key)) return false;
    this.store.set(key, value);
    return true;
  });

  readonly get = vi.fn(async (key: string): Promise<string | null> => this.store.get(key) ?? null);

  readonly del = vi.fn(async (key: string): Promise<number> => (this.store.delete(key) ? 1 : 0));

  readonly set = vi.fn(async (key: string, value: string): Promise<void> => {
    this.store.set(key, value);
  });

  readonly getBullClient = (): unknown => ({});

  /** 装成 RedisService (端口比这个替身宽, 替身只实现用到的命令). */
  asService(): RedisService {
    return this as unknown as RedisService;
  }
}

/** 造一份影子审议入参 (基准). */
function buildInput(overrides: Partial<DeliberationShadowInput> = {}): DeliberationShadowInput {
  return {
    sessionId: SESSION,
    tenantId: TENANT,
    userId: USER,
    turnIndex: 3,
    // WP65: 本轮审议对应的快照版本号 —— 这里给一个**非 0** 的值,
    //   免得"没传 / 传成 0"的兜底路径把真正的传递链路蒙混过去.
    baseRevision: 7,
    mode: 'freeform',
    baseSnapshot: createEmptyBdiSnapshot(),
    counselorText: '你最近睡得怎么样？',
    visitorText: '有点累，夜里老醒。',
    characterBrief: '依恋风格: 回避型',
    ruleDelta: RULE_DELTA,
    ruleStrategy: 'recounting',
    ...overrides,
  };
}

/** 装一个 processor (依赖全是极小替身). */
function buildProcessor(options: { env?: Record<string, string>; redis?: FakeRedis; llm?: Partial<LlmDeliberationService> } = {}): {
  processor: DeliberationProcessor;
  redis: FakeRedis;
} {
  const env = options.env ?? {};
  const config = { get: (key: string): string | undefined => env[key] } as unknown as ConfigService;
  const redis = options.redis ?? new FakeRedis();
  // ⚠️ WP67 起 processor 读 executeShadowMode 的**返回值**判断成败 → 替身必须返回结局.
  const llm = {
    executeShadowMode: vi.fn(async () => ({ kind: 'ok', validated: undefined, usage: null })),
    recordCircuitOpen: vi.fn(async (): Promise<void> => {}),
  } as unknown as LlmDeliberationService;
  return {
    processor: new DeliberationProcessor(redis.asService(), { ...llm, ...options.llm } as LlmDeliberationService, config),
    redis,
  };
}

/** 取 Worker 注册的处理函数 (init 之后才有; 取**最后一次**构造的那个). */
function workerProcessor(): (job: unknown) => Promise<void> {
  const calls = bull.workerCtor.mock.calls as [string, (job: unknown) => Promise<void>, unknown][];
  const call = calls.at(-1);
  return call[1];
}

/** 审议成功时的 client 返回体. */
function okResult(): {
  ok: true;
  data: ValidatedDeliberation;
  rawText: string;
  errorCode: null;
  errorMessage: null;
  usage: DeliberationTokenUsage;
} {
  return {
    ok: true,
    data: {
      output: { deltas: [], summary: '来访情绪略有低落', confidence: 0.65, intentionShift: null },
      rejectedEntries: [],
    },
    rawText: '{}',
    errorCode: null,
    errorMessage: null,
    usage: { promptTokens: 1200, completionTokens: 180, totalTokens: 1380 },
  };
}

/** 审议失败时的 client 返回体 (错误码由调用方给). */
function failResult(errorCode: string): {
  ok: false;
  data: null;
  rawText: string;
  errorCode: string;
  errorMessage: string;
  usage: DeliberationTokenUsage | null;
} {
  return {
    ok: false,
    data: null,
    rawText: '',
    errorCode,
    errorMessage: 'boom',
    usage: { promptTokens: 100, completionTokens: 0, totalTokens: 100 },
  };
}

/**
 * 装一个**真的**审议服务 (LLM client / Redis / ConfigService 全是替身).
 *
 * 用真服务才能验"baseRevision 真的落进了 trace" —— 替身不会走 buildSuccessRecord.
 */
function buildRealService(options: { requestJson?: ReturnType<typeof vi.fn>; set?: ReturnType<typeof vi.fn> } = {}): {
  service: LlmDeliberationService;
  set: ReturnType<typeof vi.fn>;
} {
  const requestJson = options.requestJson ?? vi.fn();
  const set = options.set ?? vi.fn();
  const env: Record<string, string> = { ENGINE_DELIBERATION_ENABLED: 'true' };
  const config = { get: (key: string): string | undefined => env[key] } as unknown as ConfigService;
  // ⚠️ WP68 起 service 还要**读**意图锁定状态 (Redis get) → 替身补上.
  const redis = { set, get: vi.fn(async (): Promise<string | null> => null) } as unknown as RedisService;
  const llm = { requestJson } as unknown as CounselorLlmJsonClient;
  // ⚠️ V2026-11-07 起 service 还要**读** BDI 状态仓储 (过期判定) → 替身补上.
  //   这里用**真的**内存仓储 (本文件已经 import 了) —— 空仓储 = 读不到 = 保守兜底.
  const bdiStates = new InMemoryBdiStateRepository() as BdiStateRepository;
  return { service: new LlmDeliberationService(llm, config, redis, bdiStates), set };
}

/** 从 set 的调用参数里取出写进去的 trace 记录 (trace 是第一个 set —— 锁状态排在它后面). */
function writtenRecord(set: ReturnType<typeof vi.fn>): DeliberationTraceRecord {
  const [, value] = set.mock.calls[0] as [string, string];
  return JSON.parse(value) as DeliberationTraceRecord;
}

/** 造一个只带假 client 的 RedisService (不连真 Redis). */
function buildRedisService(setSpy: ReturnType<typeof vi.fn>): RedisService {
  const service = new RedisService({ get: () => ({ host: '127.0.0.1', port: 6379, db: 0, keyPrefix: '' }) } as never);
  // 注入假 client (onModuleInit 会真连 Redis, 这里不能调).
  Object.assign(service, { client: { set: setSpy } });
  return service;
}

// ── 内核出参 / 门面替身 (驱动 baseRevision 传递链) ────────────────────────────

/** 构造一个意图. */
function buildIntention(): Intention {
  return {
    strategy: 'recounting',
    emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
    resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
    transference: { positive: 0, negative: 0, dependency: 0 },
    forbiddenBehaviors: ['judge'],
  };
}

/** 构造内核一轮出参. */
function buildOutput(overrides: Partial<EngineTurnOutput> = {}): EngineTurnOutput {
  return {
    reply: '',
    snapshot: createEmptyBdiSnapshot(),
    turnIndex: 1,
    intention: buildIntention(),
    ...overrides,
  };
}

/** 会话端口 stub: 固定出参. */
class StubSession implements EngineSessionPort {
  constructor(private readonly output: EngineTurnOutput) {}

  openSession(input: OpenEngineSessionInput): EngineSessionHandle {
    return { handleId: HANDLE_ID, sessionId: input.sessionId };
  }

  async turn(_handleId: string, _input: EngineTurnInput): Promise<EngineTurnOutput> {
    return this.output;
  }

  closeSession(): void {
    /* 门面不调它; 占位以满足端口契约. */
  }
}

/** 渲染端口 stub: 固定返回文本. */
class StubRenderer implements RenderPort {
  readonly specs: RenderSpec[] = [];

  async render(spec: RenderSpec): Promise<RenderResult> {
    this.specs.push(spec);
    return {
      text: REPLY,
      taskKind: spec.taskKind,
      usage: { completionTokens: 20, totalTokens: 40 },
      fallbackUsed: false,
    };
  }
}

/** 记忆仓储 stub: 记录写入. */
class StubMemoryStore implements MemoryStore {
  readonly remembered: MemoryEntry[] = [];

  async remember(entry: MemoryEntry): Promise<void> {
    this.remembered.push(entry);
  }

  async recall(): Promise<readonly MemoryHit[]> {
    return [];
  }
}

/** 审议端口 stub: 记录收到的入参 (门面 fire-and-forget, 所以同步记). */
class StubDeliberation implements DeliberationShadowPort {
  readonly inputs: DeliberationShadowInput[] = [];

  async runShadowMode(input: DeliberationShadowInput): Promise<void> {
    this.inputs.push(input);
  }
}

/**
 * 驱动门面跑两轮, 返回审议端口收到的入参.
 *
 * ⚠️ 为什么必须**两轮**: 首轮没有"本轮开始时的快照" (上一轮还没跑过),
 *   门面会跳过影子审议 —— 单轮驱动断言不到任何审议入参.
 */
async function driveTwoTurns(output: EngineTurnOutput): Promise<StubDeliberation> {
  const deliberation = new StubDeliberation();
  const orchestrator = new TurnRenderOrchestrator({
    session: new StubSession(output),
    renderer: new StubRenderer(),
    memories: new StubMemoryStore(),
    deliberation,
    resolveSession: () => CONTEXT,
  });
  await orchestrator.turn(HANDLE_ID, { userText: '你最近睡得怎么样？' });
  await orchestrator.turn(HANDLE_ID, { userText: '你最近睡得怎么样？' });
  return deliberation;
}

beforeEach(() => {
  bull.add.mockClear();
  bull.queueClose.mockClear();
  bull.workerClose.mockClear();
  bull.workerOn.mockClear();
  bull.queueCtor.mockClear();
  bull.workerCtor.mockClear();
});

describe('WP65 后半段 · per-session mutex + 快照版本号传递', () => {
  describe('① baseRevision 传递链', () => {
    it('①-1 内核 turn 出参带 revision = 落库后的版本号 (逐轮递增)', async () => {
      const repository = new InMemoryBdiStateRepository();
      const session = createEngineSessionPort(new InMemoryMemoryStore(), undefined, undefined, repository);
      const handle = session.openSession({ sessionId: 'wp65-core-1', tenantId: TENANT, visitorId: VISITOR });

      const first = await session.turn(handle.handleId, { userText: '最近睡得不太好' });
      const second = await session.turn(handle.handleId, { userText: '还是不太行' });

      expect(first.revision).toBe(1);
      expect(second.revision).toBe(2);
    });

    it('①-2 出参的 revision 与仓储里存的那一版一致 (不是本地另算一个)', async () => {
      const repository = new InMemoryBdiStateRepository();
      const session = createEngineSessionPort(new InMemoryMemoryStore(), undefined, undefined, repository);
      const handle = session.openSession({ sessionId: 'wp65-core-2', tenantId: TENANT, visitorId: VISITOR });

      const output = await session.turn(handle.handleId, { userText: '最近睡得不太好' });
      const stored = await repository.load(TENANT, 'wp65-core-2');

      expect(stored).not.toBeNull();
      expect(output.revision).toBe(stored?.revision);
    });

    it('①-3 门面把内核出参的 revision 原样传成审议入参的 baseRevision (端到端)', async () => {
      const deliberation = await driveTwoTurns(buildOutput({ revision: 42 }));

      expect(deliberation.inputs).toHaveLength(1);
      expect(deliberation.inputs[0].baseRevision).toBe(42);
    });

    it('①-4 内核没填 revision → 门面兜底传 0 (安全的失败方向: 0 会被判成过期)', async () => {
      const deliberation = await driveTwoTurns(buildOutput());

      expect(deliberation.inputs).toHaveLength(1);
      expect(deliberation.inputs[0].baseRevision).toBe(0);
    });

    it('①-5 service 把 baseRevision 原样写进 trace (成功路径)', async () => {
      const { service, set } = buildRealService({ requestJson: vi.fn().mockResolvedValue(okResult()) });

      await service.executeShadowMode(buildInput({ baseRevision: 42 }));

      expect(writtenRecord(set).baseRevision).toBe(42);
    });

    it('①-6 service 把 baseRevision 原样写进 trace (失败路径)', async () => {
      const { service, set } = buildRealService({ requestJson: vi.fn().mockResolvedValue(failResult('fetch_error')) });

      await service.executeShadowMode(buildInput({ baseRevision: 42 }));

      const record = writtenRecord(set);
      expect(record.ok).toBe(false);
      expect(record.baseRevision).toBe(42);
    });
  });

  describe('② per-session mutex', () => {
    it('②-1 入队前 SETNX 拿锁: key / value / TTL 三要素都对', async () => {
      const { processor, redis } = buildProcessor({ env: { ENGINE_DELIBERATION_ENABLED: 'true' } });
      await processor.onModuleInit();

      await processor.enqueue(buildInput({ turnIndex: 5 }));

      expect(redis.setnx).toHaveBeenCalledTimes(1);
      const [key, value, ttl] = redis.setnx.mock.calls[0] as [string, string, number];
      expect(key).toBe(buildDeliberationMutexKey(TENANT, SESSION));
      // 锁的值 = 持有者标识 (本轮序号) —— 释放时靠它判断"这把锁是不是我的".
      expect(value).toBe('5');
      expect(ttl).toBe(DELIBERATION_MUTEX_TTL_SECONDS);
    });

    it('②-2 同一会话并发入队: 只有第一个进去, 后面的被拦下 (闸门 ⑤)', async () => {
      const { processor } = buildProcessor({ env: { ENGINE_DELIBERATION_ENABLED: 'true' } });
      await processor.onModuleInit();

      const first = await processor.enqueue(buildInput({ turnIndex: 1 }));
      const second = await processor.enqueue(buildInput({ turnIndex: 2 }));
      const third = await processor.enqueue(buildInput({ turnIndex: 3 }));

      expect(first).toBe(true);
      expect(second).toBe(false);
      expect(third).toBe(false);
      expect(bull.add).toHaveBeenCalledTimes(1);
    });

    it('②-3 拿不到锁 → 不入队 + 打 warn (只有定位信息, 无对话原文)', async () => {
      const { processor } = buildProcessor({ env: { ENGINE_DELIBERATION_ENABLED: 'true' } });
      await processor.onModuleInit();
      await processor.enqueue(buildInput({ turnIndex: 1 }));

      const warnings: string[] = [];
      vi.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => {
        warnings.push(typeof message === 'string' ? message : String(message));
      });

      await processor.enqueue(buildInput({ turnIndex: 2 }));

      const log = warnings.join('\n');
      expect(log).toContain('deliberation_mutex_busy');
      expect(log).toContain(SESSION);
      expect(log).not.toContain('你最近睡得怎么样');
      expect(log).not.toContain('有点累');
      vi.restoreAllMocks();
    });

    it('②-4 Redis 不可用 → 放行入队 (fail-open, 与熔断器同纪律)', async () => {
      const redis = new FakeRedis();
      redis.setnx.mockRejectedValue(new Error('redis down'));
      const { processor } = buildProcessor({ env: { ENGINE_DELIBERATION_ENABLED: 'true' }, redis });
      await processor.onModuleInit();

      const ok = await processor.enqueue(buildInput());

      expect(ok).toBe(true);
      expect(bull.add).toHaveBeenCalledTimes(1);
    });

    it('②-5 入队失败 → 立刻释放锁 (不连累这场会话后面 30 秒)', async () => {
      const { processor, redis } = buildProcessor({ env: { ENGINE_DELIBERATION_ENABLED: 'true' } });
      await processor.onModuleInit();
      bull.add.mockRejectedValueOnce(new Error('redis down'));

      const ok = await processor.enqueue(buildInput());

      expect(ok).toBe(false);
      expect(redis.del).toHaveBeenCalledWith(buildDeliberationMutexKey(TENANT, SESSION));
      expect(redis.store.get(buildDeliberationMutexKey(TENANT, SESSION))).toBeUndefined();
    });

    it.each([
      { label: '成功', mode: 'ok' },
      { label: '失败(不值得重试)', mode: 'failed' },
      { label: '意外异常(不值得重试)', mode: 'throws' },
    ])('②-6 Worker 跑完 ($label): 锁一定释放 (闸门 ⑥)', async ({ mode }) => {
      const executeShadowMode = vi.fn(async (): Promise<unknown> => {
        if (mode === 'throws') throw new Error('boom');
        if (mode === 'failed') return { kind: 'failed', errorCode: 'fetch_error', usage: null };
        return { kind: 'ok', validated: undefined, usage: null };
      });
      const { processor, redis } = buildProcessor({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        llm: { executeShadowMode } as unknown as Partial<LlmDeliberationService>,
      });
      await processor.onModuleInit();
      await processor.enqueue(buildInput({ turnIndex: 3 }));
      expect(redis.store.get(buildDeliberationMutexKey(TENANT, SESSION))).toBe('3');

      await workerProcessor()({ data: buildInput({ turnIndex: 3 }), attemptsMade: 0, opts: { attempts: 2 } });

      expect(redis.del).toHaveBeenCalledWith(buildDeliberationMutexKey(TENANT, SESSION));
      expect(redis.store.get(buildDeliberationMutexKey(TENANT, SESSION))).toBeUndefined();
    });

    it('②-7 释放时只删自己的锁 (锁值不是本轮序号 → 不删)', async () => {
      const { processor, redis } = buildProcessor({ env: { ENGINE_DELIBERATION_ENABLED: 'true' } });
      await processor.onModuleInit();
      // 假装这把锁已经被**别的**轮次拿走了 (自己的 TTL 过期后被别人重拿).
      redis.store.set(buildDeliberationMutexKey(TENANT, SESSION), '99');

      await workerProcessor()({ data: buildInput({ turnIndex: 3 }), attemptsMade: 0, opts: { attempts: 2 } });

      expect(redis.del).not.toHaveBeenCalledWith(buildDeliberationMutexKey(TENANT, SESSION));
      expect(redis.store.get(buildDeliberationMutexKey(TENANT, SESSION))).toBe('99');
    });

    it('②-8 值得重试的失败 → 锁跨重试持有 (退避窗口里不再进一个审议)', async () => {
      const executeShadowMode = vi.fn(async (): Promise<never> => {
        throw new DeliberationRetryableError('json_parse_failed', '审议失败, 值得重试: json_parse_failed');
      });
      const { processor, redis } = buildProcessor({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        llm: { executeShadowMode } as unknown as Partial<LlmDeliberationService>,
      });
      await processor.onModuleInit();
      await processor.enqueue(buildInput({ turnIndex: 3 }));

      await expect(
        workerProcessor()({ data: buildInput({ turnIndex: 3 }), attemptsMade: 0, opts: { attempts: 2 } }),
      ).rejects.toBeInstanceOf(DeliberationRetryableError);

      expect(redis.del).not.toHaveBeenCalledWith(buildDeliberationMutexKey(TENANT, SESSION));
      expect(redis.store.get(buildDeliberationMutexKey(TENANT, SESSION))).toBe('3');
    });

    it('②-9 重试次数用完 → 锁释放 (不会永久锁死)', async () => {
      const executeShadowMode = vi.fn(async (): Promise<never> => {
        throw new DeliberationRetryableError('json_parse_failed', '审议失败, 值得重试: json_parse_failed');
      });
      const { processor, redis } = buildProcessor({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        llm: { executeShadowMode } as unknown as Partial<LlmDeliberationService>,
      });
      await processor.onModuleInit();
      await processor.enqueue(buildInput({ turnIndex: 3 }));

      // attemptsMade=1 + attempts=2 → 当前已是最后一次, 不会再重试 → 锁必须释放.
      await expect(
        workerProcessor()({ data: buildInput({ turnIndex: 3 }), attemptsMade: 1, opts: { attempts: 2 } }),
      ).rejects.toBeInstanceOf(DeliberationRetryableError);

      expect(redis.del).toHaveBeenCalledWith(buildDeliberationMutexKey(TENANT, SESSION));
      expect(redis.store.get(buildDeliberationMutexKey(TENANT, SESSION))).toBeUndefined();
    });

    it('②-10 mutex key 带租户 + 会话长度前缀 (撞键防护) + TTL 兜底 (闸门 ⑦)', () => {
      const key = buildDeliberationMutexKey('a-b', 'c');
      expect(key).toBe('deliberation_mutex:3:a-b:1:c');
      expect(key.startsWith(DELIBERATION_MUTEX_KEY_PREFIX)).toBe(true);
      // 撞键防护: (租户="a-b", 会话="c") 与 (租户="a", 会话="b-c") 不能算出同一个 key.
      expect(buildDeliberationMutexKey('a', 'b-c')).not.toBe(key);
      // TTL 兜底: 进程崩了锁不会永不释放 (审议 3-8s + 重试也就 20s 顶天).
      expect(DELIBERATION_MUTEX_TTL_SECONDS).toBe(30);
    });
  });

  describe('③ 端到端: baseRevision 与 trace 一致', () => {
    it('③-1 入队时的 baseRevision 原样出现在 job 载荷与 trace 里 (闸门 ⑧)', async () => {
      const { service, set } = buildRealService({ requestJson: vi.fn().mockResolvedValue(okResult()) });
      const { processor } = buildProcessor({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        llm: {
          executeShadowMode: (input: DeliberationShadowInput) => service.executeShadowMode(input),
        } as unknown as Partial<LlmDeliberationService>,
      });
      await processor.onModuleInit();

      const input = buildInput({ baseRevision: 42 });
      await processor.enqueue(input);

      // job 载荷里的 baseRevision = 入队时的那个.
      const [, payload] = bull.add.mock.calls[0] as [string, DeliberationShadowInput, unknown];
      expect(payload.baseRevision).toBe(42);

      // worker 跑完 → trace 里记的还是同一个.
      await workerProcessor()({ data: payload, attemptsMade: 0, opts: { attempts: 2 } });

      expect(writtenRecord(set).baseRevision).toBe(42);
    });
  });

  describe('④ RedisService.setnx 的原子性契约', () => {
    it('④-1 setnx 发的是 SET ... EX ... NX (Redis 侧原子, 不是读-改-写)', async () => {
      const setSpy = vi.fn(async (): Promise<string> => 'OK');
      const service = buildRedisService(setSpy);

      await expect(service.setnx('k', 'v', 30)).resolves.toBe(true);
      expect(setSpy).toHaveBeenCalledWith('k', 'v', 'EX', 30, 'NX');
    });

    it('④-2 不给 TTL 时不带 EX; key 已存在 (Redis 返回 null) → false = 没拿到锁', async () => {
      const setSpy = vi.fn(async (): Promise<string | null> => null);
      const service = buildRedisService(setSpy);

      await expect(service.setnx('k', 'v')).resolves.toBe(false);
      expect(setSpy).toHaveBeenCalledWith('k', 'v', 'NX');
    });
  });

  describe('⑤ 隐私边界', () => {
    it('⑤-1 mutex key 与锁值不含对话原文 (只有 tenantId / sessionId / turnIndex)', async () => {
      const { processor, redis } = buildProcessor({ env: { ENGINE_DELIBERATION_ENABLED: 'true' } });
      await processor.onModuleInit();

      await processor.enqueue(buildInput({ turnIndex: 3 }));

      const [key, value] = redis.setnx.mock.calls[0];
      expect(key).not.toContain('你最近睡得怎么样');
      expect(key).not.toContain('有点累');
      expect(value).not.toContain('你最近睡得怎么样');
      expect(value).not.toContain('有点累');
      // 锁的值就是本轮序号 —— 纯数字, 不含心理内容.
      expect(value).toBe('3');
    });
  });
});
