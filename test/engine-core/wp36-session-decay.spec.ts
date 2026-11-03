// V2026-11-03 WP36 (引擎内核 · 跨会话间隔自然衰减):
//   目的: 钉死"resume 时按间隔对情绪 / 阻抗 / 同盟做差异化半衰期回落"这条规则 ——
//     ① 零间隔 → 快照原样 (不衰减);
//     ② 三组各自的半衰期处**恰好减半** (情绪 7 天 / 阻抗 14 天 / 同盟 30 天);
//     ③ 稳定人格维度 (信念 / 欲望 / 移情) **逐字不变**;
//     ④ 边界: 负间隔按 0 处理 / 非法端口值回退种子值 / 标签随数值重算 / 长间隔不归零;
//     ⑤ 会话层: 衰减只发生在**跨场边界的那一次**, 无 resume 时行为逐字不变.
//
//   为什么"恰好减半"是硬断言 (而不是"变小了"):
//     半衰期是**可解释锚点** —— "隔了 7 天, 情绪正好平复一半"这句话只有成立, 调参才有意义.
//     写成"变小了"的话, 半衰期改成 7 小时也照样绿, 那这组系数就是不可校准的.
//
//   反依赖污染:
//     不 import 任何 @nestjs/* / typeorm; 只用内核纯 TS + 内存实现.
//
//   验证: npx vitest run test/engine-core/wp36-session-decay.spec.ts

import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository.js';
import { InMemoryEngineSession } from '../../src/engine-core/in-memory/in-memory-engine-session.js';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store.js';
import { DEFAULT_SESSION_DECAY_CONFIG, applySessionDecay, createEmptyBdiSnapshot, type BdiSnapshot } from '../../src/engine-core/index.js';

/** 一天 (ms). */
const DAY_MS = 24 * 3600 * 1000;

/** 租户. */
const TENANT = 'default';

/**
 * 造一份"各维度取值都非零"的快照.
 *
 * 为什么不用默认基线: 默认的 valence=0 / bond=0 / transference 全 0 ——
 * 拿 0 去验"减半"是验不出东西的 (0 的一半还是 0). 每一维都必须有可辨的取值.
 */
function makeSnapshot(): BdiSnapshot {
  const base = createEmptyBdiSnapshot();
  return {
    ...base,
    coreBeliefs: [{ theme: 'unlovable', statement: '我是不值得被爱的', activationTags: ['core'] }],
    temporaryBeliefs: [{ id: 'tb-1', statement: '这次会好起来的', confidence: 0.6, source: 'observed' }],
    memoryBeliefs: [{ id: 'mb-1', statement: '上周几乎没睡', confidence: 0.8, expiresAt: null }],
    situationalDesires: [{ id: 'sd-1', text: '想被理解', priority: 0.7, active: true }],
    emotion: { label: 'angry', valence: -0.8, arousal: 0.8 },
    resistance: { verbal: 0.7, depth: 0.6, style: 0.5 },
    transference: { positive: 0.3, negative: 0.5, dependency: 0.2 },
    trust: 0.8,
    safety: 0.6,
    bond: 0.4,
  };
}

describe('WP36 · 跨会话间隔自然衰减 (纯函数)', () => {
  describe('① 零间隔 → 不衰减', () => {
    it('ageMs = 0 时快照原样返回 (数值逐字不变)', () => {
      const snapshot = makeSnapshot();
      const decayed = applySessionDecay(snapshot, 0);

      expect(decayed.emotion.valence).toBe(-0.8);
      expect(decayed.emotion.arousal).toBe(0.8);
      expect(decayed.emotion.label).toBe('angry');
      expect(decayed.resistance).toEqual({ verbal: 0.7, depth: 0.6, style: 0.5 });
      expect(decayed.trust).toBe(0.8);
      expect(decayed.safety).toBe(0.6);
      expect(decayed.bond).toBe(0.4);
    });

    it('ageMs = 0 时情绪标签也不重算 (标签与数值仍然对得上)', () => {
      const decayed = applySessionDecay(makeSnapshot(), 0);
      // 原始标签是 angry (valence=-0.8 / arousal=0.8 推出); 不重算就该仍是 angry.
      expect(decayed.emotion.label).toBe('angry');
    });
  });

  describe('② 三组各自的半衰期处恰好减半', () => {
    it('ageMs = 7 天 → valence / arousal 恰好减半', () => {
      const decayed = applySessionDecay(makeSnapshot(), 7 * DAY_MS);

      expect(decayed.emotion.valence).toBeCloseTo(-0.4, 10);
      expect(decayed.emotion.arousal).toBeCloseTo(0.4, 10);
    });

    it('ageMs = 14 天 → 阻抗三维恰好减半', () => {
      const decayed = applySessionDecay(makeSnapshot(), 14 * DAY_MS);

      expect(decayed.resistance.verbal).toBeCloseTo(0.35, 10);
      expect(decayed.resistance.depth).toBeCloseTo(0.3, 10);
      expect(decayed.resistance.style).toBeCloseTo(0.25, 10);
    });

    it('ageMs = 30 天 → trust / safety / bond 恰好减半', () => {
      const decayed = applySessionDecay(makeSnapshot(), 30 * DAY_MS);

      expect(decayed.trust).toBeCloseTo(0.4, 10);
      expect(decayed.safety).toBeCloseTo(0.3, 10);
      expect(decayed.bond).toBeCloseTo(0.2, 10);
    });

    it('各组互不串味: 情绪半衰期处阻抗与同盟不该跟着减半', () => {
      const decayed = applySessionDecay(makeSnapshot(), 7 * DAY_MS);

      // 阻抗半衰期 14 天 → 7 天时只走了半程 (2^(-0.5) ≈ 0.7071).
      expect(decayed.resistance.verbal).toBeCloseTo(0.7 * Math.pow(2, -0.5), 10);
      // 同盟半衰期 30 天 → 7 天时几乎没动.
      expect(decayed.trust).toBeCloseTo(0.8 * Math.pow(2, -7 / 30), 10);
      expect(decayed.trust).toBeGreaterThan(0.6);
    });

    it('负效价保留符号 (情绪平复是"幅度变小", 不是"变正面")', () => {
      const decayed = applySessionDecay(makeSnapshot(), 7 * DAY_MS);

      expect(decayed.emotion.valence).toBeLessThan(0);
    });
  });

  describe('③ 稳定人格维度逐字不变', () => {
    it('coreBeliefs / temporaryBeliefs / memoryBeliefs / 欲望 / 移情三态 全部不动', () => {
      const snapshot = makeSnapshot();
      const decayed = applySessionDecay(snapshot, 90 * DAY_MS);

      expect(decayed.coreBeliefs).toEqual(snapshot.coreBeliefs);
      expect(decayed.temporaryBeliefs).toEqual(snapshot.temporaryBeliefs);
      expect(decayed.memoryBeliefs).toEqual(snapshot.memoryBeliefs);
      expect(decayed.underlyingDesires).toEqual(snapshot.underlyingDesires);
      expect(decayed.situationalDesires).toEqual(snapshot.situationalDesires);
      expect(decayed.transference).toEqual(snapshot.transference);
    });

    it('移情三态在 90 天后仍逐字不变 (移情不是状态性维度)', () => {
      const snapshot = makeSnapshot();
      const decayed = applySessionDecay(snapshot, 90 * DAY_MS);

      expect(decayed.transference.positive).toBe(0.3);
      expect(decayed.transference.negative).toBe(0.5);
      expect(decayed.transference.dependency).toBe(0.2);
    });
  });

  describe('④ 边界', () => {
    it('ageMs 为负数 (时钟偏移) → 按 0 处理, 不衰减', () => {
      const decayed = applySessionDecay(makeSnapshot(), -5 * DAY_MS);

      expect(decayed.trust).toBe(0.8);
      expect(decayed.emotion.valence).toBe(-0.8);
      expect(decayed.resistance.verbal).toBe(0.7);
    });

    it('非法端口值 (0 / 负数 / NaN) → 逐项回退内核种子值, 不产生 NaN / Infinity', () => {
      const decayed = applySessionDecay(makeSnapshot(), 7 * DAY_MS, {
        emotionHalfLifeMs: 0,
        resistanceHalfLifeMs: -1,
        allianceHalfLifeMs: Number.NaN,
      });

      expect(decayed.emotion.valence).toBeCloseTo(-0.4, 10); // 回退 7 天 → 恰好减半
      expect(decayed.resistance.verbal).toBeCloseTo(0.7 * Math.pow(2, -0.5), 10); // 回退 14 天
      expect(decayed.trust).toBeCloseTo(0.8 * Math.pow(2, -7 / 30), 10); // 回退 30 天
      expect(Number.isFinite(decayed.trust)).toBe(true);
    });

    it('自定义端口真的生效 (半衰期改成 1 天 → 1 天恰好减半)', () => {
      const decayed = applySessionDecay(makeSnapshot(), 1 * DAY_MS, {
        emotionHalfLifeMs: 1 * DAY_MS,
        resistanceHalfLifeMs: 1 * DAY_MS,
        allianceHalfLifeMs: 1 * DAY_MS,
      });

      expect(decayed.emotion.valence).toBeCloseTo(-0.4, 10);
      expect(decayed.resistance.verbal).toBeCloseTo(0.35, 10);
      expect(decayed.trust).toBeCloseTo(0.4, 10);
    });

    it('情绪标签随数值重算 (数值动了标签必须跟着动, 否则标签与数值对不上)', () => {
      const snapshot = makeSnapshot();
      expect(snapshot.emotion.label).toBe('angry');

      const decayed = applySessionDecay(snapshot, 7 * DAY_MS);

      // valence=-0.4 / arousal=0.4 → 象限落点变成 guarded (不再是 angry).
      expect(decayed.emotion.label).toBe('guarded');
    });

    it('传入的快照不被就地修改 (快照是值语义)', () => {
      const snapshot = makeSnapshot();
      applySessionDecay(snapshot, 30 * DAY_MS);

      expect(snapshot.trust).toBe(0.8);
      expect(snapshot.emotion.valence).toBe(-0.8);
      expect(snapshot.resistance.verbal).toBe(0.7);
      expect(snapshot.emotion.label).toBe('angry');
    });

    it('衰减恒 > 0 → 隔很久也不会清零 (关系不回到陌生人)', () => {
      const decayed = applySessionDecay(makeSnapshot(), 3650 * DAY_MS);

      expect(decayed.trust).toBeGreaterThan(0);
      expect(decayed.safety).toBeGreaterThan(0);
      expect(decayed.bond).toBeGreaterThan(0);
      expect(decayed.trust).toBeLessThan(0.8);
    });

    it('内核种子值 = 7 天 / 14 天 / 30 天', () => {
      expect(DEFAULT_SESSION_DECAY_CONFIG.emotionHalfLifeMs).toBe(7 * DAY_MS);
      expect(DEFAULT_SESSION_DECAY_CONFIG.resistanceHalfLifeMs).toBe(14 * DAY_MS);
      expect(DEFAULT_SESSION_DECAY_CONFIG.allianceHalfLifeMs).toBe(30 * DAY_MS);
    });
  });
});

/** 会话层测试台: 内存仓储 + 可推进的确定性时钟. */
function createHarness(): {
  readonly bdiStates: InMemoryBdiStateRepository;
  readonly session: InMemoryEngineSession;
  readonly advance: (ms: number) => void;
} {
  const bdiStates = new InMemoryBdiStateRepository();
  let idSeq = 0;
  let clock = 1_700_000_000_000;
  const now = (): number => clock;
  const memories = new InMemoryMemoryStore({ now });
  const session = new InMemoryEngineSession({
    bdiStates,
    memories,
    idFactory: () => {
      idSeq += 1;
      return `wp36-id-${idSeq}`;
    },
    now,
  });
  return {
    bdiStates,
    session,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

/** 中性文本 → 零 delta (断言只反映衰减本身, 不掺事件推进). */
const NEUTRAL_TEXT = '今天天气不错';

describe('WP36 · 跨会话间隔自然衰减 (会话层接线)', () => {
  it('resume 走接续分支时, 上一场状态的 updatedAt 决定衰减幅度', async () => {
    const { bdiStates, session, advance } = createHarness();

    await bdiStates.save({
      tenantId: TENANT,
      sessionId: 'prev',
      revision: 1,
      updatedAt: 1_700_000_000_000,
      snapshot: makeSnapshot(),
    });

    // 隔 30 天.
    advance(30 * DAY_MS);

    const handle = session.openSession({
      sessionId: 'next',
      tenantId: TENANT,
      visitorId: 'v1',
      resumeFromSessionId: 'prev',
    });
    const out = await session.turn(handle.handleId, { userText: NEUTRAL_TEXT });

    // 同盟半衰期 30 天 → 恰好减半 (中性事件零 delta, 所以数值只反映衰减).
    expect(out.snapshot.trust).toBeCloseTo(0.4, 10);
    expect(out.snapshot.safety).toBeCloseTo(0.3, 10);
    expect(out.snapshot.bond).toBeCloseTo(0.2, 10);
    // 情绪半衰期 7 天 → 30 天已是 4 个半衰期以上, 情绪几乎完全平复.
    expect(out.snapshot.emotion.valence).toBeCloseTo(-0.8 * Math.pow(2, -30 / 7), 10);
    // 阻抗半衰期 14 天 → 30 天 ≈ 2.14 个半衰期.
    expect(out.snapshot.resistance.verbal).toBeCloseTo(0.7 * Math.pow(2, -30 / 14), 10);
    // 稳定人格维度逐字不变.
    expect(out.snapshot.coreBeliefs).toEqual(makeSnapshot().coreBeliefs);
    expect(out.snapshot.transference).toEqual(makeSnapshot().transference);
  });

  it('衰减只发生在跨场边界那一次: 本场第二轮不再衰减', async () => {
    const { bdiStates, session, advance } = createHarness();

    await bdiStates.save({
      tenantId: TENANT,
      sessionId: 'prev',
      revision: 1,
      updatedAt: 1_700_000_000_000,
      snapshot: makeSnapshot(),
    });

    advance(30 * DAY_MS);

    const handle = session.openSession({
      sessionId: 'next',
      tenantId: TENANT,
      visitorId: 'v1',
      resumeFromSessionId: 'prev',
    });
    const first = await session.turn(handle.handleId, { userText: NEUTRAL_TEXT });
    // 本场第二轮: 又过了 10 天 —— 但状态是本场自己的, 不该再衰减一次.
    advance(10 * DAY_MS);
    const second = await session.turn(handle.handleId, { userText: NEUTRAL_TEXT });

    expect(second.snapshot.trust).toBeCloseTo(first.snapshot.trust, 10);
    expect(second.snapshot.resistance.verbal).toBeCloseTo(first.snapshot.resistance.verbal, 10);
  });

  it('无 resume 的会话行为逐字不变 (新会话走初始基线, 不衰减)', async () => {
    const { session } = createHarness();

    const handle = session.openSession({ sessionId: 'fresh', tenantId: TENANT, visitorId: 'v1' });
    const out = await session.turn(handle.handleId, { userText: NEUTRAL_TEXT });

    expect(out.snapshot.trust).toBeCloseTo(0.3, 5);
    expect(out.snapshot.resistance).toEqual({ verbal: 0.4, depth: 0.4, style: 0.35 });
  });

  it('接续来源不存在时降级为全新会话 (不抛错, 也不衰减)', async () => {
    const { session } = createHarness();

    const handle = session.openSession({
      sessionId: 'next',
      tenantId: TENANT,
      visitorId: 'v1',
      resumeFromSessionId: 'not-exist',
    });
    const out = await session.turn(handle.handleId, { userText: NEUTRAL_TEXT });

    expect(out.turnIndex).toBe(1);
    expect(out.snapshot.trust).toBeCloseTo(0.3, 5);
  });

  it('零间隔的接续 = 原样搬 (旧行为逐字保留)', async () => {
    const { bdiStates, session } = createHarness();

    await bdiStates.save({
      tenantId: TENANT,
      sessionId: 'prev',
      revision: 1,
      updatedAt: 1_700_000_000_000,
      snapshot: makeSnapshot(),
    });

    const handle = session.openSession({
      sessionId: 'next',
      tenantId: TENANT,
      visitorId: 'v1',
      resumeFromSessionId: 'prev',
    });
    const out = await session.turn(handle.handleId, { userText: NEUTRAL_TEXT });

    expect(out.snapshot.trust).toBeCloseTo(0.8, 10);
    expect(out.snapshot.emotion.valence).toBeCloseTo(-0.8, 10);
    expect(out.snapshot.resistance.verbal).toBeCloseTo(0.7, 10);
  });
});
