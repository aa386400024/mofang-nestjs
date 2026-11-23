import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LlmService } from '../../src/agent/llm/llm.service.js';
import type { LlmStreamChunk } from '../../src/agent/llm/llm.types.js';

function fakeConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = {
    MINIMAX_BASE_URL: 'https://api.minimax.cn',
    MINIMAX_API_KEY: 'minimax-key',
    MINIMAX_LLM_MODEL: 'MiniMax-M3.1-Flash',
    LLM_DOUBAO_API_KEY: 'doubao-key',
    ...overrides,
  };
  return {
    get: <T>(key: string): T | undefined => values[key] as T | undefined,
  } as unknown as ConfigService;
}

const SSE = [
  'data: {"choices":[{"delta":{"content":"你好"},"index":0}]}',
  'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120}}',
  'data: [DONE]',
  '',
].join('\n');

function stubFetch(): { body: () => unknown } {
  let captured: unknown;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body?: string }) => {
      captured = JSON.parse(init.body ?? '{}');
      return new Response(SSE, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }),
  );
  return { body: () => captured };
}

async function collect(llm: LlmService, provider: 'minimax' | 'doubao'): Promise<LlmStreamChunk[]> {
  const chunks: LlmStreamChunk[] = [];
  for await (const chunk of llm.streamChat([{ role: 'user', content: 'hi' }], {
    provider,
    tenantId: 't',
    userId: 'u',
  })) {
    chunks.push(chunk);
  }
  return chunks;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AF-250 豆包流式 usage', () => {
  it('doubao 请求体带 stream_options.include_usage=true', async () => {
    const fetchStub = stubFetch();
    await collect(new LlmService(fakeConfig()), 'doubao');
    expect(fetchStub.body()).toMatchObject({ stream_options: { include_usage: true } });
  });

  it('doubao 末尾 usage chunk 被解析进 done，正文仍正常流出', async () => {
    stubFetch();
    const chunks = await collect(new LlmService(fakeConfig()), 'doubao');
    expect(chunks.filter((chunk) => chunk.type === 'content')).toHaveLength(1);
    const done = chunks.find((chunk) => chunk.type === 'done');
    expect(done).toMatchObject({ type: 'done', usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 } });
  });

  it('minimax 请求体逐字不带 stream_options', async () => {
    const fetchStub = stubFetch();
    await collect(new LlmService(fakeConfig()), 'minimax');
    expect(fetchStub.body()).not.toHaveProperty('stream_options');
  });

  it('minimax 显式开启成本取证时带 stream_options.include_usage=true', async () => {
    const fetchStub = stubFetch();
    await collect(new LlmService(fakeConfig({ 'minimax.llmIncludeUsage': true })), 'minimax');
    expect(fetchStub.body()).toMatchObject({ stream_options: { include_usage: true } });
  });
});
