/**
 * TTS profile resolver — 唯一决策入口.
 *
 * 输入: 用户 id + 会话音色提示 + 当前时刻.
 * 输出: 已解析、可执行的 ResolvedTtsProfile（provider/model/baseUrl/voice/audio/fallback）.
 *
 * 设计边界:
 * - 决策只做一次; 传输适配器不回头读 env / 会员表;
 * - 会员档位经 MembershipTierPort, 不直接读 tierV2;
 * - 厂商不可用/音色不兼容时在**决策期**回退, 运行期启动失败由 VoiceService 调
 *   fallbackProfile() 再回退一次; 两条路径都留 tts_profile_fallback 日志.
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  DOUBAO_VOICE_PREFIXES,
  getTtsProfileDefinition,
  MINIMAX_TO_DOUBAO_VOICE,
  TTS_FALLBACK_PROFILE,
  TTS_PROFILE_DEFINITIONS,
  TTS_QUALITY_PROFILE,
  TTS_TIER_QUALITY,
} from './tts-profile.registry.js';
import type { ResolvedTtsProfile, TtsAccessTier, TtsProfileDefinition, TtsProfileId, VoiceQualityClass } from './tts-profile.types.js';
import { MEMBERSHIP_TIER_PORT, type MembershipTierPort } from '../ports/membership-tier.port.js';

/** 解析输入. */
export interface TtsProfileResolveInput {
  readonly userId: string;
  /** 会话级/模板归一后的音色提示; 空 = 走 profile/env 缺省. */
  readonly voiceHint?: string | null;
  /** 音色来源; 仅用于诊断. */
  readonly voiceSource?: 'session' | 'template';
  readonly now?: Date;
}

/** 判断是否像豆包官方音色. */
function looksLikeDoubaoVoice(voice: string): boolean {
  return DOUBAO_VOICE_PREFIXES.some((prefix) => voice.startsWith(prefix));
}

/** 把豆包 HTTP 基址归一成双向流式 WS 地址. */
function toDoubaoBidiUrl(raw: string): string {
  let trimmed = raw.trim();
  while (trimmed.endsWith('/')) trimmed = trimmed.slice(0, -1);
  if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) {
    if (trimmed.includes('/bidirection')) return trimmed;
    return trimmed.replace(/\/unidirectional(?:\/stream)?$/, '/bidirection');
  }
  const https = trimmed.replace(/^http:/i, 'https:');
  const wsBase = https.replace(/^https:/i, 'wss:');
  if (wsBase.includes('/bidirection')) return wsBase;
  if (/\/unidirectional(?:\/stream)?$/.test(wsBase)) return wsBase.replace(/\/unidirectional(?:\/stream)?$/, '/bidirection');
  return `${wsBase}/api/v3/plan/tts/bidirection`;
}

@Injectable()
export class TtsProfileResolver {
  private readonly logger = new Logger(TtsProfileResolver.name);

  constructor(
    private readonly config: ConfigService,
    @Optional()
    @Inject(MEMBERSHIP_TIER_PORT)
    private readonly membershipTier?: MembershipTierPort,
  ) {}

  /**
   * 解析本场 profile.
   *
   * @param input 用户/音色/时刻
   * @returns 已解析 profile; 上游不可用时返回已回退 profile
   */
  async resolve(input: TtsProfileResolveInput): Promise<ResolvedTtsProfile> {
    const now = input.now ?? new Date();
    const accessTier = await this.resolveAccessTier(input.userId, now);
    const quality = TTS_TIER_QUALITY[accessTier];
    const profileId = TTS_QUALITY_PROFILE[quality];
    const definition = getTtsProfileDefinition(profileId);

    if (!definition.enabled || !this.isProfileConfigured(definition)) {
      const reason = definition.provider === 'doubao' ? 'doubao_unconfigured' : 'provider_unconfigured';
      // 已是最低档仍不可用: 没有更低档可退, 原样返回并带诊断原因, 由传输层 fail-fast.
      if (profileId === TTS_FALLBACK_PROFILE) {
        this.logger.warn(`[tts_profile_unavailable] profile=${definition.id} tier=${accessTier} reason=${reason} user=${input.userId}`);
        return this.build(definition, accessTier, input, quality, quality, undefined, reason);
      }
      return this.buildFallback(definition, accessTier, input, quality, reason);
    }

    return this.build(definition, accessTier, input, quality, quality);
  }

  /**
   * 运行期失败回退: 只允许 premium -> minimax-turbo.
   *
   * @param failed 已失败 profile
   * @param input 原解析输入
   * @returns 回退 profile; 原 profile 非 premium 时原样返回
   */
  fallbackProfile(failed: ResolvedTtsProfile, input: TtsProfileResolveInput): ResolvedTtsProfile {
    // 只有 premium(豆包) 有降级契约; HD 启动失败不能悄悄降成 Turbo.
    if (failed.profileId !== 'doubao-seed-2.0') return failed;

    const fallbackDefinition = getTtsProfileDefinition(TTS_FALLBACK_PROFILE);
    this.logger.warn(
      `[tts_profile_fallback] from=${failed.profileId} to=${TTS_FALLBACK_PROFILE} ` +
        `tier=${failed.accessTier} reason=doubao_start_failed user=${input.userId}`,
    );
    return this.build(
      fallbackDefinition,
      failed.accessTier,
      input,
      failed.requestedQuality,
      fallbackDefinition.quality,
      failed.profileId,
      'doubao_start_failed',
    );
  }

  /** 配置自检结果 — 启动日志/诊断入口用, 不阻断启动. */
  inspect(): { readonly warnings: readonly string[]; readonly enabledProfiles: readonly TtsProfileId[] } {
    const warnings: string[] = [];
    for (const definition of Object.values(TTS_PROFILE_DEFINITIONS)) {
      if (!definition.enabled) {
        warnings.push(`profile ${definition.id} 未启用`);
        continue;
      }
      if (!this.isProfileConfigured(definition)) {
        warnings.push(
          definition.provider === 'doubao'
            ? '豆包 TTS 未配置 (DOUBAO_TTS_API_KEY/ARK_AGENT_PLAN_API_KEY 与 DOUBAO_TTS_WS_URL)'
            : 'MiniMax TTS API key 未配置 (MINIMAX_API_KEY)',
        );
      }
      if (definition.provider === 'minimax') {
        const configured = this.config.get<string>('minimax.ttsModel')?.trim();
        if (configured && configured !== definition.model && configured !== 'speech-2.8-hd') {
          warnings.push(`MINIMAX_TTS_MODEL=${configured} 已不再参与决策; 当前 profile=${definition.id} model=${definition.model}`);
        }
      }
    }
    return {
      warnings,
      enabledProfiles: Object.values(TTS_PROFILE_DEFINITIONS)
        .filter((item) => item.enabled)
        .map((item) => item.id),
    };
  }

  // ── private ────────────────────────────────────────────────────

  private async resolveAccessTier(userId: string, now: Date): Promise<TtsAccessTier> {
    if (!this.membershipTier) return 'free';
    return this.membershipTier.getEffectiveTier(userId, now);
  }

  private build(
    definition: TtsProfileDefinition,
    accessTier: TtsAccessTier,
    input: TtsProfileResolveInput,
    requestedQuality: VoiceQualityClass,
    effectiveQuality: VoiceQualityClass,
    fallbackFrom?: TtsProfileId,
    fallbackReason?: ResolvedTtsProfile['fallbackReason'],
  ): ResolvedTtsProfile {
    const voice = this.resolveVoice(definition, input.voiceHint ?? null);
    return {
      profileId: definition.id,
      provider: definition.provider,
      transport: definition.transport,
      model: definition.model,
      baseUrl: this.resolveBaseUrl(definition),
      voiceId: voice.voiceId,
      audio: definition.audio,
      requestedQuality,
      effectiveQuality,
      ...(fallbackFrom === undefined ? {} : { fallbackFrom }),
      ...(fallbackReason === undefined ? {} : { fallbackReason }),
      accessTier,
      voiceSource: voice.source,
    };
  }

  private buildFallback(
    failed: TtsProfileDefinition,
    accessTier: TtsAccessTier,
    input: TtsProfileResolveInput,
    requestedQuality: VoiceQualityClass,
    reason: NonNullable<ResolvedTtsProfile['fallbackReason']>,
  ): ResolvedTtsProfile {
    const fallback = getTtsProfileDefinition(TTS_FALLBACK_PROFILE);
    this.logger.warn(
      `[tts_profile_fallback] from=${failed.id} to=${TTS_FALLBACK_PROFILE} tier=${accessTier} ` + `reason=${reason} user=${input.userId}`,
    );
    return this.build(fallback, accessTier, input, requestedQuality, fallback.quality, failed.id, reason);
  }

  private resolveBaseUrl(definition: TtsProfileDefinition): string {
    if (definition.provider === 'doubao') {
      const configured = this.config.get<string>('doubao.ttsWsUrl')?.trim();
      return configured && configured.length > 0 ? toDoubaoBidiUrl(configured) : definition.defaultBaseUrl;
    }
    const configured = this.config.get<string>('minimax.ttsBaseUrl')?.trim();
    return configured && configured.length > 0 ? configured : definition.defaultBaseUrl;
  }

  private resolveVoice(
    definition: TtsProfileDefinition,
    voiceHint: string | null,
  ): { readonly voiceId: string; readonly source: 'session' | 'template' | 'profile-default' } {
    const hint = voiceHint?.trim() ?? '';
    if (hint.length > 0) {
      if (definition.provider === 'doubao') {
        const mapped = MINIMAX_TO_DOUBAO_VOICE[hint];
        if (mapped) return { voiceId: mapped, source: 'template' };
        if (looksLikeDoubaoVoice(hint)) return { voiceId: hint, source: 'session' };
      } else {
        if (!looksLikeDoubaoVoice(hint)) return { voiceId: hint, source: 'session' };
        const reverse = Object.entries(MINIMAX_TO_DOUBAO_VOICE).find(([, doubao]) => doubao === hint)?.[0];
        if (reverse) return { voiceId: reverse, source: 'template' };
      }
    }

    const envVoice =
      definition.provider === 'doubao'
        ? (this.config.get<string>('doubao.ttsVoiceId')?.trim() ?? '')
        : (this.config.get<string>('minimax.ttsVoiceId')?.trim() ?? '');
    if (envVoice.length > 0) return { voiceId: envVoice, source: 'profile-default' };
    return { voiceId: definition.defaultVoiceId, source: 'profile-default' };
  }

  private isProfileConfigured(definition: TtsProfileDefinition): boolean {
    if (definition.provider === 'doubao') {
      const key = this.doubaoApiKey();
      return key.length > 0 && this.resolveBaseUrl(definition).startsWith('wss://');
    }
    // MiniMax 的 key 是 bidi 建连必需; 音色可由会话/模板提供, 不能只看 env.
    return (this.config.get<string>('minimax.apiKey')?.trim() ?? '').length > 0;
  }

  private doubaoApiKey(): string {
    // 豆包语音 plan 端点只认语音专用 key; chat key 复用在真实上游会 401, 不能假装已配置.
    return this.config.get<string>('doubao.ttsApiKey')?.trim() ?? '';
  }
}
