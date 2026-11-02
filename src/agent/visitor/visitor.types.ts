// V2026-10-09 治本 (Visitor 子模块类型 — SPEC §11.1):
//   范围: per-session 来访者记忆 (history + emotion state), 单轮请求选项
//   不包含: LlmStream 类型 (复用 ../llm/llm.types)
//
//   反双胞胎:
//     - 不用 class 包装 Message — interface + readonly 字段 + 工厂函数, 简单可序列化
//     - 不存"对话摘要"字段 — V0.x 不做异步总结, V1.x 由 Supervisor 任务生成
//     - emotion state 存 string 而非 enum — LLM 输出自由文本, enum 强约束反而绑死
//     - persona 直接存引用 (openSession 时 snapshot) — 防止 V1.x 库更新导致 prompt 漂移
//
//   如何验证:
//     1. pnpm build 无 type error
//     2. openSession 后 memory 落到 Map, persona 字段是 snapshot 引用
//     3. streamTurn 后 messages 增加 user + assistant 两条
//     4. closeSession 后 Map 清理, 同 sessionId 再 openSession 创建新对象

import type { LlmStream, LlmStreamChunk } from '../llm/llm.types';
import type { Persona } from '../persona/domain/entities/persona.entity';

/** 单条对话消息. */
export interface VisitorMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
  /** ms timestamp, 用于 V1.x 时序分析 (Supervisor §11.2). */
  readonly at: number;
}

/** per-session 来访者记忆. */
export interface VisitorSessionMemory {
  readonly sessionId: string;
  /**
   * 锁定 persona 实体引用 — openSession 时从仓储加载并 snapshot.
   * 后续 turns 直接复用, 防止 V1.x 库中途更新导致 prompt 漂移.
   * 如果需要重新加载, 关闭再 open 即可.
   */
  readonly persona: Persona;
  readonly tenantId: string;
  readonly createdAt: number;
  /** 滑动窗口内保留的消息, 超过 MAX_HISTORY_MESSAGES 自动丢最早. */
  messages: VisitorMessage[];
  /** 当前情绪状态字符串, V0.x 由 persona.emotionBaseline 初始化, LLM 输出不解析. */
  currentEmotion: string;
  /** 对话轮数 (1 轮 = 1 user + 1 assistant), 仅供 prompt 展示. */
  turnCount: number;
  /** 最后活动时间, 用于 idle 清理 (V1.x 接 Redis TTL). */
  lastActiveAt: number;
}

/** openSession 返回的 persona 快照, 给 VoiceService 缓存 (voiceId 给 TTS, difficulty 给日志). */
export interface VisitorPersonaSnapshot {
  readonly id: string;
  readonly name: string;
  readonly voiceId: string;
  readonly difficulty: string;
}

/** streamTurn 入参. */
export interface VisitorTurnOptions {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly userId: string;
  /** persona 已 resolve 后的 ID, 跟 memory.persona.id 一致 (冗余校验). */
  readonly personaId: string;
  /** 用户本轮文本 (ASR final). */
  readonly userText: string;
  /** 链路 trace, 透传给 LlmService. */
  readonly traceId?: string;
  /** AbortSignal — barge-in 时 abort(), fetch 真正中断 (V2026-10-09 治本: 修 Phase 3 dead AbortController). */
  readonly signal?: AbortSignal;
}

/** streamTurn 返回 — 包装后的流 (persona 已在 state 缓存, 不再返回). */
export interface VisitorTurnResult {
  /** LLM 流, 消费方 (VoiceService) 负责转发到 TTS + client. */
  readonly stream: LlmStream;
}

/** closeSession 返回值, 供 VoiceService 日志. */
export interface VisitorCloseResult {
  readonly hadMemory: boolean;
  readonly finalTurnCount: number;
  readonly finalMessageCount: number;
}

/** 内部类型 re-export, 方便消费方不用 import 两个文件. */
export type { LlmStream, LlmStreamChunk };
