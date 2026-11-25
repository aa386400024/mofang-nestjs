// V2026-11-22 建立 (AF-255 · 引擎渲染路径豆包端到端 smoke):
//   职责: 把 `LlmService.streamChat` 适配成渲染适配器的窄调用面 `ChatCaller.stream`。
//   边界: 只做签名/字段映射与错误冒泡；不选 provider、不改模型、不拼 prompt、不碰内核。
//
//   为什么需要它:
//     生产引擎渲染走 `RouterChatCaller → LlmRouterService`；那条链要拉起完整 Nest 容器
//     （DB / Redis / 注册表）才能跑。灰度前的真实 smoke 只需要验证「渲染适配器 → 真实
//     上游」这一段，所以用一个只依赖 `LlmService` 的窄适配器，既复用生产 LlmService 的
//     鉴权 / 端点 / 流式解析，又不把整个应用启动起来。
//
//   反双胞胎:
//     - 不复制 LlmService 的端点 / key / 模型解析：那些仍由 LlmService 单一持有。
//     - 不在这里做 fallback：候选主备是渲染适配器的职责，本层只对「当前候选」发一次请求。

import type { LlmMessage, LlmStreamChunk, LlmStreamOptions } from '../../agent/llm/llm.types.js';
import type { ChatCompletionChunk, ChatCompletionRequest, ChatMessage } from '../../llm/common/interfaces/chat-provider.interface.js';
import type { ChatCaller, ChatStreamOptions } from '../rendering/llm-render.adapter.js';

/** 只暴露 smoke 需要的最小能力面，避免把 LlmService 具体类焊死在本模块。 */
export interface LlmStreamSource {
  streamChat(messages: readonly LlmMessage[], opts: LlmStreamOptions): AsyncIterable<LlmStreamChunk>;
}

/** 每次调用固定归属与 provider；请求级模型 / 温度仍来自 `ChatCompletionRequest`。 */
export interface LlmServiceChatCallerOptions {
  readonly provider: 'minimax' | 'doubao';
  readonly tenantId: string;
  readonly userId: string;
  readonly traceId?: string;
  readonly timeoutMs?: number;
}

/**
 * 把渲染适配器的 `ChatCaller` 接到 `LlmService.streamChat`。
 *
 * @param llm 真实 LlmService（或同形状的流式源）
 * @param options 固定归属 / provider
 * @returns 只实现 stream 的 ChatCaller
 */
export function createLlmServiceChatCaller(llm: LlmStreamSource, options: LlmServiceChatCallerOptions): ChatCaller {
  return {
    chat(): Promise<never> {
      return Promise.reject(new Error('LlmServiceChatCaller 只支持 stream；渲染路径应走 streamRender'));
    },
    async *stream(req: ChatCompletionRequest, opts?: ChatStreamOptions): AsyncIterable<ChatCompletionChunk> {
      const messages = toLlmMessages(req.messages);
      let tokenFields: Pick<LlmStreamOptions, 'maxTokens' | 'maxCompletionTokens'> = {};
      if (req.maxCompletionTokens !== undefined) tokenFields = { maxCompletionTokens: req.maxCompletionTokens };
      else if (req.maxTokens !== undefined) tokenFields = { maxTokens: req.maxTokens };
      const streamOptions: LlmStreamOptions = {
        provider: options.provider,
        model: req.model,
        ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
        ...tokenFields,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        tenantId: options.tenantId,
        userId: options.userId,
        ...(options.traceId ? { traceId: `${options.traceId}-${Date.now()}` } : {}),
        ...(opts?.signal ? { signal: opts.signal } : {}),
      };

      for await (const chunk of llm.streamChat(messages, streamOptions)) {
        if (chunk.type === 'error') {
          throw new Error(`LLM stream error ${chunk.error.code}: ${truncate(chunk.error.message, 120)}`);
        }
        if (chunk.type === 'content') {
          if (chunk.content.length === 0) continue;
          yield { delta: chunk.content, tokenCount: 0, isFinal: false };
          continue;
        }
        yield {
          delta: '',
          tokenCount: chunk.usage.totalTokens,
          promptTokens: chunk.usage.promptTokens,
          completionTokens: chunk.usage.completionTokens,
          ...(chunk.usage.cachedTokens === undefined ? {} : { cachedTokens: chunk.usage.cachedTokens }),
          isFinal: true,
          ...(chunk.finishReason ? { finishReason: chunk.finishReason } : {}),
        };
      }
    },
  };
}

/**
 * ChatMessage → LlmMessage。
 *
 * 渲染路径只会产生 system / user / assistant；tool 消息本层不支持（映射成 user 会把
 * 工具结果伪装成用户发言，必须显式失败而不是静默降级）。
 */
export function toLlmMessages(messages: readonly ChatMessage[]): readonly LlmMessage[] {
  return messages.map((message) => {
    if (message.role === 'tool') throw new Error('LlmServiceChatCaller 不支持 tool 消息');
    return { role: message.role, content: flattenContent(message.content) };
  });
}

/** 多模态内容只取文本片段；渲染路径不会产生图片，非文本片段直接忽略。 */
function flattenContent(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text ?? '')
    .join('');
}

function truncate(text: string, max: number): string {
  const clean = text.replaceAll(/\s+/gu, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}
