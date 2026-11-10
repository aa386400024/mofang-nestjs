// V2026-11-08 WP60 (引擎内核 · delta 规则表配置端口):
//   目的: 钉死"事件 → delta 系数表"抽成端口后的口径 ——
//     ① 不传配置 = 逐字不变 (零回归);
//     ② 覆写**按维度**生效 (只配 trust → 其余维度仍走基础值);
//     ③ 逐维度优先级 = deltaTable > alliance > DELTA_TABLE 基础值 (两者各管各的维度);
//     ④ 非法值 (NaN / Infinity) 逐项回退基础值 —— 端口是**公开契约**,
//        任何人都能 new 一个配置塞进来, 内核这层兜底保证增量永远是有限数;
//     ⑤ 会话注入路径真的吃这个端口 (构造注入 → 落库快照跟着变).
//
//   为什么这层要有单测 (而不是只测适配层):
//     优先级裁决只发生在内核一处 (resolveDeltaVector) —— 适配层测不到"两个端口
//     同时在场时谁赢", 而那正是本单最容易写错的地方 (整体覆盖 vs 逐维度).
//
//   反依赖污染:
//     本文件**不 import 任何 @nestjs/* / typeorm / qdrant** —— 它是内核边界的一部分.
//     深路径 import (in-memory/*) 是为了直接 new 内存实现, 与既有 WP26 / WP34 测试同款做法.
//
//   验证: npx vitest run test/engine-core/wp60-delta-table-config.spec.ts

import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository.js';
import { InMemoryEngineSession } from '../../src/engine-core/in-memory/in-memory-engine-session.js';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store.js';
import {
  aggregateTurnDelta,
  createEmptyBdiSnapshot,
  DEFAULT_ALLIANCE_CONFIG,
  DEFAULT_DELTA_TABLE_CONFIG,
  transitionState,
  type AllianceConfig,
  type CounselorEventKind,
  type DeltaTableConfig,
  type EventClassifier,
  type SessionEvent,
} from '../../src/engine-core/index.js';

/** 共情事件 (DELTA_TABLE 基础值: trust +0.10 / safety +0.02 / bond +0.01). */
const EMPATHY: SessionEvent = { kind: 'empathy', matchedTerms: [], strength: 1 };
/** 评判事件 (trust -0.12 / safety -0.03 / bond -0.02). */
const JUDGMENT: SessionEvent = { kind: 'judgment', matchedTerms: [], strength: 1 };
/** 强度 0.5 的共情 (验强度乘法仍然作用). */
const HALF_EMPATHY: SessionEvent = { kind: 'empathy', matchedTerms: [], strength: 0.5 };

/** 造一份 alliance 端口 (只覆写 safety / bond —— 这是该端口的形状). */
function allianceConfig(safety: number, bond: number): AllianceConfig {
  return {
    deltas: { empathy: { safety, bond } },
    thresholds: DEFAULT_ALLIANCE_CONFIG.thresholds,
  };
}

describe('WP60 · delta 规则表端口 (内核)', () => {
  describe('① 不传配置 = 逐字不变 (零回归)', () => {
    it('aggregateTurnDelta 不传任何端口 → 内核种子值逐字一致', () => {
      const delta = aggregateTurnDelta([EMPATHY]);

      expect(delta.trust).toBeCloseTo(0.1, 10);
      expect(delta.safety).toBeCloseTo(0.02, 10);
      expect(delta.bond).toBeCloseTo(0.01, 10);
      expect(delta.verbal).toBeCloseTo(-0.03, 10);
      expect(delta.depth).toBeCloseTo(-0.02, 10);
      expect(delta.style).toBeCloseTo(-0.01, 10);
      expect(delta.valence).toBeCloseTo(0.03, 10);
      expect(delta.arousal).toBeCloseTo(-0.02, 10);
      expect(delta.positive).toBeCloseTo(0.03, 10);
      expect(delta.negative).toBeCloseTo(0, 10);
      expect(delta.dependency).toBeCloseTo(0, 10);
    });

    it('传空的 deltaTable 端口 → 与不传逐字一致 (端口存在但没覆写 = 没配)', () => {
      expect(aggregateTurnDelta([EMPATHY], undefined, DEFAULT_DELTA_TABLE_CONFIG)).toEqual(aggregateTurnDelta([EMPATHY]));
    });

    it('只传 alliance 端口 → 仍然只有 safety / bond 被改 (旧行为不变)', () => {
      const delta = aggregateTurnDelta([EMPATHY], allianceConfig(0.05, 0.03));

      expect(delta.safety).toBeCloseTo(0.05, 10);
      expect(delta.bond).toBeCloseTo(0.03, 10);
      expect(delta.trust).toBeCloseTo(0.1, 10);
      expect(delta.valence).toBeCloseTo(0.03, 10);
    });
  });

  describe('② 覆写按维度生效 (不是按事件整体覆盖)', () => {
    it('只覆写 trust → 其余 10 个维度仍走基础值', () => {
      const delta = aggregateTurnDelta([EMPATHY], undefined, { deltas: { empathy: { trust: 0.2 } } });

      expect(delta.trust).toBeCloseTo(0.2, 10);
      expect(delta.safety).toBeCloseTo(0.02, 10);
      expect(delta.bond).toBeCloseTo(0.01, 10);
      expect(delta.valence).toBeCloseTo(0.03, 10);
      expect(delta.arousal).toBeCloseTo(-0.02, 10);
    });

    it('覆写 safety → bond 仍走基础值 (两个维度各管各的)', () => {
      const delta = aggregateTurnDelta([EMPATHY], undefined, { deltas: { empathy: { safety: 0.08 } } });

      expect(delta.safety).toBeCloseTo(0.08, 10);
      expect(delta.bond).toBeCloseTo(0.01, 10);
    });

    it('覆写只作用于**单事件** → 另一个事件不受影响', () => {
      const delta = aggregateTurnDelta([EMPATHY, JUDGMENT], undefined, { deltas: { empathy: { trust: 0.2 } } });

      expect(delta.trust).toBeCloseTo(0.2 - 0.12, 10);
    });

    it('强度乘法仍然作用 (覆写的是系数, 不是最终值)', () => {
      const delta = aggregateTurnDelta([HALF_EMPATHY], undefined, { deltas: { empathy: { trust: 0.2 } } });

      expect(delta.trust).toBeCloseTo(0.1, 10);
    });

    it('没配的事件 → 走基础值', () => {
      const delta = aggregateTurnDelta([EMPATHY, JUDGMENT], undefined, { deltas: { acceptance: { trust: 0.5 } } });

      expect(delta.trust).toBeCloseTo(0.1 - 0.12, 10);
      expect(delta.safety).toBeCloseTo(0.02 - 0.03, 10);
    });
  });

  describe('③ 逐维度优先级: deltaTable > alliance > 基础值', () => {
    it('deltaTable 覆写的维度赢; alliance 覆写的维度次之; 其余走基础值', () => {
      const delta = aggregateTurnDelta([EMPATHY], allianceConfig(0.05, 0.03), { deltas: { empathy: { trust: 0.2 } } });

      // trust: deltaTable 的覆写值.
      expect(delta.trust).toBeCloseTo(0.2, 10);
      // safety / bond: deltaTable 没覆写 → alliance 的覆写值.
      expect(delta.safety).toBeCloseTo(0.05, 10);
      expect(delta.bond).toBeCloseTo(0.03, 10);
      // 其余维度: 都没覆写 → 基础值.
      expect(delta.valence).toBeCloseTo(0.03, 10);
      expect(delta.arousal).toBeCloseTo(-0.02, 10);
    });

    it('两个端口覆写**同一个维度** → deltaTable 赢 (不打架, 只有一个生效)', () => {
      const delta = aggregateTurnDelta([EMPATHY], allianceConfig(0.05, 0.03), { deltas: { empathy: { safety: 0.09 } } });

      expect(delta.safety).toBeCloseTo(0.09, 10);
    });
  });

  describe('④ 非法值逐项回退基础值 (端口是公开契约)', () => {
    it('NaN / Infinity → 回退基础值 (绝不产生 NaN 增量)', () => {
      const delta = aggregateTurnDelta([EMPATHY], undefined, {
        deltas: { empathy: { trust: Number.NaN, valence: Number.POSITIVE_INFINITY } },
      });

      expect(delta.trust).toBeCloseTo(0.1, 10);
      expect(delta.valence).toBeCloseTo(0.03, 10);
      expect(Number.isNaN(delta.trust)).toBe(false);
    });

    it('0 是**合法值** (该维度本轮完全不涨), 不当"缺项"回退', () => {
      const delta = aggregateTurnDelta([EMPATHY], undefined, { deltas: { empathy: { trust: 0 } } });

      expect(delta.trust).toBeCloseTo(0, 10);
    });

    it('deltaTable 的非法值 → 回退到 alliance 的覆写值 (而不是直接跳到基础值)', () => {
      const delta = aggregateTurnDelta([EMPATHY], allianceConfig(0.05, 0.03), { deltas: { empathy: { safety: Number.NaN } } });

      expect(delta.safety).toBeCloseTo(0.05, 10);
    });
  });

  describe('⑤ transitionState 路径也吃这个端口', () => {
    it('options.deltaTable 生效 (与直接调 aggregateTurnDelta 同口径)', () => {
      const snapshot = createEmptyBdiSnapshot();
      const next = transitionState(snapshot, [EMPATHY], { deltaTable: { deltas: { empathy: { trust: 0.15 } } } });

      expect(next.trust - snapshot.trust).toBeCloseTo(0.15, 10);
    });

    it('不传 deltaTable → 落库口径与改造前逐字一致', () => {
      const snapshot = createEmptyBdiSnapshot();
      const next = transitionState(snapshot, [EMPATHY]);

      expect(next.trust - snapshot.trust).toBeCloseTo(0.1, 10);
    });
  });

  describe('⑥ 会话注入路径 (构造注入 → 落库快照跟着变)', () => {
    /** 固定事件序列的分类器 (测试台): 命中即一条共情. */
    const classifier: EventClassifier = {
      classify: (text: string): readonly SessionEvent[] =>
        text === 'empathy' ? [{ kind: 'empathy', matchedTerms: [], strength: 1 }] : [{ kind: 'neutral', matchedTerms: [], strength: 1 }],
    };

    /** 建一个确定性会话, 跑一轮, 返回落库快照的 trust. */
    async function turnTrust(deltaTable?: DeltaTableConfig): Promise<number> {
      const clock = 1_700_000_000_000;
      let idSeq = 0;
      const session = new InMemoryEngineSession({
        bdiStates: new InMemoryBdiStateRepository(),
        memories: new InMemoryMemoryStore({ now: () => clock }),
        idFactory: () => {
          idSeq += 1;
          return 'wp60-id-' + idSeq;
        },
        now: () => clock,
        classifier,
        ...(deltaTable ? { deltaTableConfig: deltaTable } : {}),
      });
      const handle = session.openSession({ sessionId: 'session-1', tenantId: 'default', visitorId: 'visitor-1', seed: 7 });
      const out = await session.turn(handle.handleId, { userText: 'empathy' });
      return out.snapshot.trust;
    }

    it('注入 deltaTable 端口 → 落库快照的 trust 跟着变', async () => {
      const base = await turnTrust();
      const overridden = await turnTrust({ deltas: { empathy: { trust: 0.15 } } });

      // 基础系数 trust +0.10 → 覆写成 +0.15 → 差 0.05.
      expect(overridden - base).toBeCloseTo(0.05, 10);
    });

    it('不注入 → 与改造前逐字一致 (零回归)', async () => {
      const base = await turnTrust();

      expect(base).toBeCloseTo(0.4, 10);
    });
  });

  describe('⑦ 事件类型穷举 (端口表覆盖全部 11 种事件)', () => {
    it('每种事件都能被覆写, 且覆写是**替换**而不是叠加', () => {
      const kinds: readonly CounselorEventKind[] = [
        'empathy',
        'acceptance',
        'normalization',
        'open_probe',
        'affirmation',
        'judgment',
        'preaching',
        'minimizing',
        'boundary_cross',
        'sensitive_touch',
        'neutral',
      ];

      for (const kind of kinds) {
        const event: SessionEvent = { kind, matchedTerms: [], strength: 1 };
        const overridden = aggregateTurnDelta([event], undefined, { deltas: { [kind]: { trust: 0.02 } } });

        expect(overridden.trust).toBeCloseTo(0.02, 10);
      }
    });
  });
});
