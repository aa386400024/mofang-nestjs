/**
 * TTS profile registry — 厂商能力、模型、默认音色、端点与质量映射的唯一事实源.
 *
 * 这里刻意只放静态事实, 不放 env / 密钥 / 连接:
 * - env 是部署参数, 由 resolver 读取并覆盖 baseUrl/音色;
 * - 密钥只由传输适配器按 provider 读取, 不进入决策对象.
 */

import type { TtsAccessTier, TtsAudioFormat, TtsProfileDefinition, TtsProfileId, VoiceQualityClass } from './tts-profile.types.js';

/** 统一音频契约: 业务层只消费整句 mp3. */
const MP3_AUDIO: TtsAudioFormat = {
  format: 'mp3',
  sampleRate: 24_000,
  bitrate: 64_000,
  mime: 'audio/mpeg',
};

/**
 * 固定 profile 表.
 *
 * `enabled=false` 只允许出现在“协议已确认、业务尚未接入”的 profile;
 * 本次豆包已确认 V3 双向流式 WS 协议, 因此 enable 为 true, 由运行时配置
 * 自检决定是否可真正建连.
 */
export const TTS_PROFILE_DEFINITIONS: Readonly<Record<TtsProfileId, TtsProfileDefinition>> = {
  'minimax-turbo': {
    id: 'minimax-turbo',
    provider: 'minimax',
    transport: 'bidi',
    quality: 'standard',
    model: 'speech-2.8-turbo',
    defaultBaseUrl: 'https://api.minimax.cn',
    defaultVoiceId: '',
    audio: { ...MP3_AUDIO, sampleRate: 32_000, bitrate: 128_000 },
    enabled: true,
  },
  'minimax-hd': {
    id: 'minimax-hd',
    provider: 'minimax',
    transport: 'bidi',
    quality: 'hd',
    model: 'speech-2.8-hd',
    defaultBaseUrl: 'https://api.minimax.cn',
    defaultVoiceId: '',
    audio: { ...MP3_AUDIO, sampleRate: 32_000, bitrate: 128_000 },
    enabled: true,
  },
  'doubao-seed-2.0': {
    id: 'doubao-seed-2.0',
    provider: 'doubao',
    transport: 'bidi',
    quality: 'premium',
    model: 'seed-tts-2.0',
    defaultBaseUrl: 'wss://openspeech.bytedance.com/api/v3/plan/tts/bidirection',
    defaultVoiceId: 'zh_female_vv_uranus_bigtts',
    audio: MP3_AUDIO,
    enabled: true,
  },
};

/** 会员档 -> 质量类. Free 是正式兜底档, 不是 NONE. */
export const TTS_TIER_QUALITY: Readonly<Record<TtsAccessTier, VoiceQualityClass>> = {
  free: 'standard',
  plus: 'standard',
  pro: 'hd',
  max: 'premium',
};

/** 质量类 -> 首选 profile; premium 未就绪时由 resolver 回退 standard. */
export const TTS_QUALITY_PROFILE: Readonly<Record<VoiceQualityClass, TtsProfileId>> = {
  standard: 'minimax-turbo',
  hd: 'minimax-hd',
  premium: 'doubao-seed-2.0',
};

/** 豆包不可用/启动失败时的唯一回退目标. */
export const TTS_FALLBACK_PROFILE: TtsProfileId = 'minimax-turbo';

/**
 * 跨厂商音色映射 — MiniMax 官方中文系统音色 -> 豆包 2.0 音色.
 *
 * 模板里的 `voice_id` 是 MiniMax 时代的稳定契约; 换 provider 时不能把它原样
 * 送进豆包 (上游会 2054/音色不存在). 本表是**音色防腐层**, 新增模板音色时
 * 在这里补一行, 或改由数据库 provider 音色绑定表接管.
 */
export const MINIMAX_TO_DOUBAO_VOICE: Readonly<Record<string, string>> = {
  'Chinese (Mandarin)_Sincere_Teacher': 'zh_female_xiaohe_uranus_bigtts',
  'Chinese (Mandarin)_Warm_Girl': 'zh_female_vv_uranus_bigtts',
  'Chinese (Mandarin)_Mature_Woman': 'zh_female_wenroumama_uranus_bigtts',
  'Chinese (Mandarin)_Lyrical_Voice': 'zh_female_wenrouxiaoya_uranus_bigtts',
  'Chinese (Mandarin)_News_Anchor': 'zh_female_qingxinnvshen_uranus_bigtts',
  'Chinese (Mandarin)_Gentleman': 'zh_male_ruyayichen_uranus_bigtts',
};

/** 豆包 2.0 官方音色前缀; 用于判断“已是豆包音色”无需映射. */
export const DOUBAO_VOICE_PREFIXES: readonly string[] = ['zh_', 'saturn_', 'ICL_', 'en_'];

/**
 * 取 profile 定义; 未知 id 直接抛错 (白名单之外不允许任意 model 字符串).
 *
 * @param profileId 稳定 profile id
 * @returns 静态定义
 */
export function getTtsProfileDefinition(profileId: TtsProfileId): TtsProfileDefinition {
  const definition = TTS_PROFILE_DEFINITIONS[profileId];
  if (!definition) throw new Error(`TTS profile 未注册: ${profileId}`);
  return definition;
}
