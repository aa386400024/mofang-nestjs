// V2026-10-23 治本 (Voice Gateway WS 协议类型 — spec §2.2/§2.3):
//   变化 (相对 V2026-10-08 旧版):
//     ① 音频从"服务端 binary PCM 帧"改为"**句级完整 mp3** (base64, JSON 帧内)" ——
//        前端 just_audio 直接播完整句, web / native 双端最稳, 且前端不需要拼 mp3 帧
//     ② 新增 `sentence_start` / `tts_audio` / `sentence_end` 三帧, 让前端能按句
//        高亮字幕 + 排队播报
//     ③ `tts_cancelled` → 通用 `cancelled` (纯文字模式没有 TTS, 回 tts_cancelled 是语义误导)
//     ④ 删掉 `tts_start` (无信息量: 一句音频到达就说明 TTS 已经启动)
//   客户端 → 服务端消息不变 (user_text / user_speaking / session_finish).
//
//   反双胞胎:
//     - 不用 GraphQL subscription: 实时语音场景 REST/GraphQL 复杂, WS 一阶消息最简
//     - 不用 Socket.IO: 项目用 NestJS @WebSocketGateway + ws, 不引新依赖
//     - 不用 MsgPack / Protobuf: 纯 JSON 帧足够, 调试直接看文本

import type { VoiceSessionMode, VoiceSessionPreset, VoiceSkillCode } from './voice-session.types';

/** 客户端 → 服务端消息. */
export type VoiceClientMessage =
  | { readonly type: 'user_text'; readonly text: string; readonly generation?: number }
  | { readonly type: 'user_speaking' }
  | { readonly type: 'session_finish' };

/** 服务端 → 客户端消息 (全部 JSON 文本帧). */
export type VoiceServerMessage =
  /**
   * 就绪信号 — 鉴权 + 模板校验 + 演练登记 + startSession **全部成功**后才发 (spec §2.3 帧规则 0).
   *
   * 前端收到 `ready` 之前**不得**发 `user_text`: 连接已打开但会话可能尚未就绪,
   * 否则首条消息会撞上 "not initialized" (竞态).
   * 任一前置失败走 `error` + close, **不发** `ready`.
   */
  | { readonly type: 'ready' }
  /** 本轮回复开始. */
  | { readonly type: 'llm_start' }
  /** LLM 增量字幕 (可多次; 与音频并行到达, 互不阻塞). */
  | { readonly type: 'llm_text'; readonly text: string }
  /** LLM 文本已全部发完 (**不代表**音频播完, 音频结束看 tts_done). */
  | { readonly type: 'llm_done' }
  /** 一句开始 (seq 本轮内从 1 递增). */
  | { readonly type: 'sentence_start'; readonly seq: number; readonly text: string }
  /** 一句完整 mp3 (可独立播放) —— 前端排队播. */
  | { readonly type: 'tts_audio'; readonly seq: number; readonly text: string; readonly mime: string; readonly audio_base64: string }
  /** 一句结束. */
  | { readonly type: 'sentence_end'; readonly seq: number }
  /** 本轮音频全部下发完. */
  | { readonly type: 'tts_done'; readonly usage: { readonly characters: number } }
  /** 打断成功 (LLM 已 abort, TTS 已 task_cancel); 之后不再下发本轮剩余帧. */
  | { readonly type: 'cancelled' }
  /** 错误. */
  | { readonly type: 'error'; readonly error: VoiceError }
  /** 会话结束. */
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
   * 来访者 persona ID — 从 query `?personaId=` 提取, 可选.
   * 缺失时 VisitorService.openSession 走 PersonaRepository.findDefault() 兜底.
   */
  readonly personaId?: string;
  /** 会话模式 (text = 不出声; voice = 逐句出声). */
  readonly mode: VoiceSessionMode;
  /** 本场生效的临场参数 (供日志与业务侧插槽消费). */
  readonly preset: VoiceSessionPreset;
  /**
   * 业务指定的音色 (voice_id).
   *
   * 缺省 = 走 env `MINIMAX_TTS_VOICE_ID`; 有值 = 覆盖它 (spec §任务 3 的优先级链:
   * 握手 voiceId > 模板绑定音色 > env).
   */
  readonly voiceId?: string;
  /**
   * 专项训练技巧码 (V2026-10-26, spec §任务 1).
   *
   * undefined = 全流程 / 个案 (不聚焦单一技巧).
   */
  readonly skillCode?: VoiceSkillCode;
}

/** 来访者 persona 快照 (VoiceService 缓存, 用于 TTS 音色 + 日志). */
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
   * 用于日志 persona 标签. 整个 session 期间不变.
   */
  persona: VoiceSessionPersona | null;
  status: VoiceSessionStatus;
  /** 每次新 user_text / user_speaking 递增, 老 pipeline 检查不匹配自己退出. */
  currentGeneration: number;
  /** 当前 TTS session 句柄 (来自 TtsService.startSession). */
  ttsHandle: import('./tts/tts.types').TtsSessionHandle | null;
  /** 当前 LLM 流的可控 AbortController, signal 透传给 LlmService. */
  llmAbort: AbortController | null;
}
