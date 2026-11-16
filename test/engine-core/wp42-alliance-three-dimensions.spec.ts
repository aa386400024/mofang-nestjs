// V2026-11-03 WP42 (引擎内核 · 咨询同盟三维 · 单测):
//   目的: 把任务单 §5 的验收条目从"人工核对"变成**机器断言** ——
//         ① 同一事件, safety 与 bond 各自独立变化, 互不干扰;
//         ② 回归: 新字段默认值不破坏既有 trust 行为;
//         ③ 边界: safety 很低但 trust 很高时, 不进探索模式;
//         ④ 系数与门槛走**端口注入** (内核零 env);
//         ⑤ safety / bond 有独立的单回合 cap;
//         ⑥ 会话层落库路径与内核路径口径一致.
//
//   边界: 纯函数 / 内存实现, 不起 Nest 容器, 不碰网络.
//
//   验证: npx vitest run test/engine-core/wp42-alliance-three-dimensions.spec.ts
//   时间戳: 2026-11-03 GMT+8

import { DEFAULT_ALLIANCE_CONFIG } from '../../src/engine-core/cognition/alliance-config.js';
import { planIntention } from '../../src/engine-core/cognition/intention-planner.js';
import {
  aggregateTurnDelta,
  capTurnDelta,
  transitionState,
  DEFAULT_DELTA_CAP_CONFIG,
  type DeltaVector,
} from '../../src/engine-core/cognition/state-transition.js';
import { cloneBdiSnapshot, createEmptyBdiSnapshot, type BdiSnapshot } from '../../src/engine-core/domain/bdi-snapshot.js';
import { DEFAULT_BOND, DEFAULT_SAFETY, DEFAULT_TRUST } from '../../src/engine-core/domain/bootstrap.js';
import type { SessionEvent } from '../../src/engine-core/domain/events/session-event.js';
import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository.js';
import { InMemoryEngineSession } from '../../src/engine-core/in-memory/in-memory-engine-session.js';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store.js';

/** 一条"咨询师表达共情"事件. */
const EMPATHY: SessionEvent = { kind: 'empathy', matchedTerms: ['我能理解你'], strength: 1 };
/** 一条"咨询师评判"事件 (受损方向). */
const JUDGMENT: SessionEvent = { kind: 'judgment', matchedTerms: ['你就是太敏感了'], strength: 1 };
/** 一条"咨询师开放探问"事件. */
const OPEN_PROBE: SessionEvent = { kind: 'open_probe', matchedTerms: ['那是什么时候开始的'], strength: 1 };
/** 一条"咨询师越界"事件. */
const BOUNDARY_CROSS: SessionEvent = { kind: 'boundary_cross', matchedTerms: ['我也经历过类似的事'], strength: 1 };

/** 咨询师说共情的那句话 (规则轨会把它分类成 empathy). */
const EMPATHY_TEXT = '听起来你现在一定很难受, 我能理解你';

/** 低阻抗的快照基线 (排除"话量阻抗高"与"整体防御强"两个分支). */
const OPEN_READY_RESISTANCE = { verbal: 0.1, depth: 0.2, style: 0.2 };

/** 造一份快照 (默认走中性基线, 可逐维覆盖). */
function snap(overrides: Partial<BdiSnapshot> = {}): BdiSnapshot {
  return { ...createEmptyBdiSnapshot(), ...overrides };
}

describe('WP42 · 咨询同盟三维 (trust / safety / bond)', () => {
  describe('验收 #1: 同一事件, safety 与 bond 各自独立变化, 互不干扰', () => {
    it('empathy: trust +0.10 / safety +0.02 / bond +0.01 (三维各走各的系数)', () => {
      const delta = aggregateTurnDelta([EMPATHY]);

      expect(delta.trust).toBeCloseTo(0.1, 10);
      expect(delta.safety).toBeCloseTo(0.02, 10);
      expect(delta.bond).toBeCloseTo(0.01, 10);
      // 三个值互不相同 —— 这正是"三维独立建模"的意义 (旧模型只有一个 trust).
      expect(new Set([delta.trust, delta.safety, delta.bond].map((v) => v.toFixed(8))).size).toBe(3);
    });

    it('open_probe: 涨安全感但不涨纽带 (WP42 §3.3 表)', () => {
      const delta = aggregateTurnDelta([OPEN_PROBE]);

      expect(delta.trust).toBeCloseTo(0.05, 10);
      expect(delta.safety).toBeCloseTo(0.01, 10);
      expect(delta.bond).toBe(0);
    });

    it('judgment: 安全感掉得比信任快 (先不敢说话, 才是关系真正受损)', () => {
      const delta = aggregateTurnDelta([JUDGMENT]);

      expect(delta.trust).toBeCloseTo(-0.12, 10);
      expect(delta.safety).toBeCloseTo(-0.03, 10);
      expect(delta.bond).toBeCloseTo(-0.02, 10);
      expect(Math.abs(delta.safety)).toBeGreaterThan(0);
      expect(Math.abs(delta.trust)).toBeGreaterThan(Math.abs(delta.safety));
    });

    it('boundary_cross: 三维一起掉, 安全感掉最狠 (被侵犯的人最先不敢说话)', () => {
      const delta = aggregateTurnDelta([BOUNDARY_CROSS]);

      expect(delta.trust).toBeCloseTo(-0.15, 10);
      expect(delta.safety).toBeCloseTo(-0.05, 10);
      expect(delta.bond).toBeCloseTo(-0.04, 10);
      expect(Math.abs(delta.safety)).toBeGreaterThan(Math.abs(delta.bond));
    });

    it('三维互不干扰: 覆写 safety 不改 bond 与 trust', () => {
      const base = aggregateTurnDelta([EMPATHY]);
      const overridden = aggregateTurnDelta([EMPATHY], {
        deltas: { empathy: { safety: 0.05 } },
        thresholds: DEFAULT_ALLIANCE_CONFIG.thresholds,
      });

      expect(overridden.safety).toBeCloseTo(0.05, 10);
      expect(overridden.bond).toBeCloseTo(base.bond, 10);
      expect(overridden.trust).toBeCloseTo(base.trust, 10);
    });
  });

  describe('验收 #2: 回归 —— 新字段不破坏既有 trust 行为', () => {
    it('空快照的初始基线: trust 0.3 / safety 0.5 / bond 0', () => {
      const empty = createEmptyBdiSnapshot();

      expect(empty.trust).toBe(DEFAULT_TRUST);
      expect(empty.safety).toBe(DEFAULT_SAFETY);
      expect(empty.bond).toBe(DEFAULT_BOND);
    });

    it('trust 的迁移路径逐字不变 (empathy: 0.3 → 0.40)', () => {
      const out = transitionState(createEmptyBdiSnapshot(), [EMPATHY]);

      expect(out.trust).toBeCloseTo(0.4, 10);
      // 同一事件里 safety / bond 也各自推进 (新维度, 不影响 trust).
      expect(out.safety).toBeCloseTo(0.52, 10);
      expect(out.bond).toBeCloseTo(0.01, 10);
    });

    it('cloneBdiSnapshot 把两个新字段一起带走', () => {
      const base = snap({ trust: 0.4, safety: 0.62, bond: 0.13 });
      const cloned = cloneBdiSnapshot(base);

      expect(cloned.safety).toBe(0.62);
      expect(cloned.bond).toBe(0.13);
    });

    it('会话落库快照带得上 safety / bond (不丢字段)', async () => {
      const now = (): number => 1_700_000_000_000;
      const session = new InMemoryEngineSession({
        bdiStates: new InMemoryBdiStateRepository(),
        memories: new InMemoryMemoryStore({ now }),
        idFactory: () => 'wp42-id',
        now,
      });
      const handle = session.openSession({ sessionId: 's1', tenantId: 'default', visitorId: 'v1' });

      const out = await session.turn(handle.handleId, { userText: EMPATHY_TEXT });

      expect(out.snapshot.safety).toBeCloseTo(0.52, 10);
      expect(out.snapshot.bond).toBeCloseTo(0.01, 10);
    });
  });

  describe('验收 #3: 边界 —— trust 高但 safety 低时, 不进探索模式', () => {
    it('trust 0.8 / safety 0.2 → 不进探索 (相信你专业 ≠ 敢说真话)', () => {
      const intention = planIntention(snap({ trust: 0.8, safety: 0.2, resistance: OPEN_READY_RESISTANCE }));

      expect(intention.strategy).not.toBe('cognitive_exploration');
      expect(intention.strategy).not.toBe('affective_exploration');
      expect(intention.strategy).toBe('recounting');
    });

    it('trust 0.8 / safety 0.7 → 进探索 (三维都够)', () => {
      const intention = planIntention(snap({ trust: 0.8, safety: 0.7, resistance: OPEN_READY_RESISTANCE }));

      expect(intention.strategy).toBe('cognitive_exploration');
    });

    it('trust 0.3 / safety 0.5 → 也不进探索 (信任不够)', () => {
      const intention = planIntention(snap({ trust: 0.3, safety: 0.5, resistance: OPEN_READY_RESISTANCE }));

      expect(intention.strategy).toBe('recounting');
    });

    it('整体防御强 + safety 塌到低位 → 抗拒 (三维化后新增的触发路径)', () => {
      const intention = planIntention(snap({ trust: 0.8, safety: 0.2, resistance: { verbal: 0.8, depth: 0.8, style: 0.8 } }));

      expect(intention.strategy).toBe('resistance');
    });

    it('整体防御强 + trust 低 → 仍是抗拒 (旧行为逐字保留)', () => {
      const intention = planIntention(snap({ trust: 0.3, safety: 0.5, resistance: { verbal: 0.8, depth: 0.8, style: 0.8 } }));

      expect(intention.strategy).toBe('resistance');
    });

    it('整体防御不强时, safety 再低也不进抗拒 (保留阻抗聚合前提)', () => {
      const intention = planIntention(snap({ trust: 0.2, safety: 0.1, resistance: OPEN_READY_RESISTANCE }));

      expect(intention.strategy).toBe('recounting');
    });
  });

  describe('端口注入: 系数与门槛走 AllianceConfig (内核零 env)', () => {
    it('门槛走注入: 放宽 open 门槛后, safety 偏低也能进探索', () => {
      const intention = planIntention(snap({ trust: 0.8, safety: 0.25, resistance: OPEN_READY_RESISTANCE }), undefined, {
        deltas: {},
        thresholds: { open: 0.2, resistanceTrust: 0.4, resistanceSafety: 0.3 },
      });

      expect(intention.strategy).toBe('cognitive_exploration');
    });

    it('门槛走注入: 收紧 resistanceSafety 门槛后, safety 中等也进抗拒', () => {
      const intention = planIntention(snap({ trust: 0.8, safety: 0.5, resistance: { verbal: 0.8, depth: 0.8, style: 0.8 } }), undefined, {
        deltas: {},
        thresholds: { open: 0.6, resistanceTrust: 0.4, resistanceSafety: 0.6 },
      });

      expect(intention.strategy).toBe('resistance');
    });

    it('非法门槛回退内核种子值 (不越界 / 不 NaN)', () => {
      const intention = planIntention(snap({ trust: 0.8, safety: 0.25, resistance: OPEN_READY_RESISTANCE }), undefined, {
        deltas: {},
        thresholds: { open: Number.NaN, resistanceTrust: 5, resistanceSafety: -1 },
      });

      // 种子 open = 0.6 → min(0.8, 0.25) = 0.25 仍不够 → 不进探索 (非法值没生效).
      expect(intention.strategy).toBe('recounting');
    });

    it('缺省端口 = 内核种子门槛 (逐字不变)', () => {
      const withSeed = planIntention(
        snap({ trust: 0.8, safety: 0.7, resistance: OPEN_READY_RESISTANCE }),
        undefined,
        DEFAULT_ALLIANCE_CONFIG,
      );
      const withoutPort = planIntention(snap({ trust: 0.8, safety: 0.7, resistance: OPEN_READY_RESISTANCE }));

      expect(withSeed.strategy).toBe(withoutPort.strategy);
      expect(withSeed.rationale).toBe(withoutPort.rationale);
    });
  });

  describe('cap: safety / bond 有独立的单回合上下界', () => {
    const big = 9;

    it('上向: safety / bond 与 trust 同档 (+0.20)', () => {
      const raw: DeltaVector = {
        trust: big,
        safety: big,
        bond: big,
        verbal: 0,
        depth: 0,
        style: 0,
        valence: 0,
        arousal: 0,
        positive: 0,
        negative: 0,
        dependency: 0,
      };
      const capped = capTurnDelta(raw);

      expect(capped.safety).toBeCloseTo(0.2, 10);
      expect(capped.bond).toBeCloseTo(0.2, 10);
    });

    it('下向: safety / bond 与 trust 同档 (-0.30, 损失厌恶)', () => {
      const raw: DeltaVector = {
        trust: -big,
        safety: -big,
        bond: -big,
        verbal: 0,
        depth: 0,
        style: 0,
        valence: 0,
        arousal: 0,
        positive: 0,
        negative: 0,
        dependency: 0,
      };
      const capped = capTurnDelta(raw);

      expect(capped.safety).toBeCloseTo(-0.3, 10);
      expect(capped.bond).toBeCloseTo(-0.3, 10);
    });

    it('cap 配置走注入: 收紧 safety 上向 → 真的按配置砍', () => {
      const raw: DeltaVector = {
        trust: 0,
        safety: 0.15,
        bond: 0,
        verbal: 0,
        depth: 0,
        style: 0,
        valence: 0,
        arousal: 0,
        positive: 0,
        negative: 0,
        dependency: 0,
      };
      const capped = capTurnDelta(raw, {
        ...DEFAULT_DELTA_CAP_CONFIG,
        safety: { up: 0.05, down: -0.3 },
      });

      expect(capped.safety).toBeCloseTo(0.05, 10);
    });
  });

  describe('会话层: 落库路径与内核路径口径一致', () => {
    it('注入同盟端口后, 落库快照与内核 transitionState 逐字一致', async () => {
      const now = (): number => 1_700_000_000_000;
      const alliance = {
        deltas: { empathy: { safety: 0.05 } },
        thresholds: DEFAULT_ALLIANCE_CONFIG.thresholds,
      };
      const session = new InMemoryEngineSession({
        bdiStates: new InMemoryBdiStateRepository(),
        memories: new InMemoryMemoryStore({ now }),
        idFactory: () => 'wp42-id',
        now,
        allianceConfig: alliance,
      });
      const handle = session.openSession({ sessionId: 's1', tenantId: 'default', visitorId: 'v1' });

      const out = await session.turn(handle.handleId, { userText: EMPATHY_TEXT });

      const expected = transitionState(createEmptyBdiSnapshot(), [EMPATHY], { alliance });
      expect(out.snapshot.safety).toBeCloseTo(expected.safety, 10);
      expect(out.snapshot.bond).toBeCloseTo(expected.bond, 10);
      expect(out.snapshot.trust).toBeCloseTo(expected.trust, 10);
    });
  });
});
