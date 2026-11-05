// V2026-11-05 治本 (WP66 · B 层 · 审议输出格式校验与重试):
//   覆盖任务单 §5 的 13 条 + 若干防漂移用例:
//     ① 重试触发逻辑 (4 例) —— 形状类错误码抛 DeliberationRetryableError / 非重试类不抛
//     ② trace 记录 (3 例) —— retryCount 写入 / 先写 trace 再抛
//     ③ 配置 (3 例) —— 重试次数默认值 / 非法值回退 / job 级 attempts
//     ④ 边界 (3 例) —— 开关关闭不跑 / Worker handler 不 catch / 内核零改动
//   额外覆盖 (防漂移):
//     · `isRetryableDeliberationError` 的表驱动判定 (含真实词表里那些码);
//     · 重试成功后 **覆盖** 之前的失败 trace (任务单 D3);
//     · 全项目统一的 defaultJobOptions **一个字没动** (attempts 仍是 3).
//
//   ⚠️ 关于"错误码"的口径 (与任务单的出入, 见交付记录 §2.1):
//     真实错误码词表 (由 `CounselorLlmJsonClient` + `LlmService` 决定):
//       · client 自身: json_not_found / json_parse_failed / schema_validation_failed
//       · 上游 chunk 透传: http_401 / http_429 / http_500… / no_body / parse_error / fetch_error
//     任务单表里的 `timeout` **不存在** (超时落到 catch-all 的 `fetch_error`),
//     `llm_error` 也从不作为 errorCode 产生 —— 所以本文件按**真实码**写用例.
//
//   边界: 全 mock, 不起 Nest 容器, 不发网络, 不连 Redis ——
//     bullmq (Queue/Worker) / RedisService / LLM client / ConfigService 全是极小替身.
//
//   验证: npx vitest run test/engine-adapters/wp66-deliberation-retry.spec.ts

import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CounselorLlmJsonClient } from '../../src/counselor/providers/llm-json.client.js';
import {
  DEFAULT_DELIBERATION_MAX_RETRIES,
  DELIBERATION_JOB_NAME,
  DeliberationProcessor,
} from '../../src/engine-adapters/deliberation/deliberation.processor.js';
import {
  DELIBERATION_RETRYABLE_ERROR_CODES,
  DeliberationRetryableError,
  LlmDeliberationService,
  isRetryableDeliberationError,
  type DeliberationShadowInput,
  type DeliberationTokenUsage,
  type DeliberationTraceRecord,
  type ValidatedDeliberation,
} from '../../src/engine-adapters/deliberation/llm-deliberation.service.js';
import { createEmptyBdiSnapshot, type DeltaVector } from '../../src/engine-core/index.js';
import { QUEUE_NAMES } from '../../src/shared/infra/redis/redis.constants.js';
import type { RedisService } from '../../src/shared/infra/redis/redis.service.js';

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
    ...overrides,
  };
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
      output: { deltas: deltas as never[], summary: '来访情绪略有低落', confidence: 0.65 },
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

/** 装一个**真的**审议服务 (LLM client / Redis / ConfigService 全是替身). */
function buildService(options: { env?: Record<string, string>; requestJson?: ReturnType<typeof vi.fn>; set?: ReturnType<typeof vi.fn> }): {
  service: LlmDeliberationService;
  requestJson: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
} {
  const env = options.env ?? {};
  const requestJson = options.requestJson ?? vi.fn();
  const set = options.set ?? vi.fn();
  const config = { get: (key: string): string | undefined => env[key] } as unknown as ConfigService;
  const redis = { set } as unknown as RedisService;
  const llm = { requestJson } as unknown as CounselorLlmJsonClient;
  return { service: new LlmDeliberationService(llm, config, redis), requestJson, set };
}

/** 装一个 processor (依赖全是极小替身). */
function buildProcessor(options: { env?: Record<string, string>; executeShadowMode?: ReturnType<typeof vi.fn> }): {
  processor: DeliberationProcessor;
} {
  const env = options.env ?? {};
  const config = { get: (key: string): string | undefined => env[key] } as unknown as ConfigService;
  const redis = { getBullClient: () => ({}) } as unknown as RedisService;
  const llm = { executeShadowMode: options.executeShadowMode ?? vi.fn() } as unknown as LlmDeliberationService;
  return { processor: new DeliberationProcessor(redis, llm, config) };
}

/** 从 set 的调用参数里取出写进去的 trace 记录. */
function writtenRecord(set: ReturnType<typeof vi.fn>, index = 0): DeliberationTraceRecord {
  const [, value] = set.mock.calls[index] as [string, string];
  return JSON.parse(value) as DeliberationTraceRecord;
}

/** 取 Worker 注册的处理函数 (最后一次构造的那个). */
function workerProcessor(): (job: unknown) => Promise<void> {
  const calls = bull.workerCtor.mock.calls as [string, (job: unknown) => Promise<void>, unknown][];
  const call = calls.at(-1);
  return call[1];
}

/** 取 Queue 构造时传的 options (最后一次构造). */
function queueOptions(): { prefix: string; defaultJobOptions: Record<string, unknown> } {
  const calls = bull.queueCtor.mock.calls as [string, { prefix: string; defaultJobOptions: Record<string, unknown> }][];
  const call = calls.at(-1);
  return call[1];
}

/** 取 enqueue 时传给 queue.add 的 job 选项. */
function jobOptions(): { jobId: string; attempts: number; backoff: { type: string; delay: number } } {
  const calls = bull.add.mock.calls as [string, unknown, { jobId: string; attempts: number; backoff: { type: string; delay: number } }][];
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

describe('WP66 · 审议输出格式校验与重试', () => {
  describe('① 重试触发逻辑 (4 例)', () => {
    it('①-1 json_parse_failed → 抛 DeliberationRetryableError', async () => {
      const { service } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockResolvedValue(failResult('json_parse_failed')),
      });

      const error = await service.executeShadowMode(buildInput()).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(DeliberationRetryableError);
      expect((error as DeliberationRetryableError).errorCode).toBe('json_parse_failed');
    });

    it('①-2 schema_validation_failed → 抛 DeliberationRetryableError', async () => {
      const { service } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockResolvedValue(failResult('schema_validation_failed')),
      });

      const error = await service.executeShadowMode(buildInput()).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(DeliberationRetryableError);
      expect((error as DeliberationRetryableError).errorCode).toBe('schema_validation_failed');
    });

    it('①-3 网络/超时类 (fetch_error —— 真实词表里超时的落点) → 不抛, 正常完成', async () => {
      const { service, set } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockResolvedValue(failResult('fetch_error')),
      });

      await expect(service.executeShadowMode(buildInput())).resolves.toBeUndefined();

      expect(writtenRecord(set).errorCode).toBe('fetch_error');
    });

    it('①-4 鉴权类 (http_401) → 不抛, 正常完成 (重试也过不去)', async () => {
      const { service, set } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockResolvedValue(failResult('http_401')),
      });

      await expect(service.executeShadowMode(buildInput())).resolves.toBeUndefined();

      expect(writtenRecord(set).errorCode).toBe('http_401');
    });
  });

  describe('② trace 记录 (3 例)', () => {
    it('②-5 失败时 trace 里 retryCount = 传入的值', async () => {
      const { service, set } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockResolvedValue(failResult('json_parse_failed')),
      });

      await service.executeShadowMode(buildInput(), 2).catch(() => {});

      expect(writtenRecord(set).retryCount).toBe(2);
    });

    it('②-6 成功时 trace 里 retryCount = 传入的值', async () => {
      const { service, set } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockResolvedValue(okResult()),
      });

      await service.executeShadowMode(buildInput(), 1);

      const record = writtenRecord(set);
      expect(record.ok).toBe(true);
      expect(record.retryCount).toBe(1);
    });

    it('②-7 先写 trace 再抛异常 —— 抛了也要留下失败记录', async () => {
      const { service, set } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockResolvedValue(failResult('schema_validation_failed')),
      });

      await expect(service.executeShadowMode(buildInput())).rejects.toBeInstanceOf(DeliberationRetryableError);

      expect(set).toHaveBeenCalledTimes(1);
      const record = writtenRecord(set);
      expect(record.ok).toBe(false);
      expect(record.errorCode).toBe('schema_validation_failed');
    });
  });

  describe('③ 配置 (3 例)', () => {
    it('③-8 ENGINE_DELIBERATION_MAX_RETRIES 默认 1 (总共跑 2 次)', async () => {
      const { processor } = buildProcessor({ env: {} });
      await processor.onModuleInit();

      await processor.enqueue(buildInput());

      expect(jobOptions().attempts).toBe(DEFAULT_DELIBERATION_MAX_RETRIES + 1);
      expect(jobOptions().attempts).toBe(2);
    });

    it('③-9 env 配非法值时回退默认 1, 不抛错', async () => {
      for (const value of ['', '  ', 'abc', '-1', 'NaN']) {
        const { processor } = buildProcessor({ env: { ENGINE_DELIBERATION_MAX_RETRIES: value } });
        await expect(processor.onModuleInit()).resolves.toBeUndefined();
        await processor.enqueue(buildInput());
        expect(jobOptions().attempts).toBe(2);
      }
    });

    it('③-10 enqueue 时 job 级 attempts = maxRetries + 1; 全项目 defaultJobOptions 不动', async () => {
      const { processor } = buildProcessor({ env: { ENGINE_DELIBERATION_MAX_RETRIES: '3' } });
      await processor.onModuleInit();

      await processor.enqueue(buildInput());

      expect(jobOptions().attempts).toBe(4);
      expect(jobOptions().backoff).toEqual({ type: 'exponential', delay: 1000 });
      // 全项目统一的 defaultJobOptions **一个字没动** —— 只在本 job 上覆盖.
      expect(queueOptions().defaultJobOptions.attempts).toBe(3);
      expect(queueOptions().prefix).toBe('bullmq');
    });
  });

  describe('④ 边界 (3 例)', () => {
    it('④-11 开关关闭时: 不跑 LLM, 不抛异常, 不触发重试', async () => {
      const { service, requestJson, set } = buildService({ env: { ENGINE_DELIBERATION_ENABLED: 'false' } });

      await expect(service.executeShadowMode(buildInput())).resolves.toBeUndefined();

      expect(requestJson).not.toHaveBeenCalled();
      expect(set).not.toHaveBeenCalled();
    });

    it('④-12 Worker handler 不 catch DeliberationRetryableError —— 让 BullMQ 自动处理', async () => {
      const executeShadowMode = vi.fn().mockRejectedValue(new DeliberationRetryableError('json_parse_failed', 'boom'));
      const { processor } = buildProcessor({ env: { ENGINE_DELIBERATION_ENABLED: 'true' }, executeShadowMode });
      await processor.onModuleInit();

      await expect(workerProcessor()({ data: buildInput(), attemptsMade: 0 })).rejects.toBeInstanceOf(DeliberationRetryableError);
    });

    it('④-13 内核树里零审议代码 (审议层完全在适配层 —— 内核零改动)', () => {
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

  describe('⑤ 防漂移 (错误码判定 / 覆盖语义 / 编排门面零改动)', () => {
    it('⑤-a 值得重试的码: 形状类 + 限流 + 5xx', () => {
      // 形状类
      expect(isRetryableDeliberationError('json_not_found')).toBe(true);
      expect(isRetryableDeliberationError('json_parse_failed')).toBe(true);
      expect(isRetryableDeliberationError('schema_validation_failed')).toBe(true);
      expect(isRetryableDeliberationError('parse_error')).toBe(true);
      // 限流 + 5xx
      expect(isRetryableDeliberationError('http_429')).toBe(true);
      expect(isRetryableDeliberationError('http_500')).toBe(true);
      expect(isRetryableDeliberationError('http_502')).toBe(true);
      expect(isRetryableDeliberationError('http_503')).toBe(true);
    });

    it('⑤-b 不值得重试的码: 鉴权 / 网络超时 / 空响应 / 未知 / 空', () => {
      expect(isRetryableDeliberationError('http_401')).toBe(false);
      expect(isRetryableDeliberationError('http_403')).toBe(false);
      expect(isRetryableDeliberationError('fetch_error')).toBe(false);
      expect(isRetryableDeliberationError('no_body')).toBe(false);
      expect(isRetryableDeliberationError('unknown')).toBe(false);
      expect(isRetryableDeliberationError('shadow_exception')).toBe(false);
      expect(isRetryableDeliberationError(null)).toBe(false);
      expect(isRetryableDeliberationError('')).toBe(false);
    });

    it('⑤-c 判定大小写不敏感; 常量集合是唯一的真相源', () => {
      expect(isRetryableDeliberationError('JSON_PARSE_FAILED')).toBe(true);
      expect(isRetryableDeliberationError('  http_429  ')).toBe(true);
      expect([...DELIBERATION_RETRYABLE_ERROR_CODES]).toContain('json_not_found');
      expect([...DELIBERATION_RETRYABLE_ERROR_CODES]).not.toContain('timeout');
      expect([...DELIBERATION_RETRYABLE_ERROR_CODES]).not.toContain('llm_error');
    });

    it('⑤-d 客户端抛异常 (代码 bug) → 记失败 trace, 不抛, 不重试', async () => {
      const { service, set } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockRejectedValue(new Error('transport down')),
      });

      await expect(service.executeShadowMode(buildInput())).resolves.toBeUndefined();

      const record = writtenRecord(set);
      expect(record.ok).toBe(false);
      expect(record.errorCode).toBe('shadow_exception');
    });

    it('⑤-e 重试成功后覆盖之前的失败 trace (任务单 D3: 只留最终结果)', async () => {
      const { service, set } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockResolvedValueOnce(failResult('json_parse_failed')).mockResolvedValueOnce(okResult()),
      });

      await service.executeShadowMode(buildInput(), 0).catch(() => {});
      await service.executeShadowMode(buildInput(), 1);

      expect(set).toHaveBeenCalledTimes(2);
      // 同一个 trace key → 后写覆盖前写, 最后留的是成功那条.
      const keys = set.mock.calls.map((call) => (call as [string, string])[0]);
      expect(new Set(keys).size).toBe(1);
      expect(writtenRecord(set, 0).ok).toBe(false);
      expect(writtenRecord(set, 1).ok).toBe(true);
      expect(writtenRecord(set, 1).retryCount).toBe(1);
    });

    it('⑤-f processJob 把 job.attemptsMade 当 retryCount 传下去', async () => {
      const executeShadowMode = vi.fn().mockResolvedValue();
      const { processor } = buildProcessor({ env: { ENGINE_DELIBERATION_ENABLED: 'true' }, executeShadowMode });
      await processor.onModuleInit();

      const input = buildInput();
      await workerProcessor()({ data: input, attemptsMade: 1 });

      expect(executeShadowMode).toHaveBeenCalledWith(input, 1);
    });

    it('⑤-g 编排门面零改动: 门面只认端口, 不知道重试的存在', () => {
      const source = readFileSync(path.join(__dirname, '../../src/engine-adapters/rendering/turn-render-orchestrator.ts'), 'utf8');
      expect(source).toContain('DeliberationShadowPort');
      expect(source).not.toContain('DeliberationProcessor');
      expect(source).not.toContain('bullmq');
      expect(source).not.toContain('Retryable');
    });

    it('⑤-h 队列名与 job 名不变 (WP65 的契约不被 WP66 改动)', async () => {
      const { processor } = buildProcessor({ env: { ENGINE_DELIBERATION_ENABLED: 'true' } });
      await processor.onModuleInit();

      const calls = bull.queueCtor.mock.calls as [string, unknown][];
      expect(calls[0][0]).toBe(QUEUE_NAMES.deliberation);
      expect(QUEUE_NAMES.deliberation).toBe('deliberation-shadow');
      expect(DELIBERATION_JOB_NAME).toBe('shadow');
    });
  });
});
