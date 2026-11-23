// AF-359 · 复审 follow-up：浮点主导判定 / 否定辖域 / 跨重启展开 / 条数上限.
//   边界：纯函数，不起 Nest，不连 DB/Redis，不读真实咨询原文.

import { describe, expect, it } from 'vitest';

import { planIntention } from '../../src/engine-core/cognition/intention-planner.js';
import {
  applyBeliefFormation,
  DEFAULT_BELIEF_OPERATOR_CONFIG,
  extractReflectiveStatements,
  type BeliefOperatorConfig,
} from '../../src/engine-core/cognition/state-transition.js';
import { createEmptyBdiSnapshot, type BdiSnapshot } from '../../src/engine-core/domain/bdi-snapshot.js';
import type { TemporaryBelief } from '../../src/engine-core/domain/beliefs.js';
import type { UnderlyingDesire } from '../../src/engine-core/domain/desires.js';

const ON: BeliefOperatorConfig = {
  ...DEFAULT_BELIEF_OPERATOR_CONFIG,
  formationEnabled: true,
  formationBaseConfidence: 0.55,
  formationReinforcement: 0.1,
  formationMaxPerTurn: 1,
};

const TEXT = '我意识到我一直在讨好别人';
const EXPANDED = '我意识到我一直在讨好别人，怕被抛弃';

function desire(key: string, label: string, weight: number): UnderlyingDesire {
  return { key, label, baselineWeight: weight, currentWeight: weight };
}

function snap(): BdiSnapshot {
  return {
    ...createEmptyBdiSnapshot(),
    trust: 0.8,
    safety: 0.8,
    bond: 0.7,
    resistance: { verbal: 0.1, depth: 0.1, style: 0.1 },
  };
}

describe('AF-359 · P1-1 avoidanceDominant 浮点容差', () => {
  it('差值恰好等于 margin (0.68 - 0.58) → 不判 dominant, 不落 recounting', () => {
    const state = {
      ...snap(),
      underlyingDesires: [desire('understood', '被理解', 0.58), desire('avoid_pain', '回避痛苦', 0.68)],
    };
    expect(planIntention(state, undefined, undefined, { turnNumber: 12 }).strategy).not.toBe('recounting');
  });

  it('差值明显越过 margin (0.72 - 0.50) → 仍判 dominant, 落 recounting', () => {
    const state = {
      ...snap(),
      underlyingDesires: [desire('control', '掌控感', 0.5), desire('avoid_pain', '回避痛苦', 0.72)],
    };
    expect(planIntention(state, undefined, undefined, { turnNumber: 12 }).strategy).toBe('recounting');
  });
});

describe('AF-359 · P1-2 否定辖域', () => {
  it('否定宾语是真实觉察: 没有人 / 并不需要 保留', () => {
    expect(extractReflectiveStatements('我意识到没有人真正关心我', ON)).toEqual(['我意识到没有人真正关心我']);
    expect(extractReflectiveStatements('我意识到并不需要别人认可', ON)).toEqual(['我意识到并不需要别人认可']);
  });

  it('否定觉察动词本身: 我似乎没有意识到 / 我似乎并不觉得自己 排除', () => {
    expect(extractReflectiveStatements('我似乎没有意识到我很容易焦虑', ON)).toEqual([]);
    expect(extractReflectiveStatements('我似乎并不觉得自己被排斥', ON)).toEqual([]);
  });
});

describe('AF-359 · P1-3 跨重启展开', () => {
  it('持久化旧序号 12 / 本地新序号 1 → 合法展开仍强化', () => {
    let state = snap();
    state = applyBeliefFormation(state, TEXT, ON, 3, 12);
    state = applyBeliefFormation(state, EXPANDED, ON, 6, 1);
    expect(state.temporaryBeliefs[0]?.confidence).toBeCloseTo(0.65, 6);
    expect(state.temporaryBeliefs[0]?.evidenceCount).toBe(2);
    expect(state.temporaryBeliefs[0]?.statement).toBe(EXPANDED);
  });

  it('同一句在同一序号重复读到 → 仍不提升置信度', () => {
    let state = snap();
    state = applyBeliefFormation(state, TEXT, ON, 3, 1);
    state = applyBeliefFormation(state, TEXT, ON, 4, 1);
    expect(state.temporaryBeliefs[0]?.confidence).toBeCloseTo(0.55, 6);
    expect(state.temporaryBeliefs[0]?.evidenceCount).toBe(1);
  });
});

describe('AF-359 · P2-3 / P2-5 快照卫生', () => {
  it('展开后再说回原句 → 不产生同 id 的第二条信念', () => {
    let state = snap();
    state = applyBeliefFormation(state, TEXT, ON, 3, 1);
    state = applyBeliefFormation(state, EXPANDED, ON, 6, 2);
    state = applyBeliefFormation(state, TEXT, ON, 7, 3);
    expect(state.temporaryBeliefs).toHaveLength(1);
    expect(state.temporaryBeliefs[0]?.statement).toBe(EXPANDED);
    expect(state.temporaryBeliefs[0]?.evidenceCount).toBe(2);
  });

  it('40 条上限同分时保留较新观察的条目', () => {
    const prior: TemporaryBelief[] = Array.from({ length: 40 }, (_, index) => ({
      id: `belief-observed-prior-${index}`,
      statement: `我意识到我一直在讨好别人第${index}次`,
      confidence: 0.55,
      source: 'observed',
      evidenceCount: 1,
      lastObservedAtTurn: index + 1,
    }));
    const state = { ...snap(), temporaryBeliefs: prior };
    const nextStatement = '我意识到我一直在讨好别人第50次';
    const after = applyBeliefFormation(state, nextStatement, ON, 50, 50);
    expect(after.temporaryBeliefs).toHaveLength(40);
    expect(after.temporaryBeliefs.some((belief) => belief.statement === nextStatement)).toBe(true);
  });
});
