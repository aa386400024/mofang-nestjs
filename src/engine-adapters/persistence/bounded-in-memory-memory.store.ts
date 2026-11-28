// AF-594: 有界工作记忆仓 — engine-adapters 侧实现, 不改 engine-core.
//
// 背景: InMemoryMemoryStore 的 entries 是进程级单 Map, 默认 TTL null, 且每次
// remember() 都全 Map 清扫. 对练每轮写 2 条工作记忆, 会话关闭也不清 →
// 进程生命周期内条目只增不减, 每次写入/召回成本随累计轮次线性增长.
//
// 本实现把条目按 tenant+session 分桶:
//   - 单会话只保留最近 maxEntriesPerSession 条 (按 occurredAt 淘汰最旧);
//   - 全局最多保留 maxSessions 个会话 (按 lastAccessAt LRU 淘汰);
//   - 会话空闲超过 sessionIdleTtlMs 整桶淘汰;
//   - 写入只清理本会话过期条目, 不再全 Map 扫描;
//   - 召回的 session 范围只扫本会话 (visitor 范围受全局会话上限约束);
//   - 提供可选 forgetSession(), 由门面在会话关闭时调用.
//
// 召回判定/排序仍复用 engine-core 的 evaluateRecallCandidate + 同一套
// IMPORTANCE → occurredAt 排序, 不复制第二份语义.

import {
  assertValidMemoryEntry,
  assertValidMemoryRecallQuery,
  evaluateRecallCandidate,
  resolveMemoryRecallLimit,
  type MemoryEntry,
  type MemoryHit,
  type MemoryRecallQuery,
  type MemoryStore,
  type RecallPolicyOptions,
} from '../../engine-core/index.js';

/** 单条记忆的内部存储形状 (与内核 InMemoryMemoryStore 一致). */
interface StoredMemoryEntry {
  readonly entry: MemoryEntry;
  readonly expiresAt: number | null;
}

/** 单会话桶. */
interface SessionBucket {
  readonly tenantId: string;
  readonly sessionId: string;
  lastAccessAt: number;
  readonly entries: Map<string, StoredMemoryEntry>;
}

/** 召回命中 + 排序权重 (内部用). */
interface RankedHit {
  readonly hit: MemoryHit;
  readonly effectiveImportance: number;
}

/** 有界工作记忆仓构造选项. */
export interface BoundedInMemoryMemoryStoreOptions {
  /** 单会话最多保留条数 (默认 200). */
  readonly maxEntriesPerSession?: number;
  /** 全局最多保留会话数 (默认 1000). */
  readonly maxSessions?: number;
  /** 会话空闲淘汰时长 (默认 6 小时). */
  readonly sessionIdleTtlMs?: number;
  /** 条目未显式给 ttlMs 时的默认存活时长 (默认 6 小时; null = 永不过期). */
  readonly defaultEntryTtlMs?: number | null;
  /** 时钟注入 (测试用). */
  readonly now?: () => number;
  /** 召回策略配置 (与内核内存版同一口径). */
  readonly recallPolicy?: RecallPolicyOptions;
}

const DEFAULT_MAX_ENTRIES_PER_SESSION = 200;
const DEFAULT_MAX_SESSIONS = 1000;
const DEFAULT_SESSION_IDLE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_ENTRY_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * 有界工作记忆仓.
 *
 * 只用于 WORKING / SHORT_TERM 等进程内记忆; LONG_TERM 在生产由 Qdrant 承担,
 * 未配 Qdrant 时同样落在这里, 但受 maxSessions / TTL 约束.
 */
export class BoundedInMemoryMemoryStore implements MemoryStore {
  private readonly sessions = new Map<string, SessionBucket>();
  private readonly maxEntriesPerSession: number;
  private readonly maxSessions: number;
  private readonly sessionIdleTtlMs: number;
  private readonly defaultEntryTtlMs: number | null;
  private readonly now: () => number;
  private readonly recallPolicy: RecallPolicyOptions | undefined;

  constructor(options: BoundedInMemoryMemoryStoreOptions = {}) {
    this.maxEntriesPerSession = options.maxEntriesPerSession ?? DEFAULT_MAX_ENTRIES_PER_SESSION;
    this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.sessionIdleTtlMs = options.sessionIdleTtlMs ?? DEFAULT_SESSION_IDLE_TTL_MS;
    this.defaultEntryTtlMs = options.defaultEntryTtlMs === undefined ? DEFAULT_ENTRY_TTL_MS : options.defaultEntryTtlMs;
    this.now = options.now ?? Date.now;
    this.recallPolicy = options.recallPolicy;
  }

  async remember(entry: MemoryEntry): Promise<void> {
    assertValidMemoryEntry(entry);
    const now = this.now();
    this.evictIdleSessions(now);

    const bucket = this.getOrCreateBucket(entry.tenantId, entry.sessionId, now);
    this.purgeExpired(bucket, now);

    const ttlMs = entry.ttlMs === undefined ? this.defaultEntryTtlMs : entry.ttlMs;
    const expiresAt = ttlMs === null ? null : now + ttlMs;
    bucket.entries.set(entry.id, { entry: { ...entry }, expiresAt });
    bucket.lastAccessAt = now;

    this.trimOldest(bucket);
  }

  async recall(query: MemoryRecallQuery): Promise<readonly MemoryHit[]> {
    assertValidMemoryRecallQuery(query);
    const limit = resolveMemoryRecallLimit(query.limit);
    const now = this.now();
    this.evictIdleSessions(now);

    const scope = query.scope ?? 'session';
    const buckets = this.collectBuckets(query, scope, now);
    const ranked: RankedHit[] = [];

    for (const bucket of buckets) {
      this.purgeExpired(bucket, now);
      for (const stored of bucket.entries.values()) {
        const evaluation = evaluateRecallCandidate(stored.entry, stored.expiresAt, query, now, this.recallPolicy);
        if (!evaluation.accepted) continue;
        ranked.push({
          hit: { entry: { ...stored.entry }, score: 0 },
          effectiveImportance: evaluation.effectiveImportance,
        });
      }
    }

    ranked.sort((a, b) => b.effectiveImportance - a.effectiveImportance || b.hit.entry.occurredAt - a.hit.entry.occurredAt);
    return ranked.slice(0, limit).map((item) => item.hit);
  }

  /**
   * 会话关闭时清理该会话全部工作记忆.
   *
   * 该方法是适配层可选能力, 不属于 engine-core 端口签名; 门面通过结构性类型
   * 判断调用, 因此 Qdrant 版 / 其他实现不受影响.
   */
  forgetSession(tenantId: string, sessionId: string): void {
    this.sessions.delete(BoundedInMemoryMemoryStore.bucketKey(tenantId, sessionId));
  }

  /** 仅测试/观测用: 当前会话数与条目总数 (不暴露给业务). */
  stats(): { sessions: number; entries: number } {
    let entries = 0;
    for (const bucket of this.sessions.values()) entries += bucket.entries.size;
    return { sessions: this.sessions.size, entries };
  }

  private static bucketKey(tenantId: string, sessionId: string): string {
    return `${tenantId}\u0000${sessionId}`;
  }

  private getOrCreateBucket(tenantId: string, sessionId: string, now: number): SessionBucket {
    const key = BoundedInMemoryMemoryStore.bucketKey(tenantId, sessionId);
    const existing = this.sessions.get(key);
    if (existing) {
      existing.lastAccessAt = now;
      return existing;
    }

    const bucket: SessionBucket = { tenantId, sessionId, lastAccessAt: now, entries: new Map() };
    this.sessions.set(key, bucket);
    this.evictLeastRecentlyUsed();
    return bucket;
  }

  private collectBuckets(query: MemoryRecallQuery, scope: 'session' | 'visitor', now: number): SessionBucket[] {
    if (scope === 'session') {
      const bucket = this.sessions.get(BoundedInMemoryMemoryStore.bucketKey(query.tenantId, query.sessionId));
      if (!bucket) return [];
      bucket.lastAccessAt = now;
      return [bucket];
    }

    // visitor 范围只在纯内存部署 / Qdrant 不可达时生效; 受 maxSessions 上限保护.
    const matched: SessionBucket[] = [];
    for (const bucket of this.sessions.values()) {
      if (bucket.tenantId !== query.tenantId) continue;
      bucket.lastAccessAt = now;
      matched.push(bucket);
    }
    return matched;
  }

  private purgeExpired(bucket: SessionBucket, now: number): void {
    for (const [id, stored] of bucket.entries) {
      if (stored.expiresAt !== null && stored.expiresAt <= now) bucket.entries.delete(id);
    }
  }

  private trimOldest(bucket: SessionBucket): void {
    const excess = bucket.entries.size - this.maxEntriesPerSession;
    if (excess <= 0) return;

    // 单会话上限 200, 一次淘汰最多几条; 按 occurredAt 升序丢最旧.
    const oldest = [...bucket.entries.entries()].toSorted((a, b) => a[1].entry.occurredAt - b[1].entry.occurredAt);
    for (let i = 0; i < excess; i += 1) {
      bucket.entries.delete(oldest[i][0]);
    }
  }

  private evictIdleSessions(now: number): void {
    for (const [key, bucket] of this.sessions) {
      if (now - bucket.lastAccessAt > this.sessionIdleTtlMs) this.sessions.delete(key);
    }
  }

  private evictLeastRecentlyUsed(): void {
    while (this.sessions.size > this.maxSessions) {
      let oldestKey: string | null = null;
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const [key, bucket] of this.sessions) {
        if (bucket.lastAccessAt < oldestAt) {
          oldestAt = bucket.lastAccessAt;
          oldestKey = key;
        }
      }
      if (oldestKey === null) return;
      this.sessions.delete(oldestKey);
    }
  }
}
