// V2026-11-04 WP51 (引擎内核 · 角色种子同盟三维基线 · 单测):
//   目的: 把任务单 §6.3 的验收条目从"人工核对"变成**机器断言** ——
//     ① 角色基线给了 safety / bond → 快照用**角色的值**;
//     ② 没给 → 用内核默认值 (DEFAULT_SAFETY / DEFAULT_BOND), 行为与 WP42 逐字一致;
//     ③ 越界值被 clamp (与 trust 同一口径), 且 0 是**有效值**而不是"没给";
//     ④ 既有维度与快照字段集合逐字不变 (加可选基线不该动到任何一个既有键).
//
//   为什么"0 是有效值"要单独钉一条:
//     回退口径是 `profile?.baseline?.safety ?? DEFAULT_SAFETY` —— `??` 只兜
//     null/undefined. 所以"角色明确给 0"(完全不敢敞开心扉)与"角色没给"必须能区分开,
//     否则 0 会被当成"没给"而回退到 0.5, 语义完全反了.
//
//   边界: 纯函数 / 内存实现, 不起 Nest 容器, 不碰网络.
//
//   验证: npx vitest run test/engine-core/wp51-character-seed-alliance-baseline.spec.ts
//   时间戳: 2026-11-04 GMT+8

import {
  buildInitialSnapshot,
  DEFAULT_BOND,
  DEFAULT_RESISTANCE,
  DEFAULT_SAFETY,
  DEFAULT_TRUST,
} from '../../src/engine-core/domain/bootstrap.js';
import type { CharacterProfile } from '../../src/engine-core/domain/character-profile.js';

/** 造一个最小角色 profile (只填必填字段). */
function profile(baseline: CharacterProfile['baseline'] = {}): CharacterProfile {
  return {
    coreBeliefs: [],
    forbiddenBehaviors: [],
    sensitiveTopics: [],
    ...(baseline ? { baseline } : {}),
  };
}

describe('WP51 · 角色种子同盟三维基线 (内核装配)', () => {
  describe('① 角色给了就用角色的', () => {
    it('baseline 给了 safety / bond → 快照用角色的值', () => {
      const snapshot = buildInitialSnapshot(profile({ safety: 0.25, bond: 0.05 }));

      expect(snapshot.safety).toBe(0.25);
      expect(snapshot.bond).toBe(0.05);
    });

    it('回避型档位与焦虑型档位在快照上真的分得开 (两角色不再同一起点)', () => {
      const avoidant = buildInitialSnapshot(profile({ safety: 0.25, bond: 0.05 }));
      const anxious = buildInitialSnapshot(profile({ safety: 0.4, bond: 0.5 }));

      expect(avoidant.safety).toBeLessThan(anxious.safety);
      // 回避型联结感低、焦虑型联结感高 —— 这是"依恋风格差异落到开场状态"的本意.
      expect(avoidant.bond).toBeLessThan(anxious.bond);
    });

    it('只给 safety 不给 bond → safety 用角色的, bond 走默认值', () => {
      const snapshot = buildInitialSnapshot(profile({ safety: 0.2 }));

      expect(snapshot.safety).toBe(0.2);
      expect(snapshot.bond).toBe(DEFAULT_BOND);
    });
  });

  describe('② 没给就走默认值 (零回归)', () => {
    it('baseline 不给 safety / bond → 用内核默认值', () => {
      const snapshot = buildInitialSnapshot(profile());

      expect(snapshot.safety).toBe(DEFAULT_SAFETY);
      expect(snapshot.bond).toBe(DEFAULT_BOND);
    });

    it('没有 profile → 同样走默认值 (与 WP42 逐字一致)', () => {
      const snapshot = buildInitialSnapshot();

      expect(snapshot.trust).toBe(DEFAULT_TRUST);
      expect(snapshot.safety).toBe(DEFAULT_SAFETY);
      expect(snapshot.bond).toBe(DEFAULT_BOND);
      expect(snapshot.resistance).toEqual(DEFAULT_RESISTANCE);
    });

    it('baseline 只给 trust → safety / bond 不受影响 (仍走默认值)', () => {
      const snapshot = buildInitialSnapshot(profile({ trust: 0.8 }));

      expect(snapshot.trust).toBe(0.8);
      expect(snapshot.safety).toBe(DEFAULT_SAFETY);
      expect(snapshot.bond).toBe(DEFAULT_BOND);
    });
  });

  describe('③ 边界: clamp 与"0 是有效值"', () => {
    it('越界值被 clamp 到 [0,1] (与 trust 同一口径)', () => {
      const snapshot = buildInitialSnapshot(profile({ safety: 1.5, bond: -0.3 }));

      expect(snapshot.safety).toBe(1);
      expect(snapshot.bond).toBe(0);
    });

    it('非有限值由 clamp01 兜住 (落点与 trust 完全一致: NaN → 0)', () => {
      const snapshot = buildInitialSnapshot(profile({ safety: Number.NaN, bond: Number.POSITIVE_INFINITY }));

      // clamp01 的落点是 0 (不是回退默认值) —— 与 trust 的既有口径**一模一样**:
      //   脏值不会被静默换成"看起来正常"的默认值, 而是落到区间下界.
      expect(snapshot.safety).toBe(0);
      expect(snapshot.bond).toBe(1);
      expect(Number.isFinite(snapshot.safety)).toBe(true);
      expect(Number.isFinite(snapshot.bond)).toBe(true);
    });

    it('0 是**有效值**而不是"没给" (?? 只兜 null/undefined)', () => {
      const snapshot = buildInitialSnapshot(profile({ safety: 0, bond: 0 }));

      expect(snapshot.safety).toBe(0);
      expect(snapshot.bond).toBe(0);
      // 关键: 没回退到 0.5 —— 语义完全反了的话, "完全不敢敞开心扉"会变成"安全感中等".
      expect(snapshot.safety).not.toBe(DEFAULT_SAFETY);
    });
  });

  describe('④ 既有维度与字段集合逐字不变', () => {
    it('trust / resistance / emotion / transference 的装配口径一个字没改', () => {
      const snapshot = buildInitialSnapshot(profile({ trust: 0.8, safety: 0.25, bond: 0.05 }));

      expect(snapshot.trust).toBe(0.8);
      expect(snapshot.resistance).toEqual(DEFAULT_RESISTANCE);
      expect(snapshot.transference).toEqual({ positive: 0, negative: 0, dependency: 0 });
      expect(snapshot.emotion.label).toBe('neutral');
    });

    it('快照字段集合逐字不变 (加基线不动到任何一个既有键)', () => {
      const keys = Object.keys(buildInitialSnapshot(profile({ safety: 0.25, bond: 0.05 }))).toSorted((a, b) => a.localeCompare(b));

      expect(keys).toEqual([
        'bond',
        'coreBeliefActivation',
        'coreBeliefs',
        'emotion',
        'memoryBeliefs',
        'resistance',
        'safety',
        'situationalDesires',
        'temporaryBeliefs',
        'transference',
        'trust',
        'underlyingDesires',
      ]);
    });

    it('给与不给 safety / bond, 快照字段集合完全一样 (没有多出键)', () => {
      const withAlliance = Object.keys(buildInitialSnapshot(profile({ safety: 0.25, bond: 0.05 }))).toSorted();
      const withoutAlliance = Object.keys(buildInitialSnapshot(profile())).toSorted();

      expect(withAlliance).toEqual(withoutAlliance);
    });
  });
});
