// V2026-11-04 WP51 (B 层 · 角色种子同盟三维基线 · 单测):
//   职责: 钉死「safety / bond 从角色种子一路走到内核快照」这条链的每一环 ——
//     ① 内置种子给了值 → buildCharacterProfile 传进 CharacterProfile.baseline;
//     ② 内置种子的档位按依恋风格分化 (回避型低 / 焦虑型 bond 高);
//     ③ DB 行的两列 → toCharacterSeed → buildCharacterProfile (resolver 是唯一映射入口);
//     ④ seed 内容基线表态 + 灌库载荷带上 + 漂移检测只对"表态过的"生效;
//     ⑤ entity 列定义与 migration DDL **对着比** (两边漂移即红);
//     ⑥ migration 幂等 + 自愈 + 回滚 + **双登记**;
//     ⑦ 不带 safety / bond 的种子仍合法 (别的生产者不必补).
//
//   为什么"entity 与 migration 对着比"要单独钉 (沿用 WP10A 的做法):
//     加列的失败模式是**两边不一致** —— entity 写 default 0.5、migration 写 DEFAULT 0.6,
//     代码不报错、测试也绿, 直到线上某天 seed 灌进去一个 0.6 的行才发现"entity 说的是 0.5".
//
//   为什么"全链"要测到内核快照:
//     单测只测"buildCharacterProfile 传了值"是不够的 —— 中间隔着 toCharacterSeed 与
//     内核 bootstrap 两段. 断在任一段, 生产上就是"角色种子配了但没生效".
//
//   边界: 全 mock / 纯内存; 不起容器、不连 DB、不发网络.
//
//   验证: npx vitest run test/engine-adapters/wp51-character-seed-alliance-baseline.spec.ts
//   时间戳: 2026-11-04 GMT+8

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { getMetadataArgsStorage } from 'typeorm';

import { VISITOR_POOL_TEMPLATE_SEEDS } from '../../src/counselor/config/visitor-pool-seed.js';
import {
  BUILTIN_ANXIOUS_LOW_MOOD_L1,
  BUILTIN_AVOIDANT_L1,
  BUILTIN_CHARACTER_SEEDS,
  buildCharacterProfile,
  type BuiltinCharacterSeed,
} from '../../src/engine-adapters/wiring/character/builtin-character-registry.js';
import { CharacterProfileEntity } from '../../src/engine-adapters/wiring/character/character-profile.entity.js';
import {
  buildCharacterProfileSeeds,
  CHARACTER_PROFILE_SEED_SPECS,
} from '../../src/engine-adapters/wiring/character/character-profile.seed.js';
import { toCharacterSeed } from '../../src/engine-adapters/wiring/character/db-character-profile.resolver.js';
import { buildInitialSnapshot } from '../../src/engine-core/domain/bootstrap.js';
import { AddCharacterProfileAllianceBaseline1714900000027 } from '../../src/migration/1714900000027-AddCharacterProfileAllianceBaseline.js';

/** 本轮加的两列 (列名 → DB 默认值). */
const EXPECTED_COLUMNS: readonly { readonly column: string; readonly default: number; readonly type: string }[] = [
  { column: 'baseline_safety', default: 0.5, type: 'float' },
  { column: 'baseline_bond', default: 0, type: 'float' },
];

/**
 * 记录 DDL 的假 QueryRunner.
 *
 * `existingColumns` 走 INFORMATION_SCHEMA 查询 —— 这里让它按"库里已有的列名"返回,
 * 于是同一个假执行器既能演"空表"也能演"两列都已在".
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
function entityColumns(): ReadonlyMap<string, { readonly type: string; readonly default?: unknown }> {
  const columns = getMetadataArgsStorage().columns.filter((column) => column.target === CharacterProfileEntity);
  const map = new Map<string, { readonly type: string; readonly default?: unknown }>();
  for (const column of columns) {
    const options = column.options as { name?: string; type?: string; default?: unknown };
    const name = options.name ?? column.propertyName;
    map.set(name, { type: options.type ?? '', default: options.default });
  }
  return map;
}

/** 造一条 DB 角色行 (字段齐备, 供 toCharacterSeed 消费). */
function makeRow(overrides: Partial<CharacterProfileEntity> = {}): CharacterProfileEntity {
  return {
    id: 'row-1',
    templateId: 'vpt_x',
    displayName: '测试角色',
    attachmentStyle: 'avoidant',
    fivePs: {
      presenting: '',
      precipitating: '',
      maintaining: '',
      protective: '',
      vulnerability: '',
    },
    baselineTrust: 0.2,
    baselineResistanceVerbal: 0.62,
    baselineResistanceDepth: 0.68,
    baselineResistanceStyle: 0.6,
    baselineEmotionValence: -0.55,
    baselineEmotionArousal: 0.18,
    baselineSafety: 0.25,
    baselineBond: 0.05,
    speechVolumeBaseline: 0.5,
    narrativeStyle: 'mixed',
    expressionTone: 'restrained',
    coreBeliefs: [],
    underlyingDesires: [],
    forbiddenBehaviors: [],
    sensitiveTopics: [],
    auditStatus: 'approved',
    enabled: true,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe('WP51 · 角色种子同盟三维基线 · 内置种子 → 内核快照', () => {
  it('① buildCharacterProfile 把 seed.baseline.safety / bond 传进 CharacterProfile.baseline', () => {
    const profile = buildCharacterProfile(BUILTIN_AVOIDANT_L1);

    expect(profile.baseline?.safety).toBe(0.25);
    expect(profile.baseline?.bond).toBe(0.05);
  });

  it('② 内置种子按依恋风格分化: 回避型 safety 低 / bond 低, 焦虑型 safety 中 / bond 高', () => {
    expect(BUILTIN_AVOIDANT_L1.attachmentStyle).toBe('avoidant');
    expect(BUILTIN_AVOIDANT_L1.baseline.safety).toBe(0.25);
    expect(BUILTIN_AVOIDANT_L1.baseline.bond).toBe(0.05);

    expect(BUILTIN_ANXIOUS_LOW_MOOD_L1.attachmentStyle).toBe('anxious');
    expect(BUILTIN_ANXIOUS_LOW_MOOD_L1.baseline.safety).toBe(0.4);
    expect(BUILTIN_ANXIOUS_LOW_MOOD_L1.baseline.bond).toBe(0.5);

    // 两个内置种子在三维上真的分得开 (不是同一组数字).
    expect(BUILTIN_AVOIDANT_L1.baseline.safety).toBeLessThan(BUILTIN_ANXIOUS_LOW_MOOD_L1.baseline.safety!);
    expect(BUILTIN_AVOIDANT_L1.baseline.bond).toBeLessThan(BUILTIN_ANXIOUS_LOW_MOOD_L1.baseline.bond!);
  });

  it('③ 两个内置种子都能一路走到内核快照 (全链不断)', () => {
    const avoidant = buildInitialSnapshot(buildCharacterProfile(BUILTIN_AVOIDANT_L1));
    const anxious = buildInitialSnapshot(buildCharacterProfile(BUILTIN_ANXIOUS_LOW_MOOD_L1));

    expect(avoidant.safety).toBe(0.25);
    expect(avoidant.bond).toBe(0.05);
    expect(anxious.safety).toBe(0.4);
    expect(anxious.bond).toBe(0.5);
  });

  it('④ 种子没给 safety / bond → 键**不存在** (不是 undefined), 内核走默认值', () => {
    const plainSeed: BuiltinCharacterSeed = {
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

    const profile = buildCharacterProfile(plainSeed);

    // 键不存在 —— 与"种子明确给了 0"能被区分开 (见下面第 ⑤ 条).
    expect('safety' in (profile.baseline ?? {})).toBe(false);
    expect('bond' in (profile.baseline ?? {})).toBe(false);
    // 内核因此走默认值 (0.5 / 0), 与 WP42 逐字一致.
    const snapshot = buildInitialSnapshot(profile);
    expect(snapshot.safety).toBe(0.5);
    expect(snapshot.bond).toBe(0);
  });

  it('⑤ 种子明确给了 0 → 键存在且值为 0 (不是"没给")', () => {
    const zeroSeed: BuiltinCharacterSeed = {
      key: 'zero',
      displayName: '零基线角色',
      attachmentStyle: 'avoidant',
      coreBeliefs: [],
      underlyingDesires: [],
      forbiddenBehaviors: [],
      sensitiveTopics: [],
      baseline: {
        trust: 0.3,
        resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
        emotion: { valence: 0, arousal: 0.3 },
        safety: 0,
        bond: 0,
      },
    };

    const profile = buildCharacterProfile(zeroSeed);

    expect(profile.baseline?.safety).toBe(0);
    expect(profile.baseline?.bond).toBe(0);
    // 内核拿到的是 0, 不是默认值 0.5.
    expect(buildInitialSnapshot(profile).safety).toBe(0);
  });

  it('⑥ 全部内置种子都给了 safety / bond (没有漏表态的)', () => {
    for (const seed of BUILTIN_CHARACTER_SEEDS) {
      expect(seed.baseline.safety).toBeDefined();
      expect(seed.baseline.bond).toBeDefined();
    }
  });
});

describe('WP51 · DB 角色路径: 行 → toCharacterSeed → 内核快照', () => {
  it('⑦ toCharacterSeed 把两列传进种子形状', () => {
    const seed = toCharacterSeed(makeRow());

    expect(seed.baseline.safety).toBe(0.25);
    expect(seed.baseline.bond).toBe(0.05);
  });

  it('⑧ DB 路径全链: 行 → 种子 → profile → 快照 (生产数据源走的就是这条)', () => {
    const snapshot = buildInitialSnapshot(buildCharacterProfile(toCharacterSeed(makeRow())));

    expect(snapshot.safety).toBe(0.25);
    expect(snapshot.bond).toBe(0.05);
  });

  it('⑨ resolver 仍是唯一映射入口: 不在 resolver 里另写一份公式', () => {
    const seed = toCharacterSeed(makeRow({ baselineSafety: 0.9, baselineBond: 0.8 }));

    // 行里的值原样传到种子 (映射公式在 buildCharacterProfile 一份里).
    expect(seed.baseline.safety).toBe(0.9);
    expect(seed.baseline.bond).toBe(0.8);
    // 临场 preset 不覆盖基线 (信任/安全/联结都是"角色本来是什么样").
    const profile = buildCharacterProfile(seed, { defenseLevel: 1, difficulty: 'L3', style: 'defensive' });
    expect(profile.baseline?.safety).toBe(0.9);
    expect(profile.baseline?.bond).toBe(0.8);
  });
});

describe('WP51 · seed 内容基线与灌库载荷', () => {
  it('⑩ 4 个 DB 角色都表态了 safety / bond, 且按 attachmentStyle 分档', () => {
    const byTemplateId = new Map(CHARACTER_PROFILE_SEED_SPECS.map((spec) => [spec.templateId, spec]));

    for (const spec of CHARACTER_PROFILE_SEED_SPECS) {
      expect(spec.safety).toBeDefined();
      expect(spec.bond).toBeDefined();
    }

    // 焦虑型两档: safety 0.4 / bond 0.5 (抄 WP9-A 焦虑型内置种子).
    expect(byTemplateId.get('vpt_intimate_avoidance_l1')?.safety).toBe(0.4);
    expect(byTemplateId.get('vpt_intimate_avoidance_l1')?.bond).toBe(0.5);
    expect(byTemplateId.get('vpt_self_worth_intellectualization_l1')?.safety).toBe(0.4);
    expect(byTemplateId.get('vpt_self_worth_intellectualization_l1')?.bond).toBe(0.5);
    // 回避型两档: safety 0.25 / bond 0.05 (抄 WP9-A 回避型内置种子).
    expect(byTemplateId.get('vpt_workplace_intellectualization_l1')?.safety).toBe(0.25);
    expect(byTemplateId.get('vpt_workplace_intellectualization_l1')?.bond).toBe(0.05);
    expect(byTemplateId.get('vpt_grief_avoidance_l1')?.safety).toBe(0.25);
    expect(byTemplateId.get('vpt_grief_avoidance_l1')?.bond).toBe(0.05);
  });

  it('⑪ 种子构建出的行带上两列 (表态的带值)', () => {
    const seeds = buildCharacterProfileSeeds(VISITOR_POOL_TEMPLATE_SEEDS);
    const wanqing = seeds.find((seed) => seed.templateId === 'vpt_intimate_avoidance_l1');
    const nianan = seeds.find((seed) => seed.templateId === 'vpt_grief_avoidance_l1');

    expect(wanqing?.safety).toBe(0.4);
    expect(wanqing?.bond).toBe(0.5);
    expect(nianan?.safety).toBe(0.25);
    expect(nianan?.bond).toBe(0.05);
  });

  it('⑫ 灌库载荷带上两列, 且 DTO 暴露这两个字段 (运营能改)', () => {
    const dto = readFileSync(
      path.join(__dirname, '..', '..', 'src', 'engine-adapters', 'wiring', 'character', 'character-profile.dto.ts'),
      'utf8',
    );

    expect(dto).toContain('baselineSafety');
    expect(dto).toContain('baselineBond');
  });
});

describe('WP51 · entity 列定义与 migration (对着比)', () => {
  it('⑬ 两列都在 entity 上, 列名 / 类型 / 默认值与内核默认值对齐', () => {
    const columns = entityColumns();

    for (const expected of EXPECTED_COLUMNS) {
      const column = columns.get(expected.column);
      expect(column).toBeDefined();
      expect(column?.type).toBe(expected.type);
      expect(column?.default).toBe(expected.default);
    }
  });

  it('⑭ 属性名与 DB 列名是显式映射 (不靠驼峰自动推导)', () => {
    const properties = getMetadataArgsStorage()
      .columns.filter((column) => column.target === CharacterProfileEntity)
      .map((column) => column.propertyName);

    expect(properties).toContain('baselineSafety');
    expect(properties).toContain('baselineBond');
  });

  it('⑮ 空表 → 发出 2 条 ADD COLUMN, DDL 默认值与 entity 逐字一致', async () => {
    const qr = new RecordingQueryRunner();
    await new AddCharacterProfileAllianceBaseline1714900000027().up(qr as never);

    const alters = qr.queries.filter((sql) => sql.includes('ADD COLUMN'));
    expect(alters).toHaveLength(2);
    const all = alters.join('\n');
    expect(all).toContain('baseline_safety FLOAT NOT NULL DEFAULT 0.5');
    expect(all).toContain('baseline_bond FLOAT NOT NULL DEFAULT 0');
  });

  it('⑯ migration 的 DEFAULT 与 entity 的 default 对得上 (两边漂移即红)', () => {
    const columns = entityColumns();
    const source = readFileSync(
      path.join(__dirname, '..', '..', 'src', 'migration', '1714900000027-AddCharacterProfileAllianceBaseline.ts'),
      'utf8',
    );

    for (const expected of EXPECTED_COLUMNS) {
      expect(source).toContain(`DEFAULT ${String(expected.default)}`);
      expect(columns.get(expected.column)?.default).toBe(expected.default);
    }
  });

  it('⑰ 幂等: 两列都已在 → 一条 ALTER 都不发', async () => {
    const qr = new RecordingQueryRunner();
    qr.presentColumns = EXPECTED_COLUMNS.map((column) => column.column);

    await new AddCharacterProfileAllianceBaseline1714900000027().up(qr as never);

    expect(qr.queries.filter((sql) => sql.includes('ADD COLUMN'))).toHaveLength(0);
  });

  it('⑱ 半途中断可自愈: 只加缺的那一列', async () => {
    const qr = new RecordingQueryRunner();
    qr.presentColumns = ['baseline_safety'];

    await new AddCharacterProfileAllianceBaseline1714900000027().up(qr as never);

    const alters = qr.queries.filter((sql) => sql.includes('ADD COLUMN'));
    expect(alters).toHaveLength(1);
    expect(alters.join('\n')).not.toContain('ADD COLUMN baseline_safety');
  });

  it('⑲ down 净删两列, 且缺列时不炸', async () => {
    const qr = new RecordingQueryRunner();
    qr.presentColumns = EXPECTED_COLUMNS.map((column) => column.column);

    await new AddCharacterProfileAllianceBaseline1714900000027().down(qr as never);

    const drops = qr.queries.filter((sql) => sql.includes('DROP COLUMN'));
    expect(drops).toHaveLength(1);
    const sql = drops[0] ?? '';
    for (const expected of EXPECTED_COLUMNS) {
      expect(sql).toContain(`DROP COLUMN ${expected.column}`);
    }

    const empty = new RecordingQueryRunner();
    await new AddCharacterProfileAllianceBaseline1714900000027().down(empty as never);
    expect(empty.queries.filter((q) => q.includes('DROP COLUMN'))).toHaveLength(0);
  });

  it('⑳ migration 在 index.ts 与 bin/ormconfig.ts 严格 1:1 登记 (漏登记 = 永不执行)', () => {
    const root = path.join(__dirname, '..', '..');
    const index = readFileSync(path.join(root, 'src', 'migration', 'index.ts'), 'utf8');
    const ormconfig = readFileSync(path.join(root, 'bin', 'ormconfig.ts'), 'utf8');

    expect(index).toContain('AddCharacterProfileAllianceBaseline1714900000027');
    expect(ormconfig).toContain('AddCharacterProfileAllianceBaseline1714900000027');
    // ormconfig 的 migrations 数组里必须真的列上 (只 import 不列 = 同样不执行).
    const arrayStart = ormconfig.indexOf('migrations: [');
    const array = ormconfig.slice(arrayStart, ormconfig.indexOf(']', arrayStart));
    expect(array).toContain('AddCharacterProfileAllianceBaseline1714900000027');
  });
});
