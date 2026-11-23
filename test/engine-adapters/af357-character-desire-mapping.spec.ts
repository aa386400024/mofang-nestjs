// AF-357 · 角色愿望键 → 内核四键映射 (adapter spec):
//   覆盖开工单 successCriteria 的"角色愿望映射"部分:
//     ① 8 个真实角色 + 2 个内置种子映射后都覆盖到内核四键，且数值原样;
//     ② 每个角色的关键键位落到正确的内核键（临床语义方向不许错）;
//     ③ 同内核键多条 → 取最大基线，不求和;
//     ④ 未登记键 → 原样保留并计入 unmapped，不猜测;
//     ⑤ 幂等：对已映射结果再映射一次，键值不变;
//     ⑥ 纯函数：不修改入参数组.
//   边界: 纯数据 + 纯函数；不连 DB，不读 env，不起 Nest 容器.
//
//   验证: pnpm exec vitest run test/engine-adapters/af357-character-desire-mapping.spec.ts

import { describe, expect, it } from 'vitest';

import { BUILTIN_CHARACTER_SEEDS } from '../../src/engine-adapters/wiring/character/builtin-character-registry.js';
import {
  CORE_DESIRE_KEYS,
  mapRoleDesiresToCore,
  mapRoleDesiresToCoreDetailed,
  toCoreDesireKey,
} from '../../src/engine-adapters/wiring/character/character-desire-mapping.js';
import { DB_ONLY_CHARACTER_PROFILE_SEED_SPECS } from '../../src/engine-adapters/wiring/character/character-profile.db-only.seed.js';
import { CHARACTER_PROFILE_SEED_SPECS } from '../../src/engine-adapters/wiring/character/character-profile.seed.js';
import { planIntention } from '../../src/engine-core/cognition/intention-planner.js';
import { createEmptyBdiSnapshot, type BdiSnapshot } from '../../src/engine-core/domain/bdi-snapshot.js';
import type { UnderlyingDesireSeed } from '../../src/engine-core/index.js';

/** 全部 10 个角色种子（8 真实 + 2 内置）. */
const ALL_ROLES: readonly { readonly templateId: string; readonly underlyingDesires: readonly UnderlyingDesireSeed[] }[] = [
  ...CHARACTER_PROFILE_SEED_SPECS,
  ...DB_ONLY_CHARACTER_PROFILE_SEED_SPECS,
  ...BUILTIN_CHARACTER_SEEDS.map((seed) => ({ templateId: seed.key, underlyingDesires: seed.underlyingDesires })),
];

/** 从映射结果取权重. */
function weightOf(desires: readonly UnderlyingDesireSeed[], key: string): number | undefined {
  return desires.find((desire) => desire.key === key)?.baselineWeight;
}

describe('AF-357 · ① 10 个角色全部覆盖内核四键', () => {
  it('每个角色映射后至少命中一个内核键，且没有未登记键', () => {
    expect(ALL_ROLES).toHaveLength(10);
    for (const role of ALL_ROLES) {
      const result = mapRoleDesiresToCoreDetailed(role.underlyingDesires);
      const mappedKeys = result.desires.filter((desire) => (CORE_DESIRE_KEYS as readonly string[]).includes(desire.key));
      expect(mappedKeys.length).toBeGreaterThan(0);
      expect(result.unmapped).toEqual([]);
    }
  });

  it('映射后出现的键只可能是内核四键（不把未知键混进快照）', () => {
    for (const role of ALL_ROLES) {
      const keys = mapRoleDesiresToCore(role.underlyingDesires).map((desire) => desire.key);
      for (const key of keys) expect(CORE_DESIRE_KEYS).toContain(key);
    }
  });
});

describe('AF-357 · ② 关键角色落点正确', () => {
  const expectations: { readonly role: string; readonly key: string; readonly weight: number }[] = [
    { role: 'vpt_intimate_avoidance_l1', key: 'accepted', weight: 0.72 },
    { role: 'vpt_intimate_avoidance_l1', key: 'avoid_pain', weight: 0.55 },
    { role: 'vpt_self_worth_intellectualization_l1', key: 'understood', weight: 0.7 },
    { role: 'vpt_self_worth_intellectualization_l1', key: 'control', weight: 0.6 },
    { role: 'vpt_workplace_intellectualization_l1', key: 'control', weight: 0.7 },
    { role: 'vpt_grief_avoidance_l1', key: 'avoid_pain', weight: 0.68 },
    { role: 'vpt_general_secure_l1', key: 'accepted', weight: 0.6 },
    { role: 'vpt_social_anxious_l1', key: 'accepted', weight: 0.7 },
    { role: 'vpt_depression_avoidant_l1', key: 'avoid_pain', weight: 0.55 },
    { role: 'vpt_trauma_disorganized_l1', key: 'avoid_pain', weight: 0.72 },
    { role: 'vpt_trauma_disorganized_l1', key: 'control', weight: 0.5 },
    { role: 'builtin_avoidant_l1', key: 'control', weight: 0.7 },
    { role: 'builtin_avoidant_l1', key: 'avoid_pain', weight: 0.45 },
    { role: 'builtin_anxious_low_mood_l1', key: 'accepted', weight: 0.72 },
    { role: 'builtin_anxious_low_mood_l1', key: 'avoid_pain', weight: 0.55 },
  ];

  for (const item of expectations) {
    it(`${item.role} · ${item.key} = ${item.weight}`, () => {
      const role = ALL_ROLES.find((candidate) => candidate.templateId === item.role);
      expect(role).toBeDefined();
      expect(weightOf(mapRoleDesiresToCore(role!.underlyingDesires), item.key)).toBeCloseTo(item.weight, 6);
    });
  }

  it('惊尘 control=0.50 低于 controlPlanGate 0.55 —— 映射不篡改数值强行达标', () => {
    const role = ALL_ROLES.find((candidate) => candidate.templateId === 'vpt_trauma_disorganized_l1');
    expect(weightOf(mapRoleDesiresToCore(role!.underlyingDesires), 'control')).toBeCloseTo(0.5, 6);
  });
});

describe('AF-357 · ③ 合并规则', () => {
  it('同一内核键多条 → 取最大，不求和', () => {
    const desires: UnderlyingDesireSeed[] = [
      { key: 'recognition', label: '被看见', baselineWeight: 0.2 },
      { key: 'safe_grief', label: '悲伤被接住', baselineWeight: 0.5 },
      { key: 'understood', label: '被理解', baselineWeight: 0.35 },
    ];
    const result = mapRoleDesiresToCore(desires);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('understood');
    expect(result[0].baselineWeight).toBe(0.5);
  });

  it('明细里的 effectiveWeight 与最终快照一致', () => {
    const details = mapRoleDesiresToCoreDetailed([
      { key: 'acceptance', label: '被接纳', baselineWeight: 0.4 },
      { key: 'belonging', label: '归属', baselineWeight: 0.6 },
    ]);
    expect(details.entries.map((entry) => entry.effectiveWeight)).toEqual([0.6, 0.6]);
    expect(details.desires[0].baselineWeight).toBe(0.6);
  });
});

describe('AF-357 · ④ 未登记键原样保留', () => {
  it('未知键不被丢弃，也不被猜成一个内核键', () => {
    const details = mapRoleDesiresToCoreDetailed([
      { key: 'recognition', label: '被看见', baselineWeight: 0.6 },
      { key: 'mystery_need', label: '未知诉求', baselineWeight: 0.3 },
    ]);
    expect(details.unmapped).toEqual(['mystery_need']);
    expect(details.desires.map((desire) => desire.key)).toEqual(['understood', 'mystery_need']);
    expect(details.entries.find((entry) => entry.originalKey === 'mystery_need')?.coreKey).toBeNull();
  });

  it('空 key 原样保留并计入 unmapped（脏数据要可见）', () => {
    const details = mapRoleDesiresToCoreDetailed([{ key: '  ', label: '空', baselineWeight: 0.2 }]);
    expect(details.desires).toHaveLength(1);
    expect(details.unmapped).toHaveLength(1);
    expect(details.entries[0].coreKey).toBeNull();
  });
});

describe('AF-357 · ⑤ 决策分支结构可达性', () => {
  /** 造一个同盟稳定、深度阻抗低的快照（只看愿望层是否能驱动策略）. */
  function stableSnap(desires: readonly UnderlyingDesireSeed[]): BdiSnapshot {
    return {
      ...createEmptyBdiSnapshot(),
      trust: 0.8,
      safety: 0.8,
      bond: 0.7,
      resistance: { verbal: 0.1, depth: 0.1, style: 0.1 },
      underlyingDesires: desires.map((desire) => ({ ...desire, currentWeight: desire.baselineWeight })),
    };
  }

  it('亦舟映射后 control=0.70 → 第 12 轮 discussing_plans 可达', () => {
    const role = ALL_ROLES.find((candidate) => candidate.templateId === 'vpt_workplace_intellectualization_l1');
    const intention = planIntention(stableSnap(mapRoleDesiresToCore(role!.underlyingDesires)), undefined, undefined, { turnNumber: 12 });
    expect(intention.strategy).toBe('discussing_plans');
  });

  it('惊尘映射后 control=0.50 < 0.55 → 不进入 discussing_plans（不篡改临床数值）', () => {
    const role = ALL_ROLES.find((candidate) => candidate.templateId === 'vpt_trauma_disorganized_l1');
    const intention = planIntention(stableSnap(mapRoleDesiresToCore(role!.underlyingDesires)), undefined, undefined, { turnNumber: 12 });
    expect(intention.strategy).not.toBe('discussing_plans');
  });
});

describe('AF-357 · ⑥ 幂等与纯函数', () => {
  it('对已映射结果再映射一次 → 键值不变', () => {
    for (const role of ALL_ROLES) {
      const once = mapRoleDesiresToCore(role.underlyingDesires);
      const twice = mapRoleDesiresToCore(once);
      expect(twice).toEqual(once);
    }
  });

  it('不修改入参数组与对象', () => {
    const input: UnderlyingDesireSeed[] = [{ key: 'stability', label: '稳定', baselineWeight: 0.5 }];
    const snapshot = JSON.stringify(input);
    mapRoleDesiresToCore(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('键解析对未知 / 空白返回 null', () => {
    expect(toCoreDesireKey('recognition')).toBe('understood');
    expect(toCoreDesireKey('mystery')).toBeNull();
    expect(toCoreDesireKey(' '.repeat(3))).toBeNull();
  });
});
