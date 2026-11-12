// V2026-11-12 S-1 (探索深度门槛端口化 · core spec):
//   覆盖开工单 §5 五类用例:
//     ① 缺省回落 —— 钉死预研风险 B (解析口早退分支漏补 openDepth → 探索分支静默失效)
//     ② 非法值回落
//     ③ 会话级覆盖 (覆盖优先 / 缺项回落单例 / 非法回落种子 / 无覆盖仍返回 base 同一引用)
//     ④ planner 边界两侧 + 同盟门槛与深度门槛的 AND 关系
//     ⑤ 镜像类型 1:1 (编译期断言)
//   边界: 纯函数测试 —— 不起 Nest, 不连 DB, 不读任何真实逐字稿.
//   验证: pnpm exec vitest run test/engine-core/s1-open-depth-threshold.spec.ts

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ALLIANCE_CONFIG,
  resolveAllianceThresholds,
  resolveSessionAllianceConfig,
  type AllianceConfig,
  type AllianceThresholds,
} from '../../src/engine-core/cognition/alliance-config.js';
import { planIntention } from '../../src/engine-core/cognition/intention-planner.js';
import { createEmptyBdiSnapshot, type BdiSnapshot } from '../../src/engine-core/domain/bdi-snapshot.js';
import type { OpenEngineSessionInput } from '../../src/engine-core/domain/engine-session.types.js';

/** 造一份快照 (默认中性基线, 逐维覆盖). */
function snap(overrides: Partial<BdiSnapshot> = {}): BdiSnapshot {
  return { ...createEmptyBdiSnapshot(), ...overrides };
}

/**
 * 阻抗三维: verbal / style 压低 (排除「话量阻抗高」与「整体防御强」两个分支),
 * depth 留给用例逐个调 —— 探索分支只受 depth 一个变量影响.
 */
function resist(depth: number): BdiSnapshot['resistance'] {
  return { verbal: 0.1, depth, style: 0.1 };
}

/** 实例级配置 (形状 = 适配层产出的四字段端口对象). */
const BASE_CONFIG: AllianceConfig = {
  deltas: {},
  thresholds: { open: 0.6, resistanceTrust: 0.4, resistanceSafety: 0.3, openDepth: 0.35 },
};

describe('S-1 · ① 缺省回落 (钉死风险 B)', () => {
  it('内核种子带 openDepth = 0.35', () => {
    expect(DEFAULT_ALLIANCE_CONFIG.thresholds.openDepth).toBe(0.35);
  });

  it('无注入对象 → 解析结果 openDepth = 0.35 (不是 undefined)', () => {
    expect(resolveAllianceThresholds().openDepth).toBe(0.35);
  });

  it('注入对象缺 openDepth → 解析后补全为 0.35', () => {
    const resolved = resolveAllianceThresholds({
      deltas: {},
      thresholds: { open: 0.6, resistanceTrust: 0.4, resistanceSafety: 0.3 },
    });
    expect(resolved.openDepth).toBe(0.35);
  });

  it('缺省路径: planner 仍按 0.35 判定 —— 探索分支没被静默关掉', () => {
    const intention = planIntention(snap({ trust: 0.8, safety: 0.8, resistance: resist(0.2) }));
    expect(intention.strategy).toBe('cognitive_exploration');
  });
});

describe('S-1 · ② 非法值回落', () => {
  it('openDepth 非法 (NaN / Infinity / <0 / >1) → 一律回落种子 0.35', () => {
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.5]) {
      const resolved = resolveAllianceThresholds({
        deltas: {},
        thresholds: { open: 0.6, resistanceTrust: 0.4, resistanceSafety: 0.3, openDepth: invalid },
      });
      expect(resolved.openDepth).toBe(0.35);
    }
  });

  it('openDepth 合法边界值 (0 / 1) → 原样保留', () => {
    const parsed = (openDepth: number): number | undefined =>
      resolveAllianceThresholds({ deltas: {}, thresholds: { open: 0.6, resistanceTrust: 0.4, resistanceSafety: 0.3, openDepth } })
        .openDepth;

    expect(parsed(0)).toBe(0);
    expect(parsed(1)).toBe(1);
  });
});

describe('S-1 · ③ 会话级覆盖', () => {
  it('给了且合法 → 覆盖生效', () => {
    const resolved = resolveSessionAllianceConfig(BASE_CONFIG, { openDepth: 0.2 });
    expect(resolved?.thresholds.openDepth).toBe(0.2);
  });

  it('缺项 → 回落实例级单例 (不回落种子)', () => {
    const base: AllianceConfig = {
      deltas: {},
      thresholds: { open: 0.6, resistanceTrust: 0.4, resistanceSafety: 0.3, openDepth: 0.5 },
    };
    const resolved = resolveSessionAllianceConfig(base, { open: 0.8 });
    expect(resolved?.thresholds.openDepth).toBe(0.5);
  });

  it('非法值 → 回落种子 0.35', () => {
    const resolved = resolveSessionAllianceConfig(BASE_CONFIG, { openDepth: 5 });
    expect(resolved?.thresholds.openDepth).toBe(0.35);
  });

  it('无覆盖 → 仍返回 base 同一引用 (零回归性质, i12:38 依赖)', () => {
    expect(resolveSessionAllianceConfig(BASE_CONFIG)).toBe(BASE_CONFIG);
  });
});

describe('S-1 · ④ planner 边界两侧', () => {
  it('depth 恰在 openDepth 上下两侧 → 策略按门槛切换', () => {
    const at = (depth: number): string => planIntention(snap({ trust: 0.8, safety: 0.8, resistance: resist(depth) })).strategy;

    expect(at(0.34)).toBe('cognitive_exploration');
    expect(at(0.35)).toBe('recounting');
    expect(at(0.36)).toBe('recounting');
  });

  it('同盟门槛不过时, depth 再低也不进探索 (AND 关系不被破坏)', () => {
    const intention = planIntention(snap({ trust: 0.5, safety: 0.5, resistance: resist(0.1) }));
    expect(intention.strategy).toBe('recounting');
  });

  it('门槛可配置后: 放宽 openDepth 才进探索 (证明端口真的生效)', () => {
    const snapshot = snap({ trust: 0.8, safety: 0.8, resistance: resist(0.4) });
    expect(planIntention(snapshot).strategy).toBe('recounting');
    const loosened: AllianceConfig = {
      deltas: {},
      thresholds: { open: 0.6, resistanceTrust: 0.4, resistanceSafety: 0.3, openDepth: 0.5 },
    };
    expect(planIntention(snapshot, undefined, loosened).strategy).toBe('cognitive_exploration');
  });
});

/**
 * ⑤ 镜像 1:1 —— **编译期**断言.
 *
 * 镜像类型 (`domain/engine-session.types.ts` 的 `allianceThresholds`) 是编译期形状,
 * 运行时不存在, 所以键集合相等只能靠类型系统证: 两侧键集合不一致时, 下面这行
 * `const` 的类型标注就**编译不过** (类型不匹配) —— 不一致会当场变红, 而不是留到线上.
 */
type MirrorKeys = keyof NonNullable<OpenEngineSessionInput['allianceThresholds']>;
type ThresholdKeys = keyof AllianceThresholds;
type KeysMatch = [MirrorKeys] extends [ThresholdKeys] ? ([ThresholdKeys] extends [MirrorKeys] ? true : false) : false;

const MIRROR_KEYS_MATCH: KeysMatch = true;

describe('S-1 · ⑤ 镜像类型 1:1', () => {
  it('镜像字段集合与 AllianceThresholds 严格一致 (类型层 + 运行时)', () => {
    // 运行时: 镜像实际字段名集合 == 内核解析结果的字段名集合.
    const mirror: NonNullable<OpenEngineSessionInput['allianceThresholds']> = {
      open: 0.6,
      resistanceTrust: 0.4,
      resistanceSafety: 0.3,
      openDepth: 0.35,
    };
    expect(Object.keys(mirror).sort()).toEqual(Object.keys(resolveAllianceThresholds(BASE_CONFIG)).sort());
    // 类型层: MIRROR_KEYS_MATCH 的类型是 true —— 键集合不一致时**编译不过** (不是运行时断言).
    expect([MIRROR_KEYS_MATCH, ...Object.keys(mirror)].join(',')).toContain('openDepth');
  });
});
