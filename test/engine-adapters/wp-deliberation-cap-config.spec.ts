// V2026-11-07 治本 (cap 配置统一 · 审议侧与规则算子同口径 · 切灰度前置):
//   审议侧的逐维 delta cap 从**硬编码**内核种子值, 改成与规则算子**同一份**
//   `resolveDeltaCapConfig(config)` 的结果 —— 规则侧能 env 覆写 (`ENGINE_CAP_*`),
//   审议侧以前不能, 两边口径不一致. 切灰度后审议结果与规则结果会用**不同的 cap 标准**,
//   deltaDiff 的口径就歪了.
//
//   覆盖清单:
//     ① 传 config 时按 config 砍 (闸门 5) 2 例
//     ② 缺省行为逐字不变 (闸门 6) 2 例
//     ③ env 覆写后审议侧跟着变 (闸门 7) 2 例
//     ④ 两侧口径一致 (闸门 5) 2 例
//
//   ⚠️ **缺省行为必须逐字不变** (闸门 6):
//     现有单测 (`wp-deliberation-delta-cap.spec.ts`) 大量直接调
//     `applyDeliberationDeltaCap(deltas)` 不传 config —— config 参数保持**可选**,
//     那个文件**零改动**, 行为与本单之前逐字一致.
//
//   ⚠️ **两侧都在启动期求值** (不做热更新):
//     规则侧在 `ENGINE_SESSION_PORT` 的 useFactory 里求值一次, 审议侧在 service 构造函数里
//     求值一次 (单例) —— 运维中途改 env 两侧都不变, 口径始终一致.
//
//   边界: 全 mock, 不起 Nest 容器, 不发网络, 不连 Redis ——
//     LLM client / Redis / ConfigService / BDI 仓储全是极小替身.
//
//   验证: npx vitest run test/engine-adapters/wp-deliberation-cap-config.spec.ts

import type { ConfigService } from '@nestjs/config';

import { describe, expect, it, vi } from 'vitest';

import type { CounselorLlmJsonClient } from '../../src/counselor/providers/llm-json.client.js';
import {
  LlmDeliberationService,
  applyDeliberationDeltaCap,
  validateDeliberationOutput,
  type DeliberationDeltaEntry,
  type DeliberationShadowInput,
  type DeliberationTraceRecord,
} from '../../src/engine-adapters/deliberation/llm-deliberation.service.js';
import { resolveDeltaCapConfig } from '../../src/engine-adapters/wiring/delta-cap.config.js';
import {
  createEmptyBdiSnapshot,
  DEFAULT_DELTA_CAP_CONFIG,
  type BdiStateRepository,
  type DeltaVector,
} from '../../src/engine-core/index.js';
import type { RedisService } from '../../src/shared/infra/redis/redis.service.js';

const TENANT = 'tenant-1';
const SESSION = 'session-1';
const USER = 'user-1';

/** 规则算子这一轮的实际 delta (测试基准: 移情三维给非 0 值, 便于验 deltaDiff 口径). */
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

/** 造一个 ConfigService 桩 (只实现 get) —— 与 WP26 的范式同款. */
function configStub(env: Readonly<Record<string, string>>): ConfigService {
  return {
    get: (key: string): string | undefined => env[key],
  } as unknown as ConfigService;
}

/** 造一份影子审议入参 (基准). */
function buildInput(overrides: Partial<DeliberationShadowInput> = {}): DeliberationShadowInput {
  return {
    sessionId: SESSION,
    tenantId: TENANT,
    userId: USER,
    turnIndex: 3,
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

/** 造一条 delta 建议 (过校验后的形状). */
function buildEntry(overrides: Partial<DeliberationDeltaEntry> = {}): DeliberationDeltaEntry {
  return {
    dimension: 'trust',
    delta: 0.05,
    operatorTags: ['empathy'],
    reason: '咨询师做了共情回应',
    ...overrides,
  };
}

/** 造一条**未过校验**的原始条目 (LLM 原始输出里的样子). */
function rawEntry(dimension: string, delta: number): unknown {
  return { dimension, delta, operatorTags: ['empathy'], reason: '来访感到被理解' };
}

/** 造一份 LLM 原始输出 (未过校验). */
function rawOutput(deltas: readonly unknown[]): unknown {
  return { deltas, summary: '来访情绪略有松动', confidence: 0.7 };
}

/**
 * 装一个**真的**审议服务 (LLM client / Redis / ConfigService 全是替身).
 *
 * `env` 就是运维能改的那批 `ENGINE_CAP_*` 键 —— 审议侧和规则侧读的是**同一套键**.
 */
function buildService(
  raw: unknown,
  env: Readonly<Record<string, string>> = {},
): {
  service: LlmDeliberationService;
  set: ReturnType<typeof vi.fn>;
} {
  const set = vi.fn();
  const fullEnv: Record<string, string> = { ENGINE_DELIBERATION_ENABLED: 'true', ...env };
  const config = configStub(fullEnv);
  // ⚠️ WP68 起 service 还要**读**意图锁定状态 (Redis get) → 替身补上.
  const redis = { set, get: vi.fn(async (): Promise<string | null> => null) } as unknown as RedisService;
  const requestJson = vi.fn(async () => {
    const data = validateDeliberationOutput(raw);
    if (data === null) {
      return {
        ok: false,
        data: null,
        rawText: '{}',
        errorCode: 'schema_validation_failed',
        errorMessage: 'LLM 输出未通过业务字段校验',
        usage: null,
      };
    }
    return {
      ok: true,
      data,
      rawText: '{}',
      errorCode: null,
      errorMessage: null,
      usage: { promptTokens: 1200, completionTokens: 180, totalTokens: 1380 },
    };
  });
  const llm = { requestJson } as unknown as CounselorLlmJsonClient;
  // ⚠️ V2026-11-07 起 service 还要**读** BDI 状态仓储 (过期判定) → 替身补上.
  //   读不到 = 保守兜底 (判没过期) —— 与"会话还没落库"同款分支.
  const bdiStates = { load: vi.fn(async () => null) } as unknown as BdiStateRepository;
  return { service: new LlmDeliberationService(llm, config, redis, bdiStates), set };
}

/** 从 set 的调用参数里取出写进去的 trace 记录 (trace 是第一个 set —— 锁状态排在它后面). */
function writtenRecord(set: ReturnType<typeof vi.fn>): DeliberationTraceRecord {
  const [, value] = set.mock.calls[0] as [string, string];
  return JSON.parse(value) as DeliberationTraceRecord;
}

describe('cap 配置统一 · 审议侧与规则算子同口径', () => {
  describe('① 传 config 时按 config 砍 (闸门 5)', () => {
    it('①-1 传一份 positive 上向 0.1 的 config → positive 0.18 砍到 0.1 (不是种子值的 0.15)', () => {
      const config = resolveDeltaCapConfig(configStub({ ENGINE_CAP_POSITIVE_UP: '0.1' }));

      const result = applyDeliberationDeltaCap([buildEntry({ dimension: 'positive', delta: 0.18 })], config);

      expect(result.cappedDeltas[0].delta).toBe(0.1);
      expect(result.capEntries).toEqual([{ dimension: 'positive', raw: 0.18, capped: 0.1 }]);
    });

    it('①-2 整份 config 透传 (不止某一维): trust 上向 0.05 也跟着生效', () => {
      const config = resolveDeltaCapConfig(configStub({ ENGINE_CAP_POSITIVE_UP: '0.1', ENGINE_CAP_TRUST_UP: '0.05' }));

      const result = applyDeliberationDeltaCap(
        [buildEntry({ dimension: 'positive', delta: 0.18 }), buildEntry({ dimension: 'trust', delta: 0.1 })],
        config,
      );

      expect(result.cappedDeltas.map((entry) => entry.delta)).toEqual([0.1, 0.05]);
      expect(result.capEntries.map((entry) => entry.dimension)).toEqual(['positive', 'trust']);
    });
  });

  describe('② 缺省行为逐字不变 (闸门 6)', () => {
    it('②-1 不传 config 与显式传内核种子值, 结果逐字一致 (现有单测零改动的前提)', () => {
      const deltas = [
        buildEntry({ dimension: 'positive', delta: 0.18 }),
        buildEntry({ dimension: 'trust', delta: 0.25 }),
        buildEntry({ dimension: 'negative', delta: -0.18 }),
      ];

      const withoutConfig = applyDeliberationDeltaCap(deltas);
      const withSeed = applyDeliberationDeltaCap(deltas, DEFAULT_DELTA_CAP_CONFIG);

      expect(withoutConfig).toEqual(withSeed);
    });

    it('②-2 不传 config 时砍幅仍是种子值的 ±0.15 (移情三维)', () => {
      const result = applyDeliberationDeltaCap([buildEntry({ dimension: 'positive', delta: 0.18 })]);

      expect(result.cappedDeltas[0].delta).toBe(0.15);
      expect(result.capEntries).toEqual([{ dimension: 'positive', raw: 0.18, capped: 0.15 }]);
    });
  });

  describe('③ env 覆写后审议侧跟着变 (闸门 7)', () => {
    it('③-1 ENGINE_CAP_POSITIVE_UP=0.1 → 端到端 trace 里的移情 cap 是 0.1', async () => {
      const { service, set } = buildService(rawOutput([rawEntry('positive', 0.18)]), {
        ENGINE_CAP_POSITIVE_UP: '0.1',
      });

      await service.executeShadowMode(buildInput());

      const record = writtenRecord(set);
      expect(record.deliberationDelta.positive).toBe(0.1);
      expect(record.capEntries).toEqual([{ dimension: 'positive', raw: 0.18, capped: 0.1 }]);
    });

    it('③-2 没配 ENGINE_CAP_* → 审议侧仍是种子值 0.15 (零回归: 不配 = 与本单之前逐字一致)', async () => {
      const { service, set } = buildService(rawOutput([rawEntry('positive', 0.18)]));

      await service.executeShadowMode(buildInput());

      const record = writtenRecord(set);
      expect(record.deliberationDelta.positive).toBe(0.15);
      expect(record.capEntries).toEqual([{ dimension: 'positive', raw: 0.18, capped: 0.15 }]);
    });
  });

  describe('④ 两侧口径一致 (闸门 5)', () => {
    it('④-1 同一份 env 下, 审议侧砍出的值 == 规则侧那份 config 里的边界', async () => {
      const env = { ENGINE_DELIBERATION_ENABLED: 'true', ENGINE_CAP_POSITIVE_UP: '0.1' };
      // 规则侧: 同一套 `ENGINE_CAP_*` 键装配出来的 config.
      const ruleSide = resolveDeltaCapConfig(configStub(env));
      // 审议侧: 真的审议服务.
      const { service, set } = buildService(rawOutput([rawEntry('positive', 0.18)]), env);

      await service.executeShadowMode(buildInput());

      const record = writtenRecord(set);
      expect(ruleSide.positive.up).toBe(0.1);
      expect(record.deliberationDelta.positive).toBe(ruleSide.positive.up);
    });

    it('④-2 非法 env 值两边一起回退种子值 (配错不会让两边分叉)', () => {
      const env = { ENGINE_CAP_POSITIVE_UP: 'abc' };

      const ruleSide = resolveDeltaCapConfig(configStub(env));

      expect(ruleSide.positive).toEqual(DEFAULT_DELTA_CAP_CONFIG.positive);
      const result = applyDeliberationDeltaCap([buildEntry({ dimension: 'positive', delta: 0.18 })], ruleSide);
      expect(result.cappedDeltas[0].delta).toBe(0.15);
    });
  });
});
