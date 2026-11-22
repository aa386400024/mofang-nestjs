// V2026-11-12 治本 (D-1 第二段 · 模型轨事件分类器):
//   职责: 钉死模型轨的七段行为 ——
//     ① 回落: 每个错误码**逐字**回落到规则轨 (失败即等价, 不产生第二套结果);
//     ② 熔断: 开闸后**一次 LLM 都不发**;
//     ③ 跨轮: 连续计数递增 / 命中重置 / 中断不推进 / 多会话隔离 / forgetSession 清空;
//     ④ 影子零回归: core events 与 BDI **逐字**不变;
//     ⑤ 红线: 考核场景恒 rule_only (零 LLM); 缺省灰度零回归;
//     ⑥ 隐私: 观测表**装不下**原文 / matchedTerms / 展示名;
//     ⑦ 生效 (D-7): llm_active 下模型轨结果**替换**规则轨结果进 core events;
//        名单外 / 考核场次 / 总开关关 → 逐场 rule_only (零 LLM 零副作用).
//   边界: 全 mock; 不起 Nest 容器; 不连 DB / 不发网络 / 不调真模型.
//
//   ⚠️ **fixture 只放人工构造的样例, 不放真实逐字稿** (隐私 + 双盲纪律).
//   ⚠️ **不断言任何真实心理内容** —— 本单只关心"两轨判出的是不是同一套标签".
//
//   验证: pnpm exec vitest run test/engine-adapters/model-event-classifier.spec.ts

import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { CounselorLlmJsonRequest, CounselorLlmJsonResult } from '../../src/counselor/providers/llm-json.client.js';
import {
  DEFAULT_MODEL_CLASSIFIER_TIMEOUT_MS,
  parseModelClassifierGrayscaleSessions,
  resolveModelClassifierEffectiveMode,
  resolveModelClassifierEnabled,
  resolveModelClassifierModeConfig,
  resolveModelClassifierSessionMode,
  resolveModelClassifierTimeoutMs,
  type ModelClassifierModeConfig,
} from '../../src/engine-adapters/cognition/model-classifier-mode.config.js';
import {
  MODEL_CLASSIFIER_TRACE_KEY_PREFIX,
  buildModelClassifierTraceKey,
  resolveLatencyBucket,
  type ModelClassifierObservation,
  type ModelClassifierObserver,
} from '../../src/engine-adapters/cognition/model-classifier-observation.js';
import {
  ModelEventClassifier,
  computeModelClassifierAgreement,
  normalizeModelClassifierFallbackCode,
  resolveModelClassifierCircuitStatus,
  type ModelClassifierLlmPort,
  type ModelClassifierSessionContext,
  type ModelClassifierSessionResolver,
} from '../../src/engine-adapters/cognition/model-event-classifier.js';
import { CORE_EVENT_KINDS, mapModelLabels, validateModelClassification } from '../../src/engine-adapters/cognition/model-event-mapping.js';
import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository.js';
import { InMemoryEngineSession } from '../../src/engine-core/in-memory/in-memory-engine-session.js';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store.js';
import { RuleBasedClassifier, type ClassifyContext, type EventClassifier } from '../../src/engine-core/index.js';

// TD-10 · T-2: 真实 ioredis 不进 import 阶段 (适配层仍是真实现; 替身口径见 test/helpers/sdk-stubs.ts).
vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../helpers/sdk-stubs.js');
  return createIoredisStub();
});

/** 构造样例: 命中共情词表 (与 wp58 spec 同一份构造语料, 非真实逐字稿). */
const EMPATHY_TEXT = '听起来你现在一定很难受';
/** 构造样例: 不命中任何词表. */
const NEUTRAL_TEXT = '嗯。';
/** 构造样例: 命中评判词表. */
const JUDGMENT_TEXT = '你就是想不开';

/** 一次 LLM 调用的记录 (用来断言"发了什么"与"没发什么"). */
interface LlmCall {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly schemaDescription: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly timeoutMs: number;
}

/** LLM 桩 (不打网络; 按队列吐预置结果). */
interface LlmStub extends ModelClassifierLlmPort {
  readonly calls: LlmCall[];
}

/**
 * 造一个 LLM 桩.
 *
 * @param responses 预置结果队列 (逐次消费)
 * @returns LLM 桩
 */
function llmStub(responses: readonly unknown[] = []): LlmStub {
  const calls: LlmCall[] = [];
  const queue = [...responses];
  return {
    calls,
    requestJson: async <T>(input: CounselorLlmJsonRequest<T>): Promise<CounselorLlmJsonResult<T>> => {
      calls.push({
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        schemaDescription: input.schemaDescription,
        tenantId: input.tenantId,
        userId: input.userId,
        timeoutMs: input.timeoutMs,
      });
      const next = queue.shift();
      if (next === undefined) {
        return { ok: false, data: null, rawText: '', errorCode: 'fetch_error', errorMessage: 'stub 队列已空', usage: null };
      }
      const response = next as { ok: boolean; data: unknown; errorCode: string | null };
      if (!response.ok) return next as CounselorLlmJsonResult<T>;
      // 模拟真实 client 的形状: 先跑 validate, 不通过就是 schema_validation_failed.
      const validated = input.validate(response.data);
      if (validated === null) {
        return {
          ok: false,
          data: null,
          rawText: '',
          errorCode: 'schema_validation_failed',
          errorMessage: 'stub 校验失败',
          usage: null,
        };
      }
      return { ok: true, data: validated, rawText: '{}', errorCode: null, errorMessage: null, usage: null };
    },
  };
}

/** 造一个成功响应. */
function okResponse(data: unknown): unknown {
  return { ok: true, data, rawText: '{}', errorCode: null, errorMessage: null, usage: null };
}

/** 造一个失败响应 (错误当数据, 不抛). */
function failResponse(errorCode: string): unknown {
  return { ok: false, data: null, rawText: '', errorCode, errorMessage: 'stub', usage: null };
}

/**
 * 造一个 ConfigService 桩 (只实现 get).
 *
 * @param env env 值表
 * @returns ConfigService 桩
 */
function configStub(env: Readonly<Record<string, string>>): ConfigService {
  return { get: (key: string): string | undefined => env[key] } as unknown as ConfigService;
}

/** 观测桩 (记下每一条对照记录). */
interface ObserverStub extends ModelClassifierObserver {
  readonly records: ModelClassifierObservation[];
}

/**
 * 造一个观测桩.
 *
 * @returns 观测桩
 */
function observerStub(): ObserverStub {
  const records: ModelClassifierObservation[] = [];
  return {
    records,
    record: (observation: ModelClassifierObservation): void => {
      records.push(observation);
    },
  };
}

/**
 * 造一个会话归属反查桩.
 *
 * @param contexts 会话 id → 归属切片
 * @returns 反查桩
 */
function resolverStub(contexts: Readonly<Record<string, ModelClassifierSessionContext>>): ModelClassifierSessionResolver {
  return {
    resolveBySessionId: (sessionId: string): ModelClassifierSessionContext | undefined => contexts[sessionId],
  };
}

/**
 * 造一份灰度配置.
 *
 * @param overrides 覆盖项
 * @returns 灰度配置
 */
function modeConfig(overrides: Partial<ModelClassifierModeConfig> = {}): ModelClassifierModeConfig {
  return {
    effectiveMode: 'shadow',
    grayscaleSessions: new Set<string>(),
    timeoutMs: DEFAULT_MODEL_CLASSIFIER_TIMEOUT_MS,
    ...overrides,
  };
}

/** 默认会话归属. */
const SESSION_1: ModelClassifierSessionContext = { tenantId: 't1', userId: 'u1', scenarioType: 'full_simulation' };

/**
 * 造一个模型轨分类器.
 *
 * @param options 覆盖项
 * @returns 分类器
 */
function makeClassifier(
  options: {
    readonly llm?: LlmStub;
    readonly observer?: ObserverStub;
    readonly modeConfig?: Partial<ModelClassifierModeConfig>;
    readonly sessions?: Readonly<Record<string, ModelClassifierSessionContext>>;
    readonly minConfidence?: number;
    readonly circuitThreshold?: number;
  } = {},
): { readonly classifier: ModelEventClassifier; readonly llm: LlmStub; readonly observer: ObserverStub } {
  const llm = options.llm ?? llmStub();
  const observer = options.observer ?? observerStub();
  const classifier = new ModelEventClassifier(
    llm,
    modeConfig(options.modeConfig),
    observer,
    resolverStub(options.sessions ?? { s1: SESSION_1 }),
    'stub-model',
    {
      ...(options.minConfidence === undefined ? {} : { minConfidence: options.minConfidence }),
      ...(options.circuitThreshold === undefined ? {} : { circuitThreshold: options.circuitThreshold }),
    },
  );
  return { classifier, llm, observer };
}

describe('模型轨 · 灰度配置 (env → 模式)', () => {
  it('缺省 → rule_only (总开关关 = 一次 LLM 都不发)', () => {
    expect(resolveModelClassifierModeConfig(configStub({})).effectiveMode).toBe('rule_only');
  });

  it('总开关开着但模式没配 → 仍 rule_only (现状就是规则轨)', () => {
    const config = resolveModelClassifierModeConfig(configStub({ ENGINE_MODEL_CLASSIFIER_ENABLED: 'true' }));
    expect(config.effectiveMode).toBe('rule_only');
  });

  it('总开关关着但模式写着 llm_active → 仍 rule_only (总开关先于模式)', () => {
    const config = resolveModelClassifierModeConfig(configStub({ ENGINE_MODEL_CLASSIFIER_EFFECTIVE_MODE: 'llm_active' }));
    expect(config.effectiveMode).toBe('rule_only');
  });

  it('总开关 + 模式 = shadow → shadow', () => {
    const config = resolveModelClassifierModeConfig(
      configStub({ ENGINE_MODEL_CLASSIFIER_ENABLED: 'true', ENGINE_MODEL_CLASSIFIER_EFFECTIVE_MODE: 'shadow' }),
    );
    expect(config.effectiveMode).toBe('shadow');
  });

  it('非法模式值 → rule_only (回落方向与审议相反: 回落到各自的现状)', () => {
    expect(resolveModelClassifierEffectiveMode('nonsense')).toBe('rule_only');
    expect(resolveModelClassifierEffectiveMode(void 0)).toBe('rule_only');
    expect(resolveModelClassifierEffectiveMode('SHADOW')).toBe('shadow');
  });

  it('布尔口径: true / 1 / yes / on = 开 (与仓库既有开关同口径)', () => {
    expect(resolveModelClassifierEnabled('true')).toBe(true);
    expect(resolveModelClassifierEnabled('1')).toBe(true);
    expect(resolveModelClassifierEnabled('yes')).toBe(true);
    expect(resolveModelClassifierEnabled('on')).toBe(true);
    expect(resolveModelClassifierEnabled('abc')).toBe(false);
    expect(resolveModelClassifierEnabled(void 0)).toBe(false);
  });

  it('名单: 空 = 全量; 逗号分隔去空白去重', () => {
    expect(parseModelClassifierGrayscaleSessions('').size).toBe(0);
    expect(parseModelClassifierGrayscaleSessions(void 0).size).toBe(0);
    expect([...parseModelClassifierGrayscaleSessions(' s1 , s2 ,s1 ')]).toEqual(['s1', 's2']);
  });

  it('超时: 非法值 → 缺省 3000 (照审议口径)', () => {
    expect(resolveModelClassifierTimeoutMs(void 0)).toBe(DEFAULT_MODEL_CLASSIFIER_TIMEOUT_MS);
    expect(resolveModelClassifierTimeoutMs('abc')).toBe(DEFAULT_MODEL_CLASSIFIER_TIMEOUT_MS);
    expect(resolveModelClassifierTimeoutMs('1500')).toBe(1500);
  });

  it('考核场景 (exam) → 恒 rule_only: 即使 llm_active + 名单内也不放行', () => {
    const config = modeConfig({ effectiveMode: 'llm_active', grayscaleSessions: new Set(['s1']) });
    expect(resolveModelClassifierSessionMode(config, 's1', 'exam')).toBe('rule_only');
  });

  it('场景查不到 → rule_only (保守: 没法证明它不是考核场)', () => {
    const config = modeConfig({ effectiveMode: 'llm_active', grayscaleSessions: new Set(['s1']) });
    expect(resolveModelClassifierSessionMode(config, 's1', void 0)).toBe('rule_only');
  });

  it('llm_active: 名单内 → llm_active; 名单外 → rule_only; 名单空 = 全量', () => {
    const listed = modeConfig({ effectiveMode: 'llm_active', grayscaleSessions: new Set(['s1']) });
    expect(resolveModelClassifierSessionMode(listed, 's1', 'full_simulation')).toBe('llm_active');
    expect(resolveModelClassifierSessionMode(listed, 's2', 'full_simulation')).toBe('rule_only');
    const open = modeConfig({ effectiveMode: 'llm_active' });
    expect(resolveModelClassifierSessionMode(open, 's9', 'full_simulation')).toBe('llm_active');
  });

  it('shadow 模式: 名单无关 (影子不影响任何行为)', () => {
    const config = modeConfig({ effectiveMode: 'shadow', grayscaleSessions: new Set(['s1']) });
    expect(resolveModelClassifierSessionMode(config, 's2', 'full_simulation')).toBe('shadow');
  });
});

describe('模型轨 · 回落 (逐字等价规则轨)', () => {
  const rule = new RuleBasedClassifier();

  it.each([
    ['json_not_found', 'json_not_found'],
    ['json_parse_failed', 'json_parse_failed'],
    ['schema_validation_failed', 'schema_validation_failed'],
    ['http_401', 'http_401'],
    ['http_429', 'http_429'],
    ['http_500', 'http_5xx'],
    ['http_502', 'http_5xx'],
    ['no_body', 'no_body'],
    ['parse_error', 'parse_error'],
    ['fetch_error', 'fetch_error'],
  ])('错误码 %s → 逐字回落到规则轨, 观测记真实码 %s', async (code: string, expected: string) => {
    const { classifier, observer } = makeClassifier({ llm: llmStub([failResponse(code)]) });

    const events = await classifier.classifyAsync(EMPATHY_TEXT, { sessionId: 's1' });

    expect(events).toEqual(rule.classify(EMPATHY_TEXT));
    expect(observer.records[0]?.fallbackReason).toBe(expected);
    expect(observer.records[0]?.degraded).toBe(true);
    expect(observer.records[0]?.modelKinds).toEqual([]);
  });

  it('模型给空标签 → 回落 + schema_validation_failed (空判定没有意义)', async () => {
    const { classifier, observer } = makeClassifier({ llm: llmStub([okResponse({ kinds: [], confidence: 0.9 })]) });

    const events = await classifier.classifyAsync(EMPATHY_TEXT, { sessionId: 's1' });

    expect(events).toEqual(rule.classify(EMPATHY_TEXT));
    expect(observer.records[0]?.fallbackReason).toBe('schema_validation_failed');
  });

  it('模型给未知标签 → 丢弃后为空 → 回落 + schema_validation_failed', async () => {
    const { classifier, observer } = makeClassifier({ llm: llmStub([okResponse({ kinds: ['not_a_real_label'], confidence: 0.9 })]) });

    const events = await classifier.classifyAsync(EMPATHY_TEXT, { sessionId: 's1' });

    expect(events).toEqual(rule.classify(EMPATHY_TEXT));
    expect(observer.records[0]?.fallbackReason).toBe('schema_validation_failed');
  });

  it('模型输出形状不合法 (confidence 越界) → 回落 + schema_validation_failed', async () => {
    const { classifier, observer } = makeClassifier({ llm: llmStub([okResponse({ kinds: ['empathy'], confidence: 7 })]) });

    const events = await classifier.classifyAsync(EMPATHY_TEXT, { sessionId: 's1' });

    expect(events).toEqual(rule.classify(EMPATHY_TEXT));
    expect(observer.records[0]?.fallbackReason).toBe('schema_validation_failed');
  });

  it('低置信 → 回落规则轨 + 记 low_confidence (但模型标签仍进观测)', async () => {
    const { classifier, observer } = makeClassifier({
      llm: llmStub([okResponse({ kinds: ['holding_present'], confidence: 0.2 })]),
      minConfidence: 0.6,
    });

    const events = await classifier.classifyAsync(EMPATHY_TEXT, { sessionId: 's1' });

    expect(events).toEqual(rule.classify(EMPATHY_TEXT));
    expect(observer.records[0]?.fallbackReason).toBe('low_confidence');
    expect(observer.records[0]?.modelKinds).toEqual(['holding_present']);
    expect(observer.records[0]?.confidence).toBe(0.2);
  });

  it('拿不到 sessionId → 零 LLM, 逐字回落到规则轨', async () => {
    const { classifier, llm } = makeClassifier();

    const events = await classifier.classifyAsync(EMPATHY_TEXT, {});

    expect(events).toEqual(rule.classify(EMPATHY_TEXT));
    expect(llm.calls).toHaveLength(0);
  });

  it('归属查不到 → 零 LLM, 逐字回落到规则轨', async () => {
    const { classifier, llm } = makeClassifier({ sessions: {} });

    const events = await classifier.classifyAsync(EMPATHY_TEXT, { sessionId: 's1' });

    expect(events).toEqual(rule.classify(EMPATHY_TEXT));
    expect(llm.calls).toHaveLength(0);
  });

  it('缺省灰度 (rule_only) → 零 LLM, 逐字回落到规则轨 (零回归)', async () => {
    const { classifier, llm } = makeClassifier({ modeConfig: { effectiveMode: 'rule_only' } });

    const events = await classifier.classifyAsync(EMPATHY_TEXT, { sessionId: 's1' });

    expect(events).toEqual(rule.classify(EMPATHY_TEXT));
    expect(llm.calls).toHaveLength(0);
  });

  it('考核场景 → 零 LLM (考核红线: 模型输出不可复现)', async () => {
    const { classifier, llm } = makeClassifier({
      sessions: { s1: { tenantId: 't1', userId: 'u1', scenarioType: 'exam' } },
    });

    const events = await classifier.classifyAsync(EMPATHY_TEXT, { sessionId: 's1' });

    expect(events).toEqual(rule.classify(EMPATHY_TEXT));
    expect(llm.calls).toHaveLength(0);
  });
});

describe('模型轨 · 熔断 (开闸后一次 LLM 都不发)', () => {
  it('连续失败到阈值 → 后续请求不再发 LLM, 记 circuit_open', async () => {
    const { classifier, llm, observer } = makeClassifier({
      llm: llmStub([failResponse('fetch_error'), failResponse('fetch_error'), failResponse('fetch_error')]),
      circuitThreshold: 3,
    });

    await classifier.classifyAsync(EMPATHY_TEXT, { sessionId: 's1' });
    await classifier.classifyAsync(EMPATHY_TEXT, { sessionId: 's1' });
    await classifier.classifyAsync(EMPATHY_TEXT, { sessionId: 's1' });
    expect(llm.calls).toHaveLength(3);

    const events = await classifier.classifyAsync(EMPATHY_TEXT, { sessionId: 's1' });

    expect(llm.calls).toHaveLength(3);
    expect(observer.records[3]?.fallbackReason).toBe('circuit_open');
    expect(events).toEqual(new RuleBasedClassifier().classify(EMPATHY_TEXT));
  });

  it('一次成功即清零 (不会因为历史失败一直熔断)', async () => {
    const { classifier, llm } = makeClassifier({
      llm: llmStub([failResponse('fetch_error'), okResponse({ kinds: ['empathy'], confidence: 0.9 })]),
      circuitThreshold: 2,
    });

    await classifier.classifyAsync(EMPATHY_TEXT, { sessionId: 's1' });
    await classifier.classifyAsync(EMPATHY_TEXT, { sessionId: 's1' });
    await classifier.classifyAsync(EMPATHY_TEXT, { sessionId: 's1' });

    expect(llm.calls).toHaveLength(3);
  });

  it('错误码归一: http_5xx 家族归一, timeout 不自造码 (落 fetch_error)', () => {
    expect(normalizeModelClassifierFallbackCode('http_500')).toBe('http_5xx');
    expect(normalizeModelClassifierFallbackCode('http_599')).toBe('http_5xx');
    expect(normalizeModelClassifierFallbackCode('timeout')).toBe('fetch_error');
    expect(normalizeModelClassifierFallbackCode(null)).toBe('fetch_error');
    expect(normalizeModelClassifierFallbackCode('http_429')).toBe('http_429');
  });

  it('熔断状态是算出来的 (纯函数): 三态判定', () => {
    expect(resolveModelClassifierCircuitStatus(null, 3, 1000, 0)).toBe('closed');
    expect(resolveModelClassifierCircuitStatus({ failureCount: 2, openedAt: null }, 3, 1000, 0)).toBe('closed');
    expect(resolveModelClassifierCircuitStatus({ failureCount: 3, openedAt: 100 }, 3, 1000, 500)).toBe('open');
    expect(resolveModelClassifierCircuitStatus({ failureCount: 3, openedAt: 100 }, 3, 1000, 5000)).toBe('half-open');
  });
});

/**
 * 从 prompt 里读出连续 neutral 计数 (观测用的唯一外部可见面).
 *
 * @param prompt user prompt 文本
 * @returns 计数; 读不到 → -1
 */
function readNeutralStreak(prompt: string): number {
  const match = /【连续未命中任何行为标签的轮数】(\d+)/.exec(prompt);
  return match?.[1] === undefined ? -1 : Number(match[1]);
}

describe('模型轨 · 跨轮状态 (分桶 / 推进 / 重置 / 隔离 / 清理)', () => {
  it('连续两轨都判 neutral → 计数递增', async () => {
    const { classifier, llm } = makeClassifier({
      llm: llmStub([
        okResponse({ kinds: ['neutral'], confidence: 0.9 }),
        okResponse({ kinds: ['neutral'], confidence: 0.9 }),
        okResponse({ kinds: ['neutral'], confidence: 0.9 }),
      ]),
    });

    await classifier.classifyAsync(NEUTRAL_TEXT, { sessionId: 's1' });
    await classifier.classifyAsync(NEUTRAL_TEXT, { sessionId: 's1' });
    await classifier.classifyAsync(NEUTRAL_TEXT, { sessionId: 's1' });

    expect(readNeutralStreak(llm.calls[0]?.userPrompt ?? '')).toBe(0);
    expect(readNeutralStreak(llm.calls[1]?.userPrompt ?? '')).toBe(1);
    expect(readNeutralStreak(llm.calls[2]?.userPrompt ?? '')).toBe(2);
  });

  it('命中行为事件 → 计数重置', async () => {
    const { classifier, llm } = makeClassifier({
      llm: llmStub([
        okResponse({ kinds: ['neutral'], confidence: 0.9 }),
        okResponse({ kinds: ['empathy'], confidence: 0.9 }),
        okResponse({ kinds: ['neutral'], confidence: 0.9 }),
      ]),
    });

    await classifier.classifyAsync(NEUTRAL_TEXT, { sessionId: 's1' });
    await classifier.classifyAsync(EMPATHY_TEXT, { sessionId: 's1' });
    await classifier.classifyAsync(NEUTRAL_TEXT, { sessionId: 's1' });

    expect(readNeutralStreak(llm.calls[1]?.userPrompt ?? '')).toBe(1);
    expect(readNeutralStreak(llm.calls[2]?.userPrompt ?? '')).toBe(0);
  });

  it('模型判了 holding_present → 规则轨的 neutral 不再计数 (模型看到了规则轨没看到的)', async () => {
    const { classifier, llm } = makeClassifier({
      llm: llmStub([okResponse({ kinds: ['neutral', 'holding_present'], confidence: 0.9 })]),
    });

    await classifier.classifyAsync(NEUTRAL_TEXT, { sessionId: 's1' });
    await classifier.classifyAsync(NEUTRAL_TEXT, { sessionId: 's1' });

    expect(readNeutralStreak(llm.calls[1]?.userPrompt ?? '')).toBe(0);
  });

  it('回落轮也推进状态 (回落是一次有效判定, 计数不断链)', async () => {
    const { classifier, llm } = makeClassifier({
      llm: llmStub([failResponse('fetch_error'), okResponse({ kinds: ['neutral'], confidence: 0.9 })]),
    });

    await classifier.classifyAsync(NEUTRAL_TEXT, { sessionId: 's1' });
    await classifier.classifyAsync(NEUTRAL_TEXT, { sessionId: 's1' });

    expect(readNeutralStreak(llm.calls[1]?.userPrompt ?? '')).toBe(1);
  });

  it('多会话隔离 (两个 sessionId 互不影响)', async () => {
    const { classifier, llm } = makeClassifier({
      llm: llmStub([
        okResponse({ kinds: ['neutral'], confidence: 0.9 }),
        okResponse({ kinds: ['neutral'], confidence: 0.9 }),
        okResponse({ kinds: ['neutral'], confidence: 0.9 }),
        okResponse({ kinds: ['neutral'], confidence: 0.9 }),
      ]),
      sessions: {
        s1: { tenantId: 't1', userId: 'u1', scenarioType: 'full_simulation' },
        s2: { tenantId: 't1', userId: 'u1', scenarioType: 'full_simulation' },
      },
    });

    await classifier.classifyAsync(NEUTRAL_TEXT, { sessionId: 's1' });
    await classifier.classifyAsync(NEUTRAL_TEXT, { sessionId: 's1' });
    await classifier.classifyAsync(NEUTRAL_TEXT, { sessionId: 's2' });

    expect(readNeutralStreak(llm.calls[1]?.userPrompt ?? '')).toBe(1);
    expect(readNeutralStreak(llm.calls[2]?.userPrompt ?? '')).toBe(0);
  });

  it('forgetSession → 分桶清空 (不留跨场残留)', async () => {
    const { classifier, llm } = makeClassifier({
      llm: llmStub([
        okResponse({ kinds: ['neutral'], confidence: 0.9 }),
        okResponse({ kinds: ['neutral'], confidence: 0.9 }),
        okResponse({ kinds: ['neutral'], confidence: 0.9 }),
      ]),
    });

    await classifier.classifyAsync(NEUTRAL_TEXT, { sessionId: 's1' });
    await classifier.classifyAsync(NEUTRAL_TEXT, { sessionId: 's1' });
    expect(classifier.bucketCount()).toBe(1);

    classifier.forgetSession('s1');
    expect(classifier.bucketCount()).toBe(0);

    await classifier.classifyAsync(NEUTRAL_TEXT, { sessionId: 's1' });
    expect(readNeutralStreak(llm.calls[2]?.userPrompt ?? '')).toBe(0);
  });

  it('上一轮来访话语由编排器写入 → 出现在下一轮的 prompt 里', async () => {
    const { classifier, llm } = makeClassifier();

    classifier.recordVisitorTurn('s1', '我最近总是睡不着');
    await classifier.classifyAsync(EMPATHY_TEXT, { sessionId: 's1' });

    expect(llm.calls[0]?.userPrompt).toContain('我最近总是睡不着');
  });
});

describe('模型轨 · 影子模式 (core events 与 BDI 逐字不变)', () => {
  const rule = new RuleBasedClassifier();

  it('返回的事件与规则轨**逐字相同** (模型结果只进旁路观测)', async () => {
    const { classifier, observer } = makeClassifier({ llm: llmStub([okResponse({ kinds: ['holding_present'], confidence: 0.9 })]) });

    const events = await classifier.classifyAsync(EMPATHY_TEXT, { sessionId: 's1' });

    expect(events).toEqual(rule.classify(EMPATHY_TEXT));
    expect(observer.records[0]?.ruleKinds).toEqual(['empathy']);
    expect(observer.records[0]?.modelKinds).toEqual(['holding_present']);
    expect(observer.records[0]?.agreement).toBe(false);
    expect(observer.records[0]?.fallbackReason).toBeNull();
  });

  it('模型轨每条事件 strength 恒 1 (不参与 delta 缩放)', async () => {
    const { classifier, observer } = makeClassifier({ llm: llmStub([okResponse({ kinds: ['empathy'], confidence: 0.9 })]) });

    const events = await classifier.classifyAsync(EMPATHY_TEXT, { sessionId: 's1' });

    expect(events.every((event) => event.strength === 1)).toBe(true);
    expect(observer.records[0]?.strength).toBe(1);
  });

  it('两轨判出同一套标签 → agreement = true', async () => {
    const { classifier, observer } = makeClassifier({ llm: llmStub([okResponse({ kinds: ['empathy'], confidence: 0.9 })]) });

    await classifier.classifyAsync(EMPATHY_TEXT, { sessionId: 's1' });

    expect(observer.records[0]?.agreement).toBe(true);
  });

  it('负向命中 (评判) 两轨一致时同样 agreement = true', async () => {
    const { classifier, observer } = makeClassifier({ llm: llmStub([okResponse({ kinds: ['judgment'], confidence: 0.9 })]) });

    await classifier.classifyAsync(JUDGMENT_TEXT, { sessionId: 's1' });

    expect(observer.records[0]?.ruleKinds).toEqual(['judgment']);
    expect(observer.records[0]?.modelKinds).toEqual(['judgment']);
    expect(observer.records[0]?.agreement).toBe(true);
  });

  it('agreement 是集合语义 (顺序无关)', () => {
    expect(computeModelClassifierAgreement(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(computeModelClassifierAgreement(['a'], ['a', 'b'])).toBe(false);
    expect(computeModelClassifierAgreement([], [])).toBe(true);
  });
});

describe('模型轨 · 生效模式 (llm_active: 模型轨结果进 core events)', () => {
  const rule = new RuleBasedClassifier();

  it('全局 llm_active + 名单内 → 返回**模型**事件 (替换规则轨结果进 core)', async () => {
    const { classifier, llm, observer } = makeClassifier({
      llm: llmStub([okResponse({ kinds: ['holding_present'], confidence: 0.9 })]),
      modeConfig: { effectiveMode: 'llm_active', grayscaleSessions: new Set(['s1']) },
    });

    const events = await classifier.classifyAsync(EMPATHY_TEXT, { sessionId: 's1' });

    // 规则轨判的是 empathy; 进 core 的是**模型**那份 (holding_present) —— 两者不是同一套.
    expect(rule.classify(EMPATHY_TEXT).map((event) => event.kind)).toEqual(['empathy']);
    expect(events).toEqual([{ kind: 'holding_present', matchedTerms: [], strength: 1 }]);
    expect(llm.calls).toHaveLength(1);
    // 对照观测**照写** (同 shadow 口径, 不新增字段).
    expect(observer.records[0]?.ruleKinds).toEqual(['empathy']);
    expect(observer.records[0]?.modelKinds).toEqual(['holding_present']);
    expect(observer.records[0]?.agreement).toBe(false);
    expect(observer.records[0]?.fallbackReason).toBeNull();
    expect(observer.records[0]?.degraded).toBe(false);
  });

  it('llm_active 回落 → 返回**规则轨**事件, 逐字一致', async () => {
    const { classifier, observer } = makeClassifier({
      llm: llmStub([failResponse('fetch_error')]),
      modeConfig: { effectiveMode: 'llm_active', grayscaleSessions: new Set(['s1']) },
    });

    const events = await classifier.classifyAsync(EMPATHY_TEXT, { sessionId: 's1' });

    expect(events).toEqual(rule.classify(EMPATHY_TEXT));
    expect(observer.records[0]?.fallbackReason).toBe('fetch_error');
    expect(observer.records[0]?.degraded).toBe(true);
    expect(observer.records[0]?.modelKinds).toEqual([]);
  });

  it('全局 llm_active + 名单外场次 → 逐场 rule_only, 零模型轨副作用', async () => {
    const { classifier, llm, observer } = makeClassifier({
      llm: llmStub([okResponse({ kinds: ['holding_present'], confidence: 0.9 })]),
      modeConfig: { effectiveMode: 'llm_active', grayscaleSessions: new Set(['other']) },
    });

    const events = await classifier.classifyAsync(EMPATHY_TEXT, { sessionId: 's1' });

    expect(events).toEqual(rule.classify(EMPATHY_TEXT));
    expect(llm.calls).toHaveLength(0);
    expect(observer.records).toHaveLength(0);
  });

  it('llm_active + 考核场景 → 零 LLM (考核红线: 名单也放行不了)', async () => {
    const { classifier, llm } = makeClassifier({
      llm: llmStub([okResponse({ kinds: ['holding_present'], confidence: 0.9 })]),
      modeConfig: { effectiveMode: 'llm_active', grayscaleSessions: new Set(['s1']) },
      sessions: { s1: { tenantId: 't1', userId: 'u1', scenarioType: 'exam' } },
    });

    const events = await classifier.classifyAsync(EMPATHY_TEXT, { sessionId: 's1' });

    expect(events).toEqual(rule.classify(EMPATHY_TEXT));
    expect(llm.calls).toHaveLength(0);
  });

  it('总开关关 + 模式写着 llm_active → 装配层读到的是 rule_only (零 LLM)', async () => {
    const config = resolveModelClassifierModeConfig(configStub({ ENGINE_MODEL_CLASSIFIER_EFFECTIVE_MODE: 'llm_active' }));
    const { classifier, llm } = makeClassifier({ modeConfig: config });

    const events = await classifier.classifyAsync(EMPATHY_TEXT, { sessionId: 's1' });

    expect(events).toEqual(rule.classify(EMPATHY_TEXT));
    expect(llm.calls).toHaveLength(0);
  });

  it('低置信回落**不计入熔断** (上游没挂, 只是这一轮把握不足)', async () => {
    const { classifier, llm } = makeClassifier({
      llm: llmStub([
        okResponse({ kinds: ['holding_present'], confidence: 0.2 }),
        okResponse({ kinds: ['holding_present'], confidence: 0.9 }),
      ]),
      modeConfig: { effectiveMode: 'llm_active', grayscaleSessions: new Set(['s1']) },
      minConfidence: 0.6,
      circuitThreshold: 1,
    });

    // 低置信 = **回落** → 规则轨等价事件 (模型事件**不许**漏进 core).
    const first = await classifier.classifyAsync(EMPATHY_TEXT, { sessionId: 's1' });
    expect(first).toEqual(rule.classify(EMPATHY_TEXT));

    // 熔断阈值 = 1: 低置信**没**开闸 → 第二轮照样发 LLM, 且模型结果进 core.
    const second = await classifier.classifyAsync(EMPATHY_TEXT, { sessionId: 's1' });
    expect(llm.calls).toHaveLength(2);
    expect(second).toEqual([{ kind: 'holding_present', matchedTerms: [], strength: 1 }]);
  });

  it('llm_active + 拿不到 sessionId → 零 LLM, 逐字回落规则轨', async () => {
    const { classifier, llm } = makeClassifier({
      llm: llmStub([okResponse({ kinds: ['holding_present'], confidence: 0.9 })]),
      modeConfig: { effectiveMode: 'llm_active', grayscaleSessions: new Set(['s1']) },
    });

    const events = await classifier.classifyAsync(EMPATHY_TEXT, {});

    expect(events).toEqual(rule.classify(EMPATHY_TEXT));
    expect(llm.calls).toHaveLength(0);
  });
});

describe('模型轨 · 观测表 (字段白名单 · 隐私红线)', () => {
  it('字段集合就是白名单 —— 装不下原文 / matchedTerms / 展示名', async () => {
    const { classifier, observer } = makeClassifier({ llm: llmStub([okResponse({ kinds: ['empathy'], confidence: 0.9 })]) });

    await classifier.classifyAsync(EMPATHY_TEXT, { sessionId: 's1' });

    expect(Object.keys(observer.records[0] ?? {}).sort()).toEqual([
      'agreement',
      'confidence',
      'degraded',
      'fallbackReason',
      'latencyBucket',
      'modelId',
      'modelKinds',
      'promptVersion',
      'ruleKinds',
      'sessionId',
      'strength',
      'tenantId',
      'turnIndex',
    ]);
  });

  it('观测里不含咨询师原话 / 命中词 / 内核状态', async () => {
    const { classifier, observer } = makeClassifier({ llm: llmStub([okResponse({ kinds: ['empathy'], confidence: 0.9 })]) });

    await classifier.classifyAsync(EMPATHY_TEXT, { sessionId: 's1' });

    const serialized = JSON.stringify(observer.records[0]);
    expect(serialized).not.toContain('听起来你');
    expect(serialized).not.toContain('matchedTerms');
    expect(serialized).not.toContain('kernelState');
    expect(serialized).not.toContain('characterLabel');
  });

  it('trace key 与审议**错开**, 且带长度前缀 (防跨租户撞键)', () => {
    expect(MODEL_CLASSIFIER_TRACE_KEY_PREFIX).not.toBe('deliberation_trace');
    const key = buildModelClassifierTraceKey('tenant-1', 'session-1', 3);
    expect(key.startsWith(MODEL_CLASSIFIER_TRACE_KEY_PREFIX)).toBe(true);
    expect(key).toContain(':8:tenant-1:');
    expect(key).toContain(':9:session-1:3');
  });

  it('耗时桶: 四档边界', () => {
    expect(resolveLatencyBucket(10)).toBe('lt_500ms');
    expect(resolveLatencyBucket(800)).toBe('lt_1500ms');
    expect(resolveLatencyBucket(2000)).toBe('lt_3000ms');
    expect(resolveLatencyBucket(9000)).toBe('gt_3000ms');
  });
});

describe('模型轨 · 映射规则表 (D-2: 标签全集 = core 事件种类, 旁路层取消)', () => {
  it('core 事件种类 = 13 类 (11 行为 + neutral + 两类在场状态)', () => {
    expect(CORE_EVENT_KINDS).toHaveLength(13);
    expect(CORE_EVENT_KINDS).toContain('neutral');
    expect(CORE_EVENT_KINDS).toContain('sensitive_touch');
    expect(CORE_EVENT_KINDS).toContain('holding_present');
    expect(CORE_EVENT_KINDS).toContain('cold_absent');
  });

  it('两类新标签映射成**自己的** core kind (D-2: 不再有 sideLabels 形态)', () => {
    const mapped = mapModelLabels(['holding_present', 'cold_absent']);
    expect(mapped?.coreKinds).toEqual(['holding_present', 'cold_absent']);
  });

  it('core kind 原样映射', () => {
    const mapped = mapModelLabels(['empathy', 'open_probe']);
    expect(mapped?.coreKinds).toEqual(['empathy', 'open_probe']);
  });

  it('未知标签被丢弃, 去重保序', () => {
    const mapped = mapModelLabels(['empathy', 'not_a_label', 'empathy']);
    expect(mapped?.coreKinds).toEqual(['empathy']);
  });

  it('全部不可用 → null (调用方按 schema_validation_failed 回落)', () => {
    expect(mapModelLabels([])).toBeNull();
    expect(mapModelLabels(['nope', 'also_nope'])).toBeNull();
    expect(mapModelLabels([123])).toBeNull();
  });

  it('手写校验器: 形状不对一律 null', () => {
    expect(validateModelClassification(null)).toBeNull();
    expect(validateModelClassification({ kinds: 'empathy', confidence: 0.9 })).toBeNull();
    expect(validateModelClassification({ kinds: ['empathy'], confidence: 'high' })).toBeNull();
    expect(validateModelClassification({ kinds: ['empathy'], confidence: 1.5 })).toBeNull();
    expect(validateModelClassification({ kinds: ['empathy'], confidence: 0.9 })).toEqual({
      kinds: ['empathy'],
      confidence: 0.9,
    });
  });
});

describe('模型轨 · 内核契约 (路径 E: 可选异步成员)', () => {
  /**
   * 造一个内核会话 (确定性 id, 不连 DB / 不发网络).
   *
   * @param classifier 注入的分类器
   * @returns 内核会话
   */
  function kernelSession(classifier: EventClassifier): InMemoryEngineSession {
    let idSeq = 0;
    return new InMemoryEngineSession({
      bdiStates: new InMemoryBdiStateRepository(),
      memories: new InMemoryMemoryStore(),
      idFactory: (): string => {
        idSeq += 1;
        return `model-classifier-spec-${idSeq}`;
      },
      now: (): number => 1_700_000_000_000,
      classifier,
    });
  }

  it('分类器提供 classifyAsync → 内核 await 它, 用它的结果', async () => {
    const classifyAsync = vi.fn(async () => [{ kind: 'neutral' as const, matchedTerms: [], strength: 1 }]);
    const classify = vi.fn(() => [{ kind: 'empathy' as const, matchedTerms: ['x'], strength: 1 }]);
    const session = kernelSession({ classify, classifyAsync });
    const handle = session.openSession({ sessionId: 's-async', tenantId: 't1', visitorId: 'v1' });

    const output = await session.turn(handle.handleId, { userText: '你好' });

    expect(classifyAsync).toHaveBeenCalledTimes(1);
    expect(classify).not.toHaveBeenCalled();
    expect(output.events).toEqual(['neutral']);
  });

  it('分类器没有 classifyAsync → 内核走同步 classify (逐字现状)', async () => {
    const classify = vi.fn(() => [{ kind: 'empathy' as const, matchedTerms: ['x'], strength: 1 }]);
    const session = kernelSession({ classify });
    const handle = session.openSession({ sessionId: 's-sync', tenantId: 't1', visitorId: 'v1' });

    const output = await session.turn(handle.handleId, { userText: '你好' });

    expect(classify).toHaveBeenCalledTimes(1);
    expect(output.events).toEqual(['empathy']);
  });

  it('内核把业务 sessionId 透传给分类器 (跨轮状态分桶键)', async () => {
    const classify = vi.fn((_text: string, _context?: ClassifyContext) => [{ kind: 'empathy' as const, matchedTerms: [], strength: 1 }]);
    const session = kernelSession({ classify });
    const handle = session.openSession({ sessionId: 's-bucket', tenantId: 't1', visitorId: 'v1' });

    await session.turn(handle.handleId, { userText: '你好' });

    expect(classify.mock.calls[0]?.[1]).toMatchObject({ sessionId: 's-bucket' });
  });

  it('中断轮 → 分类器根本没被调用 (跨轮状态不推进)', async () => {
    const classify = vi.fn(() => [{ kind: 'empathy' as const, matchedTerms: [], strength: 1 }]);
    const session = kernelSession({ classify });
    const handle = session.openSession({ sessionId: 's-abort', tenantId: 't1', visitorId: 'v1' });
    const controller = new AbortController();
    controller.abort();

    await expect(session.turn(handle.handleId, { userText: '你好', signal: controller.signal })).rejects.toMatchObject({
      code: 'ENGINE_ABORTED',
    });
    expect(classify).not.toHaveBeenCalled();
  });

  it('D-7 接线 → 内核真的拿到**模型**事件 (不是规则轨那份)', async () => {
    const { classifier } = makeClassifier({
      llm: llmStub([okResponse({ kinds: ['holding_present'], confidence: 0.9 })]),
      modeConfig: { effectiveMode: 'llm_active', grayscaleSessions: new Set(['s-kernel']) },
      sessions: { 's-kernel': { tenantId: 't1', userId: 'u1', scenarioType: 'full_simulation' } },
    });
    const session = kernelSession(classifier);
    const handle = session.openSession({ sessionId: 's-kernel', tenantId: 't1', visitorId: 'v1' });

    const output = await session.turn(handle.handleId, { userText: EMPATHY_TEXT });

    expect(output.events).toEqual(['holding_present']);
  });
});
