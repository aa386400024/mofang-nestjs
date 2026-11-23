// AF-354 · BDI 决策链工程闭环 (core spec):
//   覆盖开工单 successCriteria 中**纯层可证**的部分:
//     ① 决策阈值端口化后, 缺省值逐字等于改造前局部常量;
//     ② 端口值真的改变判定 (controlPlanGate 放宽 → discussing_plans 可达);
//     ③ 非法阈值逐项回退种子值 (不是照着越界值判);
//     ④ evolveDesires.changed 按真实差异返回（无变化 → false 且引用不漂）;
//     ⑤ 跨会话接续: 清掉上一场意图锁 + 停用活跃情境愿望, 底层愿望 / 信念不动.
//   边界: 纯函数 + 内存仓储; 不起 Nest 容器, 不连 DB/Redis, 不读任何对话原文.
//
//   验证: pnpm exec vitest run test/engine-core/af354-bdi-engineering-closure.spec.ts

import { describe, expect, it } from 'vitest';

import { resolveAllianceThresholds } from '../../src/engine-core/cognition/alliance-config.js';
import { planIntention } from '../../src/engine-core/cognition/intention-planner.js';
import { createEmptyBdiSnapshot, type BdiSnapshot } from '../../src/engine-core/domain/bdi-snapshot.js';
import {
  DEFAULT_DESIRE_EVOLUTION_CONFIG,
  DEFAULT_UNDERLYING_DESIRES,
  evolveDesires,
  type DesireEvolutionConfig,
} from '../../src/engine-core/domain/desires.js';
import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository.js';
import { InMemoryEngineSession } from '../../src/engine-core/in-memory/in-memory-engine-session.js';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store.js';

/** 造快照（默认中性基线，逐维覆盖）. */
function snap(overrides: Partial<BdiSnapshot> = {}): BdiSnapshot {
  return { ...createEmptyBdiSnapshot(), ...overrides };
}

/** 中性文本 → 零 delta（会话层断言只反映接续清理）. */
const NEUTRAL_TEXT = '今天天气不错';

describe('AF-354 · ① 决策阈值缺省逐字不变', () => {
  it('解析结果的 12 个决策阈值等于改造前局部常量', () => {
    const thresholds = resolveAllianceThresholds();
    expect(thresholds.highResistanceAgg).toBe(0.6);
    expect(thresholds.highVerbal).toBe(0.55);
    expect(thresholds.negativeDominantFloor).toBe(0.3);
    expect(thresholds.negativeDominantMargin).toBe(0.1);
    expect(thresholds.dependencyHigh).toBe(0.4);
    expect(thresholds.avoidanceMargin).toBe(0.1);
    expect(thresholds.explorationUnderstoodGate).toBe(0.65);
    expect(thresholds.explorationAcceptedGate).toBe(0.55);
    expect(thresholds.explorationGateRelief).toBe(0.03);
    expect(thresholds.situationalRequestPriority).toBe(0.7);
    expect(thresholds.controlPlanGate).toBe(0.55);
    expect(thresholds.reflectiveBeliefGate).toBe(0.6);
  });

  it('不注入配置时 discussing_plans 仍按 0.55 判 —— 缺省基线 control(0.45) 进不去', () => {
    const intention = planIntention(snap({ trust: 0.8, safety: 0.8 }), undefined, undefined, { turnNumber: 20 });
    expect(intention.strategy).not.toBe('discussing_plans');
  });
});

describe('AF-354 · ② 端口值真的改变判定', () => {
  it('放宽 controlPlanGate 0.55 → 0.4 且 planMinTurn 提前 → discussing_plans 可达', () => {
    const loosened = {
      deltas: {},
      thresholds: { open: 0.6, resistanceTrust: 0.4, resistanceSafety: 0.3, planMinTurn: 5, controlPlanGate: 0.4 },
    };
    const intention = planIntention(
      snap({ trust: 0.8, safety: 0.8, bond: 0.7, resistance: { verbal: 0.1, depth: 0.1, style: 0.1 } }),
      undefined,
      loosened,
      { turnNumber: 20 },
    );
    expect(intention.strategy).toBe('discussing_plans');
  });

  it('收紧 highVerbal 0.55 → 0.2 → 话量阻抗先触发 simple_response', () => {
    const tightened = {
      deltas: {},
      thresholds: { open: 0.6, resistanceTrust: 0.4, resistanceSafety: 0.3, highVerbal: 0.2 },
    };
    const intention = planIntention(
      snap({ trust: 0.8, safety: 0.8, resistance: { verbal: 0.3, depth: 0.1, style: 0.1 } }),
      undefined,
      tightened,
      { turnNumber: 3 },
    );
    expect(intention.strategy).toBe('simple_response');
  });
});

describe('AF-354 · ③ 非法阈值逐项回退', () => {
  it('NaN / Infinity / 越界一律回退种子值', () => {
    const resolved = resolveAllianceThresholds({
      deltas: {},
      thresholds: {
        open: 0.6,
        resistanceTrust: 0.4,
        resistanceSafety: 0.3,
        controlPlanGate: Number.NaN,
        highVerbal: Number.POSITIVE_INFINITY,
        explorationGateRelief: -0.5,
        reflectiveBeliefGate: 2,
      },
    });
    expect(resolved.controlPlanGate).toBe(0.55);
    expect(resolved.highVerbal).toBe(0.55);
    expect(resolved.explorationGateRelief).toBe(0.03);
    expect(resolved.reflectiveBeliefGate).toBe(0.6);
  });

  it('合法边界值 0 / 1 原样保留', () => {
    const resolved = resolveAllianceThresholds({
      deltas: {},
      thresholds: { open: 0.6, resistanceTrust: 0.4, resistanceSafety: 0.3, controlPlanGate: 0, highVerbal: 1 },
    });
    expect(resolved.controlPlanGate).toBe(0);
    expect(resolved.highVerbal).toBe(1);
  });
});

describe('AF-354 · ④ evolveDesires.changed 按真实差异返回', () => {
  const enabled: DesireEvolutionConfig = { ...DEFAULT_DESIRE_EVOLUTION_CONFIG, enabled: true };

  it('开启但斜率与回拉都为 0 → 本轮零变化: changed=false, 且返回入参引用（引用不漂）', () => {
    const noop: DesireEvolutionConfig = {
      ...DEFAULT_DESIRE_EVOLUTION_CONFIG,
      enabled: true,
      maxUnderlyingDeltaPerTurn: 0,
      baselinePullPerTurn: 0,
    };
    const input = {
      underlyingDesires: DEFAULT_UNDERLYING_DESIRES,
      situationalDesires: [],
      eventKinds: [] as const,
      resistance: { verbal: 0.1, depth: 0.1, style: 0.1 },
      safety: 0.8,
      bond: 0.8,
      turnNumber: 1,
    };
    const result = evolveDesires(input, noop);
    expect(result.changed).toBe(false);
    expect(result.underlyingDesires).toBe(input.underlyingDesires);
    expect(result.situationalDesires).toBe(input.situationalDesires);
  });

  it('开启且本轮有正向事件 → changed=true 且权重真的变化', () => {
    const input = {
      underlyingDesires: DEFAULT_UNDERLYING_DESIRES,
      situationalDesires: [],
      eventKinds: ['empathy'] as const,
      resistance: { verbal: 0.1, depth: 0.1, style: 0.1 },
      safety: 0.8,
      bond: 0.8,
      turnNumber: 1,
    };
    const result = evolveDesires(input, enabled);
    expect(result.changed).toBe(true);
    expect(result.underlyingDesires).not.toBe(input.underlyingDesires);
  });

  it('关闭时 changed=false 且原样返回（零回归）', () => {
    const input = {
      underlyingDesires: DEFAULT_UNDERLYING_DESIRES,
      situationalDesires: [],
      eventKinds: ['empathy'] as const,
      resistance: { verbal: 0.1, depth: 0.1, style: 0.1 },
      safety: 0.8,
      bond: 0.8,
      turnNumber: 1,
    };
    const result = evolveDesires(input, DEFAULT_DESIRE_EVOLUTION_CONFIG);
    expect(result.changed).toBe(false);
    expect(result.underlyingDesires).toBe(input.underlyingDesires);
  });
});
describe('AF-354 · ⑤ 跨会话接续清理瞬时状态', () => {
  /** 会话测试台：内存仓储 + 固定时钟. */
  function createHarness(): { readonly bdiStates: InMemoryBdiStateRepository; readonly session: InMemoryEngineSession } {
    const bdiStates = new InMemoryBdiStateRepository();
    const now = (): number => 1_700_000_000_000;
    const memories = new InMemoryMemoryStore({ now });
    let seq = 0;
    const session = new InMemoryEngineSession({
      bdiStates,
      memories,
      idFactory: () => {
        seq += 1;
        return `af354-id-${seq}`;
      },
      now,
    });
    return { bdiStates, session };
  }

  it('接续后: 意图锁清空 + 活跃情境愿望停用; 底层愿望逐字保留', async () => {
    const { bdiStates, session } = createHarness();
    const previous = snap({
      situationalDesires: [
        { id: 'sd-active', text: '想被理解', priority: 0.8, active: true },
        { id: 'sd-idle', text: '想休息', priority: 0.2, active: false },
      ],
      intentionLock: { strategy: 'cognitive_exploration', lockedAtTurn: 3, expiresAtTurn: 5, reason: 'continuity' },
    });

    await bdiStates.save({
      tenantId: 'default',
      sessionId: 'prev',
      revision: 1,
      updatedAt: 1_700_000_000_000,
      snapshot: previous,
    });

    const handle = session.openSession({
      sessionId: 'next',
      tenantId: 'default',
      visitorId: 'v1',
      resumeFromSessionId: 'prev',
    });
    const out = await session.turn(handle.handleId, { userText: NEUTRAL_TEXT });

    // 瞬时状态：锁没了；活跃愿望被停用；本来就停用的保持停用.
    expect(out.snapshot.intentionLock ?? null).toBeNull();
    expect(out.snapshot.situationalDesires.map((desire) => desire.active)).toEqual([false, false]);
    // 底层愿望是跨场稳定结构：不清.
    expect(out.snapshot.underlyingDesires).toEqual(previous.underlyingDesires);
    // 轮次从本场重新计数（不是接着上一场的 3）.
    expect(out.turnIndex).toBe(1);
  });

  it('接续来源没有瞬时状态时，清理函数不改任何维度（零回归）', async () => {
    const { bdiStates, session } = createHarness();
    const previous = snap({
      situationalDesires: [],
      intentionLock: null,
      trust: 0.8,
      safety: 0.7,
    });

    await bdiStates.save({
      tenantId: 'default',
      sessionId: 'prev',
      revision: 1,
      updatedAt: 1_700_000_000_000,
      snapshot: previous,
    });

    const handle = session.openSession({
      sessionId: 'next',
      tenantId: 'default',
      visitorId: 'v1',
      resumeFromSessionId: 'prev',
    });
    const out = await session.turn(handle.handleId, { userText: NEUTRAL_TEXT });

    expect(out.snapshot.underlyingDesires).toEqual(previous.underlyingDesires);
    expect(out.snapshot.situationalDesires).toEqual([]);
    // 零间隔接续：同盟不衰减，与 WP36 旧行为逐字一致.
    expect(out.snapshot.trust).toBeCloseTo(0.8, 10);
    expect(out.snapshot.safety).toBeCloseTo(0.7, 10);
  });
});
