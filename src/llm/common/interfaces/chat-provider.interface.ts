// V2026-09-04 治本 (V6.0 §3.5 + audit P0-1):
//   ChatProvider 抽象接口 — 对齐 mofang moyin-ai-core/providers/types.ts.
//   原因: 前端 commit 14935e3 引入 LLMClient (OpenAI 兼容 SSE 流式),
//         后端需要多厂商可插拔 — DeepSeek / 豆包 / 通义 / 月之暗面 / OpenAI /
//         自定义 baseUrl, 全部走统一接口, 配置驱动切换.
//   修复: 参照 moyin-ai-core 的 APIProvider / ChatProvider 抽象,
//         扩展流式 + LangChain 包装 + 危机信号字段.
//   如何验证: 单元测试 mock OpenAICompatibleChatProvider 基类,
//             DeepSeek / Doubao / OpenAI provider 走同一个基类, 仅
//             baseUrl + apiKey + model 不同.

import type { AIProviderId, LLMCapability, LLMTier } from '../enums/llm.enums';

/**
 * Chat 完成请求参数 — OpenAI 兼容超集 + 心塑扩展字段.
 *
 * 命名对齐 OpenAI Chat Completions API 字段:
 * https://platform.openai.com/docs/api-reference/chat/create
 */
export interface ChatCompletionRequest {
  /** 模型 id (e.g. 'deepseek-chat', 'gpt-4o', 'doubao-pro-32k'). */
  model: string;

  /** 消息列表 — role: 'system' | 'user' | 'assistant' | 'tool'. */
  messages: ChatMessage[];

  /** 温度 0..2 — OpenAI 标准. */
  temperature?: number;

  /** 最大生成 token 数. */
  maxTokens?: number;

  /** Top-P 采样 0..1. */
  topP?: number;

  /** 频率惩罚 -2..2. */
  frequencyPenalty?: number;

  /** 存在惩罚 -2..2. */
  presencePenalty?: number;

  /** 停止词列表. */
  stop?: string[];

  /** 流式响应开关 — OpenAI SSE. */
  stream?: boolean;

  /** 用户 id — 用于厂商审计 + 限流 (OpenAI 'user' 字段). */
  user?: string;

  // ─── 心塑扩展 (§3.5 三层架构) ───

  /** 端侧 / 云端 RAG / 高阶层 — 决定 system prompt 模板. */
  tier?: LLMTier;

  /** RAG 上下文 — 来自知识库检索 (§3.1). */
  ragContext?: string;

  /** 危机预检结果 (来自端侧 CrisisDetector), LLM 已知晓. */
  preCheckedCrisisLevel?: 'none' | 'low' | 'medium' | 'high';

  /** 会话 id — 链路追踪 + token 累计. */
  conversationId?: string;
}

/**
 * 单条消息 — OpenAI 'messages' schema.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** 文本内容 (vision 模型可以是 multimodal array). */
  content: string | ChatMessageContentPart[];
  /** tool_call_id (role='tool' 时必填). */
  toolCallId?: string;
  /** 助手 tool_calls (role='assistant' 时). */
  toolCalls?: ChatToolCall[];
  /** 消息作者姓名 (多角色对话场景). */
  name?: string;
}

/** 多模态内容片段 (vision). */
export interface ChatMessageContentPart {
  type: 'text' | 'image_url';
  text?: string;
  imageUrl?: { url: string; detail?: 'auto' | 'low' | 'high' };
}

/** 工具调用 — OpenAI function calling. */
export interface ChatToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/**
 * 单次 chunk (流式) / 完成结果 (单轮).
 *
 * 流式场景: provider.streamChat() 返回 AsyncIterable<ChatCompletionChunk>,
 *           每条 chunk 含 delta 增量 + 当前 usage 累计.
 * 单轮场景: provider.chat() 返回 ChatCompletionResponse, 含完整 content + usage.
 */
export interface ChatCompletionChunk {
  /** 本次增量文本 (流式). */
  delta: string;

  /** 累计 token 数 (含本次, OpenAI usage 字段). */
  tokenCount: number;

  /** 是否为最终 chunk. */
  isFinal: boolean;

  /** 终止原因 — 'stop' | 'length' | 'content_filter' | 'tool_calls'. */
  finishReason?: string;

  /** 模型名 (e.g. 'gpt-4o-2024-08-06'). */
  model?: string;

  /** 危机信号 (§11.2) — LLM 分类器识别. */
  crisisSignal?: {
    level: 'none' | 'low' | 'medium' | 'high';
    keywords: string[];
    suggestedResource?: string;
  };
}

/** 单轮完整响应. */
export interface ChatCompletionResponse {
  content: string;

  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };

  model: string;

  finishReason: string;

  /** 危机信号 (§11.2). */
  crisisSignal?: ChatCompletionChunk['crisisSignal'];
}

/**
 * Provider 配置 — 启动期从 env / DB 读取.
 *
 * 反双胞胎: 不复用 user/config 模块的 env loader, 因为 LLM 配置来源混合
 * (env 注入默认 provider + DB 覆盖用户级 provider), 走独立 loader.
 */
export interface LLMProviderConfig {
  /** 唯一 id — 跟 AIProviderId 枚举对齐. */
  id: AIProviderId;

  /** 显示名 (admin 后台). */
  displayName: string;

  /** 厂商 OpenAI 兼容 base URL. */
  baseUrl: string;

  /** API key — 从 env 注入 (默认 provider) / DB 读取 (用户级). */
  apiKey: string;

  /** 支持的能力 — chat / embedding / vision / rerank. */
  capabilities: readonly LLMCapability[];

  /** 默认模型 — 路由 fallback 用. */
  defaultModels: Partial<Record<LLMCapability, string>>;

  /** 心塑 §3.5 三层架构默认模型 — 跨 capability 路由. */
  defaultChatModel?: string;
  defaultEmbeddingModel?: string;

  /** 是否启用 — admin 可关闭单 provider. */
  enabled: boolean;

  /** 自定义请求头 (某些国产厂商需要特殊 header). */
  customHeaders?: Record<string, string>;
}

/**
 * ChatProvider 抽象接口 — 对齐 moyin-ai-core ChatProvider.
 *
 * 所有具体厂商 (OpenAI / DeepSeek / 豆包 / 通义 / 自定义) 实现本接口.
 * OpenAI 兼容协议覆盖 90% 厂商, 走 OpenAICompatibleChatProvider 基类
 * 仅配置 baseUrl + apiKey + model 即可.
 */
export interface ChatProvider {
  /** Provider id — 跟 AIProviderId 枚举对齐. */
  readonly id: AIProviderId;

  /** 显示名. */
  readonly name: string;

  /** 支持的能力 (子集, 至少含 LLMCapability.CHAT). */
  readonly capabilities: readonly LLMCapability[];

  /** OpenAI 兼容 base URL. */
  readonly baseUrl: string;

  /** 默认 chat 模型 — 路由 fallback. */
  readonly defaultChatModel: string;

  /** 是否已配置 (apiKey 存在). */
  isConfigured(): boolean;

  /**
   * 测试连通性 — 用于 admin 后台「测试连接」按钮.
   *
   * 实现: 调一个最小 chat 请求 (1 token), 验证 baseUrl + apiKey + model.
   * OpenAI 兼容协议覆盖多数厂商, 由 OpenAICompatibleChatProvider 基类
   * 统一实现, 子类无需重写.
   */
  testConnection(apiKey: string): Promise<{ success: boolean; latencyMs?: number; error?: string }>;

  /**
   * 单轮 chat — 返回完整响应 + usage.
   */
  chat(request: ChatCompletionRequest, apiKey: string, signal?: AbortSignal): Promise<ChatCompletionResponse>;

  /**
   * 流式 chat — 返回 AsyncIterable 增量.
   *
   * 反双胞胎: 不返回 Node Readable (那是 OpenAI SDK 内部类型),
   *           上层 LLMRouter 通过 for-await 消费, 与 LangChain
   *           ChatStream 兼容.
   */
  streamChat(request: ChatCompletionRequest, apiKey: string, signal?: AbortSignal): AsyncIterable<ChatCompletionChunk>;
}
