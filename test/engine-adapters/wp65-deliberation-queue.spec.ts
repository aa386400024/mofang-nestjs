// V2026-11-05 治本 (WP65 · B 层 · 审议影子模式 BullMQ 队列化):
//   覆盖任务单 §5 的 15 条用例:
//     ① 入队路径 (4 例) —— 入队成功 / 入队失败不抛 / 开关关闭不入队 / 缺省不入队
//     ② 执行路径 (5 例) —— worker 回调真跑 / LLM 报错 / JSON 非法 / 超时 / Redis 写失败
//     ③ Worker 配置 (3 例) —— 并发从 env 读 / 非法值回退 / 关闭时 queue + worker 都关
//     ④ 边界 (3 例) —— trace 不含对话原文 / 日志只出定位信息 / 内核零审议代码
//   额外覆盖 (防漂移):
//     · jobId 幂等键: 带 turnIndex / 撞键防护 / 非法字符转义;
//     · 队列配置与仓库统一口径一致 (prefix / attempts / 退避 / removeOn*);
//     · 编排门面零改动 —— 门面只认端口, 不知道队列存在 (WP65 的核心约束).
//
//   ⚠️ V2026-11-05 (WP66 — 输出格式校验与重试) 的**语义变化** (本文件已同步):
//     · ②-5: `executeShadowMode` 现在多收一个参数 `job.attemptsMade` (重试次数);
//     · ②-7: `json_parse_failed` 属于"值得重试" → worker handler **不 catch** →
//       异常自然冒到 BullMQ (本文件原来断言"不抛", 现改为断言"抛 + trace 已写");
//     · ②-6 / ②-8: 错误码换成**真实词表**里的 `fetch_error`
//       (任务单写的 `llm_error` 根本不会被 client 产生; 超时的真实落点也是 `fetch_error`).
//     完整的重试语义见 wp66-deliberation-retry.spec.ts.
//
//   ⚠️ V2026-11-05 (WP67 — 审议熔断与降级策略) 的**接口变化**:
//     · processor 现在读 `executeShadowMode` 的**返回值**判断成败 (熔断记账用),
//       所以本文件的 service 替身改成返回结局对象;
//     · processor 还要读写**熔断状态** (Redis get/set/del), 本文件的 Redis 替身补了这三个命令.
//     熔断本身的语义见 wp67-deliberation-circuit-breaker.spec.ts.
//
//   边界: 全 mock, 不起 Nest 容器, 不发网络, 不连 Redis ——
//     bullmq (Queue / Worker) / RedisService / LLM client / ConfigService 全是极小替身.
//
//   验证: npx vitest run test/engine-adapters/wp65-deliberation-queue.spec.ts

import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CounselorLlmJsonClient } from '../../src/counselor/providers/llm-json.client.js';
import {
  DEFAULT_DELIBERATION_WORKER_CONCURRENCY,
  DELIBERATION_JOB_NAME,
  DeliberationProcessor,
  buildDeliberationJobId,
} from '../../src/engine-adapters/deliberation/deliberation.processor.js';
import {
  LlmDeliberationService,
  DeliberationRetryableError,
  type DeliberationShadowInput,
  type DeliberationTokenUsage,
  type DeliberationTraceRecord,
  type ValidatedDeliberation,
} from '../../src/engine-adapters/deliberation/llm-deliberation.service.js';
import { createEmptyBdiSnapshot, type DeltaVector } from '../../src/engine-core/index.js';
import { QUEUE_NAMES } from '../../src/shared/infra/redis/redis.constants.js';
import type { RedisService } from '../../src/shared/infra/redis/redis.service.js';

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
    baseSnapshot: createEmptyBdiSnapshot(),
    counselorText: '你最近睡得怎么样？',
    visitorText: '有点累，夜里老醒。',
    characterBrief: '依恋风格: 回避型',
    ruleDelta: RULE_DELTA,
    // WP68: 意图锁定需要知道"规则算子本轮选的策略" (门面从内核意图传进来).
    ruleStrategy: 'recounting',
    ...overrides,
  };
}

/** 装一个 processor (依赖全是极小替身). */
function buildProcessor(options: { env?: Record<string, string>; llm?: Partial<LlmDeliberationService> } = {}): {
  processor: DeliberationProcessor;
  config: ConfigService;
} {
  const env = options.env ?? {};
  const config = { get: (key: string): string | undefined => env[key] } as unknown as ConfigService;
  // ⚠️ WP67 起 processor 还要读写**熔断状态** (Redis get/set/del) —— 这里给极小替身.
  const redis = {
    getBullClient: () => ({}),
    get: vi.fn(async (): Promise<string | null> => null),
    set: vi.fn(async (): Promise<void> => {}),
    del: vi.fn(async (): Promise<number> => 0),
  } as unknown as RedisService;
  // ⚠️ WP67 起 processor 读 `executeShadowMode` 的**返回值**判断成败 → 替身必须返回结局.
  const llm = {
    executeShadowMode: vi.fn(async () => ({ kind: 'ok', validated: undefined, usage: null })),
  } as unknown as LlmDeliberationService;
  return { processor: new DeliberationProcessor(redis, { ...llm, ...options.llm } as LlmDeliberationService, config), config };
}

/** 审议成功时的 client 返回体. */
function okResult(deltas: readonly unknown[] = []): {
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
      output: { deltas: deltas as never[], summary: '来访情绪略有低落', confidence: 0.65, intentionShift: null },
      rejectedEntries: [],
    },
    rawText: '{}',
    errorCode: null,
    errorMessage: null,
    usage: { promptTokens: 1200, completionTokens: 180, totalTokens: 1380 },
  };
}

/** 审议失败时的 client 返回体. */
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
 * 执行路径的用例要验的是"跑完之后 trace 表里写了什么", 所以这里用真服务 +
 * 假依赖 —— 队列层只负责搬运, 不该改 trace 的内容.
 */
function buildRealService(options: {
  env?: Record<string, string>;
  requestJson?: ReturnType<typeof vi.fn>;
  set?: ReturnType<typeof vi.fn>;
}): {
  service: LlmDeliberationService;
  requestJson: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  config: ConfigService;
} {
  const env = options.env ?? {};
  const requestJson = options.requestJson ?? vi.fn();
  const set = options.set ?? vi.fn();
  const config = { get: (key: string): string | undefined => env[key] } as unknown as ConfigService;
  // ⚠️ WP68 起 service 还要**读**意图锁定状态 (Redis get) → 替身补上.
  const redis = { set, get: vi.fn(async (): Promise<string | null> => null) } as unknown as RedisService;
  const llm = { requestJson } as unknown as CounselorLlmJsonClient;
  return { service: new LlmDeliberationService(llm, config, redis), requestJson, set, config };
}

/** 从 set 的调用参数里取出写进去的 trace 记录. */
function writtenRecord(set: ReturnType<typeof vi.fn>): DeliberationTraceRecord {
  const [, value] = set.mock.calls[0] as [string, string];
  return JSON.parse(value) as DeliberationTraceRecord;
}

/** 取 Worker 注册的处理函数 (init 之后才有; 取**最后一次**构造的那个). */
function workerProcessor(): (job: unknown) => Promise<void> {
  const calls = bull.workerCtor.mock.calls as [string, (job: unknown) => Promise<void>, unknown][];
  const call = calls.at(-1);
  return call[1];
}

/** 取 Worker 注册的 'failed' 监听器. */
function workerFailedHandler(): (job: unknown, err: Error) => void {
  const calls = bull.workerOn.mock.calls as [string, (job: unknown, err: Error) => void][];
  const call = calls.at(-1);
  return call[1];
}

/** 取 Queue 构造时传的 options (最后一次构造). */
function queueOptions(): { connection: unknown; prefix: string; defaultJobOptions: Record<string, unknown> } {
  const calls = bull.queueCtor.mock.calls as [
    string,
    { connection: unknown; prefix: string; defaultJobOptions: Record<string, unknown> },
  ][];
  const call = calls.at(-1);
  return call[1];
}

/** 取 Worker 构造时传的 options (最后一次构造). */
function workerOptions(): { connection: unknown; prefix: string; concurrency: number } {
  const calls = bull.workerCtor.mock.calls as [string, unknown, { connection: unknown; prefix: string; concurrency: number }][];
  const call = calls.at(-1);
  return call[2];
}

beforeEach(() => {
  bull.add.mockClear();
  bull.queueClose.mockClear();
  bull.workerClose.mockClear();
  bull.workerOn.mockClear();
  bull.queueCtor.mockClear();
  bull.workerCtor.mockClear();
});

describe('WP65 · 审议影子模式 BullMQ 队列化', () => {
  describe('① 入队路径 (4 例)', () => {
    it('①-1 runShadowMode() 入队成功: queue.add 被调一次, 参数正确', async () => {
      const { processor } = buildProcessor({ env: { ENGINE_DELIBERATION_ENABLED: 'true' } });
      await processor.onModuleInit();

      const input = buildInput();
      await processor.runShadowMode(input);

      expect(bull.add).toHaveBeenCalledTimes(1);
      const [name, data, opts] = bull.add.mock.calls[0] as [string, DeliberationShadowInput, { jobId: string }];
      expect(name).toBe(DELIBERATION_JOB_NAME);
      expect(data).toEqual(input);
      // jobId 必须带 turnIndex —— 否则第 2 轮起会被 BullMQ 静默去重丢弃.
      expect(opts.jobId).toContain(String(input.turnIndex));
    });

    it('①-2 入队失败 (queue.add 抛错): 不抛回调用方, 只打 warn', async () => {
      const { processor } = buildProcessor({ env: { ENGINE_DELIBERATION_ENABLED: 'true' } });
      await processor.onModuleInit();
      bull.add.mockRejectedValueOnce(new Error('redis down'));

      const warnings: string[] = [];
      vi.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => {
        warnings.push(typeof message === 'string' ? message : String(message));
      });

      await expect(processor.runShadowMode(buildInput())).resolves.toBeUndefined();

      expect(warnings.join('\n')).toContain('deliberation_enqueue_failed');
      expect(warnings.join('\n')).toContain(SESSION);
      vi.restoreAllMocks();
    });

    it('①-3 开关关闭时 (ENGINE_DELIBERATION_ENABLED=false): 不入队', async () => {
      const { processor } = buildProcessor({ env: { ENGINE_DELIBERATION_ENABLED: 'false' } });
      await processor.onModuleInit();

      await processor.runShadowMode(buildInput());

      expect(bull.add).not.toHaveBeenCalled();
    });

    it('①-4 缺省 (不配 env) 时也是关的: 不入队', async () => {
      const { processor } = buildProcessor({ env: {} });
      await processor.onModuleInit();

      await processor.runShadowMode(buildInput());

      expect(bull.add).not.toHaveBeenCalled();
    });
  });

  describe('② 执行路径 (5 例)', () => {
    it('②-5 Worker 回调真跑: executeShadowMode 被调, 参数 = job.data + job.attemptsMade', async () => {
      const executeShadowMode = vi.fn().mockResolvedValue({ kind: 'ok', validated: undefined, usage: null });
      const { processor } = buildProcessor({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        llm: { executeShadowMode } as unknown as Partial<LlmDeliberationService>,
      });
      await processor.onModuleInit();

      const input = buildInput();
      await workerProcessor()({ data: input, attemptsMade: 0 });

      expect(executeShadowMode).toHaveBeenCalledTimes(1);
      expect(executeShadowMode).toHaveBeenCalledWith(input, 0);
    });

    it('②-6 LLM 报错 (真实码 fetch_error): 写失败 trace (ok=false + errorCode), 不抛', async () => {
      const { service, set } = buildRealService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockResolvedValue(failResult('fetch_error')),
      });
      const { processor } = buildProcessor({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        llm: {
          executeShadowMode: (input: DeliberationShadowInput) => service.executeShadowMode(input),
        } as unknown as Partial<LlmDeliberationService>,
      });
      await processor.onModuleInit();

      await expect(workerProcessor()({ data: buildInput() })).resolves.toBeUndefined();

      const record = writtenRecord(set);
      expect(record.ok).toBe(false);
      expect(record.errorCode).toBe('fetch_error');
    });

    it('②-7 JSON 解析失败: 写失败 trace, **并抛** DeliberationRetryableError (WP66: 形状类值得重试)', async () => {
      const { service, set } = buildRealService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockResolvedValue(failResult('json_parse_failed')),
      });
      const { processor } = buildProcessor({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        llm: {
          executeShadowMode: (input: DeliberationShadowInput) => service.executeShadowMode(input),
        } as unknown as Partial<LlmDeliberationService>,
      });
      await processor.onModuleInit();

      await expect(workerProcessor()({ data: buildInput() })).rejects.toBeInstanceOf(DeliberationRetryableError);

      // 先写 trace 再抛 —— 失败记录不丢.
      const record = writtenRecord(set);
      expect(record.ok).toBe(false);
      expect(record.errorCode).toBe('json_parse_failed');
    });

    it('②-8 超时 (真实码 fetch_error): 写失败 trace, 不抛 (不值得重试)', async () => {
      const { service, set } = buildRealService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockResolvedValue(failResult('fetch_error')),
      });
      const { processor } = buildProcessor({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        llm: {
          executeShadowMode: (input: DeliberationShadowInput) => service.executeShadowMode(input),
        } as unknown as Partial<LlmDeliberationService>,
      });
      await processor.onModuleInit();

      await expect(workerProcessor()({ data: buildInput() })).resolves.toBeUndefined();

      const record = writtenRecord(set);
      expect(record.ok).toBe(false);
      expect(record.errorCode).not.toBeNull();
    });

    it('②-9 Redis 写 trace 失败: 只打日志, 不抛 (观察面写不进去不是会话失败)', async () => {
      const set = vi.fn().mockRejectedValue(new Error('redis down'));
      const { service } = buildRealService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockResolvedValue(okResult()),
        set,
      });
      const { processor } = buildProcessor({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        llm: {
          executeShadowMode: (input: DeliberationShadowInput) => service.executeShadowMode(input),
        } as unknown as Partial<LlmDeliberationService>,
      });
      await processor.onModuleInit();

      await expect(workerProcessor()({ data: buildInput() })).resolves.toBeUndefined();
    });
  });

  describe('③ Worker 配置 (3 例)', () => {
    it('③-10 并发数从 env 读; 缺省 = 3', async () => {
      const { processor } = buildProcessor({ env: { ENGINE_DELIBERATION_WORKER_CONCURRENCY: '7' } });
      await processor.onModuleInit();
      expect(workerOptions().concurrency).toBe(7);

      const { processor: fallback } = buildProcessor({ env: {} });
      await fallback.onModuleInit();
      expect(workerOptions().concurrency).toBe(DEFAULT_DELIBERATION_WORKER_CONCURRENCY);
      expect(workerOptions().concurrency).toBe(3);
    });

    it('③-11 env 配非法值时回退默认 3, 不抛错', async () => {
      for (const value of ['', '  ', 'abc', '0', '-2']) {
        const { processor } = buildProcessor({ env: { ENGINE_DELIBERATION_WORKER_CONCURRENCY: value } });
        await expect(processor.onModuleInit()).resolves.toBeUndefined();
        expect(workerOptions().concurrency).toBe(DEFAULT_DELIBERATION_WORKER_CONCURRENCY);
      }
    });

    it('③-12 onModuleDestroy: Worker 和 Queue 都关闭', async () => {
      const { processor } = buildProcessor({ env: { ENGINE_DELIBERATION_ENABLED: 'true' } });
      await processor.onModuleInit();

      await processor.onModuleDestroy();

      expect(bull.workerClose).toHaveBeenCalledTimes(1);
      expect(bull.queueClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('④ 边界 (3 例)', () => {
    it('④-13 trace **不存**对话原文 (只存模型产出的判断)', async () => {
      const { service, set } = buildRealService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockResolvedValue(okResult()),
      });
      const { processor } = buildProcessor({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        llm: {
          executeShadowMode: (input: DeliberationShadowInput) => service.executeShadowMode(input),
        } as unknown as Partial<LlmDeliberationService>,
      });
      await processor.onModuleInit();

      await workerProcessor()({ data: buildInput({ counselorText: '来访者原话', visitorText: '来访回应原话' }) });

      const [, value] = set.mock.calls[0] as [string, string];
      expect(value).not.toContain('来访者原话');
      expect(value).not.toContain('来访回应原话');
    });

    it('④-14 日志里只出 sessionId / turnIndex / 错误码, 不出审议原文', async () => {
      const logs: string[] = [];
      vi.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => {
        logs.push(typeof message === 'string' ? message : String(message));
      });
      vi.spyOn(Logger.prototype, 'error').mockImplementation((message: unknown) => {
        logs.push(typeof message === 'string' ? message : String(message));
      });

      const { processor } = buildProcessor({ env: { ENGINE_DELIBERATION_ENABLED: 'true' } });
      await processor.onModuleInit();

      // ① 入队失败 → warn
      bull.add.mockRejectedValueOnce(new Error('redis down'));
      await processor.runShadowMode(buildInput({ counselorText: '我最近很想自杀' }));

      // ② job 失败 → error
      workerFailedHandler()({ id: 'job-1', data: buildInput({ visitorText: '我也想死' }) }, new Error('boom'));

      const joined = logs.join('\n');
      expect(joined).not.toContain('我最近很想自杀');
      expect(joined).not.toContain('我也想死');
      expect(joined).toContain(SESSION);
      expect(joined).toContain('turn=3');
      vi.restoreAllMocks();
    });

    it('④-15 内核树里零审议代码 (审议层完全在适配层 —— 内核零改动)', () => {
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

      expect(hits).toEqual([]);
    });
  });

  describe('⑤ 防漂移 (队列口径 / 幂等键 / 门面零改动)', () => {
    it('⑤-a 队列配置与仓库统一口径一致 (队列名 / prefix / attempts / 退避 / removeOn*)', async () => {
      const { processor } = buildProcessor({ env: { ENGINE_DELIBERATION_ENABLED: 'true' } });
      await processor.onModuleInit();

      const queueName = bull.queueCtor.mock.calls[0][0] as string;
      expect(queueName).toBe(QUEUE_NAMES.deliberation);
      expect(queueName).toBe('deliberation-shadow');

      const options = queueOptions();
      expect(options.prefix).toBe('bullmq');
      expect(options.defaultJobOptions.attempts).toBe(3);
      expect(options.defaultJobOptions.backoff).toEqual({ type: 'exponential', delay: 1000 });
      expect(options.defaultJobOptions.removeOnComplete).toEqual({ count: 1000, age: 24 * 3600 });
      expect(options.defaultJobOptions.removeOnFail).toEqual({ count: 5000 });

      // Worker 与 Queue 必须同前缀同连接 —— 不同前缀 = 两个互不相干的队列.
      expect(workerOptions().prefix).toBe('bullmq');
      expect(workerOptions().connection).toBe(options.connection);
    });

    it('⑤-b jobId 幂等键: 带 turnIndex / 同轮同 id / 异轮异 id / 不含非法字符', () => {
      const first = buildDeliberationJobId(TENANT, SESSION, 3);
      const same = buildDeliberationJobId(TENANT, SESSION, 3);
      const next = buildDeliberationJobId(TENANT, SESSION, 4);

      expect(first).toBe(same);
      expect(first).not.toBe(next);
      expect(first).toContain('-3');
      expect(first).not.toContain(':');
    });

    it('⑤-c jobId 撞键防护: (租户="a-b", 会话="c") 与 (租户="a", 会话="b-c") 算出不同 id', () => {
      const left = buildDeliberationJobId('a-b', 'c', 1);
      const right = buildDeliberationJobId('a', 'b-c', 1);
      expect(left).not.toBe(right);
    });

    it('⑤-d jobId 转义是单射: 字面量 "%3A" 与 ":" 不能算出同一个 id', () => {
      const literal = buildDeliberationJobId('a%3Ab', 'c', 1);
      const colon = buildDeliberationJobId('a:b', 'c', 1);
      expect(literal).not.toBe(colon);
      expect(literal).not.toContain(':');
      expect(colon).not.toContain(':');
    });

    it('⑤-e 编排门面零改动: 门面只认端口, 不知道队列的存在', () => {
      const source = readFileSync(path.join(__dirname, '../../src/engine-adapters/rendering/turn-render-orchestrator.ts'), 'utf8');
      expect(source).toContain('DeliberationShadowPort');
      expect(source).not.toContain('DeliberationProcessor');
      expect(source).not.toContain('bullmq');
    });
  });
});
