// V2026-11-06 治本 (约束校验层 · 审议输出逐维 delta cap):
//   切灰度前置安全网: 审议输出在**格式校验通过后**, 再过一道**逐维 delta cap** 砍幅,
//   与规则算子同一口径 (直接复用内核 capTurnDelta + DEFAULT_DELTA_CAP_CONFIG, 不自己写一套).
//   影子模式下只是观测: 砍后的 delta 只进 trace, **不写 BDI 快照**.
//
//   覆盖清单:
//     ① 砍幅口径 (与规则算子同一口径) 4 例
//     ② 边界 (正好等于边界不砍) 5 例
//     ③ 稀疏适配 (不丢不增) 3 例
//     ④ 重复维度 (各自砍各自的) 1 例
//     ⑤ trace 记录 (端到端) 4 例
//     ⑥ 两道校验各司其职 2 例
//     ⑦ 隐私边界 1 例
//
//   ⚠️ 任务单 §九 闸门 5 的 "trust delta=0.25 → 砍到 0.2" **走完整管道时不可达**:
//     格式校验的统一 0.2 粗口径会先把它拒掉 (进 rejectedEntries, 压根到不了 cap).
//     它只在**直接调 cap 函数**时可达 —— 用例 ①-2 正是这么测的.
//     走管道真正能触发的只有**移情三维** (±0.15 比 0.2 更严) —— 见 ①-1 / ⑤-1.
//
//   边界: 全 mock, 不起 Nest 容器, 不发网络, 不连 Redis ——
//     LLM client / Redis / ConfigService 全是极小替身.
//
//   验证: npx vitest run test/engine-adapters/wp-deliberation-delta-cap.spec.ts

import type { ConfigService } from '@nestjs/config';

import { describe, expect, it, vi } from 'vitest';

import { buildTestStructuredInput } from './deliberation-fixtures.js';
import type { CounselorLlmJsonClient } from '../../src/counselor/providers/llm-json.client.js';
import type { DeliberationDeltaEntry, DeliberationDim } from '../../src/engine-adapters/deliberation/deliberation-types.js';
import {
  DeliberationRetryableError,
  LlmDeliberationService,
  applyDeliberationDeltaCap,
  validateDeliberationOutput,
  type DeliberationCapEntry,
  type DeliberationShadowInput,
  type DeliberationTraceRecord,
  type ValidatedDeliberation,
} from '../../src/engine-adapters/deliberation/llm-deliberation.service.js';
import type { BdiStateRepository, DeltaVector } from '../../src/engine-core/index.js';
import type { RedisService } from '../../src/shared/infra/redis/redis.service.js';

// TD-10 · T-2: 真实 ioredis 不进 import 阶段 (适配层仍是真实现; 替身口径见 test/helpers/sdk-stubs.ts).
vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../helpers/sdk-stubs.js');
  return createIoredisStub();
});

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

/** 跑一遍完整管道 (格式校验 → 逐维 cap). */
function runPipeline(raw: unknown): {
  readonly validated: ValidatedDeliberation | null;
  readonly capped: {
    readonly cappedDeltas: readonly DeliberationDeltaEntry[];
    readonly capEntries: readonly DeliberationCapEntry[];
  } | null;
} {
  const validated = validateDeliberationOutput(raw);
  if (!validated) return { validated: null, capped: null };
  return { validated, capped: applyDeliberationDeltaCap(validated.output.deltas) };
}

/**
 * 装一个**真的**审议服务 (LLM client / Redis / ConfigService 全是替身).
 *
 * ⚠️ LLM 替身**自己跑校验器** —— 忠实模拟 client 的行为 (client 内部就是
 *   `input.validate(parsed)`), 这样才能验"两道校验串联"的全链路.
 */
function buildService(raw: unknown): {
  service: LlmDeliberationService;
  set: ReturnType<typeof vi.fn>;
} {
  const set = vi.fn();
  const env: Record<string, string> = { ENGINE_DELIBERATION_ENABLED: 'true' };
  const config = { get: (key: string): string | undefined => env[key] } as unknown as ConfigService;
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

/** 正好等于边界的用例 (内核 capAsym 是严格大于 / 严格小于 → 等于边界不砍). */
const BOUNDARY_CASES: readonly { readonly dim: DeliberationDim; readonly delta: number }[] = [
  { dim: 'positive', delta: 0.15 },
  { dim: 'positive', delta: -0.15 },
  { dim: 'trust', delta: 0.2 },
  { dim: 'trust', delta: -0.2 },
  { dim: 'arousal', delta: 0.2 },
];

/** 移情三维被砍的用例 (内核边界 ±0.15, 比格式校验的统一 0.2 更严). */
const TRANSFERENCE_CASES: readonly {
  readonly dim: DeliberationDim;
  readonly raw: number;
  readonly capped: number;
}[] = [
  { dim: 'positive', raw: 0.18, capped: 0.15 },
  { dim: 'negative', raw: -0.18, capped: -0.15 },
  { dim: 'dependency', raw: 0.16, capped: 0.15 },
];

describe('约束校验层 · 审议输出逐维 delta cap', () => {
  describe('① 砍幅口径 (与规则算子同一口径)', () => {
    it.each(TRANSFERENCE_CASES)('①-1 移情三维 $dim: $raw → $capped (内核边界 ±0.15, 比格式校验的 0.2 更严)', ({ dim, raw, capped }) => {
      const result = runPipeline(rawOutput([rawEntry(dim, raw)])).capped;

      expect(result?.cappedDeltas).toHaveLength(1);
      expect(result?.cappedDeltas[0].delta).toBe(capped);
      expect(result?.capEntries).toEqual([{ dimension: dim, raw, capped }]);
    });

    it('①-2 trust 0.25 → 0.2 (直接调 cap 函数时可达; 走管道会先被格式校验拒掉)', () => {
      const result = applyDeliberationDeltaCap([buildEntry({ dimension: 'trust', delta: 0.25 })]);

      expect(result.cappedDeltas[0].delta).toBe(0.2);
      expect(result.capEntries).toEqual([{ dimension: 'trust', raw: 0.25, capped: 0.2 }]);
    });

    it('①-3 没超边界的维度不砍 (trust 0.18 < 上向 0.2)', () => {
      const result = applyDeliberationDeltaCap([buildEntry({ dimension: 'trust', delta: 0.18 })]);

      expect(result.cappedDeltas[0].delta).toBe(0.18);
      expect(result.capEntries).toHaveLength(0);
    });

    it('①-4 砍幅明细只记被砍的维度 (没被砍的不出现)', () => {
      const result = applyDeliberationDeltaCap([
        buildEntry({ dimension: 'positive', delta: 0.18 }),
        buildEntry({ dimension: 'trust', delta: 0.05 }),
      ]);

      expect(result.capEntries).toHaveLength(1);
      expect(result.capEntries[0].dimension).toBe('positive');
    });
  });

  describe('② 边界 (正好等于边界不砍)', () => {
    it.each(BOUNDARY_CASES)('②-1 $dim = $delta 正好等于边界 → 不砍 (严格大于才砍)', ({ dim, delta }) => {
      const result = applyDeliberationDeltaCap([buildEntry({ dimension: dim, delta })]);

      expect(result.cappedDeltas[0].delta).toBe(delta);
      expect(result.capEntries).toHaveLength(0);
    });
  });

  describe('③ 稀疏适配 (不丢不增)', () => {
    it('③-1 只提到的维度进结果, 没提到的维度不被补进来', () => {
      const result = applyDeliberationDeltaCap([buildEntry({ dimension: 'positive', delta: 0.18 })]);

      expect(result.cappedDeltas).toHaveLength(1);
      expect(result.cappedDeltas.map((entry) => entry.dimension)).toEqual(['positive']);
    });

    it('③-2 维度 / 标签 / 理由一字不改, 只改 delta 数值', () => {
      const result = applyDeliberationDeltaCap([
        buildEntry({ dimension: 'positive', delta: 0.18, operatorTags: ['rapport_shift'], reason: '语气变软了' }),
      ]);

      expect(result.cappedDeltas[0].dimension).toBe('positive');
      expect(result.cappedDeltas[0].operatorTags).toEqual(['rapport_shift']);
      expect(result.cappedDeltas[0].reason).toBe('语气变软了');
      expect(result.cappedDeltas[0].delta).toBe(0.15);
    });

    it('③-3 delta=0 的条目保留 (模型明确提到了这一维), 但不进砍幅明细', () => {
      const result = applyDeliberationDeltaCap([buildEntry({ dimension: 'trust', delta: 0 })]);

      expect(result.cappedDeltas).toHaveLength(1);
      expect(result.cappedDeltas[0].delta).toBe(0);
      expect(result.capEntries).toHaveLength(0);
    });
  });

  describe('④ 重复维度 (各自砍各自的)', () => {
    it('④-1 同维度两条建议各自按自己的值砍, 互不污染', () => {
      const result = applyDeliberationDeltaCap([
        buildEntry({ dimension: 'positive', delta: 0.18 }),
        buildEntry({ dimension: 'positive', delta: -0.18 }),
      ]);

      expect(result.cappedDeltas).toHaveLength(2);
      expect(result.cappedDeltas[0].delta).toBe(0.15);
      expect(result.cappedDeltas[1].delta).toBe(-0.15);
      expect(result.capEntries).toHaveLength(2);
    });
  });

  describe('⑤ trace 记录 (端到端)', () => {
    it('⑤-1 移情 0.18 → trace 的 deliberationDelta 是砍后的 0.15, 砍幅明细进 capEntries', async () => {
      const { service, set } = buildService(rawOutput([rawEntry('positive', 0.18)]));

      await service.executeShadowMode(buildInput());

      const record = writtenRecord(set);
      expect(record.deliberationDelta.positive).toBe(0.15);
      expect(record.capEntries).toEqual([{ dimension: 'positive', raw: 0.18, capped: 0.15 }]);
    });

    it('⑤-2 逐条明细与 deltaDiff 都用**砍后**的值', async () => {
      const { service, set } = buildService(rawOutput([rawEntry('positive', 0.18)]));

      await service.executeShadowMode(buildInput());

      const record = writtenRecord(set);
      expect(record.entries).toHaveLength(1);
      expect(record.entries[0].delta).toBe(0.15);
      // deltaDiff = 审议(砍后) - 规则; 规则侧本来就是砍过的 (ruleDelta 来自落库后的快照差).
      expect(record.deltaDiff.positive).toBe(0.1);
    });

    it('⑤-3 没被砍时 capEntries 为空数组 (形状一致, 不缺字段)', async () => {
      const { service, set } = buildService(rawOutput([rawEntry('trust', 0.05)]));

      await service.executeShadowMode(buildInput());

      const record = writtenRecord(set);
      expect(record.capEntries).toEqual([]);
      expect(record.deliberationDelta.trust).toBe(0.05);
    });

    it('⑤-4 失败轮次 capEntries 为空数组 (成功 / 失败两种形状一致)', async () => {
      // ⚠️ 顶层形状非法 (deltas 不是数组) → 整份判不合法 → client 返 schema_validation_failed.
      //   注意区分: 只是**单条** delta 非法 (如幅度越界) 时, 顶层仍合法 → 那是"成功但这条被丢",
      //   走的是成功记录 (ok=true, 该条进 rejectedEntries) —— 见 ⑥-1.
      const { service, set } = buildService({ deltas: 'not-an-array', summary: '整体可推进', confidence: 0.7 });

      // WP66 口径: **先写 trace, 再抛** (形状类失败值得重试) —— 失败记录不能丢.
      await expect(service.executeShadowMode(buildInput())).rejects.toBeInstanceOf(DeliberationRetryableError);

      const record = writtenRecord(set);
      expect(record.ok).toBe(false);
      expect(record.capEntries).toEqual([]);
    });
  });

  describe('⑥ 两道校验各司其职', () => {
    it('⑥-1 格式校验仍然拒 |delta| > 0.2 (trust 0.25 进 rejectedEntries, 压根到不了 cap)', () => {
      const result = runPipeline(rawOutput([rawEntry('trust', 0.25)]));

      expect(result.validated?.output.deltas).toHaveLength(0);
      expect(result.validated?.rejectedEntries).toHaveLength(1);
      expect(result.capped?.capEntries).toHaveLength(0);
    });

    it('⑥-2 加了 cap 不放宽格式校验 (非法维度 / 空理由 仍然被拒)', () => {
      const badDim = runPipeline(rawOutput([rawEntry('suicide_risk', 0.05)]));
      const badReason = runPipeline(rawOutput([{ dimension: 'trust', delta: 0.05, operatorTags: ['empathy'], reason: '  ' }]));

      expect(badDim.validated?.output.deltas).toHaveLength(0);
      expect(badDim.validated?.rejectedEntries).toHaveLength(1);
      expect(badReason.validated?.output.deltas).toHaveLength(0);
      expect(badReason.validated?.rejectedEntries).toHaveLength(1);
    });
  });

  describe('⑦ 隐私边界', () => {
    it('⑦-1 砍幅明细里只有维度名 + 两个数字, 没有理由 / 总结 / 对话原文', async () => {
      const { service, set } = buildService(rawOutput([rawEntry('positive', 0.18)]));

      await service.executeShadowMode(buildInput());

      const record = writtenRecord(set);
      const entry = record.capEntries[0];
      expect(Object.keys(entry).toSorted()).toEqual(['capped', 'dimension', 'raw']);
      expect(JSON.stringify(entry)).not.toContain('来访');
      expect(JSON.stringify(entry)).not.toContain('睡得怎么样');
    });
  });
});
