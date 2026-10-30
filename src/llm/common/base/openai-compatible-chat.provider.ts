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

// V2026-10-14 治本 (VS-3a 装包 + 修 stub — LangChain stub 治本):
//   原因: V0.5 (V2026-09-12 卸 @langchain/core + @langchain/openai) 装 langchain-stubs.ts
//     临时 stub, 4 OpenAI 兼容 provider (DeepSeek / Doubao / Qwen / Custom) 调 invoke/stream
//     抛 [Stub] Error. B4 #4 报 "non-functional stub", 任何走 LlmOrchestrator 调用
//     (含 ai-profile 持久化 / ai-recommend / ai-effect / RAG) 真接 LLM 会失败.
//   修法: 删 langchain-stubs.ts (决策 #4), 改本文件 + openai-compatible-embedding.provider.ts
//     改 import 真 LangChain 包. provider 业务代码 0 改动 (签名 1:1 兼容, V0.5
//     langchain-stubs.ts 注释明示 "真接 LLM 时换 stub 文件即可, provider 代码零改动").
//   反双胞胎: 不在 provider 写 try/catch fallback (V0.5 stub 治本不彻底原因), 装包后
//     真接 LangChain, Runtime 调 invoke/stream 返真 AIMessage (不再是 stub Error).
//   验证 (大炮装包后跑):
//     1. pnpm add @langchain/core @langchain/openai (装包命令见 src/llm/README.md)
//     2. pnpm build 0 错 + npx tsc -p tsconfig.build.json --noEmit 0 错
//     3. 启动后 GET /llm/providers 返 4 provider (deepseek/doubao/qwen/custom), 0 warn
//   时间戳: 2026-10-14 11:35 GMT+8.
// V2026-10-14 治本 (VS-3a — LangChain 1.x import 路径):
//   原因: LangChain 0.3+ 把 AIMessage/BaseMessage 等 message 类从 '@langchain/core' 移到
//     '@langchain/core/messages' subpath. 装包后 6 个 TS2305 "has no exported member".
//     V0.5 langchain-stubs.ts 注释说 "provider 代码零改动" 是错的, LangChain 1.x
//     真实 API 跟 stub 1:1 但 import 路径变了.
//   修法: import 路径加 /messages. 6 个 TS2305 治本, provider 业务代码 0 改动.
import { AIMessage, AIMessageChunk, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { AIProviderId, LLMCapability } from '../enums/llm.enums';
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatProvider,
  ChatMessage,
  ChatMessageContentPart,
  ChatReasoningEffort,
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
        // V2026-10-29 治本 (WP9-C): 思考 token 单独上报 (LangChain 把上游
        //   completion_tokens_details.reasoning_tokens 归一到 output_token_details.reasoning).
        ...(typeof result.usage_metadata?.output_token_details?.reasoning === 'number'
          ? { reasoningTokens: result.usage_metadata.output_token_details.reasoning }
          : {}),
      },
      model: request.model ?? this.defaultChatModel,
      // V2026-10-29 治本 (WP9-C — finish_reason 此前**一直读不到**):
      //   LangChain 1.x 把上游 `finish_reason` 放进 `response_metadata` 时**用的是 snake_case**
      //   (见 @langchain/openai completions.js: `generationInfo.finish_reason = choice.finish_reason`),
      //   而这里原来读的是 `['finishReason']` (camel) —— 永远取不到, 于是**每一次非流式调用
      //   的 finishReason 都恒为 'stop'**. 后果: 上游因长度上限截断 (`finish_reason=length`)
      //   这件事, 上层**完全看不见** —— 渲染层的截断保护无从触发 (任务单 §2.2).
      //   现在两个键都读 (snake 为主, camel 兜底), 截断信号才真正到得了上层.
      finishReason: readFinishReason(result.response_metadata) ?? 'stop',
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
    const usage = createStreamUsageState();
    let isFinal = false;
    let finishReason = 'stop';

    try {
      const stream = await llm.stream(baseMessages, { signal });

      for await (const chunk of stream) {
        if (signal?.aborted) break;

        if (chunk instanceof AIMessageChunk) {
          const deltaText = typeof chunk.content === 'string' ? chunk.content : '';
          accumulated += deltaText;

          applyChunkUsage(usage, chunk);

          // V2026-10-14 治本 (VS-3a — LangChain 1.x response_metadata index signature):
          //   原因: LangChain 1.x response_metadata 改为 { [key: string]: unknown }, 不能
          //     直接 dot access. 装包后 2 个 TS4111 + 1 个 TS2322.
          //          修法: 改 ?.['finishReason'] (index signature 访问) + cast string. V0.5 stub
          //     注释说 "finishReason 字段", 但真实 LangChain 1.x 走 index signature.
          //     2 个错治本 (finishReason 读取 + 类型).
          // V2026-10-29 治本 (WP9-C): 键名修正 —— LangChain 实际写的是 snake_case
          //   `finish_reason`, 原来只读 camel 的 `finishReason` → 截断信号永远收不到.
          const chunkFinishReason = readFinishReason(chunk.response_metadata);
          if (chunkFinishReason) {
            finishReason = chunkFinishReason;
            isFinal = true;
          }

          if (deltaText.length > 0 || isFinal) {
            yield buildStreamChunk({
              delta: deltaText,
              tokenCount: usage.tokenCount,
              isFinal,
              finishReason: isFinal ? finishReason : undefined,
              model: request.model ?? this.defaultChatModel,
              reasoningTokens: usage.reasoningTokens,
            });
          }
        }
      }

      // 流正常结束 — 确保最终 chunk isFinal=true.
      if (!isFinal) {
        yield buildStreamChunk({
          delta: '',
          tokenCount: usage.tokenCount,
          isFinal: true,
          finishReason: 'stop',
          model: request.model ?? this.defaultChatModel,
          reasoningTokens: usage.reasoningTokens,
        });
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
    const overrides = this.buildRequestOverrides(request);

    return new ChatOpenAI({
      modelName,
      // V2026-10-28 治本 (LangChain 1.x 凭据字段名 — 存量缺陷, 一次修好全部 OpenAI 兼容 provider):
      //   `@langchain/openai` 1.x 的 BaseChatOpenAI 取凭据只有这一条链:
      //     this.apiKey = fields?.apiKey ?? fields?.configuration?.apiKey ?? env OPENAI_API_KEY
      //   旧的 `openAIApiKey` 在 **chat 模型上根本不被读取** (只有 embedding / LLM 类还认它),
      //   所以只传 `openAIApiKey` = 客户端拿不到任何凭据, 调用直接报
      //   "Missing credentials. Please pass an `apiKey` ... or set the `OPENAI_API_KEY`".
      //   症状极隐蔽: 注册/构造/配置全对, 只有真正发请求时才炸, 且错误信息指向
      //   OPENAI_API_KEY (一个本项目根本不用的变量名), 极易误判成"key 没配".
      //   本机此前没有任何 LLM_*_API_KEY, 这条路径从未被真正跑通, 缺陷一直没暴露.
      //   两个字段都传: `apiKey` 是 1.x 的真字段 (生效), `openAIApiKey` 留给 0.x 兼容 (被忽略也无害).
      apiKey,
      openAIApiKey: apiKey,
      temperature: request.temperature ?? 0.7,
      topP: request.topP,
      frequencyPenalty: request.frequencyPenalty,
      presencePenalty: request.presencePenalty,
      stopSequences: request.stop,
      streaming: request.stream ?? false,
      // V2026-10-29 治本 (WP9-C · 生成长度上限 + 思考强度的厂商字段映射):
      //   上限与思考强度走 `buildRequestOverrides` 钩子, 由**子类**决定下发哪个上游字段 ——
      //   基类给 OpenAI 兼容通用口径 (LangChain 自己决定 max_tokens / max_completion_tokens),
      //   MiniMax 子类改成只下发新字段 (thinking token 计入上限, 旧字段会把输出挤没).
      ...(overrides.maxTokens === undefined ? {} : { maxTokens: overrides.maxTokens }),
      ...(overrides.reasoningEffort === undefined ? {} : { reasoningEffort: overrides.reasoningEffort }),
      ...(overrides.modelKwargs === undefined ? {} : { modelKwargs: overrides.modelKwargs }),
      configuration: {
        baseURL: this.baseUrl,
        defaultHeaders: this.customHeaders,
      },
    });
  }

  /**
   * 生成长度上限 / 思考强度的**上游字段映射** (可覆盖).
   *
   * 为什么做成钩子而不是在基类里写死:
   *   "生成长度上限用哪个字段" 是**厂商协议差异**, 不是抽象层能替所有人决定的.
   *   - 国产 OpenAI 兼容厂商 (deepseek / qwen / doubao) 只认 `max_tokens`;
   *   - MiniMax M3.1-Flash 的思考 token **计入**长度上限, 官方口径是 `max_completion_tokens`;
   *   - OpenAI 自家的推理模型 (o1 / gpt-5) 也只认 `max_completion_tokens`.
   *   在基类里写死任何一种, 都是把某一家的协议焊死在所有厂商身上.
   *
   * 反双胞胎:
   *   - `maxTokens` 与 `maxCompletionTokens` **只取其一** (请求里两个都带 = 上游按哪个截断不可控);
   *   - 思考强度同理: 只在调用方显式给了才下发 (上游不支持的模型传了会 400).
   *
   * @param request 调用方请求
   * @returns LangChain 构造参数里的上限 / 思考强度 / 额外上游字段
   */
  protected buildRequestOverrides(request: ChatCompletionRequest): {
    readonly maxTokens?: number;
    readonly reasoningEffort?: ChatReasoningEffort;
    readonly modelKwargs?: Record<string, unknown>;
  } {
    const limit = request.maxCompletionTokens ?? request.maxTokens;
    return {
      ...(limit === undefined ? {} : { maxTokens: limit }),
      ...(request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort }),
    };
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
 * 流式用量状态 (累计 token 总数 + 思考 token).
 *
 * 为什么要独立成结构: 流式方法里"读 usage / 判断有无 / 写回"三段如果内联,
 * 方法复杂度会顶到仓库红线 (complexity 20 / cognitive 25) —— 而这些分支本身
 * 是**纯数据搬运**, 抽出来既降复杂度, 又让"思考 token 单独上报"这件事只有一个落点.
 */
interface StreamUsageState {
  /** 累计 token 数 (含本次). */
  tokenCount: number;
  /** 思考 token 数 (推理模型才有). */
  reasoningTokens?: number;
}

/** 新建一份空的流式用量状态. */
function createStreamUsageState(): StreamUsageState {
  return { tokenCount: 0 };
}

/**
 * 把一个 chunk 的 usage 归到状态里 (累计口径, 与既有 tokenCount 行为一致).
 *
 * @param state 用量状态 (原地更新)
 * @param chunk LangChain chunk
 */
function applyChunkUsage(state: StreamUsageState, chunk: AIMessageChunk): void {
  const inputTokens = chunk.usage_metadata?.input_tokens ?? 0;
  const outputTokens = chunk.usage_metadata?.output_tokens ?? 0;
  const total = inputTokens + outputTokens;
  if (total > 0) {
    state.tokenCount = total;
  }
  const reasoning = chunk.usage_metadata?.output_token_details?.reasoning;
  if (typeof reasoning === 'number') {
    state.reasoningTokens = reasoning;
  }
}

/**
 * 构造一条流式 chunk (把"可能没有的字段"收在一处).
 *
 * @param params chunk 内容
 * @returns 流式 chunk
 */
function buildStreamChunk(params: {
  readonly delta: string;
  readonly tokenCount: number;
  readonly isFinal: boolean;
  readonly finishReason?: string;
  readonly model: string;
  readonly reasoningTokens?: number;
}): ChatCompletionChunk {
  return {
    delta: params.delta,
    tokenCount: params.tokenCount,
    isFinal: params.isFinal,
    ...(params.finishReason === undefined ? {} : { finishReason: params.finishReason }),
    model: params.model,
    ...(params.reasoningTokens === undefined ? {} : { reasoningTokens: params.reasoningTokens }),
  };
}

/**
 * 从 LangChain 的 `response_metadata` 里取上游终止原因 (finish_reason).
 *
 * V2026-10-29 治本 (WP9-C): **两个键都读** ——
 *   - `finish_reason` (snake): LangChain 1.x 实际写入的键
 *     (@langchain/openai completions.js: `generationInfo.finish_reason = choice.finish_reason`);
 *   - `finishReason` (camel): 老版本 / stub 用的键, 留作兼容.
 *
 * 为什么必须修: 原来只读 camel 键 → 取不到 → `finishReason` 恒为 `'stop'` →
 * 上游因长度上限截断 (`length`) 这件事上层完全看不见, 渲染层的截断保护无从触发.
 *
 * @param metadata LangChain response_metadata (index signature, 不能 dot access)
 * @returns 终止原因; 没有则 undefined
 */
function readFinishReason(metadata: Record<string, unknown> | undefined): string | undefined {
  const raw = metadata?.['finish_reason'] ?? metadata?.['finishReason'];
  return typeof raw === 'string' ? raw : undefined;
}

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
