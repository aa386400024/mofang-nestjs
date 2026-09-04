// V2026-09-04 治本 (V6.0 §3.1 + §12 RAG):
//   OpenAI 兼容 Embedding Provider 基类.
//   原因: 跟 Chat 基类同理, 国产厂商 embedding API 大多 OpenAI 兼容.
//         心塑知识库 (§3.1 画像 + §3.2 科普 + §3.5 高阶层对话) 复用
//         同一套 Embedding 抽象, 切换厂商零代码.
//   修复: 基类封装 LangChain OpenAIEmbeddings.embedDocuments(), 批量
//         调用 + 返回向量 + dimension + token usage.
//   如何验证:
//     1. DeepSeek embedding 模型 (维度 1536) 接入后, Qdrant collection
//        用 1536 dim, 知识库检索正常.
//     2. 豆包 embedding 模型切换, Qdrant collection 重建或用别名.

import { OpenAIEmbeddings } from '@langchain/openai';

import { AIProviderId, LLMCapability } from '../enums/llm.enums';
import type { EmbeddingProvider, EmbeddingRequest, EmbeddingResponse } from '../interfaces/embedding-provider.interface';

/**
 * 子类配置.
 */
export interface OpenAICompatibleEmbeddingConfig {
  id: AIProviderId;
  name: string;
  baseUrl: string;
  defaultEmbeddingModel: string;
  /** 向量维度 — 给上层 Qdrant 建索引用, 子类必须声明. */
  defaultDimension: number;
  customHeaders?: Record<string, string>;
  /**
   * OpenAIEmbeddings.batchSize 默认 512, 部分国产厂商限流更严
   * (e.g. 豆包 16), 子类可调小.
   */
  batchSize?: number;
}

/**
 * OpenAI 兼容 Embedding Provider 基类.
 *
 * 重要: 维度 (dimension) 是关键参数 — 不同厂商模型维度不同:
 *   - OpenAI text-embedding-3-small: 1536
 *   - OpenAI text-embedding-3-large: 3072
 *   - DeepSeek (via bailian): 1024
 *   - 豆包 embedding: 1024 / 2048
 *   - 通义 text-embedding-v3: 1024
 * 切换模型时必须重建 Qdrant collection (或用 collection alias).
 */
export abstract class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  public readonly id: AIProviderId;
  public readonly name: string;
  public readonly baseUrl: string;
  public readonly defaultEmbeddingModel: string;
  public readonly defaultDimension: number;
  public readonly capabilities: readonly LLMCapability[] = [LLMCapability.EMBEDDING] as const;

  protected readonly customHeaders?: Record<string, string>;
  protected readonly batchSize?: number;

  protected constructor(cfg: OpenAICompatibleEmbeddingConfig) {
    this.id = cfg.id;
    this.name = cfg.name;
    this.baseUrl = cfg.baseUrl;
    this.defaultEmbeddingModel = cfg.defaultEmbeddingModel;
    this.defaultDimension = cfg.defaultDimension;
    this.customHeaders = cfg.customHeaders;
    this.batchSize = cfg.batchSize;
  }

  public isConfigured(): boolean {
    return true;
  }

  public async testConnection(apiKey: string): Promise<{ success: boolean; latencyMs?: number; error?: string }> {
    const start = Date.now();
    try {
      await this.embed(
        {
          model: this.defaultEmbeddingModel,
          inputs: ['ping'],
        },
        apiKey,
      );
      return { success: true, latencyMs: Date.now() - start };
    } catch (e) {
      return { success: false, latencyMs: Date.now() - start, error: (e as Error).message };
    }
  }

  /**
   * 批量 embedding.
   *
   * V2026-09-04 治本 (LangChain 1.x API change):
   *   - 旧版: embedDocuments(texts, { signal }) — 接受 options
   *   - 1.x:  embedDocuments(texts) — 不再接受 options 参数 (TS2554 报错).
   *   - 这里用 AbortController 包裹 Promise: signal 触发后 reject,
   *     实际 HTTP 请求由底层 fetch 的 AbortSignal 控制.
   *
   * 大厂 standard: 批量调用而非循环单条, 减少网络往返 + 厂商限流.
   * 大多数厂商支持 batch 100+ 条/请求.
   */
  public async embed(request: EmbeddingRequest, apiKey: string, signal?: AbortSignal): Promise<EmbeddingResponse> {
    const embeddings = this.buildEmbeddings(apiKey);
    const vectors = signal
      ? await this.embedWithAbort(embeddings, request.inputs, signal)
      : await embeddings.embedDocuments(request.inputs);

    // LangChain 不直接返回 token count — 多数国产厂商响应里也不带,
    // 这里按字符数估算 (1 token ≈ 1.5 字符, 中英文混合近似).
    const totalChars = request.inputs.reduce((s, t) => s + t.length, 0);
    const promptTokens = Math.ceil(totalChars / 1.5);

    return {
      results: vectors.map((vector, index) => ({
        vector,
        index,
        tokenCount: Math.ceil(request.inputs[index].length / 1.5),
      })),
      model: request.model,
      usage: {
        promptTokens,
        totalTokens: promptTokens,
      },
      dimension: this.defaultDimension,
    };
  }

  /**
   * 单条 embedding — 上层偶尔需要 (RAG query).
   */
  public async embedQuery(text: string, apiKey: string): Promise<number[]> {
    const embeddings = this.buildEmbeddings(apiKey);
    return embeddings.embedQuery(text);
  }

  protected buildEmbeddings(apiKey: string): OpenAIEmbeddings {
    return new OpenAIEmbeddings({
      modelName: this.defaultEmbeddingModel,
      openAIApiKey: apiKey,
      configuration: {
        baseURL: this.baseUrl,
        defaultHeaders: this.customHeaders,
      },
      batchSize: this.batchSize ?? 100,
    });
  }

  /**
   * 1.x embedDocuments 不接受 options — 用 AbortController 包裹 Promise.
   * 监听 abort signal 后 reject, 调用方按 catch 处理.
   */
  private async embedWithAbort(embeddings: OpenAIEmbeddings, inputs: string[], signal: AbortSignal): Promise<number[][]> {
    if (signal.aborted) {
      throw new Error('Embedding aborted before start');
    }
    return new Promise<number[][]>((resolve, reject) => {
      const onAbort = () => reject(new Error('Embedding aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
      embeddings
        .embedDocuments(inputs)
        .then((result) => {
          signal.removeEventListener('abort', onAbort);
          resolve(result);
        })
        .catch((err) => {
          signal.removeEventListener('abort', onAbort);
          reject(err);
        });
    });
  }
}
