// V2026-10-23 治本 (TTS 公共类型契约 — 业务层看到的"句级 mp3"事件):
//   原因: 业务层 (VoiceService → WS 帧) 要的是"一句完整、可独立播放的 mp3",
//     不是"上游的一个 hex 分片". 旧契约暴露的是 `audio: Buffer` 的裸分片流,
//     上层要自己拼 mp3 —— 而"拼 mp3"这件事必须发生在**服务端** (前端拼不动, 也不该拼).
//   修法: 业务事件统一为句级: sentence_start → sentence_audio(整句 mp3) → sentence_end.
//     协议帧类型在 tts-protocol.types.ts, 业务层不接触 hex / 分片 / 上游状态码.
//   反双胞胎:
//     - 不用 Observable<TtsEvent>: 与仓库其它流 (LlmStream) 风格不一致, AsyncIterable 更 idiomatic
//     - 不用回调 (onAudio / onError): 回调地狱, 改为 AsyncIterable
//     - 不把 base64 编码放进 TTS 层: 字节 → 文本编码是**传输层**的事, 由 WS 帧层做

/** TTS bidi 启动选项. tenantId / userId / sessionId 必传. */
export interface TtsOptions {
  readonly tenantId: string;
  readonly userId: string;
  /** 训练 session id, 用于连接池 key + 日志追踪. */
  readonly sessionId: string;
  /**
   * 业务指定的音色 (voice_id).
   *
   * 本期 (spec §3.3/§5) **统一使用 env `MINIMAX_TTS_VOICE_ID`**, 不按人物切音色;
   * 内置 persona 里那批 `mandarin_*` 是未核实的占位值, 不得当可用值上线.
   */
  readonly voice?: string;
  /** 情绪标签; 不传 = 上游模型自动匹配. */
  readonly emotion?: string;
  /** 模型; 不传 = env `MINIMAX_TTS_MODEL` (默认 speech-2.8-turbo). */
  readonly model?: string;
}

/** TTS 用量, 写 billing (V0.x logger, V1.x 写 DB). */
export interface TtsUsage {
  readonly characters: number;
}

/** 错误信息, 含重试策略. */
export interface TtsError {
  /** 业务错误码 (例 tts_auth_failed / tts_rate_limited), 归一口径见 tts-error.mapper.ts. */
  readonly code: string;
  readonly message: string;
  /** 上游 base_resp.status_code (便于排查; 对前端不下发). */
  readonly upstreamStatus?: number;
  readonly retryable: boolean;
}

/** TTS 句级事件 union. */
export type TtsEvent =
  /** 一句开始 (seq 从 1 起, 本轮内递增). */
  | { readonly type: 'sentence_start'; readonly seq: number; readonly text: string }
  /** 一句合成完成 — data 是**该句完整 mp3**, 可独立播放. */
  | { readonly type: 'sentence_audio'; readonly seq: number; readonly text: string; readonly mime: string; readonly data: Buffer }
  /** 一句结束. */
  | { readonly type: 'sentence_end'; readonly seq: number }
  /** 本轮合成结束. */
  | { readonly type: 'done'; readonly usage: TtsUsage }
  /** 失败 (已归一, 含 retryable). */
  | { readonly type: 'error'; readonly error: TtsError };

/** TTS 事件流. */
export type TtsEventStream = AsyncIterable<TtsEvent>;

/**
 * session handle — VoiceService 用它喂文本 + 消费事件.
 *
 * `dispose()` 幂等: 释放本 handle 独占的那条 WS 连接 (池按连接 id 释放, 不会误伤同 session 的新连接).
 */
export interface TtsSessionHandle {
  readonly sessionId: string;
  readonly events: TtsEventStream;
  /** 流式推送文本 (LLM 增量 token); 内部按句切分后下发. */
  readonly sendText: (text: string) => void;
  /** 打断 — 协议级 task_cancel, 不等 in-flight 音频播完. */
  readonly cancel: () => void;
  /** 正常结束 — task_finish, 等 done 事件 (尾句由残余文本冲刷, 不丢). */
  readonly finish: () => void;
  /** 释放连接 (幂等). */
  readonly dispose: () => void;
}
