// V2026-11-08 治本 (Phase2.5 WP-D · 自动对练 WS 事件契约):
//   职责: runner → gateway → 前端 的事件形状集中在这一份, 前后端按它对接.
//
//   反双胞胎:
//     - 事件名用字符串常量, 不散落 (改一个事件名只动这一处).
//     - payload 不含对话原文以外的内部结构 (trace 是透传, 前端原样渲染).

import type { InferenceFingerprint } from './inference-fingerprint.service.js';
import type { DebugTurnTrace } from '../admin-debug/debug-session.service.js';

/** WS 事件名 (前端 socket.on 用). */
export const AUTO_PRACTICE_EVENTS = {
  /** 一场对练开始. */
  sessionStart: 'ap:session_start',
  /** 一轮对话完成 (咨询师 + 来访者). */
  turn: 'ap:turn',
  /** 一场对练结束. */
  sessionEnd: 'ap:session_end',
  /** 一场对练出错. */
  error: 'ap:error',
} as const;

/** 一场对练开始的 payload. */
export interface AutoPracticeSessionStartPayload {
  readonly practiceSessionId: string;
  readonly debugSessionId: string;
  readonly characterSlug: string;
  readonly counselorModeId: string;
  readonly maxTurns: number;
  /** 推理环境指纹 (WP-B): 模型/版本/审议模式/场景类型. */
  readonly fingerprint: InferenceFingerprint;
}

/** 一轮对话的 payload. */
export interface AutoPracticeTurnPayload {
  readonly practiceSessionId: string;
  readonly turnIndex: number;
  readonly counselorText: string;
  readonly visitorText: string;
  readonly crisisDetected: boolean;
  readonly trace: DebugTurnTrace;
}

/** 一场对练结束的 payload. */
export interface AutoPracticeSessionEndPayload {
  readonly practiceSessionId: string;
  readonly status: string;
  readonly exitReason: string;
  readonly turnCount: number;
  readonly crisisEnded: boolean;
  /**
   * WP-J: 是否经历过后置危机练习窗.
   *
   * 与 `crisisEnded` 是两个维度: `crisisEnded` = 场次因危机**终止**;
   * `crisisPracticed` = 危机披露后**继续练过**应对. 两者可以同时为 false (没危机),
   * 也可以同时为 true (练完之后仍因升级终止).
   */
  readonly crisisPracticed?: boolean;
  /** WP-J: 危机窗内完成的练习轮数. */
  readonly crisisPostTurns?: number;
  /**
   * WP-J P1b: 危机首次披露的轮次 (未披露为 null).
   *
   * ⚠️ 新字段一律**可选** (optional): 老前端不解析新字段也不会炸
   *   (JSON 多字段不影响), 契约向后兼容.
   */
  readonly crisisFirstTurn?: number | null;
  /** WP-J P1b: 危机强度峰值档 0~3 (未披露为 0). */
  readonly crisisPeakLevel?: number;
  /** WP-J P1b: 危机类别 (内核枚举值, 非自由文本; 未披露为 null). */
  readonly crisisCategory?: string | null;
  /** WP-J P1b: 是否发生"强度上升"型二次升级. */
  readonly crisisEscalated?: boolean;
}
