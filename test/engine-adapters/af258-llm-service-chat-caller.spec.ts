// AF-255 · LlmServiceChatCaller 单测：流式映射、参数透传与错误语义。
// 真实上游不进 CI；这里用假流验证适配器契约，真实豆包调用由 bin/visitor-render-smoke.ts 人工执行。

import { describe, expect, it } from 'vitest';

import type { LlmMessage, LlmStreamChunk, LlmStreamOptions } from '../../src/agent/llm/llm.types.js';
import {
  createLlmServiceChatCaller,
  toLlmMessages,
  type LlmStreamSource,
} from '../../src/engine-adapters/wiring/llm-service-chat-caller.js';
import type { ChatCompletionRequest } from '../../src/llm/common/interfaces/chat-provider.interface.js';

const REQUEST: ChatCompletionRequest = {
  model: 'doubao-seed-character-260628',
  messages: [
    { role: 'system', content: '你是来访者' },
    { role: 'user', content: '咨询师：最近睡得怎么样？' },
  ],
  temperature: 0.6,
  maxCompletionTokens: 160,
};

function fakeLlm(
  chunks: readonly LlmStreamChunk[],
  captured?: { messages?: readonly LlmMessage[]; options?: LlmStreamOptions },
): LlmStreamSource {
  return {
    async *streamChat(messages: readonly LlmMessage[], options: LlmStreamOptions): AsyncIterable<LlmStreamChunk> {
      if (captured) {
        captured.messages = messages;
        captured.options = options;
      }
      for (const chunk of chunks) yield chunk;
    },
  };
}

async function collect(stream: AsyncIterable<{ delta: string; tokenCount: number; isFinal: boolean }>) {
  const out: { delta: string; tokenCount: number; isFinal: boolean }[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

describe('AF-255 LlmServiceChatCaller', () => {
  it('content → delta，done → 带 usage 的 final chunk', async () => {
    const captured: { messages?: readonly LlmMessage[]; options?: LlmStreamOptions } = {};
    const llm = fakeLlm(
      [
        { type: 'content', content: '还' },
        { type: 'content', content: '行。' },
        { type: 'done', usage: { promptTokens: 93, completionTokens: 24, totalTokens: 117 }, finishReason: 'stop' },
      ],
      captured,
    );
    const caller = createLlmServiceChatCaller(llm, { provider: 'doubao', tenantId: 't', userId: 'u' });

    const chunks = await collect(caller.stream!(REQUEST));

    expect(chunks).toEqual([
      { delta: '还', tokenCount: 0, isFinal: false },
      { delta: '行。', tokenCount: 0, isFinal: false },
      {
        delta: '',
        tokenCount: 117,
        promptTokens: 93,
        completionTokens: 24,
        isFinal: true,
        finishReason: 'stop',
      },
    ]);
    expect(captured.messages).toEqual([
      { role: 'system', content: '你是来访者' },
      { role: 'user', content: '咨询师：最近睡得怎么样？' },
    ]);
    expect(captured.options).toMatchObject({
      provider: 'doubao',
      model: 'doubao-seed-character-260628',
      temperature: 0.6,
      maxCompletionTokens: 160,
      tenantId: 't',
      userId: 'u',
    });
  });

  it('error chunk 转成异常，交给渲染适配器做候选切备/降级', async () => {
    const llm = fakeLlm([{ type: 'error', error: { code: 'UPSTREAM_500', message: 'boom', retryable: true } }]);
    const caller = createLlmServiceChatCaller(llm, { provider: 'doubao', tenantId: 't', userId: 'u' });

    await expect(collect(caller.stream!(REQUEST))).rejects.toThrow('LLM stream error UPSTREAM_500');
  });

  it('tool 消息显式拒绝，不伪装成用户发言', () => {
    expect(() => toLlmMessages([{ role: 'tool', content: 'tool result' }])).toThrow('不支持 tool 消息');
  });

  it('chat 入口显式失败，避免静默走聚合路径', async () => {
    const caller = createLlmServiceChatCaller(fakeLlm([]), { provider: 'doubao', tenantId: 't', userId: 'u' });
    await expect(caller.chat(REQUEST, 'doubao')).rejects.toThrow('只支持 stream');
  });
});
