// V2026-10-28 治本 (WP3 · 引擎内核 · 轨迹控制单测):
//   覆盖任务单 §8 单测清单 1-14:
//     1. 强覆盖替换 (字段替换 + forbiddenBehaviors 并集去重)
//     2. 强覆盖缺省回退
//     3. 修正加权 (w=0.6 混合 + clamp + 越界权重夹取)
//     4. 触发未命中透传
//     5. 触发命中激活 (强覆盖语义 + 进入新幕叠 delta)
//     6. 原子条件 (事件 / 关键词 / 轮次 / 快照谓词 / AND 组合)
//     7. force 游标步进 (满足→推进并叠 delta; 不满足→等待, 持续施加但不叠)
//     8. 不跳幕 (order < cursor 不再激活; 游标只增不减)
//     9. 一次性 delta (同一幕不叠两次; 等待轮 / 终态轮无额外 delta)
//    10. abort 优先于 completion
//    11. 完成判定 (outcome 只写一次; 未命中省略; 不自动 close)
//    12. 无剧本零回归 (与 WP1 路径逐字一致, 出参无 trajectoryTrace)
//    13. 非法剧本 → INVALID_INPUT
//    14. 同轮多幕命中只取升序首个
//    15. 剧本偏移接入同盟三维 (WP52): safety / bond 写入 / 合并后统一过 cap /
//        缺省零回归 / 等待轮不叠
//   外加: 同剧本 + 同行为序列复跑一致 (任务单 §9 可复现验收).
//
//   反依赖污染:
//     本文件**不 import 任何 @nestjs/* / typeorm / qdrant** —— 它是内核边界的一部分.
//     深路径 import (cognition/* / in-memory/*) 是为了直接 new 内存实现, 与既有
//     WP0/WP1/WP2 测试同款做法.
//
//   验证: npx jest test/engine-core/wp3-trajectory.spec.ts
//   时间戳: 2026-10-28 GMT+8

import { planIntention } from '../../src/engine-core/cognition/intention-planner.js';
import { RuleBasedClassifier } from '../../src/engine-core/cognition/rule-based-classifier.js';
import { transitionState } from '../../src/engine-core/cognition/state-transition.js';
import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository.js';
import { InMemoryEngineSession } from '../../src/engine-core/in-memory/in-memory-engine-session.js';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store.js';
import {
  DEFAULT_CORRECT_WEIGHT,
  EngineErrorCode,
  MIN_CORRECT_WEIGHT,
  addDeltaVectors,
  aggregateTurnDelta,
  applyTrajectory,
  capTurnDelta,
  createEmptyBdiSnapshot,
  evaluateTrigger,
  planAct,
  resolveCorrectWeight,
  type ActPlan,
  type BdiSnapshot,
  type EngineTurnOutput,
  type Intention,
  type MatchContext,
  type SessionEvent,
  type TrajectoryNode,
  type TrajectoryScript,
} from '../../src/engine-core/index.js';

const TENANT = 'default';
const VISITOR = 'visitor-1';

/** 中性基线快照 (bootstrap 默认: trust 0.3 / 阻抗 0.4,0.4,0.35 / 情绪 neutral 0,0.3 / 移情全零). */
function baseSnapshot(overrides: Partial<BdiSnapshot> = {}): BdiSnapshot {
  return { ...createEmptyBdiSnapshot(), ...overrides };
}

/** BDI 自由规划出的意图 (纯函数测试的输入基线). */
function bdiIntention(overrides: Partial<Intention> = {}): Intention {
  return {
    strategy: 'recounting',
    emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
    resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
    transference: { positive: 0, negative: 0, dependency: 0 },
    forbiddenBehaviors: ['judge'],
    rationale: 'BDI 依据',
    ...overrides,
  };
}

/** 本轮匹配上下文. */
function matchContext(overrides: Partial<MatchContext> = {}): MatchContext {
  return { events: [], userText: '', turnIndex: 1, snapshot: baseSnapshot(), ...overrides };
}

/** 造一条标准会话事件. */
function event(kind: SessionEvent['kind']): SessionEvent {
  return { kind, matchedTerms: [], strength: 1 };
}

/** 造一幕 (trigger 缺省为空 = 无约束). */
function trajectoryNode(nodeId: string, overrides: Partial<TrajectoryNode> = {}): TrajectoryNode {
  return { nodeId, trigger: {}, ...overrides };
}

/** 造一份剧本 (completion 缺省永不命中, 便于把单测聚焦在一件事上). */
function trajectoryScript(overrides: Partial<TrajectoryScript> = {}): TrajectoryScript {
  return {
    scriptId: 'script-1',
    title: '测试剧本',
    mode: 'force_override',
    difficulty: 1,
    goal: '走完幕序列',
    nodes: [],
    completion: { when: { afterTurns: 999 }, outcome: 'completed' },
    ...overrides,
  };
}

/** 造一份 ActPlan (直接喂给 applyTrajectory, 不经推进器). */
function actPlan(node: TrajectoryNode | null, enterNewAct: boolean, nextCursor = 0): ActPlan {
  return { node, enterNewAct, nextCursor, aborted: false };
}

// ── 测试台 ──────────────────────────────────────────────────────────

/** 测试台: 内存实现 + 确定性 id / **共享**时钟. */
interface Harness {
  readonly session: InMemoryEngineSession;
  readonly memories: InMemoryMemoryStore;
  readonly currentTime: () => number;
}

function createHarness(): Harness {
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
      return `wp3-id-${idSeq}`;
    },
    now,
  });
  return { session, memories, currentTime: now };
}

/**
 * 跑一轮或多轮对话 (可注入剧本).
 *
 * 同输入 + 同种子 → 同结果 (确定性), 因此"有剧本"与"无剧本"两条路径的快照可以直接对比.
 */
async function runTurns(
  script: TrajectoryScript | undefined,
  texts: readonly string[],
): Promise<{ readonly outputs: EngineTurnOutput[]; readonly harness: Harness }> {
  const harness = createHarness();
  const handle = harness.session.openSession({
    sessionId: 'session-1',
    tenantId: TENANT,
    visitorId: VISITOR,
    seed: 7,
    ...(script ? { trajectory: script } : {}),
  });
  const outputs: EngineTurnOutput[] = [];
  for (const text of texts) {
    outputs.push(await harness.session.turn(handle.handleId, { userText: text }));
  }
  return { outputs, harness };
}

/** 无脚本命中的中性文本 (事件分类落 neutral, BDI 侧 delta = 0). */
const NEUTRAL_TEXT = '今天天气不错';

describe('WP3 · 轨迹控制引擎', () => {
  describe('① 强覆盖合成', () => {
    it('幕 target 的字段替换 BDI, forbiddenBehaviors 取并集去重', () => {
      const plan = actPlan(
        trajectoryNode('n1', {
          target: {
            strategy: 'resistance',
            emotion: { valence: -0.6, arousal: 0.7 },
            resistance: { verbal: 0.9 },
            transference: { negative: 0.5 },
            forbiddenBehaviors: ['press', 'judge'],
          },
        }),
        true,
      );

      const result = applyTrajectory('force_override', bdiIntention(), baseSnapshot(), plan);

      expect(result.activated).toBe(true);
      expect(result.intention.strategy).toBe('resistance');
      expect(result.intention.emotion.valence).toBe(-0.6);
      expect(result.intention.emotion.arousal).toBe(0.7);
      // 只给双轴未给 label → label 由双轴重算 (valence<=-0.5 且 arousal>=0.65 → angry).
      expect(result.intention.emotion.label).toBe('angry');
      expect(result.intention.resistance).toEqual({ verbal: 0.9, depth: 0.4, style: 0.35 });
      expect(result.intention.transference).toEqual({ positive: 0, negative: 0.5, dependency: 0 });
      expect(result.intention.forbiddenBehaviors).toEqual(['judge', 'press']);
    });

    it('显式给的 emotion.label 沿用 (不重算)', () => {
      const plan = actPlan(trajectoryNode('n1', { target: { emotion: { label: 'hopeful', valence: -0.6, arousal: 0.7 } } }), true);
      const result = applyTrajectory('force_override', bdiIntention(), baseSnapshot(), plan);
      expect(result.intention.emotion.label).toBe('hopeful');
    });
  });

  describe('② 强覆盖缺省回退', () => {
    it('幕只给部分字段, 未给字段保留 BDI', () => {
      const plan = actPlan(trajectoryNode('n1', { target: { strategy: 'insight' } }), true);
      const result = applyTrajectory('force_override', bdiIntention(), baseSnapshot(), plan);

      expect(result.intention.strategy).toBe('insight');
      expect(result.intention.emotion).toEqual({ label: 'neutral', valence: 0, arousal: 0.3 });
      expect(result.intention.resistance).toEqual({ verbal: 0.4, depth: 0.4, style: 0.35 });
      expect(result.intention.transference).toEqual({ positive: 0, negative: 0, dependency: 0 });
      expect(result.intention.forbiddenBehaviors).toEqual(['judge']);
    });

    it('幕无 target 时意图完全等于 BDI (只有 rationale 追加轨迹来源)', () => {
      const plan = actPlan(trajectoryNode('n1'), true);
      const bdi = bdiIntention();
      const result = applyTrajectory('force_override', bdi, baseSnapshot(), plan);
      expect(result.intention.strategy).toBe(bdi.strategy);
      expect(result.intention.emotion).toEqual(bdi.emotion);
      expect(result.intention.rationale).toContain('轨迹:force_override/n1');
    });
  });

  describe('③ 修正加权合成', () => {
    it('w=0.6 时数值字段 = 0.6*target + 0.4*bdi', () => {
      const plan = actPlan(
        trajectoryNode('n1', {
          target: {
            strategy: 'simple_response',
            emotion: { valence: -0.5, arousal: 0.9 },
            resistance: { verbal: 0.8 },
            transference: { positive: 0.6 },
          },
        }),
        true,
      );

      const result = applyTrajectory('weighted_correct', bdiIntention(), baseSnapshot(), plan);

      expect(result.intention.strategy).toBe('simple_response');
      expect(result.intention.resistance.verbal).toBeCloseTo(0.6 * 0.8 + 0.4 * 0.4, 10);
      expect(result.intention.emotion.valence).toBeCloseTo(0.6 * -0.5 + 0.4 * 0, 10);
      expect(result.intention.emotion.arousal).toBeCloseTo(0.6 * 0.9 + 0.4 * 0.3, 10);
      expect(result.intention.transference.positive).toBeCloseTo(0.6 * 0.6 + 0.4 * 0, 10);
      // 未给 target 的数值字段保留 BDI 原值.
      expect(result.intention.resistance.depth).toBe(0.4);
      expect(result.intention.transference.negative).toBe(0);
    });

    it('strategy 缺省回退 BDI (不做策略概率混合)', () => {
      const plan = actPlan(trajectoryNode('n1', { target: { resistance: { verbal: 0.9 } } }), true);
      const result = applyTrajectory('weighted_correct', bdiIntention(), baseSnapshot(), plan);
      expect(result.intention.strategy).toBe('recounting');
    });

    it('混合结果越界被 clamp, NaN 落回边界不写进快照', () => {
      // target 越界 (valence 2 / verbal 1.5) → 混合后越界 → clamp 回契约区间.
      const overflow = actPlan(trajectoryNode('n1', { target: { emotion: { valence: 2 }, resistance: { verbal: 1.5 } } }), true);
      const clamped = applyTrajectory('weighted_correct', bdiIntention(), baseSnapshot(), overflow);
      expect(clamped.intention.emotion.valence).toBe(1);
      expect(clamped.intention.resistance.verbal).toBe(1);

      const dirty = actPlan(trajectoryNode('n2', { target: { emotion: { valence: Number.NaN } } }), true);
      const fallback = applyTrajectory('weighted_correct', bdiIntention(), baseSnapshot(), dirty);
      expect(fallback.intention.emotion.valence).toBe(0);
    });

    it('correctWeight 越界被夹到 (0,1], 缺省 0.6, NaN 回落默认', () => {
      expect(resolveCorrectWeight(void 0)).toBe(DEFAULT_CORRECT_WEIGHT);
      expect(resolveCorrectWeight(0.3)).toBe(0.3);
      expect(resolveCorrectWeight(2)).toBe(1);
      expect(resolveCorrectWeight(0)).toBe(MIN_CORRECT_WEIGHT);
      expect(resolveCorrectWeight(-1)).toBe(MIN_CORRECT_WEIGHT);
      expect(resolveCorrectWeight(Number.NaN)).toBe(DEFAULT_CORRECT_WEIGHT);
    });

    it('权重夹取后参与混合 (w=1 → 完全取 target)', () => {
      const plan = actPlan(trajectoryNode('n1', { correctWeight: 5, target: { resistance: { verbal: 0.9 } } }), true);
      const result = applyTrajectory('weighted_correct', bdiIntention(), baseSnapshot(), plan);
      expect(result.intention.resistance.verbal).toBeCloseTo(0.9, 10);
    });
  });

  describe('④ 触发未命中透传', () => {
    it('trigger 模式无命中幕 → 原样返回 BDI 意图与快照, 不叠 delta', () => {
      const script = trajectoryScript({
        mode: 'trigger',
        nodes: [trajectoryNode('n1', { trigger: { onKeywords: ['不存在的话'] }, delta: { trust: 0.3 } })],
      });
      const snapshot = baseSnapshot();
      const bdi = bdiIntention();
      const plan = planAct(script, 0, matchContext({ userText: '今天天气不错' }), new Set<number>());

      expect(plan.node).toBeNull();
      const result = applyTrajectory('trigger', bdi, snapshot, plan);
      expect(result.activated).toBe(false);
      expect(result.intention).toBe(bdi);
      expect(result.snapshot).toBe(snapshot);
      expect(result.snapshot.trust).toBe(0.3);
    });
  });

  describe('⑤ 触发命中激活', () => {
    it('命中幕按强覆盖替换 + 进入新幕叠 delta, 游标前进', () => {
      const script = trajectoryScript({
        mode: 'trigger',
        nodes: [
          trajectoryNode('n1', {
            trigger: { onKeywords: ['失眠'] },
            target: { strategy: 'insight', forbiddenBehaviors: ['press'] },
            delta: { trust: 0.2 },
          }),
        ],
      });
      const plan = planAct(script, 0, matchContext({ userText: '最近总是失眠' }), new Set<number>());

      expect(plan.node?.nodeId).toBe('n1');
      expect(plan.enterNewAct).toBe(true);
      expect(plan.nextCursor).toBe(1);

      const result = applyTrajectory('trigger', bdiIntention(), baseSnapshot(), plan);
      expect(result.activated).toBe(true);
      expect(result.intention.strategy).toBe('insight');
      expect(result.intention.forbiddenBehaviors).toEqual(['judge', 'press']);
      expect(result.snapshot.trust).toBeCloseTo(0.3 + 0.2, 10);
    });
  });

  describe('⑥ 原子条件判定', () => {
    it('onEvents: 本轮事件与列表有交集即满足, 无交集不满足', () => {
      expect(evaluateTrigger({ onEvents: ['empathy'] }, matchContext({ events: [event('empathy')] }))).toBe(true);
      expect(evaluateTrigger({ onEvents: ['empathy'] }, matchContext({ events: [event('judgment')] }))).toBe(false);
      expect(evaluateTrigger({ onEvents: ['empathy', 'judgment'] }, matchContext({ events: [event('judgment'), event('neutral')] }))).toBe(
        true,
      );
    });

    it('onKeywords: 小写子串命中, 大小写无关', () => {
      expect(evaluateTrigger({ onKeywords: ['失眠'] }, matchContext({ userText: '我最近总是失眠' }))).toBe(true);
      expect(evaluateTrigger({ onKeywords: ['SLEEP'] }, matchContext({ userText: '我最近总是sleep' }))).toBe(true);
      expect(evaluateTrigger({ onKeywords: ['失眠'] }, matchContext({ userText: '我最近总是头疼' }))).toBe(false);
    });

    it('onKeywords: 全空白关键词跳过该原子 (不视为命中, 也不阻断)', () => {
      // 只有空白关键词 → 该原子跳过 → 无有效约束 → 空真.
      expect(evaluateTrigger({ onKeywords: [' '.repeat(3), ''] }, matchContext({ userText: '随便' }))).toBe(true);
      // 空白 + 真实关键词 → 真实关键词照常判定.
      expect(evaluateTrigger({ onKeywords: ['  ', '失眠'] }, matchContext({ userText: '头疼' }))).toBe(false);
    });

    it('afterTurns: 轮次号达到阈值即满足 (边界含等号)', () => {
      expect(evaluateTrigger({ afterTurns: 3 }, matchContext({ turnIndex: 3 }))).toBe(true);
      expect(evaluateTrigger({ afterTurns: 3 }, matchContext({ turnIndex: 2 }))).toBe(false);
    });

    it('state: trust 闭区间判定', () => {
      const ctx = matchContext({ snapshot: baseSnapshot({ trust: 0.5 }) });
      expect(evaluateTrigger({ state: { minTrust: 0.5 } }, ctx)).toBe(true);
      expect(evaluateTrigger({ state: { maxTrust: 0.5 } }, ctx)).toBe(true);
      expect(evaluateTrigger({ state: { minTrust: 0.6 } }, ctx)).toBe(false);
      expect(evaluateTrigger({ state: { maxTrust: 0.4 } }, ctx)).toBe(false);
    });

    it('state: 阻抗均值闭区间判定', () => {
      // 基线阻抗 (0.4,0.4,0.35) → 均值 = 1.15/3 ≈ 0.3833.
      const ctx = matchContext();
      expect(evaluateTrigger({ state: { minResistanceAgg: 0.38 } }, ctx)).toBe(true);
      expect(evaluateTrigger({ state: { maxResistanceAgg: 0.38 } }, ctx)).toBe(false);
      expect(evaluateTrigger({ state: { minResistanceAgg: 0.39 } }, ctx)).toBe(false);
    });

    it('state: 情绪标签相等判定', () => {
      const ctx = matchContext({ snapshot: baseSnapshot({ emotion: { label: 'anxious', valence: -0.1, arousal: 0.7 } }) });
      expect(evaluateTrigger({ state: { emotionLabel: 'anxious' } }, ctx)).toBe(true);
      expect(evaluateTrigger({ state: { emotionLabel: 'neutral' } }, ctx)).toBe(false);
    });

    it('state: 区间倒挂视为不满足 (安全方向: 不触发)', () => {
      const ctx = matchContext({ snapshot: baseSnapshot({ trust: 0.5 }) });
      expect(evaluateTrigger({ state: { minTrust: 0.8, maxTrust: 0.2 } }, ctx)).toBe(false);
    });

    it('多原子 AND: 缺一不命中', () => {
      const ctx = matchContext({ events: [event('empathy')], userText: '我最近失眠', turnIndex: 2 });
      expect(evaluateTrigger({ onEvents: ['empathy'], onKeywords: ['失眠'], afterTurns: 2, state: { minTrust: 0.1 } }, ctx)).toBe(true);
      expect(evaluateTrigger({ onEvents: ['empathy'], onKeywords: ['失眠'], afterTurns: 3, state: { minTrust: 0.1 } }, ctx)).toBe(false);
      expect(evaluateTrigger({ onEvents: ['judgment'], onKeywords: ['失眠'], afterTurns: 2, state: { minTrust: 0.1 } }, ctx)).toBe(false);
    });
  });

  describe('⑦ force 游标步进', () => {
    const script = trajectoryScript({
      mode: 'force_override',
      nodes: [
        trajectoryNode('n1', {
          trigger: { afterTurns: 2 },
          target: { strategy: 'insight' },
          delta: { trust: 0.2 },
        }),
      ],
    });

    it('条件满足 → enterNewAct=true, 游标 +1, delta 叠加一次', () => {
      const plan = planAct(script, 0, matchContext({ turnIndex: 2 }), new Set<number>());
      expect(plan.node?.nodeId).toBe('n1');
      expect(plan.enterNewAct).toBe(true);
      expect(plan.nextCursor).toBe(1);

      const result = applyTrajectory('force_override', bdiIntention(), baseSnapshot(), plan);
      expect(result.intention.strategy).toBe('insight');
      expect(result.snapshot.trust).toBeCloseTo(0.5, 10);
    });

    it('条件不满足 → 等待轮: 游标不动, target 持续施加, delta 不叠加', () => {
      const plan = planAct(script, 0, matchContext({ turnIndex: 1 }), new Set<number>());
      expect(plan.node?.nodeId).toBe('n1');
      expect(plan.enterNewAct).toBe(false);
      expect(plan.nextCursor).toBe(0);

      const result = applyTrajectory('force_override', bdiIntention(), baseSnapshot(), plan);
      expect(result.activated).toBe(true);
      expect(result.intention.strategy).toBe('insight');
      // 等待轮不加 delta —— 否则信任/阻抗会被反复滚高.
      expect(result.snapshot.trust).toBe(0.3);
    });

    it('游标越过末幕 → 透传 BDI', () => {
      const plan = planAct(script, 5, matchContext({ turnIndex: 9 }), new Set<number>());
      expect(plan.node).toBeNull();
      expect(plan.nextCursor).toBe(5);
    });
  });

  describe('⑧ 不跳幕', () => {
    it('order < cursor 的已过幕即使条件命中也不激活', () => {
      const script = trajectoryScript({
        mode: 'trigger',
        nodes: [
          trajectoryNode('old', { trigger: { onKeywords: ['失眠'] } }),
          trajectoryNode('future', { trigger: { onKeywords: ['失眠'] } }),
        ],
      });
      // 游标已越过 old → old 不再激活, 只有 future 可命中.
      const plan = planAct(script, 1, matchContext({ userText: '失眠' }), new Set<number>());
      expect(plan.node?.nodeId).toBe('future');
      expect(plan.nextCursor).toBe(2);
    });

    it('游标只增不减 (推进后不会退回旧幕)', () => {
      const script = trajectoryScript({
        mode: 'trigger',
        nodes: [trajectoryNode('n1', { trigger: { onKeywords: ['失眠'] } })],
      });
      const first = planAct(script, 0, matchContext({ userText: '失眠' }), new Set<number>());
      expect(first.nextCursor).toBe(1);
      const second = planAct(script, first.nextCursor, matchContext({ userText: '失眠' }), new Set([0]));
      expect(second.node).toBeNull();
      expect(second.nextCursor).toBe(1);
    });
  });

  describe('⑨ 一次性 delta', () => {
    it('同一幕不叠加两次 (进入后游标推过, 不再回到该幕)', async () => {
      const script = trajectoryScript({
        mode: 'force_override',
        nodes: [trajectoryNode('n1', { trigger: {}, delta: { trust: 0.2 } })],
      });
      const { outputs } = await runTurns(script, [NEUTRAL_TEXT, NEUTRAL_TEXT, NEUTRAL_TEXT]);

      // 首轮进入该幕 → delta 叠加一次 (trust 0.3 → 0.5).
      expect(outputs[0]?.snapshot.trust).toBeCloseTo(0.5, 10);
      // 后续轮次该幕已过 → 不再叠加.
      expect(outputs[1]?.snapshot.trust).toBeCloseTo(0.5, 10);
      expect(outputs[2]?.snapshot.trust).toBeCloseTo(0.5, 10);
    });

    it('等待轮不叠加 delta', async () => {
      const script = trajectoryScript({
        mode: 'force_override',
        nodes: [trajectoryNode('n1', { trigger: { afterTurns: 3 }, delta: { trust: 0.2 } })],
      });
      const { outputs } = await runTurns(script, [NEUTRAL_TEXT, NEUTRAL_TEXT, NEUTRAL_TEXT]);

      expect(outputs[0]?.snapshot.trust).toBe(0.3);
      expect(outputs[1]?.snapshot.trust).toBe(0.3);
      // 第三轮进入该幕 → 叠加一次.
      expect(outputs[2]?.snapshot.trust).toBeCloseTo(0.5, 10);
    });
  });

  describe('⑩ abort 优先于 completion', () => {
    it('同一轮 abort 与 completion.when 同时命中 → 落 aborted', async () => {
      const script = trajectoryScript({
        mode: 'force_override',
        nodes: [trajectoryNode('n1', { trigger: {} })],
        abort: { onKeywords: ['危机'] },
        completion: { when: { onKeywords: ['危机'] }, outcome: 'completed' },
      });
      const { outputs } = await runTurns(script, ['出现危机信号']);

      expect(outputs[0]?.trajectoryTrace?.outcome).toBe('aborted');
      expect(outputs[0]?.trajectoryTrace?.activated).toBe(false);
      expect(outputs[0]?.trajectoryTrace?.advanced).toBe(false);
    });

    it('abort 后不再推进 / 不再叠加', async () => {
      const script = trajectoryScript({
        mode: 'force_override',
        nodes: [trajectoryNode('n1', { trigger: {}, delta: { trust: 0.2 } })],
        abort: { onKeywords: ['危机'] },
      });
      const { outputs } = await runTurns(script, ['出现危机信号', NEUTRAL_TEXT, NEUTRAL_TEXT]);

      expect(outputs[0]?.trajectoryTrace?.outcome).toBe('aborted');
      expect(outputs[0]?.snapshot.trust).toBe(0.3);
      // 终态后: 游标冻结, BDI 自由运行, 不再叠加 delta, 本轮不再写 outcome.
      expect(outputs[1]?.snapshot.trust).toBe(0.3);
      expect(outputs[1]?.trajectoryTrace?.activated).toBe(false);
      expect(outputs[1]?.trajectoryTrace?.cursor).toBe(0);
      expect(outputs[1]?.trajectoryTrace?.outcome).toBeUndefined();
    });
  });

  describe('⑪ 完成判定', () => {
    it('completion.when 命中 → trace.outcome=completed, 且只写一次', async () => {
      const script = trajectoryScript({
        mode: 'force_override',
        nodes: [trajectoryNode('n1', { trigger: {} })],
        completion: { when: { afterTurns: 2 }, outcome: 'completed' },
      });
      const { outputs } = await runTurns(script, [NEUTRAL_TEXT, NEUTRAL_TEXT, NEUTRAL_TEXT]);

      expect(outputs[0]?.trajectoryTrace?.outcome).toBeUndefined();
      expect(outputs[1]?.trajectoryTrace?.outcome).toBe('completed');
      // 终态后不再写 outcome (outcome 是本轮事件).
      expect(outputs[2]?.trajectoryTrace?.outcome).toBeUndefined();
    });

    it('未命中时不写 outcome', async () => {
      const script = trajectoryScript({
        mode: 'force_override',
        nodes: [trajectoryNode('n1', { trigger: {} })],
        completion: { when: { afterTurns: 999 }, outcome: 'completed' },
      });
      const { outputs } = await runTurns(script, [NEUTRAL_TEXT]);
      expect(outputs[0]?.trajectoryTrace?.outcome).toBeUndefined();
    });

    it('终态不自动 closeSession (会话仍可继续对话)', async () => {
      const script = trajectoryScript({
        mode: 'force_override',
        nodes: [trajectoryNode('n1', { trigger: {} })],
        completion: { when: { afterTurns: 1 }, outcome: 'completed' },
      });
      const { outputs, harness } = await runTurns(script, [NEUTRAL_TEXT, NEUTRAL_TEXT]);

      expect(outputs[0]?.trajectoryTrace?.outcome).toBe('completed');
      expect(harness.session.activeSessionCount()).toBe(1);
      expect(outputs[1]).toBeDefined();
    });
  });

  describe('⑫ 无剧本零回归', () => {
    it('不注入剧本时, 意图/快照与 WP1 路径逐字一致, 且出参无 trajectoryTrace', async () => {
      const text = '听起来你最近很辛苦';
      const { outputs } = await runTurns(undefined, [text]);

      const classifier = new RuleBasedClassifier();
      const events = classifier.classify(text);
      const expectedSnapshot = transitionState(createEmptyBdiSnapshot(), events);
      const expectedIntention = planIntention(expectedSnapshot);

      expect(outputs[0]?.trajectoryTrace).toBeUndefined();
      expect(outputs[0]?.snapshot).toEqual(expectedSnapshot);
      expect(outputs[0]?.intention).toEqual(expectedIntention);
      expect(outputs[0]?.turnIndex).toBe(1);
    });

    it('不注入剧本时, 多轮对话与 WP1 路径逐字一致', async () => {
      const texts = ['听起来你最近很辛苦', '你就是不承认自己累了', '我们再聊聊'];
      const withTrajectoryField = await runTurns(undefined, texts);
      expect(withTrajectoryField.outputs.map((output) => output.snapshot)).toHaveLength(3);
      expect(withTrajectoryField.outputs.every((output) => output.trajectoryTrace === undefined)).toBe(true);
      expect(withTrajectoryField.outputs[2]?.turnIndex).toBe(3);
    });
  });

  describe('⑬ 非法剧本', () => {
    it('缺 scriptId → INVALID_INPUT', () => {
      const harness = createHarness();
      expect(() =>
        harness.session.openSession({
          sessionId: 's-1',
          tenantId: TENANT,
          visitorId: VISITOR,
          trajectory: trajectoryScript({ scriptId: '  ' }),
        }),
      ).toThrow(expect.objectContaining({ code: EngineErrorCode.INVALID_INPUT }));
    });

    it('缺 completion.when → INVALID_INPUT', () => {
      const harness = createHarness();
      expect(() =>
        harness.session.openSession({
          sessionId: 's-1',
          tenantId: TENANT,
          visitorId: VISITOR,
          trajectory: {
            ...trajectoryScript(),
            completion: undefined as unknown as TrajectoryScript['completion'],
          },
        }),
      ).toThrow(expect.objectContaining({ code: EngineErrorCode.INVALID_INPUT }));
    });

    it('order 重复 → INVALID_INPUT', () => {
      const harness = createHarness();
      expect(() =>
        harness.session.openSession({
          sessionId: 's-1',
          tenantId: TENANT,
          visitorId: VISITOR,
          trajectory: trajectoryScript({
            nodes: [trajectoryNode('n1', { order: 1 }), trajectoryNode('n2', { order: 1 })],
          }),
        }),
      ).toThrow(expect.objectContaining({ code: EngineErrorCode.INVALID_INPUT }));
    });

    it('mode 非法 → INVALID_INPUT', () => {
      const harness = createHarness();
      expect(() =>
        harness.session.openSession({
          sessionId: 's-1',
          tenantId: TENANT,
          visitorId: VISITOR,
          trajectory: trajectoryScript({ mode: 'branching' as unknown as TrajectoryScript['mode'] }),
        }),
      ).toThrow(expect.objectContaining({ code: EngineErrorCode.INVALID_INPUT }));
    });
  });

  describe('⑭ 同轮多幕命中', () => {
    it('weighted/trigger 只取升序首个命中, 其余不叠加不推进', () => {
      const script = trajectoryScript({
        mode: 'trigger',
        nodes: [
          trajectoryNode('first', { trigger: { onKeywords: ['失眠'] }, delta: { trust: 0.1 } }),
          trajectoryNode('second', { trigger: { onKeywords: ['失眠'] }, delta: { trust: 0.5 } }),
        ],
      });
      const plan = planAct(script, 0, matchContext({ userText: '失眠' }), new Set<number>());

      expect(plan.node?.nodeId).toBe('first');
      expect(plan.nextCursor).toBe(1);

      const result = applyTrajectory('trigger', bdiIntention(), baseSnapshot(), plan);
      expect(result.snapshot.trust).toBeCloseTo(0.4, 10);
    });
  });

  describe('⑮ 剧本偏移接入同盟三维 (WP52)', () => {
    /** 一条"咨询师表达共情"事件 (safety +0.02 / bond +0.01 / trust +0.10). */
    const EMPATHY_EVENT: SessionEvent = { kind: 'empathy', matchedTerms: ['我能理解你'], strength: 1 };

    /**
     * 只命中 empathy 一条规则的文本 (其余词表均不含这些词).
     *
     * 为什么不用"听起来你现在一定很难受"这类更长的句子: 它虽然也只命中 empathy,
     * 但多个 empathy 词同时命中会让"命中了几个词"与"产生了几条事件"两件事混在一起 ——
     * 而本组要验的是**事件 delta 的 safety 值**, 事件条数必须唯一确定.
     */
    const EMPATHY_TEXT = '你现在一定很难受, 我能理解你';

    it('幕 delta 写了 safety → 进入该幕那一轮 safety 真的涨了', () => {
      const plan = actPlan(trajectoryNode('n1', { delta: { safety: 0.05 } }), true);

      const result = applyTrajectory('force_override', bdiIntention(), baseSnapshot({ safety: 0.5 }), plan);

      expect(result.snapshot.safety).toBeCloseTo(0.55, 10);
      expect(result.delta?.safety).toBeCloseTo(0.05, 10);
    });

    it('幕 delta 写了 bond → 进入该幕那一轮 bond 真的涨了', () => {
      const plan = actPlan(trajectoryNode('n1', { delta: { bond: 0.03 } }), true);

      const result = applyTrajectory('force_override', bdiIntention(), baseSnapshot({ bond: 0 }), plan);

      expect(result.snapshot.bond).toBeCloseTo(0.03, 10);
      expect(result.delta?.bond).toBeCloseTo(0.03, 10);
    });

    it('缺省 (剧本 delta 不写 safety/bond) → 这两维不动 (零回归)', () => {
      const plan = actPlan(trajectoryNode('n1', { delta: { trust: 0.05 } }), true);

      const result = applyTrajectory('force_override', bdiIntention(), baseSnapshot({ safety: 0.5, bond: 0 }), plan);

      expect(result.snapshot.safety).toBe(0.5);
      expect(result.snapshot.bond).toBe(0);
      // 外抛的原始 delta 里这两维是 0 (不是 undefined) —— 合并口径统一.
      expect(result.delta?.safety).toBe(0);
      expect(result.delta?.bond).toBe(0);
    });

    it('等待轮 (enterNewAct=false) → 不叠 safety/bond delta (与 trust 口径一致)', () => {
      const plan = actPlan(trajectoryNode('n1', { delta: { safety: 0.05, bond: 0.03, trust: 0.1 } }), false);

      const result = applyTrajectory('force_override', bdiIntention(), baseSnapshot({ safety: 0.5, bond: 0 }), plan);

      expect(result.snapshot.safety).toBe(0.5);
      expect(result.snapshot.bond).toBe(0);
      expect(result.snapshot.trust).toBe(0.3);
      expect(result.delta).toBeUndefined();
    });

    it('剧本 safety 与事件 safety **合并后统一过 cap** (不是各自过 cap)', () => {
      const eventDelta = aggregateTurnDelta([EMPATHY_EVENT]);
      expect(eventDelta.safety).toBeCloseTo(0.02, 10);

      const plan = actPlan(trajectoryNode('n1', { delta: { safety: 0.25 } }), true);
      const applied = applyTrajectory('force_override', bdiIntention(), baseSnapshot(), plan);
      const scriptDelta = applied.delta;
      if (!scriptDelta) throw new Error('进入新幕那一轮必须带出剧本 delta');

      const merged = addDeltaVectors(eventDelta, scriptDelta);
      expect(merged.safety).toBeCloseTo(0.27, 10);

      const capped = capTurnDelta(merged);
      expect(capped.safety).toBeCloseTo(0.2, 10);
      // 各自过 cap 会得到 0.2 + 0.02 = 0.22 —— 合并后统一过才是 0.2.
      expect(capped.safety).not.toBeCloseTo(0.22, 10);
    });

    it('会话层: 落库快照走的是"合并后统一过 cap" (0.7, 不是各自过 cap 的 0.72)', async () => {
      const script = trajectoryScript({
        mode: 'force_override',
        nodes: [trajectoryNode('n1', { trigger: {}, delta: { safety: 0.25 } })],
      });
      const { outputs } = await runTurns(script, [EMPATHY_TEXT]);

      // 事件 empathy safety +0.02 + 剧本 safety 0.25 = 0.27 → cap 0.2 → 基线 0.5 + 0.2.
      expect(outputs[0]?.snapshot.safety).toBeCloseTo(0.7, 10);
      expect(outputs[0]?.snapshot.safety).not.toBeCloseTo(0.72, 10);
    });

    it('会话层零回归: 剧本只写 trust → safety / bond 与无剧本路径逐字一致', async () => {
      const script = trajectoryScript({
        mode: 'force_override',
        nodes: [trajectoryNode('n1', { trigger: {}, delta: { trust: 0.1 } })],
      });

      const scripted = await runTurns(script, [EMPATHY_TEXT]);
      const plain = await runTurns(undefined, [EMPATHY_TEXT]);
      const scriptedSnapshot = scripted.outputs[0]?.snapshot;
      const plainSnapshot = plain.outputs[0]?.snapshot;
      if (!scriptedSnapshot || !plainSnapshot) throw new Error('两轮都应有一份快照');

      expect(scriptedSnapshot.safety).toBeCloseTo(plainSnapshot.safety, 10);
      expect(scriptedSnapshot.bond).toBeCloseTo(plainSnapshot.bond, 10);
      // 无剧本路径的事件 delta: empathy safety +0.02 / bond +0.01.
      expect(plainSnapshot.safety).toBeCloseTo(0.52, 10);
      expect(plainSnapshot.bond).toBeCloseTo(0.01, 10);
    });

    it('会话层: 剧本 bond 与事件 bond 合并后统一过 cap (bond 上向 cap 与 trust 同档 0.2)', async () => {
      const script = trajectoryScript({
        mode: 'force_override',
        nodes: [trajectoryNode('n1', { trigger: {}, delta: { bond: 0.3 } })],
      });
      const { outputs } = await runTurns(script, [EMPATHY_TEXT]);

      // 事件 bond +0.01 + 剧本 bond 0.3 = 0.31 → cap 0.2 → 基线 0 + 0.2.
      expect(outputs[0]?.snapshot.bond).toBeCloseTo(0.2, 10);
    });

    it('剧本写了脏值 (NaN) → 不把 NaN 写进快照 (clamp 落 0, 与 trust 口径一致)', () => {
      // 任务单 §4.4: 剧本 delta 不做 sanitize 校验, 脏值由 clamp 与 cap 兜住.
      // 落点是 0 (不是"保持原值") —— 这与 trust / resistance / emotion / transference
      // 的既有口径**完全一致**, 所以这里把行为钉死: 将来要改成"脏值回退不变",
      // 必须四个维度一起改, 不能只改 safety 一个.
      const plan = actPlan(trajectoryNode('n1', { delta: { safety: Number.NaN, trust: Number.NaN } }), true);

      const result = applyTrajectory('force_override', bdiIntention(), baseSnapshot({ safety: 0.5 }), plan);

      expect(result.snapshot.safety).toBe(0);
      expect(result.snapshot.trust).toBe(0);
      expect(Number.isNaN(result.snapshot.safety)).toBe(false);
    });
  });

  describe('可复现性 (任务单 §9 验收)', () => {
    it('同剧本 + 同行为序列复跑两轮, 游标/激活幕/意图/快照逐轮一致', async () => {
      const script = trajectoryScript({
        mode: 'force_override',
        nodes: [
          trajectoryNode('n1', { trigger: { afterTurns: 1 }, target: { strategy: 'insight' }, delta: { trust: 0.2 } }),
          trajectoryNode('n2', {
            trigger: { afterTurns: 3 },
            target: { strategy: 'resistance' },
            delta: { resistance: { verbal: 0.1 } },
          }),
        ],
      });
      const texts = [NEUTRAL_TEXT, NEUTRAL_TEXT, NEUTRAL_TEXT];

      const first = await runTurns(script, texts);
      const second = await runTurns(script, texts);

      expect(second.outputs.map((output) => output.trajectoryTrace)).toEqual(first.outputs.map((output) => output.trajectoryTrace));
      expect(second.outputs.map((output) => output.intention)).toEqual(first.outputs.map((output) => output.intention));
      expect(second.outputs.map((output) => output.snapshot)).toEqual(first.outputs.map((output) => output.snapshot));
    });

    it('游标单向推进, trace 记录已访问幕与位置', async () => {
      const script = trajectoryScript({
        mode: 'force_override',
        nodes: [trajectoryNode('n1', { trigger: { afterTurns: 1 } }), trajectoryNode('n2', { trigger: { afterTurns: 2 } })],
      });
      const { outputs } = await runTurns(script, [NEUTRAL_TEXT, NEUTRAL_TEXT]);

      expect(outputs[0]?.trajectoryTrace?.cursor).toBe(1);
      expect(outputs[0]?.trajectoryTrace?.visitedNodeIds).toEqual(['n1']);
      expect(outputs[0]?.trajectoryTrace?.advanced).toBe(true);
      expect(outputs[1]?.trajectoryTrace?.cursor).toBe(2);
      expect(outputs[1]?.trajectoryTrace?.visitedNodeIds).toEqual(['n1', 'n2']);
      expect(outputs[1]?.trajectoryTrace?.activeNodeId).toBe('n2');
    });
  });
});
