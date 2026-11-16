// V2026-11-03 WP34 (引擎内核 · P1 人格调节算子单测):
//   目的: 把任务单 §5 的四条验收机械化 ——
//     ① 同一事件, 四种依恋类型的 delta 各不相同 (验收 #1);
//     ② 基准型 (secure) 与"不调节"逐字一致 (验收 #2 · 零回归);
//     ③ 依恋类型缺失 / 未知 / 系数非法 → 回落 (验收 #3);
//     ④ 调节在 cap 之前, 且系数走**端口**注入 (不是硬编码).
//   边界: 纯内核断言, 零 @nestjs / 零 env / 零 IO.
//
//   验证: npx vitest run test/engine-core/wp34-personality-modulator.spec.ts

import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository.js';
import { InMemoryEngineSession } from '../../src/engine-core/in-memory/in-memory-engine-session.js';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store.js';
import {
  aggregateTurnDelta,
  createEmptyBdiSnapshot,
  DEFAULT_PERSONALITY_MODULATOR_CONFIG,
  modulateDeltaByPersonality,
  transitionState,
  type AttachmentStyle,
  type CharacterProfile,
  type PersonalityModulatorConfig,
  type SessionEvent,
  type TurnDeltaCapReport,
} from '../../src/engine-core/index.js';

/** 四种依恋类型 (顺序即断言顺序). */
const STYLES: readonly AttachmentStyle[] = ['secure', 'avoidant', 'anxious', 'disorganized'];

/** 一条"咨询师表达共情"事件 (任务单 §5 验收 #1 的输入). */
const EMPATHY: SessionEvent = { kind: 'empathy', matchedTerms: ['我能理解你'], strength: 1 };

/** 一条"咨询师评判"事件 (受损方向的对照). */
const JUDGMENT: SessionEvent = { kind: 'judgment', matchedTerms: ['你就是太敏感了'], strength: 1 };

/** 一条"咨询师肯定"事件 (正向信任增益, 但不是共情). */
const AFFIRMATION: SessionEvent = { kind: 'affirmation', matchedTerms: ['你做得很好'], strength: 1 };

/** 内核种子值 (断言里的期望值全部对照它, 不另立一份真相源). */
const SEED = DEFAULT_PERSONALITY_MODULATOR_CONFIG;

describe('WP34 · P1 人格调节算子', () => {
  describe('验收 #1: 同一事件, 四种依恋类型的 delta 各不相同', () => {
    it('共情事件: trust 增益按 1.0 / 0.6 / 1.2 / 0.8 区分', () => {
      const base = aggregateTurnDelta([EMPATHY]);

      const trustByStyle = STYLES.map((style) => modulateDeltaByPersonality(base, { attachmentStyle: style }).trust);

      expect(trustByStyle[0]).toBeCloseTo(0.1, 10); // secure ×1.0
      expect(trustByStyle[1]).toBeCloseTo(0.06, 10); // avoidant ×0.6
      expect(trustByStyle[2]).toBeCloseTo(0.12, 10); // anxious ×1.2
      expect(trustByStyle[3]).toBeCloseTo(0.08, 10); // disorganized ×0.8
      // 四个值互不相同 (任务单验收 #1 的字面要求).
      expect(new Set(trustByStyle.map((value) => value.toFixed(8))).size).toBe(4);
    });

    it('共情事件: 阻抗下降幅度 回避型 < 安全型 < 焦虑型 (回避型不快速敞开心扉)', () => {
      const base = aggregateTurnDelta([EMPATHY]);

      const verbalByStyle = STYLES.map((style) => modulateDeltaByPersonality(base, { attachmentStyle: style }).verbal);

      // 种子值: secure 1.0 / avoidant 1.3 / anxious 0.8 / disorganized 1.2.
      expect(verbalByStyle[0]).toBeCloseTo(-0.03, 10);
      expect(verbalByStyle[1]).toBeCloseTo(-0.03 / 1.3, 10);
      expect(verbalByStyle[2]).toBeCloseTo(-0.03 / 0.8, 10);
      expect(verbalByStyle[3]).toBeCloseTo(-0.03 / 1.2, 10);
      // 下降幅度 (绝对值): 回避型最小, 焦虑型最大.
      expect(Math.abs(verbalByStyle[1] ?? 0)).toBeLessThan(Math.abs(verbalByStyle[0] ?? 0));
      expect(Math.abs(verbalByStyle[2] ?? 0)).toBeGreaterThan(Math.abs(verbalByStyle[0] ?? 0));
    });

    it('受损方向不调节 (不发明惩罚系数): 评判事件的 delta 四种类型逐字相同', () => {
      const base = aggregateTurnDelta([JUDGMENT]);

      for (const style of STYLES) {
        expect(modulateDeltaByPersonality(base, { attachmentStyle: style })).toEqual(base);
      }
    });
  });

  describe('验收 #2: 基准型与"不调节"逐字一致 (零回归)', () => {
    it('secure 型 = 原 delta (逐字)', () => {
      const base = aggregateTurnDelta([EMPATHY]);
      expect(modulateDeltaByPersonality(base, { attachmentStyle: 'secure' })).toEqual(base);
    });

    it('无角色数据 (无依恋类型 / 无特质) = 原 delta (逐字)', () => {
      const base = aggregateTurnDelta([EMPATHY]);
      expect(modulateDeltaByPersonality(base, {})).toEqual(base);
      expect(modulateDeltaByPersonality(base, { attachmentStyle: undefined, traits: undefined })).toEqual(base);
    });

    it('内核种子值本身是恒等 (secure 1.0 / 1.0, 宜人性阈值之上才生效)', () => {
      // WP53: 依恋系数扩到 4 列 (trust / resistance / safety / bond).
      // I-20: 情绪两维系数追加 (valenceScale / arousalScale), 四种依恋类型一律 1.0.
      expect(SEED.attachment.secure).toEqual({
        trustScale: 1,
        resistanceScale: 1,
        safetyScale: 1,
        bondScale: 1,
        valenceScale: 1,
        arousalScale: 1,
      });
      expect(SEED.attachment.avoidant).toEqual({
        trustScale: 0.6,
        resistanceScale: 1.3,
        safetyScale: 0.5,
        bondScale: 0.5,
        valenceScale: 1,
        arousalScale: 1,
      });
      expect(SEED.attachment.anxious).toEqual({
        trustScale: 1.2,
        resistanceScale: 0.8,
        safetyScale: 0.7,
        bondScale: 1.3,
        valenceScale: 1,
        arousalScale: 1,
      });
      expect(SEED.attachment.disorganized).toEqual({
        trustScale: 0.8,
        resistanceScale: 1.2,
        safetyScale: 0.6,
        bondScale: 0.8,
        valenceScale: 1,
        arousalScale: 1,
      });
      expect(SEED.agreeableness).toEqual({ trustScale: 1.1, highThreshold: 0.7 });
    });
  });

  describe('验收 #3: 边界回落 (依恋类型缺失 / 未知 / 系数非法)', () => {
    it('未知依恋类型 (运行时脏值) → 回落 ×1.0', () => {
      const base = aggregateTurnDelta([EMPATHY]);
      const dirty = 'unknown' as unknown as AttachmentStyle;
      expect(modulateDeltaByPersonality(base, { attachmentStyle: dirty })).toEqual(base);
    });

    it('系数非法 (非有限 / 负 / 除数为 0) → 逐项回退内核种子值', () => {
      const base = aggregateTurnDelta([EMPATHY]);
      const broken: PersonalityModulatorConfig = {
        attachment: {
          // WP53: 同盟三维的两个增益系数也一并弄坏 —— 验证它们与 trust 一样逐项回退.
          secure: { trustScale: Number.NaN, resistanceScale: -1, safetyScale: Number.NaN, bondScale: -1, valenceScale: 1, arousalScale: 1 },
          avoidant: {
            trustScale: Number.POSITIVE_INFINITY,
            resistanceScale: 0,
            safetyScale: -2,
            bondScale: Number.NaN,
            valenceScale: 1,
            arousalScale: 1,
          },
          anxious: { trustScale: -2, resistanceScale: Number.NaN, safetyScale: 1, bondScale: 1, valenceScale: 1, arousalScale: 1 },
          disorganized: { trustScale: 1, resistanceScale: 1, safetyScale: 1, bondScale: 1, valenceScale: 1, arousalScale: 1 },
        },
        agreeableness: { trustScale: Number.NaN, highThreshold: 5 },
      };

      // avoidant: trustScale 无穷 → 回退 0.6; resistanceScale 0 (除数) → 回退 1.3.
      const avoidant = modulateDeltaByPersonality(base, { attachmentStyle: 'avoidant', config: broken });
      expect(avoidant.trust).toBeCloseTo(0.06, 10);
      expect(avoidant.verbal).toBeCloseTo(-0.03 / 1.3, 10);

      // anxious: trustScale 负 → 回退 1.2; resistanceScale NaN → 回退 0.8.
      const anxious = modulateDeltaByPersonality(base, { attachmentStyle: 'anxious', config: broken });
      expect(anxious.trust).toBeCloseTo(0.12, 10);
      expect(anxious.verbal).toBeCloseTo(-0.03 / 0.8, 10);
    });

    it('端口缺该项 → 用内核种子值 (不是中性)', () => {
      const base = aggregateTurnDelta([EMPATHY]);
      const partial = {
        agreeableness: SEED.agreeableness,
      } as unknown as PersonalityModulatorConfig;

      const avoidant = modulateDeltaByPersonality(base, { attachmentStyle: 'avoidant', config: partial });
      expect(avoidant.trust).toBeCloseTo(0.06, 10);
      expect(avoidant.verbal).toBeCloseTo(-0.03 / 1.3, 10);
    });
  });

  describe('人格特质调节 (WP34 §3.2 的示例规则: 宜人性高 → 共情回应 trust 增益 ×1.1)', () => {
    it('宜人性达阈值 → 共情回合的 trust 增益 ×1.1', () => {
      const base = aggregateTurnDelta([EMPATHY]);

      const modulated = modulateDeltaByPersonality(base, {
        attachmentStyle: 'secure',
        traits: { agreeableness: 0.9 },
        events: [EMPATHY],
      });

      expect(modulated.trust).toBeCloseTo(0.11, 10);
    });

    it('宜人性未达阈值 → 不放大', () => {
      const base = aggregateTurnDelta([EMPATHY]);

      const modulated = modulateDeltaByPersonality(base, {
        attachmentStyle: 'secure',
        traits: { agreeableness: 0.5 },
        events: [EMPATHY],
      });

      expect(modulated.trust).toBeCloseTo(0.1, 10);
    });

    it('本轮无共情事件 → 规则不生效 (任务单原文: 宜人性高 → **共情回应**)', () => {
      const base = aggregateTurnDelta([AFFIRMATION]);

      const modulated = modulateDeltaByPersonality(base, {
        attachmentStyle: 'secure',
        traits: { agreeableness: 0.9 },
        events: [AFFIRMATION],
      });

      expect(modulated.trust).toBeCloseTo(0.08, 10);
    });

    it('阈值非法 → 回退种子阈值 0.7', () => {
      const base = aggregateTurnDelta([EMPATHY]);
      const broken = {
        attachment: SEED.attachment,
        agreeableness: { trustScale: 1.1, highThreshold: 5 },
      } satisfies PersonalityModulatorConfig;

      // 阈值 5 非法 → 回退 0.7 → 宜人性 0.6 仍未达标 → 不放大.
      const below = modulateDeltaByPersonality(base, {
        attachmentStyle: 'secure',
        traits: { agreeableness: 0.6 },
        events: [EMPATHY],
        config: broken,
      });
      expect(below.trust).toBeCloseTo(0.1, 10);

      // 宜人性 0.8 达标 → 放大.
      const above = modulateDeltaByPersonality(base, {
        attachmentStyle: 'secure',
        traits: { agreeableness: 0.8 },
        events: [EMPATHY],
        config: broken,
      });
      expect(above.trust).toBeCloseTo(0.11, 10);
    });

    it('宜人性系数与依恋系数**相乘** (两条规则叠加, 不互相覆盖)', () => {
      const base = aggregateTurnDelta([EMPATHY]);

      const modulated = modulateDeltaByPersonality(base, {
        attachmentStyle: 'avoidant',
        traits: { agreeableness: 0.9 },
        events: [EMPATHY],
      });

      // 0.1 × 0.6 (回避型) × 1.1 (高宜人性).
      expect(modulated.trust).toBeCloseTo(0.066, 10);
    });
  });

  describe('端口注入 (系数不是硬编码)', () => {
    it('注入自定义系数 → 结果随之改变', () => {
      const base = aggregateTurnDelta([EMPATHY]);
      const custom: PersonalityModulatorConfig = {
        attachment: {
          ...SEED.attachment,
          avoidant: { trustScale: 0.2, resistanceScale: 2, safetyScale: 0.5, bondScale: 0.5, valenceScale: 1, arousalScale: 1 },
        },
        agreeableness: SEED.agreeableness,
      };

      const modulated = modulateDeltaByPersonality(base, { attachmentStyle: 'avoidant', config: custom });
      expect(modulated.trust).toBeCloseTo(0.02, 10);
      expect(modulated.verbal).toBeCloseTo(-0.015, 10);
    });
  });

  describe('调节的位置: 聚合之后、cap 之前', () => {
    it('被调节放大的 trust 仍然受单回合 cap 约束 (调节不得绕过 cap)', () => {
      const amplified: PersonalityModulatorConfig = {
        attachment: {
          ...SEED.attachment,
          secure: { trustScale: 5, resistanceScale: 1, safetyScale: 1, bondScale: 1, valenceScale: 1, arousalScale: 1 },
        },
        agreeableness: SEED.agreeableness,
      };

      const next = transitionState(createEmptyBdiSnapshot(), [EMPATHY], {
        personality: { attachmentStyle: 'secure', config: amplified },
      });

      // 0.1 × 5 = 0.5 → 被 cap 砍到上向 0.2 → 基线 0.3 + 0.2.
      expect(next.trust).toBeCloseTo(0.5, 10);
    });

    it('cap 报告的 raw 是**人格调节后**的 delta (调节不该混进"砍幅"里)', () => {
      const amplified: PersonalityModulatorConfig = {
        attachment: {
          ...SEED.attachment,
          secure: { trustScale: 5, resistanceScale: 1, safetyScale: 1, bondScale: 1, valenceScale: 1, arousalScale: 1 },
        },
        agreeableness: SEED.agreeableness,
      };
      const reports: TurnDeltaCapReport[] = [];

      transitionState(createEmptyBdiSnapshot(), [EMPATHY], {
        personality: { attachmentStyle: 'secure', config: amplified },
        observer: (report) => reports.push(report),
      });

      const trustEntry = reports[0]?.entries.find((entry) => entry.dimension === 'trust');
      expect(trustEntry?.raw).toBeCloseTo(0.5, 10);
      expect(trustEntry?.capped).toBeCloseTo(0.2, 10);
    });
  });

  describe('会话层: 两处消费人格调节, 口径必须一致', () => {
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
          return `wp34-id-${idSeq}`;
        },
        now,
      });
      const handle = session.openSession({ sessionId: 's1', tenantId: 'default', visitorId: 'v1', characterProfile: profile });
      return { session, handleId: handle.handleId };
    }

    /** 回避型角色 (信任涨得慢 + 阻抗降得少). */
    const avoidantProfile: CharacterProfile = {
      coreBeliefs: [],
      forbiddenBehaviors: [],
      sensitiveTopics: [],
      attachmentStyle: 'avoidant',
    };

    it('落库路径: 回避型的 trust 增益与阻抗下降都被调节', async () => {
      const { session, handleId } = createHarness(avoidantProfile);

      const out = await session.turn(handleId, { userText: '听起来你现在一定很难受, 我能理解你' });

      // trust: 0.3 + 0.1 × 0.6; verbal 阻抗: 0.4 − 0.03 ÷ 1.3.
      expect(out.snapshot.trust).toBeCloseTo(0.36, 10);
      expect(out.snapshot.resistance.verbal).toBeCloseTo(0.4 - 0.03 / 1.3, 10);
    });

    it('落库路径与内核 transitionState 路径逐字一致 (provisional 不漂)', async () => {
      const { session, handleId } = createHarness(avoidantProfile);

      const out = await session.turn(handleId, { userText: '听起来你现在一定很难受, 我能理解你' });

      // 会话层落库 = 事件 delta (人格调节后) → cap → 落快照;
      // 内核 transitionState 走的是同一条管道 —— 无剧本时两者必须相等.
      const expected = transitionState(createEmptyBdiSnapshot(), [EMPATHY], {
        personality: { attachmentStyle: 'avoidant', events: [EMPATHY] },
      });

      expect(out.snapshot.trust).toBeCloseTo(expected.trust, 10);
      expect(out.snapshot.resistance.verbal).toBeCloseTo(expected.resistance.verbal, 10);
      expect(out.snapshot.resistance.depth).toBeCloseTo(expected.resistance.depth, 10);
      expect(out.snapshot.resistance.style).toBeCloseTo(expected.resistance.style, 10);
    });

    it('没有依恋类型的角色 → 逐字不变 (既有角色不被破坏)', async () => {
      const neutralProfile: CharacterProfile = {
        coreBeliefs: [],
        forbiddenBehaviors: [],
        sensitiveTopics: [],
      };
      const { session, handleId } = createHarness(neutralProfile);

      const out = await session.turn(handleId, { userText: '听起来你现在一定很难受, 我能理解你' });

      expect(out.snapshot.trust).toBeCloseTo(0.4, 10);
      expect(out.snapshot.resistance.verbal).toBeCloseTo(0.37, 10);
    });
  });
});
