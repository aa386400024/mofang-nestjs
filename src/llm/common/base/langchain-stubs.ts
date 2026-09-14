// V2026-09-14 治本 (V6.0 §12.2 + 后端工程标准):
//   原因: V2026-09-12 团队卸了 @langchain/core + @langchain/openai 包, runtime
//         用 stub 让 onModuleInit 不 crash. 但 chat / embedding provider 仍
//         引用 AIMessage / AIMessageChunk / ChatOpenAI / BaseMessage /
//         OpenAIEmbeddings 等类型 — 包不在, TS 编译器直接报
//         TS2304 (Cannot find name) / TS18046 (X is of type 'unknown') /
//         TS7006 (Parameter implicitly has an 'any' type).
//         团队用 `// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment`
//         注释压 lint — 但 typescript-eslint 只能压它自己的规则, **压不住
//         TS 编译器错** (TS-prefix codes 是 tsc 报的, 不是 eslint).
//         旧治本不彻底: 本文件补齐.
//
//   修复: 提供跟实际使用面 1:1 对齐的最小类型 stub, 让 TS 编译器 + IDE 引用解析通过.
//         真接 LLM 时把本文件整体替换为:
//           import { AIMessage, AIMessageChunk, BaseMessage,
//                    ChatOpenAI, OpenAIEmbeddings } from '@langchain/core';
//         + ChatOpenAI / OpenAIEmbeddings 从 '@langchain/openai' 单独 import
//         (不破坏 provider 调用面 — 调用签名 1:1 兼容).
//
//   如何验证 (用户手动跑, 不代跑):
//     1. 删除本文件 → tsc -p tsconfig.build.json --noEmit 报 5+6+4=15 个
//        TS2304 / TS18046 / TS7006 错 (跟修复前同).
//     2. 保留本文件 → 上述错全部消除.
//     3. 真接 LLM 时删除本文件 + npm install @langchain/core @langchain/openai,
//        provider 代码 (openai-compatible-chat.provider.ts / -embedding.provider.ts)
//        零改动.
//
//   Fallback: 本 stub 覆盖不全 (后续 LangChain API 变化加新类型) → 用户
//             报哪个类型错就在本文件补哪个 class / interface.
//
//   Runtime 行为约定 (重要 — 别只看编译报错忽略):
//     - ChatOpenAI.invoke / .stream → 抛 [Stub] Error, 提示装 @langchain/openai.
//     - OpenAIEmbeddings.embedDocuments / .embedQuery → 同样抛.
//     - 构造函数不抛 (跟 V2026-09-12 Qdrant stub 一致风格 — instantiate
//       阶段不 crash, 真正调用 API 才抛清晰错误).

// ═══════════════════════════════════════════════════════════════════════
// BaseMessage 体系 — SystemMessage / HumanMessage / AIMessage / ToolMessage
// ═══════════════════════════════════════════════════════════════════════

/// LangChain BaseMessage 基类.
/// provider `toLangChainMessages()` 把心塑 ChatMessage 转 BaseMessage 子类.
export abstract class BaseMessage {
  abstract readonly content: string | readonly unknown[];
  readonly type: string;

  constructor(type: string) {
    this.type = type;
  }
}

export class SystemMessage extends BaseMessage {
  override readonly content: string;

  constructor(content: string) {
    super('system');
    this.content = content;
  }
}

export class HumanMessage extends BaseMessage {
  override readonly content: string;

  constructor(content: string) {
    super('human');
    this.content = content;
  }
}

export class AIMessage extends BaseMessage {
  override readonly content: string | unknown[];

  /// LangChain 1.x: usage_metadata 包含 token 计数 (input/output/total).
  readonly usage_metadata?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };

  /// LangChain 1.x: response_metadata 包含 finishReason 等 index signature.
  /// provider 用 `(result.response_metadata?.finishReason as string)` 读,
  /// 所以 [key: string]: unknown 让它能正确 narrow.
  readonly response_metadata?: {
    finishReason?: string;
    [key: string]: unknown;
  };

  constructor(content: string | unknown[]) {
    super('ai');
    this.content = content;
  }
}

export class ToolMessage extends BaseMessage {
  override readonly content: string;

  /// LangChain ToolMessage 用 tool_call_id 字段 (不是 tool_call_id 构造参数).
  readonly tool_call_id: string;

  /// LangChain 1.x ToolMessage 接受对象参数 { content, tool_call_id }.
  constructor(args: { content: string; tool_call_id: string }) {
    super('tool');
    this.content = args.content;
    this.tool_call_id = args.tool_call_id;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// AIMessageChunk — 流式响应增量. AIMessage 子类, 字段对齐.
// ═══════════════════════════════════════════════════════════════════════

export class AIMessageChunk extends AIMessage {
  // 不加额外字段, 复用 AIMessage 的 content / usage_metadata / response_metadata.
  // provider 流式分支只读 chunk.content + chunk.usage_metadata + chunk.response_metadata,
  // AIMessage 基类已覆盖.
}

// ═══════════════════════════════════════════════════════════════════════
// ChatOpenAI — provider buildLLM() 用. Runtime invoke/stream 抛 [Stub] 错.
// ═══════════════════════════════════════════════════════════════════════

/// LangChain ChatOpenAI 配置项 — provider buildLLM() 完整用上.
/// 真接 LLM 时替换为 `import { ChatOpenAI } from '@langchain/openai'`,
/// 字段名跟 LangChain 1.x 完全一致 (modelName / openAIApiKey / temperature /
/// maxTokens / topP / frequencyPenalty / presencePenalty / stopSequences /
/// streaming / configuration.baseURL / configuration.defaultHeaders).
export interface ChatOpenAIConfig {
  modelName: string;
  openAIApiKey: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
  streaming?: boolean;
  configuration?: {
    baseURL?: string;
    defaultHeaders?: Record<string, string>;
  };
}

/// Stub ChatOpenAI — compile-only. 真接 LLM 时替换.
/// Runtime 行为: 构造函数不抛 (跟 Qdrant stub 一致), invoke/stream 抛 [Stub] 错.
export class ChatOpenAI {
  // V2026-09-14: 前缀 _ 表示「忽略参数」, 但 LangChain 真实构造会读这些,
  // 这里留着便于后续无痛替换为真 import. 不显式赋字段 — TS 严格模式
  // noUnusedParameters 不会扫构造参数 (函数签名只检查字段引用).
  constructor(_config: ChatOpenAIConfig) {
    // 不抛: 让 buildLLM() 能正常返回实例, 真正 invoke/stream 才抛.
  }

  /// 单轮调用 — runtime 抛 [Stub] 错.
  async invoke(_messages: BaseMessage[], _options?: { signal?: AbortSignal }): Promise<AIMessage> {
    throw new Error(
      '[Stub] ChatOpenAI.invoke requires @langchain/openai. ' + 'Install: pnpm add @langchain/openai, then replace this stub file.',
    );
  }

  /// 流式调用 — runtime 抛 [Stub] 错.
  async stream(_messages: BaseMessage[], _options?: { signal?: AbortSignal }): Promise<AsyncIterable<AIMessageChunk>> {
    throw new Error(
      '[Stub] ChatOpenAI.stream requires @langchain/openai. ' + 'Install: pnpm add @langchain/openai, then replace this stub file.',
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════
// OpenAIEmbeddings — provider buildEmbeddings() / embedWithAbort() 用.
// ═══════════════════════════════════════════════════════════════════════

/// OpenAIEmbeddings 专用配置 — V2026-09-14 治本 (TS2353 'batchSize' does not exist):
///   原因: 之前 OpenAIEmbeddings 构造函数复用 ChatOpenAIConfig 类型, 但 LangChain
///         真实 OpenAIEmbeddings constructor 额外接受 batchSize (默认 512, 部分
///         国产厂商限流更严, provider 暴露 batchSize? 字段让子类调).
///         provider 调 `new OpenAIEmbeddings({ ..., batchSize: this.batchSize ?? 100 })`
///         时 tsc 报 TS2353: 'batchSize' does not exist in type 'ChatOpenAIConfig'.
///   修复: 拆出 OpenAIEmbeddingsConfig 接口 (extends ChatOpenAIConfig + batchSize),
///         各自类型各自清晰, 不污染 chat config 语义.
///   如何验证 (用户手动跑):
///     1. 把 OpenAIEmbeddingsConfig 改成 `extends {}` (断继承) → tsc 报 TS2353.
///     2. 保留 extends ChatOpenAIConfig → TS2353 消除.
///   Fallback: 后续 LangChain 升级加新字段 (e.g. encodingFormat) → 加到
///             OpenAIEmbeddingsConfig 即可, provider 代码不动.
/// 真接 LLM 时 LangChain 真实 OpenAIEmbeddingsParams extends EmbeddingsParams,
/// 这里用最小子集覆盖实际用到的字段.
export interface OpenAIEmbeddingsConfig extends ChatOpenAIConfig {
  batchSize?: number;
}

/// Stub OpenAIEmbeddings — compile-only. 字段名跟 LangChain 1.x 对齐.
/// 真接 LLM 时替换为 `import { OpenAIEmbeddings } from '@langchain/openai'`.
export class OpenAIEmbeddings {
  constructor(_config: OpenAIEmbeddingsConfig) {
    // 不抛: 让 buildEmbeddings() 能正常返回实例.
  }

  /// 批量 embedding — runtime 抛 [Stub] 错.
  async embedDocuments(_inputs: string[]): Promise<number[][]> {
    throw new Error(
      '[Stub] OpenAIEmbeddings.embedDocuments requires @langchain/openai. ' +
        'Install: pnpm add @langchain/openai, then replace this stub file.',
    );
  }

  /// 单条 embedding — runtime 抛 [Stub] 错.
  async embedQuery(_input: string): Promise<number[]> {
    throw new Error(
      '[Stub] OpenAIEmbeddings.embedQuery requires @langchain/openai. ' +
        'Install: pnpm add @langchain/openai, then replace this stub file.',
    );
  }
}
