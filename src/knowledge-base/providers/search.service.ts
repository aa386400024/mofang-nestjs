// V2026-10-12 (Phase 8.1 — KB 全文搜索 / SPEC §12.4 / §13.4):
//   V0.x 简单 LIKE 搜索 (title + content.body), V1.x 升级 FULLTEXT / Qdrant hybrid.
//
//   大厂 spec (跟 src/ai-engine/providers/ai-effect.service.ts getHistory 同 pattern):
//     - 单 repository 注入, 不引 lunr / ES
//     - LIKE %q% 走 MySQL B-tree index (idx_kb_tenant_status / type 范围查询后
//       在 result set 上 LIKE, 数据量 1K 内 V0.x 性能 OK)
//     - V1.x 升级: FULLTEXT index (title + metadata.tags + content.body),
//       或 Qdrant hybrid (vector + BM25) 走 spec §13.4 retrieval service
//
//   治本:
//     - 不引 lunr / lunr-languages (Node 端 BM25 实现, 跟现有 deps 风格不符)
//     - 不拆 search.controller (跟 list 复用 GET /admin/knowledge-items?q=... query
//       参数, list() 内部已实现, search() 是 alias 入口给未来 BM25 升级用).

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from '../../user/entities/user.entity';
import { KnowledgeItemDto } from '../dto/knowledge.dto';
import { KnowledgeItem } from '../entities/knowledge-item.entity';

@Injectable()
export class SearchService {
  constructor(
    @InjectRepository(KnowledgeItem)
    private readonly items: Repository<KnowledgeItem>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  /**
   * 全文搜索 (V0.x LIKE, V1.x 升级 BM25 / Qdrant).
   *
   * 跟客户端 7.2 KnowledgeListBloc.search 行为一致: 传 q 走 list() 也能
   * 搜 (内联在 list query), 这里是独立入口给后续 BM25 升级用.
   */
  async search(tenantId: string, query: string, limit = 20): Promise<KnowledgeItemDto[]> {
    if (!query.trim()) {
      return [];
    }
    const rows = await this.items
      .createQueryBuilder('i')
      .where('i.tenantId = :tenantId', { tenantId })
      .andWhere('(i.title LIKE :q OR JSON_EXTRACT(i.content, "$.body") LIKE :q)', {
        q: `%${query}%`,
      })
      // V0.x 搜索仅返 published 状态 (跟 RAG 召回范围一致, 避免草稿泄漏).
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
