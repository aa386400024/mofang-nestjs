// AF-315 (2026-11-22 · BDI 决策敏感性与临床校准 · 确定性场景回归):
//   目的: 把“20 轮全靠叙述 / 移情不进入决策 / 事件全 neutral / trace 看不见决策输入”
//         四条缺陷钉成机器断言，而不是靠人工看 trace 猜.
//
//   覆盖:
//     ① 低安全感基线跑 20 轮有效共情：safety 能在 15 轮内过 0.6，探索不再锁死；
//     ② 首轮不进入深度探索；第二轮起才允许；
//     ③ 负移情主导 → 抗拒；依赖移情高 → 请求；
//     ④ 核心信念激活高且安全感不足 → 抑制探索；安全感足够后解锁；
//     ⑤ avoid_pain 压过 understood → 抑制探索；understood 高 → 允许探索；
//     ⑥ 规则轨能识别常见中文反映式共情，且不把纯复述判成 empathy.
//
//   边界: 纯内核 / 内存实现，零 @nestjs、零 env、零网络、零随机.

import { planIntention } from '../../src/engine-core/cognition/intention-planner.js';
import { RuleBasedClassifier } from '../../src/engine-core/cognition/rule-based-classifier.js';
import type { BdiSnapshot } from '../../src/engine-core/domain/bdi-snapshot.js';
import { createEmptyBdiSnapshot } from '../../src/engine-core/domain/bdi-snapshot.js';
import type { CharacterProfile } from '../../src/engine-core/domain/character-profile.js';
import type { UnderlyingDesire } from '../../src/engine-core/domain/desires.js';
import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository.js';
import { InMemoryEngineSession } from '../../src/engine-core/in-memory/in-memory-engine-session.js';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store.js';

/** 有效共情文本 —— 只命中 empathy 一条规则. */
const EMPATHY_TEXT = '听起来你现在一定很难受, 我能理解你';

/** AF-315 低安全感基线角色 (对应 8 场真实 trace 的典型起点). */
const LOW_SAFETY_PROFILE: CharacterProfile = {
  coreBeliefs: [],
  forbiddenBehaviors: [],
  sensitiveTopics: [],
  baseline: {
    trust: 0.32,
    safety: 0.35,
    bond: 0.65,
    resistance: { verbal: 0.25, depth: 0.4, style: 0.3 },
    emotion: { label: 'guarded', valence: -0.15, arousal: 0.45 },
  },
};

/** 造一份可控快照 (中性基线 + 逐维覆盖). */
function snap(overrides: Partial<BdiSnapshot> = {}): BdiSnapshot {
  return { ...createEmptyBdiSnapshot(), ...overrides };
}

/** 造愿望条目 (只保留被测的两个愿望，避免隐式默认干扰). */
function desire(key: string, weight: number): UnderlyingDesire {
  return { key, label: key, baselineWeight: weight, currentWeight: weight };
}

/** 造一个确定性会话 (内存仓储 + 固定时钟). */
function createSession(profile: CharacterProfile) {
  const now = (): number => 1_700_000_000_000;
  const session = new InMemoryEngineSession({
    bdiStates: new InMemoryBdiStateRepository(),
    memories: new InMemoryMemoryStore({ now }),
    idFactory: () => 'af315-id',
    now,
  });
  const handle = session.openSession({ sessionId: 'af315', tenantId: 'default', visitorId: 'af315-visitor', characterProfile: profile });
  return { session, handleId: handle.handleId };
}

describe('AF-315 · BDI 决策敏感性与临床校准', () => {
  it('20 轮有效共情：safety 在 15 轮内过 0.6，探索不再被锁死', async () => {
    const { session, handleId } = createSession(LOW_SAFETY_PROFILE);
    const strategies: string[] = [];
    let firstGateTurn: number | null = null;

    for (let turn = 1; turn <= 20; turn += 1) {
      const out = await session.turn(handleId, { userText: EMPATHY_TEXT });
      strategies.push(out.intention.strategy);
      if (firstGateTurn === null && out.snapshot.safety >= 0.6) firstGateTurn = out.turnIndex;

      // 首轮不得进入深度探索 —— 还在建立接触.
      if (out.turnIndex === 1) {
        expect(['recounting', 'simple_response']).toContain(out.intention.strategy);
      }
      // 数值不越界、不 NaN.
      expect(Number.isFinite(out.snapshot.safety)).toBe(true);
      expect(out.snapshot.safety).toBeGreaterThanOrEqual(0);
      expect(out.snapshot.safety).toBeLessThanOrEqual(1);
    }

    expect(firstGateTurn).not.toBeNull();
    // 当前种子系数下：safety 0.35 起、每轮有效共情 +0.06 → 第 5 轮达到 0.65.
    // 这里锁死具体轮次，后续若再调系数，必须同步复核临床节奏是否仍合理.
    expect(firstGateTurn!).toBe(5);
    expect(firstGateTurn!).toBeLessThanOrEqual(15);
    expect(strategies.some((strategy) => strategy === 'affective_exploration' || strategy === 'cognitive_exploration')).toBe(true);
    expect(new Set(strategies).size).toBeGreaterThanOrEqual(2);
  });

  it('首轮不进入探索，第二轮起解除时机门槛', () => {
    const ready = snap({
      trust: 0.9,
      safety: 0.9,
      resistance: { verbal: 0.2, depth: 0.2, style: 0.2 },
      emotion: { label: 'guarded', valence: -0.1, arousal: 0.4 },
    });

    expect(planIntention(ready, undefined, undefined, { turnNumber: 1 }).strategy).toBe('recounting');
    expect(planIntention(ready, undefined, undefined, { turnNumber: 2 }).strategy).toBe('affective_exploration');
  });

  it('负移情主导 → 抗拒，即使同盟数值很高', () => {
    const negative = snap({
      trust: 0.9,
      safety: 0.9,
      resistance: { verbal: 0.2, depth: 0.2, style: 0.2 },
      transference: { positive: 0.1, negative: 0.4, dependency: 0 },
    });

    const intention = planIntention(negative, undefined, undefined, { turnNumber: 2 });

    expect(intention.strategy).toBe('resistance');
    expect(intention.rationale).toContain('负移情');
  });

  it('依赖移情高 → 请求，不再永远停在叙述', () => {
    const dependent = snap({
      trust: 0.9,
      safety: 0.9,
      resistance: { verbal: 0.2, depth: 0.2, style: 0.2 },
      transference: { positive: 0.2, negative: 0, dependency: 0.5 },
    });

    const intention = planIntention(dependent, undefined, undefined, { turnNumber: 2 });

    expect(intention.strategy).toBe('request');
    expect(intention.rationale).toContain('依赖移情');
  });

  it('核心信念激活高且安全感不足 → 抑制探索；安全感足够后解锁', () => {
    const activated = snap({
      trust: 0.7,
      safety: 0.62,
      resistance: { verbal: 0.2, depth: 0.2, style: 0.2 },
      coreBeliefActivation: { worthless: 0.62 },
    });
    const safe = snap({
      trust: 0.8,
      safety: 0.8,
      resistance: { verbal: 0.2, depth: 0.2, style: 0.2 },
      coreBeliefActivation: { worthless: 0.62 },
    });

    expect(planIntention(activated, undefined, undefined, { turnNumber: 2 }).strategy).toBe('recounting');
    expect(planIntention(activated, undefined, undefined, { turnNumber: 2 }).rationale).toContain('核心信念激活');
    expect(planIntention(safe, undefined, undefined, { turnNumber: 2 }).strategy).toBe('cognitive_exploration');
  });

  it('avoid_pain 压过 understood → 抑制探索；understood 高 → 允许探索', () => {
    const avoiding = snap({
      trust: 0.9,
      safety: 0.8,
      resistance: { verbal: 0.2, depth: 0.2, style: 0.2 },
      underlyingDesires: [desire('understood', 0.4), desire('avoid_pain', 0.8)],
    });
    const seeking = snap({
      trust: 0.9,
      safety: 0.8,
      resistance: { verbal: 0.2, depth: 0.2, style: 0.2 },
      underlyingDesires: [desire('understood', 0.8), desire('avoid_pain', 0.5)],
    });

    expect(planIntention(avoiding, undefined, undefined, { turnNumber: 2 }).strategy).toBe('recounting');
    expect(planIntention(avoiding, undefined, undefined, { turnNumber: 2 }).rationale).toContain('回避痛苦');
    expect(planIntention(seeking, undefined, undefined, { turnNumber: 2 }).strategy).toBe('cognitive_exploration');
  });

  it('规则轨识别常见中文反映式共情，且不把纯复述判成 empathy', () => {
    const classifier = new RuleBasedClassifier();
    const reflective = [
      '你停不下来，可能是想靠检查获得确定感。',
      '你现在的“绕”像是在保护自己。',
      '你的意思是，你更怕被否定，而不是怕做错。',
      '我听到你说，你一直不敢停下来。',
      '对你来说，沉默比争吵更安全。',
      '这让你觉得，自己怎么做都不够。',
      '你似乎把所有的责任都揽到了自己身上。',
      '你刚才说，最难受的是没人相信你。',
      '可能是在那个时刻，你学会了先照顾别人。',
      '你反复检查，是想确认自己不会被责怪。',
    ];

    for (const text of reflective) {
      const events = classifier.classify(text);
      expect(events.some((event) => event.kind === 'empathy')).toBe(true);
      expect(events.some((event) => event.kind === 'neutral')).toBe(false);
    }

    const restatement = classifier.classify('他说他晚点回家。');
    expect(restatement.some((event) => event.kind === 'empathy')).toBe(false);
    expect(restatement.map((event) => event.kind)).toEqual(['neutral']);

    // 临床误判护栏：宽词不得把“很多人伤害过你 / 提问 / 自我关怀”判成正常化、肯定或说教.
    const guarded = ['很多人伤害过你。', '你能面对这件事吗？', '你不能这样对自己。'];
    for (const text of guarded) {
      const events = classifier.classify(text);
      expect(events.map((event) => event.kind)).toEqual(['neutral']);
    }
  });
});
