// AF-358 · 降级渲染轮回归：同一句来访原话不能被连续多轮重复计分.
//   边界：纯函数，不起 Nest，不连 DB/Redis，不读真实咨询原文.

import { describe, expect, it } from 'vitest';

import { planIntention } from '../../src/engine-core/cognition/intention-planner.js';
import {
  applyBeliefFormation,
  applyBeliefEvolution,
  DEFAULT_BELIEF_OPERATOR_CONFIG,
  type BeliefOperatorConfig,
} from '../../src/engine-core/cognition/state-transition.js';
import { createEmptyBdiSnapshot, type BdiSnapshot } from '../../src/engine-core/domain/bdi-snapshot.js';

const ON: BeliefOperatorConfig = {
  ...DEFAULT_BELIEF_OPERATOR_CONFIG,
  formationEnabled: true,
  formationBaseConfidence: 0.55,
  formationReinforcement: 0.1,
  formationMaxPerTurn: 2,
};

const TEXT = '我意识到我一直在讨好别人';
const EXPANDED = '我意识到我一直在讨好别人，怕被抛弃';

function snap(): BdiSnapshot {
  return {
    ...createEmptyBdiSnapshot(),
    trust: 0.8,
    safety: 0.8,
    bond: 0.7,
    resistance: { verbal: 0.1, depth: 0.1, style: 0.1 },
  };
}

describe('AF-358 · P0-1 降级轮重复读同一句', () => {
  it('连续三轮同一序号 → 只计一次观察，置信度不越门槛', () => {
    let state = snap();
    state = applyBeliefFormation(state, TEXT, ON, 3, 1);
    state = applyBeliefFormation(state, TEXT, ON, 4, 1);
    state = applyBeliefFormation(state, TEXT, ON, 5, 1);

    expect(state.temporaryBeliefs).toHaveLength(1);
    expect(state.temporaryBeliefs[0]?.confidence).toBeCloseTo(0.55, 6);
    expect(state.temporaryBeliefs[0]?.evidenceCount).toBe(1);
    expect(state.temporaryBeliefs[0]?.lastObservedAtVisitorSeq).toBe(1);

    expect(planIntention(state, undefined, undefined, { turnNumber: 8 }).strategy).not.toBe('insight');
  });

  it('序号变大但仍是逐字复读 → 只刷新编号，不提升置信度', () => {
    let state = snap();
    state = applyBeliefFormation(state, TEXT, ON, 3, 1);
    state = applyBeliefFormation(state, TEXT, ON, 4, 2);

    expect(state.temporaryBeliefs[0]?.confidence).toBeCloseTo(0.55, 6);
    expect(state.temporaryBeliefs[0]?.evidenceCount).toBe(1);
    expect(state.temporaryBeliefs[0]?.lastObservedAtVisitorSeq).toBe(2);
  });

  it('同一条被展开（新序号）→ 才提升置信度并可达 insight', () => {
    let state = snap();
    state = applyBeliefFormation(state, TEXT, ON, 3, 1);
    state = applyBeliefFormation(state, EXPANDED, ON, 6, 2);

    expect(state.temporaryBeliefs[0]?.confidence).toBeCloseTo(0.65, 6);
    expect(state.temporaryBeliefs[0]?.evidenceCount).toBe(2);
    expect(planIntention(state, undefined, undefined, { turnNumber: 8 }).strategy).toBe('insight');
  });

  it('走 applyBeliefEvolution 同一口径：同序号不重复计分', () => {
    let state = snap();
    state = applyBeliefEvolution(state, '', ON, { visitorText: TEXT, turnNumber: 3, visitorSeq: 1 });
    state = applyBeliefEvolution(state, '', ON, { visitorText: TEXT, turnNumber: 4, visitorSeq: 1 });

    // 每轮先衰减再生成：第一次生成 0.55；第二次同序号命中逐字复读分支，不提升；
    // 衰减发生在生成之前，所以第二次会按 observed 0.95 衰减到 0.5225.
    expect(state.temporaryBeliefs[0]?.confidence).toBeCloseTo(0.5225, 4);
    expect(state.temporaryBeliefs[0]?.evidenceCount).toBe(1);
  });

  it('不传序号 → 仍按逐字复读处理（语义变更只在复读分支，生成链不受影响）', () => {
    let state = snap();
    state = applyBeliefFormation(state, TEXT, ON, 3);
    state = applyBeliefFormation(state, TEXT, ON, 4);

    expect(state.temporaryBeliefs[0]?.confidence).toBeCloseTo(0.55, 6);
    expect(state.temporaryBeliefs[0]?.evidenceCount).toBe(1);
  });
});
