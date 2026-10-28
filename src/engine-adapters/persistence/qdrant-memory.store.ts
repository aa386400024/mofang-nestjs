// V2026-10-28 治本 (WP2 · B 层 · Qdrant 长时记忆仓储):
//   职责: MemoryStore 的 Qdrant 版实现 —— 长时记忆落 `visitor_long_memory`
//         collection, 跨会话按 visitorId 做语义 Top5 召回.
//   边界: **B 层** (src/engine-adapters/), 触框架/触网络 —— 不在 src/engine-core/ 内.
//         业务决策 (衰减 / 冲突 / 窗口) 一律在内核纯函数里, 本文件只做桥接与落库.
//
//   分工 (这是本文件最关键的设计):
//     Qdrant  = **长时存储** (跨会话持久, 可语义检索)
//     内存    = **会话级存储** (工作记忆 / 短时记忆, 随进程走)
//     所以: tier=LONG_TERM → Qdrant; 其余 → 内存回落仓.
//     召回同理: scope='visitor' → Qdrant 语义检索; scope='session' → 内存 (WP0 语义).
//
//   软降级 (§6):
//     - Qdrant 不可达 / upsert 抛错 → 落内存回落仓, 记 warn, **不阻断 turn**;
//     - embed 失败 (返回空向量) → 该条不向量化, 落内存回落仓, 记 warn;
//     - 召回侧同理: 检索失败 → 回落到内存仓的 visitor 范围召回, 记 warn.
//     降级状态只记日志/指标, 不在本期向用户暴露.
//
//   反双胞胎:
//     - **不新造 QdrantClient** —— 复用现有 QdrantService (M6): 探活 / collection
//       维度管理 / 批量写 全在那一处, 再造一份 = 双探活 + 双维度管理.
//     - **依赖窄接口 QdrantMemoryClient, 不依赖整个 QdrantService** —— B 层只用到
//       upsert + search 两个方法; 声明窄接口让单测能用极小 stub, 也让"以后换向量库"
//       只需换这一个窄面, 而不是整个 service.
//     - **不自己写召回判定** —— 判定统一走内核的 evaluateRecallCandidate (内存版同款),
//       杜绝"内存版按原始重要度过滤 / Qdrant 版按衰减后过滤"这种换实现即漂移.
//     - **不用文本子串过滤** —— 语义检索由向量负责; 再加一层子串过滤等于把
//       "同义词也算相关"的语义检索降级成关键词匹配.
//     - **不物理删除被取代的记忆** (M4) —— 只在 payload 上标 supersededBy.
//
//   ⚠️ 本期已知能力缺口 (非设计选择, 是现有 QdrantService 能力所限):
//     **写侧冲突消解标记** 需要"只改 payload 不改向量"的能力 (Qdrant setPayload),
//     现有 QdrantService 未暴露该方法; 也没有"仅按 filter 取点"(scroll) 的能力,
//     靠向量相似度反查冲突分组会漏召回.
//     因此本期 Qdrant 版的**写侧**不做冲突标记; 冲突消解的纯函数
//     (resolveConflict / applyConflictResolution) 已在内核提供, 由编排层在
//     内存态算好后随新条目一起落仓. 该缺口已在交付记录中标注.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/qdrant-memory-store.spec.ts: payload 映射 / score 映射 / 降级不炸

import { Logger } from '@nestjs/common';

import {
  assertValidMemoryEntry,
  assertValidMemoryRecallQuery,
  evaluateRecallCandidate,
  MemorySource,
  MemoryTier,
  resolveMemoryRecallLimit,
  type Embedder,
  type MemoryEntry,
  type MemoryHit,
  type MemoryRecallQuery,
  type MemoryStore,
} from '../../engine-core';
import { InMemoryMemoryStore } from '../../engine-core/in-memory/in-memory-memory.store';

/**
 * 长时记忆 collection 名.
 *
 * 与知识库 RAG collection **隔离** (roadmap D2): 知识库是公共科普内容,
 * 长时记忆是来访者私有数据, 混在一起会互相污染召回且带来隐私面.
 */
export const VISITOR_LONG_MEMORY_COLLECTION = 'visitor_long_memory';

/**
 * B 层对 Qdrant 的**最小依赖面** (只要 upsert + search).
 *
 * 现有 QdrantService 结构上满足本接口; 声明窄接口的意义:
 *   - 单测能用极小 stub, 不必伪造整个 service;
 *   - 将来换向量库只影响这一个窄面.
 */
export interface QdrantMemoryClient {
  /** 写入单点 (幂等). */
  upsert(collection: string, id: string, vector: number[], payload: Record<string, unknown>): Promise<void>;
  /** 向量检索. */
  search(
    collection: string,
    queryVector: number[],
    topK?: number,
    filter?: Record<string, unknown>,
    scoreThreshold?: number,
  ): Promise<{ id: string; score: number; payload: Record<string, unknown> }[]>;
}

/** 适配器构造选项. */
export interface QdrantMemoryStoreOptions {
  /** Qdrant 客户端 (现有 QdrantService 直接满足本窄接口). */
  readonly qdrant: QdrantMemoryClient;
  /** 向量化端口 (内核 Embedder 接口). */
  readonly embedder: Embedder;
  /** 会话级回落仓. 省略 = new InMemoryMemoryStore(). */
  readonly fallback?: MemoryStore;
  /** collection 名. 省略 = visitor_long_memory. */
  readonly collection?: string;
  /** 条目未显式指定 ttlMs 时的默认存活时长 (ms). 省略 = 永不过期. */
  readonly defaultTtlMs?: number | null;
  /** 时钟 (测试可注入; 默认 Date.now). */
  readonly now?: () => number;
}

/** payload → 条目的解析结果 (含存储侧才有的过期时刻). */
interface DecodedEntry {
  readonly entry: MemoryEntry;
  readonly expiresAt: number | null;
}

/** 读字符串 (非空). */
function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** 读数字 (有限). */
function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 读记忆分层 (非法值返 null). */
function readTier(value: unknown): MemoryTier | null {
  if (value === MemoryTier.WORKING) return MemoryTier.WORKING;
  if (value === MemoryTier.SHORT_TERM) return MemoryTier.SHORT_TERM;
  if (value === MemoryTier.LONG_TERM) return MemoryTier.LONG_TERM;
  return null;
}

/** 读记忆来源 (非法值返 null). */
function readSource(value: unknown): MemorySource | null {
  if (value === MemorySource.TURN) return MemorySource.TURN;
  if (value === MemorySource.SUMMARY) return MemorySource.SUMMARY;
  if (value === MemorySource.MANUAL) return MemorySource.MANUAL;
  return null;
}

/** 夹到 [0,1]. */
function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Qdrant 长时记忆仓储.
 */
export class QdrantMemoryStore implements MemoryStore {
  private readonly logger = new Logger(QdrantMemoryStore.name);
  /** Qdrant 客户端. */
  private readonly qdrant: QdrantMemoryClient;
  /** 向量化端口. */
  private readonly embedder: Embedder;
  /** 会话级回落仓. */
  private readonly fallback: MemoryStore;
  /** collection 名. */
  private readonly collection: string;
  /** 默认存活时长 (ms); null = 永不过期. */
  private readonly defaultTtlMs: number | null;
  /** 时钟. */
  private readonly now: () => number;

  constructor(options: QdrantMemoryStoreOptions) {
    this.qdrant = options.qdrant;
    this.embedder = options.embedder;
    this.fallback = options.fallback ?? new InMemoryMemoryStore();
    this.collection = options.collection ?? VISITOR_LONG_MEMORY_COLLECTION;
    this.defaultTtlMs = options.defaultTtlMs ?? null;
    this.now = options.now ?? Date.now;
  }

  async remember(entry: MemoryEntry): Promise<void> {
    assertValidMemoryEntry(entry);

    // 非长时 (工作/短时): 只进会话级内存仓 —— 工作记忆是瞬时数据, 短时记忆
    // 待会话结束由编排层晋升为长时. 两者都不该以向量形式长期驻留.
    if (entry.tier !== MemoryTier.LONG_TERM) {
      await this.fallback.remember(entry);
      return;
    }

    const vector = await this.embedder.embed(entry.content);
    if (vector.length === 0) {
      this.logger.warn(`[remember] embed 失败, 该条不向量化, 落会话级回落仓 id=${entry.id}`);
      await this.fallback.remember(entry);
      return;
    }

    try {
      await this.qdrant.upsert(this.collection, entry.id, [...vector], this.toPayload(entry));
    } catch (e) {
      this.logger.warn(`[remember] Qdrant 写入失败, 落会话级回落仓 id=${entry.id}: ${(e as Error).message}`);
      await this.fallback.remember(entry);
    }
  }

  async recall(query: MemoryRecallQuery): Promise<readonly MemoryHit[]> {
    assertValidMemoryRecallQuery(query);

    // 会话范围: 走会话级内存仓 (WP0 语义完全一致: 租户+会话, 原始重要度过滤).
    if (query.scope !== 'visitor') {
      return this.fallback.recall(query);
    }

    const limit = resolveMemoryRecallLimit(query.limit);
    const vector = await this.embedder.embed(query.query);
    if (vector.length === 0) {
      this.logger.warn('[recall] embed 失败, 回落到会话级回落仓的 visitor 范围召回');
      return this.fallback.recall(query);
    }

    let points: { id: string; score: number; payload: Record<string, unknown> }[];
    try {
      points = await this.qdrant.search(this.collection, [...vector], limit, this.buildFilter(query), 0);
    } catch (e) {
      this.logger.warn(`[recall] Qdrant 检索失败, 回落到会话级回落仓的 visitor 范围召回: ${(e as Error).message}`);
      return this.fallback.recall(query);
    }

    const now = this.now();
    const ranked: { hit: MemoryHit; effectiveImportance: number }[] = [];
    for (const point of points) {
      const decoded = this.toEntry(point.id, point.payload);
      // payload 损坏 → 跳过该点, 不让一条脏数据炸掉整次召回.
      if (!decoded) continue;
      const evaluation = evaluateRecallCandidate(decoded.entry, decoded.expiresAt, query, now);
      if (!evaluation.accepted) continue;
      ranked.push({
        hit: { entry: decoded.entry, score: clamp01(point.score) },
        effectiveImportance: evaluation.effectiveImportance,
      });
    }

    // 排序: 语义相关度为主, 有效重要度为辅 (WP2 §5.2).
    ranked.sort((a, b) => b.hit.score - a.hit.score || b.effectiveImportance - a.effectiveImportance);
    return ranked.slice(0, limit).map((item) => item.hit);
  }

  // ── private ────────────────────────────────────────────────────

  /** 条目 → Qdrant payload. */
  private toPayload(entry: MemoryEntry): Record<string, unknown> {
    const ttlMs = entry.ttlMs === undefined ? this.defaultTtlMs : entry.ttlMs;
    return {
      tenantId: entry.tenantId,
      visitorId: entry.visitorId ?? null,
      sessionId: entry.sessionId,
      tier: entry.tier,
      source: entry.source,
      content: entry.content,
      importance: entry.importance,
      occurredAt: entry.occurredAt,
      topicKey: entry.topicKey ?? null,
      supersededBy: entry.supersededBy ?? null,
      // 绝对过期时刻 (null = 永不过期). 长时记忆默认永久, 但字段保留 —— 存储契约
      // 与内存版对齐, 将来"到期即删"类需求不用改 payload 结构.
      expiresAt: ttlMs === null ? null : this.now() + ttlMs,
    };
  }

  /** Qdrant point → 条目 (payload 损坏返回 null, 不抛). */
  private toEntry(id: string, payload: Record<string, unknown>): DecodedEntry | null {
    const tenantId = readString(payload['tenantId']);
    const sessionId = readString(payload['sessionId']);
    const content = readString(payload['content']);
    const tier = readTier(payload['tier']);
    const source = readSource(payload['source']);
    const importance = readNumber(payload['importance']);
    const occurredAt = readNumber(payload['occurredAt']);
    if (!tenantId || !sessionId || content === null || !tier || !source || importance === null || occurredAt === null) {
      return null;
    }
    const visitorId = readString(payload['visitorId']);
    const topicKey = readString(payload['topicKey']);
    const supersededBy = readString(payload['supersededBy']);
    return {
      entry: {
        tenantId,
        id,
        sessionId,
        tier,
        source,
        content,
        importance,
        occurredAt,
        visitorId: visitorId ?? undefined,
        topicKey: topicKey ?? undefined,
        supersededBy: supersededBy ?? null,
      },
      expiresAt: readNumber(payload['expiresAt']),
    };
  }

  /** Qdrant 检索过滤条件: 租户 + 来访者 (跨会话, 忽略 sessionId). */
  private buildFilter(query: MemoryRecallQuery): Record<string, unknown> {
    const must: unknown[] = [{ key: 'tenantId', match: { value: query.tenantId } }];
    if (query.visitorId) {
      must.push({ key: 'visitorId', match: { value: query.visitorId } });
    }
    return { must };
  }
}
