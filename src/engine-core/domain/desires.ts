// V2026-10-28 WP1 (引擎内核 · 愿望层):
//   职责: 定义愿望层两类愿望的**形状** —— 底层愿望 + 情境愿望.
//   边界: 纯 TS, 零 @nestjs/* / typeorm. 只定义形状与**纯演化函数**;
//         本模块不知道会话、渲染、数据库.
//
//   两层分工 (对齐 roadmap WP1 愿望层):
//     - UnderlyingDesire 底层愿望: 稳定 (被理解 / 被接纳 / 回避痛苦 / 掌控感), 带基线权重;
//     - SituationalDesire 情境愿望: 本轮具体诉求, 带优先级; 由本轮事件与关系状态生成.
//
//   AF-349 (2026-11-23):
//     旧实现只有形状, `currentWeight` 装配后不动、情境愿望永远为空.
//     本单补 `evolveDesires` 纯函数: 按事件 / 阻抗 / 安全感 / 纽带缓慢更新底层愿望,
//     并从同一信号生成本轮情境愿望. **缺省 enabled=false** —— 不开启时逐字返回入参,
//     既有状态轨迹不变; 开启与否是批次决策, 不是本单偷偷改生产.

import { clamp01 } from './emotion.js';
import type { CounselorEventKind } from './events/session-event.js';

/** 底层愿望: 稳定, 随信念缓慢变化. */
export interface UnderlyingDesire {
  /** 愿望键: understood / accepted / avoid_pain / control 等. */
  readonly key: string;
  /** 展示标签. */
  readonly label: string;
  /** 基线权重 [0,1] (开场初始值). */
  readonly baselineWeight: number;
  /** 当前权重 [0,1], 初始 = baselineWeight. */
  readonly currentWeight: number;
}

/** 情境愿望: 本轮具体诉求, 带优先级. */
export interface SituationalDesire {
  readonly id: string;
  readonly text: string;
  /** 优先级 [0,1]. */
  readonly priority: number;
  readonly active: boolean;
  /** 生成轮次 (可选; 旧快照没有该字段, 按 0 处理). */
  readonly createdAtTurn?: number;
  /** 失效轮次 (可选; 到期后 active=false, 不删除历史). */
  readonly expiresAtTurn?: number;
}

/** 无角色 profile 时的中性底层愿望种子 (工程默认, 非临床标定). */
export const DEFAULT_UNDERLYING_DESIRES: readonly UnderlyingDesire[] = [
  { key: 'understood', label: '被理解', baselineWeight: 0.6, currentWeight: 0.6 },
  { key: 'accepted', label: '被接纳', baselineWeight: 0.55, currentWeight: 0.55 },
  { key: 'avoid_pain', label: '回避痛苦', baselineWeight: 0.5, currentWeight: 0.5 },
  { key: 'control', label: '掌控感', baselineWeight: 0.45, currentWeight: 0.45 },
];

/**
 * 愿望演化配置.
 *
 * ⚠️ 数值是**工程种子**, 不是临床标定: `maxUnderlyingDeltaPerTurn=0.02`
 *   只保证「一輪最多动 2 个百分点」, 真实斜率留临床标定批次.
 */
export interface DesireEvolutionConfig {
  /** 总开关; false = 返回入参引用 (零行为变化). */
  readonly enabled: boolean;
  /** 单轮单个底层愿望最大变化量 [0,1]. */
  readonly maxUnderlyingDeltaPerTurn: number;
  /** 每轮回拉基线的比例 [0,1] (防止长期单向漂移). */
  readonly baselinePullPerTurn: number;
  /** 情境愿望存活轮数. */
  readonly situationalTtlTurns: number;
  /** 情境愿望激活阈值 [0,1]. */
  readonly situationalPriorityFloor: number;
}

/** 缺省: 关闭 + 保守参数. */
export const DEFAULT_DESIRE_EVOLUTION_CONFIG: DesireEvolutionConfig = {
  enabled: false,
  maxUnderlyingDeltaPerTurn: 0.02,
  baselinePullPerTurn: 0.01,
  situationalTtlTurns: 3,
  situationalPriorityFloor: 0.4,
};

/** 愿望演化入参. */
export interface DesireEvolutionInput {
  readonly underlyingDesires: readonly UnderlyingDesire[];
  readonly situationalDesires: readonly SituationalDesire[];
  readonly eventKinds: readonly CounselorEventKind[];
  readonly resistance: { readonly verbal: number; readonly depth: number; readonly style: number };
  readonly safety: number;
  readonly bond: number;
  /** 当前轮次 (1-based). */
  readonly turnNumber: number;
}

/** 愿望演化结果. */
export interface DesireEvolutionResult {
  readonly underlyingDesires: readonly UnderlyingDesire[];
  readonly situationalDesires: readonly SituationalDesire[];
  readonly changed: boolean;
}

/** 每类事件对四个底层愿望的信号强度 (工程权重, 非临床). */
const EVENT_DESIRE_SIGNALS: Readonly<Record<string, Partial<Record<string, number>>>> = {
  empathy: { understood: 1, accepted: 0.6 },
  acceptance: { accepted: 1, understood: 0.6 },
  normalization: { understood: 0.4, accepted: 0.3 },
  affirmation: { accepted: 0.4, control: 0.5 },
  open_probe: { control: -0.3 },
  judgment: { understood: -1, accepted: -1, avoid_pain: 0.5 },
  preaching: { understood: -0.6, accepted: -0.4, avoid_pain: 0.4 },
  minimizing: { understood: -0.8, accepted: -0.6, avoid_pain: 0.5 },
  boundary_cross: { accepted: -0.8, avoid_pain: 0.6 },
  sensitive_touch: { avoid_pain: 0.6 },
};

/**
 * 按本轮事件与关系状态缓慢更新愿望层.
 *
 * 纯函数 + 值语义: 返回新数组, 不修改入参. `enabled=false` 时原样返回入参引用.
 */
export function evolveDesires(
  input: DesireEvolutionInput,
  config: DesireEvolutionConfig = DEFAULT_DESIRE_EVOLUTION_CONFIG,
): DesireEvolutionResult {
  if (!config.enabled) {
    return {
      underlyingDesires: input.underlyingDesires,
      situationalDesires: input.situationalDesires,
      changed: false,
    };
  }

  const maxDelta = clamp01(config.maxUnderlyingDeltaPerTurn);
  const pull = clamp01(config.baselinePullPerTurn);
  const signals = collectSignals(input);
  const underlying = input.underlyingDesires.map((desire) => {
    const signal = signals[desire.key] ?? 0;
    const pullToBaseline = (desire.baselineWeight - desire.currentWeight) * pull;
    const rawDelta = clampSigned(signal * maxDelta + pullToBaseline, maxDelta);
    return { ...desire, currentWeight: clamp01(desire.currentWeight + rawDelta) };
  });

  const situational = nextSituationalDesires(input, signals, config);
  // AF-354: `changed` 必须反映**真实差异** —— 旧实现恒 true，让调用方无法据此
  //   跳过无变化的写回/落库，也使"机制是否真的动了状态"不可观测。
  //   enabled=true 但本轮无信号、无 TTL 到期、无基线漂移时，返回入参引用并标 false.
  const underlyingChanged = !listsEqual(underlying, input.underlyingDesires, desireEqual);
  const situationalChanged = !listsEqual(situational, input.situationalDesires, situationalEqual);
  if (!underlyingChanged && !situationalChanged) {
    return {
      underlyingDesires: input.underlyingDesires,
      situationalDesires: input.situationalDesires,
      changed: false,
    };
  }
  return { underlyingDesires: underlying, situationalDesires: situational, changed: true };
}

/** 同索引逐项比较两个只读列表. */
function listsEqual<T>(left: readonly T[], right: readonly T[], equal: (a: T, b: T) => boolean): boolean {
  if (left.length !== right.length) return false;
  return left.every((item, index) => equal(item, right[index]));
}

/** 底层愿望比较: 键 / 标签 / 基线 / 当前权重任一变化即视为变化. */
function desireEqual(left: UnderlyingDesire, right: UnderlyingDesire): boolean {
  return (
    left.key === right.key &&
    left.label === right.label &&
    left.baselineWeight === right.baselineWeight &&
    left.currentWeight === right.currentWeight
  );
}

/** 情境愿望比较: 全部业务字段. */
function situationalEqual(left: SituationalDesire, right: SituationalDesire): boolean {
  return (
    left.id === right.id &&
    left.text === right.text &&
    left.priority === right.priority &&
    left.active === right.active &&
    left.createdAtTurn === right.createdAtTurn &&
    left.expiresAtTurn === right.expiresAtTurn
  );
}

/** 汇总信号: 事件权重 + 阻抗 / 安全感 / 纽带修正. */
function collectSignals(input: DesireEvolutionInput): Record<string, number> {
  const signals: Record<string, number> = { understood: 0, accepted: 0, avoid_pain: 0, control: 0 };
  for (const kind of input.eventKinds) {
    const contribution = EVENT_DESIRE_SIGNALS[kind];
    if (!contribution) continue;
    for (const [key, value] of Object.entries(contribution)) {
      signals[key] = (signals[key] ?? 0) + (value ?? 0);
    }
  }

  const resistance = clamp01((input.resistance.verbal + input.resistance.depth + input.resistance.style) / 3);
  const safetyGap = clamp01(1 - input.safety);
  const bondGap = clamp01(1 - input.bond);

  // 阻抗 / 低安全 / 低纽带 → 回避痛苦诉求上升, 掌控感下降.
  signals['avoid_pain'] += resistance * 0.8 + safetyGap * 0.6 + bondGap * 0.3;
  signals['control'] -= resistance * 0.4 + safetyGap * 0.3;
  // 高安全 + 高纽带 → 被理解 / 被接纳诉求更容易被满足 (信号正向).
  signals['understood'] += input.safety * 0.2 + input.bond * 0.2;
  signals['accepted'] += input.bond * 0.2;
  return signals;
}

/** 生成 / 更新 / 到期情境愿望. */
function nextSituationalDesires(
  input: DesireEvolutionInput,
  signals: Record<string, number>,
  config: DesireEvolutionConfig,
): readonly SituationalDesire[] {
  const ttl = Math.max(1, config.situationalTtlTurns);
  const floor = clamp01(config.situationalPriorityFloor);
  const existing = new Map(input.situationalDesires.map((desire) => [desire.id, desire]));

  for (const desire of existing.values()) {
    if (desire.active && desire.expiresAtTurn !== undefined && input.turnNumber > desire.expiresAtTurn) {
      existing.set(desire.id, { ...desire, active: false });
    }
  }

  const labels: Readonly<Record<string, string>> = {
    understood: '被理解',
    accepted: '被接纳',
    avoid_pain: '回避痛苦',
    control: '掌控感',
  };
  for (const [key, signal] of Object.entries(signals)) {
    if (signal < floor) continue;
    const id = `situational:${key}`;
    const priority = clamp01(0.5 + signal * 0.1);
    const prior = existing.get(id);
    existing.set(id, {
      id,
      text: labels[key] ?? key,
      priority: prior ? Math.max(prior.priority, priority) : priority,
      active: true,
      createdAtTurn: prior?.createdAtTurn ?? input.turnNumber,
      expiresAtTurn: input.turnNumber + ttl,
    });
  }

  return [...existing.values()].toSorted((a, b) => b.priority - a.priority);
}

function clampSigned(value: number, bound: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-bound, Math.min(bound, value));
}
