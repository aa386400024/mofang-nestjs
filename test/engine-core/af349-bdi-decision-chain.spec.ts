import { describe, expect, it } from 'vitest';

import { planIntention, nextIntentionLock, resolveActiveIntentionLock } from '../../src/engine-core/cognition/intention-planner.js';
import { RuleBasedClassifier } from '../../src/engine-core/cognition/rule-based-classifier.js';
import { resolveTimingWeight, transitionState } from '../../src/engine-core/cognition/state-transition.js';
import { createEmptyBdiSnapshot } from '../../src/engine-core/domain/bdi-snapshot.js';
import { DEFAULT_UNDERLYING_DESIRES, evolveDesires, type DesireEvolutionConfig } from '../../src/engine-core/domain/desires.js';
import type { SessionEvent } from '../../src/engine-core/domain/events/session-event.js';

function kinds(events: readonly SessionEvent[]): string[] {
  return events.map((event) => event.kind);
}

describe('AF-349 规则分类器语义 v2', () => {
  it('legacy 档逐字保留旧口径（"你觉得呢"双计 empathy + open_probe）', () => {
    const legacy = new RuleBasedClassifier();
    const events = legacy.classify('你觉得呢？');
    expect(kinds(events)).toEqual(['empathy', 'open_probe']);
    expect(events.every((event) => event.strength === 1)).toBe(true);
  });

  it('v2 档长词遮盖：只保留 open_probe，不双计 empathy', () => {
    const v2 = new RuleBasedClassifier({ semantics: 'v2' });
    const events = v2.classify('你觉得呢？');
    expect(kinds(events)).toEqual(['open_probe']);
    expect(events[0]?.matchedTerms).toEqual(['你觉得呢']);
  });

  it('v2 档否定抑制："我不想让你觉得我在共情" 不命中 empathy', () => {
    const v2 = new RuleBasedClassifier({ semantics: 'v2' });
    const events = v2.classify('我不想让你觉得我在共情，你愿意多说一点吗？');
    expect(kinds(events)).not.toContain('empathy');
    expect(kinds(events)).toContain('open_probe');
  });

  it('v2 档强度折算："你可能觉得" 的 empathy strength 降到 0.6', () => {
    const v2 = new RuleBasedClassifier({ semantics: 'v2' });
    const events = v2.classify('这件事可能让你觉得很难开口。');
    const empathy = events.find((event) => event.kind === 'empathy');
    expect(empathy?.strength).toBe(0.6);
  });

  it('v2 档不过度抑制："不过你说得对" 里的裸"不"不是否定', () => {
    const v2 = new RuleBasedClassifier({ semantics: 'v2' });
    const events = v2.classify('不过你说得对，这让你很难受。');
    expect(kinds(events)).toContain('empathy');
  });

  it('v2 档保留多条独立命中：反射共情 + 开放提问可以并存', () => {
    const v2 = new RuleBasedClassifier({ semantics: 'v2' });
    const events = v2.classify('我理解你的感受，你愿意多说一点吗？');
    expect(kinds(events)).toEqual(['empathy', 'open_probe']);
  });
});

describe('AF-349 愿望演化', () => {
  const baseInput = {
    underlyingDesires: DEFAULT_UNDERLYING_DESIRES,
    situationalDesires: [],
    eventKinds: ['empathy'] as const,
    resistance: { verbal: 0.1, depth: 0.1, style: 0.1 },
    safety: 0.7,
    bond: 0.6,
    turnNumber: 2,
  };

  it('缺省关闭：原样返回入参引用，不改变既有轨迹', () => {
    const result = evolveDesires(baseInput);
    expect(result.changed).toBe(false);
    expect(result.underlyingDesires).toBe(DEFAULT_UNDERLYING_DESIRES);
    expect(result.situationalDesires).toBe(baseInput.situationalDesires);
  });

  it('开启后底层愿望按事件缓慢更新，单轮不超过配置上限', () => {
    const config: DesireEvolutionConfig = {
      enabled: true,
      maxUnderlyingDeltaPerTurn: 0.02,
      baselinePullPerTurn: 0,
      situationalTtlTurns: 3,
      situationalPriorityFloor: 0.4,
    };
    const result = evolveDesires(baseInput, config);
    const understood = result.underlyingDesires.find((desire) => desire.key === 'understood');
    expect(understood?.currentWeight).toBeCloseTo(0.62, 5);
    expect(result.changed).toBe(true);
  });

  it('开启后生成情境愿望，并按 TTL 到期失活', () => {
    const config: DesireEvolutionConfig = {
      enabled: true,
      maxUnderlyingDeltaPerTurn: 0.02,
      baselinePullPerTurn: 0,
      situationalTtlTurns: 2,
      situationalPriorityFloor: 0.4,
    };
    const first = evolveDesires(baseInput, config);
    expect(first.situationalDesires.some((desire) => desire.id === 'situational:understood' && desire.active)).toBe(true);

    const second = evolveDesires(
      { ...baseInput, turnNumber: 5, eventKinds: ['neutral'], situationalDesires: first.situationalDesires },
      config,
    );
    expect(second.situationalDesires.every((desire) => desire.active)).toBe(false);
  });
});

describe('AF-349 意图锁', () => {
  const enabled = { enabled: true, ttlTurns: 3 } as const;

  it('缺省关闭：不产生锁', () => {
    expect(nextIntentionLock(undefined, 'recounting', 1)).toBeNull();
    expect(resolveActiveIntentionLock(undefined, 1)).toBeUndefined();
  });

  it('开启后非保护性策略跨轮可复现；到期自动失效', () => {
    const lock = nextIntentionLock(undefined, 'insight', 2, enabled);
    expect(lock).toMatchObject({ strategy: 'insight', lockedAtTurn: 2, expiresAtTurn: 5 });
    expect(resolveActiveIntentionLock(lock, 4, enabled)?.strategy).toBe('insight');
    expect(resolveActiveIntentionLock(lock, 6, enabled)).toBeUndefined();
  });

  it('保护性策略清锁，不被上一轮锁覆盖', () => {
    const lock = nextIntentionLock(undefined, 'insight', 2, enabled);
    expect(nextIntentionLock(lock, 'resistance', 3, enabled)).toBeNull();
  });

  it('planIntention 在锁有效时保持连续性策略', () => {
    const snapshot = {
      ...createEmptyBdiSnapshot(),
      trust: 0.9,
      safety: 0.9,
      resistance: { verbal: 0.1, depth: 0.1, style: 0.1 },
      intentionLock: { strategy: 'insight' as const, lockedAtTurn: 2, expiresAtTurn: 5, reason: 'continuity' as const },
    };
    const intention = planIntention(snapshot, undefined, undefined, { turnNumber: 3, intentionLockConfig: enabled });
    expect(intention.strategy).toBe('insight');
    expect(intention.rationale).toContain('跨轮意图锁有效');
  });

  it('planIntention 遇到保护性当轮策略时不被锁覆盖', () => {
    const snapshot = {
      ...createEmptyBdiSnapshot(),
      transference: { positive: 0.1, negative: 0.5, dependency: 0.1 },
      intentionLock: { strategy: 'insight' as const, lockedAtTurn: 2, expiresAtTurn: 5, reason: 'continuity' as const },
    };
    const intention = planIntention(snapshot, undefined, undefined, { turnNumber: 3, intentionLockConfig: enabled });
    expect(intention.strategy).toBe('resistance');
  });
});

describe('AF-349 时序权重曲线', () => {
  it('缺省 / none 恒等权，不改变 delta', () => {
    expect(resolveTimingWeight(undefined, 5)).toBe(1);
    expect(resolveTimingWeight({ kind: 'none' }, 5)).toBe(1);
  });

  it('linear_decay 按斜率线性衰减', () => {
    expect(resolveTimingWeight({ kind: 'linear_decay', slope: 0.1 }, 1)).toBe(1);
    expect(resolveTimingWeight({ kind: 'linear_decay', slope: 0.1 }, 6)).toBeCloseTo(0.5, 5);
    expect(resolveTimingWeight({ kind: 'linear_decay', slope: 0.1 }, 20)).toBe(0);
  });

  it('recency 按年龄反比衰减，不归零', () => {
    expect(resolveTimingWeight({ kind: 'recency', slope: 0.25 }, 5)).toBeCloseTo(0.5, 5);
    expect(resolveTimingWeight({ kind: 'recency', slope: 0.25 }, 100)).toBeGreaterThan(0);
  });

  it('window 窗外归零', () => {
    expect(resolveTimingWeight({ kind: 'window', windowTurns: 3 }, 3)).toBe(1);
    expect(resolveTimingWeight({ kind: 'window', windowTurns: 3 }, 4)).toBe(0);
  });

  it('折损系数真实进入 transitionState（cap 之后）', () => {
    const base = createEmptyBdiSnapshot();
    const events: readonly SessionEvent[] = [{ kind: 'empathy', matchedTerms: ['我理解你的'], strength: 1 }];
    const weighted = transitionState(base, events, {
      timingWeight: { kind: 'linear_decay', slope: 0.1 },
      turnIndex: 11,
    });
    // 第 11 轮权重 0：所有 delta 维度回到基线（信念演化仍可能动信念，不动关系量）。
    expect(weighted.trust).toBe(base.trust);
    expect(weighted.safety).toBe(base.safety);
    expect(weighted.bond).toBe(base.bond);
  });
});
