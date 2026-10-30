// V2026-10-28 WP1 (引擎内核 · BDI 认知引擎规则轨单测):
//   目的: 证明事件分类 → 状态迁移 → 意图规划这条规则轨真的按 delta 表推进,
//         且可复现、可 clamp、默认基线 / 角色注入 / resume 不覆盖都成立.
//
//   反依赖污染: 不 import 任何 @nestjs/* / typeorm; 只用内核纯 TS + 内存实现.
//   验证: npx jest test/engine-core/wp1-bdi.spec.ts

import { createEmptyBdiSnapshot, type CharacterProfile, type EngineTurnOutput } from '../../src/engine-core';
import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository';
import { InMemoryEngineSession } from '../../src/engine-core/in-memory/in-memory-engine-session';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store';

/** 测试台: 内存仓储 + 确定性时钟 / id. */
function createHarness() {
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
      return `wp1-id-${idSeq}`;
    },
    now,
  });
  return { bdiStates, memories, session };
}

const TENANT = 'default';

/** 跑一轮并返回出参 (便捷封装). */
async function turn(session: InMemoryEngineSession, handleId: string, userText: string): Promise<EngineTurnOutput> {
  return session.turn(handleId, { userText });
}

describe('WP1 · BDI 认知引擎 (规则轨)', () => {
  describe('默认基线 (无 profile 全新会话)', () => {
    it('neutral 文本不改变状态, 首轮即为中性默认基线', async () => {
      const { session } = createHarness();
      const handle = session.openSession({ sessionId: 's1', tenantId: TENANT, visitorId: 'v1' });

      const out = await turn(session, handle.handleId, '今天天气不错');

      expect(out.snapshot.trust).toBeCloseTo(0.3, 5);
      expect(out.snapshot.resistance).toEqual({ verbal: 0.4, depth: 0.4, style: 0.35 });
      expect(out.snapshot.emotion.valence).toBeCloseTo(0, 5);
      expect(out.snapshot.transference).toEqual({ positive: 0, negative: 0, dependency: 0 });
      expect(out.snapshot.coreBeliefs).toEqual([]);
      expect(out.intention).toBeDefined();
    });
  });

  describe('正向链: 共情 / 接纳 → 提信任 / 降阻抗 / 升效价 / 正移情', () => {
    it('连续 empathy + acceptance 后状态向好推进', async () => {
      const { session } = createHarness();
      const handle = session.openSession({ sessionId: 's1', tenantId: TENANT, visitorId: 'v1' });

      await turn(session, handle.handleId, '听起来你现在一定很难受, 我能理解你');
      const out = await turn(session, handle.handleId, '没关系, 我不会评判你, 你愿意说出来就好');

      expect(out.snapshot.trust).toBeGreaterThan(0.3);
      expect(out.snapshot.resistance.verbal).toBeLessThan(0.4);
      expect(out.snapshot.resistance.depth).toBeLessThan(0.4);
      expect(out.snapshot.emotion.valence).toBeGreaterThan(0);
      expect(out.snapshot.transference.positive).toBeGreaterThan(0);
    });
  });

  describe('负向链: 评判 / 淡化 → 降信任 / 升阻抗 / 降效价 / 负移情', () => {
    it('judgment + minimizing 后状态向防御推进', async () => {
      const { session } = createHarness();
      const handle = session.openSession({ sessionId: 's1', tenantId: TENANT, visitorId: 'v1' });

      await turn(session, handle.handleId, '你就是太敏感了, 这是你自己想多了');
      const out = await turn(session, handle.handleId, '别想太多, 没什么大不了的');

      expect(out.snapshot.trust).toBeLessThan(0.3);
      expect(out.snapshot.resistance.style).toBeGreaterThan(0.35);
      expect(out.snapshot.resistance.depth).toBeGreaterThan(0.4);
      expect(out.snapshot.emotion.valence).toBeLessThan(0);
      expect(out.snapshot.transference.negative).toBeGreaterThan(0);
    });
  });

  describe('触发: 命中敏感议题 → 唤醒上升 / 防御激活, 信任不动', () => {
    it('sensitive_touch 提升 arousal 与防御, trust delta 为 0', async () => {
      const profile: CharacterProfile = {
        coreBeliefs: [],
        forbiddenBehaviors: [],
        sensitiveTopics: ['自杀'],
      };
      const { session } = createHarness();
      const handle = session.openSession({ sessionId: 's1', tenantId: TENANT, visitorId: 'v1', characterProfile: profile });

      const out = await turn(session, handle.handleId, '你之前提到过自杀的想法');

      expect(out.snapshot.trust).toBeCloseTo(0.3, 5);
      expect(out.snapshot.emotion.arousal).toBeGreaterThan(0.3);
      expect(out.snapshot.resistance.verbal).toBeGreaterThan(0.4);
    });
  });

  describe('clamp: 极端连续负向不越界 / 不产生 NaN', () => {
    it('重复 judgment 后所有数值停在边界内', async () => {
      const { session } = createHarness();
      const handle = session.openSession({ sessionId: 's1', tenantId: TENANT, visitorId: 'v1' });

      let out: EngineTurnOutput | null = null;
      for (let i = 0; i < 12; i += 1) {
        out = await turn(session, handle.handleId, '你就是太敏感了, 这是你自己想多了');
      }
      const snap = out!.snapshot;

      expect(snap.trust).toBeGreaterThanOrEqual(0);
      expect(snap.trust).toBeLessThanOrEqual(1);
      for (const dim of ['verbal', 'depth', 'style'] as const) {
        expect(snap.resistance[dim]).toBeGreaterThanOrEqual(0);
        expect(snap.resistance[dim]).toBeLessThanOrEqual(1);
        expect(Number.isNaN(snap.resistance[dim])).toBe(false);
      }
      expect(snap.emotion.valence).toBeGreaterThanOrEqual(-1);
      expect(snap.emotion.valence).toBeLessThanOrEqual(1);
      expect(Number.isNaN(snap.emotion.valence)).toBe(false);
      for (const dim of ['positive', 'negative', 'dependency'] as const) {
        expect(snap.transference[dim]).toBeGreaterThanOrEqual(0);
        expect(snap.transference[dim]).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('角色注入: profile 装配核心信念 / 初始信任 / 禁止行为', () => {
    it('带 profile 的开场状态与 profile 一致, 禁止行为透传进意图', async () => {
      const profile: CharacterProfile = {
        coreBeliefs: [{ theme: 'worthless', statement: '我是没用的人', activationTags: ['失败'] }],
        baseline: { trust: 0.6 },
        forbiddenBehaviors: ['不主动给建议'],
        sensitiveTopics: [],
      };
      const { session } = createHarness();
      const handle = session.openSession({ sessionId: 's1', tenantId: TENANT, visitorId: 'v1', characterProfile: profile });

      const out = await turn(session, handle.handleId, '今天天气不错');

      expect(out.snapshot.coreBeliefs).toHaveLength(1);
      expect(out.snapshot.coreBeliefs[0]?.statement).toBe('我是没用的人');
      expect(out.snapshot.trust).toBeCloseTo(0.6, 5);
      expect(out.intention?.forbiddenBehaviors).toContain('不主动给建议');
    });
  });

  describe('可复现: 同 profile + 同文本序列两遍逐轮快照深比较相等', () => {
    it('两个独立会话跑出完全一致的状态链', async () => {
      const profile: CharacterProfile = {
        coreBeliefs: [],
        forbiddenBehaviors: [],
        sensitiveTopics: ['自杀'],
      };
      const script = ['听起来你现在一定很难受', '你就是太敏感了', '你之前提到过自杀的想法'];

      const run = async (sessionId: string) => {
        const h = createHarness();
        const handle = h.session.openSession({ sessionId, tenantId: TENANT, visitorId: 'v1', characterProfile: profile });
        const snaps: unknown[] = [];
        for (const line of script) {
          const out = await turn(h.session, handle.handleId, line);
          snaps.push(out.snapshot, out.intention);
        }
        return snaps;
      };

      const first = await run('rep-a');
      const second = await run('rep-b');
      expect(first).toEqual(second);
    });
  });

  describe('意图结构: 高阻抗低信任 → resistance, 五字段齐全', () => {
    it('连续负向推高防御后 strategy=resistance 且五字段完整', async () => {
      const { session } = createHarness();
      const handle = session.openSession({ sessionId: 's1', tenantId: TENANT, visitorId: 'v1' });

      let out: EngineTurnOutput | null = null;
      for (let i = 0; i < 8; i += 1) {
        out = await turn(session, handle.handleId, '你就是太敏感了, 这是你自己想多了, 别想太多');
      }
      const intention = out!.intention!;

      expect(intention.strategy).toBe('resistance');
      expect(intention.emotion).toBeDefined();
      expect(intention.resistance).toBeDefined();
      expect(intention.transference).toBeDefined();
      expect(Array.isArray(intention.forbiddenBehaviors)).toBe(true);
    });
  });

  describe('resume 接续: profile 不覆盖上一场状态', () => {
    it('带 resumeFromSessionId 且另给高 trust profile, 开场仍取上一场快照', async () => {
      const { session, bdiStates } = createHarness();

      // 第一场: 用一句 judgment 把信任压下去并落库.
      const prev = session.openSession({ sessionId: 'prev', tenantId: TENANT, visitorId: 'v1' });
      const prevOut = await turn(session, prev.handleId, '你就是太敏感了, 这是你自己想多了');
      session.closeSession(prev.handleId);

      // 第二场: 接续 prev, 但给一个高 trust profile —— 不应覆盖.
      const profile: CharacterProfile = {
        coreBeliefs: [],
        baseline: { trust: 0.9 },
        forbiddenBehaviors: [],
        sensitiveTopics: [],
      };
      const next = session.openSession({
        sessionId: 'next',
        tenantId: TENANT,
        visitorId: 'v1',
        resumeFromSessionId: 'prev',
        characterProfile: profile,
      });
      const nextOut = await turn(session, next.handleId, '今天天气不错');

      expect(nextOut.snapshot.trust).toBeCloseTo(prevOut.snapshot.trust, 5);
      expect(nextOut.snapshot.trust).not.toBeCloseTo(0.9, 5);
      const stored = await bdiStates.load(TENANT, 'next');
      expect(stored?.revision).toBe(1);
    });
  });

  describe('快照工厂: createEmptyBdiSnapshot 返回独立默认基线', () => {
    it('每次调用返回新对象, 数组不共享引用', () => {
      const a = createEmptyBdiSnapshot();
      const b = createEmptyBdiSnapshot();
      expect(a).toEqual(b);
      expect(a.coreBeliefs).not.toBe(b.coreBeliefs);
      expect(a.underlyingDesires).not.toBe(b.underlyingDesires);
    });
  });
});
