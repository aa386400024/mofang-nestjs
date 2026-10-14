// V2026-10-14 治本 (VS-3c — search.service.ts 接 Qdrant + OpenAI 兼容 embedding, 治 V0.x LIKE):
//   原因: V0.x LIKE %q% (V2026-10-12 spec §12.4) 在 KB 1K+ 数据后性能差 + 不走向量召回
//     (RAG 效果差). VS-3b plan B 装 Qdrant + OpenAI 兼容 4 provider embedding
//     (deepseek/doubao/qwen/custom), VS-3c 治本: search() 改 Qdrant vector search.
//   修法: 1) 1 个 query 向量化走 LlmRouterService.embed() 2) QdrantService.search()
//     返 top-K chunk + score 3) 根据 chunk.itemId join knowledge_items 返 DTO.
//   反双胞胎: 不引独立 vector client (QdrantService 已注入), 不用 ES (LLM 抽象层
//     已有). 软降级: Qdrant 不可达时走 V0.x LIKE (跟 V2 阶段 fallback 一致).
//   验证 (大炮跑 pnpm migration:run + 启服务):
//     1. POST /admin/knowledge-items/{id}/ingest → Qdrant upsert 成功
//     2. POST /admin/knowledge-items/search?q=... → Qdrant vector search 返相关 chunks
//     3. Qdrant 不可达时 → fallback LIKE search, 返 items (跟 V0.x 行为一致)
//   时间戳: 2026-10-14 15:06.

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { QdrantService } from '../../ai-engine/providers/qdrant.service';
import { LlmRouterService } from '../../llm/registry/llm-router.service';
import { User } from '../../user/entities/user.entity';
import { KnowledgeItemDto } from '../dto/knowledge.dto';
import { KnowledgeItem } from '../entities/knowledge-item.entity';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private readonly qdrantCollection: string;
  private readonly enableVectorSearch: boolean;

  constructor(
    @InjectRepository(KnowledgeItem)
    private readonly items: Repository<KnowledgeItem>,
    // V2026-10-14 治本 (VS-3c — 删 unused KnowledgeChunk inject, 避免 TS6138):
    //   原因: 实际 chunk 召回走 Qdrant payload.itemId (不查 MySQL chunks 表), chunks repo
    //     注入但未用, 报 TS6138. 治本: 删 @InjectRepository 跟 import, knowledge-base.module.ts
    //     TypeOrmModule.forFeature 仍注册 KnowledgeChunk entity (V0.x KB ingest 阶段用,
    //     后续 controller 会注入新 service 调 chunks 写).
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly llmRouter: LlmRouterService,
    private readonly qdrant: QdrantService,
    config: ConfigService,
  ) {
    this.qdrantCollection = config.get<string>('QDRANT_KB_COLLECTION') ?? 'knowledge_chunks';
    this.enableVectorSearch = config.get<string>('KB_VECTOR_SEARCH_ENABLED') !== 'false';
  }

  /**
   * 全文搜索 (V0.x LIKE 软降级, V1.x Qdrant vector search).
   *
   * 跟客户端 7.2 KnowledgeListBloc.search 行为一致: 传 q 走 list() 也能
   * 搜 (内联在 list query), 这里是独立入口给后续 BM25 升级用.
   */
  async search(tenantId: string, query: string, limit = 20): Promise<KnowledgeItemDto[]> {
    if (!query.trim()) {
      return [];
    }
    // V1.x 升级 path: Qdrant vector search (主) → LIKE 软降级 (Qdrant 不可达 / 未启用)
    if (this.enableVectorSearch) {
      try {
        const vectorResults = await this.vectorSearch(tenantId, query, limit);
        if (vectorResults.length > 0) return vectorResults;
        this.logger.debug(`vector search 0 results, fallback LIKE for query="${query}"`);
      } catch (e) {
        this.logger.warn(`Qdrant vector search failed, fallback LIKE: ${(e as Error).message}`);
      }
    }
    return this.likeSearch(tenantId, query, limit);
  }

  /**
   * V1.x: Qdrant 向量召回 + chunk→item join 返 DTO.
   */
  private async vectorSearch(tenantId: string, query: string, limit: number): Promise<KnowledgeItemDto[]> {
    // 1. query 向量化 (走 OpenAI 兼容 4 provider 之一, env LLM_DEFAULT_EMBEDDING_PROVIDER)
    const embedRes = await this.llmRouter.embed({
      model: this.qdrantCollection === 'knowledge_chunks' ? 'text-embedding-3-small' : 'text-embedding-v3',
      inputs: [query],
    });
    if (!embedRes.results.length || !embedRes.results[0].vector.length) {
      this.logger.warn('embed returned empty vector, fallback LIKE');
      return [];
    }
    const queryVector = embedRes.results[0].vector;

    // 2. Qdrant 向量召回 top-K (score 阈值 0.5, 跟 spec §13.4 兼容)
    const hits = await this.qdrant.search(this.qdrantCollection, queryVector, limit, { tenant_id: tenantId }, 0.5);
    if (hits.length === 0) return [];

    // 3. 根据 Qdrant payload.itemId 查 knowledge_items + knowledge_chunks, 返 DTO
    const itemIds = Array.from(new Set(hits.map((h) => String(h.payload['item_id'] ?? '')).filter(Boolean)));
    if (itemIds.length === 0) return [];
    const rows = await this.items
      .createQueryBuilder('i')
      .where('i.tenantId = :tenantId', { tenantId })
      .andWhere('i.id IN (:...ids)', { ids: itemIds })
      .andWhere('i.status = :status', { status: 'published' })
      .getMany();
    if (rows.length === 0) return [];

    // 按 Qdrant score 顺序排序 (Qdrant 返的 hits 顺序就是 score 倒序)
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const orderedRows = itemIds.map((id) => rowById.get(id)).filter((r): r is KnowledgeItem => !!r);
    const authorMap = await this.batchGetAuthorNames(orderedRows.map((r) => r.authorId));
    return orderedRows.map((row) => this.toItemDto(row, authorMap.get(row.authorId) ?? 'Unknown'));
  }

  /**
   * V0.x: LIKE %q% 软降级 (Qdrant 不可达 / 未启用 / 0 召回时).
   */
  private async likeSearch(tenantId: string, query: string, limit: number): Promise<KnowledgeItemDto[]> {
    const rows = await this.items
      .createQueryBuilder('i')
      .where('i.tenantId = :tenantId', { tenantId })
      .andWhere('(i.title LIKE :q OR JSON_EXTRACT(i.content, "$.body") LIKE :q)', {
        q: `%${query}%`,
      })
      .andWhere('i.status = :status', { status: 'published' })
      .orderBy('i.updatedAt', 'DESC')
      .limit(limit)
      .getMany();
    if (rows.length === 0) return [];
    const authorMap = await this.batchGetAuthorNames(rows.map((r) => r.authorId));
    return rows.map((row) => this.toItemDto(row, authorMap.get(row.authorId) ?? 'Unknown'));
  }

  private async batchGetAuthorNames(userIds: string[]): Promise<Map<string, string>> {
    const uniqueIds = Array.from(new Set(userIds));
    if (uniqueIds.length === 0) return new Map();
    const users = await this.users
      .createQueryBuilder('u')
      .select(['u.uid', 'u.email', 'u.phone'])
      .where('u.uid IN (:...uids)', { uids: uniqueIds })
      .getMany();
    const map = new Map<string, string>();
    for (const u of users) {
      map.set(u.uid, u.email ?? u.phone ?? 'Unknown');
    }
    return map;
  }

  private toItemDto(item: KnowledgeItem, authorName: string): KnowledgeItemDto {
    return {
      id: item.id,
      tenantId: item.tenantId,
      type: item.type,
      title: item.title,
      contentPreview: item.content.preview,
      tags: item.metadata.tags,
      difficulty: item.metadata.difficulty,
      status: item.status,
      version: item.version,
      authorId: item.authorId,
      authorName,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      reviewerId: item.reviewerId,
      reviewerName: null,
      publishedAt: item.publishedAt,
      scheduledPublishAt: item.scheduledPublishAt,
    };
  }
}
