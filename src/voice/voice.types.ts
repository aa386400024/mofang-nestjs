// V2026-10-08 治本 (Voice Gateway WS 协议类型 — SPEC §10.2):
//   客户端 → 服务端: user_text / user_speaking / session_finish
//   服务端 → 客户端: llm_start / llm_text / llm_done / tts_start / tts_done
//                   / tts_cancelled / audio (binary) / error / session_ended
//
//   反双胞胎:
//     - 不用 GraphQL subscription — 实时语音场景 REST/GraphQL 复杂, WS 一阶消息最简
//     - 不用 Socket.IO — 项目用 NestJS @WebSocketGateway + ws, 不引新依赖
//     - 不用 MsgPack / Protobuf — 文本 JSON + binary 音频够用, 调试简单

/** 客户端 → 服务端消息. */
export type VoiceClientMessage =
  | { readonly type: 'user_text'; readonly text: string; readonly generation?: number }
  | { readonly type: 'user_speaking' }
  | { readonly type: 'session_finish' };

/** 服务端 → 客户端消息 (JSON 帧, binary 帧是 PCM 音频). */
export type VoiceServerMessage =
  | { readonly type: 'llm_start' }
  | { readonly type: 'llm_text'; readonly text: string }
  | { readonly type: 'llm_done' }
  | { readonly type: 'tts_start' }
  | { readonly type: 'tts_done'; readonly usage: { readonly characters: number } }
  | { readonly type: 'tts_cancelled' }
  | { readonly type: 'error'; readonly error: VoiceError }
  | { readonly type: 'session_ended'; readonly reason: 'user_finish' | 'timeout' | 'error' };

/** 错误信息. */
export interface VoiceError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

/** session 状态. */
export type VoiceSessionStatus = 'idle' | 'processing' | 'cancelled' | 'ended';

/** session 元数据. */
export interface VoiceSessionMeta {
  readonly sessionId: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly traceId: string;
  /**
   * 来访者 persona ID — V0.x 从 query `?personaId=` 提取, 可选.
   * 缺失时 startSession 走 PersonaRepository.findDefault() 兜底.
   * V1.x 从 JWT 提取.
   */
  readonly personaId?: string;
}

/** 来访者 persona 快照 (VoiceService 缓存, 用于 TTS voiceId + 日志). */
export interface VoiceSessionPersona {
  readonly id: string;
  readonly name: string;
  readonly voiceId: string;
  readonly difficulty: string;
}

/** session 内部状态. */
export interface VoiceSessionState {
  readonly meta: VoiceSessionMeta;
  /**
   * 已 resolve 的 persona 快照 — startSession 阶段从 VisitorService.openSession 取,
   * 用于 TTS voiceId / 日志 persona 标签. 整个 session 期间不变.
   */
  persona: VoiceSessionPersona | null;
  status: VoiceSessionStatus;
  /** 每次新 user_text / user_speaking 递增, 老 pipeline 检查不匹配自己退出. */
  currentGeneration: number;
  /** 当前 TTS session 句柄 (来自 TtsService.startSession). */
  ttsHandle: import('./tts/tts.types').TtsSessionHandle | null;
  /** 当前 LLM 流的可控 AbortController, signal 透传给 LlmService (V2026-10-09 治本). */
  llmAbort: AbortController | null;
}
