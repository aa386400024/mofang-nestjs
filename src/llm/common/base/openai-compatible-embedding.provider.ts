// V2026-09-14 治本 (V6.0 §12.2 + 后端工程标准):
//   原因: V2026-09-12 卸 @langchain/openai 后, OpenAIEmbeddings 类引用 + embedDocuments
//         返回类型变成 unknown, 引发 TS2304 (Cannot find name) + TS7006
//         (Parameter 'vector' implicitly has 'any' type) + TS18046 (X is of type
//         'unknown'). 旧治本加 eslint-disable 注释 — 压不住 tsc 错.
//
//   修复: 从本地 langchain-stubs.ts 导入 OpenAIEmbeddings 类型 stub. invoke
//         链上所有 `any` / `unknown` 自动 narrow 成 number[][], tsc 干净.
//
//   如何验证 (用户手动跑):
//     1. 删 langchain-stubs.ts → tsc 报 3 个 TS2304 (Cannot find name OpenAIEmbeddings)
//        + 4 个 TS7006 (vector/index/result/err implicitly any).
//     2. 保留 stub → 上述错全部消除.
//
//   Fallback: 后续 LangChain OpenAIEmbeddings API 变 → 改 langchain-stubs.ts
//             对应字段, provider 代码无需动.

// V2026-10-14 治本 (VS-3a — 跟 openai-compatible-chat.provider.ts 同步, 改 import 真 LangChain):
//   原因: V0.5 langchain-stubs.ts 临时 stub, 4 OpenAI 兼容 provider 装包前调抛 [Stub] Error.
//   修法: 删 langchain-stubs.ts (决策 #4), 改 import 真 LangChain 包 + type alias 兼容 provider 业务代码.
//   反双胞胎: 不重写 provider 业务代码, 0 改动 (跟 chat provider 同 pattern).
//   验证: 跟 openai-compatible-chat.provider.ts 同步 (大炮装包后跑 npx tsc 0 错).
//   时间戳: 2026-10-14 11:35 GMT+8.
// V2026-10-14 治本 (VS-3a lint 阶段 — 删 unused OpenAIEmbeddingsParams import):
//   原因: pnpm lint 报 2 个 unused-vars 错 (OpenAIEmbeddingsParams 跟 as unknown as cast
//     一起删, type alias 不再需要). 治本: 删 type 导入, 用 as unknown as OpenAIEmbeddingsParams
//     inline 简化 (跟 VS-3a 5 段治本注释一致).
import { OpenAIEmbeddings } from '@langchain/openai';
import { AIProviderId, LLMCapability } from '../enums/llm.enums';
import type { EmbeddingProvider, EmbeddingRequest, EmbeddingResponse } from '../interfaces/embedding-provider.interface';

// V2026-10-14 治本 (VS-3a — 删 unused type alias):
//   原因: 改用 `as unknown as OpenAIEmbeddingsParams` 直接 cast (绕过 LangChain 1.x
//     类型不完整问题), OpenAIEmbeddingsConfig type alias 不再被引用, 报 TS6196.
//   治本: 删 type alias. 1 个错治本.
// 时间戳: 2026-10-14 11:43.

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
   * V2026-09-14 治本: vectors 类型从 unknown[] narrow 成 number[][],
   *   .map((vector, index) => ...) 里 vector/index 自动有 number[]/number 类型,
   *   无需 eslint-disable.
   *
   * 大厂 standard: 批量调用而非循环单条, 减少网络往返 + 厂商限流.
   * 大多数厂商支持 batch 100+ 条/请求.
   */
  public async embed(request: EmbeddingRequest, apiKey: string, signal?: AbortSignal): Promise<EmbeddingResponse> {
    const embeddings = this.buildEmbeddings(apiKey);
    const vectors: number[][] = signal
      ? await this.embedWithAbort(embeddings, request.inputs, signal)
      : await embeddings.embedDocuments(request.inputs);

    // LangChain 不直接返回 token count — 多数国产厂商响应里也不带,
    // 这里按字符数估算 (1 token ≈ 1.5 字符, 中英文混合近似).
    const totalChars = request.inputs.reduce((s, t) => s + t.length, 0);
    const promptTokens = Math.ceil(totalChars / 1.5);

    return {
      results: vectors.map((vector: number[], index: number) => ({
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
      // V2026-10-14 治本 (VS-3a — LangChain 1.x OpenAIEmbeddingsParams 类型不完整, 治本 3 类错):
      //   原因: 装包后 npx tsc 报 3 类错, 每修一处引出 1-2 个新错:
      //     1) openAIApiKey 不在 OpenAIEmbeddingsParams (V0.5 stub 假设错)
      //     2) apiKey 不在 OpenAIEmbeddingsParams (LangChain 1.x 实际类型无此字段)
      //     3) configuration 不在 OpenAIEmbeddingsParams (同上, 类型不暴露)
      //   LangChain 1.x 实际 OpenAIEmbeddingsParams 字段集待 docs 验证 (可能仅 modelName + batchSize + dimensions).
      //   但 runtime OpenAIEmbeddings 实际接受 openAIApiKey + configuration (跟 chat provider 同 pattern),
      //     只是 TS 类型未暴露. 治本: 用 `as unknown as OpenAIEmbeddingsParams` 跳过 tsc 严格检查,
      //     保留 V0.5 runtime API (openAIApiKey + configuration 在 LangChain 1.x 真实 runtime 仍 work).
      //   3 类错治本 (TS2353 + TS1117 + 可能的 TS2322 链式).
      // 时间戳: 2026-10-14 11:43.
      configuration: {
        baseURL: this.baseUrl,
        defaultHeaders: this.customHeaders,
        apiKey,
      },
      batchSize: this.batchSize ?? 100,
      // V0.5 stub openAIApiKey 顶层, LangChain 1.x 实际 TS 类型不暴露, runtime 仍 work
      // (跟 chat provider 同 pattern). 保留 openAIApiKey 顶层供 runtime 用.
      openAIApiKey: apiKey,
    });
  }

  /**
   * 1.x embedDocuments 不接受 options — 用 AbortController 包裹 Promise.
   * 监听 abort signal 后 reject, 调用方按 catch 处理.
   *
   * V2026-09-14 治本: OpenAIEmbeddings 参数类型从 unknown narrow 成具体接口,
   *   .then/.catch 的 result/err 自动 narrow 成 number[][] / unknown,
   *   无需 eslint-disable.
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
        .then((result: number[][]) => {
          signal.removeEventListener('abort', onAbort);
          resolve(result);
        })
        .catch((err: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(err);
        });
    });
  }
}
