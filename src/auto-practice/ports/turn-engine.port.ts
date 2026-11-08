// V2026-11-08 治本 (Phase2.5 WP-D · 对话引擎端口):
//   职责: 把"开一场调试会话 → 跑一轮 → 关会话"这条链路抽成**窄端口**,
//         PracticeRunnerService 只依赖这个端口, 不直接 import DebugSessionService.
//
//   为什么要有这个端口 (而不是直接 inject DebugSessionService):
//     ① **可测**: runner 单测里 mock 这个端口 (假造一个返回固定 reply 的引擎),
//       不用真起引擎 / 真调 LLM;
//     ② **未来换管道**: WP-B 做可复现性时, 可能要换成"带种子回放"的引擎入口,
//       runner 的循环逻辑零改动, 只换端口实现;
//     ③ **反双胞胎**: 不把 runner 和 admin-debug 的内存 Map / 文件落盘细节焊死.
//
//   反双胞胎:
//     - 不用 interface 当 Nest provider token: interface 编译后没有运行时值,
//       必须用 Symbol token (跟 CHARACTER_PROFILE_RESOLVER 同款).
//     - 端口只说"给我一轮输入, 我给你来访口语 + 危机标记", 不说"怎么落盘 / 怎么存内存".

import type { DebugTurnTrace } from '../../admin-debug/debug-session.service.js';

/**
 * 一轮对话的结果 (端口出口).
 *
 * 比 DebugSessionService 的返回瘦: runner 只需要 reply / turnIndex / crisis / trace,
 * 不需要整套 trace 组装细节 —— trace 原样透传给前端 WS 事件.
 */
export interface EngineTurnResult {
  /** 来访者这一轮说的话. */
  readonly reply: string;
  /** 本轮序号 (从 1 开始). */
  readonly turnIndex: number;
  /** 本轮是否触发危机. */
  readonly crisisDetected: boolean;
  /** 危机类别 (没有则 null). */
  readonly crisisCategory: string | null;
  /** 本轮完整调试 trace (透传给前端). */
  readonly trace: DebugTurnTrace;
}

/**
 * 对话引擎端口 (可替换数据源 / 可 mock).
 *
 * 实现: `DebugTurnEngineAdapter` 包装现有 `DebugSessionService` ——
 * 自动对练**不新写对话循环**, 完全复用新版引擎链路.
 */
export interface TurnEnginePort {
  /**
   * 开一场会话.
   *
   * @param characterSlug 来访者角色 slug
   * @returns 调试会话 id (后续 turn/close 用它)
   */
  open(characterSlug: string): Promise<{ readonly debugSessionId: string }>;

  /**
   * 跑一轮 (咨询师说一句话 → 来访者回一句话).
   *
   * @param debugSessionId 会话 id
   * @param counselorText 咨询师这一轮说的话
   */
  turn(debugSessionId: string, counselorText: string): Promise<EngineTurnResult>;

  /**
   * 关会话 (释放引擎句柄).
   *
   * @param debugSessionId 会话 id
   */
  close(debugSessionId: string): void;
}

/** 端口的依赖注入 token (Symbol, 跟 CHARACTER_PROFILE_RESOLVER 同款). */
export const TURN_ENGINE_PORT = Symbol('TURN_ENGINE_PORT');
