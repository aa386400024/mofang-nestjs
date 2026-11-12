// V2026-11-12 治本 (D-2 · 事件类型拆分):
//   职责: 钉死 D-2 落地的七段行为 ——
//     ① core 联合扩到 13 类, 三处穷尽 Record 键集合一致 (防静默漂移);
//     ② 两类新 kind 的 DELTA_TABLE 种子 = ZERO (缺省零回归);
//     ③ 映射收敛: 旁路标签层取消, 两类直接映射成自己的 core kind;
//     ④ 出参 eventDetails 往返 (kind + 命中词 + 强度), 旧 events 投影逐字不变;
//     ⑤ 审计按输入明细落库 matchedTerms (D-1 期间「命中词归零」的已知代价解除);
//     ⑥ 中间态零回归: 判出两类新 kind 时 BDI 快照与当轮 delta 逐字不变;
//     ⑦ 规则轨**不产**两类新 kind (词表不扩 —— 任务单 §3.2).
//   边界: 全 mock; 不起 Nest 容器; 不连 DB / 不发网络 / 不调真模型.
//
//   ⚠️ **fixture 只放人工构造的样例, 不放真实逐字稿** (隐私 + 双盲纪律).
//   ⚠️ **不断言任何真实心理内容** —— 本单只关心事件类别与 delta 的机械口径.
//
//   验证: pnpm exec vitest run test/engine-adapters/d2-event-kind-split.spec.ts

import { describe, expect, it, vi } from 'vitest';

import { COUNSELOR_EVENT_LABELS } from '../../src/admin-debug/event-tag-labels.js';
import { TRACKED_EVENTS } from '../../src/auto-practice/metrics/metric-dictionary.js';
import type { CounselorLlmJsonRequest, CounselorLlmJsonResult } from '../../src/counselor/providers/llm-json.client.js';
import {
  DEFAULT_MODEL_CLASSIFIER_TIMEOUT_MS,
  type ModelClassifierModeConfig,
} from '../../src/engine-adapters/cognition/model-classifier-mode.config.js';
import type {
  ModelClassifierObservation,
  ModelClassifierObserver,
} from '../../src/engine-adapters/cognition/model-classifier-observation.js';
import {
  ModelEventClassifier,
  type ModelClassifierLlmPort,
  type ModelClassifierSessionContext,
  type ModelClassifierSessionResolver,
} from '../../src/engine-adapters/cognition/model-event-classifier.js';
import { CORE_EVENT_KINDS, mapModelLabels, validateModelClassification } from '../../src/engine-adapters/cognition/model-event-mapping.js';
import { TurnDeltaAuditEntity } from '../../src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.entity.js';
import { TurnDeltaAuditService } from '../../src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.service.js';
import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository.js';
import { InMemoryEngineSession } from '../../src/engine-core/in-memory/in-memory-engine-session.js';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store.js';
import {
  RuleBasedClassifier,
  aggregateTurnDelta,
  type CounselorEventKind,
  type EventClassifier,
  type SessionEvent,
} from '../../src/engine-core/index.js';

/** 构造样例: 命中共情词表 (人工构造, 非真实逐字稿). */
const EMPATHY_TEXT = '听起来你现在一定很难受';
/** 构造样例: 不命中任何词表. */
const NEUTRAL_TEXT = '嗯。';

/** 两类新 kind (在场状态事件). */
const NEW_KINDS: readonly CounselorEventKind[] = ['holding_present', 'cold_absent'];

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
      return `d2-spec-${idSeq}`;
    },
    now: (): number => 1_700_000_000_000,
    classifier,
  });
}

/**
 * 造一个固定标签的分类器.
 *
 * @param events 每轮都返回这组事件
 * @returns 分类器
 */
function fixedClassifier(events: readonly SessionEvent[]): EventClassifier {
  return { classify: () => events };
}

/** LLM 桩 (不打网络; 固定吐一个标签集). */
function llmStub(kinds: readonly string[]): ModelClassifierLlmPort {
  return {
    requestJson: async <T>(input: CounselorLlmJsonRequest<T>): Promise<CounselorLlmJsonResult<T>> => {
      const validated = input.validate({ kinds: [...kinds], confidence: 0.9 });
      if (validated === null) {
        return { ok: false, data: null, rawText: '', errorCode: 'schema_validation_failed', errorMessage: 'stub 校验失败', usage: null };
      }
      return { ok: true, data: validated, rawText: '{}', errorCode: null, errorMessage: null, usage: null };
    },
  };
}

/** 观测桩 (记下每一条对照记录). */
function observerStub(): ModelClassifierObserver & { readonly records: ModelClassifierObservation[] } {
  const records: ModelClassifierObservation[] = [];
  return {
    records,
    record: (observation: ModelClassifierObservation): void => {
      records.push(observation);
    },
  };
}

/** 会话归属反查桩. */
function resolverStub(): ModelClassifierSessionResolver {
  const context: ModelClassifierSessionContext = { tenantId: 't1', userId: 'u1', scenarioType: 'full_simulation' };
  return { resolveBySessionId: () => context };
}

/** 灰度配置 (影子模式). */
function modeConfig(): ModelClassifierModeConfig {
  return {
    effectiveMode: 'shadow',
    grayscaleSessions: new Set<string>(),
    timeoutMs: DEFAULT_MODEL_CLASSIFIER_TIMEOUT_MS,
  };
}

/** 仓储桩 (记下写库的行). */
function repoStub(): {
  readonly findOne: ReturnType<typeof vi.fn>;
  readonly create: ReturnType<typeof vi.fn>;
  readonly save: ReturnType<typeof vi.fn>;
  readonly saved: TurnDeltaAuditEntity[];
} {
  const saved: TurnDeltaAuditEntity[] = [];
  return {
    findOne: vi.fn(async () => null),
    create: vi.fn((values: Partial<TurnDeltaAuditEntity>) => ({ ...values }) as TurnDeltaAuditEntity),
    save: vi.fn(async (entity: TurnDeltaAuditEntity) => {
      saved.push(entity);
      return entity;
    }),
    saved,
  };
}

/**
 * 让微任务队列跑干净 (fire-and-forget 的写库是异步的).
 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('D-2 · ① core 联合扩展 (13 类 · 三处穷尽 Record 一致)', () => {
  it('事件种类总数 = 13 (11 行为 + neutral + 两类在场状态)', () => {
    expect(Object.keys(COUNSELOR_EVENT_LABELS)).toHaveLength(13);
    expect(CORE_EVENT_KINDS).toHaveLength(13);
    expect(TRACKED_EVENTS).toHaveLength(13);
  });

  it('三处穷尽 Record 的键集合**完全一致** (少一个 = 静默漂移)', () => {
    const labels = Object.keys(COUNSELOR_EVENT_LABELS).toSorted();
    const core = [...CORE_EVENT_KINDS].toSorted();
    const tracked = [...TRACKED_EVENTS].toSorted();
    expect(labels).toEqual(core);
    expect(core).toEqual(tracked);
  });

  it('两类新 kind 在三处都在 (且各自有中文展示名)', () => {
    for (const kind of NEW_KINDS) {
      expect(CORE_EVENT_KINDS).toContain(kind);
      expect(TRACKED_EVENTS).toContain(kind);
      expect(COUNSELOR_EVENT_LABELS[kind]).toBeTruthy();
    }
    expect(COUNSELOR_EVENT_LABELS.holding_present).toBe('稳定在场');
    expect(COUNSELOR_EVENT_LABELS.cold_absent).toBe('冷漠缺席');
  });

  it('DELTA_TABLE 的 13 键一致性 = **穷尽 Record 的编译期保证** (运行时不可枚举)', () => {
    // DELTA_TABLE 是模块私有常量, 运行时读不到 —— 它的「13 键齐全」由
    //   `Readonly<Record<CounselorEventKind, DeltaVector>>` 的编译期穷尽性保证:
    //   联合加一个 kind 而表里没补 → tsc 直接报 missing property.
    //   运行时能观测的等价事实 = 两类新 kind 在 delta 管道里是**一等公民**
    //   (走同一条覆写/聚合路径), 只是种子值为零 (见 ②).
    const overridden = aggregateTurnDelta([{ kind: 'holding_present', matchedTerms: [], strength: 1 }], undefined, {
      deltas: { holding_present: { trust: 0.02 } },
    });
    expect(overridden.trust).toBeCloseTo(0.02, 10);
  });
});

describe('D-2 · ② 两类新 kind 的种子向量 = ZERO (缺省零回归)', () => {
  it.each(NEW_KINDS)('%s 的当轮 delta 逐维为零 (强度缩放也放大不了零向量)', (kind) => {
    const delta = aggregateTurnDelta([{ kind, matchedTerms: [], strength: 1 }]);
    expect(Object.values(delta).every((value) => value === 0)).toBe(true);
  });

  it('两类与 neutral 的 delta **逐字相同** (缺省行为 = 改造前)', () => {
    const neutral = aggregateTurnDelta([{ kind: 'neutral', matchedTerms: [], strength: 1 }]);
    for (const kind of NEW_KINDS) {
      expect(aggregateTurnDelta([{ kind, matchedTerms: [], strength: 1 }])).toEqual(neutral);
    }
  });
});

describe('D-2 · ③ 映射收敛 (旁路标签层取消)', () => {
  it('两类映射成**自己的** core kind', () => {
    const mapped = mapModelLabels(['holding_present', 'cold_absent']);
    expect(mapped?.coreKinds).toEqual(['holding_present', 'cold_absent']);
  });

  it('映射结果**只有** coreKinds 一个键 (sideLabels 形态不再存在)', () => {
    const mapped = mapModelLabels(['holding_present']);
    expect(mapped).toBeDefined();
    expect(Object.keys(mapped as object)).toEqual(['coreKinds']);
  });

  it('未知标签丢弃 / 去重保序 (口径不变)', () => {
    const mapped = mapModelLabels(['empathy', 'not_a_label', 'empathy', 'cold_absent']);
    expect(mapped?.coreKinds).toEqual(['empathy', 'cold_absent']);
  });

  it('全丢 → null (调用方按 schema_validation_failed 回落)', () => {
    expect(mapModelLabels([])).toBeNull();
    expect(mapModelLabels(['nope'])).toBeNull();
  });

  it('校验器形状不变 (字符串数组 + confidence [0,1])', () => {
    expect(validateModelClassification({ kinds: ['holding_present'], confidence: 0.9 })).toEqual({
      kinds: ['holding_present'],
      confidence: 0.9,
    });
    expect(validateModelClassification({ kinds: ['holding_present'], confidence: 1.5 })).toBeNull();
  });
});
describe('D-2 · ④ 出参 eventDetails 往返', () => {
  it('内核出参带上本轮事件明细 (kind + 命中词 + 强度)', async () => {
    const session = kernelSession(fixedClassifier([{ kind: 'empathy', matchedTerms: ['听起来你'], strength: 1 }]));
    const handle = session.openSession({ sessionId: 's-detail', tenantId: 't1', visitorId: 'v1' });

    const output = await session.turn(handle.handleId, { userText: EMPATHY_TEXT });

    expect(output.eventDetails).toEqual([{ kind: 'empathy', matchedTerms: ['听起来你'], strength: 1 }]);
  });

  it('旧 events 投影**逐字不变** (只有 kind, 不带命中词)', async () => {
    const session = kernelSession(fixedClassifier([{ kind: 'empathy', matchedTerms: ['听起来你'], strength: 1 }]));
    const handle = session.openSession({ sessionId: 's-kinds', tenantId: 't1', visitorId: 'v1' });

    const output = await session.turn(handle.handleId, { userText: EMPATHY_TEXT });

    expect(output.events).toEqual(['empathy']);
  });

  it('两类新 kind 也能随出参落出 (事件模型已就位)', async () => {
    const session = kernelSession(fixedClassifier([{ kind: 'holding_present', matchedTerms: [], strength: 1 }]));
    const handle = session.openSession({ sessionId: 's-new-kind', tenantId: 't1', visitorId: 'v1' });

    const output = await session.turn(handle.handleId, { userText: NEUTRAL_TEXT });

    expect(output.events).toEqual(['holding_present']);
    expect(output.eventDetails?.[0]?.kind).toBe('holding_present');
  });

  it('本轮没事件 → 两个字段都不挂 (零回归)', async () => {
    const session = kernelSession(fixedClassifier([]));
    const handle = session.openSession({ sessionId: 's-empty', tenantId: 't1', visitorId: 'v1' });

    const output = await session.turn(handle.handleId, { userText: NEUTRAL_TEXT });

    expect(output.events).toBeUndefined();
    expect(output.eventDetails).toBeUndefined();
  });
});

describe('D-2 · ⑤ 审计恢复词明细 (D-1 期间「归零」的已知代价解除)', () => {
  /**
   * 造一个配置桩 (只实现 get).
   *
   * @returns ConfigService 桩
   */
  function configStub(): { get: (key: string) => string | undefined } {
    return { get: (key: string): string | undefined => (key === 'TURN_DELTA_AUDIT_ENABLED' ? 'true' : undefined) };
  }

  it('按输入明细落库 matchedTerms (审计不自己重跑分类器)', async () => {
    const repo = repoStub();
    const service = new TurnDeltaAuditService(repo as never, configStub() as never);

    service.record({
      tenantId: 't1',
      sessionId: 's1',
      turnIndex: 1,
      kernelEvents: [{ kind: 'empathy', matchedTerms: ['听起来你'], strength: 1 }],
    });
    await flush();

    expect(repo.saved[0]?.eventKinds).toEqual(['empathy']);
    expect(repo.saved[0]?.eventDetails[0]?.matchedTerms).toEqual(['听起来你']);
  });

  it('模型轨事件的命中词是空数组 (不造词) + 两类新 kind 的 delta 仍是零', async () => {
    const repo = repoStub();
    const service = new TurnDeltaAuditService(repo as never, configStub() as never);

    service.record({
      tenantId: 't1',
      sessionId: 's1',
      turnIndex: 1,
      kernelEvents: [{ kind: 'cold_absent', matchedTerms: [], strength: 1 }],
    });
    await flush();

    expect(repo.saved[0]?.eventDetails[0]?.matchedTerms).toEqual([]);
    expect(repo.saved[0]?.rawDelta.trust).toBe(0);
    expect(repo.saved[0]?.rawDelta.safety).toBe(0);
  });
});

describe('D-2 · ⑥ 中间态零回归 (种子 ZERO + 不接生效轨)', () => {
  it('分类器判出 holding_present → BDI 快照与当轮 delta 逐字不变', async () => {
    const holding = kernelSession(fixedClassifier([{ kind: 'holding_present', matchedTerms: [], strength: 1 }]));
    const holdingHandle = holding.openSession({ sessionId: 's-hold', tenantId: 't1', visitorId: 'v1' });
    const holdingOutput = await holding.turn(holdingHandle.handleId, { userText: NEUTRAL_TEXT });

    const neutral = kernelSession(fixedClassifier([{ kind: 'neutral', matchedTerms: [], strength: 1 }]));
    const neutralHandle = neutral.openSession({ sessionId: 's-neut', tenantId: 't1', visitorId: 'v1' });
    const neutralOutput = await neutral.turn(neutralHandle.handleId, { userText: NEUTRAL_TEXT });

    expect(holdingOutput.events).toEqual(['holding_present']);
    expect(holdingOutput.snapshot).toEqual(neutralOutput.snapshot);
  });

  it('模型轨 shadow 模式: 模型判出的新 kind **不进** core events, BDI 逐字不变', async () => {
    const observer = observerStub();
    const classifier = new ModelEventClassifier(llmStub(['holding_present']), modeConfig(), observer, resolverStub(), 'stub-model');
    const session = kernelSession(classifier);
    const handle = session.openSession({ sessionId: 's1', tenantId: 't1', visitorId: 'v1' });

    const output = await session.turn(handle.handleId, { userText: EMPATHY_TEXT });

    expect(output.events).toEqual(['empathy']);
    expect(observer.records[0]?.modelKinds).toEqual(['holding_present']);
    expect(observer.records[0]?.agreement).toBe(false);
  });
});

describe('D-2 · ⑦ 规则轨仍只产出既有 11 类 (词表不扩)', () => {
  it('规则轨分类器**产不出**两类新 kind', () => {
    const rule = new RuleBasedClassifier();
    const kinds = new Set<CounselorEventKind>();
    for (const text of [EMPATHY_TEXT, NEUTRAL_TEXT, '你就是想不开', '你应该听我的建议', '这没什么大不了', '加我微信', '我也有类似经历']) {
      for (const event of rule.classify(text)) kinds.add(event.kind);
    }
    expect(kinds.has('holding_present')).toBe(false);
    expect(kinds.has('cold_absent')).toBe(false);
  });

  it('规则轨判出的 kind 全在既有 11 类里 (联合扩了也不多产)', () => {
    const rule = new RuleBasedClassifier();
    const kinds = new Set<CounselorEventKind>();
    for (const text of [EMPATHY_TEXT, NEUTRAL_TEXT, '你就是想不开']) {
      for (const event of rule.classify(text)) kinds.add(event.kind);
    }
    for (const kind of kinds) {
      expect(CORE_EVENT_KINDS).toContain(kind);
      expect(NEW_KINDS).not.toContain(kind);
    }
  });
});
