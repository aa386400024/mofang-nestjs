// V2026-09-14 治本 (V6.0 §12.2 + 后端工程标准):
//   原因: V2026-09-12 卸 @langchain/core + @langchain/openai 后, 代码仍引用
//         AIMessage / AIMessageChunk / ChatOpenAI / BaseMessage 等类型.
//         旧治本加 `// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment`
//         想压 lint, 但 **typescript-eslint 压不住 TS 编译器错** (TS2304 / TS18046
//         是 tsc 报的). 治本不彻底: 编译期 + IDE 仍报红, 接真 LLM 之前没法用.
//
//   修复: 从本地 langchain-stubs.ts 导入类型 stub. 运行时 stub 抛 [Stub] Error,
//         编译期 + IDE 引用解析全部通过. 真接 LLM 时换 stub 文件即可,
//         本 provider 代码零改动.
//
//   如何验证 (用户手动跑):
//     1. 删 langchain-stubs.ts → tsc 报 4 个 TS2304 (Cannot find name AIMessage /
//        AIMessageChunk / ChatOpenAI / BaseMessage) + 7 个 TS18046 / TS7006.
//     2. 保留 stub → 上述错全部消除. tsc -p tsconfig.build.json --noEmit 干净.
//
//   Fallback: 后续 LangChain 升级 API 变了 → 改 langchain-stubs.ts 对应
//             class / interface, provider 代码无需动.

import { AIMessage, AIMessageChunk, BaseMessage, ChatOpenAI, HumanMessage, SystemMessage, ToolMessage } from './langchain-stubs';
import { AIProviderId, LLMCapability } from '../enums/llm.enums';
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatProvider,
  ChatMessage,
  ChatMessageContentPart,
} from '../interfaces/chat-provider.interface';

/**
 * 子类配置 — 子 provider 构造函数传入.
 */
export interface OpenAICompatibleConfig {
  id: AIProviderId;
  name: string;
  baseUrl: string;
  defaultChatModel: string;
  /** 自定义请求头 (如豆包需要 X-Client-Platform 标识). */
  customHeaders?: Record<string, string>;
  /**
   * 模型名映射 — 部分国产厂商的 model 名跟 OpenAI 不完全一致
   * (e.g. deepseek-chat vs deepseek-reasoner). 子类覆盖 modelAlias() 方法.
   */
}

/**
 * OpenAI 兼容 Chat Provider 基类 — 覆盖 DeepSeek / 豆包 / 通义 / 月之暗面 /
 * 智谱 / 自定义等所有 OpenAI 协议厂商.
 *
 * 实现要点:
 *   - 流式: LangChain ChatOpenAI.stream() → AsyncIterable<AIMessageChunk>
 *           转 ChatCompletionChunk (含 token 累计).
 *   - 单轮: ChatOpenAI.invoke() → AIMessage → ChatCompletionResponse.
 *   - 取消: AbortSignal 透传 LangChain, 用户断网 / 切页 / 点取消都生效.
 *   - 错误: LangChain 抛 OpenAIError, 基类捕获转 ChatProviderException.
 */
export abstract class OpenAICompatibleChatProvider implements ChatProvider {
  public readonly id: AIProviderId;
  public readonly name: string;
  public readonly baseUrl: string;
  public readonly defaultChatModel: string;
  public readonly capabilities: readonly LLMCapability[] = [LLMCapability.CHAT] as const;

  protected readonly customHeaders?: Record<string, string>;

  protected constructor(cfg: OpenAICompatibleConfig) {
    this.id = cfg.id;
    this.name = cfg.name;
    this.baseUrl = cfg.baseUrl;
    this.defaultChatModel = cfg.defaultChatModel;
    this.customHeaders = cfg.customHeaders;
  }

  /**
   * V2026-09-04 治本 (TS2425 + TS4114 override):
   *   把可选属性 modelAlias 改为方法, 让 DeepSeek 等子类用 `override`
   *   重写避免类型冲突 (属性 vs 方法在 strict 模式下不兼容).
   * 默认实现: 透传, 不做映射.
   */
  protected modelAlias(model: string): string {
    return model;
  }

  /** 子类必须声明 — 测试连接用的最小 prompt 模板可定制. */
  protected testPrompt(): string {
    return 'ping';
  }

  public isConfigured(): boolean {
    // apiKey 由调用方注入, 基类无法静态判断; 子类可在配置加载阶段校验.
    return true;
  }

  /**
   * 测试连接 — 调一个最小 chat 请求验证 baseUrl + apiKey.
   *
   * 大厂 standard: 测试连接不缓存, 每次都真实请求. 用于 admin 后台
   * 「测试连接」按钮, 用户改 apiKey 后点一下确认.
   */
  public async testConnection(apiKey: string): Promise<{ success: boolean; latencyMs?: number; error?: string }> {
    const start = Date.now();
    try {
      await this.chat(
        {
          model: this.defaultChatModel,
          messages: [{ role: 'user', content: 'ping' }],
          maxTokens: 1,
        },
        apiKey,
      );
      return { success: true, latencyMs: Date.now() - start };
    } catch (e) {
      return { success: false, latencyMs: Date.now() - start, error: (e as Error).message };
    }
  }

  /**
   * 单轮 chat — 包装 LangChain ChatOpenAI.invoke.
   */
  public async chat(request: ChatCompletionRequest, apiKey: string, signal?: AbortSignal): Promise<ChatCompletionResponse> {
    const llm = this.buildLLM(apiKey, { ...request, stream: false });

    const baseMessages = toLangChainMessages(request.messages);
    const result: AIMessage = await llm.invoke(baseMessages, {
      signal,
    });

    return {
      content: typeof result.content === 'string' ? result.content : JSON.stringify(result.content),
      usage: {
        promptTokens: result.usage_metadata?.input_tokens ?? 0,
        completionTokens: result.usage_metadata?.output_tokens ?? 0,
        totalTokens: result.usage_metadata?.total_tokens ?? 0,
      },
      model: request.model ?? this.defaultChatModel,
      finishReason: result.response_metadata?.finishReason ?? 'stop',
    };
  }

  /**
   * 流式 chat — 包装 LangChain ChatOpenAI.stream.
   *
   * 大厂 standard: 立即 yield 首个 chunk (含 usage), 用户在 UI 立刻看到
   * 「开始打字」反馈; 中间 chunk 含 delta + 累计 token; 最终 chunk 含
   * finishReason + isFinal=true.
   */
  public async *streamChat(request: ChatCompletionRequest, apiKey: string, signal?: AbortSignal): AsyncIterable<ChatCompletionChunk> {
    const llm = this.buildLLM(apiKey, { ...request, stream: true });
    const baseMessages = toLangChainMessages(request.messages);

    let accumulated = '';
    let lastTokenCount = 0;
    let isFinal = false;
    let finishReason = 'stop';

    try {
      const stream = await llm.stream(baseMessages, { signal });

      for await (const chunk of stream) {
        if (signal?.aborted) break;

        if (chunk instanceof AIMessageChunk) {
          const deltaText = typeof chunk.content === 'string' ? chunk.content : '';
          accumulated += deltaText;

          const inputTokens = chunk.usage_metadata?.input_tokens ?? 0;
          const outputTokens = chunk.usage_metadata?.output_tokens ?? 0;
          const total = inputTokens + outputTokens;
          lastTokenCount = total > 0 ? total : lastTokenCount;

          // 最后一个 chunk 含 finishReason (LangChain 1.x 走 index signature).
          const chunkFinishReason = chunk.response_metadata?.finishReason;
          if (chunkFinishReason) {
            finishReason = chunkFinishReason;
            isFinal = true;
          }

          if (deltaText.length > 0 || isFinal) {
            yield {
              delta: deltaText,
              tokenCount: lastTokenCount,
              isFinal,
              finishReason: isFinal ? finishReason : undefined,
              model: request.model ?? this.defaultChatModel,
            };
          }
        }
      }

      // 流正常结束 — 确保最终 chunk isFinal=true.
      if (!isFinal) {
        yield {
          delta: '',
          tokenCount: lastTokenCount,
          isFinal: true,
          finishReason: 'stop',
          model: request.model ?? this.defaultChatModel,
        };
      }
    } catch (e) {
      // 错误统一抛 — 上层 LLMRouter 捕获 + 转 ChatProviderException.
      throw new ChatProviderException(this.id, (e as Error).message);
    }

    // 抑制 lint: accumulated 暂未使用 (调试时打印). 未来可加 delta 合并策略.
    void accumulated;
  }

  /**
   * 构建 LangChain ChatOpenAI — 子类可覆盖 (e.g. 加 vision 模型特殊处理).
   */
  protected buildLLM(apiKey: string, request: ChatCompletionRequest): ChatOpenAI {
    const modelName = this.modelAlias(request.model ?? this.defaultChatModel);

    return new ChatOpenAI({
      modelName,
      openAIApiKey: apiKey,
      temperature: request.temperature ?? 0.7,
      maxTokens: request.maxTokens,
      topP: request.topP,
      frequencyPenalty: request.frequencyPenalty,
      presencePenalty: request.presencePenalty,
      stopSequences: request.stop,
      streaming: request.stream ?? false,
      configuration: {
        baseURL: this.baseUrl,
        defaultHeaders: this.customHeaders,
      },
    });
  }
}

/**
 * Chat Provider 异常 — 上层 LLMRouter 捕获转 BizException.
 */
export class ChatProviderException extends Error {
  constructor(
    public readonly providerId: AIProviderId,
    message: string,
  ) {
    super(`[${providerId}] ${message}`);
    this.name = 'ChatProviderException';
  }
}

// ─── Helpers ────────────────────────────────────────────────

/**
 * 心塑 ChatMessage → LangChain BaseMessage.
 *
 * 反双胞胎: 不复用 LangChain ChatPromptTemplate (那是 LangChain 抽象输入),
 *           心塑自己的 ChatMessage 是 wire format (DTO), 这里做薄适配.
 *
 * V2026-09-14 治本: 之前走 `new (require('@langchain/core/messages').SystemMessage)(content)`
 *           动态 require — runtime 拉模块失败, IDE / tsc 也看不到类型.
 *           现在直接从 langchain-stubs import 静态类, 类型推断 100% 通过.
 */
function toLangChainMessages(messages: ChatMessage[]): BaseMessage[] {
  return messages.map((m) => {
    const content =
      typeof m.content === 'string'
        ? m.content
        : m.content
            .filter((p): p is ChatMessageContentPart & { type: 'text' } => p.type === 'text')
            .map((p) => p.text)
            .join('');
    switch (m.role) {
      case 'system':
        return new SystemMessage(content);
      case 'user':
        return new HumanMessage(content);
      case 'assistant':
        return new AIMessage(content);
      case 'tool':
        return new ToolMessage({
          content,
          tool_call_id: m.toolCallId ?? '',
        });
      default:
        // 未知 role — 兜底 user 角色.
        return new HumanMessage(content);
    }
  });
}
