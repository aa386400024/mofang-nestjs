// V2026-11-04 WP57 (引擎内核 · 信念层深度扩展):
//   目的: 钉死"核心信念激活强度 + 短期信念置信度衰减"这条机制 ——
//     ① 命中 activationTags → 激活强度上升 (先加后衰减: (0 + 0.15) × 0.8 = 0.12);
//     ② 不命中 → 逐轮乘性衰减, 渐近 0 (不归零);
//     ③ 不同 theme 各自独立;
//     ④ introduced 短期信念衰减比 observed 快;
//     ⑤ confidence < 阈值 → 自动移除 (恰好等于阈值 → 保留);
//     ⑥ 空信念角色 → 不报错, 行为不变;
//     ⑦ 重复 theme → 共享一份激活强度, 且与数组顺序**无关**;
//     ⑧ 零回归: 信念算子**不碰** delta 维度; 不传 counselorText → 只有衰减, 没有激活;
//     ⑨ 管道接线: transitionState / transitionStateDetailed / 落库路径三处口径一致;
//     ⑩ 边界: 非法端口值逐项回退种子值 / 传入快照不被就地修改 / 同输入同输出.
//
//   为什么"恰好等于阈值"要单独钉死:
//     移除条件是 confidence **<** 0.1 (严格小于). 改成 <= 会让"恰好卡在阈值上"的信念
//     凭空消失 —— 阈值口径就没有可解释的锚点了 (同 WP36 "恰好减半"是硬断言的同款理由).
//
//   为什么"重复 theme 与顺序无关"要单独钉死:
//     theme 唯一是**角色配置的责任** —— 引擎不该让一个配置笔误变成"行为取决于数组顺序"
//     的不确定性. 命中任一即算命中, 两处顺序必须完全一致.
//
//   为什么"落库路径"要单独钉死 (而不是只看 transitionState):
//     内核落库走的是"事件 delta + 剧本 delta 合并后统一过一次 cap" (WP26 P2-12),
//     用的是 applyDeltaVector 而不是 transitionState —— 只在 transitionState 里接信念
//     算子, 落库快照就**永远不会**带上信念演化 (机制空转). 这条断言就是防这个.
//
//   反依赖污染:
//     不 import 任何 @nestjs/* / typeorm; 只用内核纯 TS + 内存实现.
//
//   验证: npx vitest run test/engine-core/wp57-belief-layer.spec.ts

import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository.js';
import { InMemoryEngineSession } from '../../src/engine-core/in-memory/in-memory-engine-session.js';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store.js';
import {
  DEFAULT_BELIEF_ACTIVATION_DELTA,
  DEFAULT_BELIEF_DECAY_RATE,
  DEFAULT_BELIEF_OPERATOR_CONFIG,
  DEFAULT_INTRODUCED_BELIEF_DECAY_RATE,
  DEFAULT_OBSERVED_BELIEF_DECAY_RATE,
  DEFAULT_TEMPORARY_BELIEF_REMOVE_THRESHOLD,
  applyBeliefActivationDelta,
  applyBeliefEvolution,
  applyTemporaryBeliefDecay,
  cloneBdiSnapshot,
  createEmptyBdiSnapshot,
  transitionState,
  transitionStateDetailed,
  type BdiSnapshot,
  type CharacterProfile,
  type SessionEvent,
} from '../../src/engine-core/index.js';

/** 租户. */
const TENANT = 'default';

/** 核心信念 A (弃置主题) 的激活标签. */
const TAGS_UNLOVABLE = ['被抛弃', '没人要'];

/** 核心信念 B (失败主题) 的激活标签. */
const TAGS_WORTHLESS = ['失败', '没用'];

/**
 * 造一份带两条核心信念的快照.
 *
 * 为什么显式写 coreBeliefActivation: `createEmptyBdiSnapshot()` 不带 profile,
 * 核心信念为空 —— 而"初始激活强度全为 0"是 bootstrap (内核装配) 的职责. 这里
 * 显式摆出来 = 测试自己声明前提, 不依赖实现细节.
 */
function makeSnapshot(
  options: {
    readonly coreBeliefs?: BdiSnapshot['coreBeliefs'];
    readonly coreBeliefActivation?: BdiSnapshot['coreBeliefActivation'];
    readonly temporaryBeliefs?: BdiSnapshot['temporaryBeliefs'];
  } = {},
): BdiSnapshot {
  const base = createEmptyBdiSnapshot();
  return {
    ...base,
    coreBeliefs: options.coreBeliefs ?? [
      { theme: 'unlovable', statement: '我是不值得被爱的', activationTags: TAGS_UNLOVABLE },
      { theme: 'worthless', statement: '我什么都做不好', activationTags: TAGS_WORTHLESS },
    ],
    coreBeliefActivation: options.coreBeliefActivation ?? { unlovable: 0, worthless: 0 },
    temporaryBeliefs: options.temporaryBeliefs ?? [],
  };
}

/** 取某条短期信念的置信度 (按 id). */
function confidenceOf(snapshot: BdiSnapshot, id: string): number | undefined {
  return snapshot.temporaryBeliefs.find((b) => b.id === id)?.confidence;
}

/** 造一个"共情"事件 (信念算子不参与 delta, 事件只用来验零回归). */
const EMPATHY_EVENTS: readonly SessionEvent[] = [{ kind: 'empathy', matchedTerms: ['理解'], strength: 1 }];

describe('WP57 · 核心信念激活 (纯函数)', () => {
  it('命中 activationTags → 该信念激活强度上升 (先加后衰减: (0 + 0.15) × 0.8 = 0.12)', () => {
    const next = applyBeliefActivationDelta(makeSnapshot(), '你总觉得自己会被抛弃');

    expect(next.coreBeliefActivation['unlovable']).toBeCloseTo(0.12, 10);
  });

  it('未命中的信念不被激活 (只衰减, 不上升)', () => {
    const next = applyBeliefActivationDelta(makeSnapshot(), '你总觉得自己会被抛弃');

    expect(next.coreBeliefActivation['worthless']).toBeCloseTo(0, 10);
  });

  it('任一标签命中即算命中 (不需要全部标签都出现)', () => {
    const next = applyBeliefActivationDelta(makeSnapshot(), '没人要我');

    expect(next.coreBeliefActivation['unlovable']).toBeCloseTo(0.12, 10);
  });

  it('匹配大小写不敏感 (标签与文本大小写不同也算命中)', () => {
    const snapshot = makeSnapshot({
      coreBeliefs: [{ theme: 'unlovable', statement: 's', activationTags: ['Abandonment'] }],
      coreBeliefActivation: { unlovable: 0 },
    });
    const next = applyBeliefActivationDelta(snapshot, 'you feel ABANDONMENT here');

    expect(next.coreBeliefActivation['unlovable']).toBeCloseTo(0.12, 10);
  });

  it('空标签不参与匹配 (空串不该命中任何文本)', () => {
    const snapshot = makeSnapshot({
      coreBeliefs: [{ theme: 'unlovable', statement: 's', activationTags: [' '] }],
      coreBeliefActivation: { unlovable: 0 },
    });
    const next = applyBeliefActivationDelta(snapshot, '随便说点什么');

    expect(next.coreBeliefActivation['unlovable']).toBeCloseTo(0, 10);
  });

  it('激活强度恒在 [0,1] 内 (clamp 兜底)', () => {
    const snapshot = makeSnapshot({ coreBeliefActivation: { unlovable: 1, worthless: 0 } });
    const next = applyBeliefActivationDelta(snapshot, '被抛弃');

    expect(next.coreBeliefActivation['unlovable']).toBeLessThanOrEqual(1);
    expect(next.coreBeliefActivation['unlovable']).toBeGreaterThanOrEqual(0);
  });
});

describe('WP57 · 核心信念逐轮衰减', () => {
  it('不命中 → 激活强度乘性衰减 (0.5 → 0.4)', () => {
    const snapshot = makeSnapshot({ coreBeliefActivation: { unlovable: 0.5, worthless: 0 } });
    const next = applyBeliefActivationDelta(snapshot, '今天聊点别的');

    expect(next.coreBeliefActivation['unlovable']).toBeCloseTo(0.4, 10);
  });

  it('连续多轮不命中 → 逐轮衰减且渐近 0 (不归零)', () => {
    let snapshot = makeSnapshot({ coreBeliefActivation: { unlovable: 0.5, worthless: 0 } });
    for (let i = 0; i < 20; i += 1) {
      snapshot = applyBeliefActivationDelta(snapshot, '今天聊点别的');
    }

    expect(snapshot.coreBeliefActivation['unlovable']).toBeCloseTo(0.5 * Math.pow(0.8, 20), 10);
    expect(snapshot.coreBeliefActivation['unlovable']).toBeGreaterThan(0);
    expect(snapshot.coreBeliefActivation['unlovable']).toBeLessThan(0.01);
  });

  it('反复命中 → 渐近上限 0.6 (= 0.15 / (1 - 0.8)), 不会瞬间拉满', () => {
    let snapshot = makeSnapshot();
    for (let i = 0; i < 200; i += 1) {
      snapshot = applyBeliefActivationDelta(snapshot, '你总觉得自己会被抛弃');
    }

    expect(snapshot.coreBeliefActivation['unlovable']).toBeCloseTo(0.6, 6);
    expect(snapshot.coreBeliefActivation['unlovable']).toBeLessThan(1);
  });
});

describe('WP57 · 多信念各自独立', () => {
  it('两个 theme 各自被自己的标签激活 (互不串味)', () => {
    const next = applyBeliefActivationDelta(makeSnapshot(), '被抛弃和失败你都占全了');

    expect(next.coreBeliefActivation['unlovable']).toBeCloseTo(0.12, 10);
    expect(next.coreBeliefActivation['worthless']).toBeCloseTo(0.12, 10);
  });

  it('只命中一个 theme → 另一个 theme 只衰减', () => {
    const snapshot = makeSnapshot({ coreBeliefActivation: { unlovable: 0.5, worthless: 0.5 } });
    const next = applyBeliefActivationDelta(snapshot, '你总觉得自己会被抛弃');

    expect(next.coreBeliefActivation['unlovable']).toBeCloseTo(0.52, 10);
    expect(next.coreBeliefActivation['worthless']).toBeCloseTo(0.4, 10);
  });
});

describe('WP57 · 短期信念置信度衰减', () => {
  it('introduced 衰减比 observed 快 (同起点、同轮数)', () => {
    const snapshot = makeSnapshot({
      temporaryBeliefs: [
        { id: 'tb-intro', statement: '你是因为害怕被抛弃', confidence: 0.5, source: 'introduced' },
        { id: 'tb-obs', statement: '我好像真的不太敢相信别人', confidence: 0.5, source: 'observed' },
      ],
    });
    const next = applyTemporaryBeliefDecay(snapshot);

    expect(confidenceOf(next, 'tb-intro')).toBeCloseTo(0.45, 10);
    expect(confidenceOf(next, 'tb-obs')).toBeCloseTo(0.475, 10);
    expect(confidenceOf(next, 'tb-intro')).toBeLessThan(confidenceOf(next, 'tb-obs') ?? 0);
  });

  it('confidence 低于阈值 → 自动移除', () => {
    const snapshot = makeSnapshot({
      temporaryBeliefs: [
        { id: 'tb-low', statement: 'x', confidence: 0.05, source: 'observed' },
        { id: 'tb-high', statement: 'y', confidence: 0.2, source: 'observed' },
      ],
    });
    const next = applyTemporaryBeliefDecay(snapshot);

    expect(next.temporaryBeliefs.map((b) => b.id)).toEqual(['tb-high']);
  });

  it('introduced 掉到阈值以下 → 移除 (0.11 × 0.9 = 0.099 < 0.1)', () => {
    const snapshot = makeSnapshot({
      temporaryBeliefs: [{ id: 'tb-intro', statement: 'x', confidence: 0.11, source: 'introduced' }],
    });
    const next = applyTemporaryBeliefDecay(snapshot);

    expect(next.temporaryBeliefs).toEqual([]);
  });

  it('confidence 恰好等于阈值 → 保留 (移除条件是**严格小于**)', () => {
    const snapshot = makeSnapshot({
      temporaryBeliefs: [{ id: 'tb-edge', statement: 'x', confidence: 0.1, source: 'observed' }],
    });
    // 衰减率取 1 → 衰减后仍恰好是 0.1 = 阈值.
    const next = applyTemporaryBeliefDecay(snapshot, { ...DEFAULT_BELIEF_OPERATOR_CONFIG, observedDecayRate: 1 });

    expect(next.temporaryBeliefs.map((b) => b.id)).toEqual(['tb-edge']);
  });

  it('temporaryBeliefs 为空 → 衰减后仍是空数组 (不报错)', () => {
    const next = applyTemporaryBeliefDecay(makeSnapshot());

    expect(next.temporaryBeliefs).toEqual([]);
  });
});

describe('WP57 · 空信念角色 / 重复 theme', () => {
  it('coreBeliefs 为空 → coreBeliefActivation 保持空对象, 不报错', () => {
    const snapshot = createEmptyBdiSnapshot();
    const next = applyBeliefActivationDelta(snapshot, '你总觉得自己会被抛弃');

    expect(next.coreBeliefActivation).toEqual({});
  });

  it('重复 theme → 共享一份激活强度 (key 相同, 只有一个键)', () => {
    const snapshot = makeSnapshot({
      coreBeliefs: [
        { theme: 'unlovable', statement: 'A', activationTags: ['被抛弃'] },
        { theme: 'unlovable', statement: 'B', activationTags: ['失败'] },
      ],
      coreBeliefActivation: { unlovable: 0 },
    });
    const next = applyBeliefActivationDelta(snapshot, '你总觉得自己会被抛弃');

    expect(Object.keys(next.coreBeliefActivation)).toEqual(['unlovable']);
    expect(next.coreBeliefActivation['unlovable']).toBeCloseTo(0.12, 10);
  });

  it('重复 theme → 命中任一标签即算命中, 与数组顺序无关', () => {
    const forward = makeSnapshot({
      coreBeliefs: [
        { theme: 'unlovable', statement: 'A', activationTags: ['被抛弃'] },
        { theme: 'unlovable', statement: 'B', activationTags: ['失败'] },
      ],
      coreBeliefActivation: { unlovable: 0 },
    });
    const reversed = makeSnapshot({
      coreBeliefs: [
        { theme: 'unlovable', statement: 'B', activationTags: ['失败'] },
        { theme: 'unlovable', statement: 'A', activationTags: ['被抛弃'] },
      ],
      coreBeliefActivation: { unlovable: 0 },
    });

    const hitForward = applyBeliefActivationDelta(forward, '你总觉得自己会被抛弃');
    const hitReversed = applyBeliefActivationDelta(reversed, '你总觉得自己会被抛弃');

    expect(hitForward.coreBeliefActivation['unlovable']).toBeCloseTo(hitReversed.coreBeliefActivation['unlovable'], 10);
    expect(hitForward.coreBeliefActivation['unlovable']).toBeCloseTo(0.12, 10);
  });
});

describe('WP57 · 零回归 (信念算子不参与 delta)', () => {
  it('不传 counselorText → 只有衰减, 不发生激活', () => {
    const snapshot = makeSnapshot({ coreBeliefActivation: { unlovable: 0.5, worthless: 0 } });
    const next = applyBeliefEvolution(snapshot, '');

    expect(next.coreBeliefActivation['unlovable']).toBeCloseTo(0.4, 10);
  });

  it('信念算子只动信念层: delta 维度逐字不变 (与不传 counselorText 的结果一致)', () => {
    const snapshot = makeSnapshot();
    const plain = transitionState(snapshot, EMPATHY_EVENTS);
    const hit = transitionState(snapshot, EMPATHY_EVENTS, { counselorText: '你总觉得自己会被抛弃' });

    // 事件 delta 照常推进 (共情 trust +0.10, 初值 0.3).
    expect(plain.trust).toBeCloseTo(0.4, 10);
    // 信念算子只写信念层.
    expect(hit.coreBeliefActivation['unlovable']).toBeCloseTo(0.12, 10);
    // 其余维度逐字一致 —— 信念激活**不反作用**到 delta (本期明确不做).
    expect(hit.trust).toBe(plain.trust);
    expect(hit.safety).toBe(plain.safety);
    expect(hit.bond).toBe(plain.bond);
    expect(hit.emotion).toEqual(plain.emotion);
    expect(hit.resistance).toEqual(plain.resistance);
    expect(hit.transference).toEqual(plain.transference);
  });

  it('初始激活强度全为 0 时, 整轮下来信念层逐字不变 (零回归基线)', () => {
    const snapshot = makeSnapshot();
    const next = transitionState(snapshot, EMPATHY_EVENTS, { counselorText: '随便聊聊' });

    expect(next.coreBeliefActivation).toEqual({ unlovable: 0, worthless: 0 });
    expect(next.temporaryBeliefs).toEqual([]);
  });
});

describe('WP57 · 管道接线 (transitionState / 详细版 / 落库路径)', () => {
  it('transitionState 末端接入信念演化', () => {
    const next = transitionState(makeSnapshot(), EMPATHY_EVENTS, { counselorText: '你总觉得自己会被抛弃' });

    expect(next.coreBeliefActivation['unlovable']).toBeCloseTo(0.12, 10);
  });

  it('transitionStateDetailed 与 transitionState 口径一致', () => {
    const snapshot = makeSnapshot();
    const plain = transitionState(snapshot, EMPATHY_EVENTS, { counselorText: '你总觉得自己会被抛弃' });
    const detailed = transitionStateDetailed(snapshot, EMPATHY_EVENTS, { counselorText: '你总觉得自己会被抛弃' });

    expect(detailed.snapshot.coreBeliefActivation['unlovable']).toBe(plain.coreBeliefActivation['unlovable']);
    expect(detailed.snapshot.trust).toBe(plain.trust);
  });
});

/** 会话层测试台: 内存仓储 + 确定性时钟 + 确定性 id. */
function createHarness(): {
  readonly bdiStates: InMemoryBdiStateRepository;
  readonly session: InMemoryEngineSession;
} {
  const bdiStates = new InMemoryBdiStateRepository();
  let idSeq = 0;
  const clock = 1_700_000_000_000;
  const now = (): number => clock;
  const memories = new InMemoryMemoryStore({ now });
  const session = new InMemoryEngineSession({
    bdiStates,
    memories,
    idFactory: () => {
      idSeq += 1;
      return `wp57-id-${idSeq}`;
    },
    now,
  });
  return { bdiStates, session };
}

/** 带两条核心信念的角色 profile (activationTags 是 WP57 的匹配源). */
const PROFILE: CharacterProfile = {
  coreBeliefs: [
    { theme: 'unlovable', statement: '我是不值得被爱的', activationTags: ['被抛弃'] },
    { theme: 'worthless', statement: '我什么都做不好', activationTags: ['失败'] },
  ],
  forbiddenBehaviors: [],
  sensitiveTopics: [],
};

describe('WP57 · 落库路径接线 (会话层)', () => {
  it('落库快照真的带上信念演化 (不是只在出参里好看)', async () => {
    const { bdiStates, session } = createHarness();
    const handle = session.openSession({
      sessionId: 'wp57-1',
      tenantId: TENANT,
      visitorId: 'v1',
      characterProfile: PROFILE,
    });

    const out = await session.turn(handle.handleId, { userText: '你总觉得自己会被抛弃' });

    expect(out.snapshot.coreBeliefActivation['unlovable']).toBeCloseTo(0.12, 10);
    expect(out.snapshot.coreBeliefActivation['worthless']).toBeCloseTo(0, 10);

    const stored = await bdiStates.load(TENANT, 'wp57-1');
    expect(stored?.snapshot.coreBeliefActivation['unlovable']).toBeCloseTo(0.12, 10);
  });

  it('第二轮不命中 → 上一轮的激活强度被衰减 (证明状态真的接续了)', async () => {
    const { session } = createHarness();
    const handle = session.openSession({
      sessionId: 'wp57-2',
      tenantId: TENANT,
      visitorId: 'v1',
      characterProfile: PROFILE,
    });

    await session.turn(handle.handleId, { userText: '你总觉得自己会被抛弃' });
    const second = await session.turn(handle.handleId, { userText: '今天我们聊聊别的' });

    expect(second.snapshot.coreBeliefActivation['unlovable']).toBeCloseTo(0.12 * 0.8, 10);
  });

  it('无角色 profile 的会话 → 信念层保持空对象 (不报错)', async () => {
    const { session } = createHarness();
    const handle = session.openSession({ sessionId: 'wp57-3', tenantId: TENANT, visitorId: 'v1' });

    const out = await session.turn(handle.handleId, { userText: '你总觉得自己会被抛弃' });

    expect(out.snapshot.coreBeliefActivation).toEqual({});
  });
});

describe('WP57 · 边界', () => {
  it('非法端口值 → 逐项回退内核种子值, 不产生 NaN / Infinity', () => {
    const snapshot = makeSnapshot({ coreBeliefActivation: { unlovable: 0.5, worthless: 0 } });
    const next = applyBeliefActivationDelta(snapshot, '被抛弃', {
      activationDelta: 5, // > 1 → 回退 0.15
      activationDecayRate: -1, // 负数 → 回退 0.8
      introducedDecayRate: Number.NaN,
      observedDecayRate: 2, // > 1 → 回退 0.95
      removeThreshold: -0.5,
    });

    // 回退后的口径: (0.5 + 0.15) × 0.8 = 0.52.
    expect(next.coreBeliefActivation['unlovable']).toBeCloseTo(0.52, 10);
    expect(Number.isFinite(next.coreBeliefActivation['unlovable'])).toBe(true);
  });

  it('自定义端口真的生效 (activationDelta 改成 0.5 → (0 + 0.5) × 0.8 = 0.4)', () => {
    const next = applyBeliefActivationDelta(makeSnapshot(), '被抛弃', {
      ...DEFAULT_BELIEF_OPERATOR_CONFIG,
      activationDelta: 0.5,
    });

    expect(next.coreBeliefActivation['unlovable']).toBeCloseTo(0.4, 10);
  });

  it('传入的快照不被就地修改 (快照是值语义)', () => {
    const snapshot = makeSnapshot({
      coreBeliefActivation: { unlovable: 0.5, worthless: 0 },
      temporaryBeliefs: [{ id: 'tb-intro', statement: 'x', confidence: 0.5, source: 'introduced' }],
    });
    applyBeliefEvolution(snapshot, '被抛弃');

    expect(snapshot.coreBeliefActivation['unlovable']).toBe(0.5);
    expect(confidenceOf(snapshot, 'tb-intro')).toBe(0.5);
  });

  it('同输入同输出 (值语义可复现)', () => {
    const snapshot = makeSnapshot({ coreBeliefActivation: { unlovable: 0.3, worthless: 0.1 } });
    const a = applyBeliefEvolution(snapshot, '你总觉得自己会被抛弃');
    const b = applyBeliefEvolution(snapshot, '你总觉得自己会被抛弃');

    expect(a).toEqual(b);
  });

  it('cloneBdiSnapshot 带过激活强度 (克隆不是清零)', () => {
    const snapshot = makeSnapshot({ coreBeliefActivation: { unlovable: 0.42, worthless: 0 } });
    const cloned = cloneBdiSnapshot(snapshot);

    expect(cloned.coreBeliefActivation['unlovable']).toBe(0.42);
    expect(cloned.coreBeliefActivation).not.toBe(snapshot.coreBeliefActivation);
  });

  it('内核种子值就是任务单给的那几个数 (工程种子值, 非临床标定)', () => {
    expect(DEFAULT_BELIEF_ACTIVATION_DELTA).toBe(0.15);
    expect(DEFAULT_BELIEF_DECAY_RATE).toBe(0.8);
    expect(DEFAULT_INTRODUCED_BELIEF_DECAY_RATE).toBe(0.9);
    expect(DEFAULT_OBSERVED_BELIEF_DECAY_RATE).toBe(0.95);
    expect(DEFAULT_TEMPORARY_BELIEF_REMOVE_THRESHOLD).toBe(0.1);
  });
});
