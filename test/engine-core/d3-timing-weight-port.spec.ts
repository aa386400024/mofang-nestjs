// V2026-11-13 治本 (D-3 · I-19 / S-3 时序权重端口骨架 · 单测):
//   目的: 钉死「轮次位置权重」端口落地后的口径 ——
//     ① 不传端口 = **逐字零回归** (固定 snapshot + 固定事件序列 → 快照逐字相同);
//     ② 显式 `none` = 与缺省逐字相同 (等权);
//     ③ 非 `none` 形态 (linear_decay / recency / window) 本单**回退等权** → 与缺省逐字相同
//        (骨架护栏: 未实现形态不得改变行为);
//     ④ `turnIndex` 缺省 / 传入都不改变输出 (缺省即等权);
//     ⑤ 管道顺序 = 聚合 → 人格调节 → cap → 折损 → apply; cap 报告仍按 `raw → capped` 构造
//        (折损不改变砍幅结论); 两个出口 (transitionState / transitionStateDetailed) 口径一致;
//     ⑥ 会话层透传: 构造注入 `timingWeightConfig` → 临时快照路径吃端口;
//        轮次号 = runtime.turnIndex + 1 (1 起)。
//
//   为什么这层要有单测 (而不是只测适配层):
//     折损点是**内核私有纯函数** + 内核管道内的一行 —— 适配层看不见它。
//     而「未实现形态不得改变行为」这条护栏只有在内核层钉住才有效:
//     将来标定批次落地 `recency` 时, ③ 这条断言会立刻变红 → 逼着人显式决定。
//
//   反依赖污染:
//     本文件**不 import 任何 @nestjs/* / typeorm / qdrant** —— 它是内核边界的一部分.
//     深路径 import (in-memory/*) 是为了直接 new 内存实现, 与既有 WP60 测试同款做法.
//
//   验证: pnpm exec vitest run test/engine-core/d3-timing-weight-port.spec.ts

import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository.js';
import { InMemoryEngineSession, type InMemoryEngineSessionOptions } from '../../src/engine-core/in-memory/in-memory-engine-session.js';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store.js';
import {
  createEmptyBdiSnapshot,
  transitionState,
  transitionStateDetailed,
  type EngineTurnOutput,
  type EventClassifier,
  type SessionEvent,
} from '../../src/engine-core/index.js';

/** 共情事件 (DELTA_TABLE 基础值: trust +0.10 / safety +0.02 / bond +0.01). */
const EMPATHY: SessionEvent = { kind: 'empathy', matchedTerms: [], strength: 1 };
/** 固定事件序列 (含正向 / 负向 / 中性) —— 零回归对照用同一份序列. */
const EVENTS: readonly SessionEvent[] = [
  { kind: 'empathy', matchedTerms: [], strength: 1 },
  { kind: 'neutral', matchedTerms: [], strength: 1 },
  { kind: 'empathy', matchedTerms: [], strength: 0.5 },
];
/** 会话开场入参 (固定 seed → 确定性). */
const OPEN_INPUT = { sessionId: 'session-1', tenantId: 'default', visitorId: 'visitor-1', seed: 7 } as const;
/** 测试台分类器: 命中 'empathy' 即一条共情, 其余中性. */
const classifier: EventClassifier = {
  classify: (text: string): readonly SessionEvent[] =>
    text === 'empathy' ? [EMPATHY] : [{ kind: 'neutral', matchedTerms: [], strength: 1 }],
};

/**
 * 建一个确定性会话 (固定 id / 固定时钟 / 固定分类器).
 *
 * `timingWeightConfig` 缺省 = 不注入 = 内核走缺省 (不折损).
 */
function createSession(timingWeightConfig?: InMemoryEngineSessionOptions['timingWeightConfig']): InMemoryEngineSession {
  const clock = 1_700_000_000_000;
  let idSeq = 0;
  return new InMemoryEngineSession({
    bdiStates: new InMemoryBdiStateRepository(),
    memories: new InMemoryMemoryStore({ now: () => clock }),
    idFactory: () => {
      idSeq += 1;
      return `d3-id-${idSeq}`;
    },
    now: () => clock,
    classifier,
    ...(timingWeightConfig ? { timingWeightConfig } : {}),
  });
}

/** 跑若干轮, 返回每轮的落库快照序列. */
async function runTurns(session: InMemoryEngineSession, count: number): Promise<readonly EngineTurnOutput['snapshot'][]> {
  const handle = session.openSession(OPEN_INPUT);
  const snapshots: EngineTurnOutput['snapshot'][] = [];
  for (let i = 0; i < count; i += 1) {
    const out = await session.turn(handle.handleId, { userText: 'empathy' });
    snapshots.push(out.snapshot);
  }
  return snapshots;
}

describe('D-3 · 时序权重端口骨架 (内核)', () => {
  describe('① 缺省 = 逐字零回归', () => {
    it('不传任何权重端口 → 快照与改造前逐字相同 (基线数值)', () => {
      const base = createEmptyBdiSnapshot();
      const next = transitionState(base, [EMPATHY]);

      // 旧模型的算术: 初始 trust 0.3 / safety 0.5 / bond 0 + 共情 (+0.10 / +0.02 / +0.01).
      expect(next.trust).toBeCloseTo(0.4, 10);
      expect(next.safety).toBeCloseTo(0.52, 10);
      expect(next.bond).toBeCloseTo(0.01, 10);
    });

    it('固定事件序列 → 缺省快照与「显式 none」逐字相同 (整快照 toEqual)', () => {
      const base = createEmptyBdiSnapshot();
      const plain = transitionState(base, EVENTS);
      const none = transitionState(base, EVENTS, { timingWeight: { kind: 'none' } });

      expect(none).toEqual(plain);
    });
  });

  describe('② none 形态 = 等权', () => {
    it('显式 none → 与缺省逐字相同', () => {
      const base = createEmptyBdiSnapshot();

      expect(transitionState(base, EVENTS, { timingWeight: { kind: 'none' } })).toEqual(transitionState(base, EVENTS));
    });

    it('none + turnIndex → 与缺省逐字相同 (轮次号不改变 none 输出)', () => {
      const base = createEmptyBdiSnapshot();
      const plain = transitionState(base, EVENTS);

      expect(transitionState(base, EVENTS, { timingWeight: { kind: 'none' }, turnIndex: 1 })).toEqual(plain);
      expect(transitionState(base, EVENTS, { timingWeight: { kind: 'none' }, turnIndex: 999 })).toEqual(plain);
    });
  });

  describe('③ 非 none 形态本单回退等权 (骨架护栏)', () => {
    it.each(['linear_decay', 'recency', 'window'] as const)('%s 形态 → 与缺省逐字相同 (未实现形态不得改变行为)', (kind) => {
      const base = createEmptyBdiSnapshot();
      const plain = transitionState(base, EVENTS);
      const weighted = transitionState(base, EVENTS, {
        timingWeight: { kind, slope: 0.5, windowTurns: 3 },
        turnIndex: 7,
      });

      expect(weighted).toEqual(plain);
    });

    it('非 none 形态 + turnIndex 缺省 → 同样回退等权', () => {
      const base = createEmptyBdiSnapshot();

      expect(transitionState(base, EVENTS, { timingWeight: { kind: 'recency', slope: 0.5 } })).toEqual(transitionState(base, EVENTS));
    });
  });

  describe('④ 管道顺序: cap → 折损 (折损不改变砍幅结论)', () => {
    it('cap 报告仍按 raw → capped 构造 (与缺省逐字相同)', () => {
      const base = createEmptyBdiSnapshot();
      const plainReports: unknown[] = [];
      const weightedReports: unknown[] = [];

      transitionState(base, [EMPATHY, EMPATHY, EMPATHY], { observer: (report) => plainReports.push(report) });
      transitionState(base, [EMPATHY, EMPATHY, EMPATHY], {
        timingWeight: { kind: 'none' },
        observer: (report) => weightedReports.push(report),
      });

      expect(weightedReports).toEqual(plainReports);
    });

    it('砍幅明细仍是 cap 的结论 (trust 0.3 → 0.2), 不是折损后的值', () => {
      const base = createEmptyBdiSnapshot();
      const reports: { readonly entries: readonly { dimension: string; raw: number; capped: number }[] }[] = [];

      transitionState(base, [EMPATHY, EMPATHY, EMPATHY], { observer: (report) => reports.push(report) });

      // 三个共情 = trust +0.30, 撞上向 cap +0.20 → 砍幅只报 trust 一条.
      expect(reports).toHaveLength(1);
      expect(reports[0]?.entries).toHaveLength(1);
      expect(reports[0]?.entries[0]?.dimension).toBe('trust');
      expect(reports[0]?.entries[0]?.raw).toBeCloseTo(0.3, 10);
      expect(reports[0]?.entries[0]?.capped).toBeCloseTo(0.2, 10);
    });

    it('两个出口口径一致 (transitionState 与 transitionStateDetailed 逐字相同)', () => {
      const base = createEmptyBdiSnapshot();
      const options = { timingWeight: { kind: 'none' as const }, turnIndex: 3 };

      expect(transitionStateDetailed(base, EVENTS, options).snapshot).toEqual(transitionState(base, EVENTS, options));
    });
  });

  describe('⑤ 会话层透传 (构造注入 → 临时快照路径吃端口)', () => {
    it('缺省 → 多轮落库快照逐字稳定', async () => {
      const session = createSession();
      const snapshots = await runTurns(session, 3);

      expect(snapshots).toHaveLength(3);
      expect(snapshots[0]?.trust).toBeCloseTo(0.4, 10);
      expect(snapshots[1]?.trust).toBeCloseTo(0.5, 10);
      expect(snapshots[2]?.trust).toBeCloseTo(0.6, 10);
    });

    it('注入 none 配置 → 与缺省逐字相同', async () => {
      const plain = await runTurns(createSession(), 2);
      const none = await runTurns(createSession({ kind: 'none' }), 2);

      expect(none).toEqual(plain);
    });

    it('注入非 none 形态 → 本单回退等权 → 与缺省逐字相同 (骨架护栏)', async () => {
      const plain = await runTurns(createSession(), 2);
      const recency = await runTurns(createSession({ kind: 'recency', slope: 0.5 }), 2);

      expect(recency).toEqual(plain);
    });

    it('轮次号口径: 多轮推进 turnIndex 递增 (1 起, 同既有基线)', async () => {
      const session = createSession();
      const handle = session.openSession(OPEN_INPUT);

      const first = await session.turn(handle.handleId, { userText: 'empathy' });
      const second = await session.turn(handle.handleId, { userText: 'empathy' });

      // 会话层传给内核的轮次号 = runtime.turnIndex + 1 → 与出参 turnIndex 同口径 (1 起).
      expect(first.turnIndex).toBe(1);
      expect(second.turnIndex).toBe(2);
    });
  });
});
