// V2026-11-04 WP53 (引擎内核 · 人格调节算子扩展到同盟三维):
//   目的: 钉死"依恋系数也能调节 safety / bond 的**增益**速度"这条规则 ——
//     ① 四种依恋类型的 safety 增益各不相同 (回避型最慢, 安全型基准);
//     ② 四种依恋类型的 bond 增益各不相同 (焦虑型最快, 回避型最慢);
//     ③ 只调**增益**方向: safety / bond 受损时, 各依恋类型下降速率逐字一致;
//     ④ 与 trustScale / resistanceScale **叠加**正确 (同一条 delta 同时受四个系数影响);
//     ⑤ 非法 safetyScale / bondScale → 逐项回退内核种子值;
//     ⑥ 缺省配置零回归 (无依恋类型 → delta 逐字不变);
//     ⑦ 与 AllianceConfig 覆写叠加正确 (先覆写, 再调节);
//     ⑧ 调节仍在 cap **之前** (被放大的 safety / bond 依然受单回合 cap 约束);
//     ⑨ 会话层: 落库路径真的带上调节, 且与内核 transitionState 路径逐字一致.
//
//   为什么"受损方向不调"要单独钉死:
//     任务单 §4.2 明确"不发明临床数字" —— 依恋对安全感/纽带**受损**的影响系数没有
//     依据, 于是受损方向一律保持基准速率. 这条如果被误实现 (比如顺手也乘了系数),
//     后果是"回避型被否定时安全感掉得更慢"这种没依据的行为 —— 必须挡住.
//
//   为什么"先覆写再调节"的顺序要单独钉死:
//     AllianceConfig.deltas 是**事件级**覆写 (改基础系数), safetyScale / bondScale
//     是**角色级**调节 (在基础系数上再乘一刀). 顺序反了 = 两者的语义互换
//     (覆写会盖掉调节) —— 结果数值不同, 所以钉数值就能钉住顺序.
//
//   边界: 纯内核断言, 零 @nestjs / 零 env / 零 IO.
//
//   验证: npx vitest run test/engine-core/wp53-personality-alliance-extension.spec.ts

import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository.js';
import { InMemoryEngineSession } from '../../src/engine-core/in-memory/in-memory-engine-session.js';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store.js';
import {
  aggregateTurnDelta,
  createEmptyBdiSnapshot,
  DEFAULT_ALLIANCE_CONFIG,
  DEFAULT_PERSONALITY_MODULATOR_CONFIG,
  modulateDeltaByPersonality,
  transitionState,
  type AllianceConfig,
  type AttachmentStyle,
  type CharacterProfile,
  type PersonalityModulatorConfig,
  type SessionEvent,
  type TurnDeltaCapReport,
} from '../../src/engine-core/index.js';

/** 四种依恋类型 (顺序即断言顺序). */
const STYLES: readonly AttachmentStyle[] = ['secure', 'avoidant', 'anxious', 'disorganized'];

/** 一条"咨询师表达共情"事件 (正向: trust / safety / bond 都是增益). */
const EMPATHY: SessionEvent = { kind: 'empathy', matchedTerms: ['我能理解你'], strength: 1 };

/** 一条"咨询师评判"事件 (受损方向对照: trust / safety / bond 全是负). */
const JUDGMENT: SessionEvent = { kind: 'judgment', matchedTerms: ['你就是太敏感了'], strength: 1 };

/**
 * 一条"咨询师触碰敏感议题"事件 —— safety 受损但 trust 不动.
 *
 * 用来钉住"**逐维度**只调增益方向": 如果实现误写成"trust 受损就整体不调",
 * 这条事件的 safety 就分不清了.
 */
const SENSITIVE_TOUCH: SessionEvent = { kind: 'sensitive_touch', matchedTerms: ['童年'], strength: 1 };

/** 内核种子值 (断言里的期望值全部对照它, 不另立一份真相源). */
const SEED = DEFAULT_PERSONALITY_MODULATOR_CONFIG;

/** 取某依恋类型调完 safety 后的值. */
function safetyOf(base: ReturnType<typeof aggregateTurnDelta>, style: AttachmentStyle): number {
  return modulateDeltaByPersonality(base, { attachmentStyle: style }).safety;
}

/** 取某依恋类型调完 bond 后的值. */
function bondOf(base: ReturnType<typeof aggregateTurnDelta>, style: AttachmentStyle): number {
  return modulateDeltaByPersonality(base, { attachmentStyle: style }).bond;
}

describe('WP53 · 人格调节算子扩展到同盟三维 (safety / bond)', () => {
  describe('① 四种依恋类型的 safety 增益各不相同', () => {
    it('共情事件: safety 增益按 1.0 / 0.5 / 0.7 / 0.6 区分', () => {
      const base = aggregateTurnDelta([EMPATHY]);

      const safetyByStyle = STYLES.map((style) => safetyOf(base, style));

      expect(safetyByStyle[0]).toBeCloseTo(0.02, 10); // secure   ×1.0
      expect(safetyByStyle[1]).toBeCloseTo(0.01, 10); // avoidant ×0.5
      expect(safetyByStyle[2]).toBeCloseTo(0.014, 10); // anxious  ×0.7
      expect(safetyByStyle[3]).toBeCloseTo(0.012, 10); // disorganized ×0.6
      expect(new Set(safetyByStyle.map((value) => value.toFixed(8))).size).toBe(4);
    });

    it('回避型的 safety 增量只有安全型的一半 (任务单 §6.1 验收)', () => {
      const base = aggregateTurnDelta([EMPATHY]);

      expect(safetyOf(base, 'avoidant')).toBeCloseTo(safetyOf(base, 'secure') / 2, 10);
    });

    it('safety 基准值不被任何依恋类型放大 (secure 是基准, 其余更慢)', () => {
      const base = aggregateTurnDelta([EMPATHY]);

      for (const style of STYLES) {
        expect(safetyOf(base, style)).toBeLessThanOrEqual(base.safety);
      }
    });
  });

  describe('② 四种依恋类型的 bond 增益各不相同', () => {
    it('共情事件: bond 增益按 1.0 / 0.5 / 1.3 / 0.8 区分', () => {
      const base = aggregateTurnDelta([EMPATHY]);

      const bondByStyle = STYLES.map((style) => bondOf(base, style));

      expect(bondByStyle[0]).toBeCloseTo(0.01, 10); // secure   ×1.0
      expect(bondByStyle[1]).toBeCloseTo(0.005, 10); // avoidant ×0.5
      expect(bondByStyle[2]).toBeCloseTo(0.013, 10); // anxious  ×1.3
      expect(bondByStyle[3]).toBeCloseTo(0.008, 10); // disorganized ×0.8
      expect(new Set(bondByStyle.map((value) => value.toFixed(8))).size).toBe(4);
    });

    it('焦虑型的 bond 增量比安全型大 30% (任务单 §6.1 验收)', () => {
      const base = aggregateTurnDelta([EMPATHY]);

      expect(bondOf(base, 'anxious')).toBeCloseTo(bondOf(base, 'secure') * 1.3, 10);
    });

    it('焦虑型是唯一 bond 涨得**比安全型快**的依恋类型 (急于建立连接)', () => {
      const base = aggregateTurnDelta([EMPATHY]);

      expect(bondOf(base, 'anxious')).toBeGreaterThan(bondOf(base, 'secure'));
      expect(bondOf(base, 'avoidant')).toBeLessThan(bondOf(base, 'secure'));
      expect(bondOf(base, 'disorganized')).toBeLessThan(bondOf(base, 'secure'));
    });
  });

  describe('③ 只调增益方向: 受损方向逐字一致', () => {
    it('评判事件 (safety / bond 均为负): 四种依恋类型的 safety 下降速率一致', () => {
      const base = aggregateTurnDelta([JUDGMENT]);

      const safetyByStyle = STYLES.map((style) => safetyOf(base, style));

      for (const value of safetyByStyle) {
        expect(value).toBe(base.safety);
      }
      expect(new Set(safetyByStyle.map((value) => value.toFixed(8))).size).toBe(1);
    });

    it('评判事件 (safety / bond 均为负): 四种依恋类型的 bond 下降速率一致', () => {
      const base = aggregateTurnDelta([JUDGMENT]);

      const bondByStyle = STYLES.map((style) => bondOf(base, style));

      for (const value of bondByStyle) {
        expect(value).toBe(base.bond);
      }
      expect(new Set(bondByStyle.map((value) => value.toFixed(8))).size).toBe(1);
    });

    it('逐维度: safety 受损但 trust 不动的事件, safety 仍不被调节 (不是"整体不调")', () => {
      const base = aggregateTurnDelta([SENSITIVE_TOUCH]);

      // sensitive_touch: trust 0 (不动), safety -0.01 (受损), bond 0 (不动).
      expect(base.trust).toBe(0);
      expect(base.safety).toBeLessThan(0);

      for (const style of STYLES) {
        expect(safetyOf(base, style)).toBe(base.safety);
        expect(bondOf(base, style)).toBe(base.bond);
      }
    });
  });

  describe('④ 与 trustScale / resistanceScale 叠加正确', () => {
    it('同一条 empathy delta 同时受四个系数影响 (回避型)', () => {
      const base = aggregateTurnDelta([EMPATHY]);

      const modulated = modulateDeltaByPersonality(base, { attachmentStyle: 'avoidant' });

      // trust: 增益 ×0.6; safety / bond: 增益 ×0.5; 阻抗下降量 ÷ 1.3.
      expect(modulated.trust).toBeCloseTo(0.1 * 0.6, 10);
      expect(modulated.safety).toBeCloseTo(0.02 * 0.5, 10);
      expect(modulated.bond).toBeCloseTo(0.01 * 0.5, 10);
      expect(modulated.verbal).toBeCloseTo(-0.08 / 1.3, 10);
      expect(modulated.depth).toBeCloseTo(-0.1 / 1.3, 10);
      expect(modulated.style).toBeCloseTo(-0.06 / 1.3, 10);
    });

    it('四个系数互相独立: 改一个不动另一个 (端口注入)', () => {
      const base = aggregateTurnDelta([EMPATHY]);
      const custom: PersonalityModulatorConfig = {
        attachment: {
          ...SEED.attachment,
          avoidant: { trustScale: 1, resistanceScale: 1, safetyScale: 0.25, bondScale: 2 },
        },
        agreeableness: SEED.agreeableness,
      };

      const modulated = modulateDeltaByPersonality(base, { attachmentStyle: 'avoidant', config: custom });

      expect(modulated.trust).toBeCloseTo(0.1, 10); // trustScale 改了 → 不再是 0.6
      expect(modulated.safety).toBeCloseTo(0.02 * 0.25, 10);
      expect(modulated.bond).toBeCloseTo(0.01 * 2, 10);
      expect(modulated.verbal).toBeCloseTo(-0.08, 10); // resistanceScale = 1 → 不再除 1.3
    });
  });

  describe('⑤ 非法 safetyScale / bondScale → 逐项回退种子值', () => {
    it('非数字 / 负数 / 无穷 逐项回退, 不产生 NaN / Infinity', () => {
      const base = aggregateTurnDelta([EMPATHY]);
      const broken: PersonalityModulatorConfig = {
        attachment: {
          ...SEED.attachment,
          avoidant: { trustScale: 1, resistanceScale: 1, safetyScale: Number.NaN, bondScale: -1 },
          anxious: { trustScale: 1, resistanceScale: 1, safetyScale: Number.POSITIVE_INFINITY, bondScale: -2 },
        },
        agreeableness: SEED.agreeableness,
      };

      const avoidant = modulateDeltaByPersonality(base, { attachmentStyle: 'avoidant', config: broken });
      expect(avoidant.safety).toBeCloseTo(0.02 * 0.5, 10); // 回退种子 0.5
      expect(avoidant.bond).toBeCloseTo(0.01 * 0.5, 10); // 回退种子 0.5
      expect(Number.isFinite(avoidant.safety)).toBe(true);
      expect(Number.isFinite(avoidant.bond)).toBe(true);

      const anxious = modulateDeltaByPersonality(base, { attachmentStyle: 'anxious', config: broken });
      expect(anxious.safety).toBeCloseTo(0.02 * 0.7, 10); // 回退种子 0.7
      expect(anxious.bond).toBeCloseTo(0.01 * 1.3, 10); // 回退种子 1.3
    });

    it('系数 0 是合法值 (该维度本轮完全不涨), 不当非法值回退', () => {
      const base = aggregateTurnDelta([EMPATHY]);
      const zeroed: PersonalityModulatorConfig = {
        attachment: {
          ...SEED.attachment,
          avoidant: { trustScale: 1, resistanceScale: 1, safetyScale: 0, bondScale: 0 },
        },
        agreeableness: SEED.agreeableness,
      };

      const modulated = modulateDeltaByPersonality(base, { attachmentStyle: 'avoidant', config: zeroed });

      expect(modulated.safety).toBe(0);
      expect(modulated.bond).toBe(0);
    });
  });

  describe('⑥ 缺省配置零回归', () => {
    it('无依恋类型 → delta 逐字不变', () => {
      const base = aggregateTurnDelta([EMPATHY]);

      expect(modulateDeltaByPersonality(base, {})).toEqual(base);
      expect(modulateDeltaByPersonality(base, { attachmentStyle: undefined, traits: undefined })).toEqual(base);
    });

    it('未知依恋类型 (运行时脏值) → 回落 ×1.0, delta 逐字不变', () => {
      const base = aggregateTurnDelta([EMPATHY]);
      const dirty = 'unknown' as unknown as AttachmentStyle;

      expect(modulateDeltaByPersonality(base, { attachmentStyle: dirty })).toEqual(base);
    });

    it('secure 型 = 原 delta (逐字, 四列全是 ×1.0)', () => {
      const base = aggregateTurnDelta([EMPATHY]);

      expect(modulateDeltaByPersonality(base, { attachmentStyle: 'secure' })).toEqual(base);
    });

    it('宜人性不扩展到 safety / bond (任务单 §4.1)', () => {
      const base = aggregateTurnDelta([EMPATHY]);

      const modulated = modulateDeltaByPersonality(base, {
        attachmentStyle: 'secure',
        traits: { agreeableness: 0.9 },
        events: [EMPATHY],
      });

      // 宜人性只放大 trust, safety / bond 逐字不动.
      expect(modulated.trust).toBeCloseTo(0.1 * 1.1, 10);
      expect(modulated.safety).toBe(base.safety);
      expect(modulated.bond).toBe(base.bond);
    });
  });

  describe('⑦ 与 AllianceConfig 覆写叠加正确 (先覆写, 再调节)', () => {
    it('事件级覆写后, 角色级系数再乘一刀 (顺序不能反)', () => {
      const alliance: AllianceConfig = {
        deltas: { empathy: { safety: 0.1, bond: 0.06 } },
        thresholds: DEFAULT_ALLIANCE_CONFIG.thresholds,
      };
      const base = aggregateTurnDelta([EMPATHY], alliance);

      // 覆写先落地: safety 0.1 / bond 0.06.
      expect(base.safety).toBeCloseTo(0.1, 10);
      expect(base.bond).toBeCloseTo(0.06, 10);

      // 再乘回避型的 0.5 → 0.05 / 0.03.
      const modulated = modulateDeltaByPersonality(base, { attachmentStyle: 'avoidant' });
      expect(modulated.safety).toBeCloseTo(0.05, 10);
      expect(modulated.bond).toBeCloseTo(0.03, 10);
    });

    it('覆写只给 safety 时, bond 仍走 DELTA_TABLE 基础值再乘系数', () => {
      const alliance: AllianceConfig = {
        deltas: { empathy: { safety: 0.1 } },
        thresholds: DEFAULT_ALLIANCE_CONFIG.thresholds,
      };
      const base = aggregateTurnDelta([EMPATHY], alliance);

      expect(base.safety).toBeCloseTo(0.1, 10);
      expect(base.bond).toBeCloseTo(0.01, 10); // 没覆写 → 基础值

      const modulated = modulateDeltaByPersonality(base, { attachmentStyle: 'avoidant' });
      expect(modulated.safety).toBeCloseTo(0.05, 10);
      expect(modulated.bond).toBeCloseTo(0.005, 10);
    });
  });

  describe('⑧ 调节仍在 cap 之前 (被放大的 safety / bond 依然受 cap 约束)', () => {
    it('safety 被放大到超过上向 cap → 被砍到 0.2', () => {
      const amplified: PersonalityModulatorConfig = {
        attachment: {
          ...SEED.attachment,
          secure: { trustScale: 1, resistanceScale: 1, safetyScale: 100, bondScale: 1 },
        },
        agreeableness: SEED.agreeableness,
      };
      const reports: TurnDeltaCapReport[] = [];

      const next = transitionState(createEmptyBdiSnapshot(), [EMPATHY], {
        personality: { attachmentStyle: 'secure', config: amplified },
        observer: (report) => reports.push(report),
      });

      // 0.02 × 100 = 2.0 → cap 上向 0.2 → 基线 0.5 + 0.2.
      expect(next.safety).toBeCloseTo(0.7, 10);
      const safetyEntry = reports[0]?.entries.find((entry) => entry.dimension === 'safety');
      expect(safetyEntry?.raw).toBeCloseTo(2, 10);
      expect(safetyEntry?.capped).toBeCloseTo(0.2, 10);
    });

    it('bond 被放大到超过上向 cap → 被砍到 0.2 (与 trust / safety 同档)', () => {
      const amplified: PersonalityModulatorConfig = {
        attachment: {
          ...SEED.attachment,
          secure: { trustScale: 1, resistanceScale: 1, safetyScale: 1, bondScale: 100 },
        },
        agreeableness: SEED.agreeableness,
      };

      const next = transitionState(createEmptyBdiSnapshot(), [EMPATHY], {
        personality: { attachmentStyle: 'secure', config: amplified },
      });

      // 0.01 × 100 = 1.0 → cap 上向 0.2 → 基线 0 + 0.2.
      expect(next.bond).toBeCloseTo(0.2, 10);
    });
  });

  describe('会话层: 落库路径真的带上同盟三维的调节', () => {
    /** 造一个确定性会话 (内存仓储 + 固定时钟 / id). */
    function createHarness(profile: CharacterProfile) {
      const bdiStates = new InMemoryBdiStateRepository();
      let idSeq = 0;
      const now = (): number => 1_700_000_000_000;
      const memories = new InMemoryMemoryStore({ now });
      const session = new InMemoryEngineSession({
        bdiStates,
        memories,
        idFactory: () => {
          idSeq += 1;
          return `wp53-id-${idSeq}`;
        },
        now,
      });
      const handle = session.openSession({ sessionId: 's1', tenantId: 'default', visitorId: 'v1', characterProfile: profile });
      return { session, handleId: handle.handleId };
    }

    /** 回避型角色 (trust / safety / bond 都涨得慢). */
    const avoidantProfile: CharacterProfile = {
      coreBeliefs: [],
      forbiddenBehaviors: [],
      sensitiveTopics: [],
      attachmentStyle: 'avoidant',
    };

    it('落库路径: 回避型的 safety / bond 增益都被调节', async () => {
      const { session, handleId } = createHarness(avoidantProfile);

      const out = await session.turn(handleId, { userText: '听起来你现在一定很难受, 我能理解你' });

      // safety: 0.5 + 0.02 × 0.5; bond: 0 + 0.01 × 0.5.
      expect(out.snapshot.safety).toBeCloseTo(0.51, 10);
      expect(out.snapshot.bond).toBeCloseTo(0.005, 10);
    });

    it('落库路径与内核 transitionState 路径逐字一致 (provisional 不漂)', async () => {
      const { session, handleId } = createHarness(avoidantProfile);

      const out = await session.turn(handleId, { userText: '听起来你现在一定很难受, 我能理解你' });

      const expected = transitionState(createEmptyBdiSnapshot(), [EMPATHY], {
        personality: { attachmentStyle: 'avoidant', events: [EMPATHY] },
      });

      expect(out.snapshot.safety).toBeCloseTo(expected.safety, 10);
      expect(out.snapshot.bond).toBeCloseTo(expected.bond, 10);
    });

    it('没有依恋类型的角色 → safety / bond 逐字不变 (既有角色不被破坏)', async () => {
      const neutralProfile: CharacterProfile = {
        coreBeliefs: [],
        forbiddenBehaviors: [],
        sensitiveTopics: [],
      };
      const { session, handleId } = createHarness(neutralProfile);

      const out = await session.turn(handleId, { userText: '听起来你现在一定很难受, 我能理解你' });

      expect(out.snapshot.safety).toBeCloseTo(0.52, 10);
      expect(out.snapshot.bond).toBeCloseTo(0.01, 10);
    });
  });
});
