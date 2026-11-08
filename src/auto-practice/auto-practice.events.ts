// V2026-11-08 治本 (Phase2.5 WP-D · 自动对练 WS 事件契约):
//   职责: runner → gateway → 前端 的事件形状集中在这一份, 前后端按它对接.
//
//   反双胞胎:
//     - 事件名用字符串常量, 不散落 (改一个事件名只动这一处).
//     - payload 不含对话原文以外的内部结构 (trace 是透传, 前端原样渲染).

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
}
