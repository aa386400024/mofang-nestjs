// AF-227 · 豆包评分模型配置与 provider 额外请求字段单测.
//
// 边界: 纯构造，不发网络请求，不读真实 .env。

import { describe, expect, it } from 'vitest';

import { AIProviderId } from '../../src/llm/common/enums/llm.enums.js';
import type { ChatCompletionRequest } from '../../src/llm/common/interfaces/chat-provider.interface.js';
import {
  DEFAULT_DOUBAO_BASE_URL,
  DEFAULT_DOUBAO_CHAT_MODEL,
  resolveDoubaoBaseUrl,
  resolveDoubaoChatModel,
  resolveProviderChatModelFromEnv,
} from '../../src/llm/config/provider-env.js';
import { DoubaoChatProvider } from '../../src/llm/providers/doubao.provider.js';

function overridesOf(provider: DoubaoChatProvider): { modelKwargs?: Record<string, unknown> } {
  const withProtected = provider as unknown as {
    buildRequestOverrides(request: ChatCompletionRequest): { modelKwargs?: Record<string, unknown> };
  };
  return withProtected.buildRequestOverrides({ model: 'x', messages: [{ role: 'user', content: 'ping' }] });
}

describe('AF-227 豆包评分模型配置', () => {
  it('模型 env 空白回落当前可用型号，显式值优先', () => {
    expect(DEFAULT_DOUBAO_CHAT_MODEL).toBe('doubao-seed-2-1-pro-260915');
    expect(resolveDoubaoChatModel()).toBe(DEFAULT_DOUBAO_CHAT_MODEL);
    expect(resolveDoubaoChatModel(' '.repeat(3))).toBe(DEFAULT_DOUBAO_CHAT_MODEL);
    expect(resolveDoubaoChatModel('doubao-seed-2-1-pro-260628')).toBe('doubao-seed-2-1-pro-260628');
  });

  it('豆包模型 env 键登记为 LLM_DOUBAO_MODEL', () => {
    const env: Record<string, string | undefined> = { LLM_DOUBAO_MODEL: 'doubao-seed-2-1-pro-260915' };
    expect(resolveProviderChatModelFromEnv(AIProviderId.DOUBAO, (key) => env[key])).toBe('doubao-seed-2-1-pro-260915');
  });

  it('方舟基址只去尾斜杠，不套 OpenAI /v1 归一', () => {
    expect(resolveDoubaoBaseUrl()).toBe(DEFAULT_DOUBAO_BASE_URL);
    expect(resolveDoubaoBaseUrl('https://ark.cn-beijing.volces.com/api/v3/')).toBe('https://ark.cn-beijing.volces.com/api/v3');
  });

  it('provider 级 modelKwargs 会合并进请求体（thinking disabled）', () => {
    const provider = new DoubaoChatProvider({ modelKwargs: { thinking: { type: 'disabled' } } });
    expect(provider.defaultChatModel).toBe(DEFAULT_DOUBAO_CHAT_MODEL);
    expect(provider.baseUrl).toBe(DEFAULT_DOUBAO_BASE_URL);
    expect(overridesOf(provider).modelKwargs).toEqual({ thinking: { type: 'disabled' } });
  });

  it('未配置 modelKwargs 时不产生额外请求字段', () => {
    const provider = new DoubaoChatProvider();
    expect(overridesOf(provider).modelKwargs).toBeUndefined();
  });
});
