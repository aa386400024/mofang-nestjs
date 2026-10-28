// V2026-09-04 治本 (V6.0 §3.5 + §12 RAG):
//   RAG (Retrieval-Augmented Generation) 服务 — LangChain RetrievalChain 包装.
//   关键反双胞胎:
//     - 不写 vector store 操作 — 走 QdrantService.
//     - 不写 embedding 调用 — 走 LlmRouterService.embed() (多厂商可插拔).
//     - 不写 LLM 调用 — 走 LlmRouterService.streamChat() (统一协议).
//   如何验证:
//     1. 上传 5 篇焦虑科普到 psychology_articles collection.
//     2. POST /v1/chat/completions tier=rag messages=[{role:user,content:'焦虑是什么'}]
//        → 检索 top 3 articles → 拼成 context → stream 给 LLM.

import { Injectable, Logger } from '@nestjs/common';

import { QdrantService } from './qdrant.service';
import { LlmRouterService } from '../../llm/registry/llm-router.service';

/**
 * RAG 服务 — V6.0 §3.5 高阶层对话 + §3.2 科普.
 *
 * 设计:
 *   - collection 名空间:
 *     psychology_articles (科普文章)
 *     practice_plans (练习方案)
 *     crisis_resources (危机资源, §11.2 二级响应)
 *     user_journals (用户日记, V3 接)
 *   - 检索: topK = 5 默认, score threshold 0.7.
 *   - context 拼装: 文章 title + 摘要 (前 500 字) + tag + score.
 */
@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  /** RAG 检索 collection — V2 默认心理学科普. */
  static readonly DEFAULT_COLLECTION = 'psychology_articles';

  /** topK — 5 条足够支撑 system prompt 拼接, 不爆 LLM 上下文. */
  static readonly TOP_K = 5;

  /** 分数阈值 — 低于 0.7 不引入, 防 LLM 拿到噪声上下文. */
  static readonly SCORE_THRESHOLD = 0.7;

  constructor(
    private readonly qdrant: QdrantService,
    private readonly router: LlmRouterService,
  ) {}

  /**
   * 检索 + 拼装 context — 给 LLM 系统 prompt 用.
   *
   * V2026-09-04 治本: 不返回完整文章原文 (LLM 上下文宝贵), 只返回
   * title + 摘要 (前 500 字) + tag + score. LLM 拿到结构化信息后
   * 自己组织语言回答.
   */
  async buildContext(
    uid: string,
    query: string,
    options?: { collection?: string; topK?: number },
  ): Promise<{ context: string; hits: number; avgScore: number }> {
    const collection = options?.collection ?? RagService.DEFAULT_COLLECTION;
    const topK = options?.topK ?? RagService.TOP_K;

    // 1. Embedding — 走 router (多厂商).
    let queryVector: number[];
    try {
      const embedResult = await this.router.embed({ model: '', inputs: [query] }, { uid });
      queryVector = embedResult.results[0]?.vector ?? [];
      if (queryVector.length === 0) {
        this.logger.warn(`RAG embed returned empty vector uid=${uid}`);
        return { context: '', hits: 0, avgScore: 0 };
      }
    } catch (e) {
      // Qdrant 不可达 / embedding 失败 — 软降级, 不阻塞对话.
      this.logger.warn(`RAG embed failed uid=${uid}: ${(e as Error).message}`);
      return { context: '', hits: 0, avgScore: 0 };
    }

    // 2. Qdrant 检索.
    let hits: { id: string; score: number; payload: Record<string, unknown> }[];
    try {
      hits = await this.qdrant.search(collection, queryVector, topK);
    } catch (e) {
      this.logger.warn(`RAG qdrant search failed collection=${collection}: ${(e as Error).message}`);
      return { context: '', hits: 0, avgScore: 0 };
    }

    // 3. 阈值过滤.
    const qualified = hits.filter((h) => h.score >= RagService.SCORE_THRESHOLD);
    if (qualified.length === 0) {
      return { context: '', hits: 0, avgScore: 0 };
    }

    // 4. 拼装 context.
    const contextBlocks = qualified.map((h, idx) => {
      const payload = h.payload as {
        title?: string;
        summary?: string;
        content?: string;
        tags?: string[];
      };
      const title = payload.title ?? `Doc ${idx + 1}`;
      const summary = payload.summary ?? payload.content?.slice(0, 500) ?? '';
      const tags = Array.isArray(payload.tags) ? payload.tags.join(', ') : '';
      return `[${idx + 1}] ${title}${tags ? ` (${tags})` : ''}\n${summary}\n(relevance: ${h.score.toFixed(2)})`;
    });
    const context = contextBlocks.join('\n\n');
    const avgScore = qualified.reduce((s, h) => s + h.score, 0) / qualified.length;

    this.logger.debug(
      `RAG buildContext uid=${uid} collection=${collection} hits=${qualified.length}/${hits.length} avgScore=${avgScore.toFixed(2)}`,
    );

    return { context, hits: qualified.length, avgScore };
  }

  /**
   * 摄取 (ingest) — 把单篇文章向量化 + 写入 collection.
   *
   * 用于 admin 后台 + cron 同步 (V3 接官方心理学数据库).
   */
  async ingestArticle(
    collection: string,
    article: {
      id: string;
      title: string;
      summary: string;
      content: string;
      tags?: string[];
    },
  ): Promise<void> {
    // 拼接文本 — title + summary + content 前 2000 字 (避免超长文本 embedding 退化).
    const textToEmbed = `${article.title}\n\n${article.summary}\n\n${article.content.slice(0, 2000)}`;
    const embedResult = await this.router.embed({ model: '', inputs: [textToEmbed] }, {});
    const vector = embedResult.results[0]?.vector ?? [];
    if (vector.length === 0) {
      throw new Error('Embedding returned empty vector');
    }
    await this.qdrant.upsert(collection, article.id, vector, {
      title: article.title,
      summary: article.summary,
      content: article.content,
      tags: article.tags ?? [],
      ingestedAt: new Date().toISOString(),
    });
    this.logger.log(`Ingested article id=${article.id} collection=${collection}`);
  }
}
