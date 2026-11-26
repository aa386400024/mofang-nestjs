import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { MEMBERSHIP_TIER_PORT, type MembershipTierPort } from '../../src/voice/tts/ports/membership-tier.port.js';
import { TtsProfileResolver } from '../../src/voice/tts/runtime/tts-profile.resolver.js';

/** 固定会员档的测试端口. */
function tierPort(tier: 'free' | 'plus' | 'pro' | 'max'): MembershipTierPort {
  return {
    getEffectiveTier: async () => tier,
  };
}

function resolver(tier: 'free' | 'plus' | 'pro' | 'max', config: Record<string, unknown>): TtsProfileResolver {
  return new TtsProfileResolver(new ConfigService(config), tierPort(tier));
}

const MINIMAX_CONFIG = {
  minimax: {
    apiKey: 'test-minimax-key',
    ttsBaseUrl: 'https://api.minimax.cn',
    ttsVoiceId: 'Chinese (Mandarin)_Lyrical_Voice',
  },
};

describe('TtsProfileResolver', () => {
  it('Free/Plus 解析到 minimax-turbo', async () => {
    for (const tier of ['free', 'plus'] as const) {
      const profile = await resolver(tier, MINIMAX_CONFIG).resolve({ userId: 'u1' });
      expect(profile.profileId).toBe('minimax-turbo');
      expect(profile.provider).toBe('minimax');
      expect(profile.effectiveQuality).toBe('standard');
    }
  });

  it('Pro 解析到 minimax-hd', async () => {
    const profile = await resolver('pro', MINIMAX_CONFIG).resolve({ userId: 'u1' });
    expect(profile.profileId).toBe('minimax-hd');
    expect(profile.model).toBe('speech-2.8-hd');
    expect(profile.effectiveQuality).toBe('hd');
  });

  it('Max 解析到豆包，并把模板 MiniMax 音色映射成豆包音色', async () => {
    const profile = await resolver('max', {
      ...MINIMAX_CONFIG,
      doubao: {
        ttsApiKey: 'test-doubao-key',
        ttsWsUrl: 'wss://openspeech.bytedance.com/api/v3/plan/tts/bidirection',
        ttsVoiceId: 'zh_female_vv_uranus_bigtts',
      },
    }).resolve({
      userId: 'u1',
      voiceHint: 'Chinese (Mandarin)_Warm_Girl',
      voiceSource: 'template',
    });

    expect(profile.profileId).toBe('doubao-seed-2.0');
    expect(profile.provider).toBe('doubao');
    expect(profile.voiceId).toBe('zh_female_vv_uranus_bigtts');
    expect(profile.voiceSource).toBe('template');
    expect(profile.effectiveQuality).toBe('premium');
  });

  it('Max 缺豆包 key 时回退 minimax-hd，并带 fallback 元数据', async () => {
    const profile = await resolver('max', MINIMAX_CONFIG).resolve({ userId: 'u1' });
    expect(profile.profileId).toBe('minimax-hd');
    expect(profile.fallbackFrom).toBe('doubao-seed-2.0');
    expect(profile.fallbackReason).toBe('doubao_unconfigured');
    expect(profile.effectiveQuality).toBe('hd');
    expect(profile.requestedQuality).toBe('premium');
  });

  it('会员查询异常降级 Free（适配器语义由端口返回 free）', async () => {
    const failingPort: MembershipTierPort = {
      getEffectiveTier: async () => 'free',
    };
    const r = new TtsProfileResolver(new ConfigService(MINIMAX_CONFIG), failingPort);
    const profile = await r.resolve({ userId: 'u1' });
    expect(profile.profileId).toBe('minimax-turbo');
    expect(profile.accessTier).toBe('free');
  });

  it('运行期豆包失败可显式回退 HD', async () => {
    const r = resolver('max', {
      ...MINIMAX_CONFIG,
      doubao: {
        ttsApiKey: 'test-doubao-key',
        ttsWsUrl: 'wss://openspeech.bytedance.com/api/v3/plan/tts/bidirection',
        ttsVoiceId: 'zh_female_vv_uranus_bigtts',
      },
    });
    const profile = await r.resolve({ userId: 'u1', voiceHint: 'Chinese (Mandarin)_Warm_Girl' });
    const fallback = r.fallbackProfile(profile, { userId: 'u1', voiceHint: 'Chinese (Mandarin)_Warm_Girl' });
    expect(fallback.profileId).toBe('minimax-hd');
    expect(fallback.fallbackReason).toBe('doubao_start_failed');
    expect(fallback.voiceId).toBe('Chinese (Mandarin)_Warm_Girl');
  });

  it('Max 只有普通方舟 chat key 时视为豆包未配置，直接回退 HD', async () => {
    const profile = await resolver('max', {
      ...MINIMAX_CONFIG,
      doubao: { llmApiKey: 'chat-key-cannot-speak', ttsWsUrl: 'wss://openspeech.bytedance.com/api/v3/plan/tts/bidirection' },
    }).resolve({ userId: 'u1' });
    expect(profile.profileId).toBe('minimax-hd');
    expect(profile.fallbackReason).toBe('doubao_unconfigured');
  });

  it('MEMBERSHIP_TIER_PORT token 可被 Nest 注入识别', () => {
    expect(typeof MEMBERSHIP_TIER_PORT).toBe('symbol');
  });

  it('最低档 MiniMax 不可用时原样返回，只带 provider_unconfigured 诊断，不伪造 fallbackFrom', async () => {
    const profile = await resolver('free', { minimax: { apiKey: '' } }).resolve({ userId: 'u1' });
    expect(profile.profileId).toBe('minimax-turbo');
    expect(profile.fallbackFrom).toBeUndefined();
    expect(profile.fallbackReason).toBe('provider_unconfigured');
  });

  it('Pro HD 启动失败不降档，fallbackProfile 原样返回', async () => {
    const r = resolver('pro', MINIMAX_CONFIG);
    const profile = await r.resolve({ userId: 'u1' });
    const fallback = r.fallbackProfile(profile, { userId: 'u1' });
    expect(fallback.profileId).toBe('minimax-hd');
    expect(fallback.fallbackReason).toBeUndefined();
  });
});
