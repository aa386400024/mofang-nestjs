// V2026-11-03 治本 (WP26 · 引擎内核 · cap 注入 / 总 delta 口径 回归):
//   目的: 把 WP26 引擎组三条治本的**验收口径**机械化 ——
//     ① P2-14 内核不再读 env: cap 参数走**注入** (DeltaCapConfig 端口),
//        同 seed + 同 capConfig 同序列逐字同输出;
//     ② P2-11 cap 报告带会话标识 (sessionId / handleId) —— 多人内测可定位;
//     ③ P2-12 轨迹 delta 也走 cap: cap 管的是"**一回合总 delta**",
//        不管 delta 来自事件还是剧本.
//
//   P2-12 的验收剧本 (任务单 §2 原文):
//     crisis_signal 剧本 (valence -0.3) + 一个 judgment 事件 (valence -0.12)
//     → 断言单回合 |Δvalence| ≤ 0.30 (不是 0.42).
//     0.42 = 0.12 + 0.30 = "事件 delta + 剧本 delta 各走各的" —— 旧路径就是这个数.
//
//   为什么注入**测试用分类器**而不是靠词表:
//     cap 是**单回合**的 —— 一回合里要触发砍幅, 必须同一回合有多条事件.
//     靠词表凑多条事件太脆 (词表一改, 用例就悄悄失效), 所以把"这一轮发生了什么"
//     钉死在测试台里: 用例只测 cap 口径, 不测词表.
//
//   反依赖污染:
//     本文件**不 import 任何 @nestjs/* / typeorm / qdrant** —— 它是内核边界的一部分.
//     深路径 import (in-memory/*) 是为了直接 new 内存实现, 与既有 WP0–WP3 测试同款做法.
//
//   验证: npx vitest run test/engine-core/wp26-delta-cap-injection.spec.ts

import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository.js';
import { InMemoryEngineSession } from '../../src/engine-core/in-memory/in-memory-engine-session.js';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store.js';
import {
  DEFAULT_DELTA_CAP_CONFIG,
  type CounselorEventKind,
  type DeltaCapConfig,
  type EngineTurnOutput,
  type EventClassifier,
  type SessionEvent,
  type TrajectoryNode,
  type TrajectoryScript,
  type TurnDeltaCapReport,
} from '../../src/engine-core/index.js';

const TENANT = 'default';
const VISITOR = 'visitor-1';

/** 单回合 3 条共情 (trust +0.10 × 3 = +0.30, 超过上向 cap 0.20 → 必被砍). */
const EMPATHY_TEXT = 'empathy-x3';
/** 单回合 1 条评判 (valence -0.12). */
const JUDGMENT_TEXT = 'judgment-x1';
/** 无事件 (delta = 0). */
const NEUTRAL_TEXT = 'neutral';

/** 造一幕 (trigger 缺省为空 = 无约束, 首轮即进入). */
function trajectoryNode(nodeId: string, overrides: Partial<TrajectoryNode> = {}): TrajectoryNode {
  return { nodeId, trigger: {}, ...overrides };
}

/** 造一份剧本 (completion 缺省永不命中, 便于把单测聚焦在一件事上). */
function trajectoryScript(overrides: Partial<TrajectoryScript> = {}): TrajectoryScript {
  return {
    scriptId: 'script-1',
    title: 'WP26 测试剧本',
    mode: 'force_override',
    difficulty: 1,
    goal: '验证轨迹 delta 也走单回合 cap',
    nodes: [],
    completion: { when: { afterTurns: 999 }, outcome: 'completed' },
    ...overrides,
  };
}

/** 造一份 cap 配置: 只改指定维度的上下界, 其余走内核种子值. */
function capConfig(overrides: Partial<Record<keyof DeltaCapConfig, { up: number; down: number }>>): DeltaCapConfig {
  const merged: Record<string, { up: number; down: number }> = {};
  for (const [dim, bounds] of Object.entries(DEFAULT_DELTA_CAP_CONFIG)) {
    merged[dim] = { up: bounds.up, down: bounds.down };
  }
  return { ...merged, ...overrides } as DeltaCapConfig;
}

/**
 * 造一个固定事件序列的分类器 (测试台).
 *
 * 把"这一轮咨询师做了什么"钉死 —— cap 是**单回合**口径, 用例要能精确造出
 * "一回合 3 条共情"这种会触发砍幅的组合, 而不能指望词表恰好命中.
 */
function fixedClassifier(eventsByText: Readonly<Record<string, readonly CounselorEventKind[]>>): EventClassifier {
  return {
    classify: (text: string): readonly SessionEvent[] => {
      const kinds = eventsByText[text] ?? ['neutral'];
      return kinds.map((kind) => ({ kind, matchedTerms: [], strength: 1 }));
    },
  };
}

/** 测试台默认分类器: 三种固定文本 → 固定事件序列. */
const DEFAULT_CLASSIFIER = fixedClassifier({
  [EMPATHY_TEXT]: ['empathy', 'empathy', 'empathy'],
  [JUDGMENT_TEXT]: ['judgment'],
  [NEUTRAL_TEXT]: ['neutral'],
});

/** 测试台选项. */
interface SessionOptions {
  readonly script?: TrajectoryScript;
  readonly cap?: DeltaCapConfig;
  readonly observer?: (report: TurnDeltaCapReport) => void;
}

/**
 * 建一个确定性会话 (固定 id 工厂 + 固定时钟 + 固定 seed + 固定分类器).
 *
 * 为什么固定 id 工厂: 会话 id 与句柄 id 都进报告 (P2-11), 不固定就没法断言.
 */
function createSession(options: SessionOptions = {}): { readonly session: InMemoryEngineSession; readonly handleId: string } {
  const clock = 1_700_000_000_000;
  const now = (): number => clock;
  let idSeq = 0;
  const session = new InMemoryEngineSession({
    bdiStates: new InMemoryBdiStateRepository(),
    memories: new InMemoryMemoryStore({ now }),
    idFactory: () => {
      idSeq += 1;
      return `wp26-id-${idSeq}`;
    },
    now,
    classifier: DEFAULT_CLASSIFIER,
    ...(options.cap ? { capConfig: options.cap } : {}),
    ...(options.observer ? { capObserver: options.observer } : {}),
  });
  const handle = session.openSession({
    sessionId: 'session-1',
    tenantId: TENANT,
    visitorId: VISITOR,
    seed: 7,
    ...(options.script ? { trajectory: options.script } : {}),
  });
  return { session, handleId: handle.handleId };
}

describe('WP26 · 内核 cap 注入与总 delta 口径', () => {
  describe('P2-12 · 轨迹 delta 也走单回合 cap (任务单验收)', () => {
    it('crisis_signal 剧本 (-0.30) + judgment 事件 (-0.12) → 单回合 |Δvalence| ≤ 0.30 (不是 0.42)', async () => {
      // 基线 valence = 0 (中性 bootstrap 快照).
      const script = trajectoryScript({
        nodes: [trajectoryNode('crisis_signal', { delta: { emotion: { valence: -0.3 } } })],
      });
      const { session, handleId } = createSession({ script });

      const out = await session.turn(handleId, { userText: JUDGMENT_TEXT });

      // 事件 delta -0.12 + 剧本 delta -0.30 = -0.42 → 被 cap 砍到 -0.30.
      expect(out.snapshot.emotion.valence).toBeCloseTo(-0.3, 10);
      expect(Math.abs(out.snapshot.emotion.valence)).toBeLessThanOrEqual(0.3);
    });

    it('报告口径 = 本轮**总** delta (raw -0.42 / capped -0.30), 不是只看事件 delta', async () => {
      const script = trajectoryScript({
        nodes: [trajectoryNode('crisis_signal', { delta: { emotion: { valence: -0.3 } } })],
      });
      const reports: TurnDeltaCapReport[] = [];
      const { session, handleId } = createSession({ script, observer: (report) => reports.push(report) });

      await session.turn(handleId, { userText: JUDGMENT_TEXT });

      expect(reports).toHaveLength(1);
      const report = reports[0];
      const valence = report?.entries.find((entry) => entry.dimension === 'valence');
      expect(valence?.raw).toBeCloseTo(-0.42, 10);
      expect(valence?.capped).toBeCloseTo(-0.3, 10);
      expect(report?.events).toContain('judgment');
    });

    it('无剧本时行为与 WP15 之前逐字一致 (零回归): 事件 delta 单独过 cap', async () => {
      const { session, handleId } = createSession();

      const out = await session.turn(handleId, { userText: EMPATHY_TEXT });

      // 基线 trust 0.3 + (+0.30 被砍到上向 cap 0.20) = 0.50.
      expect(out.snapshot.trust).toBeCloseTo(0.5, 10);
    });

    it('剧本偏移未超过 cap 时不改变结果 (cap 只砍超限的部分)', async () => {
      const script = trajectoryScript({
        nodes: [trajectoryNode('n1', { delta: { trust: 0.1 } })],
      });
      const { session, handleId } = createSession({ script });

      const out = await session.turn(handleId, { userText: NEUTRAL_TEXT });

      // 基线 trust 0.3 + 剧本 +0.10 = 0.40 (远低于上向 cap 0.20 → 不砍).
      expect(out.snapshot.trust).toBeCloseTo(0.4, 10);
    });
  });

  describe('P2-11 · cap 报告带会话标识', () => {
    it('报告自带 sessionId 与 handleId (多人内测可定位是哪场被砍)', async () => {
      const reports: TurnDeltaCapReport[] = [];
      const { session, handleId } = createSession({ observer: (report) => reports.push(report) });

      await session.turn(handleId, { userText: EMPATHY_TEXT });

      expect(reports).toHaveLength(1);
      expect(reports[0]?.sessionId).toBe('session-1');
      expect(reports[0]?.handleId).toBe(handleId);
    });

    it('没被砍时不产生报告 (不打噪声日志)', async () => {
      const reports: TurnDeltaCapReport[] = [];
      const { session, handleId } = createSession({ observer: (report) => reports.push(report) });

      await session.turn(handleId, { userText: NEUTRAL_TEXT });

      expect(reports).toHaveLength(0);
    });
  });

  describe('P2-14 · cap 参数走注入 (内核零 env)', () => {
    it('注入收紧后的配置 → 真的按配置砍', async () => {
      const { session, handleId } = createSession({ cap: capConfig({ trust: { up: 0.05, down: -0.3 } }) });

      const out = await session.turn(handleId, { userText: EMPATHY_TEXT });

      // 基线 0.3 + 上向 cap 0.05 = 0.35 (默认 0.20 会砍到 0.50).
      expect(out.snapshot.trust).toBeCloseTo(0.35, 10);
    });

    it('同 seed + 同 capConfig + 同序列 → 逐字同输出 (可复现)', async () => {
      const texts = [EMPATHY_TEXT, JUDGMENT_TEXT, NEUTRAL_TEXT];
      const run = async (): Promise<EngineTurnOutput[]> => {
        const { session, handleId } = createSession();
        const outputs: EngineTurnOutput[] = [];
        for (const text of texts) {
          outputs.push(await session.turn(handleId, { userText: text }));
        }
        return outputs;
      };

      const first = await run();
      const second = await run();

      expect(second.map((item) => item.snapshot)).toEqual(first.map((item) => item.snapshot));
    });

    it('capConfig 不同 → 输出不同 (证明 cap 配置真的参与决策, 不是摆设)', async () => {
      const loose = createSession();
      const looseOut = await loose.session.turn(loose.handleId, { userText: EMPATHY_TEXT });

      const tight = createSession({ cap: capConfig({ trust: { up: 0.05, down: -0.3 } }) });
      const tightOut = await tight.session.turn(tight.handleId, { userText: EMPATHY_TEXT });

      expect(looseOut.snapshot.trust).toBeCloseTo(0.5, 10);
      expect(tightOut.snapshot.trust).toBeCloseTo(0.35, 10);
    });
  });
});
