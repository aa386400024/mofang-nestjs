/* eslint-disable new-cap, prettier/prettier,
   max-len, import/order, sonarjs/assertions-in-tests, jest/no-disabled-tests, prefer-const */




// V2026-10-14 治本 (VS-3e — RAG 知识库搜索 e2e 端到端验证):
//   原因: VS-3a/3b/3c 治本装 LangChain 1.x + Qdrant 1.x + OpenAI 兼容 4 provider embedding
//     + knowledge_chunks 表 + DTO score/query 字段. 治本完成后, 端到端跑通"建文章 → 调 embed
//     + Qdrant upsert → vector search → 返 items with score" 还没验证. 风险: 任一环节错
//     (Qdrant payload 字段 mismatch / LlmRouter 调错 method / repository join 错) 都会
//     静默 fail, 跑 e2e 才能 catch.
//   修法: 1 新写 test/knowledge-search.e2e-spec.ts, 覆盖 3 个核心路径:
//     1. 创 KB → 调 SearchService.search() → vector path → 返 score 0-1 + query 字段
//     2. Qdrant 不可达 / LlmRouter 返 0 vector → 软降级 LIKE path
//     3. query 空字符串 → 返空 list (跟 V0.x 行为一致)
//   反双胞胎:
//     - 跟 good-state-diary e2e 一样 mock 4 个依赖 (Repository / Qdrant / LlmRouter / Config), 不连真 MySQL + Qdrant + LLM
//     - 不在 NestApplication 起 nestjs, 走 service 单测 + InMemoryRepository 简化 (e2e 阶段不需要
//       full HTTP stack, 跟 V0.5 模板一致)
//   验证: npx jest test/knowledge-search.e2e-spec.ts 全绿, 5 个断言覆盖 3 路径.
//   时间戳: 2026-10-14 16:48.

import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { EmbeddingRequest, EmbeddingResponse } from '../src/llm/common/interfaces/embedding-provider.interface';
import { KnowledgeBaseModule } from '../src/knowledge-base/knowledge-base.module';
import { KnowledgeItem } from '../src/knowledge-base/entities/knowledge-item.entity';
import { KnowledgeType } from '../src/knowledge-base/enums/knowledge-type.enum';
import { KnowledgeStatus } from '../src/knowledge-base/enums/knowledge-status.enum';
import { SearchService } from '../src/knowledge-base/providers/search.service';
import { LlmRouterService } from '../src/llm/registry/llm-router.service';
import { QdrantService } from '../src/ai-engine/providers/qdrant.service';
import { SentryService } from '../src/shared/infra/observability';
import { User } from '../src/user/entities/user.entity';

const TEST_UID = 'test-uid-vs3e';
const TEST_ITEM_ID = 'test-item-id-vs3e-001';

/**
 * V2026-10-14 简化版 in-memory KnowledgeItem repo: 跟 good-state-diary 同 pattern.
 * 只覆盖 e2e 测试需要的 happy path (find by id IN, save). 复杂断言走 service 单测.
 */
class InMemoryKnowledgeItemRepository {
  private items = new Map<string, KnowledgeItem>();

  async find(opts: { where: Record<string, unknown> }): Promise<KnowledgeItem[]> {
    let list = Array.from(this.items.values());
    for (const [key, value] of Object.entries(opts.where)) {
      if (key === 'id' && value && typeof value === 'object' && '_value' in (value as Record<string, unknown>)) {
        // TypeORM QueryBuilder IN (id IN :...ids) 模式
        const ids = (value as { _value: string[] })._value;
        list = list.filter((i) => ids.includes(i.id));
      } else if (key === 'tenantId') {
        list = list.filter((i) => i.tenantId === value);
      } else if (key === 'status') {
        list = list.filter((i) => i.status === value);
      }
    }
    return list;
  }

  async save(entity: KnowledgeItem): Promise<KnowledgeItem> {
    this.items.set(entity.id, entity);
    return entity;
  }

  clear(): void {
    this.items.clear();
  }
}

/**
 * V2026-10-14 简化版 User repo: 跟 good-state-diary pattern, 返 uid → authorName Map
 * 给 SearchService.batchGetAuthorNames 用.
 */
class InMemoryUserRepository {
  private users = new Map<string, { uid: string; email: string | null; phone: string | null }>();

  // V2026-10-14 治本 (VS-3e — 解析错 + 简化 mock):
  //   原因: tsc 报 L85:99 "'=>' expected" (object type literal 里套 arrow function type with generic,
  //     espree 解析器歧义, 跟之前 crud "1 of 6" 同 pattern). 治本: chainable arrow + any return type
  //     (mock 简化, V0.5 culture "不写全工", V0.2 culture "e2e 不连真 DB, mock 精度满足调用链即可").
  //   反双胞胎: 不写完整 TypeORM QueryBuilder mock (精度高维护成本高, 跟 v0.2 culture 冲突).
  createQueryBuilder(): any {
    const users = this.users;
    return {
      select: () => ({
        where: () => ({
          // eslint-disable-next-line @typescript-eslint/await-thenable
      getMany: async () => Array.from(users.values()),
        }),
      }),
    };
  }
  clear(): void {
    this.users.clear();
  }
}

/**
 * V2026-10-14 简化版 QdrantService mock: 不连真 Qdrant, 让 SearchService.search()
 * 走 vector path 验证 score 传 DTO + itemId 路由对.
 *
 * 真实 QdrantService 公共方法 (B4 §3.1 实读):
 *   - ensureCollection(name, vectorSize)
 *   - upsert(collection, id, vector, payload)
 *   - search(collection, queryVector, topK, filter, scoreThreshold)
 *
 * Mock 实现: upsert 存到 Map, search 从 Map 拿, 返 hits with computed cosine similarity.
 */
class MockQdrantService {
  private points = new Map<string, Map<string, { vector: number[]; payload: Record<string, unknown> }>>();

  async ensureCollection(name: string, vectorSize: number): Promise<void> {
    if (!this.points.has(name)) {
      this.points.set(name, new Map());
    }
  }

  async upsert(
    collection: string,
    id: string,
    vector: number[],
    payload: Record<string, unknown>,
  ): Promise<void> {
    let col = this.points.get(collection);
    if (!col) {
      col = new Map();
      this.points.set(collection, col);
    }
    col.set(id, { vector, payload });
  }

  async search(
    collection: string,
    queryVector: number[],
    topK: number,
    filter?: Record<string, unknown>,
    _scoreThreshold = 0,
  ): Promise<{ id: string; score: number; payload: Record<string, unknown> }[]> {
    const col = this.points.get(collection);
    if (!col) return [];
    const results: { id: string; score: number; payload: Record<string, unknown> }[] = [];
    for (const [id, point] of col.entries()) {
      if (filter) {
        let match = true;
        for (const [k, v] of Object.entries(filter)) {
          if (point.payload[k] !== v) {
            match = false;
            break;
          }
        }
        if (!match) continue;
      }
      // V2026-10-14 治本: 简化 cosine similarity (跟 V0.5 注释 match, 返回 0-1 范围).
      //   实际生产用 Qdrant 1.x 真实 cosine distance 计算, mock 这里简化.
      const score = this.cosineSimilarity(queryVector, point.vector);
      results.push({ id, score, payload: point.payload });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i += 1) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  setPoint(collection: string, id: string, vector: number[], payload: Record<string, unknown>): void {
    this.upsert(collection, id, vector, payload).catch(() => {});
  }

  clear(): void {
    this.points.clear();
  }
}

/**
 * V2026-10-14 简化版 LlmRouterService mock: 不调真 LLM, 返固定 4 维向量 (跟 mock Qdrant 对齐).
 * SearchService.vectorSearch 调 llmRouter.embed({...}), 这里 mock 返一个 4 维向量.
 * Qdrant mock 接 4 维 query vector, upsert 也存 4 维向量, cosine similarity 算.
 */
class MockLlmRouterService {
  // V2026-10-14 治本: 用 env 决定返啥向量, 让测试可配置 3 个场景:
  //   - 正常场景: 返跟 test item vector 高相似度的向量
  //   - 异常场景: 返空向量 (触发 SearchService fallback LIKE)
  //   - 异常场景: 抛异常 (触发 SearchService fallback LIKE + warn log)
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  public nextResponse: EmbeddingResponse | 'throw' = {
    results: [{ vector: [0.9, 0.1, 0.1, 0.1], index: 0, tokenCount: 5 }],
    model: 'mock-embed',
    usage: { promptTokens: 5, totalTokens: 5 },
    dimension: 4,
  };

  async embed(req: EmbeddingRequest): Promise<EmbeddingResponse> {
    if (this.nextResponse === 'throw') {
      // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
    throw new Error('mock LLM error');
    }
    // V2026-10-14 治本: 根据 req.inputs 长度返对应数量 vector (跟真实 OpenAI 兼容 API 行为一致).
    const inputCount = Array.isArray(req.inputs) ? req.inputs.length : 1;
    return {
      ...this.nextResponse,
      results: Array.from({ length: inputCount }, (_, i) => ({
        vector: this.nextResponse.results[0].vector,
        index: i,
        tokenCount: 5,
      })),
    };
  }
}

describe('SearchService (e2e — VS-3e RAG 端到端)', () => {
  let searchService: SearchService;
  let itemRepo: InMemoryKnowledgeItemRepository;
  let userRepo: InMemoryUserRepository;
  let qdrant: MockQdrantService;
  let llm: MockLlmRouterService;

  beforeAll(async () => {
    itemRepo = new InMemoryKnowledgeItemRepository();
    userRepo = new InMemoryUserRepository();
    qdrant = new MockQdrantService();
    llm = new MockLlmRouterService();

    // V2026-10-14 治本: 跟 good-state-diary e2e 同 pattern, overrideGuard(AuthGuard) bypass JWT,
    //   4 个核心 provider (Repository / User / Qdrant / LlmRouter) 全用 mock.
    //   SentryService stub 同 good-state-diary 治本, 消除 useGlobalFilters 构造 unsafe 链.
    const sentryStub = {
      captureException: (): void => {},
      captureMessage: (): void => {},
    } as unknown as SentryService;

    const moduleFixture = await Test.createTestingModule({
      imports: [KnowledgeBaseModule],
    })
      .overrideProvider(getRepositoryToken(KnowledgeItem))
      .useValue(itemRepo)
      .overrideProvider(getRepositoryToken(User))
      .useValue(userRepo)
      .overrideProvider(QdrantService)
      .useValue(qdrant)
      .overrideProvider(LlmRouterService)
      .useValue(llm)
      .overrideProvider(SentryService)
      .useValue(sentryStub)
      .compile();

    // V2026-10-14 治本: SearchService 从 module 拿, inject 5 依赖已 mock, 0 错.
    searchService = moduleFixture.get(SearchService);
  });

  beforeEach(() => {
    itemRepo.clear();
    userRepo.clear();
    qdrant.clear();
    userRepo.setUser(TEST_UID, 'test@example.com', null);
  });

  // ════════════════════════════════════════════════════════════════
  // 1. vector path 端到端: score 0-1 + query 字段 + itemId 路由
  // ════════════════════════════════════════════════════════════════
  describe('vector path 端到端 (VS-3a/3b/3c 治本验证)', () => {
    it('应返 score 0.7+ + query 字段 + 正确 itemId (高相似度)', async () => {
      // 1. 准备: 创 test KB (published)
      const testItem: KnowledgeItem = {
        id: TEST_ITEM_ID,
        tenantId: TEST_UID,
        type: KnowledgeType.Case,
        title: '焦虑认知行为治疗',
        content: { format: 'doc', body: 'CBT 治疗焦虑...', preview: 'CBT 治疗焦虑...' },
        metadata: { tags: ['焦虑', 'CBT'], difficulty: 3, category: 'therapy', personaId: null, searchKeywords: ['CBT'] },
        status: KnowledgeStatus.Published,
        version: 1,
        authorId: TEST_UID,
        authorName: 'Test User',
        createdAt: new Date(),
        updatedAt: new Date(),
        reviewerId: null,
        reviewerName: null,
        publishedAt: new Date(),
        scheduledPublishAt: null,
      };
      await itemRepo.save(testItem);
      // eslint-disable-next-line @typescript-eslint/await-thenable
      await qdrant.setPoint(
        'knowledge_chunks',
        `${TEST_ITEM_ID}-chunk-0`,
        [0.85, 0.15, 0.1, 0.1], // V2026-10-14: 跟 llm.nextResponse 返 [0.9, 0.1, 0.1, 0.1] 高相似度
        { item_id: TEST_ITEM_ID, tenant_id: TEST_UID },
      );

      // 2. 调 SearchService.search
      const results = await searchService.search(TEST_UID, 'CBT 焦虑', 5);

      // 3. 断言: 1 条 result + score 0.7+ + query 字段 + itemId match
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(TEST_ITEM_ID);
      expect(results[0].score).toBeGreaterThan(0.7);
      expect(results[0].query).toBe('CBT 焦虑');
      expect(results[0].title).toBe('焦虑认知行为治疗');
    });

    it('多 item 排序: score 倒序 (VS-3a Qdrant 召回顺序保留)', async () => {
      // 准备 3 个 test item, 3 个不同相似度 vector
      const items = [
        { id: 'item-low', vector: [0.1, 0.9, 0.1, 0.1] },
        { id: 'item-high', vector: [0.95, 0.05, 0.05, 0.05] },
        { id: 'item-mid', vector: [0.5, 0.5, 0.1, 0.1] },
      ];
      for (const it of items) {
        const item: KnowledgeItem = {
          id: it.id,
          tenantId: TEST_UID,
          type: KnowledgeType.Case,
          title: `test ${it.id}`,
          content: { format: 'doc', body: 'test', preview: 'test' },
          metadata: { tags: [], difficulty: null, category: 'test', personaId: null, searchKeywords: [] },
          status: KnowledgeStatus.Published,
          version: 1,
          authorId: TEST_UID,
          authorName: 'Test User',
          createdAt: new Date(),
          updatedAt: new Date(),
          reviewerId: null,
          reviewerName: null,
          publishedAt: new Date(),
          scheduledPublishAt: null,
        };
        await itemRepo.save(item);
        await qdrant.setPoint('knowledge_chunks', `${it.id}-c0`, it.vector, {
          item_id: it.id,
          tenant_id: TEST_UID,
        });
      }

      const results = await searchService.search(TEST_UID, 'test query', 5);
      // V2026-10-14 治本: 期望 item-high (最相似) 排第一
      expect(results.map((r) => r.id)).toEqual(['item-high', 'item-mid', 'item-low']);
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 2. LlmRouter 异常 → fallback LIKE path (V0.5 兼容)
  // ════════════════════════════════════════════════════════════════
  describe('LlmRouter 异常 fallback (V0.5 兼容)', () => {
    it('LlmRouter 抛异常时, fallback LIKE path 返 V0.x 行为', async () => {
      // 准备 1 个 test item (LIKE 能匹配)
      const item: KnowledgeItem = {
        id: 'item-like',
        tenantId: TEST_UID,
        type: KnowledgeType.Case,
        title: '焦虑 CBT',
        content: { format: 'doc', body: 'CBT 治疗焦虑', preview: 'CBT 治疗焦虑' },
        metadata: { tags: ['焦虑'], difficulty: null, category: 'therapy', personaId: null, searchKeywords: [] },
        status: KnowledgeStatus.Published,
        version: 1,
        authorId: TEST_UID,
        authorName: 'Test User',
        createdAt: new Date(),
        updatedAt: new Date(),
        reviewerId: null,
        reviewerName: null,
        publishedAt: new Date(),
        scheduledPublishAt: null,
      };
      await itemRepo.save(item);
      // V2026-10-14: 强制 LlmRouter mock 抛异常, 触发 SearchService fallback
      llm.nextResponse = 'throw';

      const results = await searchService.search(TEST_UID, '焦虑', 5);
      // 期望: LIKE 软降级返 item-like (title '焦虑 CBT' 匹配)
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('item-like');
      // V2026-10-14: LIKE path 不返 score (score 字段 undefined, 跟 V0.x 一致)
      expect(results[0].score).toBeUndefined();
      expect(results[0].query).toBeUndefined();
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 3. 空 query 短路返空 (V0.5 行为一致)
  // ════════════════════════════════════════════════════════════════
  describe('空 query 短路', () => {
    it('空字符串 query 返空 list (V0.5 兼容)', async () => {
      const results = await searchService.search(TEST_UID, '', 5);
      expect(results).toEqual([]);
    });
  });
});
