// V2026-10-28 WP1 (引擎内核 · 状态迁移算子):
//   职责: 标准事件 → 信任 / 三维阻抗 / 情绪 / 移情的确定性增减, 统一 clamp.
//   边界: 纯函数, 无状态, 无随机, 可复现. 输入旧快照 + 事件列表, 输出新快照
//         (值语义, 整体替换, 不就地改).
//
//   架构原则: 阻抗 / 情绪是来访内部防御状态, 由**咨询师事件**推动升降, 作为 WP5
//   渲染参数; 绝不从来访自己的输出反推 (来访输出是 WP5 渲染结果, 反推 = 循环论证).
//
//   delta 表是工程种子值 (非临床标定), 集中在此便于后期调参 / 换模型轨.
//
// V2026-11-03 WP15 (引擎内核 · 单回合非对称 delta cap):
//   加一条领域不变量: "一回合内 BDI 不该跳太多" —— 与 clamp01 同类, 属状态迁移的
//   内在约束, 不是可插拔策略.
//   cap 是**速率限制** (derivative limit), clamp 是**绝对值兜底**: 两道防线都要留.
//     clamp 防越界 (值必须落在 [0,1]); cap 防跳变 (一回合最多允许动多少).
//   非对称的依据是损失厌恶: trust / valence 涨慢跌快 (信任建得慢、破得快);
//   arousal 与阻抗三维对称; 移情三维涨得慢 (±0.15).
//
//   为什么内核读 env (本文件唯一一处外部依赖):
//     M3 内测要按真实对话调 cap 参数, 改代码重发版太慢. 代价是内核不再"完全可复现"
//     —— 但 env 只影响 cap 参数, 不影响迁移逻辑: 同 env + 同输入仍逐字同输出.
//     键名派生自维度名: ENGINE_CAP_<DIM>_UP / ENGINE_CAP_<DIM>_DOWN (如
//     ENGINE_CAP_TRUST_UP=0.20 / ENGINE_CAP_TRUST_DOWN=-0.30).
//
//   为什么 cap 报告走"观察者回调"而不是出参字段:
//     本单限定内核只改 state-transition.ts 这一个文件, 而内核 → adapter 现成的通道
//     只有内核出参 DTO (另一个文件). 观察者回调让内核**只报告、不 import logger**
//     —— 打不打日志由 adapter 决定 (任务单 §1.4). 单槽 + 同步调用 = 报告与触发它
//     的那一轮严格对应 (不留存, 不跨轮串台).

import type { BdiSnapshot } from '../domain/bdi-snapshot.js';
import { clamp01, clampValence, resolveEmotionLabel } from '../domain/emotion.js';
import type { CounselorEventKind, SessionEvent } from '../domain/events/session-event.js';

/**
 * delta 向量的 9 个维度 (WP15: cap 维度与 delta 维度一一对应).
 *
 * 单独列一份而不是直接用 DeltaVector 的键: cap 需要**顺序** (报告按维度顺序出),
 * 而接口的键顺序没有语义. 两边多一个少一个, capTurnDelta 的类型检查会当场报错.
 */
const CAP_DIMS = ['trust', 'valence', 'arousal', 'verbal', 'depth', 'style', 'positive', 'negative', 'dependency'] as const;

/** cap 维度名. */
type CapDim = (typeof CAP_DIMS)[number];

/** 单事件对各维度的增量. */
export interface DeltaVector {
  readonly trust: number;
  readonly verbal: number;
  readonly depth: number;
  readonly style: number;
  readonly valence: number;
  readonly arousal: number;
  readonly positive: number;
  readonly negative: number;
  readonly dependency: number;
}

const ZERO: DeltaVector = {
  trust: 0,
  verbal: 0,
  depth: 0,
  style: 0,
  valence: 0,
  arousal: 0,
  positive: 0,
  negative: 0,
  dependency: 0,
};

/**
 * 初始 delta 表 (任务单 §6.1 种子值).
 * 正值 = 提升该维度; 负值 = 下降. 叠加后统一 clamp, 不逐事件 clamp.
 *
 * WP15: 每个事件上方加一行**幅度声明** —— 新增算子时对照单回合 cap 看一眼:
 *   某维度单事件 |delta| 超过该维度单回合 cap 的 80% → 注释里标 ⚠️ 接近 cap.
 *   (现有 11 个算子里最高比值是 75%: boundary_cross.style / sensitive_touch.arousal,
 *    都还没到 80% 警戒线, 所以没有 ⚠️ 标记.)
 */
const DELTA_TABLE: Readonly<Record<CounselorEventKind, DeltaVector>> = {
  empathy: {
    // 正向修复算子: trust +0.10 (单事件已达上向 cap 的 50%)
    trust: 0.1,
    verbal: -0.08,
    depth: -0.1,
    style: -0.06,
    valence: 0.1,
    arousal: -0.05,
    positive: 0.03,
    negative: 0,
    dependency: 0,
  },
  acceptance: {
    // 接纳算子: trust +0.08 (单事件达上向 cap 的 40%)
    trust: 0.08,
    verbal: -0.06,
    depth: -0.08,
    style: -0.05,
    valence: 0.08,
    arousal: -0.04,
    positive: 0.02,
    negative: 0,
    dependency: 0,
  },
  normalization: {
    // 正常化算子: trust +0.07 (单事件达上向 cap 的 35%)
    trust: 0.07,
    verbal: -0.05,
    depth: -0.07,
    style: -0.04,
    valence: 0.07,
    arousal: 0,
    positive: 0.01,
    negative: 0,
    dependency: 0,
  },
  open_probe: {
    // 开放探问算子: trust +0.05 (单事件达上向 cap 的 25%)
    trust: 0.05,
    verbal: -0.03,
    depth: -0.06,
    style: -0.03,
    valence: 0.04,
    arousal: 0.02,
    positive: 0,
    negative: 0,
    dependency: 0,
  },
  affirmation: {
    // 肯定算子: trust +0.08 (单事件达上向 cap 的 40%)
    trust: 0.08,
    verbal: -0.04,
    depth: -0.06,
    style: -0.04,
    valence: 0.1,
    arousal: -0.03,
    positive: 0.04,
    negative: 0,
    dependency: 0.02,
  },
  judgment: {
    // 评判算子: trust -0.12 (单事件达下向 cap 的 40%)
    trust: -0.12,
    verbal: 0.06,
    depth: 0.08,
    style: 0.12,
    valence: -0.12,
    arousal: 0.06,
    positive: 0,
    negative: 0.05,
    dependency: 0,
  },
  preaching: {
    // 说教算子: trust -0.10 (单事件达下向 cap 的 33%)
    trust: -0.1,
    verbal: 0.08,
    depth: 0.06,
    style: 0.06,
    valence: -0.08,
    arousal: 0.03,
    positive: 0,
    negative: 0.03,
    dependency: 0,
  },
  minimizing: {
    // 淡化算子: trust -0.10 (单事件达下向 cap 的 33%)
    trust: -0.1,
    verbal: 0.05,
    depth: 0.1,
    style: 0.05,
    valence: -0.12,
    arousal: 0.04,
    positive: 0,
    negative: 0.04,
    dependency: 0,
  },
  boundary_cross: {
    // 重大损害算子: trust -0.15 (单事件已达下向 cap 的 50%; 最接近的一维是 style +0.15 = 上向 cap 的 75%)
    trust: -0.15,
    verbal: 0.04,
    depth: 0.05,
    style: 0.15,
    valence: -0.15,
    arousal: 0.08,
    positive: 0,
    negative: 0.1,
    dependency: 0,
  },
  sensitive_touch: {
    // 敏感议题触碰算子: trust 0 (只动唤醒 arousal +0.15 = 上向 cap 的 75%, 不动信任)
    trust: 0,
    verbal: 0.05,
    depth: 0.05,
    style: 0.06,
    valence: -0.05,
    arousal: 0.15,
    positive: 0,
    negative: 0.04,
    dependency: 0,
  },
  // 中性算子: 零 delta (不推进任何维度)
  neutral: ZERO,
};

/** 把多事件 delta 乘强度后聚合 (内部可变累加, 返回只读向量). */
function aggregate(events: readonly SessionEvent[]): DeltaVector {
  const sum = {
    trust: 0,
    verbal: 0,
    depth: 0,
    style: 0,
    valence: 0,
    arousal: 0,
    positive: 0,
    negative: 0,
    dependency: 0,
  };
  for (const event of events) {
    const delta = DELTA_TABLE[event.kind] ?? ZERO;
    const strength = clamp01(event.strength);
    sum.trust += delta.trust * strength;
    sum.verbal += delta.verbal * strength;
    sum.depth += delta.depth * strength;
    sum.style += delta.style * strength;
    sum.valence += delta.valence * strength;
    sum.arousal += delta.arousal * strength;
    sum.positive += delta.positive * strength;
    sum.negative += delta.negative * strength;
    sum.dependency += delta.dependency * strength;
  }
  return sum;
}

/**
 * 单回合 cap 默认值 (任务单 §1.1 种子值).
 *
 * 三档:
 *   - trust / valence: 上 +0.20 / 下 -0.30 —— 损失厌恶 (信任建得慢、破得快);
 *   - arousal + 阻抗三维: ±0.20 —— 激活度对称, 涨多少就跌多少;
 *   - 移情三维: ±0.15 —— 移情涨得慢, 一回合不该就建立强烈移情.
 */
function defaultCap(dim: CapDim): { readonly up: number; readonly down: number } {
  if (dim === 'trust' || dim === 'valence') return { up: 0.2, down: -0.3 };
  if (dim === 'arousal' || dim === 'verbal' || dim === 'depth' || dim === 'style') return { up: 0.2, down: -0.2 };
  return { up: 0.15, down: -0.15 };
}

/**
 * 读 env 里的 cap 值 (WP15 §1.1: 后期调参不用改代码).
 *
 * 键名派生自维度名: ENGINE_CAP_<DIM>_UP / ENGINE_CAP_<DIM>_DOWN
 *   (如 ENGINE_CAP_TRUST_UP=0.20 / ENGINE_CAP_TRUST_DOWN=-0.30).
 *
 * 非法值 (未设 / 空串 / 非数字 / 符号与方向不符) 一律回退默认:
 *   配错一个 env 不该让整场对练的 BDI 迁移失真 —— 回退到种子值, 行为仍然确定.
 */
function readCap(dim: CapDim, direction: 'UP' | 'DOWN', fallback: number): number {
  const raw = process.env[`ENGINE_CAP_${dim.toUpperCase()}_${direction}`];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  if (direction === 'UP' && value < 0) return fallback;
  if (direction === 'DOWN' && value > 0) return fallback;
  return value;
}

/**
 * 单向 cap: 正 delta 砍到上向, 负 delta 砍到下向.
 *
 * 砍的是 **delta**, 不是绝对值 —— clamp 是防越界的最后一道防线, 两者不能互相替代:
 *   clamp 管"结果不能超出 [0,1]"; cap 管"一回合最多能动多少".
 */
function capAsym(value: number, up: number, down: number): number {
  if (value > up) return up;
  if (value < down) return down;
  return value;
}

/**
 * 单回合 delta cap (WP15 §1.1): 对**本轮总 delta** 逐维度砍幅.
 *
 * 为什么要砍: 一回合叠 5 个正事件, trust 直接跳 +0.4 —— 心理上不真实
 * ("用户说了句话, 信任就翻倍"). cap 把单回合的变化量限在可接受区间.
 *
 * cap 常量从 env 读 (readCap), 非法值回退默认 (defaultCap).
 */
export function capTurnDelta(raw: DeltaVector): DeltaVector {
  const capped: Record<CapDim, number> = { ...raw };
  for (const dim of CAP_DIMS) {
    const fallback = defaultCap(dim);
    capped[dim] = capAsym(raw[dim], readCap(dim, 'UP', fallback.up), readCap(dim, 'DOWN', fallback.down));
  }
  return capped;
}

/** 单维度被砍的明细 (WP15). */
export interface DeltaCapEntry {
  /** 维度名 (trust / valence / arousal / verbal / depth / style / positive / negative / dependency). */
  readonly dimension: string;
  /** 砍之前的原始 delta. */
  readonly raw: number;
  /** 砍之后实际生效的 delta. */
  readonly capped: number;
}

/** 本轮 cap 报告 (内核只报告, 由 adapter 决定打不打日志). */
export interface TurnDeltaCapReport {
  /** 被砍的维度明细 (逐维度一条). */
  readonly entries: readonly DeltaCapEntry[];
  /** 本轮事件类型 (去重, 按出现顺序). */
  readonly events: readonly string[];
}

/**
 * cap 观察者 (WP15 §1.4).
 *
 * 内核不 import logger —— "打不打日志"由 adapter 决定.
 */
export type DeltaCapObserver = (report: TurnDeltaCapReport) => void;

/**
 * 当前注册的 cap 观察者 (模块级单槽).
 *
 * 为什么是模块级: 本单限定内核只改 state-transition.ts 这一个文件, 而内核 → adapter
 * 现成的通道只有内核出参 DTO (另一个文件, 改了就是改已发布契约). 单槽 + **同步调用**
 * 保证报告与触发它的那一轮严格对应: 不留存, 不跨轮串台.
 */
let capObserver: DeltaCapObserver | null = null;

/** 注册 cap 观察者 (adapter 层调用; 传 null 注销). */
export function observeDeltaCaps(observer: DeltaCapObserver | null): void {
  capObserver = observer;
}

/**
 * 造本轮 cap 报告 (没有维度被砍 → null).
 *
 * 报告只带"被砍的维度": 观测面要的是"哪里出过问题", 不是"哪里没问题"
 * (同 WP4 安全报告的口径).
 */
function buildCapReport(raw: DeltaVector, capped: DeltaVector, events: readonly SessionEvent[]): TurnDeltaCapReport | null {
  const entries = CAP_DIMS.filter((dim) => raw[dim] !== capped[dim]).map((dim) => ({
    dimension: dim,
    raw: raw[dim],
    capped: capped[dim],
  }));
  if (entries.length === 0) return null;
  return { entries, events: [...new Set(events.map((event) => event.kind))] };
}

/**
 * 状态迁移: 旧快照 + 事件 → 新快照.
 * 信念层 / 愿望层规则轨不改写 (原样透传, 其演进入模型轨 / 后续);
 * 只推进信任 / 阻抗 / 情绪 / 移情.
 *
 * WP15: 本轮总 delta 先过**单回合 cap** 再落快照 (砍 delta, 不是 clamp 绝对值);
 * 被砍了就把报告交给观察者 (adapter 决定打不打日志).
 */
export function transitionState(snapshot: BdiSnapshot, events: readonly SessionEvent[]): BdiSnapshot {
  const raw = aggregate(events);
  const delta = capTurnDelta(raw);
  const report = buildCapReport(raw, delta, events);
  if (report && capObserver) capObserver(report);

  const valence = clampValence(snapshot.emotion.valence + delta.valence);
  const arousal = clamp01(snapshot.emotion.arousal + delta.arousal);

  return {
    coreBeliefs: snapshot.coreBeliefs,
    temporaryBeliefs: snapshot.temporaryBeliefs,
    memoryBeliefs: snapshot.memoryBeliefs,
    underlyingDesires: snapshot.underlyingDesires,
    situationalDesires: snapshot.situationalDesires,
    emotion: { label: resolveEmotionLabel(valence, arousal), valence, arousal },
    resistance: {
      verbal: clamp01(snapshot.resistance.verbal + delta.verbal),
      depth: clamp01(snapshot.resistance.depth + delta.depth),
      style: clamp01(snapshot.resistance.style + delta.style),
    },
    transference: {
      positive: clamp01(snapshot.transference.positive + delta.positive),
      negative: clamp01(snapshot.transference.negative + delta.negative),
      dependency: clamp01(snapshot.transference.dependency + delta.dependency),
    },
    trust: clamp01(snapshot.trust + delta.trust),
  };
}

/**
 * 状态迁移 (详细版): 新快照 + 本轮 cap 报告.
 *
 * 为什么另起一个出口, 而不是改 transitionState 的返回类型:
 *   transitionState 是内核会话端口既有调用点与既有测试的公共契约, 改返回形状 =
 *   改已发布契约 (同一条链路出现两种口径). 这里保持 transitionState 原样,
 *   另导出详细版供需要 cap 观测的调用方使用.
 */
export function transitionStateDetailed(
  snapshot: BdiSnapshot,
  events: readonly SessionEvent[],
): { readonly snapshot: BdiSnapshot; readonly capped: TurnDeltaCapReport | null } {
  const raw = aggregate(events);
  const delta = capTurnDelta(raw);
  // 快照组装复用 transitionState: 纯函数同参同值, 重复算一次聚合与 cap 的代价可忽略;
  // 抄第二份快照组装逻辑才是真风险 —— 两份必然漂移.
  return { snapshot: transitionState(snapshot, events), capped: buildCapReport(raw, delta, events) };
}
