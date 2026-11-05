// V2026-11-05 治本 (WP64 · B 层 · LLM 审议层 PoC · 影子模式):
//   覆盖任务单 §6.3 的六条要求 + 若干防漂移用例:
//     1. env 开关关闭时, runShadowMode 直接 return, 不调 LLM
//     2. env 开关开启时, 正常调 LLM, trace 数据写入 Redis
//     3. LLM 返回格式不合法时, trace 表记 ok=false + errorCode
//     4. LLM 超时时, trace 表记 ok=false + errorCode
//     5. delta 差异计算正确 (逐维度对比 ruleDelta 和 deliberationDelta)
//     6. 所有异常都被 catch, 不抛到调用方
//   额外覆盖: 键设计的撞键防护 / TTL / trace 字段完整性 /
//             硬安全维度被拒但**留证据** / 编排门面的旁路接线 (首轮跳过 / 不 await).
//
//   边界: 全 mock, 不起 Nest 容器, 不发网络, 不连 Redis ——
//     LLM client / Redis / ConfigService 全部用极小替身.
//
//   关于"超时"那条用例的口径:
//     客户端 `CounselorLlmJsonClient` 把**所有**失败都收敛成 `ok=false + errorCode`
//     (llm_error / json_not_found / json_parse_failed / schema_validation_failed),
//     **不区分**超时与其它 API 错误 —— 它自己也不知道上游是超时还是拒了.
//     所以本文件按"上游报了错"来覆盖: 超时只是其中一种 errorCode 组合.
//     真正的超时**兜底** (降级 / 重试 / 跳过) 是 WP67 的事, 本期只保证"失败不炸主流程".
//
//   验证: npx vitest run test/engine-adapters/wp64-deliberation-shadow.spec.ts

import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { CounselorLlmJsonClient } from '../../src/counselor/providers/llm-json.client.js';
import {
  DEFAULT_DELIBERATION_TEMPERATURE,
  DEFAULT_DELIBERATION_TIMEOUT_MS,
  DEFAULT_DELIBERATION_TRACE_TTL_SECONDS,
  DELIBERATION_MAX_COMPLETION_TOKENS,
  LlmDeliberationService,
  buildDeliberationTraceKey,
  computeDeliberationDeltaDiff,
  computeRuleDelta,
  validateDeliberationOutput,
  type DeliberationShadowInput,
  type DeliberationShadowPort,
  type DeliberationTokenUsage,
  type DeliberationTraceRecord,
  type ValidatedDeliberation,
} from '../../src/engine-adapters/deliberation/llm-deliberation.service.js';
import { TurnRenderOrchestrator, type TurnSessionContext } from '../../src/engine-adapters/rendering/turn-render-orchestrator.js';
import {
  cloneBdiSnapshot,
  createEmptyBdiSnapshot,
  type BdiSnapshot,
  type EngineSessionHandle,
  type EngineSessionPort,
  type EngineTurnInput,
  type EngineTurnOutput,
  type MemoryEntry,
  type MemoryHit,
  type MemoryStore,
  type OpenEngineSessionInput,
  type RenderPort,
  type RenderResult,
  type RenderSpec,
} from '../../src/engine-core/index.js';
import type { RedisService } from '../../src/shared/infra/redis/redis.service.js';

const TENANT = 'tenant-1';
const SESSION = 'session-1';
const USER = 'user-1';

/** 规则算子这一轮的实际 delta (测试基准). */
const RULE_DELTA = {
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

/** 造一份快照 (在空快照基础上改几个字段). */
function snapshot(
  overrides: {
    trust?: number;
    safety?: number;
    bond?: number;
    valence?: number;
    arousal?: number;
    verbal?: number;
    depth?: number;
    style?: number;
    positive?: number;
    negative?: number;
    dependency?: number;
  } = {},
): BdiSnapshot {
  const base = createEmptyBdiSnapshot();
  return {
    ...base,
    trust: overrides.trust ?? base.trust,
    safety: overrides.safety ?? base.safety,
    bond: overrides.bond ?? base.bond,
    emotion: {
      ...base.emotion,
      valence: overrides.valence ?? base.emotion.valence,
      arousal: overrides.arousal ?? base.emotion.arousal,
    },
    resistance: {
      verbal: overrides.verbal ?? base.resistance.verbal,
      depth: overrides.depth ?? base.resistance.depth,
      style: overrides.style ?? base.resistance.style,
    },
    transference: {
      positive: overrides.positive ?? base.transference.positive,
      negative: overrides.negative ?? base.transference.negative,
      dependency: overrides.dependency ?? base.transference.dependency,
    },
  };
}

/** 影子审议入参 (基准). */
function buildInput(overrides: Partial<DeliberationShadowInput> = {}): DeliberationShadowInput {
  return {
    sessionId: SESSION,
    tenantId: TENANT,
    userId: USER,
    turnIndex: 3,
    mode: 'freeform',
    baseSnapshot: snapshot(),
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

/** 装一个审议服务 (三个依赖全是极小替身). */
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

/** 从 set 的调用参数里取出写进去的 trace 记录. */
function writtenRecord(set: ReturnType<typeof vi.fn>): DeliberationTraceRecord {
  const [, value] = set.mock.calls[0] as [string, string];
  return JSON.parse(value) as DeliberationTraceRecord;
}

describe('WP64 · LLM 审议层 PoC (影子模式)', () => {
  describe('① 影子模式开关 (env 关闭 → 一次 LLM 都不发)', () => {
    it('ENGINE_DELIBERATION_ENABLED=false 时直接 return: 不调 LLM, 不写 Redis', async () => {
      const { service, requestJson, set } = buildService({ env: { ENGINE_DELIBERATION_ENABLED: 'false' } });

      await service.runShadowMode(buildInput());

      expect(requestJson).not.toHaveBeenCalled();
      expect(set).not.toHaveBeenCalled();
    });

    it('开关**缺省**时也是关的 (影子模式默认不开 —— 每轮多烧一次 LLM)', async () => {
      const { service, requestJson, set } = buildService({ env: {} });

      await service.runShadowMode(buildInput());

      expect(requestJson).not.toHaveBeenCalled();
      expect(set).not.toHaveBeenCalled();
    });

    it('true / 1 / on 都算开', async () => {
      for (const value of ['true', 'TRUE', '1', 'on']) {
        const { service, requestJson } = buildService({
          env: { ENGINE_DELIBERATION_ENABLED: value },
          requestJson: vi.fn().mockResolvedValue(okResult()),
        });

        await service.runShadowMode(buildInput());

        expect(requestJson, `开关值 ${value} 应当生效`).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe('② 正常路径: 调 LLM → 写 trace 表', () => {
    it('开关开启时调一次 LLM, 并把 trace 写进 Redis', async () => {
      const { service, requestJson, set } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockResolvedValue(okResult()),
      });

      await service.runShadowMode(buildInput());

      expect(requestJson).toHaveBeenCalledTimes(1);
      expect(set).toHaveBeenCalledTimes(1);
      const record = writtenRecord(set);
      expect(record.ok).toBe(true);
      expect(record.sessionId).toBe(SESSION);
      expect(record.turnIndex).toBe(3);
      expect(record.mode).toBe('freeform');
    });

    it('请求体按 WP63 的三个零件组装 (systemPrompt / userPrompt / schemaDescription)', async () => {
      const { service, requestJson } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockResolvedValue(okResult()),
      });

      await service.runShadowMode(buildInput({ mode: 'exam' }));

      const request = requestJson.mock.calls[0][0] as {
        systemPrompt: string;
        userPrompt: string;
        schemaDescription: string;
        validate: (raw: unknown) => unknown;
        maxCompletionTokens: number;
        timeoutMs: number;
        tenantId: string;
        userId: string;
      };
      // 考核模式的措辞 (自由练习模式是另一段) —— 证明 mode 真的选到了模板.
      expect(request.systemPrompt).toContain('【当前模式：考核（判定标准更严格）】');
      expect(request.userPrompt).toContain('你最近睡得怎么样？');
      expect(request.userPrompt).toContain('有点累，夜里老醒。');
      expect(request.userPrompt).toContain('第 3 轮');
      expect(request.schemaDescription).toContain('【输出 JSON 结构】');
      expect(typeof request.validate).toBe('function');
      expect(request.tenantId).toBe(TENANT);
      expect(request.userId).toBe(USER);
    });

    it('生成长度上限给足 (thinking token 计入上限 —— 512 会把正文截断)', async () => {
      const { service, requestJson } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockResolvedValue(okResult()),
      });

      await service.runShadowMode(buildInput());

      const request = requestJson.mock.calls[0][0] as { maxCompletionTokens: number };
      expect(request.maxCompletionTokens).toBe(DELIBERATION_MAX_COMPLETION_TOKENS);
      expect(request.maxCompletionTokens).toBeGreaterThan(512);
    });

    it('env 的超时 / 模型 / 温度传下去; 非法值回退默认 (不抛错)', async () => {
      const { service, requestJson } = buildService({
        env: {
          ENGINE_DELIBERATION_ENABLED: 'true',
          ENGINE_DELIBERATION_TIMEOUT_MS: '1500',
          ENGINE_DELIBERATION_MODEL: 'MiniMax-M3.1-Flash',
          ENGINE_DELIBERATION_TEMPERATURE: '0.1',
        },
        requestJson: vi.fn().mockResolvedValue(okResult()),
      });

      await service.runShadowMode(buildInput());

      const request = requestJson.mock.calls[0][0] as { timeoutMs: number; model: string; temperature: number };
      expect(request.timeoutMs).toBe(1500);
      expect(request.model).toBe('MiniMax-M3.1-Flash');
      expect(request.temperature).toBe(0.1);
    });

    it('env 的数值非法时回退默认 (超时 3000 / 温度 0.3)', async () => {
      const { service, requestJson } = buildService({
        env: {
          ENGINE_DELIBERATION_ENABLED: 'true',
          ENGINE_DELIBERATION_TIMEOUT_MS: 'abc',
          ENGINE_DELIBERATION_TEMPERATURE: '99',
        },
        requestJson: vi.fn().mockResolvedValue(okResult()),
      });

      await service.runShadowMode(buildInput());

      const request = requestJson.mock.calls[0][0] as { timeoutMs: number; temperature: number };
      expect(request.timeoutMs).toBe(DEFAULT_DELIBERATION_TIMEOUT_MS);
      expect(request.temperature).toBe(DEFAULT_DELIBERATION_TEMPERATURE);
    });

    it('模型留空 = 不下发 model (沿用 counselor 域默认模型)', async () => {
      const { service, requestJson } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true', ENGINE_DELIBERATION_MODEL: '  ' },
        requestJson: vi.fn().mockResolvedValue(okResult()),
      });

      await service.runShadowMode(buildInput());

      const request = requestJson.mock.calls[0][0] as { model?: string };
      expect(request.model).toBeUndefined();
    });
  });

  describe('③ 失败路径: 记 ok=false + errorCode, 不炸主流程', () => {
    it('LLM 报错 → trace 记 ok=false + errorCode', async () => {
      const { service, set } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockResolvedValue(failResult('llm_error')),
      });

      await service.runShadowMode(buildInput());

      const record = writtenRecord(set);
      expect(record.ok).toBe(false);
      expect(record.errorCode).toBe('llm_error');
      expect(record.deliberationDelta).toEqual({});
      expect(record.entries).toEqual([]);
    });

    it('JSON 解析失败 → trace 记 ok=false + errorCode', async () => {
      const { service, set } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockResolvedValue(failResult('json_parse_failed')),
      });

      await service.runShadowMode(buildInput());

      const record = writtenRecord(set);
      expect(record.ok).toBe(false);
      expect(record.errorCode).toBe('json_parse_failed');
    });

    it('超时 (上游报超时错) → trace 记 ok=false + errorCode, 仍不抛', async () => {
      const { service, set } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockResolvedValue(failResult('llm_error')),
      });

      await expect(service.runShadowMode(buildInput())).resolves.toBeUndefined();

      const record = writtenRecord(set);
      expect(record.ok).toBe(false);
      expect(record.errorCode).not.toBeNull();
    });

    it('requestJson 直接抛异常 → 不抛回调用方, 且写一条失败 trace', async () => {
      const { service, set } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockRejectedValue(new Error('transport down')),
      });

      await expect(service.runShadowMode(buildInput())).resolves.toBeUndefined();

      const record = writtenRecord(set);
      expect(record.ok).toBe(false);
      expect(record.errorCode).toBe('shadow_exception');
    });

    it('Redis 写失败 → 不抛回调用方 (观察面写不进去不是会话失败)', async () => {
      const set = vi.fn().mockRejectedValue(new Error('redis down'));
      const { service } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockResolvedValue(okResult()),
        set,
      });

      await expect(service.runShadowMode(buildInput())).resolves.toBeUndefined();
    });

    it('失败日志**不含**审议原文 (心理内容不进普通日志)', async () => {
      const warnings: string[] = [];
      vi.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => {
        warnings.push(typeof message === 'string' ? message : String(message));
      });
      const { service } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockRejectedValue(new Error('transport down')),
      });

      await service.runShadowMode(buildInput({ counselorText: '我最近很想自杀' }));

      const joined = warnings.join('\n');
      expect(joined).not.toContain('我最近很想自杀');
      vi.restoreAllMocks();
    });
  });

  describe('④ delta 差异计算 (逐维对比)', () => {
    it('trace 里的 deltaDiff = 审议 delta - 规则 delta', async () => {
      const { service, set } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockResolvedValue(
          okResult([
            { dimension: 'trust', delta: 0.08, operatorTags: ['empathy'], reason: '咨询师语气温和' },
            { dimension: 'safety', delta: 0.03, operatorTags: ['empathy'], reason: '未被评判' },
            { dimension: 'valence', delta: -0.02, operatorTags: ['micro_expression'], reason: '来访情绪低落' },
          ]),
        ),
      });

      await service.runShadowMode(buildInput());

      const record = writtenRecord(set);
      expect(record.deliberationDelta).toEqual({ trust: 0.08, safety: 0.03, valence: -0.02 });
      expect(record.deltaDiff.trust).toBeCloseTo(0.03, 6);
      expect(record.deltaDiff.safety).toBeCloseTo(0.01, 6);
      expect(record.deltaDiff.valence).toBeCloseTo(-0.01, 6);
      // 规则动过、审议没提的维度 → 差异 = -规则值 (全量 11 维, 分母固定).
      expect(record.deltaDiff.arousal).toBeCloseTo(0, 6);
      expect(record.deltaDiff.verbal).toBeCloseTo(0, 6);
    });

    it('deltaDiff 是全量 11 维 (统计口径固定, 不随模型说几维而变)', async () => {
      const diff = computeDeliberationDeltaDiff(RULE_DELTA, { trust: 0.08 });
      expect(Object.keys(diff)).toHaveLength(11);
      expect(diff.trust).toBeCloseTo(0.03, 6);
      expect(diff.depth).toBeCloseTo(0, 6);
    });

    it('computeRuleDelta = 本轮前后快照的逐维差', () => {
      const base = snapshot({ trust: 0.5, safety: 0.5, bond: 0.5, valence: 0, arousal: 0.3, verbal: 0.4 });
      const next = snapshot({ trust: 0.55, safety: 0.52, bond: 0.51, valence: -0.01, arousal: 0.3, verbal: 0.4 });

      const delta = computeRuleDelta(base, next);

      expect(delta.trust).toBeCloseTo(0.05, 6);
      expect(delta.safety).toBeCloseTo(0.02, 6);
      expect(delta.bond).toBeCloseTo(0.01, 6);
      expect(delta.valence).toBeCloseTo(-0.01, 6);
      expect(delta.arousal).toBeCloseTo(0, 6);
      expect(delta.verbal).toBeCloseTo(0, 6);
    });

    it('审议标签去重合并; reason 逐条汇总', async () => {
      const { service, set } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockResolvedValue(
          okResult([
            { dimension: 'trust', delta: 0.08, operatorTags: ['empathy'], reason: '理由一' },
            { dimension: 'bond', delta: 0.02, operatorTags: ['empathy', 'rapport_shift'], reason: '理由二' },
          ]),
        ),
      });

      await service.runShadowMode(buildInput());

      const record = writtenRecord(set);
      expect(record.operatorTags).toEqual(['empathy', 'rapport_shift']);
      expect(record.reason).toBe('理由一；理由二');
      expect(record.confidence).toBeCloseTo(0.65, 6);
      expect(record.summary).toBe('来访情绪略有低落');
      expect(record.entries).toHaveLength(2);
    });
  });

  describe('⑤ trace 表结构与 key 设计', () => {
    it('key 用长度前缀复合键 (撞键防护: 跨租户串数据)', () => {
      const key = buildDeliberationTraceKey('a:b', 'c', 1);
      expect(key).toBe('deliberation_trace:3:a:b:1:c:1');
      // 撞键对照: (租户="a:b", 会话="c") 与 (租户="a", 会话="b:c") 必须**不同** key.
      expect(buildDeliberationTraceKey('a:b', 'c', 1)).not.toBe(buildDeliberationTraceKey('a', 'b:c', 1));
    });

    it('写 Redis 时带 30 天 TTL', async () => {
      const { service, set } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockResolvedValue(okResult()),
      });

      await service.runShadowMode(buildInput());

      const call = set.mock.calls[0] as [string, string, number];
      expect(call[2]).toBe(DEFAULT_DELIBERATION_TRACE_TTL_SECONDS);
      expect(call[2]).toBe(2_592_000);
    });

    it('trace 字段完整 (耗时 / token / ruleDelta / deliberationDelta / deltaDiff / 标签 / 理由 / 置信度)', async () => {
      const { service, set } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockResolvedValue(okResult([{ dimension: 'trust', delta: 0.08, operatorTags: ['empathy'], reason: '理由' }])),
      });

      await service.runShadowMode(buildInput());

      const record = writtenRecord(set);
      expect(typeof record.durationMs).toBe('number');
      expect(record.durationMs).toBeGreaterThanOrEqual(0);
      expect(record.tokenUsage).toEqual({ promptTokens: 1200, completionTokens: 180, totalTokens: 1380 });
      expect(record.ruleDelta).toEqual(RULE_DELTA);
      expect(record.deltaDiff).toBeDefined();
      expect(record.operatorTags).toEqual(['empathy']);
      expect(record.reason).toBe('理由');
      expect(record.confidence).toBeCloseTo(0.65, 6);
      expect(typeof record.timestamp).toBe('string');
    });

    it('trace **不存**对话原文 (只存模型产出的判断)', async () => {
      const { service, set } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockResolvedValue(okResult()),
      });

      await service.runShadowMode(buildInput({ counselorText: '来访者原话', visitorText: '来访回应原话' }));

      const [, value] = set.mock.calls[0] as [string, string];
      expect(value).not.toContain('来访者原话');
      expect(value).not.toContain('来访回应原话');
    });
  });

  describe('⑥ 硬安全维度: 拒掉但**留证据**', () => {
    it('非法维度被丢进 rejectedEntries (PoC 的"零误触发"就查这一项)', () => {
      const validated = validateDeliberationOutput({
        deltas: [
          { dimension: 'trust', delta: 0.05, operatorTags: ['empathy'], reason: '合法条目' },
          { dimension: 'suicideRisk', delta: 0.9, operatorTags: ['empathy'], reason: '越界条目' },
        ],
        summary: '总结',
        confidence: 0.5,
      });

      expect(validated).not.toBeNull();
      expect(validated?.output.deltas).toHaveLength(1);
      expect(validated?.rejectedEntries).toHaveLength(1);
      expect((validated?.rejectedEntries[0] as { dimension: string }).dimension).toBe('suicideRisk');
    });

    it('顶层形状不对 → 整份判不合法 (client 返 schema_validation_failed)', () => {
      expect(validateDeliberationOutput(null)).toBeNull();
      expect(validateDeliberationOutput('nope')).toBeNull();
      expect(validateDeliberationOutput({})).toBeNull();
      expect(validateDeliberationOutput({ deltas: 'x', summary: 's', confidence: 0.5 })).toBeNull();
      expect(validateDeliberationOutput({ deltas: [], summary: 1, confidence: 0.5 })).toBeNull();
      expect(validateDeliberationOutput({ deltas: [], summary: 's', confidence: 'high' })).toBeNull();
    });

    it('幅度越界 / 标签非法 / 理由为空 的条目被丢', () => {
      const validated = validateDeliberationOutput({
        deltas: [
          { dimension: 'trust', delta: 9, operatorTags: ['empathy'], reason: '越界' },
          { dimension: 'trust', delta: 0.1, operatorTags: ['not_a_tag'], reason: '标签非法' },
          { dimension: 'trust', delta: 0.1, operatorTags: ['empathy'], reason: '  ' },
          { dimension: 'trust', delta: 0.1, operatorTags: [], reason: '空标签' },
        ],
        summary: '总结',
        confidence: 0.5,
      });

      expect(validated?.output.deltas).toHaveLength(0);
      expect(validated?.rejectedEntries).toHaveLength(4);
    });

    it('合法的多条 delta 全被保留', () => {
      const validated = validateDeliberationOutput({
        deltas: [
          { dimension: 'trust', delta: 0.05, operatorTags: ['empathy'], reason: '共情回应' },
          { dimension: 'depth', delta: -0.02, operatorTags: ['open_probe', 'empathy'], reason: '触及深层' },
        ],
        summary: '总结',
        confidence: 0.7,
      });

      expect(validated?.output.deltas).toHaveLength(2);
      expect(validated?.output.deltas[1]?.operatorTags).toEqual(['open_probe', 'empathy']);
      expect(validated?.rejectedEntries).toHaveLength(0);
    });
  });

  describe('⑦ 旁路接线 (编排门面 · fire-and-forget)', () => {
    /** 记录审议调用的端口替身. */
    class StubDeliberation implements DeliberationShadowPort {
      readonly calls: DeliberationShadowInput[] = [];

      async runShadowMode(input: DeliberationShadowInput): Promise<void> {
        this.calls.push(input);
      }
    }

    /** 会话端口 stub: 每次返回递增轮次的固定出参. */
    class StubSession implements EngineSessionPort {
      turnIndex = 0;

      openSession(input: OpenEngineSessionInput): EngineSessionHandle {
        return { handleId: 'handle-1', sessionId: input.sessionId };
      }

      async turn(): Promise<EngineTurnOutput> {
        this.turnIndex += 1;
        return {
          reply: '',
          snapshot: snapshot({ trust: 0.5 + this.turnIndex * 0.01 }),
          turnIndex: this.turnIndex,
        };
      }

      closeSession(): void {
        /* 占位. */
      }
    }

    /** 渲染端口 stub. */
    class StubRenderer implements RenderPort {
      async render(spec: RenderSpec): Promise<RenderResult> {
        return {
          text: '来访回了一句',
          taskKind: spec.taskKind,
          usage: { completionTokens: 10, totalTokens: 20 },
          fallbackUsed: false,
        };
      }
    }

    /** 记忆仓储 stub. */
    class StubMemoryStore implements MemoryStore {
      async remember(entry: MemoryEntry): Promise<void> {
        void entry;
      }

      async recall(): Promise<readonly MemoryHit[]> {
        return [];
      }
    }

    /** 装配一个门面 (全注入). */
    function buildOrchestrator(options: { deliberation?: DeliberationShadowPort; context?: TurnSessionContext }): {
      orchestrator: TurnRenderOrchestrator;
      deliberation: StubDeliberation;
    } {
      const deliberation = (options.deliberation as StubDeliberation) ?? new StubDeliberation();
      const context: TurnSessionContext = options.context ?? {
        tenantId: TENANT,
        sessionId: SESSION,
        visitorId: 'visitor-1',
        userId: USER,
      };
      const orchestrator = new TurnRenderOrchestrator({
        session: new StubSession(),
        renderer: new StubRenderer(),
        memories: new StubMemoryStore(),
        resolveSession: () => context,
        ...(deliberation ? { deliberation } : {}),
      });
      return { orchestrator, deliberation };
    }

    it('第一轮跳过 (没有"本轮开始前"的快照), 第二轮起旁路跑一次', async () => {
      const { orchestrator, deliberation } = buildOrchestrator({});

      await orchestrator.turn('handle-1', { userText: '第一句' });
      expect(deliberation.calls).toHaveLength(0);

      await orchestrator.turn('handle-1', { userText: '第二句' });
      expect(deliberation.calls).toHaveLength(1);
      expect(deliberation.calls[0]?.turnIndex).toBe(2);
      expect(deliberation.calls[0]?.counselorText).toBe('第二句');
      expect(deliberation.calls[0]?.visitorText).toBe('来访回了一句');
      expect(deliberation.calls[0]?.mode).toBe('freeform');
    });

    it('旁路调用**不 await** (主流程不因审议而变慢)', async () => {
      let resolveShadow: (() => void) | undefined;
      const slow: DeliberationShadowPort = {
        runShadowMode: () =>
          new Promise<void>((resolve) => {
            resolveShadow = resolve;
          }),
      };
      const { orchestrator } = buildOrchestrator({ deliberation: slow });

      // 第二轮: 审议挂住不回, 但 turn 本身必须立刻返回.
      await orchestrator.turn('handle-1', { userText: '第一句' });
      const pending = orchestrator.turn('handle-1', { userText: '第二句' });
      await expect(Promise.race([pending, Promise.resolve('done')])).resolves.toBe('done');
      resolveShadow?.();
    });

    it('没装配审议端口时照常跑 (缺省 = 纯增强, 不影响会话)', async () => {
      const orchestrator = new TurnRenderOrchestrator({
        session: new StubSession(),
        renderer: new StubRenderer(),
        memories: new StubMemoryStore(),
        resolveSession: () => ({ tenantId: TENANT, sessionId: SESSION, visitorId: 'visitor-1' }),
      });

      const first = await orchestrator.turn('handle-1', { userText: '第一句' });
      const second = await orchestrator.turn('handle-1', { userText: '第二句' });

      // 缺端口不能让门面起不来, 也不能改变轮次推进与回复内容.
      expect(first.reply).toBe('来访回了一句');
      expect(first.turnIndex).toBe(1);
      expect(second.reply).toBe('来访回了一句');
      expect(second.turnIndex).toBe(2);
    });

    it('归属里没有学员账号 id 时跳过 (LLM 调用要求 userId 非空)', async () => {
      const { orchestrator, deliberation } = buildOrchestrator({
        context: { tenantId: TENANT, sessionId: SESSION, visitorId: 'visitor-1' },
      });

      await orchestrator.turn('handle-1', { userText: '第一句' });
      await orchestrator.turn('handle-1', { userText: '第二句' });

      expect(deliberation.calls).toHaveLength(0);
    });

    it('审议端口抛异常也不影响主流程', async () => {
      const broken: DeliberationShadowPort = {
        runShadowMode: () => Promise.reject(new Error('boom')),
      };
      const { orchestrator } = buildOrchestrator({ deliberation: broken });

      await orchestrator.turn('handle-1', { userText: '第一句' });
      const result = await orchestrator.turn('handle-1', { userText: '第二句' });

      expect(result.reply).toBe('来访回了一句');
    });

    it('审议入参里的 baseSnapshot 是**上一轮结束时的**快照', async () => {
      const { orchestrator, deliberation } = buildOrchestrator({});

      await orchestrator.turn('handle-1', { userText: '第一句' });
      await orchestrator.turn('handle-1', { userText: '第二句' });

      // 第一轮结束后的 trust = 0.51 → 第二轮的起始快照必须是它.
      expect(deliberation.calls[0]?.baseSnapshot.trust).toBeCloseTo(0.51, 6);
      // 规则 delta = 本轮前后快照差 = 0.52 - 0.51 = 0.01 (stub 每轮固定 +0.01).
      expect(deliberation.calls[0]?.ruleDelta.trust).toBeCloseTo(0.01, 6);
    });
  });
});
