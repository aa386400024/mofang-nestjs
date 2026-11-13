// V2026-11-07 治本 (临床合理性校验 · 观测版 · 切灰度前置):
//   三条工程种子值规则, 把"可疑"的轮次**标记**出来 —— **不拦截、不砍幅**.
//   切灰度前的最后一块安全网: 影子期跑数据, 督导复盘 flagged 轮次, 校准阈值.
//
//   覆盖清单:
//     ① 规则 1 (alliance_positive_spike) 3 例
//     ② 规则 2 (alliance_negative_spike) 2 例
//     ③ 规则 3 (resistance_triple_jump) 3 例
//     ④ 边界 (正好等于阈值不 flagged) 4 例
//     ⑤ 开关 (缺省关 → 空数组) 3 例
//     ⑥ trace 形状 (成功 / 失败一致) 2 例
//     ⑦ 观测版语义 (只标记不拦截 + 同维度取最后一条) 3 例
//     ⑧ 端到端 + 管道可达性 3 例
//     ⑨ 隐私边界 1 例
//
//   ⚠️ **规则 2 在完整管道里不可达** (用例 ⑧-3 钉死):
//     格式校验的粗口径 (|delta| <= 0.2) 比规则 2 的阈值 (-0.25) **更严** ——
//     能过格式校验的负向 delta 最小是 -0.2, 永远够不到 "< -0.25".
//     → 观测数据里规则 2 恒为 0 条. **这不是 bug**, 是上游那道更严的底线先拦住了.
//     → 所以闸门 6 只能用**直接调函数**覆盖 (用例 ②-1), 端到端跑不出来.
//
//   边界: 全 mock, 不起 Nest 容器, 不发网络, 不连 Redis ——
//     LLM client / Redis / ConfigService / BDI 仓储全是极小替身.
//
//   验证: npx vitest run test/engine-adapters/wp-deliberation-clinical-sanity.spec.ts

import type { ConfigService } from '@nestjs/config';

import { describe, expect, it, vi } from 'vitest';

import { buildTestStructuredInput } from './deliberation-fixtures.js';
import type { CounselorLlmJsonClient } from '../../src/counselor/providers/llm-json.client.js';
import type { DeliberationDeltaEntry } from '../../src/engine-adapters/deliberation/deliberation-types.js';
import {
  CLINICAL_SANITY_THRESHOLDS,
  DeliberationRetryableError,
  LlmDeliberationService,
  applyClinicalSanityCheck,
  validateDeliberationOutput,
  type DeliberationShadowInput,
  type DeliberationTraceRecord,
} from '../../src/engine-adapters/deliberation/llm-deliberation.service.js';
import type { BdiStateRepository, DeltaVector } from '../../src/engine-core/index.js';
import type { RedisService } from '../../src/shared/infra/redis/redis.service.js';

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

/** 造一个 ConfigService 桩 (只实现 get). */
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
 * `env` 就是运维能改的那批键 —— 临床合理性观测开关也走同一套 env.
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
  // ⚠️ V2026-11-07 起 service 写 trace 时**同步累加统计计数器** (getClient().eval) → 替身补上.
  const redis = {
    set,
    get: vi.fn(async (): Promise<string | null> => null),
    getClient: () => ({ eval: vi.fn(async (): Promise<number> => 1) }),
  } as unknown as RedisService;
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

/** 同盟三维逐维用例 (规则 1 / 规则 2 对三个维度一视同仁). */
const ALLIANCE_DIMS = ['trust', 'safety', 'bond'] as const;

/** 阻抗三维 (规则 3 的"集体"语义). */
const RESISTANCE_DIMS = ['verbal', 'depth', 'style'] as const;

describe('临床合理性校验 · 观测版', () => {
  describe('① 规则 1 · alliance_positive_spike (同盟三维正向跳变)', () => {
    it.each(ALLIANCE_DIMS)('①-1 %s = 0.18 → flagged (warn, 阈值 0.15)', (dim) => {
      const result = applyClinicalSanityCheck([buildEntry({ dimension: dim, delta: 0.18 })], true);

      expect(result.clinicalFlags).toEqual([
        {
          rule: 'alliance_positive_spike',
          dimension: dim,
          value: 0.18,
          threshold: CLINICAL_SANITY_THRESHOLDS.alliancePositive,
          severity: 'warn',
        },
      ]);
    });

    it('①-2 阈值以上的值才 flagged (0.16 刚好过线)', () => {
      const result = applyClinicalSanityCheck([buildEntry({ dimension: 'trust', delta: 0.16 })], true);

      expect(result.clinicalFlags).toHaveLength(1);
      expect(result.clinicalFlags[0].value).toBe(0.16);
    });

    it('①-3 非同盟维度不受规则 1 约束 (valence 0.18 不 flagged)', () => {
      const result = applyClinicalSanityCheck([buildEntry({ dimension: 'valence', delta: 0.18 })], true);

      expect(result.clinicalFlags).toEqual([]);
    });
  });

  describe('② 规则 2 · alliance_negative_spike (同盟三维负向跳变)', () => {
    it('②-1 trust = -0.3 → flagged (warn, 阈值 -0.25)', () => {
      const result = applyClinicalSanityCheck([buildEntry({ dimension: 'trust', delta: -0.3 })], true);

      expect(result.clinicalFlags).toEqual([
        {
          rule: 'alliance_negative_spike',
          dimension: 'trust',
          value: -0.3,
          threshold: CLINICAL_SANITY_THRESHOLDS.allianceNegative,
          severity: 'warn',
        },
      ]);
    });

    it('②-2 负向超过阈值一点点也 flagged (-0.26)', () => {
      const result = applyClinicalSanityCheck([buildEntry({ dimension: 'safety', delta: -0.26 })], true);

      expect(result.clinicalFlags).toHaveLength(1);
      expect(result.clinicalFlags[0].rule).toBe('alliance_negative_spike');
    });
  });

  describe('③ 规则 3 · resistance_triple_jump (阻抗三维集体上升)', () => {
    it('③-1 verbal / depth / style 同时 0.12 → 三维各一条 flag (info)', () => {
      const result = applyClinicalSanityCheck(
        RESISTANCE_DIMS.map((dim) => buildEntry({ dimension: dim, delta: 0.12 })),
        true,
      );

      expect(result.clinicalFlags).toHaveLength(3);
      expect(result.clinicalFlags.map((flag) => flag.dimension)).toEqual(['verbal', 'depth', 'style']);
      expect(result.clinicalFlags.every((flag) => flag.rule === 'resistance_triple_jump')).toBe(true);
      expect(result.clinicalFlags.every((flag) => flag.severity === 'info')).toBe(true);
      expect(result.clinicalFlags.every((flag) => flag.threshold === CLINICAL_SANITY_THRESHOLDS.resistanceTriple)).toBe(true);
    });

    it('③-2 少一维就不算"集体" (只有 verbal / depth 超线 → 不 flagged)', () => {
      const result = applyClinicalSanityCheck(
        [buildEntry({ dimension: 'verbal', delta: 0.12 }), buildEntry({ dimension: 'depth', delta: 0.12 })],
        true,
      );

      expect(result.clinicalFlags).toEqual([]);
    });

    it('③-3 三维都在但只有一维超线 → 不 flagged', () => {
      const result = applyClinicalSanityCheck(
        [
          buildEntry({ dimension: 'verbal', delta: 0.12 }),
          buildEntry({ dimension: 'depth', delta: 0.05 }),
          buildEntry({ dimension: 'style', delta: 0.05 }),
        ],
        true,
      );

      expect(result.clinicalFlags).toEqual([]);
    });
  });

  describe('④ 边界 (正好等于阈值 → 不 flagged)', () => {
    it.each([
      { dim: 'trust', delta: 0.15, label: '规则 1 上沿' },
      { dim: 'trust', delta: -0.25, label: '规则 2 下沿' },
      { dim: 'verbal', delta: 0.1, label: '规则 3 上沿' },
      { dim: 'depth', delta: 0.1, label: '规则 3 上沿' },
    ])('④-1 $dim = $delta ($label) → 不 flagged', ({ dim, delta }) => {
      const result = applyClinicalSanityCheck([buildEntry({ dimension: dim as DeliberationDeltaEntry['dimension'], delta })], true);

      expect(result.clinicalFlags).toEqual([]);
    });
  });

  describe('⑤ 开关 (缺省关 → 空数组)', () => {
    it('⑤-1 关着时函数直接返回空数组 (零开销)', () => {
      const result = applyClinicalSanityCheck([buildEntry({ dimension: 'trust', delta: 0.18 })], false);

      expect(result.clinicalFlags).toEqual([]);
    });

    it('⑤-2 端到端: 没配 env → trace 的 clinicalFlags 是空数组', async () => {
      const { service, set } = buildService(rawOutput([rawEntry('trust', 0.18)]));

      await service.executeShadowMode(buildInput());

      expect(writtenRecord(set).clinicalFlags).toEqual([]);
    });

    it('⑤-3 端到端: 开关打开 → trace 的 clinicalFlags 有内容', async () => {
      const { service, set } = buildService(rawOutput([rawEntry('trust', 0.18)]), {
        ENGINE_CLINICAL_SANITY_ENABLED: 'true',
      });

      await service.executeShadowMode(buildInput());

      const record = writtenRecord(set);
      expect(record.clinicalFlags).toEqual([
        {
          rule: 'alliance_positive_spike',
          dimension: 'trust',
          value: 0.18,
          threshold: CLINICAL_SANITY_THRESHOLDS.alliancePositive,
          severity: 'warn',
        },
      ]);
    });
  });

  describe('⑥ trace 形状 (成功 / 失败一致)', () => {
    it('⑥-1 成功轮次带 clinicalFlags 字段 (不缺字段)', async () => {
      const { service, set } = buildService(rawOutput([rawEntry('trust', 0.05)]), {
        ENGINE_CLINICAL_SANITY_ENABLED: 'true',
      });

      await service.executeShadowMode(buildInput());

      expect(Array.isArray(writtenRecord(set).clinicalFlags)).toBe(true);
    });

    it('⑥-2 失败轮次 clinicalFlags 是空数组 (与成功轮次同形状)', async () => {
      // ⚠️ 顶层形状非法 (deltas 不是数组) → 整份判不合法 → client 返 schema_validation_failed.
      const { service, set } = buildService({ deltas: 'not-an-array', summary: '整体可推进', confidence: 0.7 });

      // WP66 口径: **先写 trace, 再抛** (形状类失败值得重试) —— 失败记录不能丢.
      await expect(service.executeShadowMode(buildInput())).rejects.toBeInstanceOf(DeliberationRetryableError);

      const record = writtenRecord(set);
      expect(record.ok).toBe(false);
      expect(record.clinicalFlags).toEqual([]);
    });
  });

  describe('⑦ 观测版语义 (只标记不拦截)', () => {
    it('⑦-1 checkedDeltas 与入参逐字相同 (不砍不丢不改)', () => {
      const deltas = [buildEntry({ dimension: 'trust', delta: 0.18 })];

      const result = applyClinicalSanityCheck(deltas, true);

      expect(result.checkedDeltas).toEqual(deltas);
      expect(result.clinicalFlags).toHaveLength(1);
    });

    it('⑦-2 同一维度多条建议 → 取**最后一条** (与 trace 的 deliberationDelta 同口径)', () => {
      const lastWins = applyClinicalSanityCheck(
        [buildEntry({ dimension: 'trust', delta: 0.18 }), buildEntry({ dimension: 'trust', delta: 0.05 })],
        true,
      );
      const firstOnly = applyClinicalSanityCheck(
        [buildEntry({ dimension: 'trust', delta: 0.05 }), buildEntry({ dimension: 'trust', delta: 0.18 })],
        true,
      );

      expect(lastWins.clinicalFlags).toEqual([]);
      expect(firstOnly.clinicalFlags).toHaveLength(1);
      expect(firstOnly.clinicalFlags[0].value).toBe(0.18);
    });

    it('⑦-3 标记不改变审议结果 (trace 的 delta 仍是砍后的值)', async () => {
      const { service, set } = buildService(rawOutput([rawEntry('trust', 0.18)]), {
        ENGINE_CLINICAL_SANITY_ENABLED: 'true',
      });

      await service.executeShadowMode(buildInput());

      const record = writtenRecord(set);
      expect(record.deliberationDelta.trust).toBe(0.18);
      expect(record.capEntries).toEqual([]);
      expect(record.clinicalFlags).toHaveLength(1);
    });
  });

  describe('⑧ 端到端 + 管道可达性', () => {
    it('⑧-1 端到端: 移情三维 0.12 → 阻抗三维各一条 flag', async () => {
      const { service, set } = buildService(rawOutput(RESISTANCE_DIMS.map((dim) => rawEntry(dim, 0.12))), {
        ENGINE_CLINICAL_SANITY_ENABLED: 'true',
      });

      await service.executeShadowMode(buildInput());

      const flags = writtenRecord(set).clinicalFlags;
      expect(flags).toHaveLength(3);
      expect(flags.every((flag) => flag.rule === 'resistance_triple_jump')).toBe(true);
    });

    it('⑧-2 端到端: 审议 delta 一个字没被改动 (观测版不拦截)', async () => {
      const { service, set } = buildService(rawOutput([rawEntry('trust', 0.18)]), {
        ENGINE_CLINICAL_SANITY_ENABLED: 'true',
      });

      await service.executeShadowMode(buildInput());

      const record = writtenRecord(set);
      expect(record.entries).toHaveLength(1);
      expect(record.entries[0].delta).toBe(0.18);
    });

    it('⑧-3 规则 2 在完整管道里不可达 (格式校验 0.2 粗口径比阈值 -0.25 更严)', async () => {
      // ⚠️ -0.3 过不了格式校验 (|delta| > 0.2) → 这条建议压根到不了临床校验.
      //   所以观测数据里规则 2 恒为 0 条 —— **不是 bug**, 是上游更严的底线先拦住了.
      const { service, set } = buildService(rawOutput([rawEntry('trust', -0.3)]), {
        ENGINE_CLINICAL_SANITY_ENABLED: 'true',
      });

      await service.executeShadowMode(buildInput());

      const record = writtenRecord(set);
      expect(record.rejectedEntries).toHaveLength(1);
      expect(record.clinicalFlags).toEqual([]);
    });
  });

  describe('⑨ 隐私边界', () => {
    it('⑨-1 flag 里只有规则名 + 维度 + 两个数字, 没有理由 / 总结 / 对话原文', async () => {
      const { service, set } = buildService(rawOutput([rawEntry('trust', 0.18)]), {
        ENGINE_CLINICAL_SANITY_ENABLED: 'true',
      });

      await service.executeShadowMode(buildInput());

      const flag = writtenRecord(set).clinicalFlags[0];
      expect(Object.keys(flag).toSorted()).toEqual(['dimension', 'rule', 'severity', 'threshold', 'value']);
      expect(JSON.stringify(flag)).not.toContain('来访');
      expect(JSON.stringify(flag)).not.toContain('睡得怎么样');
    });
  });
});
