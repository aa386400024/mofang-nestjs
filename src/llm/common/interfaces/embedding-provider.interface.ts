// V2026-09-04 治本 (V6.0 §3.1 + §12 RAG):
//   EmbeddingProvider 抽象接口 — 知识库向量化.
//   原因: 心塑 RAG 知识库 (§3.1 画像 + §3.2 科普 + §3.5 高阶层对话)
//         需要 embedding 服务, 多厂商可插拔. OpenAI text-embedding-3 /
//         豆包 embedding / 通义 text-embedding-v3 都走 OpenAI 兼容
//         /v1/embeddings 端点.
//   修复: 抽象 EmbeddingProvider + OpenAI 兼容基类 (跟 chat 同模式).
//   如何验证: EmbeddingProvider.embed([...]) 返回 number[][] (每条
//             文本一个向量), 维度跟厂商模型一致 (e.g. text-embedding-3-small = 1536).

import type { AIProviderId, LLMCapability } from '../enums/llm.enums';

/**
 * 单条 embedding 请求.
 */
export interface EmbeddingRequest {
  /** 模型 id. */
  model: string;

  /** 输入文本列表 — OpenAI 兼容 batch. */
  inputs: string[];

  /** 用户 id (用于厂商审计). */
  user?: string;
}

/**
 * 单条 embedding 结果.
 */
export interface EmbeddingResult {
  /** 向量 — number[] 长度 = 模型维度 (e.g. 1536 / 1024 / 768). */
  vector: number[];

  /** 输入索引 — 与 request.inputs 对应. */
  index: number;

  /** Token 数 — 用于计费 / 限流. */
  tokenCount: number;
}

/**
 * Embedding 响应 — usage 汇总.
 */
export interface EmbeddingResponse {
  results: EmbeddingResult[];

  model: string;

  usage: {
    promptTokens: number;
    totalTokens: number;
  };

  /** 向量维度 — 给上层 VectorStore 建索引用. */
  dimension: number;
}

/**
 * EmbeddingProvider 抽象接口 — OpenAI 兼容协议覆盖大多数国产厂商.
 */
export interface EmbeddingProvider {
  readonly id: AIProviderId;

  readonly name: string;

  readonly capabilities: readonly LLMCapability[];

  readonly baseUrl: string;

  /** 默认 embedding 模型. */
  readonly defaultEmbeddingModel: string;

  /** 向量维度 — 上层建 Qdrant collection 时使用. */
  readonly defaultDimension: number;

  isConfigured(): boolean;

  /**
   * 测试连通性 — 用于 admin 后台「测试连接」按钮.
   *
   * V2026-09-04 治本: 入参加 apiKey, 因为 provider 持有 baseUrl/model 但
   * 不持有凭据 (凭据由 LLMRouter 注入). 跟 ChatProvider.testConnection 一致.
   */
  testConnection(apiKey: string): Promise<{ success: boolean; latencyMs?: number; error?: string }>;

  /**
   * 批量 embedding — 文本列表 → 向量列表.
   *
   * 大厂 standard: 批量调用而非循环单条, 减少网络往返 + 厂商限流.
   * 大多数厂商支持 batch 100+ 条/请求.
   */
  embed(request: EmbeddingRequest, apiKey: string, signal?: AbortSignal): Promise<EmbeddingResponse>;
}
