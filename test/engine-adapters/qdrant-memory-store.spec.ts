import { vi } from 'vitest';
// V2026-10-28 治本 (WP2 · B 层 · Qdrant 记忆仓储与 embedding 适配器单测):
//   覆盖任务单 §8 B 层清单 9-10:
//     9. QdrantMemoryStore.remember/recall 正确映射 payload 与 score;
//        降级路径在 client 抛错时回退不炸.
//    10. Embedder 适配器正确桥接 embedQuery, 异常被吞为降级.
//
//   不触网:
//     Qdrant 走**窄接口 stub** (QdrantMemoryClient), embedding 走 stub Embedder,
//     全部用例纯内存, 不连 Qdrant 容器、不发 embedding 请求.
//
//   验证: npx jest test/engine-adapters
//   时间戳: 2026-10-28 GMT+8

import { OpenAICompatEmbedder } from '../../src/engine-adapters/embedder/openai-compat.embedder';
import {
  QdrantMemoryStore,
  VISITOR_LONG_MEMORY_COLLECTION,
  type QdrantMemoryClient,
} from '../../src/engine-adapters/persistence/qdrant-memory.store';
import { MemorySource, MemoryTier, type Embedder, type MemoryEntry } from '../../src/engine-core';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store';
import type { LlmRouterService } from '../../src/llm/registry/llm-router.service';

const TENANT = 'default';
const VISITOR = 'visitor-1';
const CLOCK = 1_700_000_000_000;
/**
 * 与夹具时间戳同源的时钟.
 *
 * 访客范围召回会叠加重要度衰减: 若 store 用真实 Date.now (2026) 而 payload 的
 * occurredAt 是 2023, 有效重要度会被衰减到阈值以下, 样本被整体滤掉 ——
 * 断言就变成"因为衰减没了"而不是"因为 payload 映射错了", 测的就不是想测的东西.
 * 这与 WP0 实测踩过的"store 与 session 必须同钟"是同一条铁律.
 */
const NOW = (): number => CLOCK;

/** Qdrant 窄接口 stub (记录调用, 可注入失败). */
class StubQdrant implements QdrantMemoryClient {
  readonly upserts: { collection: string; id: string; vector: number[]; payload: Record<string, unknown> }[] = [];
  readonly searches: { collection: string; vector: number[]; topK?: number; filter?: Record<string, unknown> }[] = [];
  /** V2026-10-30 (WP12): setPayload 调用记录 (冲突标记). */
  readonly payloadWrites: { collection: string; id: string; payload: Record<string, unknown> }[] = [];
  /** V2026-10-30 (WP12): scroll 调用记录 (冲突扫描). */
  readonly scrolls: { collection: string; filter: Record<string, unknown>; limit?: number }[] = [];
  /** 返回给 search 的点集. */
  points: { id: string; score: number; payload: Record<string, unknown> }[] = [];
  /** 返回给 scroll 的点集 (WP12 冲突扫描). */
  scrollPoints: { id: string; payload: Record<string, unknown> }[] = [];
  /** 置 true 则 upsert 抛错. */
  failUpsert = false;
  /** 置 true 则 search 抛错. */
  failSearch = false;
  /** 置 true 则 scroll 抛错 (WP12). */
  failScroll = false;

  async upsert(collection: string, id: string, vector: number[], payload: Record<string, unknown>): Promise<void> {
    if (this.failUpsert) throw new Error('qdrant unreachable');
    this.upserts.push({ collection, id, vector, payload });
  }

  async search(
    collection: string,
    queryVector: number[],
    topK?: number,
    filter?: Record<string, unknown>,
  ): Promise<{ id: string; score: number; payload: Record<string, unknown> }[]> {
    if (this.failSearch) throw new Error('qdrant unreachable');
    this.searches.push({ collection, vector: queryVector, topK, filter });
    return this.points;
  }

  async setPayload(collection: string, id: string, payload: Record<string, unknown>): Promise<void> {
    this.payloadWrites.push({ collection, id, payload });
  }

  async scroll(
    collection: string,
    filter: Record<string, unknown>,
    limit?: number,
  ): Promise<{ id: string; payload: Record<string, unknown> }[]> {
    if (this.failScroll) throw new Error('qdrant unreachable');
    this.scrolls.push({ collection, filter, limit });
    return this.scrollPoints;
  }
}

/** Embedder stub: 传入 Error 即模拟"embed 失败" (真实适配器返回空向量). */
function stubEmbedder(result: number[] | Error): Embedder {
  return {
    embed: vi.fn(async () => (result instanceof Error ? [] : result)),
  };
}

/** 长时记忆条目. */
function longTermEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    tenantId: TENANT,
    id: 'lt-1',
    sessionId: 'session-a',
    visitorId: VISITOR,
    tier: MemoryTier.LONG_TERM,
    source: MemorySource.SUMMARY,
    content: '来访者长期提到失眠与工作压力',
    importance: 0.9,
    occurredAt: CLOCK,
    ttlMs: null,
    ...overrides,
  };
}

describe('WP2 · B 层 Qdrant 记忆仓储', () => {
  let qdrant: StubQdrant;
  let fallback: InMemoryMemoryStore;

  beforeEach(() => {
    qdrant = new StubQdrant();
    fallback = new InMemoryMemoryStore({ now: NOW });
  });

  describe('remember — 落库与 payload 映射', () => {
    it('长时记忆写入 visitor_long_memory collection, payload 字段齐全', async () => {
      const store = new QdrantMemoryStore({ qdrant, embedder: stubEmbedder([0.1, 0.2]), fallback, now: NOW });
      await store.remember(longTermEntry({ topicKey: 'insomnia' }));

      expect(qdrant.upserts).toHaveLength(1);
      const upsert = qdrant.upserts[0];
      expect(upsert.collection).toBe(VISITOR_LONG_MEMORY_COLLECTION);
      expect(upsert.id).toBe('lt-1');
      expect(upsert.vector).toEqual([0.1, 0.2]);
      expect(upsert.payload).toMatchObject({
        tenantId: TENANT,
        visitorId: VISITOR,
        sessionId: 'session-a',
        tier: MemoryTier.LONG_TERM,
        source: MemorySource.SUMMARY,
        content: '来访者长期提到失眠与工作压力',
        importance: 0.9,
        occurredAt: CLOCK,
        topicKey: 'insomnia',
        supersededBy: null,
      });
    });

    it('非长时记忆 (工作/短时) 只进会话级回落仓, 不向量化', async () => {
      const store = new QdrantMemoryStore({ qdrant, embedder: stubEmbedder([0.1]), fallback, now: NOW });
      await store.remember({ ...longTermEntry(), tier: MemoryTier.SHORT_TERM });

      expect(qdrant.upserts).toHaveLength(0);
      const hits = await fallback.recall({ tenantId: TENANT, sessionId: 'session-a', query: 'x' });
      expect(hits).toHaveLength(1);
    });

    it('Qdrant 写入失败 → 落回落仓, 不抛 (软降级)', async () => {
      const store = new QdrantMemoryStore({ qdrant, embedder: stubEmbedder([0.1]), fallback, now: NOW });
      qdrant.failUpsert = true;
      await expect(store.remember(longTermEntry())).resolves.toBeUndefined();
      const hits = await fallback.recall({ tenantId: TENANT, sessionId: 'session-a', query: 'x' });
      expect(hits).toHaveLength(1);
    });

    it('embed 失败 (空向量) → 不向量化, 落回落仓, 不抛', async () => {
      const store = new QdrantMemoryStore({ qdrant, embedder: stubEmbedder(new Error('embed down')), fallback, now: NOW });
      await expect(store.remember(longTermEntry())).resolves.toBeUndefined();
      expect(qdrant.upserts).toHaveLength(0);
      const hits = await fallback.recall({ tenantId: TENANT, sessionId: 'session-a', query: 'x' });
      expect(hits).toHaveLength(1);
    });
  });

  describe('recall — 语义召回与 score 映射', () => {
    it('scope=visitor 走 Qdrant 语义检索, 过滤条件带租户+来访者', async () => {
      const store = new QdrantMemoryStore({ qdrant, embedder: stubEmbedder([0.3, 0.4]), fallback, now: NOW });
      qdrant.points = [
        {
          id: 'lt-1',
          score: 0.82,
          payload: {
            tenantId: TENANT,
            visitorId: VISITOR,
            sessionId: 'session-a',
            tier: MemoryTier.LONG_TERM,
            source: MemorySource.SUMMARY,
            content: '来访者长期提到失眠',
            importance: 0.9,
            occurredAt: CLOCK,
            topicKey: 'insomnia',
            supersededBy: null,
            expiresAt: null,
          },
        },
      ];

      const hits = await store.recall({
        tenantId: TENANT,
        sessionId: 'session-新',
        query: '失眠',
        scope: 'visitor',
        visitorId: VISITOR,
        limit: 5,
      });

      expect(qdrant.searches).toHaveLength(1);
      expect(qdrant.searches[0]?.collection).toBe(VISITOR_LONG_MEMORY_COLLECTION);
      expect(qdrant.searches[0]?.vector).toEqual([0.3, 0.4]);
      expect(qdrant.searches[0]?.topK).toBe(5);
      expect(qdrant.searches[0]?.filter).toEqual({
        must: [
          { key: 'tenantId', match: { value: TENANT } },
          { key: 'visitorId', match: { value: VISITOR } },
        ],
      });

      expect(hits).toHaveLength(1);
      expect(hits[0]?.score).toBeCloseTo(0.82, 10);
      expect(hits[0]?.entry.id).toBe('lt-1');
      expect(hits[0]?.entry.content).toBe('来访者长期提到失眠');
      expect(hits[0]?.entry.visitorId).toBe(VISITOR);
      expect(hits[0]?.entry.topicKey).toBe('insomnia');
    });

    it('score 超出 [0,1] 时 clamp 到契约区间', async () => {
      const store = new QdrantMemoryStore({ qdrant, embedder: stubEmbedder([0.1]), fallback, now: NOW });
      qdrant.points = [
        {
          id: 'lt-1',
          score: -0.3,
          payload: {
            tenantId: TENANT,
            visitorId: VISITOR,
            sessionId: 'session-a',
            tier: MemoryTier.LONG_TERM,
            source: MemorySource.SUMMARY,
            content: 'x',
            importance: 0.9,
            occurredAt: CLOCK,
          },
        },
      ];
      const hits = await store.recall({
        tenantId: TENANT,
        sessionId: 'session-a',
        query: 'x',
        scope: 'visitor',
        visitorId: VISITOR,
      });
      expect(hits[0]?.score).toBe(0);
    });

    it('payload 损坏的点被跳过, 不炸整次召回', async () => {
      const store = new QdrantMemoryStore({ qdrant, embedder: stubEmbedder([0.1]), fallback, now: NOW });
      qdrant.points = [
        { id: 'bad', score: 0.9, payload: { tenantId: TENANT } },
        {
          id: 'good',
          score: 0.7,
          payload: {
            tenantId: TENANT,
            visitorId: VISITOR,
            sessionId: 'session-a',
            tier: MemoryTier.LONG_TERM,
            source: MemorySource.SUMMARY,
            content: 'ok',
            importance: 0.9,
            occurredAt: CLOCK,
          },
        },
      ];
      const hits = await store.recall({
        tenantId: TENANT,
        sessionId: 'session-a',
        query: 'x',
        scope: 'visitor',
        visitorId: VISITOR,
      });
      expect(hits).toHaveLength(1);
      expect(hits[0]?.entry.id).toBe('good');
    });

    it('scope=session 走会话级回落仓, 不触 Qdrant', async () => {
      const store = new QdrantMemoryStore({ qdrant, embedder: stubEmbedder([0.1]), fallback, now: NOW });
      await fallback.remember(longTermEntry({ id: 'in-session' }));
      const hits = await store.recall({ tenantId: TENANT, sessionId: 'session-a', query: 'x' });
      expect(qdrant.searches).toHaveLength(0);
      expect(hits.map((hit) => hit.entry.id)).toEqual(['in-session']);
    });

    it('Qdrant 检索失败 → 回落到回落仓的 visitor 召回, 不抛', async () => {
      const store = new QdrantMemoryStore({ qdrant, embedder: stubEmbedder([0.1]), fallback, now: NOW });
      await fallback.remember(longTermEntry({ id: 'fallback-hit' }));
      qdrant.failSearch = true;
      const hits = await store.recall({
        tenantId: TENANT,
        sessionId: 'session-a',
        query: 'x',
        scope: 'visitor',
        visitorId: VISITOR,
      });
      expect(hits.map((hit) => hit.entry.id)).toEqual(['fallback-hit']);
    });

    it('embed 失败 → 回落到回落仓的 visitor 召回, 不抛', async () => {
      const store = new QdrantMemoryStore({ qdrant, embedder: stubEmbedder(new Error('embed down')), fallback, now: NOW });
      await fallback.remember(longTermEntry({ id: 'fallback-hit' }));
      const hits = await store.recall({
        tenantId: TENANT,
        sessionId: 'session-a',
        query: 'x',
        scope: 'visitor',
        visitorId: VISITOR,
      });
      expect(qdrant.searches).toHaveLength(0);
      expect(hits.map((hit) => hit.entry.id)).toEqual(['fallback-hit']);
    });
  });
});

describe('WP2 · B 层 OpenAI 兼容 embedding 适配器', () => {
  /** router stub: 返回固定响应或抛错. */
  function makeRouter(result: { results: { vector: number[] }[] } | Error): LlmRouterService {
    return {
      embed: vi.fn(async () => {
        if (result instanceof Error) throw result;
        return result;
      }),
    } as unknown as LlmRouterService;
  }

  it('正确桥接 router.embed, 取第一条向量', async () => {
    const router = makeRouter({ results: [{ vector: [0.5, 0.6] }] });
    const embedder = new OpenAICompatEmbedder(router);
    await expect(embedder.embed('失眠')).resolves.toEqual([0.5, 0.6]);
    expect(router.embed).toHaveBeenCalledWith({ model: '', inputs: ['失眠'] }, { uid: undefined });
  });

  it('异常被吞为降级 (返回空向量, 不抛)', async () => {
    const router = makeRouter(new Error('provider down'));
    const embedder = new OpenAICompatEmbedder(router);
    await expect(embedder.embed('失眠')).resolves.toEqual([]);
  });

  it('空结果返回空向量', async () => {
    const router = makeRouter({ results: [] });
    const embedder = new OpenAICompatEmbedder(router);
    await expect(embedder.embed('失眠')).resolves.toEqual([]);
  });
});

