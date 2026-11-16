// V2026-11-07 治本 (过期判定与丢弃 · 切灰度前置安全网):
//   审议跑完后 load 一次当前快照的 revision, 对比 baseRevision.
//   不一致 = 快照变了 = 审议结果过期了 (它是在旧快照上算出来的).
//
//   覆盖清单:
//     ① 判定口径 (currentRevision vs baseRevision) 4 例
//     ② 保守兜底 (load 失败 / 会话不存在) 2 例
//     ③ trace 形状 (成功 / 失败一致) 3 例
//     ④ 端到端 (真实仓储 + 真实轮次推进) 3 例
//     ⑤ 锚 R1 的口径 (本轮落库后 = R1, 不是 R0) 2 例
//     ⑥ 隐私边界 1 例
//     ⑦ DI 契约 (接口不能当 token) 1 例
//
//   ⚠️ **锚 R1 不是 R0** (本单最容易搞混的地方):
//     R1 = 本轮**落库后**的版本; 本轮**开始时**的那份 (baseSnapshot) 是 R0 = R1 - 1.
//     审议在本轮落库**之后**才入队 → 回来时当前版本必然 >= R1.
//     若锚 R0, 判定会**永远**为"过期" (回来时已经是 R1 了) —— 切灰度后审议结果全被丢弃.
//
//   边界: 全 mock, 不起 Nest 容器, 不发网络, 不连 Redis ——
//     LLM client / Redis / ConfigService / BDI 仓储全是极小替身.
//
//   验证: npx vitest run test/engine-adapters/wp-deliberation-stale-check.spec.ts

import type { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { buildTestStructuredInput } from './deliberation-fixtures.js';
import type { CounselorLlmJsonClient } from '../../src/counselor/providers/llm-json.client.js';
import {
  LlmDeliberationService,
  type DeliberationTraceRecord,
  type DeliberationShadowInput,
} from '../../src/engine-adapters/deliberation/llm-deliberation.service.js';
import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository.js';
import { createEmptyBdiSnapshot, type BdiStateRepository, type DeltaVector } from '../../src/engine-core/index.js';
import type { RedisService } from '../../src/shared/infra/redis/redis.service.js';

// TD-10 · T-2: 真实 ioredis 不进 import 阶段 (适配层仍是真实现; 替身口径见 test/helpers/sdk-stubs.ts).
vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../helpers/sdk-stubs.js');
  return createIoredisStub();
});

const TENANT = 'tenant-1';
const SESSION = 'session-1';
const USER = 'user-1';

/** 规则算子这一轮的实际 delta (测试基准). */
const RULE_DELTA: DeltaVector = {
  trust: 0.1,
  safety: 0.02,
  bond: 0.01,
  valence: -0.01,
  arousal: 0,
  verbal: 0,
  depth: 0,
  style: 0,
  positive: 0.05,
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
    baseRevision: 7,
    mode: 'freeform',
    // WP-A: 结构化输入 (零对话原文) —— 走真实的装配函数.
    structured: buildTestStructuredInput({
      counselorText: '你最近睡得怎么样？',
      visitorText: '有点累，夜里老醒。',
      characterBrief: '依恋风格: 回避型',
      ruleStrategy: 'recounting',
    }),
    ruleDelta: RULE_DELTA,
    ...overrides,
  };
}

/**
 * 装一个审议服务 (四个依赖全是极小替身).
 *
 * @param bdiStates BDI 状态仓储替身 —— 过期判定读它
 */
function buildService(
  options: {
    bdiStates?: BdiStateRepository;
    requestJson?: ReturnType<typeof vi.fn>;
  } = {},
): {
  service: LlmDeliberationService;
  set: ReturnType<typeof vi.fn>;
} {
  const set = vi.fn();
  const env: Record<string, string> = { ENGINE_DELIBERATION_ENABLED: 'true' };
  const config = { get: (key: string): string | undefined => env[key] } as unknown as ConfigService;
  // ⚠️ service 还要**读**意图锁定状态 (Redis get) → 替身补上.
  // ⚠️ V2026-11-07 起 service 写 trace 时**同步累加统计计数器** (getClient().eval) → 替身补上.
  const redis = {
    set,
    get: vi.fn(async (): Promise<string | null> => null),
    getClient: () => ({ eval: vi.fn(async (): Promise<number> => 1) }),
  } as unknown as RedisService;
  const requestJson =
    options.requestJson ??
    vi.fn(async () => ({
      ok: true,
      data: {
        output: {
          deltas: [],
          summary: '来访情绪略有松动',
          confidence: 0.7,
          intentionShift: null,
        },
        rejectedEntries: [],
      },
      rawText: '{}',
      errorCode: null,
      errorMessage: null,
      usage: { promptTokens: 1200, completionTokens: 180, totalTokens: 1380 },
    }));
  const llm = { requestJson } as unknown as CounselorLlmJsonClient;
  // ⚠️ 过期判定要**读** BDI 状态仓储 → 替身补上 (默认读不到 = 保守兜底).
  const bdiStates = options.bdiStates ?? ({ load: vi.fn(async () => null) } as unknown as BdiStateRepository);
  return { service: new LlmDeliberationService(llm, config, redis, bdiStates), set };
}

/** 从 set 的调用参数里取出写进去的 trace 记录 (trace 是第一个 set —— 锁状态排在它后面). */
function writtenRecord(set: ReturnType<typeof vi.fn>): DeliberationTraceRecord {
  const [, value] = set.mock.calls[0] as [string, string];
  return JSON.parse(value) as DeliberationTraceRecord;
}

/** 造一个"审议失败"的 LLM 替身 (指定错误码). */
function failingRequestJson(errorCode: string): ReturnType<typeof vi.fn> {
  return vi.fn(async () => ({
    ok: false,
    data: null,
    rawText: '{}',
    errorCode,
    errorMessage: 'LLM 调用失败',
    usage: null,
  }));
}

/** 造一个"当前快照在某个 revision"的仓储替身. */
function repoAtRevision(revision: number): BdiStateRepository {
  return {
    load: vi.fn(async () => ({
      tenantId: TENANT,
      sessionId: SESSION,
      revision,
      updatedAt: Date.now(),
      snapshot: createEmptyBdiSnapshot(),
    })),
    save: vi.fn(),
  };
}

describe('过期判定与丢弃 · 审议结果快照版本校验', () => {
  describe('① 判定口径 (currentRevision vs baseRevision)', () => {
    // 表驱动: (当前版本, 期望 stale, 期望记进 trace 的 currentRevision).
    //   ⚠️ 口径: > 判过期; === 不判; < 防御性地不判 (不可能发生).
    it.each([
      { revision: 9, stale: true, current: 9, why: '中间又跑了几轮' },
      { revision: 8, stale: true, current: 8, why: '边界: 刚好差一版' },
      { revision: 7, stale: false, current: 7, why: '中间没跑别的轮次' },
      { revision: 3, stale: false, current: 3, why: '小于 baseRevision (防御性)' },
    ])('① currentRevision=$revision (baseRevision=7) → stale=$stale ($why)', async ({ revision, stale, current }) => {
      const { service, set } = buildService({ bdiStates: repoAtRevision(revision) });
      await service.executeShadowMode(buildInput({ baseRevision: 7 }));
      const record = writtenRecord(set);
      expect(record.stale).toBe(stale);
      expect(record.currentRevision).toBe(current);
    });
  });

  describe('② 保守兜底 (load 失败 / 会话不存在)', () => {
    it('②-1 load 抛错 → stale: false + currentRevision: null (宁可误判没过期, 不误杀)', async () => {
      const failing = {
        load: vi.fn(async () => {
          throw new Error('redis down');
        }),
        save: vi.fn(),
      } as unknown as BdiStateRepository;
      const { service, set } = buildService({ bdiStates: failing });
      await service.executeShadowMode(buildInput({ baseRevision: 7 }));
      const record = writtenRecord(set);
      expect(record.stale).toBe(false);
      expect(record.currentRevision).toBeNull();
    });

    it('②-2 load 返回 null (会话不存在) → stale: false + currentRevision: null', async () => {
      const missing = {
        load: vi.fn(async () => null),
        save: vi.fn(),
      } as unknown as BdiStateRepository;
      const { service, set } = buildService({ bdiStates: missing });
      await service.executeShadowMode(buildInput({ baseRevision: 7 }));
      const record = writtenRecord(set);
      expect(record.stale).toBe(false);
      expect(record.currentRevision).toBeNull();
    });
  });

  describe('③ trace 形状 (成功 / 失败一致)', () => {
    it('③-1 成功 trace 同时带 stale + currentRevision', async () => {
      const { service, set } = buildService({ bdiStates: repoAtRevision(7) });
      await service.executeShadowMode(buildInput({ baseRevision: 7 }));
      const record = writtenRecord(set);
      expect(record.ok).toBe(true);
      expect('stale' in record).toBe(true);
      expect('currentRevision' in record).toBe(true);
    });

    it('③-2 失败 trace 也带 stale + currentRevision (消费方不用判分支)', async () => {
      // ⚠️ 用**非重试**错误码 (http_401): 形状类 (schema_validation_failed) 属于可重试,
      //   service 会"先写 trace 再抛" —— 断言会被抛出的异常打断.
      const { service, set } = buildService({ bdiStates: repoAtRevision(7), requestJson: failingRequestJson('http_401') });
      await service.executeShadowMode(buildInput({ baseRevision: 7 }));
      const record = writtenRecord(set);
      expect(record.ok).toBe(false);
      expect('stale' in record).toBe(true);
      expect('currentRevision' in record).toBe(true);
    });

    it('③-3 失败轮次不判过期 (stale=false + currentRevision=null 占位)', async () => {
      const { service, set } = buildService({ bdiStates: repoAtRevision(9), requestJson: failingRequestJson('http_401') });
      await service.executeShadowMode(buildInput({ baseRevision: 7 }));
      const record = writtenRecord(set);
      expect(record.stale).toBe(false);
      expect(record.currentRevision).toBeNull();
    });
  });

  describe('④ 端到端 (真实仓储 + 真实轮次推进)', () => {
    it('④-1 审议跑完后快照没变 → 不判过期', async () => {
      const repository = new InMemoryBdiStateRepository();
      const { service, set } = buildService({ bdiStates: repository });
      // 落一个 revision=7 的快照 (审议跑完时的"当前版本").
      await repository.save({
        tenantId: TENANT,
        sessionId: SESSION,
        revision: 7,
        updatedAt: Date.now(),
        snapshot: createEmptyBdiSnapshot(),
      });
      await service.executeShadowMode(buildInput({ baseRevision: 7 }));
      const record = writtenRecord(set);
      expect(record.stale).toBe(false);
      expect(record.currentRevision).toBe(7);
    });

    it('④-2 审议跑完后快照被推进到 revision=8 → 判过期 (真实的"中间又跑了一轮")', async () => {
      const repository = new InMemoryBdiStateRepository();
      const { service, set } = buildService({ bdiStates: repository });
      await repository.save({
        tenantId: TENANT,
        sessionId: SESSION,
        revision: 7,
        updatedAt: Date.now(),
        snapshot: createEmptyBdiSnapshot(),
      });
      // 审议在队列里跑的时候, 规则算子又推进了一轮 → revision 变成 8.
      await repository.save({
        tenantId: TENANT,
        sessionId: SESSION,
        revision: 8,
        updatedAt: Date.now(),
        snapshot: createEmptyBdiSnapshot(),
      });
      await service.executeShadowMode(buildInput({ baseRevision: 7 }));
      const record = writtenRecord(set);
      expect(record.stale).toBe(true);
      expect(record.currentRevision).toBe(8);
    });

    it('④-3 仓储里没有这场会话 → 保守兜底 (判没过期, 不误杀)', async () => {
      const repository = new InMemoryBdiStateRepository();
      const { service, set } = buildService({ bdiStates: repository });
      await service.executeShadowMode(buildInput({ baseRevision: 7 }));
      const record = writtenRecord(set);
      expect(record.stale).toBe(false);
      expect(record.currentRevision).toBeNull();
    });
  });

  describe('⑤ 锚 R1 的口径 (本轮落库后 = R1, 不是 R0)', () => {
    it('⑤-1 锚 R1: 当前版本 == R1 → 不判过期 (锚 R0 的话这里会误判成过期)', async () => {
      const { service, set } = buildService({ bdiStates: repoAtRevision(7) });
      await service.executeShadowMode(buildInput({ baseRevision: 7 }));
      expect(writtenRecord(set).stale).toBe(false);
    });

    it('⑤-2 锚 R1: 当前版本 == R0 (= R1 - 1) → 防御性地不判过期', async () => {
      const { service, set } = buildService({ bdiStates: repoAtRevision(6) });
      await service.executeShadowMode(buildInput({ baseRevision: 7 }));
      expect(writtenRecord(set).stale).toBe(false);
    });
  });

  describe('⑥ 隐私边界', () => {
    it('⑥-1 trace 里的 stale / currentRevision 只有数字 —— 不含对话原文', async () => {
      const { service, set } = buildService({ bdiStates: repoAtRevision(9) });
      await service.executeShadowMode(buildInput({ baseRevision: 7 }));
      const record = writtenRecord(set);
      expect(typeof record.stale).toBe('boolean');
      expect(typeof record.currentRevision).toBe('number');
      // 这两个字段本身不含任何心理内容.
      expect(JSON.stringify({ stale: record.stale, currentRevision: record.currentRevision })).not.toContain('来访');
      expect(JSON.stringify({ stale: record.stale, currentRevision: record.currentRevision })).not.toContain('睡得怎么样');
    });
  });

  describe('⑦ DI 契约', () => {
    it('⑦-1 service 的 BDI 仓储依赖走 token 注入 (接口当 token 会静默注入 undefined)', () => {
      // 断言源码里**声明参数的那一行**带 @Inject(ENGINE_BDI_STATE_REPOSITORY) ——
      // 接口编译后没有运行时值, 裸写类型会让 Nest 去找名为 Object 的 provider, 静默注入 undefined.
      // ⚠️ 必须**逐行**判定: 注释里也提到了裸写法 (作为反例), 全文正则会误伤.
      const source = readFileSync(new URL('../../src/engine-adapters/deliberation/llm-deliberation.service.ts', import.meta.url), 'utf8');
      const declarations = source
        .split('\n')
        // 排掉注释行 —— 源码注释里也提到了裸写法 (作为反例), 不排会误伤.
        .filter((line) => !line.trimStart().startsWith('//'))
        .filter((line) => line.includes('private readonly bdiStates: BdiStateRepository'));
      expect(declarations).toHaveLength(1);
      expect(declarations[0]).toContain('@Inject(ENGINE_BDI_STATE_REPOSITORY)');
    });
  });
});
