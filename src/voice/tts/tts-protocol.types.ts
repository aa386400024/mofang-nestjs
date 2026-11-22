// V2026-10-23 治本 (MiniMax T2A V2 双向流式 — 官方帧类型契约, spec §3.2/§3.5):
//   来源: 官方 AsyncAPI `https://platform.minimaxi.com/docs/api-reference/speech/t2a/api/asyncapi-bidi.json`
//     (2026-10-23 大炮补发官方文档, 本文件按官方 schema 逐字段校准).
//   关键事实 (与旧自拟协议全部不兼容):
//     - 帧类型字段是 `event` (不是 `type`), **纯 JSON 文本帧**, 无二进制头
//     - 音频在 `task_continued.data.audio`, 是 **hex 编码的 mp3 分片**
//     - `task_continued.is_final` 是**顶层字段** (不在 data 里) —— 表示"本次请求的音频结束"
//     - `sentence_start` / `sentence_end` **没有 data 段** (只有 session_id/connect_id/event/trace_id/base_resp)
//     - `task_continued.data` **可能为 null**, 取值必须判空
//     - `data.subtitle` 是**对象** (需 task_start 开 subtitle_enable 才有): {text, text_begin, text_end, time_begin, time_end, timestamped_words}
//     - 用量在 `extra_info.usage_characters` (task_continued 上有, task_finished 上可选)
//
//   反双胞胎:
//     - 不把官方帧类型直接透传给业务层: 业务层要的是"一句完整 mp3", 不是"一个 hex 分片",
//       直接透传会让上层自己去拼 mp3 (前端/后端都要重写一遍拼帧逻辑)
//     - 不用 `type` 字段名: 官方就是 `event`, 写错字段名上游直接不认
//   验证:
//     1. tsc 0 错
//     2. 客户端发出的每一帧都带 `event` 字段
//   时间戳: 2026-10-23

/**
 * 官方 base_resp (状态码 + 描述).
 *
 * 成功时 status_code = 0; 失败时携带具体错误码 (见 tts-protocol.config.ts 的 TTS_STATUS).
 */
export interface TtsBaseResp {
  readonly status_code: number;
  readonly status_msg?: string;
}

/**
 * 官方字幕对象 (仅在 task_start 传 subtitle_enable=true 时随音频下发).
 *
 * 本期**不启用**字幕 (spec §3.5: "data.subtitle 本期忽略") —— 句字幕用后端自己的
 * 切句结果对齐, 不依赖上游字幕. 这里仍然按官方 schema 建模, 免得将来启用时被"猜"的类型坑.
 */
export interface TtsSubtitleData {
  /** 分段文本. */
  readonly text?: string;
  /** 分段在本次合成文本中的起始字符位置 (含). */
  readonly text_begin?: number;
  /** 分段在本次合成文本中的结束字符位置 (不含). */
  readonly text_end?: number;
  /** 分段起始时间 (毫秒, 相对本次合成音频起点). */
  readonly time_begin?: number;
  /** 分段结束时间 (毫秒, 相对本次合成音频起点). */
  readonly time_end?: number;
  /** 词级时间戳 (仅 subtitle_type=word/word_streaming 时有; sentence 时为 null). */
  readonly timestamped_words?: readonly TtsSubtitleWord[] | null;
}

/** 词级时间戳条目. */
export interface TtsSubtitleWord {
  readonly word?: string;
  readonly word_begin?: number;
  readonly word_end?: number;
  readonly time_begin?: number;
  readonly time_end?: number;
}

/**
 * `task_continued` 的 data 段.
 *
 * 官方明确提示: **data 可能为 null**, 取值必须判空.
 */
export interface TtsContinuedData {
  /** hex 编码的 mp3 分片 (一句由多片组成, 需服务端攒齐). */
  readonly audio?: string;
  /** 字幕对象 (开了 subtitle_enable 才有). */
  readonly subtitle?: TtsSubtitleData | null;
}

/**
 * 用量与音频元信息 (官方 extra_info).
 */
export interface TtsExtraInfo {
  /** 计费字符数 (usage_characters). */
  readonly usage_characters?: number;
  /** 字数. */
  readonly word_count?: number;
  /** 不可见字符占比 (官方用于判断非法字符, 对应 1042). */
  readonly invisible_character_ratio?: number;
  /** 音频时长 (毫秒). */
  readonly audio_length?: number;
  /** 音频字节数. */
  readonly audio_size?: number;
  readonly audio_format?: string;
  readonly audio_sample_rate?: number;
  readonly audio_channel?: number;
  readonly bitrate?: number;
}

/**
 * voice_setting (音色 / 语速 / 音量 / 音调 / 情绪).
 *
 * 官方取值域: speed ∈ [0.5, 2] / vol ∈ (0, 10] / pitch ∈ [-12, 12].
 */
export interface TtsVoiceSetting {
  /** 系统音色 id (必填). 本项目统一走 env `MINIMAX_TTS_VOICE_ID`. */
  readonly voice_id: string;
  readonly speed?: number;
  readonly vol?: number;
  readonly pitch?: number;
  /** 情绪标签; 不传 = 模型自动匹配 (spec §3.2). */
  readonly emotion?: string;
}

/**
 * audio_setting (采样率 / 码率 / 格式 / 声道).
 *
 * 官方: sample_rate ∈ [8000,16000,22050,24000,32000,44100] (默认 32000);
 *       bitrate ∈ [32000,64000,128000,256000] (默认 128000, 仅 mp3 生效);
 *       format ∈ mp3/pcm/flac/wav/pcmu_raw/pcmu_wav/opus (默认 mp3); channel ∈ [1,2] (默认 1).
 */
export interface TtsAudioSetting {
  readonly sample_rate: number;
  readonly bitrate?: number;
  readonly format: 'mp3' | 'pcm' | 'flac' | 'wav' | 'pcmu_raw' | 'pcmu_wav' | 'opus';
  readonly channel: number;
}

/**
 * 客户端 → 服务端 事件.
 *
 * 官方时序 (spec §3.1/§3.4):
 *   1. 连上后先收 `connected_success`
 *   2. 发 `task_start` → 收 `task_started`
 *   3. 之后才允许发 `task_continue` / `task_flush` / `task_finish` / `task_cancel`
 */
export type TtsBidiClientEvent =
  | {
      readonly event: 'task_start';
      readonly model: string;
      readonly language_boost?: string;
      readonly voice_setting: TtsVoiceSetting;
      readonly audio_setting: TtsAudioSetting;
      /** 会话 id (本端生成, 纯透传回显). */
      readonly session_id: string;
    }
  | { readonly event: 'task_continue'; readonly text: string }
  | { readonly event: 'task_finish' }
  | { readonly event: 'task_cancel' }
  | { readonly event: 'task_flush' };

/**
 * 服务端 → 客户端 事件.
 *
 * 事件语义与本项目业务事件的映射见 spec §3.5 的翻译表.
 */
export type TtsBidiServerEvent =
  | {
      readonly event: 'connected_success';
      readonly session_id?: string;
      readonly connect_id?: string;
      readonly trace_id?: string;
      readonly base_resp?: TtsBaseResp;
    }
  | {
      readonly event: 'task_started';
      readonly session_id?: string;
      readonly connect_id?: string;
      readonly trace_id?: string;
      readonly base_resp?: TtsBaseResp;
    }
  | {
      readonly event: 'task_continued';
      readonly task_id?: string;
      /** 音频分片 (可能为 null — 官方明确提示要判空). */
      readonly data?: TtsContinuedData | null;
      readonly extra_info?: TtsExtraInfo;
      /** 顶层字段: 本次请求的音频是否结束 (**不代表整句结束**, 整句结束看 sentence_end). */
      readonly is_final?: boolean;
      readonly session_id?: string;
      readonly connect_id?: string;
      readonly trace_id?: string;
      readonly base_resp?: TtsBaseResp;
    }
  | {
      readonly event: 'sentence_start';
      readonly session_id?: string;
      readonly connect_id?: string;
      readonly trace_id?: string;
      readonly base_resp?: TtsBaseResp;
    }
  | {
      readonly event: 'sentence_end';
      readonly session_id?: string;
      readonly connect_id?: string;
      readonly trace_id?: string;
      readonly base_resp?: TtsBaseResp;
    }
  | {
      readonly event: 'task_flushed';
      readonly session_id?: string;
      readonly connect_id?: string;
      readonly trace_id?: string;
      readonly base_resp?: TtsBaseResp;
    }
  | {
      readonly event: 'task_finished';
      readonly session_id?: string;
      readonly connect_id?: string;
      readonly trace_id?: string;
      readonly extra_info?: TtsExtraInfo;
      readonly base_resp?: TtsBaseResp;
    }
  | {
      readonly event: 'task_canceled';
      readonly session_id?: string;
      readonly connect_id?: string;
      readonly trace_id?: string;
      readonly base_resp?: TtsBaseResp;
    }
  | {
      readonly event: 'task_failed';
      readonly session_id?: string;
      readonly connect_id?: string;
      readonly trace_id?: string;
      readonly base_resp?: TtsBaseResp;
    }
  | { readonly event: 'error'; readonly base_resp?: TtsBaseResp };
