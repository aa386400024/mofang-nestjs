// V2026-11-10 WP-J (B 层 · 角色基线差异化标定 · 单测):
//   职责: 钉死"8 个角色各自独立基线"这件事的每一条不变量 ——
//     ① 权威表 8 行齐全、字段齐备、templateId 不重;
//     ② 每行的 expectedLabel 与**内核真函数** resolveEmotionLabel 的输出逐行一致
//        (含沉舟 empty / 惊尘 hurt 两个真实函数边界);
//     ③ 任意两角色至少一维差 ≥ 0.05 (可区分) + 每维跨角色跨度 ≥ 0.40 (无维度塌缩);
//     ④ 故意造错 (越界 / 错标签 / 重复 / 不可区分 / 维度塌缩) 时自检**当场报错**;
//     ⑤ A 类 seed 规格的数值是从权威表**装配**来的 (不是抄的第二份);
//     ⑥ 端到端: buildCharacterProfile(seed, undefined) 产出的基线与权威表逐字段一致.
//
//   边界: 全 mock / 纯内存; 不起容器、不连 DB、不发网络.
//
//   为什么标签断言要**调内核那个真函数**而不是写死期望字符串:
//     写死期望 = 又一份真相. 而内核的标签阈值 (valence/arousal → label) 会演进 ——
//     真函数改了而期望值没改, 那条用例就变成"钉住旧行为"的假绿灯.
//     这里直接调 resolveEmotionLabel, 断言"表里的 expectedLabel === 内核现在解出的标签",
//     两边永远同步.
//
//   为什么**不**把 8 行数值再抄一份进测试:
//     任务单红线"数值单一真相源, 禁止第二份硬编码". 测试要守的是**性质**
//     (自检通过 / 标签一致 / 可区分 / 无塌缩 / 装配而非复制), 不是抄一份数字 ——
//     抄一份的真正代价是"改标定表要改两处, 忘了就静默漂".

import { buildCharacterProfileRow } from './character-profile-fixtures.js';
import { VISITOR_POOL_TEMPLATE_SEEDS } from '../../src/counselor/config/visitor-pool-seed.js';
import { buildCharacterProfile } from '../../src/engine-adapters/wiring/character/builtin-character-registry.js';
import {
  BASELINE_CALIBRATION_BY_TEMPLATE_ID,
  BASELINE_DIMENSION_KEYS,
  CHARACTER_BASELINE_CALIBRATION,
  MIN_DIMENSION_SPREAD,
  MIN_ROLE_DIMENSION_DISTANCE,
  getBaselineCalibration,
  validateBaselineCalibration,
  type CharacterBaselineCalibration,
} from '../../src/engine-adapters/wiring/character/character-baseline-calibration.js';
import type { CharacterProfileEntity } from '../../src/engine-adapters/wiring/character/character-profile.entity.js';
import {
  CHARACTER_PROFILE_SEED_SPECS,
  buildCharacterProfileSeeds,
} from '../../src/engine-adapters/wiring/character/character-profile.seed.js';
import { toCharacterSeed } from '../../src/engine-adapters/wiring/character/db-character-profile.resolver.js';
import { resolveEmotionLabel } from '../../src/engine-core/domain/emotion.js';

/**
 * 无临场参数 (自动对练 / 调试路径走的就是这条: 不传 preset).
 *
 * 为什么写成常量而不是直接写 undefined:
 *   lint 规则 unicorn/no-useless-undefined 会把"显式传 undefined"判为冗余 ——
 *   但"显式不传 preset"正是本组用例要表达的东西 (它与"传了一个 preset"是两条不同路径,
 *   值得在代码里看得见), 用具名常量把意图留在明面上.
 */
const NO_PRESET = undefined;

/**
 * 造一条"只填了基线八维"的角色行 (内容列给空, 内容不归本单管).
 *
 * 为什么走**实体行 → toCharacterSeed → buildCharacterProfile** 这条链:
 *   这正是生产路径 (DB 行 → resolver 取行 → 映射 → 内核基线). 直接拿种子喂
 *   buildCharacterProfile 会绕过 toCharacterSeed —— 那一段就没人守了.
 *
 * @param target 标定行
 * @returns 角色行
 */
function buildRow(target: CharacterBaselineCalibration): CharacterProfileEntity {
  // 默认值来自共享夹具 (character-profile-fixtures.ts) —— 本组用例只覆盖标定相关的列.
  return buildCharacterProfileRow({
    id: `row-${target.templateId}`,
    templateId: target.templateId,
    displayName: target.templateId,
    fivePs: {
      presenting: '',
      precipitating: '',
      maintaining: '',
      protective: '',
      vulnerability: '',
    },
    baselineTrust: target.trust,
    baselineResistanceVerbal: target.resistance.verbal,
    baselineResistanceDepth: target.resistance.depth,
    baselineResistanceStyle: target.resistance.style,
    baselineEmotionValence: target.emotion.valence,
    baselineEmotionArousal: target.emotion.arousal,
    baselineSafety: target.safety,
    baselineBond: target.bond,
    auditStatus: 'approved',
  });
}

/**
 * 拷一份标定表 (负向用例专用 —— 不污染权威表本身).
 *
 * @param rows 待拷的行 (缺省 = 权威表)
 * @returns 副本
 */
function cloneTable(rows: readonly CharacterBaselineCalibration[] = CHARACTER_BASELINE_CALIBRATION): CharacterBaselineCalibration[] {
  return rows.map((row) => ({
    ...row,
    resistance: { ...row.resistance },
    emotion: { ...row.emotion },
  }));
}

/**
 * 改一行标定 (负向用例专用).
 *
 * @param rows 标定表副本
 * @param templateId 目标角色
 * @param patch 覆盖字段
 * @returns 新的副本
 */
function withRow(
  rows: readonly CharacterBaselineCalibration[],
  templateId: string,
  patch: Partial<Omit<CharacterBaselineCalibration, 'templateId' | 'resistance' | 'emotion'>> & {
    readonly resistance?: Partial<CharacterBaselineCalibration['resistance']>;
    readonly emotion?: Partial<CharacterBaselineCalibration['emotion']>;
  },
): CharacterBaselineCalibration[] {
  return cloneTable(rows).map((row) => {
    if (row.templateId !== templateId) return row;
    return {
      ...row,
      ...patch,
      resistance: { ...row.resistance, ...patch.resistance },
      emotion: { ...row.emotion, ...patch.emotion },
    };
  });
}

/** 取一行标定 (测试内不允许 undefined 混过去). */
function calibrationOf(templateId: string): CharacterBaselineCalibration {
  const row = BASELINE_CALIBRATION_BY_TEMPLATE_ID.get(templateId);
  if (!row) throw new Error(`标定表里没有 ${templateId}`);
  return row;
}

describe('WP-J · 权威标定表 · 结构', () => {
  it('① 恰好 8 行, templateId 不重, 8 个维度齐全', () => {
    expect(CHARACTER_BASELINE_CALIBRATION).toHaveLength(8);
    expect(BASELINE_CALIBRATION_BY_TEMPLATE_ID.size).toBe(8);
    expect(BASELINE_DIMENSION_KEYS).toHaveLength(8);

    for (const row of CHARACTER_BASELINE_CALIBRATION) {
      expect(row.templateId).toMatch(/^vpt_/);
      expect(Number.isFinite(row.trust)).toBe(true);
      expect(Number.isFinite(row.safety)).toBe(true);
      expect(Number.isFinite(row.bond)).toBe(true);
      for (const key of BASELINE_DIMENSION_KEYS) {
        expect(Number.isFinite(dimensionOf(row, key))).toBe(true);
      }
    }
  });

  it('② 8 个角色都覆盖到了 (A 类 4 + B 类 4), 没有漏角色也没有多角色', () => {
    const templateIds = CHARACTER_BASELINE_CALIBRATION.map((row) => row.templateId).toSorted();

    expect(templateIds).toEqual([
      'vpt_depression_avoidant_l1',
      'vpt_general_secure_l1',
      'vpt_grief_avoidance_l1',
      'vpt_intimate_avoidance_l1',
      'vpt_self_worth_intellectualization_l1',
      'vpt_social_anxious_l1',
      'vpt_trauma_disorganized_l1',
      'vpt_workplace_intellectualization_l1',
    ]);
  });

  it('③ 自检通过 (区间 / 标签 / 可区分 / 无塌缩 四条全过)', () => {
    expect(validateBaselineCalibration(resolveEmotionLabel)).toBeNull();
  });
});

describe('WP-J · 情绪标签 · 用内核真函数逐行核对', () => {
  it('④ 每一行的 expectedLabel 都等于内核 resolveEmotionLabel 的输出', () => {
    for (const row of CHARACTER_BASELINE_CALIBRATION) {
      const actual = resolveEmotionLabel(row.emotion.valence, row.emotion.arousal);
      expect(actual, `角色 ${row.templateId}`).toBe(row.expectedLabel);
    }
  });

  it('⑤ 沉舟落 empty (低唤醒空洞), 惊尘落 hurt (创伤以恐惧为主, 不是 angry)', () => {
    const chuanzhou = calibrationOf('vpt_depression_avoidant_l1');
    const jingchen = calibrationOf('vpt_trauma_disorganized_l1');

    expect(chuanzhou.expectedLabel).toBe('empty');
    expect(resolveEmotionLabel(chuanzhou.emotion.valence, chuanzhou.emotion.arousal)).toBe('empty');

    expect(jingchen.expectedLabel).toBe('hurt');
    expect(resolveEmotionLabel(jingchen.emotion.valence, jingchen.emotion.arousal)).toBe('hurt');
  });

  it('⑥ 8 个角色的标签分布符合各自的情绪象限 (不是同一个标签刷一遍)', () => {
    const labels = CHARACTER_BASELINE_CALIBRATION.map((row) => row.expectedLabel);

    expect(new Set(labels).size).toBeGreaterThan(1);
    expect(labels.filter((label) => label === 'guarded')).toHaveLength(3);
    expect(labels.filter((label) => label === 'sad')).toHaveLength(2);
    expect(labels).toContain('anxious');
    expect(labels).toContain('empty');
    expect(labels).toContain('hurt');
  });
});

describe('WP-J · 可区分性与无维度塌缩', () => {
  it('⑦ 没有任何一对角色"所有维度差都 < 0.05"', () => {
    const collapsedPairs: string[] = [];

    for (let left = 0; left < CHARACTER_BASELINE_CALIBRATION.length; left += 1) {
      for (let right = left + 1; right < CHARACTER_BASELINE_CALIBRATION.length; right += 1) {
        const first = CHARACTER_BASELINE_CALIBRATION[left];
        const second = CHARACTER_BASELINE_CALIBRATION[right];
        if (!first || !second) continue;
        const maxDiff = Math.max(...BASELINE_DIMENSION_KEYS.map((key) => Math.abs(dimensionOf(first, key) - dimensionOf(second, key))));
        if (maxDiff < MIN_ROLE_DIMENSION_DISTANCE) {
          collapsedPairs.push(`${first.templateId} vs ${second.templateId} (max ${maxDiff.toFixed(4)})`);
        }
      }
    }

    expect(collapsedPairs).toEqual([]);
  });

  it('⑧ 每一维跨 8 个角色的跨度都 ≥ 0.40 (没有维度被压成常数)', () => {
    for (const key of BASELINE_DIMENSION_KEYS) {
      const values = CHARACTER_BASELINE_CALIBRATION.map((row) => dimensionOf(row, key));
      // 独立复算也留浮点容差: 0.70 − 0.30 在 IEEE-754 下 = 0.39999999999999997 (真值就是 0.40).
      const spread = Number((Math.max(...values) - Math.min(...values)).toFixed(6));
      expect(spread, `维度 ${key}`).toBeGreaterThanOrEqual(MIN_DIMENSION_SPREAD);
    }
  });

  it('⑨ 同依恋风格的两个角色**不再同值** (反双胞胎)', () => {
    const anxious = ['vpt_intimate_avoidance_l1', 'vpt_self_worth_intellectualization_l1'];
    const avoidant = ['vpt_grief_avoidance_l1', 'vpt_workplace_intellectualization_l1'];

    for (const [first, second] of [
      [anxious[0], anxious[1]],
      [avoidant[0], avoidant[1]],
    ]) {
      if (!first || !second) continue;
      const a = calibrationOf(first);
      const b = calibrationOf(second);
      const maxDiff = Math.max(...BASELINE_DIMENSION_KEYS.map((key) => Math.abs(dimensionOf(a, key) - dimensionOf(b, key))));
      expect(maxDiff).toBeGreaterThanOrEqual(MIN_ROLE_DIMENSION_DISTANCE);
      // 至少有一维**确实不同** (不是"碰巧差 0.0001").
      expect(
        BASELINE_DIMENSION_KEYS.some((key) => dimensionOf(a, key) !== dimensionOf(b, key)),
        `${first} 与 ${second} 应在至少一维上不同`,
      ).toBe(true);
    }
  });
});

describe('WP-J · 自检的负向用例 (故意造错 → 当场报错)', () => {
  it('⑩ 数值越界 → 报错', () => {
    const broken = withRow(CHARACTER_BASELINE_CALIBRATION, 'vpt_general_secure_l1', { trust: 1.5 });
    const error = validateBaselineCalibration(resolveEmotionLabel, broken);

    expect(error).toContain('越界');
    expect(error).toContain('vpt_general_secure_l1');
  });

  it('⑪ 情绪标签与真实函数不符 → 报错', () => {
    // 沉舟 arousal 抬到 0.4 → 内核会解成 sad, 但表里写的是 empty.
    const broken = withRow(CHARACTER_BASELINE_CALIBRATION, 'vpt_depression_avoidant_l1', {
      emotion: { arousal: 0.4 },
    });
    const error = validateBaselineCalibration(resolveEmotionLabel, broken);

    expect(error).toContain('情绪标签不符');
    expect(error).toContain('vpt_depression_avoidant_l1');
  });

  it('⑫ 角色重复 → 报错', () => {
    const broken = [...cloneTable(), cloneTable()[0]];
    const error = validateBaselineCalibration(resolveEmotionLabel, broken);

    expect(error).toContain('重复');
  });

  it('⑬ 两个角色所有维度都一样 → 报"不可区分"', () => {
    const templateId = 'vpt_self_worth_intellectualization_l1';
    const source = calibrationOf('vpt_intimate_avoidance_l1');
    const broken = withRow(CHARACTER_BASELINE_CALIBRATION, templateId, {
      trust: source.trust,
      resistance: source.resistance,
      emotion: source.emotion,
      safety: source.safety,
      bond: source.bond,
      expectedLabel: source.expectedLabel,
    });
    const error = validateBaselineCalibration(resolveEmotionLabel, broken);

    expect(error).toContain('不可区分');
  });

  it('⑭ 某一维被压成常数 → 报"压成常数"', () => {
    const flattened = cloneTable().map((row) => ({ ...row, bond: 0.5 }));
    const error = validateBaselineCalibration(resolveEmotionLabel, flattened);

    expect(error).toContain('压成常数');
    expect(error).toContain('bond');
  });

  it('⑮ 权威表自身永远通过自检 (改了表忘了跑自检 → 这里会红)', () => {
    expect(validateBaselineCalibration(resolveEmotionLabel, CHARACTER_BASELINE_CALIBRATION)).toBeNull();
  });
});

describe('WP-J · A 类 seed 规格的数值 = 从权威表装配 (不是抄的第二份)', () => {
  it('⑯ 4 个 seed 规格的八个数值逐字等于权威表对应行', () => {
    for (const spec of CHARACTER_PROFILE_SEED_SPECS) {
      const target = calibrationOf(spec.templateId);
      expect(spec.trust).toBe(target.trust);
      expect(spec.resistance.verbal).toBe(target.resistance.verbal);
      expect(spec.resistance.depth).toBe(target.resistance.depth);
      expect(spec.resistance.style).toBe(target.resistance.style);
      expect(spec.emotion.valence).toBe(target.emotion.valence);
      expect(spec.emotion.arousal).toBe(target.emotion.arousal);
      expect(spec.safety).toBe(target.safety);
      expect(spec.bond).toBe(target.bond);
    }
  });

  it('⑰ seed 构建出的行带上标定后的数值 (灌库载荷拿到的就是这份)', () => {
    const seeds = buildCharacterProfileSeeds(VISITOR_POOL_TEMPLATE_SEEDS);

    for (const seed of seeds) {
      const target = calibrationOf(seed.templateId);
      expect(seed.trust).toBe(target.trust);
      expect(seed.resistance).toEqual(target.resistance);
      expect(seed.emotion).toEqual(target.emotion);
      expect(seed.safety).toBe(target.safety);
      expect(seed.bond).toBe(target.bond);
    }
  });

  it('⑱ 内容字段一字未动 (beliefMeta / fivePs / 愿望 / 约束 / 敏感议题 仍在)', () => {
    for (const spec of CHARACTER_PROFILE_SEED_SPECS) {
      expect(spec.beliefMeta.length).toBeGreaterThan(0);
      expect(spec.underlyingDesires.length).toBeGreaterThan(0);
      expect(spec.forbiddenBehaviors.length).toBeGreaterThan(0);
      expect(spec.sensitiveTopics.length).toBeGreaterThan(0);
      expect(spec.fivePs.presenting.length).toBeGreaterThan(0);
    }
  });
});

describe('WP-J · 端到端: buildCharacterProfile(seed, undefined) 与权威表逐字段一致', () => {
  it('⑲ 8 个角色的内核基线 = 权威表, 标签 = 内核真函数的输出', () => {
    for (const target of CHARACTER_BASELINE_CALIBRATION) {
      const profile = buildCharacterProfile(toCharacterSeed(buildRow(target)), NO_PRESET);
      const baseline = profile.baseline;

      expect(baseline?.trust, `${target.templateId} trust`).toBe(target.trust);
      expect(baseline?.resistance?.verbal).toBe(target.resistance.verbal);
      expect(baseline?.resistance?.depth).toBe(target.resistance.depth);
      expect(baseline?.resistance?.style).toBe(target.resistance.style);
      expect(baseline?.emotion?.valence).toBe(target.emotion.valence);
      expect(baseline?.emotion?.arousal).toBe(target.emotion.arousal);
      expect(baseline?.safety).toBe(target.safety);
      expect(baseline?.bond).toBe(target.bond);

      const valence = baseline?.emotion?.valence ?? 0;
      const arousal = baseline?.emotion?.arousal ?? 0;
      expect(resolveEmotionLabel(valence, arousal), `${target.templateId} 标签`).toBe(target.expectedLabel);
    }
  });

  it('⑳ 端到端产出的 8 组基线彼此可区分 (换角色 → 行为真的不同)', () => {
    const profiles = CHARACTER_BASELINE_CALIBRATION.map((target) => buildCharacterProfile(toCharacterSeed(buildRow(target)), NO_PRESET));

    for (let left = 0; left < profiles.length; left += 1) {
      for (let right = left + 1; right < profiles.length; right += 1) {
        const first = profiles[left]?.baseline;
        const second = profiles[right]?.baseline;
        if (!first || !second) continue;
        const maxDiff = Math.max(
          Math.abs((first.trust ?? 0) - (second.trust ?? 0)),
          Math.abs((first.resistance?.verbal ?? 0) - (second.resistance?.verbal ?? 0)),
          Math.abs((first.resistance?.depth ?? 0) - (second.resistance?.depth ?? 0)),
          Math.abs((first.resistance?.style ?? 0) - (second.resistance?.style ?? 0)),
          Math.abs((first.emotion?.valence ?? 0) - (second.emotion?.valence ?? 0)),
          Math.abs((first.emotion?.arousal ?? 0) - (second.emotion?.arousal ?? 0)),
          Math.abs((first.safety ?? 0) - (second.safety ?? 0)),
          Math.abs((first.bond ?? 0) - (second.bond ?? 0)),
        );
        expect(maxDiff).toBeGreaterThanOrEqual(MIN_ROLE_DIMENSION_DISTANCE);
      }
    }
  });
});

describe('WP-J · 取值辅助函数', () => {
  it('㉑ getBaselineCalibration 取得到 / 取不到就抛', () => {
    expect(getBaselineCalibration('vpt_general_secure_l1').trust).toBe(calibrationOf('vpt_general_secure_l1').trust);
    expect(() => getBaselineCalibration('vpt_not_exist')).toThrow('缺少模板');
  });
});

/**
 * 取一行标定的某维数值 (与自检口径一致).
 *
 * @param row 标定行
 * @param key 维度名
 * @returns 该维数值
 */
function dimensionOf(row: CharacterBaselineCalibration, key: (typeof BASELINE_DIMENSION_KEYS)[number]): number {
  switch (key) {
    case 'trust':
      return row.trust;
    case 'verbal':
      return row.resistance.verbal;
    case 'depth':
      return row.resistance.depth;
    case 'style':
      return row.resistance.style;
    case 'valence':
      return row.emotion.valence;
    case 'arousal':
      return row.emotion.arousal;
    case 'safety':
      return row.safety;
    case 'bond':
      return row.bond;
  }
}
