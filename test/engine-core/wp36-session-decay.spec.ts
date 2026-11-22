// V2026-11-03 WP36 (引擎内核 · 跨会话间隔自然衰减):
//   目的: 钉死"resume 时按间隔对情绪 / 阻抗 / 同盟做差异化半衰期回落"这条规则 ——
//     ① 零间隔 → 快照原样 (不衰减);
//     ② 三组各自的半衰期处**恰好减半** (情绪 7 天 / 阻抗 14 天 / 同盟 30 天);
//     ③ 稳定人格维度 (信念 / 欲望 / 移情) **逐字不变**;
//     ④ 边界: 负间隔按 0 处理 / 非法端口值回退种子值 / 标签随数值重算 / 长间隔不归零;
//     ⑤ 会话层: 衰减只发生在**跨场边界的那一次**, 无 resume 时行为逐字不变.
//
//   为什么"恰好减半"是硬断言 (而不是"变小了"):
//     半衰期是**可解释锚点** —— "隔了 7 天, 情绪正好平复一半"这句话只有成立, 调参才有意义.
//     写成"变小了"的话, 半衰期改成 7 小时也照样绿, 那这组系数就是不可校准的.
//
//   反依赖污染:
//     不 import 任何 @nestjs/* / typeorm; 只用内核纯 TS + 内存实现.
//
//   验证: npx vitest run test/engine-core/wp36-session-decay.spec.ts
//
// V2026-11-04 WP54 (引擎内核 · 破裂态阻抗衰减下限):
//   目的: 钉死"上一场处于破裂态时, 阻抗衰减有一条下限"这条规则 ——
//     ① 正常态 (trust / safety 都在门槛之上): 行为与 WP36 **逐字一致** (零回归);
//     ② 破裂态 (trust 或 safety 塌到门槛之下): 阻抗衰减后**不低于 floor**;
//     ③ floor = 0 / 不传 floor → 不启用下限;
//     ④ 不传 allianceThresholds → 不启用破裂态判断;
//     ⑤ 正常衰减值已高于 floor → 按正常值 (不强行抬升);
//     ⑥ 破裂态判定读**上一场结束时**的值 (衰减前), 不是衰减后的值;
//     ⑦ 破裂态下情绪 / 同盟**照常衰减** (本期只补阻抗一维);
//     ⑧ 非法 floor / 非法门槛 → 回退 (floor 退 0 禁用, 门槛退内核种子值).
//
//   为什么"不低于 floor"要写成硬断言 (而不是"变小了"):
//     floor 的含义是"隔多久都至少保留这么多防御" —— 写成"变小了"的话,
//     floor 配成 0 也能绿, 那这条下限就不可校准.
//
//   反依赖污染:
//     门槛直接取 `DEFAULT_ALLIANCE_CONFIG.thresholds` —— 测试也不另造一份,
//     免得"内核用的门槛"和"测试用的门槛"漂移 (与内核的单一真相源纪律一致).

import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository.js';
import { InMemoryEngineSession } from '../../src/engine-core/in-memory/in-memory-engine-session.js';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store.js';
import {
  DEFAULT_ALLIANCE_CONFIG,
  DEFAULT_SESSION_DECAY_CONFIG,
  applySessionDecay,
  createEmptyBdiSnapshot,
  type AllianceThresholds,
  type BdiSnapshot,
} from '../../src/engine-core/index.js';

/** 一天 (ms). */
const DAY_MS = 24 * 3600 * 1000;

/** 租户. */
const TENANT = 'default';

/**
 * 造一份"各维度取值都非零"的快照.
 *
 * 为什么不用默认基线: 默认的 valence=0 / bond=0 / transference 全 0 ——
 * 拿 0 去验"减半"是验不出东西的 (0 的一半还是 0). 每一维都必须有可辨的取值.
 */
function makeSnapshot(): BdiSnapshot {
  const base = createEmptyBdiSnapshot();
  return {
    ...base,
    coreBeliefs: [{ theme: 'unlovable', statement: '我是不值得被爱的', activationTags: ['core'] }],
    temporaryBeliefs: [{ id: 'tb-1', statement: '这次会好起来的', confidence: 0.6, source: 'observed' }],
    memoryBeliefs: [{ id: 'mb-1', statement: '上周几乎没睡', confidence: 0.8, expiresAt: null }],
    situationalDesires: [{ id: 'sd-1', text: '想被理解', priority: 0.7, active: true }],
    emotion: { label: 'angry', valence: -0.8, arousal: 0.8 },
    resistance: { verbal: 0.7, depth: 0.6, style: 0.5 },
    transference: { positive: 0.3, negative: 0.5, dependency: 0.2 },
    trust: 0.8,
    safety: 0.6,
    bond: 0.4,
  };
}

describe('WP36 · 跨会话间隔自然衰减 (纯函数)', () => {
  describe('① 零间隔 → 不衰减', () => {
    it('ageMs = 0 时快照原样返回 (数值逐字不变)', () => {
      const snapshot = makeSnapshot();
      const decayed = applySessionDecay(snapshot, 0);

      expect(decayed.emotion.valence).toBe(-0.8);
      expect(decayed.emotion.arousal).toBe(0.8);
      expect(decayed.emotion.label).toBe('angry');
      expect(decayed.resistance).toEqual({ verbal: 0.7, depth: 0.6, style: 0.5 });
      expect(decayed.trust).toBe(0.8);
      expect(decayed.safety).toBe(0.6);
      expect(decayed.bond).toBe(0.4);
    });

    it('ageMs = 0 时情绪标签也不重算 (标签与数值仍然对得上)', () => {
      const decayed = applySessionDecay(makeSnapshot(), 0);
      // 原始标签是 angry (valence=-0.8 / arousal=0.8 推出); 不重算就该仍是 angry.
      expect(decayed.emotion.label).toBe('angry');
    });
  });

  describe('② 三组各自的半衰期处恰好减半', () => {
    it('ageMs = 7 天 → valence / arousal 恰好减半', () => {
      const decayed = applySessionDecay(makeSnapshot(), 7 * DAY_MS);

      expect(decayed.emotion.valence).toBeCloseTo(-0.4, 10);
      expect(decayed.emotion.arousal).toBeCloseTo(0.4, 10);
    });

    it('ageMs = 14 天 → 阻抗三维恰好减半', () => {
      const decayed = applySessionDecay(makeSnapshot(), 14 * DAY_MS);

      expect(decayed.resistance.verbal).toBeCloseTo(0.35, 10);
      expect(decayed.resistance.depth).toBeCloseTo(0.3, 10);
      expect(decayed.resistance.style).toBeCloseTo(0.25, 10);
    });

    it('ageMs = 30 天 → trust / safety / bond 恰好减半', () => {
      const decayed = applySessionDecay(makeSnapshot(), 30 * DAY_MS);

      expect(decayed.trust).toBeCloseTo(0.4, 10);
      expect(decayed.safety).toBeCloseTo(0.3, 10);
      expect(decayed.bond).toBeCloseTo(0.2, 10);
    });

    it('各组互不串味: 情绪半衰期处阻抗与同盟不该跟着减半', () => {
      const decayed = applySessionDecay(makeSnapshot(), 7 * DAY_MS);

      // 阻抗半衰期 14 天 → 7 天时只走了半程 (2^(-0.5) ≈ 0.7071).
      expect(decayed.resistance.verbal).toBeCloseTo(0.7 * Math.pow(2, -0.5), 10);
      // 同盟半衰期 30 天 → 7 天时几乎没动.
      expect(decayed.trust).toBeCloseTo(0.8 * Math.pow(2, -7 / 30), 10);
      expect(decayed.trust).toBeGreaterThan(0.6);
    });

    it('负效价保留符号 (情绪平复是"幅度变小", 不是"变正面")', () => {
      const decayed = applySessionDecay(makeSnapshot(), 7 * DAY_MS);

      expect(decayed.emotion.valence).toBeLessThan(0);
    });
  });

  describe('③ 稳定人格维度逐字不变', () => {
    it('coreBeliefs / temporaryBeliefs / memoryBeliefs / 欲望 / 移情三态 全部不动', () => {
      const snapshot = makeSnapshot();
      const decayed = applySessionDecay(snapshot, 90 * DAY_MS);

      expect(decayed.coreBeliefs).toEqual(snapshot.coreBeliefs);
      expect(decayed.temporaryBeliefs).toEqual(snapshot.temporaryBeliefs);
      expect(decayed.memoryBeliefs).toEqual(snapshot.memoryBeliefs);
      expect(decayed.underlyingDesires).toEqual(snapshot.underlyingDesires);
      expect(decayed.situationalDesires).toEqual(snapshot.situationalDesires);
      expect(decayed.transference).toEqual(snapshot.transference);
    });

    it('移情三态在 90 天后仍逐字不变 (移情不是状态性维度)', () => {
      const snapshot = makeSnapshot();
      const decayed = applySessionDecay(snapshot, 90 * DAY_MS);

      expect(decayed.transference.positive).toBe(0.3);
      expect(decayed.transference.negative).toBe(0.5);
      expect(decayed.transference.dependency).toBe(0.2);
    });
  });

  describe('④ 边界', () => {
    it('ageMs 为负数 (时钟偏移) → 按 0 处理, 不衰减', () => {
      const decayed = applySessionDecay(makeSnapshot(), -5 * DAY_MS);

      expect(decayed.trust).toBe(0.8);
      expect(decayed.emotion.valence).toBe(-0.8);
      expect(decayed.resistance.verbal).toBe(0.7);
    });

    it('非法端口值 (0 / 负数 / NaN) → 逐项回退内核种子值, 不产生 NaN / Infinity', () => {
      const decayed = applySessionDecay(makeSnapshot(), 7 * DAY_MS, {
        emotionHalfLifeMs: 0,
        resistanceHalfLifeMs: -1,
        allianceHalfLifeMs: Number.NaN,
      });

      expect(decayed.emotion.valence).toBeCloseTo(-0.4, 10); // 回退 7 天 → 恰好减半
      expect(decayed.resistance.verbal).toBeCloseTo(0.7 * Math.pow(2, -0.5), 10); // 回退 14 天
      expect(decayed.trust).toBeCloseTo(0.8 * Math.pow(2, -7 / 30), 10); // 回退 30 天
      expect(Number.isFinite(decayed.trust)).toBe(true);
    });

    it('自定义端口真的生效 (半衰期改成 1 天 → 1 天恰好减半)', () => {
      const decayed = applySessionDecay(makeSnapshot(), 1 * DAY_MS, {
        emotionHalfLifeMs: 1 * DAY_MS,
        resistanceHalfLifeMs: 1 * DAY_MS,
        allianceHalfLifeMs: 1 * DAY_MS,
      });

      expect(decayed.emotion.valence).toBeCloseTo(-0.4, 10);
      expect(decayed.resistance.verbal).toBeCloseTo(0.35, 10);
      expect(decayed.trust).toBeCloseTo(0.4, 10);
    });

    it('情绪标签随数值重算 (数值动了标签必须跟着动, 否则标签与数值对不上)', () => {
      const snapshot = makeSnapshot();
      expect(snapshot.emotion.label).toBe('angry');

      const decayed = applySessionDecay(snapshot, 7 * DAY_MS);

      // valence=-0.4 / arousal=0.4 → 象限落点变成 guarded (不再是 angry).
      expect(decayed.emotion.label).toBe('guarded');
    });

    it('传入的快照不被就地修改 (快照是值语义)', () => {
      const snapshot = makeSnapshot();
      applySessionDecay(snapshot, 30 * DAY_MS);

      expect(snapshot.trust).toBe(0.8);
      expect(snapshot.emotion.valence).toBe(-0.8);
      expect(snapshot.resistance.verbal).toBe(0.7);
      expect(snapshot.emotion.label).toBe('angry');
    });

    it('衰减恒 > 0 → 隔很久也不会清零 (关系不回到陌生人)', () => {
      const decayed = applySessionDecay(makeSnapshot(), 3650 * DAY_MS);

      expect(decayed.trust).toBeGreaterThan(0);
      expect(decayed.safety).toBeGreaterThan(0);
      expect(decayed.bond).toBeGreaterThan(0);
      expect(decayed.trust).toBeLessThan(0.8);
    });

    it('内核种子值 = 7 天 / 14 天 / 30 天', () => {
      expect(DEFAULT_SESSION_DECAY_CONFIG.emotionHalfLifeMs).toBe(7 * DAY_MS);
      expect(DEFAULT_SESSION_DECAY_CONFIG.resistanceHalfLifeMs).toBe(14 * DAY_MS);
      expect(DEFAULT_SESSION_DECAY_CONFIG.allianceHalfLifeMs).toBe(30 * DAY_MS);
    });
  });
});

/**
 * 破裂态快照: 上一场结束时信任 / 安全感都塌到抗拒门槛之下, 阻抗还硬着.
 *
 * 为什么数值这么选 (工程种子值, 非临床标定):
 *   · trust 0.2 < resistanceTrust 0.4, safety 0.1 < resistanceSafety 0.3 → 破裂;
 *   · 阻抗三维取 0.9 / 0.8 / 0.7 —— 隔 7 天 (阻抗半衰期 14 天) 恰好各走半程,
 *     于是 style 落到 0.7 * 2^(-0.5) ≈ 0.4949 < 0.5, 而 verbal / depth 仍 > 0.5.
 *     用 floor = 0.5 时**只有 style 会被兜住**, 另两维保持不变 ——
 *     一组断言就能同时钉死"会被兜"与"不会被强行抬".
 */
function makeRupturedSnapshot(): BdiSnapshot {
  const base = makeSnapshot();
  return {
    ...base,
    resistance: { verbal: 0.9, depth: 0.8, style: 0.7 },
    trust: 0.2,
    safety: 0.1,
    bond: 0.3,
  };
}

/**
 * 同盟门槛: 直接取内核种子配置 —— 测试也不另造一份门槛.
 *
 * 为什么: "内核用的门槛"和"测试用的门槛"一旦各写一份, 迟早漂移;
 * 取同一份, 门槛调了测试自动跟着走 (与内核的单一真相源纪律一致).
 */
const THRESHOLDS: AllianceThresholds = DEFAULT_ALLIANCE_CONFIG.thresholds;

describe('WP54 · 破裂态阻抗衰减下限 (纯函数)', () => {
  describe('① 正常态零回归', () => {
    it('trust / safety 都在门槛之上 → 阻抗与 WP36 逐字一致', () => {
      const baseline = applySessionDecay(makeSnapshot(), 7 * DAY_MS);
      const decayed = applySessionDecay(
        makeSnapshot(),
        7 * DAY_MS,
        { ...DEFAULT_SESSION_DECAY_CONFIG, ruptureResistanceFloor: 0.7 },
        THRESHOLDS,
      );

      expect(decayed.resistance).toEqual(baseline.resistance);
      expect(decayed.trust).toBe(baseline.trust);
      expect(decayed.safety).toBe(baseline.safety);
      expect(decayed.bond).toBe(baseline.bond);
      expect(decayed.emotion).toEqual(baseline.emotion);
    });

    it('不传 floor → 破裂态也与 WP36 逐字一致 (缺省即禁用)', () => {
      const baseline = applySessionDecay(makeRupturedSnapshot(), 7 * DAY_MS);
      const decayed = applySessionDecay(makeRupturedSnapshot(), 7 * DAY_MS, { ...DEFAULT_SESSION_DECAY_CONFIG }, THRESHOLDS);

      expect(decayed.resistance).toEqual(baseline.resistance);
    });
  });

  describe('② 破裂态: 阻抗衰减后不低于 floor', () => {
    it('floor = 0.5 → 只有会跌破 0.5 的那一维被兜住, 另两维保持不变', () => {
      const decayed = applySessionDecay(
        makeRupturedSnapshot(),
        7 * DAY_MS,
        { ...DEFAULT_SESSION_DECAY_CONFIG, ruptureResistanceFloor: 0.5 },
        THRESHOLDS,
      );

      // verbal / depth 本来就高于 0.5 → 保持正常衰减值 (不被强行抬到 floor).
      expect(decayed.resistance.verbal).toBeCloseTo(0.9 * Math.pow(2, -0.5), 10);
      expect(decayed.resistance.depth).toBeCloseTo(0.8 * Math.pow(2, -0.5), 10);
      // style 正常衰减会跌破 0.5 → 被兜在 0.5.
      expect(decayed.resistance.style).toBeCloseTo(0.5, 10);
      expect(decayed.resistance.style).toBeGreaterThan(0.7 * Math.pow(2, -0.5));
    });

    it('floor = 0.7 → 阻抗三维全部不低于 floor', () => {
      const decayed = applySessionDecay(
        makeRupturedSnapshot(),
        7 * DAY_MS,
        { ...DEFAULT_SESSION_DECAY_CONFIG, ruptureResistanceFloor: 0.7 },
        THRESHOLDS,
      );

      expect(decayed.resistance.verbal).toBeCloseTo(0.7, 10);
      expect(decayed.resistance.depth).toBeCloseTo(0.7, 10);
      expect(decayed.resistance.style).toBeCloseTo(0.7, 10);
      expect(decayed.resistance.verbal).toBeGreaterThanOrEqual(0.7);
      expect(decayed.resistance.depth).toBeGreaterThanOrEqual(0.7);
      expect(decayed.resistance.style).toBeGreaterThanOrEqual(0.7);
    });

    it('隔很久 (365 天) 也兜得住 —— 下限不是"只兜一点点"', () => {
      const decayed = applySessionDecay(
        makeRupturedSnapshot(),
        365 * DAY_MS,
        { ...DEFAULT_SESSION_DECAY_CONFIG, ruptureResistanceFloor: 0.6 },
        THRESHOLDS,
      );

      expect(decayed.resistance.verbal).toBeCloseTo(0.6, 10);
      expect(decayed.resistance.depth).toBeCloseTo(0.6, 10);
      expect(decayed.resistance.style).toBeCloseTo(0.6, 10);
    });
  });

  describe('③ 不启用下限 / 不启用破裂态判断', () => {
    it('floor = 0 → 破裂态也与 WP36 逐字一致 (不启用下限)', () => {
      const baseline = applySessionDecay(makeRupturedSnapshot(), 7 * DAY_MS);
      const decayed = applySessionDecay(
        makeRupturedSnapshot(),
        7 * DAY_MS,
        { ...DEFAULT_SESSION_DECAY_CONFIG, ruptureResistanceFloor: 0 },
        THRESHOLDS,
      );

      expect(decayed.resistance).toEqual(baseline.resistance);
      expect(decayed.resistance.style).toBeCloseTo(0.7 * Math.pow(2, -0.5), 10);
    });

    it('不传 allianceThresholds → 破裂态也与 WP36 逐字一致 (不启用破裂态判断)', () => {
      const baseline = applySessionDecay(makeRupturedSnapshot(), 7 * DAY_MS);
      const decayed = applySessionDecay(makeRupturedSnapshot(), 7 * DAY_MS, {
        ...DEFAULT_SESSION_DECAY_CONFIG,
        ruptureResistanceFloor: 0.7,
      });

      expect(decayed.resistance).toEqual(baseline.resistance);
      expect(decayed.resistance.style).toBeCloseTo(0.7 * Math.pow(2, -0.5), 10);
    });
  });

  describe('④ 不强行抬升 (是衰减下限, 不是"反升")', () => {
    it('正常衰减值本来就高于 floor → 按正常衰减值, 阻抗不会比上一场更高', () => {
      const decayed = applySessionDecay(
        makeRupturedSnapshot(),
        7 * DAY_MS,
        { ...DEFAULT_SESSION_DECAY_CONFIG, ruptureResistanceFloor: 0.3 },
        THRESHOLDS,
      );

      expect(decayed.resistance.verbal).toBeCloseTo(0.9 * Math.pow(2, -0.5), 10);
      expect(decayed.resistance.depth).toBeCloseTo(0.8 * Math.pow(2, -0.5), 10);
      expect(decayed.resistance.style).toBeCloseTo(0.7 * Math.pow(2, -0.5), 10);
      // 关键: 阻抗只会比上一场结束时**更低**, 不会被抬到 floor 以上.
      expect(decayed.resistance.verbal).toBeLessThan(0.9);
      expect(decayed.resistance.depth).toBeLessThan(0.8);
      expect(decayed.resistance.style).toBeLessThan(0.7);
    });
  });

  describe('⑤ 破裂态判定读"上一场结束时"的值 (衰减前)', () => {
    it('上一场结束时不破裂 (trust 0.45 > 0.4) → 即使衰减后跌破门槛也不兜底', () => {
      const borderline: BdiSnapshot = { ...makeSnapshot(), trust: 0.45, safety: 0.5 };
      const decayed = applySessionDecay(
        borderline,
        60 * DAY_MS,
        { ...DEFAULT_SESSION_DECAY_CONFIG, ruptureResistanceFloor: 0.5 },
        THRESHOLDS,
      );

      // 衰减后 trust 确实跌破门槛 (0.45 * 2^(-2) = 0.1125 < 0.4) —— 但门槛问的是"上一场".
      expect(decayed.trust).toBeCloseTo(0.1125, 10);
      expect(decayed.trust).toBeLessThan(THRESHOLDS.resistanceTrust);
      // 所以阻抗照常裸衰减, 没有被兜到 0.5.
      expect(decayed.resistance.verbal).toBeCloseTo(0.7 * Math.pow(2, -60 / 14), 10);
      expect(decayed.resistance.verbal).toBeLessThan(0.5);
    });
  });

  describe('⑥ 破裂态下情绪 / 同盟照常衰减 (本期只补阻抗一维)', () => {
    it('情绪与同盟不受下限影响 —— 没有下限就是没有下限', () => {
      const decayed = applySessionDecay(
        makeRupturedSnapshot(),
        7 * DAY_MS,
        { ...DEFAULT_SESSION_DECAY_CONFIG, ruptureResistanceFloor: 0.7 },
        THRESHOLDS,
      );

      // 情绪半衰期 7 天 → 恰好减半 (负效价保留符号).
      expect(decayed.emotion.valence).toBeCloseTo(-0.4, 10);
      expect(decayed.emotion.arousal).toBeCloseTo(0.4, 10);
      // 同盟半衰期 30 天 → 7 天只走了 7/30.
      expect(decayed.trust).toBeCloseTo(0.2 * Math.pow(2, -7 / 30), 10);
      expect(decayed.safety).toBeCloseTo(0.1 * Math.pow(2, -7 / 30), 10);
      expect(decayed.bond).toBeCloseTo(0.3 * Math.pow(2, -7 / 30), 10);
      expect(decayed.trust).toBeLessThan(0.2);
      expect(decayed.safety).toBeLessThan(0.1);
    });
  });

  describe('⑦ 非法值回退', () => {
    it('非法 floor (1.5 / -0.2 / NaN) → 回退 0 (禁用), 且阻抗不越界', () => {
      for (const floor of [1.5, -0.2, Number.NaN]) {
        const decayed = applySessionDecay(
          makeRupturedSnapshot(),
          7 * DAY_MS,
          { ...DEFAULT_SESSION_DECAY_CONFIG, ruptureResistanceFloor: floor },
          THRESHOLDS,
        );

        expect(decayed.resistance.verbal).toBeCloseTo(0.9 * Math.pow(2, -0.5), 10);
        expect(decayed.resistance.style).toBeCloseTo(0.7 * Math.pow(2, -0.5), 10);
        expect(decayed.resistance.verbal).toBeLessThanOrEqual(1);
        expect(decayed.resistance.style).toBeLessThanOrEqual(1);
      }
    });

    it('非法门槛 → 回退内核种子门槛 (0.4 / 0.3), 不是照着越界值判', () => {
      // resistanceTrust = -1 越界 → 回退 0.4; snapshot trust 0.35 < 0.4 → 破裂.
      // (若照着 -1 判, 0.35 < -1 不成立 → 不会破裂 —— 这条断言正好钉住回退.)
      const badTrust: BdiSnapshot = { ...makeSnapshot(), trust: 0.35, safety: 0.5 };
      const byTrust = applySessionDecay(
        badTrust,
        7 * DAY_MS,
        { ...DEFAULT_SESSION_DECAY_CONFIG, ruptureResistanceFloor: 0.5 },
        { open: 0.6, resistanceTrust: -1, resistanceSafety: 0.3 },
      );
      expect(byTrust.resistance.style).toBeCloseTo(0.5, 10);

      // resistanceSafety = -1 越界 → 回退 0.3; snapshot safety 0.25 < 0.3 → 破裂.
      const badSafety: BdiSnapshot = { ...makeSnapshot(), trust: 0.5, safety: 0.25 };
      const bySafety = applySessionDecay(
        badSafety,
        7 * DAY_MS,
        { ...DEFAULT_SESSION_DECAY_CONFIG, ruptureResistanceFloor: 0.5 },
        { open: 0.6, resistanceTrust: 0.4, resistanceSafety: -1 },
      );
      expect(bySafety.resistance.style).toBeCloseTo(0.5, 10);
    });
  });

  describe('⑧ 值语义', () => {
    it('破裂态下传入的快照也不被就地修改', () => {
      const snapshot = makeRupturedSnapshot();
      applySessionDecay(snapshot, 7 * DAY_MS, { ...DEFAULT_SESSION_DECAY_CONFIG, ruptureResistanceFloor: 0.5 }, THRESHOLDS);

      expect(snapshot.resistance).toEqual({ verbal: 0.9, depth: 0.8, style: 0.7 });
      expect(snapshot.trust).toBe(0.2);
      expect(snapshot.safety).toBe(0.1);
      expect(snapshot.bond).toBe(0.3);
    });
  });
});

/** 会话层测试台: 内存仓储 + 可推进的确定性时钟. */
function createHarness(): {
  readonly bdiStates: InMemoryBdiStateRepository;
  readonly session: InMemoryEngineSession;
  readonly advance: (ms: number) => void;
} {
  const bdiStates = new InMemoryBdiStateRepository();
  let idSeq = 0;
  let clock = 1_700_000_000_000;
  const now = (): number => clock;
  const memories = new InMemoryMemoryStore({ now });
  const session = new InMemoryEngineSession({
    bdiStates,
    memories,
    idFactory: () => {
      idSeq += 1;
      return `wp36-id-${idSeq}`;
    },
    now,
  });
  return {
    bdiStates,
    session,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

/** 中性文本 → 零 delta (断言只反映衰减本身, 不掺事件推进). */
const NEUTRAL_TEXT = '今天天气不错';

describe('WP36 · 跨会话间隔自然衰减 (会话层接线)', () => {
  it('resume 走接续分支时, 上一场状态的 updatedAt 决定衰减幅度', async () => {
    const { bdiStates, session, advance } = createHarness();

    await bdiStates.save({
      tenantId: TENANT,
      sessionId: 'prev',
      revision: 1,
      updatedAt: 1_700_000_000_000,
      snapshot: makeSnapshot(),
    });

    // 隔 30 天.
    advance(30 * DAY_MS);

    const handle = session.openSession({
      sessionId: 'next',
      tenantId: TENANT,
      visitorId: 'v1',
      resumeFromSessionId: 'prev',
    });
    const out = await session.turn(handle.handleId, { userText: NEUTRAL_TEXT });

    // 同盟半衰期 30 天 → 恰好减半 (中性事件零 delta, 所以数值只反映衰减).
    expect(out.snapshot.trust).toBeCloseTo(0.4, 10);
    expect(out.snapshot.safety).toBeCloseTo(0.3, 10);
    expect(out.snapshot.bond).toBeCloseTo(0.2, 10);
    // 情绪半衰期 7 天 → 30 天已是 4 个半衰期以上, 情绪几乎完全平复.
    expect(out.snapshot.emotion.valence).toBeCloseTo(-0.8 * Math.pow(2, -30 / 7), 10);
    // 阻抗半衰期 14 天 → 30 天 ≈ 2.14 个半衰期.
    expect(out.snapshot.resistance.verbal).toBeCloseTo(0.7 * Math.pow(2, -30 / 14), 10);
    // 稳定人格维度逐字不变.
    expect(out.snapshot.coreBeliefs).toEqual(makeSnapshot().coreBeliefs);
    expect(out.snapshot.transference).toEqual(makeSnapshot().transference);
  });

  it('衰减只发生在跨场边界那一次: 本场第二轮不再衰减', async () => {
    const { bdiStates, session, advance } = createHarness();

    await bdiStates.save({
      tenantId: TENANT,
      sessionId: 'prev',
      revision: 1,
      updatedAt: 1_700_000_000_000,
      snapshot: makeSnapshot(),
    });

    advance(30 * DAY_MS);

    const handle = session.openSession({
      sessionId: 'next',
      tenantId: TENANT,
      visitorId: 'v1',
      resumeFromSessionId: 'prev',
    });
    const first = await session.turn(handle.handleId, { userText: NEUTRAL_TEXT });
    // 本场第二轮: 又过了 10 天 —— 但状态是本场自己的, 不该再衰减一次.
    advance(10 * DAY_MS);
    const second = await session.turn(handle.handleId, { userText: NEUTRAL_TEXT });

    expect(second.snapshot.trust).toBeCloseTo(first.snapshot.trust, 10);
    expect(second.snapshot.resistance.verbal).toBeCloseTo(first.snapshot.resistance.verbal, 10);
  });

  it('无 resume 的会话行为逐字不变 (新会话走初始基线, 不衰减)', async () => {
    const { session } = createHarness();

    const handle = session.openSession({ sessionId: 'fresh', tenantId: TENANT, visitorId: 'v1' });
    const out = await session.turn(handle.handleId, { userText: NEUTRAL_TEXT });

    expect(out.snapshot.trust).toBeCloseTo(0.3, 5);
    expect(out.snapshot.resistance).toEqual({ verbal: 0.4, depth: 0.4, style: 0.35 });
  });

  it('接续来源不存在时降级为全新会话 (不抛错, 也不衰减)', async () => {
    const { session } = createHarness();

    const handle = session.openSession({
      sessionId: 'next',
      tenantId: TENANT,
      visitorId: 'v1',
      resumeFromSessionId: 'not-exist',
    });
    const out = await session.turn(handle.handleId, { userText: NEUTRAL_TEXT });

    expect(out.turnIndex).toBe(1);
    expect(out.snapshot.trust).toBeCloseTo(0.3, 5);
  });

  it('零间隔的接续 = 原样搬 (旧行为逐字保留)', async () => {
    const { bdiStates, session } = createHarness();

    await bdiStates.save({
      tenantId: TENANT,
      sessionId: 'prev',
      revision: 1,
      updatedAt: 1_700_000_000_000,
      snapshot: makeSnapshot(),
    });

    const handle = session.openSession({
      sessionId: 'next',
      tenantId: TENANT,
      visitorId: 'v1',
      resumeFromSessionId: 'prev',
    });
    const out = await session.turn(handle.handleId, { userText: NEUTRAL_TEXT });

    expect(out.snapshot.trust).toBeCloseTo(0.8, 10);
    expect(out.snapshot.emotion.valence).toBeCloseTo(-0.8, 10);
    expect(out.snapshot.resistance.verbal).toBeCloseTo(0.7, 10);
  });
});
