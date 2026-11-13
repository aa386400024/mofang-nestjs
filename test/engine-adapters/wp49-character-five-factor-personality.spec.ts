// V2026-11-04 WP49 (B 层 · 角色大五人格字段落地 · 单测):
//   职责: 钉死「大五人格从角色种子一路走到 WP34 人格调节算子」这条链的每一环 ——
//     ① 内置种子给了值 → buildCharacterProfile 传进 CharacterProfile.personalityTraits;
//     ② 两个内置种子的 OCEAN 档位按依恋风格分化 (逐字等于任务单 §3.2);
//     ③ 种子没给 → **键不存在** (不是 undefined), 与"说了 0.5"可区分;
//     ④ DB 行 → toCharacterSeed → 内核 (有值传 / NULL 不传);
//     ⑤ 宜人性调节算子**真的活过来** (值不再 undefined → 共情回合 trust ×1.1);
//     ⑥ 逐维归一 (越界夹取 / 脏值按"没说"处理);
//     ⑦ entity 列定义与 migration DDL **对着比** (两边漂移即红) + 幂等 / 自愈 / 回滚 / 双登记.
//
//   为什么"算子活了"要单独钉一条:
//     WP34 的算子早就写好了, 但适配层**一次都没传过数据** —— `traits` 永远是
//     undefined, 于是 `resolveAgreeablenessTrustScale()` 恒返回 1 (不调节).
//     只测"profile 上有值"不够: 中间隔着内核 `InMemoryEngineSession.personalityInput`
//     的 `traits` 组装与算子内部的阈值判断. 断在任一段, 生产上就是"配了但没生效".
//
//   为什么阈值要在测试里**注入**而不是改内核种子值:
//     WP34 的设计是"系数走端口注入" (阈值 `highThreshold` 在 config 里), 所以测试
//     注入一个更低的阈值, 就能证明"数据 → 算子"的**通路**是通的 —— 不依赖任务单
//     给的种子值恰好落在阈值的哪一侧 (那一侧是**校准问题**, 不是**通路问题**).
//     内核种子值一行不动 (engine-core 零改动).
//
//   边界: 全 mock / 纯内存; 不起容器、不连 DB、不发网络.
//
//   验证: npx vitest run test/engine-adapters/wp49-character-five-factor-personality.spec.ts
//   时间戳: 2026-11-04 GMT+8

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { getMetadataArgsStorage } from 'typeorm';

import { buildCharacterProfileRow } from './character-profile-fixtures.js';
import {
  BUILTIN_ANXIOUS_LOW_MOOD_L1,
  BUILTIN_AVOIDANT_L1,
  BUILTIN_CHARACTER_SEEDS,
  buildCharacterProfile,
  type BuiltinCharacterSeed,
} from '../../src/engine-adapters/wiring/character/builtin-character-registry.js';
import { CharacterProfileEntity } from '../../src/engine-adapters/wiring/character/character-profile.entity.js';
import { toCharacterSeed } from '../../src/engine-adapters/wiring/character/db-character-profile.resolver.js';
import {
  DEFAULT_PERSONALITY_MODULATOR_CONFIG,
  modulateDeltaByPersonality,
  type DeltaVector,
  type PersonalityModulatorConfig,
  type SessionEvent,
} from '../../src/engine-core/index.js';
import { AddCharacterProfilePersonalityTraits1714900000028 } from '../../src/migration/1714900000028-AddCharacterProfilePersonalityTraits.js';

/** 本轮加的那一列 (DB 列名). */
const COLUMN = 'personality_traits';

/**
 * 中性依恋系数 (全部 1.0) 的调节配置.
 *
 * 为什么不用内核种子配置: 种子配置里回避型的 trustScale 是 0.6, 依恋系数会**混进**
 * trust 增量里, 让"宜人性贡献了多少"变成一道需要心算的减法. 这里把依恋系数钉成
 * 1.0, 于是 trust 增量的差异**只**可能来自宜人性规则 —— 断言才能写死一个具体数字.
 */
const NEUTRAL_ATTACHMENT: PersonalityModulatorConfig['attachment'] = {
  secure: { trustScale: 1, resistanceScale: 1, safetyScale: 1, bondScale: 1, valenceScale: 1, arousalScale: 1 },
  avoidant: { trustScale: 1, resistanceScale: 1, safetyScale: 1, bondScale: 1, valenceScale: 1, arousalScale: 1 },
  anxious: { trustScale: 1, resistanceScale: 1, safetyScale: 1, bondScale: 1, valenceScale: 1, arousalScale: 1 },
  disorganized: { trustScale: 1, resistanceScale: 1, safetyScale: 1, bondScale: 1, valenceScale: 1, arousalScale: 1 },
};

/** 阈值压到 0.4 的配置 (回避型 0.45 / 焦虑型 0.6 都过线). */
const LOW_THRESHOLD_CONFIG: PersonalityModulatorConfig = {
  attachment: NEUTRAL_ATTACHMENT,
  agreeableness: { trustScale: 1.1, highThreshold: 0.4 },
};

/** 一条共情事件 (宜人性规则只在有共情时生效). */
const EMPATHY_EVENTS: readonly SessionEvent[] = [{ kind: 'empathy', matchedTerms: ['我懂你'], strength: 1 }];

/** 一条只带 trust 增益的 delta (其它维度全 0 → 不会被别的规则动到). */
const TRUST_GAIN_DELTA: DeltaVector = {
  trust: 0.1,
  safety: 0,
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

/**
 * 记录 DDL 的假 QueryRunner.
 *
 * `existingColumns` 走 INFORMATION_SCHEMA 查询 —— 这里让它按"库里已有的列名"返回,
 * 于是同一个假执行器既能演"空表"也能演"本列已在".
 */
class RecordingQueryRunner {
  readonly queries: string[] = [];
  /** INFORMATION_SCHEMA 查询时返回的列名. */
  presentColumns: readonly string[] = [];

  async query(sql: string): Promise<unknown> {
    this.queries.push(sql);
    if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
      return this.presentColumns.map((column) => ({ COLUMN_NAME: column }));
    }
    return [];
  }
}

/** entity 的列元数据 (按 DB 列名索引). */
function entityColumns(): ReadonlyMap<string, { readonly type: string; readonly default?: unknown; readonly nullable?: boolean }> {
  const columns = getMetadataArgsStorage().columns.filter((column) => column.target === CharacterProfileEntity);
  const map = new Map<string, { readonly type: string; readonly default?: unknown; readonly nullable?: boolean }>();
  for (const column of columns) {
    const options = column.options as { name?: string; type?: string; default?: unknown; nullable?: boolean };
    const name = options.name ?? column.propertyName;
    map.set(name, { type: options.type ?? '', default: options.default, nullable: options.nullable });
  }
  return map;
}

/** 造一条 DB 角色行 (字段齐备, 供 toCharacterSeed 消费). */
function makeRow(overrides: Partial<CharacterProfileEntity> = {}): CharacterProfileEntity {
  // 默认值来自共享夹具 (character-profile-fixtures.ts) —— 本组用例只覆盖"大五人格 + 基线数值"相关列.
  // 夹具默认已含 personalityTraits: null (WP49: 大五人格列**可空** = 默认 NULL = 没表态).
  return buildCharacterProfileRow({
    templateId: 'vpt_x',
    baselineTrust: 0.2,
    baselineResistanceVerbal: 0.62,
    baselineResistanceDepth: 0.68,
    baselineResistanceStyle: 0.6,
    baselineEmotionValence: -0.55,
    baselineEmotionArousal: 0.18,
    baselineSafety: 0.25,
    baselineBond: 0.05,
    auditStatus: 'approved',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

/** 一个"什么都没表态"的种子 (用于验证"没说"的分支). */
function plainSeed(): BuiltinCharacterSeed {
  return {
    key: 'plain',
    displayName: '未表态角色',
    attachmentStyle: 'secure',
    coreBeliefs: [],
    underlyingDesires: [],
    forbiddenBehaviors: [],
    sensitiveTopics: [],
    baseline: {
      trust: 0.3,
      resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
      emotion: { valence: 0, arousal: 0.3 },
    },
  };
}

describe('WP49 · 内置种子 → 内核基线', () => {
  it('① buildCharacterProfile 把种子的 personalityTraits 传给内核', () => {
    const profile = buildCharacterProfile(BUILTIN_AVOIDANT_L1);

    expect(profile.personalityTraits).toBeDefined();
    expect(profile.personalityTraits?.openness).toBe(0.4);
    expect(profile.personalityTraits?.conscientiousness).toBe(0.6);
    expect(profile.personalityTraits?.extraversion).toBe(0.25);
    expect(profile.personalityTraits?.agreeableness).toBe(0.45);
    expect(profile.personalityTraits?.neuroticism).toBe(0.65);
  });

  it('② 两个内置种子的 OCEAN 档位逐字等于任务单 §3.2', () => {
    // 回避型: 偏封闭 / 偏尽责 / 偏内向 / 偏低宜人性 / 偏高神经质.
    expect(BUILTIN_AVOIDANT_L1.personalityTraits).toEqual({
      openness: 0.4,
      conscientiousness: 0.6,
      extraversion: 0.25,
      agreeableness: 0.45,
      neuroticism: 0.65,
    });

    // 焦虑型低 mood: 开放性中性 / 略尽责 / 偏内向 / 偏高宜人性 / 高神经质.
    expect(BUILTIN_ANXIOUS_LOW_MOOD_L1.personalityTraits).toEqual({
      openness: 0.5,
      conscientiousness: 0.55,
      extraversion: 0.35,
      agreeableness: 0.6,
      neuroticism: 0.7,
    });
  });

  it('③ 两个内置种子在宜人性 / 外向性上真的分得开 (不是同一组数字)', () => {
    expect(BUILTIN_AVOIDANT_L1.personalityTraits?.agreeableness).toBeLessThan(
      BUILTIN_ANXIOUS_LOW_MOOD_L1.personalityTraits?.agreeableness ?? 0,
    );
    expect(BUILTIN_AVOIDANT_L1.personalityTraits?.extraversion).toBeLessThan(
      BUILTIN_ANXIOUS_LOW_MOOD_L1.personalityTraits?.extraversion ?? 0,
    );
    // 两者的神经质都高 (与依恋风格的"高焦虑"一致), 但不是照抄同一份.
    expect(BUILTIN_AVOIDANT_L1.personalityTraits?.neuroticism).not.toBe(BUILTIN_ANXIOUS_LOW_MOOD_L1.personalityTraits?.neuroticism);
  });

  it('④ 种子没给大五人格 → 键**不存在** (不是 undefined), 与"说了 0.5"可区分', () => {
    const profile = buildCharacterProfile(plainSeed());

    expect('personalityTraits' in profile).toBe(false);
    expect(profile.personalityTraits).toBeUndefined();

    // 内核因此走"不做特质调节" —— delta 逐字不变 (零回归).
    const modulated = modulateDeltaByPersonality(TRUST_GAIN_DELTA, {
      attachmentStyle: 'secure',
      events: EMPATHY_EVENTS,
      config: LOW_THRESHOLD_CONFIG,
    });
    expect(modulated.trust).toBeCloseTo(TRUST_GAIN_DELTA.trust, 10);
  });

  it('⑤ 种子明确给了 0.5 → 键存在且值为 0.5 (不是"没说")', () => {
    const seed = plainSeed();
    const profile = buildCharacterProfile({ ...seed, personalityTraits: { agreeableness: 0.5 } });

    expect('personalityTraits' in profile).toBe(true);
    expect(profile.personalityTraits?.agreeableness).toBe(0.5);
    // 只给了宜人性这一维 → 其余四维仍然"没说" (键不存在).
    expect('openness' in (profile.personalityTraits ?? {})).toBe(false);
  });

  it('⑥ 全部内置种子都给了大五人格 (没有漏表态的)', () => {
    for (const seed of BUILTIN_CHARACTER_SEEDS) {
      expect(seed.personalityTraits).toBeDefined();
      expect(seed.personalityTraits?.agreeableness).toBeTypeOf('number');
    }
  });
});

describe('WP49 · 宜人性调节算子真的活过来了 (WP34 通路)', () => {
  it('⑦ 大五人格有值 → 共情回合的 trust 增益被放大 ×1.1', () => {
    const profile = buildCharacterProfile(BUILTIN_AVOIDANT_L1);

    const modulated = modulateDeltaByPersonality(TRUST_GAIN_DELTA, {
      attachmentStyle: 'avoidant',
      traits: profile.personalityTraits,
      events: EMPATHY_EVENTS,
      config: LOW_THRESHOLD_CONFIG,
    });

    // 0.1 × 1.1 (宜人性) —— 依恋系数已被钉成 1.0, 所以这个数字只可能来自大五人格.
    expect(modulated.trust).toBeCloseTo(0.11, 10);
  });

  it('⑧ 没有大五人格 → 不放大 (算子读到的 traits 是 undefined, 行为逐字不变)', () => {
    const modulated = modulateDeltaByPersonality(TRUST_GAIN_DELTA, {
      attachmentStyle: 'avoidant',
      events: EMPATHY_EVENTS,
      config: LOW_THRESHOLD_CONFIG,
    });

    expect(modulated.trust).toBeCloseTo(TRUST_GAIN_DELTA.trust, 10);
  });

  it('⑨ 留档: 默认阈值 0.7 下, 两个内置种子的宜人性都**低于**阈值 → 当前不触发 ×1.1', () => {
    // 任务单 §3.2 的种子值: 回避型 0.45 / 焦虑型 0.6, 都 < WP34 默认 highThreshold 0.7.
    // 算子的**通路**已通 (值不再 undefined), 但增益暂时不触发 —— 这是**校准问题**,
    // 不是通路问题 (见交付记录 §三 的留档项).
    // ⚠️ 若日后校准把种子值抬到阈值之上, 本条会变红 —— 那是**故意的**:
    //   增益开始生效属于**行为变化**, 必须被显式看见, 不能悄悄发生.
    for (const seed of BUILTIN_CHARACTER_SEEDS) {
      const agreeableness = seed.personalityTraits?.agreeableness ?? 0;
      expect(agreeableness).toBeLessThan(DEFAULT_PERSONALITY_MODULATOR_CONFIG.agreeableness.highThreshold);

      const modulated = modulateDeltaByPersonality(TRUST_GAIN_DELTA, {
        attachmentStyle: seed.attachmentStyle,
        traits: seed.personalityTraits,
        events: EMPATHY_EVENTS,
      });
      // 没有 ×1.1: 回避型 trustScale 0.6 → 0.06; 焦虑型 1.2 → 0.12.
      const expected = TRUST_GAIN_DELTA.trust * DEFAULT_PERSONALITY_MODULATOR_CONFIG.attachment[seed.attachmentStyle].trustScale;
      expect(modulated.trust).toBeCloseTo(expected, 10);
    }
  });
});

describe('WP49 · DB 角色路径: 行 → toCharacterSeed → 内核', () => {
  it('⑩ toCharacterSeed 读 personality_traits 列 (有值就传)', () => {
    const seed = toCharacterSeed(makeRow({ personalityTraits: { agreeableness: 0.8, neuroticism: 0.4 } }));

    expect(seed.personalityTraits).toEqual({ agreeableness: 0.8, neuroticism: 0.4 });
  });

  it('⑪ DB 列是 NULL → **不传** (键都不存在), 内核按"没说"处理', () => {
    const seed = toCharacterSeed(makeRow({ personalityTraits: null }));

    expect('personalityTraits' in seed).toBe(false);
    expect(seed.personalityTraits).toBeUndefined();

    const profile = buildCharacterProfile(seed);
    expect('personalityTraits' in profile).toBe(false);
  });

  it('⑫ DB 路径全链: 行 → 种子 → profile → 算子 (生产数据源走的就是这条)', () => {
    const seed = toCharacterSeed(makeRow({ personalityTraits: { agreeableness: 0.8 } }));
    const profile = buildCharacterProfile(seed);

    const modulated = modulateDeltaByPersonality(TRUST_GAIN_DELTA, {
      attachmentStyle: 'avoidant',
      traits: profile.personalityTraits,
      events: EMPATHY_EVENTS,
      config: LOW_THRESHOLD_CONFIG,
    });

    expect(modulated.trust).toBeCloseTo(0.11, 10);
  });

  it('⑬ resolver 仍是唯一映射入口: 行里的值原样进种子 (映射公式只在 buildCharacterProfile 一份)', () => {
    const seed = toCharacterSeed(makeRow({ personalityTraits: { openness: 0.2 } }));

    expect(seed.personalityTraits?.openness).toBe(0.2);
    // 临场 preset 不覆盖人格底色 (人格是"角色本来是什么样").
    const profile = buildCharacterProfile(seed, { defenseLevel: 1, difficulty: 'L3', style: 'defensive' });
    expect(profile.personalityTraits?.openness).toBe(0.2);
  });
});

describe('WP49 · 逐维归一 (映射层)', () => {
  it('⑭ 越界值被夹回 [0,1] (DB 列是自由 JSON, 运营可能手滑写 1.5 / -0.2)', () => {
    const dirty = buildCharacterProfile({
      ...plainSeed(),
      personalityTraits: { openness: 1.5, agreeableness: -0.2, extraversion: 0.3 },
    });

    expect(dirty.personalityTraits?.openness).toBe(1);
    expect(dirty.personalityTraits?.agreeableness).toBe(0);
    // 合法的值原样保留.
    expect(dirty.personalityTraits?.extraversion).toBe(0.3);
    // 没有因为"多给了维度"就补默认值.
    expect('neuroticism' in (dirty.personalityTraits ?? {})).toBe(false);
  });

  it('⑮ 非有限数 (脏值) 按"没说"处理, 不变成"极端低"', () => {
    const dirty = buildCharacterProfile({
      ...plainSeed(),
      personalityTraits: { agreeableness: Number.NaN, neuroticism: Number.POSITIVE_INFINITY },
    });

    expect('agreeableness' in (dirty.personalityTraits ?? {})).toBe(false);
    expect('neuroticism' in (dirty.personalityTraits ?? {})).toBe(false);
    // 脏值不会被当成"这个人格维度极低"而误触阈值判断.
    const modulated = modulateDeltaByPersonality(TRUST_GAIN_DELTA, {
      attachmentStyle: 'avoidant',
      traits: dirty.personalityTraits,
      events: EMPATHY_EVENTS,
      config: LOW_THRESHOLD_CONFIG,
    });
    expect(modulated.trust).toBeCloseTo(TRUST_GAIN_DELTA.trust, 10);
  });
});

describe('WP49 · entity 列定义与 migration (对着比)', () => {
  it('⑯ entity 上有这一列: json / 可空 / **无默认值**', () => {
    const column = entityColumns().get(COLUMN);

    expect(column).toBeDefined();
    expect(column?.type).toBe('json');
    expect(column?.nullable).toBe(true);
    // 没有 DEFAULT: "没表态"与"某个值"必须在数据源上分得开.
    expect(column?.default).toBeUndefined();
  });

  it('⑰ 属性名与 DB 列名是显式映射 (不靠驼峰自动推导)', () => {
    const properties = getMetadataArgsStorage()
      .columns.filter((column) => column.target === CharacterProfileEntity)
      .map((column) => column.propertyName);

    expect(properties).toContain('personalityTraits');
  });

  it('⑱ 空表 → 发出 1 条 ADD COLUMN, DDL 与 entity 逐字一致 (JSON NULL, 无 DEFAULT)', async () => {
    const qr = new RecordingQueryRunner();
    await new AddCharacterProfilePersonalityTraits1714900000028().up(qr as never);

    const alters = qr.queries.filter((sql) => sql.includes('ADD COLUMN'));
    expect(alters).toHaveLength(1);
    const sql = alters[0] ?? '';
    expect(sql).toContain('personality_traits JSON NULL');
    expect(sql).not.toContain('DEFAULT');
  });

  it('⑲ 幂等: 本列已在 → 一条 ALTER 都不发', async () => {
    const qr = new RecordingQueryRunner();
    qr.presentColumns = [COLUMN];

    await new AddCharacterProfilePersonalityTraits1714900000028().up(qr as never);

    expect(qr.queries.filter((sql) => sql.includes('ADD COLUMN'))).toHaveLength(0);
  });

  it('⑳ down 净删本列, 且缺列时不炸', async () => {
    const qr = new RecordingQueryRunner();
    qr.presentColumns = [COLUMN];

    await new AddCharacterProfilePersonalityTraits1714900000028().down(qr as never);

    const drops = qr.queries.filter((sql) => sql.includes('DROP COLUMN'));
    expect(drops).toHaveLength(1);
    expect(drops[0]).toContain(`DROP COLUMN ${COLUMN}`);

    const empty = new RecordingQueryRunner();
    await new AddCharacterProfilePersonalityTraits1714900000028().down(empty as never);
    expect(empty.queries.filter((sql) => sql.includes('DROP COLUMN'))).toHaveLength(0);
  });

  it('㉑ migration 在 index.ts 与 bin/ormconfig.ts 严格 1:1 登记 (漏登记 = 永不执行)', () => {
    const root = path.join(__dirname, '..', '..');
    const index = readFileSync(path.join(root, 'src', 'migration', 'index.ts'), 'utf8');
    const ormconfig = readFileSync(path.join(root, 'bin', 'ormconfig.ts'), 'utf8');

    expect(index).toContain('AddCharacterProfilePersonalityTraits1714900000028');
    expect(ormconfig).toContain('AddCharacterProfilePersonalityTraits1714900000028');
    // ormconfig 的 migrations 数组里必须真的列上 (只 import 不列 = 同样不执行).
    const arrayStart = ormconfig.indexOf('migrations: [');
    const array = ormconfig.slice(arrayStart, ormconfig.indexOf(']', arrayStart));
    expect(array).toContain('AddCharacterProfilePersonalityTraits1714900000028');
  });
});
