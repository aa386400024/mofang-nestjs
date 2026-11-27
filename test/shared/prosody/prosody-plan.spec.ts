// AF-459: 韵律计划的确定性 / 强度映射 / 关闭语义.
import { buildProsodyPlan } from '../../../src/shared/prosody/index.js';

describe('AF-459 · prosody plan', () => {
  it('总开关关闭 → off，且配额归零（行为与改前一致）', () => {
    const plan = buildProsodyPlan({ enabled: false, sessionId: 's1', turnIndex: 3, style: 'avoidant', difficulty: 'L3' });
    expect(plan.level).toBe('off');
    expect(plan.limits.maxEventsPerTurn).toBe(0);
  });

  it('回避/防御/抗拒风格 → medium；配合/混合 → light', () => {
    expect(buildProsodyPlan({ enabled: true, sessionId: 's1', turnIndex: 1, style: 'avoidant' }).level).toBe('medium');
    expect(buildProsodyPlan({ enabled: true, sessionId: 's1', turnIndex: 1, style: 'defensive' }).level).toBe('medium');
    expect(buildProsodyPlan({ enabled: true, sessionId: 's1', turnIndex: 1, style: 'resistant' }).level).toBe('medium');
    expect(buildProsodyPlan({ enabled: true, sessionId: 's1', turnIndex: 1, style: 'cooperative' }).level).toBe('light');
    expect(buildProsodyPlan({ enabled: true, sessionId: 's1', turnIndex: 1, style: 'mixed' }).level).toBe('light');
    expect(buildProsodyPlan({ enabled: true, sessionId: 's1', turnIndex: 1 }).level).toBe('light');
  });

  it('L3 只升不降：light → medium；本就是 medium 保持不变', () => {
    expect(buildProsodyPlan({ enabled: true, sessionId: 's1', turnIndex: 1, style: 'mixed', difficulty: 'L3' }).level).toBe('medium');
    expect(buildProsodyPlan({ enabled: true, sessionId: 's1', turnIndex: 1, style: 'avoidant', difficulty: 'L3' }).level).toBe('medium');
  });

  it('AF-565: 思考段按档位收紧，单次不超过 1s', () => {
    const light = buildProsodyPlan({ enabled: true, sessionId: 's1', turnIndex: 1, style: 'cooperative' });
    const medium = buildProsodyPlan({ enabled: true, sessionId: 's1', turnIndex: 1, style: 'avoidant' });
    const l3 = buildProsodyPlan({ enabled: true, sessionId: 's1', turnIndex: 1, style: 'avoidant', difficulty: 'L3' });
    expect(light.limits.thinkingPauseMs).toEqual([350, 650]);
    expect(medium.limits.thinkingPauseMs).toEqual([600, 1000]);
    expect(l3.limits.thinkingPauseMs).toEqual([650, 1000]);
    expect(medium.limits.longSilenceMs).toEqual([2000, 3500]);
    expect(l3.limits.longSilenceMs).toEqual([3000, 5000]);
  });

  it('AF-565: 低情绪基线/高防御只上浮一档，不突破 1s', () => {
    const slow = buildProsodyPlan({
      enabled: true,
      sessionId: 's1',
      turnIndex: 1,
      style: 'avoidant',
      emotionBaseline: 0.18,
    });
    expect(slow.limits.thinkingPauseMs).toEqual([700, 1000]);
    expect(slow.limits.longSilenceMs).toEqual([2500, 4000]);
  });

  it('同一会话同一轮 → 计划逐字相同（重放不会漂移）', () => {
    const first = buildProsodyPlan({ enabled: true, sessionId: 'abc', turnIndex: 7, style: 'avoidant' });
    const second = buildProsodyPlan({ enabled: true, sessionId: 'abc', turnIndex: 7, style: 'avoidant' });
    expect(second).toEqual(first);
    expect(first.seed).toBe('abc#7');
  });
});
