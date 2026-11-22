// V2026-11-11 I-20 (引擎内核 · 情绪两维角色级调节系数):
//   目的: 钉死 "valence / arousal 也走角色级系数端口" 这条规则 ——
//     ① 种子全 1.0 → 输出与改动前**逐字相同** (零行为变化);
//     ② 新系数 >1 / <1 **只放大正向增量**, 负向增量逐字不动;
//     ③ 端口缺字段 / 非法值 → 逐项回落 1.0 (不产生 NaN / Infinity).
//
//   为什么"负向不动"要单独钉死:
//     任务单 §4 明确 "不发明临床数字" —— 依恋对 valence / arousal **受损**方向的
//     影响系数没有依据. 若实现顺手也乘了系数, 后果是 "回避型被否定时情绪跌得更慢"
//     这种没依据的行为 —— 必须挡住.
//
//   边界: 纯内核断言, 零 @nestjs / 零 env / 零 IO.
//
//   验证: pnpm exec vitest run test/engine-core/i20-valence-arousal-role-coefficients.spec.ts

import { describe, expect, it } from 'vitest';

import {
  aggregateTurnDelta,
  DEFAULT_PERSONALITY_MODULATOR_CONFIG,
  modulateDeltaByPersonality,
  type PersonalityModulatorConfig,
  type SessionEvent,
} from '../../src/engine-core/index.js';

/** 内核种子值 (断言里的期望值全部对照它, 不另立一份真相源). */
const SEED = DEFAULT_PERSONALITY_MODULATOR_CONFIG;

/** 一条"咨询师表达共情"事件 (正向: valence +0.03 / arousal -0.02). */
const EMPATHY: SessionEvent = { kind: 'empathy', matchedTerms: ['我能理解你'], strength: 1 };

/** 一条"咨询师评判"事件 (受损方向对照: valence -0.12 / arousal +0.06). */
const JUDGMENT: SessionEvent = { kind: 'judgment', matchedTerms: ['你就是太敏感了'], strength: 1 };

describe('I-20 · valence / arousal 角色级调节系数', () => {
  describe('① 种子全 1.0 → 输出与改动前逐字相同 (零行为变化)', () => {
    it('四种依恋类型的 valence 增益逐字等于原始 delta (系数全 1.0)', () => {
      const base = aggregateTurnDelta([EMPATHY]);

      for (const style of ['secure', 'avoidant', 'anxious', 'disorganized'] as const) {
        const modulated = modulateDeltaByPersonality(base, { attachmentStyle: style });
        expect(modulated.valence).toBe(base.valence);
      }
    });

    it('四种依恋类型的 arousal 逐字等于原始 delta (系数全 1.0)', () => {
      const base = aggregateTurnDelta([EMPATHY]);

      for (const style of ['secure', 'avoidant', 'anxious', 'disorganized'] as const) {
        const modulated = modulateDeltaByPersonality(base, { attachmentStyle: style });
        expect(modulated.arousal).toBe(base.arousal);
      }
    });

    it('种子表两种情绪系数一律 1.0 (临床差异化倍率待标定单)', () => {
      for (const style of ['secure', 'avoidant', 'anxious', 'disorganized'] as const) {
        expect(SEED.attachment[style].valenceScale).toBe(1);
        expect(SEED.attachment[style].arousalScale).toBe(1);
      }
    });

    it('无依恋类型 → 整个 delta 逐字不变 (中性回落全 1.0)', () => {
      const base = aggregateTurnDelta([EMPATHY]);

      expect(modulateDeltaByPersonality(base, {})).toEqual(base);
      expect(modulateDeltaByPersonality(base, { attachmentStyle: undefined })).toEqual(base);
    });

    it('受损方向的事件 (valence -0.12) 逐字不动 —— 种子全 1.0 时无任何改动', () => {
      const base = aggregateTurnDelta([JUDGMENT]);

      expect(base.valence).toBeLessThan(0);
      for (const style of ['secure', 'avoidant', 'anxious', 'disorganized'] as const) {
        expect(modulateDeltaByPersonality(base, { attachmentStyle: style }).valence).toBe(base.valence);
      }
    });
  });

  describe('② 系数 >1 / <1 只放大正向增量, 负向增量不动', () => {
    /** 造一个只有 valenceScale 不同的配置 (其余系数沿用种子). */
    function withValenceScale(scale: number): PersonalityModulatorConfig {
      return {
        attachment: {
          ...SEED.attachment,
          secure: { ...SEED.attachment.secure, valenceScale: scale },
        },
        agreeableness: SEED.agreeableness,
      };
    }

    /** 造一个只有 arousalScale 不同的配置 (其余系数沿用种子). */
    function withArousalScale(scale: number): PersonalityModulatorConfig {
      return {
        attachment: {
          ...SEED.attachment,
          secure: { ...SEED.attachment.secure, arousalScale: scale },
        },
        agreeableness: SEED.agreeableness,
      };
    }

    it('valenceScale > 1 → 正向 valence 放大, 负向 valence 不动', () => {
      const positive = aggregateTurnDelta([EMPATHY]);
      const negative = aggregateTurnDelta([JUDGMENT]);

      const amplifiedPositive = modulateDeltaByPersonality(positive, {
        attachmentStyle: 'secure',
        config: withValenceScale(2),
      });
      expect(amplifiedPositive.valence).toBeCloseTo(positive.valence * 2, 10);

      const amplifiedNegative = modulateDeltaByPersonality(negative, {
        attachmentStyle: 'secure',
        config: withValenceScale(2),
      });
      expect(amplifiedNegative.valence).toBe(negative.valence);
    });

    it('valenceScale < 1 → 正向 valence 缩小, 负向 valence 不动', () => {
      const positive = aggregateTurnDelta([EMPATHY]);
      const negative = aggregateTurnDelta([JUDGMENT]);

      const dampedPositive = modulateDeltaByPersonality(positive, {
        attachmentStyle: 'secure',
        config: withValenceScale(0.5),
      });
      expect(dampedPositive.valence).toBeCloseTo(positive.valence * 0.5, 10);

      const dampedNegative = modulateDeltaByPersonality(negative, {
        attachmentStyle: 'secure',
        config: withValenceScale(0.5),
      });
      expect(dampedNegative.valence).toBe(negative.valence);
    });

    it('arousalScale > 1 → 正向 arousal 放大, 负向 arousal 不动', () => {
      const positive = aggregateTurnDelta([JUDGMENT]); // arousal +0.06
      const negative = aggregateTurnDelta([EMPATHY]); // arousal -0.02

      expect(positive.arousal).toBeGreaterThan(0);
      expect(negative.arousal).toBeLessThan(0);

      const amplifiedPositive = modulateDeltaByPersonality(positive, {
        attachmentStyle: 'secure',
        config: withArousalScale(3),
      });
      expect(amplifiedPositive.arousal).toBeCloseTo(positive.arousal * 3, 10);

      const amplifiedNegative = modulateDeltaByPersonality(negative, {
        attachmentStyle: 'secure',
        config: withArousalScale(3),
      });
      expect(amplifiedNegative.arousal).toBe(negative.arousal);
    });

    it('arousalScale < 1 → 正向 arousal 缩小, 负向 arousal 不动', () => {
      const positive = aggregateTurnDelta([JUDGMENT]);
      const negative = aggregateTurnDelta([EMPATHY]);

      const dampedPositive = modulateDeltaByPersonality(positive, {
        attachmentStyle: 'secure',
        config: withArousalScale(0.25),
      });
      expect(dampedPositive.arousal).toBeCloseTo(positive.arousal * 0.25, 10);

      const dampedNegative = modulateDeltaByPersonality(negative, {
        attachmentStyle: 'secure',
        config: withArousalScale(0.25),
      });
      expect(dampedNegative.arousal).toBe(negative.arousal);
    });

    it('两个系数互相独立: 改 valenceScale 不动 arousal (端口注入)', () => {
      const base = aggregateTurnDelta([EMPATHY]);

      const modulated = modulateDeltaByPersonality(base, {
        attachmentStyle: 'secure',
        config: withValenceScale(4),
      });

      expect(modulated.valence).toBeCloseTo(base.valence * 4, 10);
      expect(modulated.arousal).toBe(base.arousal);
    });

    it('情绪两维不影响 trust / safety / bond (逐维度隔离)', () => {
      const base = aggregateTurnDelta([EMPATHY]);

      const modulated = modulateDeltaByPersonality(base, {
        attachmentStyle: 'secure',
        config: withValenceScale(4),
      });

      expect(modulated.trust).toBe(base.trust);
      expect(modulated.safety).toBe(base.safety);
      expect(modulated.bond).toBe(base.bond);
    });
  });

  describe('③ 端口缺字段 / 非法值 → 逐项回落 1.0', () => {
    it('端口缺这两个字段 → 回落种子 1.0 (不是中性也不是 undefined)', () => {
      const base = aggregateTurnDelta([EMPATHY]);
      const partial = {
        attachment: {
          secure: { trustScale: 1, resistanceScale: 1, safetyScale: 1, bondScale: 1 },
        },
        agreeableness: SEED.agreeableness,
      } as unknown as PersonalityModulatorConfig;

      const modulated = modulateDeltaByPersonality(base, { attachmentStyle: 'secure', config: partial });
      expect(modulated.valence).toBe(base.valence);
      expect(modulated.arousal).toBe(base.arousal);
      expect(Number.isFinite(modulated.valence)).toBe(true);
      expect(Number.isFinite(modulated.arousal)).toBe(true);
    });

    it('非法值 (NaN / 负数 / 无穷) → 逐项回落 1.0, 不产生 NaN / Infinity', () => {
      const base = aggregateTurnDelta([EMPATHY]);
      const broken: PersonalityModulatorConfig = {
        attachment: {
          ...SEED.attachment,
          secure: { ...SEED.attachment.secure, valenceScale: Number.NaN, arousalScale: -1 },
          anxious: { ...SEED.attachment.anxious, valenceScale: Number.POSITIVE_INFINITY, arousalScale: -2 },
        },
        agreeableness: SEED.agreeableness,
      };

      const secure = modulateDeltaByPersonality(base, { attachmentStyle: 'secure', config: broken });
      expect(secure.valence).toBe(base.valence);
      expect(secure.arousal).toBe(base.arousal);

      const anxious = modulateDeltaByPersonality(base, { attachmentStyle: 'anxious', config: broken });
      expect(anxious.valence).toBe(base.valence);
      expect(anxious.arousal).toBe(base.arousal);
      expect(Number.isFinite(anxious.valence)).toBe(true);
      expect(Number.isFinite(anxious.arousal)).toBe(true);
    });

    it('系数 0 是合法值 (该维度本轮完全不涨), 不当非法值回退', () => {
      // EMPATHY: valence +0.03 (正向) / arousal -0.02 (负向).
      // JUDGMENT: valence -0.12 (负向) / arousal +0.06 (正向).
      const empathy = aggregateTurnDelta([EMPATHY]);
      const judgment = aggregateTurnDelta([JUDGMENT]);
      const zeroed: PersonalityModulatorConfig = {
        attachment: {
          ...SEED.attachment,
          secure: { ...SEED.attachment.secure, valenceScale: 0, arousalScale: 0 },
        },
        agreeableness: SEED.agreeableness,
      };

      // 正向增量 × 0 → 该维度本轮完全不涨.
      expect(modulateDeltaByPersonality(empathy, { attachmentStyle: 'secure', config: zeroed }).valence).toBe(0);
      expect(modulateDeltaByPersonality(judgment, { attachmentStyle: 'secure', config: zeroed }).arousal).toBe(0);
      // 负向增量不动 (受损方向无系数).
      expect(modulateDeltaByPersonality(judgment, { attachmentStyle: 'secure', config: zeroed }).valence).toBe(judgment.valence);
      expect(modulateDeltaByPersonality(empathy, { attachmentStyle: 'secure', config: zeroed }).arousal).toBe(empathy.arousal);
    });
  });
});
