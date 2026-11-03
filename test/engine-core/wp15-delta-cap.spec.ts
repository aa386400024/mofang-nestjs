// V2026-11-03 治本 (WP15 · 引擎内核 · 单回合非对称 delta cap 边界回归):
//   目的: 把"一回合 BDI 不该跳太多"这条新领域不变量**机械化** ——
//         ① 多事件叠加不越 [0,1]; ② 上向 cap 真的砍; ③ 下向 cap 非对称;
//         ④ 常见单事件路径零回归; 另加 9 维 cap 覆盖 / env 覆写 / cap 报告通道.
//   为什么放在 test/ 而不是内核目录里:
//     本仓所有内核测试都在 test/engine-core/ (内核子树只放领域代码);
//     内核目录里放测试文件会被 tsc -p tsconfig.build.json 纳入编译范围,
//     而该配置只排除 **/*.spec.ts 与 test/**/* —— 测试文件混进内核还会被
//     boundary.spec.ts 的"外部依赖白名单 = { nanoid } + node:*"扫到.
//   反依赖污染: 不 import 任何 @nestjs/* / typeorm; 只用内核纯 TS.
//   验证: npx vitest run test/engine-core/wp15-delta-cap.spec.ts

import {
  capTurnDelta,
  observeDeltaCaps,
  transitionState,
  transitionStateDetailed,
  type DeltaVector,
  type TurnDeltaCapReport,
} from '../../src/engine-core/cognition/state-transition.js';
import { createEmptyBdiSnapshot, type BdiSnapshot, type CounselorEventKind, type SessionEvent } from '../../src/engine-core/index.js';

/** 造一条标准事件 (strength 缺省 1 = 规则轨满强度). */
function ev(kind: CounselorEventKind, strength = 1): SessionEvent {
  return { kind, matchedTerms: [], strength };
}

/** 造一份基线快照, 允许覆盖 trust / valence (其余走中性默认基线). */
function snap(overrides: { trust?: number; valence?: number } = {}): BdiSnapshot {
  const base = createEmptyBdiSnapshot();
  return {
    ...base,
    trust: overrides.trust ?? base.trust,
    emotion: { ...base.emotion, valence: overrides.valence ?? base.emotion.valence },
  };
}

/** 断言快照所有维度都落在合法值域内 (valence 是 [-1,1], 其余是 [0,1]). */
function expectWithinRange(snapshot: BdiSnapshot): void {
  expect(snapshot.trust).toBeGreaterThanOrEqual(0);
  expect(snapshot.trust).toBeLessThanOrEqual(1);
  expect(snapshot.emotion.valence).toBeGreaterThanOrEqual(-1);
  expect(snapshot.emotion.valence).toBeLessThanOrEqual(1);
  expect(snapshot.emotion.arousal).toBeGreaterThanOrEqual(0);
  expect(snapshot.emotion.arousal).toBeLessThanOrEqual(1);
  for (const value of Object.values(snapshot.resistance)) {
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  }
  for (const value of Object.values(snapshot.transference)) {
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  }
}

describe('WP15 · 单回合非对称 delta cap', () => {
  describe('边界回归 (任务单 §1.3 四条)', () => {
    it('① 多事件叠加不越 [0,1]: 5×boundary_cross + judgment 全负向砸下来也不越界', () => {
      const events = [...Array.from({ length: 5 }, () => ev('boundary_cross')), ev('judgment')];
      const out = transitionState(snap({ trust: 0.9, valence: 0.9 }), events);

      expectWithinRange(out);
      // cap 先砍 delta, clamp 再兜底: 两道防线都在, 值才可能越界.
      expect(out.trust).toBeCloseTo(0.6, 5); // 0.9 + (-0.30 下向 cap)
      expect(out.emotion.valence).toBeCloseTo(0.6, 5);
      expect(out.resistance.style).toBeCloseTo(0.55, 5); // 0.35 + (+0.20 上向 cap)
    });

    it('② 单回合 cap 真的砍: trust 0.5 + 3×empathy(+0.30) → 只涨到 0.70', () => {
      const out = transitionState(snap({ trust: 0.5 }), [ev('empathy'), ev('empathy'), ev('empathy')]);

      expect(out.trust).toBeLessThanOrEqual(0.7);
      expect(out.trust).toBeCloseTo(0.7, 5); // 0.5 + 上向 cap 0.20 (被砍掉 0.10)
    });

    it('③ 下向 cap 不对称: trust 0.5 + 3×boundary_cross(-0.45) → 只跌到 0.20', () => {
      const out = transitionState(snap({ trust: 0.5 }), [ev('boundary_cross'), ev('boundary_cross'), ev('boundary_cross')]);

      expect(out.trust).toBeGreaterThanOrEqual(0.2);
      // 精确值证明下向 cap 是 -0.30 而不是对称的 -0.20 (对称的话会停在 0.30).
      expect(out.trust).toBeCloseTo(0.2, 5);
    });

    it('④ 零回归: 常见单事件路径完全不受 cap 影响 (无事件 → 快照逐字不变)', () => {
      const base = snap();

      const neutral = transitionState(base, [ev('neutral')]);
      expect(neutral.trust).toBeCloseTo(base.trust, 5);
      expect(neutral.emotion.valence).toBeCloseTo(base.emotion.valence, 5);

      const single = transitionState(base, [ev('empathy')]);
      expect(single.trust).toBeCloseTo(0.4, 5); // 0.3 + 0.10, 单事件远低于 cap
      expect(single.emotion.valence).toBeCloseTo(0.1, 5);
    });
  });

  describe('9 个维度都有上下向 cap (验收 #1)', () => {
    const big = 9;

    it('上向: trust/valence/arousal/阻抗三维 ±0.20, 移情三维 ±0.15', () => {
      const raw: DeltaVector = {
        trust: big,
        verbal: big,
        depth: big,
        style: big,
        valence: big,
        arousal: big,
        positive: big,
        negative: big,
        dependency: big,
      };
      const capped = capTurnDelta(raw);

      expect(capped.trust).toBeCloseTo(0.2, 5);
      expect(capped.valence).toBeCloseTo(0.2, 5);
      expect(capped.arousal).toBeCloseTo(0.2, 5);
      expect(capped.verbal).toBeCloseTo(0.2, 5);
      expect(capped.depth).toBeCloseTo(0.2, 5);
      expect(capped.style).toBeCloseTo(0.2, 5);
      expect(capped.positive).toBeCloseTo(0.15, 5);
      expect(capped.negative).toBeCloseTo(0.15, 5);
      expect(capped.dependency).toBeCloseTo(0.15, 5);
    });

    it('下向: trust/valence -0.30 (损失厌恶), 其余对称', () => {
      const raw: DeltaVector = {
        trust: -big,
        verbal: -big,
        depth: -big,
        style: -big,
        valence: -big,
        arousal: -big,
        positive: -big,
        negative: -big,
        dependency: -big,
      };
      const capped = capTurnDelta(raw);

      expect(capped.trust).toBeCloseTo(-0.3, 5);
      expect(capped.valence).toBeCloseTo(-0.3, 5);
      expect(capped.arousal).toBeCloseTo(-0.2, 5);
      expect(capped.verbal).toBeCloseTo(-0.2, 5);
      expect(capped.depth).toBeCloseTo(-0.2, 5);
      expect(capped.style).toBeCloseTo(-0.2, 5);
      expect(capped.positive).toBeCloseTo(-0.15, 5);
      expect(capped.negative).toBeCloseTo(-0.15, 5);
      expect(capped.dependency).toBeCloseTo(-0.15, 5);
    });

    it('cap 内的 delta 原样透传 (不误伤)', () => {
      const raw: DeltaVector = {
        trust: 0.1,
        verbal: -0.08,
        depth: -0.1,
        style: -0.06,
        valence: 0.1,
        arousal: -0.05,
        positive: 0.03,
        negative: 0,
        dependency: 0,
      };

      expect(capTurnDelta(raw)).toEqual(raw);
    });
  });

  describe('cap 常量可从 env 覆写 (验收 #2)', () => {
    afterEach(() => {
      delete process.env['ENGINE_CAP_TRUST_UP'];
      delete process.env['ENGINE_CAP_TRUST_DOWN'];
    });

    it('env 收紧上向 cap → 真的按 env 砍', () => {
      process.env['ENGINE_CAP_TRUST_UP'] = '0.05';

      const out = transitionState(snap({ trust: 0.5 }), [ev('empathy'), ev('empathy'), ev('empathy')]);

      expect(out.trust).toBeCloseTo(0.55, 5);
    });

    it('env 放宽上向 cap → 按 env 放行 (默认 0.20 拦得住的 +0.30 放行)', () => {
      process.env['ENGINE_CAP_TRUST_UP'] = '0.30';

      const out = transitionState(snap({ trust: 0.5 }), [ev('empathy'), ev('empathy'), ev('empathy')]);

      expect(out.trust).toBeCloseTo(0.8, 5);
    });

    it('非法 env 值回退默认 (非数字 / 符号与方向不符)', () => {
      process.env['ENGINE_CAP_TRUST_UP'] = 'abc';
      process.env['ENGINE_CAP_TRUST_DOWN'] = '0.5'; // 下向 cap 不能是正数

      const up = transitionState(snap({ trust: 0.5 }), [ev('empathy'), ev('empathy'), ev('empathy')]);
      expect(up.trust).toBeCloseTo(0.7, 5); // 回退默认上向 0.20

      const down = transitionState(snap({ trust: 0.5 }), [ev('boundary_cross'), ev('boundary_cross'), ev('boundary_cross')]);
      expect(down.trust).toBeCloseTo(0.2, 5); // 回退默认下向 -0.30
    });
  });

  describe('cap 报告通道 (验收 #8)', () => {
    afterEach(() => {
      observeDeltaCaps(null);
    });

    it('transitionStateDetailed 带出被砍维度与事件清单', () => {
      const { snapshot, capped } = transitionStateDetailed(snap({ trust: 0.5 }), [ev('empathy'), ev('acceptance'), ev('affirmation')]);

      expect(snapshot.trust).toBeCloseTo(0.7, 5);
      expect(capped).not.toBeNull();
      expect(capped?.entries.map((entry) => entry.dimension)).toContain('trust');
      expect(capped?.entries.find((entry) => entry.dimension === 'trust')?.raw).toBeCloseTo(0.26, 5);
      expect(capped?.entries.find((entry) => entry.dimension === 'trust')?.capped).toBeCloseTo(0.2, 5);
      expect(capped?.events).toEqual(['empathy', 'acceptance', 'affirmation']);
    });

    it('没被砍时报告为 null (观测面只报"哪里出过问题")', () => {
      const { capped } = transitionStateDetailed(snap({ trust: 0.5 }), [ev('empathy')]);

      expect(capped).toBeNull();
    });

    it('观察者回调被触发 —— adapter 层据此打 warning (内核不 import logger)', () => {
      const seen: TurnDeltaCapReport[] = [];
      observeDeltaCaps((report) => seen.push(report));

      transitionState(snap({ trust: 0.5 }), [ev('empathy'), ev('empathy'), ev('empathy')]);

      expect(seen).toHaveLength(1);
      expect(seen[0]?.entries.find((entry) => entry.dimension === 'trust')?.raw).toBeCloseTo(0.3, 5);
      expect(seen[0]?.entries.find((entry) => entry.dimension === 'trust')?.capped).toBeCloseTo(0.2, 5);
    });

    it('没被砍时不触发观察者 (不打噪声日志)', () => {
      const seen: TurnDeltaCapReport[] = [];
      observeDeltaCaps((report) => seen.push(report));

      transitionState(snap({ trust: 0.5 }), [ev('empathy')]);

      expect(seen).toHaveLength(0);
    });
  });
});
