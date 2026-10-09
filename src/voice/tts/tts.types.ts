// V2026-10-08 治本 (TTS bidi 公共类型契约):
//   TtsEvent 是 union, 跟 LlmStreamChunk 一致 — 错误作为数据 yield, 不 throw.
//   MiniMax 内部协议类型 (MiniMaxTtsClientEvent) 跟外部 TtsEvent 解耦:
//     内部 JSON 字段 / 错误码 → 翻译成外部 TtsError (含 retryable).
//
// 反双胞胎:
//   - 不用 Observable<TtsEvent> — NestJS 其他模块风格不一致, AsyncIterable
//     更 idiomatic, for-of 即可消费.
//   - 不用回调 (onAudio / onError) — 回调地狱, 改为 AsyncIterable.

/** TTS bidi 启动选项. tenantId / userId / sessionId 必传. */
export interface TtsOptions {
  readonly tenantId: string;
  readonly userId: string;
  /** 训练 session id, 用于连接池 key + 日志追踪. */
  readonly sessionId: string;
  /** MiniMax voice_id, 默认由配置决定. */
  readonly voice?: string;
  /** 情绪: happy / sad / angry / fearful / disgusted / surprised / calm / fluent / whisper. */
  readonly emotion?: string;
  /** 模型, 默认 speech-2.8. */
  readonly model?: string;
  /** 音频采样率, 默认 16000 Hz. */
  readonly sampleRate?: number;
}

/** TTS streaming 事件 union. */
export type TtsEvent =
  | { readonly type: 'audio'; readonly data: Buffer; readonly timestampMs: number }
  | { readonly type: 'sentence_start'; readonly text: string; readonly index: number }
  | { readonly type: 'sentence_end'; readonly text: string; readonly index: number }
  | { readonly type: 'done'; readonly usage: TtsUsage }
  | { readonly type: 'error'; readonly error: TtsError };

/** TTS 用量, 写 billing (V0.x logger, V1.x 写 DB). */
export interface TtsUsage {
  readonly characters: number;
}

/** 错误信息, 含重试策略. */
export interface TtsError {
  /** 业务错误码: http_4xx / http_5xx / parse_error / ws_closed / upstream_error. */
  readonly code: string;
  readonly message: string;
  readonly httpStatus?: number;
  readonly retryable: boolean;
}

export type TtsEventStream = AsyncIterable<TtsEvent>;

/** session handle — VoiceGateway 用它流式消费音频 + 推送文本. */
export interface TtsSessionHandle {
  readonly sessionId: string;
  readonly events: TtsEventStream;
  /** 流式推送文本 (LLM 增量 token). */
  readonly sendText: (text: string) => void;
  /** 打断 — 协议级 task_cancel, 不等 in-flight 音频播完. */
  readonly cancel: () => void;
  /** 正常结束 — task_finish, 等 done 事件. */
  readonly finish: () => void;
}

// ─────────────────────────────────────────────────────────────────
// MiniMax 内部协议类型 (wss 收到 / 发出) — 不暴露给业务层
// ─────────────────────────────────────────────────────────────────

/** Client → Server 控制事件. */
export type MiniMaxTtsClientEvent =
  | {
      readonly type: 'task_start';
      readonly model: string;
      readonly voice_setting: { readonly voice_id: string; readonly emotion?: string };
      readonly audio_setting?: { readonly sample_rate?: number; readonly format?: string };
    }
  | { readonly type: 'task_continue'; readonly text: string }
  | { readonly type: 'task_cancel' }
  | { readonly type: 'task_finish' };

/** Server → Client 控制事件. */
export type MiniMaxTtsServerEvent =
  | { readonly type: 'task_started'; readonly task_id?: string }
  | { readonly type: 'task_continued'; readonly task_id?: string }
  | { readonly type: 'task_canceled'; readonly task_id?: string }
  | { readonly type: 'task_finished'; readonly task_id?: string }
  | { readonly type: 'sentence_start'; readonly text: string; readonly index: number }
  | { readonly type: 'sentence_end'; readonly text: string; readonly index: number }
  | { readonly type: 'done'; readonly usage?: { readonly characters?: number } }
  | { readonly type: 'error'; readonly error?: { readonly code?: string; readonly message?: string } };
