/**
 * TTS 运行时决策类型 — 业务调用方与传输适配器共享的窄契约.
 *
 * 设计边界:
 * - 本文件只描述“本场用哪个厂商、哪条模型、哪个音色、什么传输与音频参数”;
 * - 不包含密钥、连接、重试等执行细节; 传输适配器各自持有生命周期;
 * - 不 import @nestjs / ConfigService / 具体客户端, 保持纯类型, 可被单测直接引用.
 */

/** TTS 上游厂商. */
export type TtsProviderId = 'minimax' | 'doubao';

/**
 * 会员质量类 — 会员档位只认质量类, 不直接绑厂商模型名.
 *
 * 厂商模型升级/替换只改 registry, 不改会员定义与前端协议.
 */
export type VoiceQualityClass = 'standard' | 'hd' | 'premium';

/** 会员有效访问档 (失效/异常统一落 free). */
export type TtsAccessTier = 'free' | 'plus' | 'pro' | 'max';

/** 稳定 profile id — 日志、指标、调试入口的对外标识. */
export type TtsProfileId = 'minimax-turbo' | 'minimax-hd' | 'doubao-seed-2.0';

/** 传输形态; 同一 provider 可以只有一种, 也可以后续扩展. */
export type TtsTransport = 'bidi' | 'unary';

/** 音频输出参数 (统一为业务句级 mp3 契约). */
export interface TtsAudioFormat {
  readonly format: 'mp3';
  readonly sampleRate: number;
  readonly bitrate: number;
  readonly mime: 'audio/mpeg';
}

/**
 * 一个可执行的 TTS profile.
 *
 * `profileId` 是决策结果; `model`/`baseUrl`/`defaultVoiceId` 是 registry 的事实;
 * `voiceId` 是本次会话已归一后的最终音色; `apiKey` 不在这里, 由传输适配器按
 * `provider` 读取配置, 避免决策对象被日志序列化时带出密钥.
 */
export interface ResolvedTtsProfile {
  readonly profileId: TtsProfileId;
  readonly provider: TtsProviderId;
  readonly transport: TtsTransport;
  readonly model: string;
  readonly baseUrl: string;
  readonly voiceId: string;
  readonly audio: TtsAudioFormat;
  readonly requestedQuality: VoiceQualityClass;
  /** 实际生效质量; 回退时与 requestedQuality 不同. */
  readonly effectiveQuality: VoiceQualityClass;
  /** 回退来源; undefined = 未回退. */
  readonly fallbackFrom?: TtsProfileId;
  /** 回退原因 (指标/日志枚举). */
  readonly fallbackReason?: 'doubao_unconfigured' | 'doubao_start_failed' | 'provider_unconfigured' | 'voice_incompatible';
  /** 本场会员档 (诊断用, 不参与执行). */
  readonly accessTier: TtsAccessTier;
  /** 音色来源, 便于排查“为什么这个音色”. */
  readonly voiceSource: 'session' | 'template' | 'profile-default';
}

/** profile 静态定义 — 单一事实源. */
export interface TtsProfileDefinition {
  readonly id: TtsProfileId;
  readonly provider: TtsProviderId;
  readonly transport: TtsTransport;
  readonly quality: VoiceQualityClass;
  readonly model: string;
  readonly defaultBaseUrl: string;
  /** 缺省音色; 空串 = 必须由会话/模板/env 提供, 不拿占位值顶替. */
  readonly defaultVoiceId: string;
  readonly audio: TtsAudioFormat;
  /** 该 profile 是否已在业务链路就绪; 未就绪 profile 解析时直接回退. */
  readonly enabled: boolean;
}
