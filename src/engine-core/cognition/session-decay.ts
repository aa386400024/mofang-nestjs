// V2026-11-03 WP36 (引擎内核 · 跨会话间隔自然衰减 · 纯函数):
//   职责: 按"距上一场结束的时间间隔"对 BDI 快照里的**状态性维度**做差异化半衰期回落,
//         供 resume (跨会话接续) 在搬上一场快照之后、本场第一轮之前调用.
//   边界: 纯 TS, 零 env / 零 IO / 零随机 / 零全局状态. 与 WP2 的 decayImportance 同款范式.
//
//   为什么要有这一层 (蓝图 §4.5 P1 级算子):
//     真实来访隔一周再回来, 情绪会自然平复, 阻抗会自然回落 —— 但**不会完全归零**
//     (关系不会因为一周不见就回到陌生人). 原实现把上一场的快照**原样搬过来**,
//     于是"隔了一周"与"刚走出门"在内核眼里毫无区别 —— 不真实.
//
//   为什么是"差异化半衰期"而不是统一半衰期:
//     情绪 / 阻抗 / 同盟三者的**衰减速率不同**, 这是三件事:
//       · 情绪最易平复 (7 天半衰期) —— 一觉醒来, 昨天的委屈还在, 但没那么尖锐了;
//       · 阻抗回落更慢 (14 天) —— 防御姿态是练出来的, 不是睡一觉就掉的;
//       · 同盟最持久 (30 天) —— 关系记忆是三者里最"粘"的一个.
//     统一半衰期会让"情绪已经平复但关系还很热络"这种真实状态无法表达.
//
//   为什么不衰减信念 / 欲望 / 移情:
//     coreBeliefs / temporaryBeliefs / memoryBeliefs / underlyingDesires /
//     situationalDesires / transference 是**稳定人格特质或认知结构** —— 它们不因为
//     "隔了几天没说话"而改变. 衰减它们等于让来访者一周不见就忘了自己的核心信念,
//     那是失忆, 不是自然回落.
//
//   ⚠️ 半衰期是**工程种子值, 非临床标定** —— 待真实对练校准.
//     形状是对的 (半衰期可解释: 半衰期处恰好减半), 值待数据说话.
//
//   反双胞胎:
//     - 不就地改传入的快照 —— 快照是**值语义** (见 domain/bdi-snapshot.ts 的说明),
//       状态演化一律"造新快照 + 整体替换"; 就地改会让人无法回放.
//     - 不在衰减里改"标签"而不改数值 (或反过来) —— emotion.label 由 valence/arousal
//       确定性推导 (resolveEmotionLabel), 数值动了标签必须跟着重算, 否则标签与数值
//       对不上 (渲染层按标签选词, 按数值选强度 —— 两边打架最难受).
//     - 不在这里读 env —— 半衰期是**部署形态**的决定, 走 SessionDecayConfig 端口注入
//       (与 WP26 的 DeltaCapConfig / WP34 的 PersonalityModulatorConfig 同一范式).
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-core/wp36-session-decay.spec.ts 覆盖: 零间隔不衰减 / 三组半衰期恰好减半 /
//        不衰减维度逐字不变 / 负间隔按 0 处理 / 非法端口值回退种子值 / 标签随数值重算

import { cloneBdiSnapshot, type BdiSnapshot } from '../domain/bdi-snapshot.js';
import { clamp01, clampValence, resolveEmotionLabel } from '../domain/emotion.js';

/** 一天 (ms). */
const DAY_MS = 24 * 3600 * 1000;

/**
 * 跨会话间隔衰减的**半衰期端口** (内核只认这个对象, 不认 env).
 *
 * 缺省 = `DEFAULT_SESSION_DECAY_CONFIG` (内核种子值), env 只做覆写.
 *
 * 三个半衰期互相独立: 它们描述三件不同的事的衰减速度, 不是一个"全局衰减率"的三种写法.
 */
export interface SessionDecayConfig {
  /** 情绪半衰期 (ms): 作用于 valence / arousal. 种子值 7 天. */
  readonly emotionHalfLifeMs: number;
  /** 阻抗半衰期 (ms): 作用于 verbal / depth / style. 种子值 14 天. */
  readonly resistanceHalfLifeMs: number;
  /** 同盟半衰期 (ms): 作用于 trust / safety / bond. 种子值 30 天. */
  readonly allianceHalfLifeMs: number;
}

/**
 * 内核种子值 (工程种子值, **非临床标定** —— 待真实对练校准).
 *
 * 数值来自任务单 §3.1 的表格 (7 / 14 / 30 天). 形状的理由:
 *   · 情绪 < 阻抗 < 同盟 —— 越"结构化"的东西衰减越慢;
 *   · 同盟 30 天与内核既有的记忆重要度半衰期 (`DEFAULT_DECAY_HALF_LIFE_MS` = 30 天)
 *     同量级 —— 长时记忆与关系记忆的持久性本该一致, 不该一个记一个月另一个记半年.
 */
export const DEFAULT_SESSION_DECAY_CONFIG: SessionDecayConfig = {
  emotionHalfLifeMs: 7 * DAY_MS,
  resistanceHalfLifeMs: 14 * DAY_MS,
  allianceHalfLifeMs: 30 * DAY_MS,
};

/**
 * 解析一个有效的半衰期 (非法 → 回退种子值).
 *
 * 为什么**回退**而不是抛错 (与 WP42 的门槛校验同一纪律):
 *   端口是**公开契约**, 任何人都能 new 一个配置塞进来. 一个 0 或负数的半衰期
 *   若直接生效, 会让 `2^(-age/0)` 变成 Infinity / NaN, 把整份快照污染成 NaN ——
 *   而调用方以为"配好了". 内核这层兜底保证**无论谁注入, 衰减都还是衰减**.
 */
function sanitizeHalfLife(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

/**
 * 解析本次衰减实际生效的半衰期端口 (逐项回退内核种子值).
 */
function resolveSessionDecayConfig(config: SessionDecayConfig | undefined): SessionDecayConfig {
  const seed = DEFAULT_SESSION_DECAY_CONFIG;
  if (!config) return seed;
  return {
    emotionHalfLifeMs: sanitizeHalfLife(config.emotionHalfLifeMs, seed.emotionHalfLifeMs),
    resistanceHalfLifeMs: sanitizeHalfLife(config.resistanceHalfLifeMs, seed.resistanceHalfLifeMs),
    allianceHalfLifeMs: sanitizeHalfLife(config.allianceHalfLifeMs, seed.allianceHalfLifeMs),
  };
}

/**
 * 衰减因子: `2^(-ageMs / halfLifeMs)`.
 *
 * 性质:
 *   - age = 0 → 1 (不衰减);
 *   - age = halfLife → 0.5 (恰好减半);
 *   - age 越大因子越小 (单调不增), 但恒 > 0 —— **不会衰减到 0**,
 *     所以"关系不会因为一周不见就回到陌生人"在数值上成立.
 */
function decayFactor(ageMs: number, halfLifeMs: number): number {
  return Math.pow(2, -ageMs / halfLifeMs);
}

/**
 * 跨会话间隔自然衰减 (WP36).
 *
 * 只动三类**状态性维度**:
 *   · 情绪: `emotion.valence` / `emotion.arousal` (标签随之重算);
 *   · 阻抗: `resistance.verbal` / `resistance.depth` / `resistance.style`;
 *   · 同盟: `trust` / `safety` / `bond`.
 *
 * 其余维度 (核心信念 / 短期信念 / 记忆信念 / 底层欲望 / 情境愿望 / 移情三态)
 * **逐字不动** —— 它们是稳定人格特质或认知结构, 不因间隔时间回落.
 *
 * @param snapshot 上一场结束时的快照 (不会被修改)
 * @param ageMs 距上一场结束的时间间隔 (ms); 负数按 0 处理 (时钟偏移 / 未来时间戳)
 * @param config 半衰期端口 (缺省 = 内核种子值; 非法值逐项回退种子值)
 * @returns 衰减后的**新**快照 (值语义: 原始快照不受影响)
 */
export function applySessionDecay(snapshot: BdiSnapshot, ageMs: number, config?: SessionDecayConfig): BdiSnapshot {
  const age = Math.max(0, ageMs);
  const halfLives = resolveSessionDecayConfig(config);

  const emotionFactor = decayFactor(age, halfLives.emotionHalfLifeMs);
  const resistanceFactor = decayFactor(age, halfLives.resistanceHalfLifeMs);
  const allianceFactor = decayFactor(age, halfLives.allianceHalfLifeMs);

  // 克隆后再改 —— 快照是值语义, 不许就地改传入对象.
  const base = cloneBdiSnapshot(snapshot);

  const valence = clampValence(base.emotion.valence * emotionFactor);
  const arousal = clamp01(base.emotion.arousal * emotionFactor);

  return {
    ...base,
    emotion: {
      // 标签由数值确定性推导 (见 domain/emotion.ts): 数值动了, 标签必须跟着重算.
      label: resolveEmotionLabel(valence, arousal),
      valence,
      arousal,
    },
    resistance: {
      verbal: clamp01(base.resistance.verbal * resistanceFactor),
      depth: clamp01(base.resistance.depth * resistanceFactor),
      style: clamp01(base.resistance.style * resistanceFactor),
    },
    trust: clamp01(base.trust * allianceFactor),
    safety: clamp01(base.safety * allianceFactor),
    bond: clamp01(base.bond * allianceFactor),
  };
}
