// AF-395: 调试页专用的三个 HTTP TTS 适配器。
// 边界：只做"文本 -> 音频字节"的纯适配，不读写数据库、不依赖 Nest；
// 任何 API key 只从调用方传入，不落日志、不出现在错误消息里。
import { randomUUID } from 'node:crypto';

/** 调试页支持的三家模型标识（前端按钮与缓存键共用）. */
export type DebugTtsProvider = 'minimax-hd' | 'minimax-turbo' | 'doubao-seed-tts-2.0';

/** 单次合成的输入. */
export interface TtsSynthesisInput {
  readonly text: string;
  readonly voiceId: string;
  readonly emotion: string | null;
  readonly model: string;
  readonly speed: number;
  readonly volume: number;
  readonly pitch: number;
  readonly sampleRate: number;
  readonly apiKey: string;
  readonly baseUrl: string;
  /** AF-460: 豆包 2.0 `context_texts`（一条组合风格指令，只第一条生效）. */
  readonly deliveryContext?: string;
  /** AF-460: 文本末尾静默（豆包 `additions.silence_duration` 只支持末尾 0–30000ms）. */
  readonly trailingSilenceMs?: number;
}

/** 单次合成结果. */
export interface TtsSynthesisOutput {
  readonly audio: Buffer;
  readonly format: 'mp3';
  readonly sampleRate: number;
  readonly durationMs: number | null;
  readonly usage: Record<string, unknown> | null;
}

/** 上游 TTS 失败（消息已脱敏，可直接给管理端展示）. */
export class DebugTtsProviderError extends Error {
  constructor(
    message: string,
    readonly provider: DebugTtsProvider,
  ) {
    super(message);
    this.name = 'DebugTtsProviderError';
  }
}

/** 情绪 -> 豆包语音指令（只取语义层封闭枚举）. */
const DOUBAO_EMOTION_HINT: Record<string, string> = {
  sad: '请用低落、克制的语气说这句话。',
  calm: '请用平静、自然的语气说这句话。',
  fearful: '请用不安、紧张的语气说这句话。',
  angry: '请用压抑着怒气的语气说这句话。',
  happy: '请用稍微轻快一点的语气说这句话。',
};

/** MiniMax 同步 T2A V2. */
export async function synthesizeMiniMax(input: TtsSynthesisInput, provider: DebugTtsProvider): Promise<TtsSynthesisOutput> {
  const endpoint = `${trimBase(input.baseUrl)}/v1/t2a_v2`;
  const body = {
    model: input.model,
    text: input.text,
    stream: false,
    language_boost: 'Chinese',
    voice_setting: {
      voice_id: input.voiceId,
      speed: input.speed,
      vol: input.volume,
      pitch: input.pitch,
      ...(input.emotion === null ? {} : { emotion: input.emotion }),
    },
    audio_setting: {
      sample_rate: input.sampleRate,
      bitrate: 128_000,
      format: 'mp3',
      channel: 1,
    },
  };
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new DebugTtsProviderError(`MiniMax TTS HTTP ${response.status}`, provider);
  }
  const payload = (await response.json()) as {
    data?: { audio?: string };
    extra_info?: { audio_length?: number };
    base_resp?: { status_code?: number; status_msg?: string };
  };
  const statusCode = payload.base_resp?.status_code ?? 0;
  if (statusCode !== 0) {
    throw new DebugTtsProviderError(`MiniMax TTS status ${statusCode}: ${payload.base_resp?.status_msg ?? 'unknown'}`, provider);
  }
  const audioHex = payload.data?.audio;
  if (typeof audioHex !== 'string' || audioHex.length === 0) {
    throw new DebugTtsProviderError('MiniMax TTS 返回空音频', provider);
  }
  return {
    audio: decodeMiniMaxAudio(audioHex),
    format: 'mp3',
    sampleRate: input.sampleRate,
    durationMs: typeof payload.extra_info?.audio_length === 'number' ? payload.extra_info.audio_length : null,
    usage: null,
  };
}

/** 豆包 Agent Plan HTTP 单向流式 TTS. */
export async function synthesizeDoubao(input: TtsSynthesisInput, provider: DebugTtsProvider): Promise<TtsSynthesisOutput> {
  const endpoint = trimBase(input.baseUrl);
  const emotionHint = input.emotion === null ? null : (DOUBAO_EMOTION_HINT[input.emotion] ?? null);
  // AF-460: 官方只有第一条 context_texts 生效；组合指令优先，缺失时退回单句情绪提示.
  const contextText = firstNonEmpty(input.deliveryContext, emotionHint);
  const trailingSilenceMs = clamp(input.trailingSilenceMs ?? 0, 0, 30_000);
  const body = {
    req_params: {
      text: input.text,
      speaker: input.voiceId,
      audio_params: {
        format: 'mp3',
        sample_rate: input.sampleRate,
        speech_rate: clamp(Math.round((input.speed - 1) * 100), -50, 100),
        loudness_rate: clamp(Math.round((input.volume - 1) * 100), -50, 100),
        pitch_rate: clamp(Math.round(input.pitch), -12, 12),
      },
      ...(contextText === null ? {} : { context_texts: [contextText] }),
      additions: {
        // 来访者台词里的括号是副语言/动作标注，不能让 2.0 当普通括号念出来.
        max_length_to_filter_parenthesis: 0,
        disable_markdown_filter: false,
        disable_emoji_filter: false,
        ...(trailingSilenceMs > 0 ? { silence_duration: trailingSilenceMs } : {}),
      },
    },
  };
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'X-Api-Key': input.apiKey,
      'X-Api-Resource-Id': 'seed-tts-2.0',
      'X-Api-Request-Id': randomUUID(),
      'X-Control-Require-Usage-Tokens-Return': '*',
      'Content-Type': 'application/json',
      Accept: 'text/plain',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new DebugTtsProviderError(doubaoHttpError(response.status, raw), provider);
  }
  const chunks = parseDoubaoChunks(raw);
  const audioParts: Buffer[] = [];
  let finalUsage: Record<string, unknown> | null = null;
  for (const chunk of chunks) {
    if (typeof chunk.code === 'number' && chunk.code !== 0 && chunk.code !== 20_000_000) {
      throw new DebugTtsProviderError(`豆包 TTS ${chunk.code}: ${chunk.message ?? 'unknown'}`, provider);
    }
    if (typeof chunk.data === 'string' && chunk.data.length > 0) {
      audioParts.push(Buffer.from(chunk.data, 'base64'));
    }
    if (chunk.code === 20_000_000 && chunk.usage !== undefined) {
      finalUsage = chunk.usage as Record<string, unknown>;
    }
  }
  if (audioParts.length === 0) {
    throw new DebugTtsProviderError('豆包 TTS 返回空音频', provider);
  }
  return {
    audio: Buffer.concat(audioParts),
    format: 'mp3',
    sampleRate: input.sampleRate,
    durationMs: null,
    usage: finalUsage,
  };
}

/** 去掉 base URL 尾部斜杠（循环切片避免正则回溯）. */
function trimBase(value: string): string {
  let out = value;
  while (out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

/** 取第一个非空字符串（不触发 `||` 的宽松判断）. */
function firstNonEmpty(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed.length > 0) return trimmed;
  }
  return null;
}

/** 数值夹取. */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** MiniMax `data.audio` 可能是 hex；兼容个别环境返回 base64. */
function decodeMiniMaxAudio(value: string): Buffer {
  const looksHex = value.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(value);
  return looksHex ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');
}

/** 豆包 HTTP 错误体脱敏：只保留 code/message，不回显请求或 key. */
function doubaoHttpError(status: number, raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { code?: number; message?: string };
    const message = parsed.message ?? 'unknown';
    if (message.includes('AgentPlanDeductNotEnabled')) {
      return '豆包 Agent Plan 抵扣未开启，请在火山方舟控制台开启 Agent Plan 抵扣后重试';
    }
    return `豆包 TTS HTTP ${status}${parsed.code === undefined ? '' : ` / ${parsed.code}`}: ${message.slice(0, 200)}`;
  } catch {
    return `豆包 TTS HTTP ${status}`;
  }
}

/** 逐行解析豆包 chunked JSON（允许空行与 `data:` 前缀）. */
interface DoubaoChunk {
  code?: number;
  message?: string;
  data?: string;
  usage?: unknown;
}

function parseDoubaoChunks(raw: string): DoubaoChunk[] {
  const out: DoubaoChunk[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const json = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
    try {
      const parsed = JSON.parse(json) as DoubaoChunk;
      out.push(parsed);
    } catch {
      // 非 JSON 行（例如日志/空包）不参与音频拼接，避免把错误文本当音频.
    }
  }
  return out;
}
