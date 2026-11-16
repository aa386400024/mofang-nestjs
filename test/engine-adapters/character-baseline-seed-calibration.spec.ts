// V2026-11-10 WP-J (B 层 · DB-only 角色基线校准 · 单测):
//   职责: 钉死 `applyBaselineCalibration` 的四条硬约束 ——
//     ① 只 UPDATE 已存在且未软删的行的**8 个基线列** (载荷里不得出现内容列 / 状态列);
//     ② 找不到行 → 进 missing **显式报告**, 且**绝不 INSERT**;
//     ③ 值一致 → unchanged (不产生无谓写);
//     ④ 连跑两次幂等 (第二次全 unchanged).
//     另: A 类角色**不被**这条路径碰到 (它们归内容 seed).
//
//   边界: 全 mock —— 仓储是内存 stub, 不连 DB、不起容器.
//
//   为什么这些约束要用测试守住 (而不是靠 review):
//     "只 UPDATE 8 个基线列"是一条**载荷级**约束: 一旦有人顺手把 enabled / audit_status
//     或内容列塞进载荷, 代码依然能跑通, 但库里"运营下架过的角色被 seed 悄悄重新上架" ——
//     这种回归没有任何报错, 只有断言能挡住.

import { FindOperator } from 'typeorm';

import { buildCharacterProfileRow } from './character-profile-fixtures.js';
import {
  CHARACTER_BASELINE_CALIBRATION,
  type CharacterBaselineCalibration,
} from '../../src/engine-adapters/wiring/character/character-baseline-calibration.js';
import type { CharacterProfileEntity } from '../../src/engine-adapters/wiring/character/character-profile.entity.js';
import {
  DB_ONLY_BASELINE_CALIBRATION,
  applyBaselineCalibration,
} from '../../src/engine-adapters/wiring/character/character-profile.seed.js';

/** 校准写的 8 个基线数值列 (顺序固定, 便于断言). */
const BASELINE_COLUMNS = [
  'baselineTrust',
  'baselineResistanceVerbal',
  'baselineResistanceDepth',
  'baselineResistanceStyle',
  'baselineEmotionValence',
  'baselineEmotionArousal',
  'baselineSafety',
  'baselineBond',
] as const;

/**
 * WP-J P2: 台词指纹列.
 *
 * 它**也**由这条 UPDATE 写入 —— B 类 4 个角色没有来访池模板, 内容 seed 带不进去,
 * 文案只能随基线校准一起落. 所以它**不是**内容列.
 */
const VERBAL_VOICE_COLUMN = 'verbalVoice';

/** 一条校准 UPDATE 允许写的全部列 = 8 个基线数值 + 台词指纹. */
const CALIBRATION_COLUMNS = [...BASELINE_COLUMNS, VERBAL_VOICE_COLUMN] as const;

/** 载荷里**绝不允许**出现的列 (内容列 + 运营状态列 + 版本列). */
const FORBIDDEN_COLUMNS = [
  'displayName',
  'attachmentStyle',
  'fivePs',
  'personalityTraits',
  'coreBeliefs',
  'underlyingDesires',
  'forbiddenBehaviors',
  'sensitiveTopics',
  'speechVolumeBaseline',
  'narrativeStyle',
  'expressionTone',
  'auditStatus',
  'enabled',
  'version',
  'versionMajor',
  'versionMinor',
  'versionPatch',
] as const;

/**
 * 内存仓储 stub: 只实现 `applyBaselineCalibration` 用到的两个方法.
 *
 * findBy 的 where 语义按 TypeORM 一致处理 (等值 + In + IsNull).
 */
class FakeCharacterProfileRepo {
  readonly rows: CharacterProfileEntity[] = [];
  /** 每次 update 的 (id, 载荷) —— 用来断言"只写了哪几列". */
  readonly updateCalls: { readonly id: string; readonly payload: Record<string, unknown> }[] = [];
  /** insert 调用 (必须永远是空的 —— 校准路径不 INSERT). */
  readonly insertCalls: unknown[] = [];

  async findBy(where: Record<string, unknown>): Promise<CharacterProfileEntity[]> {
    return this.rows.filter((row) => matchesWhere(row, where));
  }

  async update(id: string, payload: Record<string, unknown>): Promise<void> {
    this.updateCalls.push({ id, payload });
    const row = this.rows.find((item) => item.id === id);
    if (row) {
      Object.assign(row, payload);
    }
  }

  async insert(payload: unknown): Promise<void> {
    this.insertCalls.push(payload);
  }
}

/**
 * where 条件匹配 (等值 + In + IsNull).
 */
function matchesWhere(row: CharacterProfileEntity, where: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(where)) {
    const actual = (row as unknown as Record<string, unknown>)[key];
    if (expected instanceof FindOperator) {
      if (expected.type === 'isNull') {
        if (actual !== null) return false;
        continue;
      }
      if (expected.type === 'in') {
        const values = expected.value as readonly unknown[];
        if (!values.includes(actual)) return false;
        continue;
      }
      return false;
    }
    if (actual !== expected) return false;
  }
  return true;
}

/**
 * 造一条 B 类角色行 (数值**故意**与标定不一致 —— 让校准真的产生 UPDATE).
 *
 * @param target 标定行
 * @param overrides 列覆盖
 * @returns 角色行
 */
function buildDriftedRow(target: CharacterBaselineCalibration, overrides: Partial<CharacterProfileEntity> = {}): CharacterProfileEntity {
  // 默认值来自共享夹具 (character-profile-fixtures.ts) —— 本组用例只覆盖"漂移"相关的列.
  return buildCharacterProfileRow({
    id: `row-${target.templateId}`,
    templateId: target.templateId,
    displayName: '原展示名',
    fivePs: {
      presenting: '原主诉',
      precipitating: '原诱发',
      maintaining: '原维持',
      protective: '原保护',
      vulnerability: '原易感',
    },
    baselineTrust: 0.5,
    baselineResistanceVerbal: 0.5,
    baselineResistanceDepth: 0.5,
    baselineResistanceStyle: 0.5,
    baselineEmotionValence: 0,
    baselineEmotionArousal: 0.5,
    baselineSafety: 0.5,
    baselineBond: 0.5,
    // WP-J P2: 库里原本 8 行 verbal_voice 全 NULL —— 默认就按"待写入"造, 与真库一致.
    verbalVoice: null,
    auditStatus: 'approved',
    version: 7,
    ...overrides,
  });
}

/** B 类那 4 个 templateId. */
const DB_ONLY_TEMPLATE_IDS = ['vpt_depression_avoidant_l1', 'vpt_general_secure_l1', 'vpt_social_anxious_l1', 'vpt_trauma_disorganized_l1'];

describe('WP-J · DB-only 角色集合的推导', () => {
  it('① DB-only 集合 = 权威表里"没有 seed 规格"的那 4 行', () => {
    expect(DB_ONLY_BASELINE_CALIBRATION.map((row) => row.templateId).toSorted()).toEqual(DB_ONLY_TEMPLATE_IDS);
    expect(DB_ONLY_BASELINE_CALIBRATION).toHaveLength(4);
  });

  it('② DB-only 集合里的每一行都取自权威表 (不是另抄一份)', () => {
    for (const row of DB_ONLY_BASELINE_CALIBRATION) {
      const source = CHARACTER_BASELINE_CALIBRATION.find((item) => item.templateId === row.templateId);
      expect(source).toBeDefined();
      expect(row.trust).toBe(source?.trust);
      expect(row.resistance).toEqual(source?.resistance);
      expect(row.emotion).toEqual(source?.emotion);
      expect(row.safety).toBe(source?.safety);
      expect(row.bond).toBe(source?.bond);
    }
  });
});

describe('WP-J · applyBaselineCalibration · 只更新基线列 + 台词指纹', () => {
  it('③ 4 行全部更新, 载荷里只有 8 个基线列 + 台词指纹', async () => {
    const repo = new FakeCharacterProfileRepo();
    for (const target of DB_ONLY_BASELINE_CALIBRATION) {
      repo.rows.push(buildDriftedRow(target));
    }

    const result = await applyBaselineCalibration(repo as never);

    expect(result).toEqual({ updated: 4, unchanged: 0, missing: [] });
    expect(repo.updateCalls).toHaveLength(4);
    expect(repo.insertCalls).toHaveLength(0);

    for (const call of repo.updateCalls) {
      expect(Object.keys(call.payload).toSorted()).toEqual([...CALIBRATION_COLUMNS].toSorted());
      for (const forbidden of FORBIDDEN_COLUMNS) {
        expect(Object.keys(call.payload)).not.toContain(forbidden);
      }
    }
  });

  it('④ 校准后的行: 基线八维 + 台词指纹对齐标定表, 内容列与状态列**一字未动**', async () => {
    const repo = new FakeCharacterProfileRepo();
    for (const target of DB_ONLY_BASELINE_CALIBRATION) {
      repo.rows.push(buildDriftedRow(target));
    }
    const before = repo.rows.map((row) => ({
      id: row.id,
      fivePs: JSON.stringify(row.fivePs),
      displayName: row.displayName,
      auditStatus: row.auditStatus,
      enabled: row.enabled,
      version: row.version,
      coreBeliefs: JSON.stringify(row.coreBeliefs),
      underlyingDesires: JSON.stringify(row.underlyingDesires),
      forbiddenBehaviors: JSON.stringify(row.forbiddenBehaviors),
      sensitiveTopics: JSON.stringify(row.sensitiveTopics),
      speechVolumeBaseline: row.speechVolumeBaseline,
      narrativeStyle: row.narrativeStyle,
      expressionTone: row.expressionTone,
    }));

    await applyBaselineCalibration(repo as never);

    for (const [index, row] of repo.rows.entries()) {
      const target = DB_ONLY_BASELINE_CALIBRATION.find((item) => item.templateId === row.templateId);
      expect(row.baselineTrust).toBe(target?.trust);
      expect(row.baselineResistanceVerbal).toBe(target?.resistance.verbal);
      expect(row.baselineResistanceDepth).toBe(target?.resistance.depth);
      expect(row.baselineResistanceStyle).toBe(target?.resistance.style);
      expect(row.baselineEmotionValence).toBe(target?.emotion.valence);
      expect(row.baselineEmotionArousal).toBe(target?.emotion.arousal);
      expect(row.baselineSafety).toBe(target?.safety);
      expect(row.baselineBond).toBe(target?.bond);
      // WP-J P2: 台词指纹同样必须落成标定表那一份 (不是 NULL, 也不是别的角色的文案).
      expect(row.verbalVoice).toBe(target?.verbalVoice);

      const snapshot = before[index];
      expect(row.fivePs).toEqual(JSON.parse(snapshot?.fivePs ?? '{}'));
      expect(row.displayName).toBe(snapshot?.displayName);
      expect(row.auditStatus).toBe(snapshot?.auditStatus);
      expect(row.enabled).toBe(snapshot?.enabled);
      expect(row.version).toBe(snapshot?.version);
      expect(row.coreBeliefs).toEqual(JSON.parse(snapshot?.coreBeliefs ?? '[]'));
      expect(row.underlyingDesires).toEqual(JSON.parse(snapshot?.underlyingDesires ?? '[]'));
      expect(row.forbiddenBehaviors).toEqual(JSON.parse(snapshot?.forbiddenBehaviors ?? '[]'));
      expect(row.sensitiveTopics).toEqual(JSON.parse(snapshot?.sensitiveTopics ?? '[]'));
      expect(row.speechVolumeBaseline).toBe(snapshot?.speechVolumeBaseline);
      expect(row.narrativeStyle).toBe(snapshot?.narrativeStyle);
      expect(row.expressionTone).toBe(snapshot?.expressionTone);
    }
  });

  it('⑤ 已下架 / 未过审的行**照样只改数值** (不改它的状态), 但不改 enabled 与 audit_status', async () => {
    const repo = new FakeCharacterProfileRepo();
    for (const target of DB_ONLY_BASELINE_CALIBRATION) {
      repo.rows.push(buildDriftedRow(target, { enabled: false, auditStatus: 'draft' }));
    }

    const result = await applyBaselineCalibration(repo as never);

    expect(result.updated).toBe(4);
    for (const row of repo.rows) {
      expect(row.enabled).toBe(false);
      expect(row.auditStatus).toBe('draft');
    }
  });
});

describe('WP-J · applyBaselineCalibration · missing 与不 INSERT', () => {
  it('⑥ 找不到的行进 missing, 且**一条 INSERT 都不发**', async () => {
    const repo = new FakeCharacterProfileRepo();
    const [first, second] = DB_ONLY_BASELINE_CALIBRATION;
    if (!first || !second) throw new Error('标定表数据不足');
    repo.rows.push(buildDriftedRow(first));

    const result = await applyBaselineCalibration(repo as never);

    expect(result.updated).toBe(1);
    expect(result.unchanged).toBe(0);
    expect(result.missing).toHaveLength(3);
    expect(result.missing).not.toContain(first.templateId);
    expect(result.missing).toContain(second.templateId);
    expect(repo.insertCalls).toHaveLength(0);
    expect(repo.rows).toHaveLength(1);
  });

  it('⑦ 软删的行不算"可更新行" → 进 missing, 不复活、不改它', async () => {
    const repo = new FakeCharacterProfileRepo();
    const [first] = DB_ONLY_BASELINE_CALIBRATION;
    if (!first) throw new Error('标定表数据不足');
    const softDeleted = buildDriftedRow(first, { deletedAt: new Date(0) });
    repo.rows.push(softDeleted);

    const result = await applyBaselineCalibration(repo as never);

    expect(result.missing).toContain(first.templateId);
    expect(result.updated).toBe(0);
    expect(repo.updateCalls).toHaveLength(0);
    expect(repo.insertCalls).toHaveLength(0);
    expect(softDeleted.baselineTrust).toBe(0.5);
  });
});

describe('WP-J · applyBaselineCalibration · 幂等', () => {
  it('⑧ 连跑两次: 第二次全部 unchanged, 一条 UPDATE 都不发', async () => {
    const repo = new FakeCharacterProfileRepo();
    for (const target of DB_ONLY_BASELINE_CALIBRATION) {
      repo.rows.push(buildDriftedRow(target));
    }

    const first = await applyBaselineCalibration(repo as never);
    expect(first).toEqual({ updated: 4, unchanged: 0, missing: [] });
    expect(repo.updateCalls).toHaveLength(4);

    const callsAfterFirst = repo.updateCalls.length;
    const second = await applyBaselineCalibration(repo as never);

    expect(second).toEqual({ updated: 0, unchanged: 4, missing: [] });
    expect(repo.updateCalls).toHaveLength(callsAfterFirst);
  });

  it('⑨ 值本来就一致的行 → unchanged (不产生无谓写)', async () => {
    const repo = new FakeCharacterProfileRepo();
    for (const target of DB_ONLY_BASELINE_CALIBRATION) {
      repo.rows.push(
        buildDriftedRow(target, {
          baselineTrust: target.trust,
          baselineResistanceVerbal: target.resistance.verbal,
          baselineResistanceDepth: target.resistance.depth,
          baselineResistanceStyle: target.resistance.style,
          baselineEmotionValence: target.emotion.valence,
          baselineEmotionArousal: target.emotion.arousal,
          baselineSafety: target.safety,
          baselineBond: target.bond,
          // WP-J P2: 文案也必须一致, 否则"8 维全对"仍会因文案 NULL 判漂移.
          verbalVoice: target.verbalVoice,
        }),
      );
    }

    const result = await applyBaselineCalibration(repo as never);

    expect(result).toEqual({ updated: 0, unchanged: 4, missing: [] });
    expect(repo.updateCalls).toHaveLength(0);
  });

  it('⑨-b 库里的单精度 FLOAT 往返残值不算漂移 (换 prepared statement 也不破幂等)', async () => {
    const repo = new FakeCharacterProfileRepo();
    for (const target of DB_ONLY_BASELINE_CALIBRATION) {
      repo.rows.push(
        buildDriftedRow(target, {
          // `Math.fround` 模拟 MySQL FLOAT (4 字节单精度) 的存储往返:
          //   0.64 存进去再经 binary protocol 读回来是 0.6399999856948853, 差约 1.4e-8.
          // 若漂移判定用裸 `!==`, 这 8 列全部"不等" → 每次都判有漂移 → 幂等破功.
          // 正确行为: 差值 < STORAGE_FLOAT_TOLERANCE (1e-6) → 视为没变.
          baselineTrust: Math.fround(target.trust),
          baselineResistanceVerbal: Math.fround(target.resistance.verbal),
          baselineResistanceDepth: Math.fround(target.resistance.depth),
          baselineResistanceStyle: Math.fround(target.resistance.style),
          baselineEmotionValence: Math.fround(target.emotion.valence),
          baselineEmotionArousal: Math.fround(target.emotion.arousal),
          baselineSafety: Math.fround(target.safety),
          baselineBond: Math.fround(target.bond),
          // 文案是 varchar, 不存在单精度问题 —— 但要一致, 否则这条用例测的就不是"精度"了.
          verbalVoice: target.verbalVoice,
        }),
      );
    }

    const result = await applyBaselineCalibration(repo as never);

    expect(result).toEqual({ updated: 0, unchanged: 4, missing: [] });
    expect(repo.updateCalls).toHaveLength(0);
  });

  it('⑨-c 容差不吞真差异: 任一维偏 0.01 仍判漂移并落 UPDATE', async () => {
    const repo = new FakeCharacterProfileRepo();
    for (const target of DB_ONLY_BASELINE_CALIBRATION) {
      repo.rows.push(
        buildDriftedRow(target, {
          baselineTrust: target.trust,
          baselineResistanceVerbal: target.resistance.verbal,
          baselineResistanceDepth: target.resistance.depth,
          baselineResistanceStyle: target.resistance.style,
          baselineEmotionValence: target.emotion.valence,
          baselineEmotionArousal: target.emotion.arousal,
          baselineSafety: target.safety,
          // 只把 bond 偏 0.01 (= 标定最小刻度, 也远大于 1e-6 容差)
          baselineBond: Number(Math.max(target.bond - 0.01, 0).toFixed(4)),
          // 文案保持一致 —— 让这条用例只测"容差不吞真差异", 不被文案漂移干扰.
          verbalVoice: target.verbalVoice,
        }),
      );
    }

    const result = await applyBaselineCalibration(repo as never);

    expect(result).toEqual({ updated: 4, unchanged: 0, missing: [] });
    expect(repo.updateCalls).toHaveLength(4);
  });

  it('⑨-d 8 维全对、库里 verbal_voice 仍为 NULL → 判漂移并真的把文案写进载荷', async () => {
    const repo = new FakeCharacterProfileRepo();
    for (const target of DB_ONLY_BASELINE_CALIBRATION) {
      repo.rows.push(
        buildDriftedRow(target, {
          baselineTrust: target.trust,
          baselineResistanceVerbal: target.resistance.verbal,
          baselineResistanceDepth: target.resistance.depth,
          baselineResistanceStyle: target.resistance.style,
          baselineEmotionValence: target.emotion.valence,
          baselineEmotionArousal: target.emotion.arousal,
          baselineSafety: target.safety,
          baselineBond: target.bond,
          // 真库现状: 8 行 verbal_voice 全 NULL.
          verbalVoice: null,
        }),
      );
    }

    const result = await applyBaselineCalibration(repo as never);

    expect(result).toEqual({ updated: 4, unchanged: 0, missing: [] });
    expect(repo.updateCalls).toHaveLength(4);
    for (const call of repo.updateCalls) {
      // buildDriftedRow 的主键格式是 `row-<templateId>`.
      const templateId = call.id.replace(/^row-/, '');
      const target = DB_ONLY_BASELINE_CALIBRATION.find((item) => item.templateId === templateId);
      expect(call.payload['verbalVoice']).toBe(target?.verbalVoice);
    }
  });

  it('⑨-e 文案被运营改过一个字 → 判漂移 (不会因为"8 维对上了"就放过文案)', async () => {
    const repo = new FakeCharacterProfileRepo();
    for (const target of DB_ONLY_BASELINE_CALIBRATION) {
      repo.rows.push(
        buildDriftedRow(target, {
          baselineTrust: target.trust,
          baselineResistanceVerbal: target.resistance.verbal,
          baselineResistanceDepth: target.resistance.depth,
          baselineResistanceStyle: target.resistance.style,
          baselineEmotionValence: target.emotion.valence,
          baselineEmotionArousal: target.emotion.arousal,
          baselineSafety: target.safety,
          baselineBond: target.bond,
          verbalVoice: '（运营改过）' + target.verbalVoice,
        }),
      );
    }

    const result = await applyBaselineCalibration(repo as never);

    expect(result).toEqual({ updated: 4, unchanged: 0, missing: [] });
  });
});

describe('WP-J · applyBaselineCalibration · 作用域', () => {
  it('⑩ A 类角色不在 DB-only 集合里 → 这条路径碰不到它们', async () => {
    const repo = new FakeCharacterProfileRepo();
    const aClass = CHARACTER_BASELINE_CALIBRATION.find((row) => row.templateId === 'vpt_intimate_avoidance_l1');
    if (!aClass) throw new Error('标定表数据不足');
    repo.rows.push(buildDriftedRow(aClass));

    const result = await applyBaselineCalibration(repo as never);

    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(0);
    // A 类 templateId 根本不在校准范围里 → 既不会被更新, 也不会进 missing (missing 只装校准范围内的).
    expect(result.missing).not.toContain('vpt_intimate_avoidance_l1');
    expect(result.missing).toHaveLength(4);
    expect(repo.updateCalls).toHaveLength(0);
    expect(repo.insertCalls).toHaveLength(0);
  });

  it('⑪ 传入空集合 → 什么都不做, 不查库也不写', async () => {
    const repo = new FakeCharacterProfileRepo();
    const result = await applyBaselineCalibration(repo as never, []);

    expect(result).toEqual({ updated: 0, unchanged: 0, missing: [] });
    expect(repo.updateCalls).toHaveLength(0);
    expect(repo.insertCalls).toHaveLength(0);
  });
});
