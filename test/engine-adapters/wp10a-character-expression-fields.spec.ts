// V2026-10-30 治本 (WP10A · 表达风格基线字段预留 · 单测):
//   职责: 钉死「加 3 列」这件事的**形状**、**幂等**、**默认值的唯一真相**与**红线**.
//   边界: 全 mock / 纯内存; 不起容器、不连 DB、不发网络.
//
//   为什么"形状"要断言两遍 (entity 与 migration 各一遍):
//     加列这件事的失败模式是**两边不一致** —— entity 写了 `default: 0.5`, migration 写了
//     `DEFAULT 0.6` (或反过来), 代码不报错、测试也绿, 直到线上某天 seed 灌进去一个 0.6
//     的行才发现"entity 说的是 0.5". 所以这里把两边的默认值**对着比**, 而不是各断言一次.
//
//   为什么 migration 用**假 QueryRunner 跑一遍**而不是只读源码:
//     只读源码只能断言"文件里有没有这串字"; 跑一遍能断言**真的发出去的 DDL** —
//     包括"列已存在时一条 ALTER 都不发"这条幂等语义 (这是 migration 最容易写错的地方).
//
//   红线为什么能自动验:
//     `toCharacterSeed` 是 resolver 的**唯一**映射入口; 断言它的输出里**不含**这三个字段,
//     就等于物理证明"这三列没进内核" —— 不用去读人肉 diff.
//
//   验证: npx jest test/engine-adapters/wp10a-character-expression-fields.spec.ts
//   时间戳: 2026-10-30 GMT+8

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { getMetadataArgsStorage } from 'typeorm';

import { VISITOR_POOL_TEMPLATE_SEEDS } from '../../src/counselor/config/visitor-pool-seed';
import {
  buildCharacterProfileSeeds,
  CHARACTER_PROFILE_SEED_SPECS,
  seedCharacterProfiles,
  type CharacterProfileSeed,
} from '../../src/engine-adapters/wiring/character/character-profile.seed';
import { CharacterProfileEntity } from '../../src/engine-adapters/wiring/character/character-profile.entity';
import { toCharacterSeed } from '../../src/engine-adapters/wiring/character/db-character-profile.resolver';
import { AddCharacterProfileExpressionFields1714900000025 } from '../../src/migration/1714900000025-AddCharacterProfileExpressionFields';

/** 本轮加的三列 (列名 → DB 默认值). */
const EXPECTED_COLUMNS: readonly { readonly column: string; readonly default: string | number; readonly type: string }[] = [
  { column: 'speech_volume_baseline', default: 0.5, type: 'float' },
  { column: 'narrative_style', default: 'mixed', type: 'varchar' },
  { column: 'expression_tone', default: 'restrained', type: 'varchar' },
];

/**
 * 记录 DDL 的假 QueryRunner.
 *
 * `existingColumns` 走 INFORMATION_SCHEMA 查询 —— 这里让它按"库里已有的列名"返回,
 * 于是同一个假执行器既能演"空表"也能演"三列都已在".
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
function entityColumns(): ReadonlyMap<string, { readonly type: string; readonly length?: number; readonly default?: unknown }> {
  const columns = getMetadataArgsStorage().columns.filter((column) => column.target === CharacterProfileEntity);
  const map = new Map<string, { readonly type: string; readonly length?: number; readonly default?: unknown }>();
  for (const column of columns) {
    const options = column.options as { name?: string; type?: string; length?: number; default?: unknown };
    const name = options.name ?? column.propertyName;
    map.set(name, { type: options.type ?? '', length: options.length, default: options.default });
  }
  return map;
}

describe('WP10A · 表达风格基线字段 · entity 列定义 (任务单 §1.1 / §1.3)', () => {
  it('① 三列都在 entity 上, 列名 / 类型 / 长度 / 默认值与任务单逐字一致', () => {
    const columns = entityColumns();

    for (const expected of EXPECTED_COLUMNS) {
      const column = columns.get(expected.column);
      expect(column).toBeDefined();
      expect(column?.type).toBe(expected.type);
      expect(column?.default).toBe(expected.default);
    }
    // varchar(20): 两个字符串列的长度上限.
    expect(columns.get('narrative_style')?.length).toBe(20);
    expect(columns.get('expression_tone')?.length).toBe(20);
  });

  it('② 三列的属性名与 DB 列名是显式映射 (不靠驼峰自动推导)', () => {
    const properties = getMetadataArgsStorage()
      .columns.filter((column) => column.target === CharacterProfileEntity)
      .map((column) => column.propertyName);

    expect(properties).toContain('speechVolumeBaseline');
    expect(properties).toContain('narrativeStyle');
    expect(properties).toContain('expressionTone');
  });
});

describe('WP10A · 表达风格基线字段 · migration (任务单 §1.2)', () => {
  it('③ 空表 → 发出 3 条 ADD COLUMN, DDL 的默认值与 entity 逐字一致', async () => {
    const qr = new RecordingQueryRunner();
    await new AddCharacterProfileExpressionFields1714900000025().up(qr as never);

    const alters = qr.queries.filter((sql) => sql.includes('ADD COLUMN'));
    expect(alters).toHaveLength(3);
    const all = alters.join('\n');
    // DDL 口径: NOT NULL + DEFAULT —— 存量行由 DEFAULT 自动填充 (不需要 UPDATE).
    expect(all).toContain('speech_volume_baseline FLOAT NOT NULL DEFAULT 0.5');
    expect(all).toContain("narrative_style VARCHAR(20) NOT NULL DEFAULT 'mixed'");
    expect(all).toContain("expression_tone VARCHAR(20) NOT NULL DEFAULT 'restrained'");
  });

  it('④ migration 的 DEFAULT 与 entity 的 default 对得上 (两边漂移即红)', () => {
    const columns = entityColumns();
    const qr = new RecordingQueryRunner();
    const migration = new AddCharacterProfileExpressionFields1714900000025();
    const source = readFileSync(
      path.join(__dirname, '..', '..', 'src', 'migration', '1714900000025-AddCharacterProfileExpressionFields.ts'),
      'utf8',
    );

    expect(migration.name).toBe('AddCharacterProfileExpressionFields1714900000025');
    for (const expected of EXPECTED_COLUMNS) {
      const entityDefault = columns.get(expected.column)?.default;
      // migration 的 DDL 片段必须带着与 entity 相同的默认值 (字符串列带引号).
      const ddlDefault = typeof expected.default === 'number' ? String(expected.default) : `'${expected.default}'`;
      expect(source).toContain(`DEFAULT ${ddlDefault}`);
      expect(entityDefault).toBe(expected.default);
    }
    expect(qr.queries).toHaveLength(0);
  });

  it('⑤ 幂等: 三列都已在 → 一条 ALTER 都不发 (重复跑 up 不报错)', async () => {
    const qr = new RecordingQueryRunner();
    qr.presentColumns = EXPECTED_COLUMNS.map((column) => column.column);

    await new AddCharacterProfileExpressionFields1714900000025().up(qr as never);

    expect(qr.queries.filter((sql) => sql.includes('ADD COLUMN'))).toHaveLength(0);
  });

  it('⑥ 半途中断可自愈: 只加缺的那一列', async () => {
    const qr = new RecordingQueryRunner();
    qr.presentColumns = ['speech_volume_baseline'];

    await new AddCharacterProfileExpressionFields1714900000025().up(qr as never);

    const alters = qr.queries.filter((sql) => sql.includes('ADD COLUMN'));
    expect(alters).toHaveLength(2);
    expect(alters.join('\n')).not.toContain('ADD COLUMN speech_volume_baseline');
  });

  it('⑦ down 净删三列, 且缺列时不炸 (回滚半途中断的迁移)', async () => {
    const qr = new RecordingQueryRunner();
    qr.presentColumns = EXPECTED_COLUMNS.map((column) => column.column);

    await new AddCharacterProfileExpressionFields1714900000025().down(qr as never);

    const drops = qr.queries.filter((sql) => sql.includes('DROP COLUMN'));
    expect(drops).toHaveLength(1);
    const sql = drops[0] ?? '';
    for (const expected of EXPECTED_COLUMNS) {
      expect(sql).toContain(`DROP COLUMN ${expected.column}`);
    }

    const empty = new RecordingQueryRunner();
    await new AddCharacterProfileExpressionFields1714900000025().down(empty as never);
    expect(empty.queries.filter((sql) => sql.includes('DROP COLUMN'))).toHaveLength(0);
  });

  it('⑧ migration 在 index.ts 与 bin/ormconfig.ts 严格 1:1 登记 (漏登记 = 永不执行)', () => {
    const root = path.join(__dirname, '..', '..');
    const index = readFileSync(path.join(root, 'src', 'migration', 'index.ts'), 'utf8');
    const ormconfig = readFileSync(path.join(root, 'bin', 'ormconfig.ts'), 'utf8');

    expect(index).toContain('AddCharacterProfileExpressionFields1714900000025');
    expect(ormconfig).toContain('AddCharacterProfileExpressionFields1714900000025');
    // ormconfig 的 migrations 数组里必须真的列上 (只 import 不列 = 同样不执行).
    const arrayStart = ormconfig.indexOf('migrations: [');
    const array = ormconfig.slice(arrayStart, ormconfig.indexOf(']', arrayStart));
    expect(array).toContain('AddCharacterProfileExpressionFields1714900000025');
  });
});

describe('WP10A · 表达风格基线字段 · seed 表态口径 (任务单 §1.4)', () => {
  it('⑨ 只有"既有数据自己就写明了该特质"的角色才表态, 其余留默认', () => {
    const byTemplateId = new Map(CHARACTER_PROFILE_SEED_SPECS.map((spec) => [spec.templateId, spec]));

    // slug 明文是 intellectualization 的两个角色 → 理智化语态.
    expect(byTemplateId.get('vpt_self_worth_intellectualization_l1')?.expressionTone).toBe('intellectualizing');
    expect(byTemplateId.get('vpt_workplace_intellectualization_l1')?.expressionTone).toBe('intellectualizing');
    // 其余两个: 既有数据没写明 → 不表态 (走 DB DEFAULT).
    expect(byTemplateId.get('vpt_intimate_avoidance_l1')?.expressionTone).toBeUndefined();
    expect(byTemplateId.get('vpt_grief_avoidance_l1')?.expressionTone).toBeUndefined();
  });

  it('⑩ 话量基线 / 叙事风格全部不表态 (本轮没有任何既有数据说明它们)', () => {
    for (const spec of CHARACTER_PROFILE_SEED_SPECS) {
      expect(spec.speechVolumeBaseline).toBeUndefined();
      expect(spec.narrativeStyle).toBeUndefined();
    }
  });

  it('⑪ 种子构建出的行: 表态的带值, 不表态的**键都不存在** (走 DB DEFAULT)', () => {
    const seeds = buildCharacterProfileSeeds(VISITOR_POOL_TEMPLATE_SEEDS);
    const yizhou = seeds.find((seed) => seed.templateId === 'vpt_workplace_intellectualization_l1');
    const wanqing = seeds.find((seed) => seed.templateId === 'vpt_intimate_avoidance_l1');

    expect(yizhou?.expressionTone).toBe('intellectualizing');
    expect('speechVolumeBaseline' in (wanqing ?? {})).toBe(false);
    expect('narrativeStyle' in (wanqing ?? {})).toBe(false);
    expect('expressionTone' in (wanqing ?? {})).toBe(false);
  });
});

describe('WP10A · 表达风格基线字段 · 灌库载荷语义', () => {
  /** 记录 insert / update 载荷的假仓储. */
  class FakeRepo {
    readonly inserted: Record<string, unknown>[] = [];
    readonly updated: { readonly id: string; readonly payload: Record<string, unknown> }[] = [];
    readonly rows: Record<string, unknown>[] = [];

    async find(): Promise<Record<string, unknown>[]> {
      return this.rows;
    }

    async insert(payload: Record<string, unknown>): Promise<void> {
      this.inserted.push(payload);
    }

    async update(id: string, payload: Record<string, unknown>): Promise<void> {
      this.updated.push({ id, payload });
    }
  }

  /** 跑一次灌库, 返回假仓储. */
  async function runSeed(): Promise<FakeRepo> {
    const repo = new FakeRepo();
    const dataSource = { getRepository: () => repo } as never;
    const seeds = buildCharacterProfileSeeds(VISITOR_POOL_TEMPLATE_SEEDS);
    await seedCharacterProfiles(dataSource, seeds);
    return repo;
  }

  it('⑫ INSERT 载荷: 表态的列带上值, 不表态的列**整列不出现** (DB DEFAULT 生效)', async () => {
    const repo = await runSeed();
    const yizhou = repo.inserted.find((payload) => payload['templateId'] === 'vpt_workplace_intellectualization_l1');
    const wanqing = repo.inserted.find((payload) => payload['templateId'] === 'vpt_intimate_avoidance_l1');

    expect(yizhou?.['expressionTone']).toBe('intellectualizing');
    // 没表态的列: 键**不存在** (不是 undefined) —— TypeORM INSERT 时按 DEFAULT 落库.
    expect('speechVolumeBaseline' in (wanqing ?? {})).toBe(false);
    expect('narrativeStyle' in (wanqing ?? {})).toBe(false);
    expect('expressionTone' in (wanqing ?? {})).toBe(false);
    expect('speechVolumeBaseline' in (yizhou ?? {})).toBe(false);
    expect('narrativeStyle' in (yizhou ?? {})).toBe(false);
  });
});

describe('WP10A · 表达风格基线字段 · 红线 (不消费 / 不进内核)', () => {
  it('⑬ resolver 映射的输出里不含这三列 (字段没进内核)', () => {
    const seed = buildCharacterProfileSeeds(VISITOR_POOL_TEMPLATE_SEEDS)[0] as CharacterProfileSeed;
    const row = {
      id: seed.id,
      templateId: seed.templateId,
      displayName: seed.displayName,
      attachmentStyle: seed.attachmentStyle,
      fivePs: seed.fivePs,
      baselineTrust: seed.trust,
      baselineResistanceVerbal: seed.resistance.verbal,
      baselineResistanceDepth: seed.resistance.depth,
      baselineResistanceStyle: seed.resistance.style,
      baselineEmotionValence: seed.emotion.valence,
      baselineEmotionArousal: seed.emotion.arousal,
      speechVolumeBaseline: 0.5,
      narrativeStyle: 'mixed',
      expressionTone: 'restrained',
      coreBeliefs: seed.coreBeliefs,
      underlyingDesires: seed.underlyingDesires,
      forbiddenBehaviors: seed.forbiddenBehaviors,
      sensitiveTopics: seed.sensitiveTopics,
      auditStatus: 'approved',
      enabled: true,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    } as CharacterProfileEntity;

    const mapped = toCharacterSeed(row) as unknown as Record<string, unknown>;

    expect(mapped['speechVolumeBaseline']).toBeUndefined();
    expect(mapped['narrativeStyle']).toBeUndefined();
    expect(mapped['expressionTone']).toBeUndefined();
  });

  it('⑭ 前端 DTO 里不含这三列 (本期不暴露给前端)', () => {
    const root = path.join(__dirname, '..', '..');
    const dto = readFileSync(
      path.join(root, 'src', 'engine-adapters', 'wiring', 'character', 'character-profile.dto.ts'),
      'utf8',
    );

    expect(dto).not.toContain('speechVolumeBaseline');
    expect(dto).not.toContain('narrativeStyle');
    expect(dto).not.toContain('expressionTone');
  });
});
