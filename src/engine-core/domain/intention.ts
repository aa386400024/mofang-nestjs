// V2026-10-28 WP1 (引擎内核 · 本轮意图):
//   职责: 定义"本轮行为目标" Intention —— 供 WP5 渲染消费的结构化目标.
//   边界: 纯 TS. Intention 是**每轮派生输出**, 不落 BdiSnapshot (快照存持久人格状态,
//         意图是本轮决策; 分离后快照可回放, 意图可观测). 内核不写一个字的口语.
//
//   五字段 (对齐 roadmap WP1 意图层): 行为策略 + 情绪 + 阻抗 + 移情 + 禁止行为.

import type { BdiResistance } from './bdi-snapshot';
import type { EmotionState } from './emotion';
import type { TransferenceState } from './transference';

/** 来访本轮行为策略 (借 PatientHub BEHAVIORS). */
export type BehaviorStrategy =
  | 'simple_response'
  | 'request'
  | 'recounting'
  | 'cognitive_exploration'
  | 'affective_exploration'
  | 'insight'
  | 'discussing_plans'
  | 'resistance';

/**
 * 本轮决策目标.
 *
 * 规则轨只从当前状态选一个主导策略; request / insight / discussing_plans 等
 * 需要来访侧信号的策略, 本期留类型不主动选出 (由模型轨 / 后续填充), 避免凭空判定.
 */
export interface Intention {
  readonly strategy: BehaviorStrategy;
  readonly emotion: EmotionState;
  readonly resistance: BdiResistance;
  readonly transference: TransferenceState;
  readonly forbiddenBehaviors: readonly string[];
  /** 决策理由, 仅用于日志 / 督导观测, 不渲染给来访. */
  readonly rationale?: string;
}
