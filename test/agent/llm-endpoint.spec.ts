import { describe, expect, it } from 'vitest';

import { buildChatEndpoint } from '../../src/agent/llm/llm.endpoint.js';

describe('AF-248 chat 端点拼接', () => {
  it('MiniMax 基址不带 /v1 时补 /v1/chat/completions', () => {
    expect(buildChatEndpoint('minimax', 'https://api.minimax.cn')).toBe('https://api.minimax.cn/v1/chat/completions');
  });

  it('MiniMax 基址已带 /v1 时不重复补', () => {
    expect(buildChatEndpoint('minimax', 'https://api.minimax.cn/v1/')).toBe('https://api.minimax.cn/v1/chat/completions');
  });

  it('豆包方舟基址拼 /chat/completions，不插入 /v1', () => {
    expect(buildChatEndpoint('doubao', 'https://ark.cn-beijing.volces.com/api/v3')).toBe(
      'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    );
  });

  it('基址误带 /chat/completions 时先剥掉，避免重复', () => {
    expect(buildChatEndpoint('doubao', 'https://ark.cn-beijing.volces.com/api/v3/chat/completions/')).toBe(
      'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    );
  });
});
