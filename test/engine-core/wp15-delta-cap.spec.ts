// V2026-11-03 治本 (WP15 · 引擎内核 · 单回合非对称 delta cap 边界回归):
//   目的: 把"一回合 BDI 不该跳太多"这条新领域不变量**机械化** ——
//         ① 多事件叠加不越 [0,1]; ② 上向 cap 真的砍; ③ 下向 cap 非对称;
//         ④ 常见单事件路径零回归; 另加 9 维 cap 覆盖 / 配置覆写 / cap 报告通道.
//
//   V2026-11-03 治本 (WP26 · P2-14): 本文件**不再碰 process.env** ——
//     cap 参数改由调用方注入 (`capConfig`), 内核零 env 读取.
//     原"env 覆写"三条用例改成"配置注入"三条: 收紧 / 放宽 / 非法值回退默认.
//     覆盖口径不变 (收紧了真砍 / 放宽了真放行 / 配错了回退种子值), 只是驱动方式变了.
//
//   V2026-11-03 治本 (WP26 · P2-16): 导入走**公开 barrel** ——
//     这些符号现在是内核的公开面, 走 barrel 顺带证明"barrel 真的导出了它们"
//     (boundary.spec.ts 断言⑥ 是双向白名单, 这里从消费侧再验一次).
//
//   为什么放在 test/ 而不是内核目录里:
//     本仓所有内核测试都在 test/engine-core/ (内核子树只放领域代码);
//     内核目录里放测试文件会被 tsc -p tsconfig.build.json 纳入编译范围,
//     而该配置只排除 **/*.spec.ts 与 test/**/* —— 测试文件混进内核还会被
//     boundary.spec.ts 的"外部依赖白名单 = { nanoid } + node:*"扫到.
//   反依赖污染: 不 import 任何 @nestjs/* / typeorm; 只用内核纯 TS.
//   验证: npx vitest run test/engine-core/wp15-delta-cap.spec.ts

import {
  capTurnDelta,
  transitionState,
  transitionStateDetailed,
  DEFAULT_DELTA_CAP_CONFIG,
  type DeltaCapConfig,
  type DeltaVector,
  type TurnDeltaCapReport,
} from '../../src/engine-core/index.js';
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

/** 造一份 cap 配置: 只改指定维度的上下界, 其余走内核种子值. */
function capConfig(overrides: Partial<Record<keyof DeltaCapConfig, { up: number; down: number }>>): DeltaCapConfig {
  const merged: Record<string, { up: number; down: number }> = {};
  for (const [dim, bounds] of Object.entries(DEFAULT_DELTA_CAP_CONFIG)) {
    merged[dim] = { up: bounds.up, down: bounds.down };
  }
  return { ...merged, ...overrides } as DeltaCapConfig;
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

  describe('cap 常量可由配置覆写 (验收 #2 · WP26 P2-14 改注入)', () => {
    it('配置收紧上向 cap → 真的按配置砍', () => {
      const out = transitionState(snap({ trust: 0.5 }), [ev('empathy'), ev('empathy'), ev('empathy')], {
        capConfig: capConfig({ trust: { up: 0.05, down: -0.3 } }),
      });

      expect(out.trust).toBeCloseTo(0.55, 5);
    });

    it('配置放宽上向 cap → 按配置放行 (默认 0.20 拦得住的 +0.30 放行)', () => {
      const out = transitionState(snap({ trust: 0.5 }), [ev('empathy'), ev('empathy'), ev('empathy')], {
        capConfig: capConfig({ trust: { up: 0.3, down: -0.3 } }),
      });

      expect(out.trust).toBeCloseTo(0.8, 5);
    });

    it('非法配置值回退默认 (非数字 / 符号与方向不符 / 缺项)', () => {
      const out = transitionState(snap({ trust: 0.5 }), [ev('empathy'), ev('empathy'), ev('empathy')], {
        capConfig: {
          ...capConfig({}),
          trust: { up: Number.NaN, down: 0.5 }, // 上向非数字 / 下向符号反了
        },
      });

      expect(out.trust).toBeCloseTo(0.7, 5); // 回退默认上向 0.20

      const down = transitionState(snap({ trust: 0.5 }), [ev('boundary_cross'), ev('boundary_cross'), ev('boundary_cross')], {
        capConfig: {
          ...capConfig({}),
          trust: { up: 0.2, down: 0.5 },
        },
      });
      expect(down.trust).toBeCloseTo(0.2, 5); // 回退默认下向 -0.30
    });
  });

  describe('cap 报告通道 (验收 #8)', () => {
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

      transitionState(snap({ trust: 0.5 }), [ev('empathy'), ev('empathy'), ev('empathy')], {
        observer: (report) => seen.push(report),
      });

      expect(seen).toHaveLength(1);
      expect(seen[0]?.entries.find((entry) => entry.dimension === 'trust')?.raw).toBeCloseTo(0.3, 5);
      expect(seen[0]?.entries.find((entry) => entry.dimension === 'trust')?.capped).toBeCloseTo(0.2, 5);
    });

    it('没被砍时不触发观察者 (不打噪声日志)', () => {
      const seen: TurnDeltaCapReport[] = [];

      transitionState(snap({ trust: 0.5 }), [ev('empathy')], { observer: (report) => seen.push(report) });

      expect(seen).toHaveLength(0);
    });

    // V2026-11-03 治本 (WP25 · 封版审查): 观察者抛错**不许炸穿 turn**.
    //   内核对一切外部注入的能力都是"永不抛穿"的 (assessSafety 的 probe 抛错回落规则;
    //   collectOpeningContext 吞异常回落空数组) —— observer 当时是唯一没设防的一处.
    //   它炸穿的后果最重: 此刻状态还没落库, 整轮 turn 失败, 而原因只是"打日志的回调抛了".
    it('观察者回调抛错 → 状态迁移照常完成, 不炸穿 turn', () => {
      const out = transitionState(snap({ trust: 0.5 }), [ev('empathy'), ev('empathy'), ev('empathy')], {
        observer: () => {
          throw new Error('observer 内部炸了');
        },
      });

      // 状态照常迁移 (cap 生效: +0.30 被砍到 +0.20).
      expect(out.trust).toBeCloseTo(0.7, 5);
    });

    it('观察者回调抛错 → 后续轮次仍能正常迁移 (注入的观察者没被污染)', () => {
      const exploding = (): never => {
        throw new Error('observer 内部炸了');
      };

      const first = transitionState(snap({ trust: 0.5 }), [ev('empathy')], { observer: exploding });
      expect(first.trust).toBeCloseTo(0.6, 5);

      // 不带观察者的调用不受上一次的影响 (观察者是**参数**, 不是模块级状态).
      const second = transitionState(snap({ trust: 0.6 }), [ev('empathy')]);
      expect(second.trust).toBeCloseTo(0.7, 5);
    });
  });
});
