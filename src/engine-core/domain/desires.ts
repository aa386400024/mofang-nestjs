// V2026-10-28 WP1 (引擎内核 · 愿望层):
//   职责: 定义愿望层两类愿望的**形状** —— 底层愿望 + 情境愿望.
//   边界: 纯 TS, 零 @nestjs/* / typeorm. 只定义形状, 不写愿望权重如何随信念变化
//         (规则轨本期不做复杂愿望推理, 权重随角色基线装配, 迁移算子不改写).
//
//   两层分工 (对齐 roadmap WP1 愿望层):
//     - UnderlyingDesire 底层愿望: 稳定 (被理解 / 被接纳 / 回避痛苦 / 掌控感), 带基线权重;
//     - SituationalDesire 情境愿望: 本轮具体诉求, 带优先级; 规则轨本期由规划器留位, 不主动生成.

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

/** 情境愿望: 本轮具体诉求, 带优先级. 规则轨本期不主动推理, 保留类型供后续填充. */
export interface SituationalDesire {
  readonly id: string;
  readonly text: string;
  /** 优先级 [0,1]. */
  readonly priority: number;
  readonly active: boolean;
}

/** 无角色 profile 时的中性底层愿望种子 (工程默认, 非临床标定). */
export const DEFAULT_UNDERLYING_DESIRES: readonly UnderlyingDesire[] = [
  { key: 'understood', label: '被理解', baselineWeight: 0.6, currentWeight: 0.6 },
  { key: 'accepted', label: '被接纳', baselineWeight: 0.55, currentWeight: 0.55 },
  { key: 'avoid_pain', label: '回避痛苦', baselineWeight: 0.5, currentWeight: 0.5 },
  { key: 'control', label: '掌控感', baselineWeight: 0.45, currentWeight: 0.45 },
];
