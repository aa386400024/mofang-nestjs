// V2026-10-28 WP1 (引擎内核 · 本轮意图):
//   职责: 定义"本轮行为目标" Intention —— 供 WP5 渲染消费的结构化目标.
//   边界: 纯 TS. Intention 是**每轮派生输出**, 不落 BdiSnapshot (快照存持久人格状态,
//         意图是本轮决策; 分离后快照可回放, 意图可观测). 内核不写一个字的口语.
//
//   五字段 (对齐 roadmap WP1 意图层): 行为策略 + 情绪 + 阻抗 + 移情 + 禁止行为.

import type { BdiResistance } from './bdi-snapshot.js';
import type { EmotionState } from './emotion.js';
import type { TransferenceState } from './transference.js';

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

/** 意图锁来源: 连续性 / 保护性 / 情境诉求. */
export type IntentionLockReason = 'continuity' | 'protective' | 'situational';

/**
 * 跨轮意图锁 (AF-349).
 *
 * 只锁**非保护性**策略: 抗拒 / 简短回应 / 请求由当轮风险与情境决定,
 * 不能被上一轮的锁覆盖 —— 否则危机会被"继续探索"锁死.
 */
export interface IntentionLock {
  readonly strategy: BehaviorStrategy;
  readonly lockedAtTurn: number;
  readonly expiresAtTurn?: number;
  readonly reason: IntentionLockReason;
}

/**
 * 本轮决策目标.
 *
 * 规则轨从当前状态选一个主导策略; request / insight / discussing_plans
 * 在 AF-315 之后已可由情境愿望 / 依赖移情 / 反思信念选出.
 * 跨轮连续性由 `IntentionLock` 控制, 缺省不锁.
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
