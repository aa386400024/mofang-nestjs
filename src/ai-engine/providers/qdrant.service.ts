// V2026-09-04 治本 (V6.0 §3.5 + §12 RAG):
//   Qdrant 向量库 wrapper — 心塑知识库 (§3.2 科普 + §3.5 高阶层对话).
//   关键反双胞胎:
//     - 不复用 moyin-ai-core 桌面端 qdrant.exe 启动逻辑 (那是 Electron 进程).
//     - 服务端是 Qdrant 远程服务 (容器化), 走 @qdrant/js-client-rest HTTP API.
//     - 不写 Embedding 调用 — 用 LangChain OpenAIEmbeddings + QdrantVectorStore.
//   如何验证:
//     1. Qdrant 容器跑起来 (docker run -p 6333:6333 qdrant/qdrant).
//     2. POST /ai/knowledge/articles { content, tags } → 向量化 + 写入 collection.
//     3. POST /v1/chat/completions tier=rag → 检索 top 5 → stream 给 LLM.

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QdrantClient } from '@qdrant/js-client-rest';

/**
 * Qdrant 向量库服务.
 *
 * 大厂 standard:
 *   - 服务端 ≠ 客户端: Qdrant 远程, 走 HTTP API.
 *   - collection 按知识库类型分 (psychology_articles / practice_plans /
 *     crisis_resources / user_journals), 不混.
 *   - 向量维度跟 embedding 模型对齐 (默认 1536 = OpenAI text-embedding-3-small).
 *   - upsert 用 point_id = 文章 id (VARCHAR) — 幂等.
 */
@Injectable()
export class QdrantService implements OnModuleInit {
  private readonly logger = new Logger(QdrantService.name);
  private client!: QdrantClient;
  private readonly defaultVectorSize = 1536;

  constructor(private readonly config: ConfigService) {}

  /**
   * V2026-09-04 治本: 初始化 Qdrant 客户端 + 探活.
   * 连不上不抛 (知识库是 V3 增强功能, V2.0 走 basic tier 也能跑).
   */
  async onModuleInit(): Promise<void> {
    const url = this.config.get<string>('QDRANT_URL') ?? 'http://localhost:6333';
    const apiKey = this.config.get<string>('QDRANT_API_KEY') ?? '';
    this.client = new QdrantClient({ url, apiKey: apiKey || undefined });

    try {
      const collections = await this.client.getCollections();
      this.logger.log(`Qdrant connected url=${url} collections=${collections.collections.length}`);
    } catch (e) {
      this.logger.warn(
        `Qdrant unreachable url=${url} — RAG knowledge base disabled (V2.0 fallback to basic tier). Error: ${(e as Error).message}`,
      );
    }
  }

  /**
   * 确保 collection 存在 — 维度跟 embedding 模型对齐.
   */
  async ensureCollection(name: string, vectorSize = this.defaultVectorSize): Promise<void> {
    try {
      const info = await this.client.getCollection(name);
      // V2026-09-04 治本: qdrant SDK `vectors.size` 在 unnamed vector 是 number,
      //   在 named/multivector 是 config 对象 (number | QdrantVectorConfig union).
      //   template literal 嵌入 typed object 在 typescript-eslint 8.69 不被 allowAny 覆盖
      //   (allowAny 只匹配 any, typed object 不算 any), restrict-template-expressions schema
      //   也没有 allowObject. 治本是源头抽出 number 分量, 避免隐式 toString 输出 `[object Object]`.
      //   验证: lint pass, smoke error message 仍是数字.
      const rawSize = info.config?.params?.vectors?.size;
      const existingSize = typeof rawSize === 'number' ? rawSize : rawSize?.size;
      if (existingSize && existingSize !== vectorSize) {
        throw new Error(
          `Collection ${name} vector size mismatch: existing=${existingSize}, requested=${vectorSize}. ` +
            `Use a new collection name or recreate.`,
        );
      }
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('Not found') || msg.includes('404')) {
        await this.client.createCollection(name, {
          vectors: { size: vectorSize, distance: 'Cosine' },
        });
        this.logger.log(`Qdrant collection created name=${name} dim=${vectorSize}`);
      } else if (msg.includes('mismatch')) {
        throw e;
      } else {
        // 其它错误软降级 (V2 阶段 RAG 软失败).
        this.logger.warn(`ensureCollection ${name} skipped: ${msg}`);
      }
    }
  }

  /**
   * 写入向量 + payload — 单条.
   *
   * V2026-09-04 治本: point id 用字符串 (article id), upsert 幂等.
   * payload 存元数据 (tags / source / version) 用于过滤.
   */
  async upsert(collection: string, id: string, vector: number[], payload: Record<string, unknown>): Promise<void> {
    await this.ensureCollection(collection, vector.length);
    await this.client.upsert(collection, {
      points: [{ id, vector, payload }],
    });
  }

  /**
   * 批量写入 — 知识库批量导入用.
   */
  async upsertBatch(collection: string, items: { id: string; vector: number[]; payload: Record<string, unknown> }[]): Promise<void> {
    if (items.length === 0) return;
    await this.ensureCollection(collection, items[0].vector.length);
    await this.client.upsert(collection, { points: items });
  }

  /**
   * 检索 — Qdrant 1.x 用 query() API (统一 search/recommend/discover/filter).
   *
   * @param collection collection 名
   * @param queryVector 查询向量 (已经过 embedding 模型)
   * @param topK 返回前 K 条
   * @param filter 可选 payload 过滤 (e.g. { tags: 'anxiety' })
   * @param scoreThreshold 分数阈值 (低于此过滤), 默认 0
   */
  async search(
    collection: string,
    queryVector: number[],
    topK = 5,
    filter?: Record<string, unknown>,
    scoreThreshold = 0,
  ): Promise<{ id: string; score: number; payload: Record<string, unknown> }[]> {
    const response = await this.client.query(collection, {
      query: queryVector,
      limit: topK,
      with_payload: true,
      filter,
      score_threshold: scoreThreshold,
    });
    const points = response.points ?? [];
    return points.map((p) => ({
      id: String(p.id),
      score: p.score ?? 0,
      payload: (p.payload as Record<string, unknown>) ?? {},
    }));
  }

  /**
   * 删除单条 — 用于文章下架 / GDPR 删除请求.
   */
  async delete(collection: string, id: string): Promise<void> {
    await this.client.delete(collection, { points: [id] });
  }

  /**
   * 删除 collection — 切 embedding 模型时全量重建用.
   */
  async deleteCollection(collection: string): Promise<void> {
    await this.client.deleteCollection(collection);
  }
}
