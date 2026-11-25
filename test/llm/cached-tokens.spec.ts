// AF-478 · 缓存命中解析单测.
//
// 目的: 锁住"上游没报 = 不可得 (undefined), 报 0 = 确实没命中"这一条口径,
// 以及 OpenAI 兼容 / Anthropic 兼容 / LangChain 归一三种真实形状都能读出来.
// 零真实网络.

import { describe, expect, it } from 'vitest';
import { resolveCachedTokens, resolveCachedUsageField } from '../../src/llm/common/base/openai-compatible-chat.provider.js';

describe('AF-478 · resolveCachedTokens', () => {
  it('读 OpenAI 兼容 usage.prompt_tokens_details.cached_tokens', () => {
    expect(
      resolveCachedTokens({
        responseMetadata: { usage: { prompt_tokens_details: { cached_tokens: 384 } } },
      }),
    ).toBe(384);
  });

  it('读 Anthropic 兼容 usage.cache_read_input_tokens', () => {
    expect(
      resolveCachedTokens({
        responseMetadata: { usage: { cache_read_input_tokens: 512 } },
      }),
    ).toBe(512);
  });

  it('读 LangChain 归一的 usage_metadata.input_token_details.cache_read', () => {
    expect(
      resolveCachedTokens({
        usageMetadata: { input_token_details: { cache_read: 256 } },
      }),
    ).toBe(256);
  });

  it('报 0 时保留 0 (确实没命中), 不是"不可得"', () => {
    expect(
      resolveCachedTokens({
        responseMetadata: { usage: { prompt_tokens_details: { cached_tokens: 0 } } },
      }),
    ).toBe(0);
  });

  it('上游没报 → undefined, 不补 0', () => {
    expect(resolveCachedTokens({ responseMetadata: { usage: { prompt_tokens: 1200 } } })).toBeUndefined();
    expect(resolveCachedTokens({})).toBeUndefined();
  });

  it('非法值 (负数 / 字符串 / 非有限数) 一律忽略', () => {
    expect(resolveCachedTokens({ responseMetadata: { usage: { prompt_tokens_details: { cached_tokens: -1 } } } })).toBeUndefined();
    expect(resolveCachedTokens({ responseMetadata: { usage: { prompt_tokens_details: { cached_tokens: '12' } } } })).toBeUndefined();
    expect(resolveCachedTokens({ responseMetadata: { usage: { prompt_tokens_details: { cached_tokens: Infinity } } } })).toBeUndefined();
  });

  it('resolveCachedUsageField: 没报不出键, 报了才展开', () => {
    expect(resolveCachedUsageField(undefined, { usage: { prompt_tokens_details: { cached_tokens: 0 } } })).toEqual({ cachedTokens: 0 });
    expect(resolveCachedUsageField(undefined, { usage: {} })).toEqual({});
  });
});
