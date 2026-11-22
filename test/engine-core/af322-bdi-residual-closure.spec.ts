// AF-322 (2026-11-23 · BDI 决策层残留闭合 · 确定性回归):
//   目的: 把“规则轨永远只有六个策略 / 被理解与被接纳混成一个信号 / 在场状态事件全零 /
//         移情跨会话原样保留”四条临床缺口钉成机器断言.
//
//   覆盖:
//     ① insight：同盟稳定 + 自发信念 + 轮次 >= 8 → 整合领悟；
//     ② discussing_plans：控制型愿望 >= 0.55 + 轮次 >= 12 → 计划讨论，并优先于 insight；
//     ③ 被理解 / 被接纳拆成双信号：只有二者都过线才下调探索门槛；
//     ④ 直接调用（不传轮次）保持 AF-315 的旧边界，不被后段策略改变；
//     ⑤ holding_present / cold_absent 有方向正确的基础 delta，且单回合不越 cap；
//     ⑥ 移情三维按 90 天半衰期回落；0 = 显式禁用；核心信念 / 欲望逐字不变.
//
//   边界: 纯内核 / 纯函数，零 @nestjs、零 env、零网络、零随机.

import { planIntention } from '../../src/engine-core/cognition/intention-planner.js';
import { applySessionDecay, DEFAULT_SESSION_DECAY_CONFIG } from '../../src/engine-core/cognition/session-decay.js';
import { aggregateTurnDelta, capTurnDelta, DEFAULT_DELTA_CAP_CONFIG } from '../../src/engine-core/cognition/state-transition.js';
import type { BdiSnapshot } from '../../src/engine-core/domain/bdi-snapshot.js';
import { createEmptyBdiSnapshot } from '../../src/engine-core/domain/bdi-snapshot.js';
import type { TemporaryBelief } from '../../src/engine-core/domain/beliefs.js';
import type { UnderlyingDesire } from '../../src/engine-core/domain/desires.js';
import type { SessionEvent } from '../../src/engine-core/domain/events/session-event.js';

const DAY_MS = 24 * 3600 * 1000;

/** 造一份可控快照（显式替换愿望层，避免默认种子干扰门槛）. */
function snap(overrides: Partial<BdiSnapshot> = {}): BdiSnapshot {
  const base = createEmptyBdiSnapshot();
  return {
    ...base,
    trust: 0.82,
    safety: 0.82,
    bond: 0.7,
    resistance: { verbal: 0.2, depth: 0.18, style: 0.2 },
    emotion: { label: 'hopeful', valence: 0.2, arousal: 0.35 },
    underlyingDesires: [desire('understood', 0.7), desire('accepted', 0.6), desire('avoid_pain', 0.4), desire('control', 0.45)],
    temporaryBeliefs: [],
    ...overrides,
  };
}

function desire(key: string, weight: number): UnderlyingDesire {
  return { key, label: key, baselineWeight: weight, currentWeight: weight };
}

function belief(overrides: Partial<TemporaryBelief> = {}): TemporaryBelief {
  return { id: 'b1', statement: '表达脆弱会被嫌麻烦', confidence: 0.7, source: 'observed', ...overrides };
}

describe('AF-322 · BDI 决策层残留闭合', () => {
  describe('①/② 后段策略', () => {
    it('第 8 轮 + 自发高置信信念 + 同盟稳定 → insight', () => {
      const ready = snap({ temporaryBeliefs: [belief()] });
      expect(planIntention(ready, undefined, undefined, { turnNumber: 8 }).strategy).toBe('insight');
    });

    it('第 12 轮 + 控制愿望 0.6 → discussing_plans，且优先于 insight', () => {
      const ready = snap({
        temporaryBeliefs: [belief()],
        underlyingDesires: [desire('understood', 0.7), desire('accepted', 0.6), desire('avoid_pain', 0.4), desire('control', 0.6)],
      });
      expect(planIntention(ready, undefined, undefined, { turnNumber: 12 }).strategy).toBe('discussing_plans');
      expect(planIntention(ready, undefined, undefined, { turnNumber: 8 }).strategy).toBe('insight');
    });

    it('信念是咨询师引入 / 置信度不足 / 同盟不足 / 轮次不足 → 不进入 insight', () => {
      expect(
        planIntention(snap({ temporaryBeliefs: [belief({ source: 'introduced' })] }), undefined, undefined, {
          turnNumber: 8,
        }).strategy,
      ).not.toBe('insight');
      expect(
        planIntention(snap({ temporaryBeliefs: [belief({ confidence: 0.59 })] }), undefined, undefined, {
          turnNumber: 8,
        }).strategy,
      ).not.toBe('insight');
      expect(
        planIntention(snap({ temporaryBeliefs: [belief()], trust: 0.4, safety: 0.4 }), undefined, undefined, {
          turnNumber: 8,
        }).strategy,
      ).not.toBe('insight');
      expect(planIntention(snap({ temporaryBeliefs: [belief()] }), undefined, undefined, { turnNumber: 7 }).strategy).not.toBe('insight');
    });

    it('深度阻抗高 / 回避主导 / 激活阻断时，后段策略仍让位于保护', () => {
      const deep = snap({ temporaryBeliefs: [belief()], resistance: { verbal: 0.2, depth: 0.6, style: 0.2 } });
      expect(planIntention(deep, undefined, undefined, { turnNumber: 12 }).strategy).not.toBe('insight');
      const avoid = snap({
        temporaryBeliefs: [belief()],
        underlyingDesires: [desire('understood', 0.3), desire('accepted', 0.3), desire('avoid_pain', 0.8), desire('control', 0.6)],
      });
      expect(planIntention(avoid, undefined, undefined, { turnNumber: 12 }).strategy).not.toBe('discussing_plans');
    });
  });

  describe('③ 被理解 / 被接纳双信号', () => {
    it('只有 understood 过线、accepted 未过线 → 不下调探索门槛', () => {
      // min(trust, safety)=0.58；默认 open=0.6 → 不下调时锁门，下调后 0.57 才开.
      const snapshot = snap({
        trust: 0.58,
        safety: 0.58,
        underlyingDesires: [desire('understood', 0.7), desire('accepted', 0.5)],
      });
      expect(planIntention(snapshot, undefined, undefined, { turnNumber: 2 }).strategy).toBe('recounting');
    });

    it('understood 与 accepted 双过线 → 门槛下调 0.03，可以探索', () => {
      const snapshot = snap({
        trust: 0.58,
        safety: 0.58,
        underlyingDesires: [desire('understood', 0.7), desire('accepted', 0.6)],
      });
      expect(planIntention(snapshot, undefined, undefined, { turnNumber: 2 }).strategy).toBe('cognitive_exploration');
    });
  });

  describe('④ 直接调用兼容', () => {
    it('不传轮次时后段策略不启用，旧边界保持', () => {
      const snapshot = snap({ temporaryBeliefs: [belief()], trust: 0.9, safety: 0.9 });
      expect(planIntention(snapshot).strategy).toBe('cognitive_exploration');
    });
  });

  describe('⑤ 在场状态 delta', () => {
    it('holding_present 方向正确且单回合不越 cap', () => {
      const raw = aggregateTurnDelta([{ kind: 'holding_present', strength: 1 } as SessionEvent]);
      const capped = capTurnDelta(raw, DEFAULT_DELTA_CAP_CONFIG);
      expect(raw.safety).toBeGreaterThan(0);
      expect(raw.bond).toBeGreaterThan(0);
      expect(raw.verbal).toBeLessThan(0);
      expect(capped.safety).toBe(raw.safety);
      expect(capped.bond).toBe(raw.bond);
      expect(raw.safety).toBeLessThan(DEFAULT_DELTA_CAP_CONFIG.safety.up);
    });

    it('cold_absent 方向正确且单回合不越 cap', () => {
      const raw = aggregateTurnDelta([{ kind: 'cold_absent', strength: 1 } as SessionEvent]);
      const capped = capTurnDelta(raw, DEFAULT_DELTA_CAP_CONFIG);
      expect(raw.trust).toBeLessThan(0);
      expect(raw.safety).toBeLessThan(0);
      expect(raw.bond).toBeLessThan(0);
      expect(capped.trust).toBe(raw.trust);
      expect(Math.abs(raw.trust)).toBeLessThan(Math.abs(DEFAULT_DELTA_CAP_CONFIG.trust.down));
    });
  });

  describe('⑥ 移情跨会话衰减', () => {
    it('90 天半衰期处移情三维恰好减半，核心信念 / 欲望不变', () => {
      const before = createEmptyBdiSnapshot();
      const transference = { positive: 0.8, negative: 0.6, dependency: 0.4 };
      const snapshot: BdiSnapshot = {
        ...before,
        transference,
        coreBeliefs: [{ theme: 'unlovable', statement: '我不值得被爱', activationTags: [] }],
        underlyingDesires: [desire('understood', 0.6)],
      };
      const after = applySessionDecay(snapshot, DAY_MS * 90, DEFAULT_SESSION_DECAY_CONFIG);
      expect(after.transference.positive).toBeCloseTo(0.4, 6);
      expect(after.transference.negative).toBeCloseTo(0.3, 6);
      expect(after.transference.dependency).toBeCloseTo(0.2, 6);
      expect(after.coreBeliefs).toEqual(snapshot.coreBeliefs);
      expect(after.underlyingDesires).toEqual(snapshot.underlyingDesires);
    });

    it('transferenceHalfLifeMs = 0 → 显式禁用，移情逐字不变', () => {
      const snapshot = { ...createEmptyBdiSnapshot(), transference: { positive: 0.8, negative: 0.6, dependency: 0.4 } };
      const after = applySessionDecay(snapshot, DAY_MS * 90, {
        ...DEFAULT_SESSION_DECAY_CONFIG,
        transferenceHalfLifeMs: 0,
      });
      expect(after.transference).toEqual(snapshot.transference);
    });
  });
});
