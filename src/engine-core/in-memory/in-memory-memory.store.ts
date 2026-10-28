// V2026-10-28 治本 (WP0 · 引擎内核 · 记忆内存仓储):
//   职责: MemoryStore 的进程内实现. WP2 会被 Qdrant 版替换, **接口不变**.
//   边界: 纯 TS, 零 @nestjs/* / typeorm. 不含 Qdrant 客户端, 不含 NestJS 装饰器.
//
//   TTL 语义 (内存版是"真实现"而非"占位注释"):
//     记忆条目带 ttlMs (相对时长) 或省略; 实现侧在写入时物化成绝对过期时刻,
//     读取时按过期时刻过滤, 并在写入时顺带清扫已过期条目.
//     为什么不只写个注释占位: TTL 是"存储契约的一部分", 注释不会在运行期生效 ——
//     留一个永不失效的内存实现, WP2 换 Qdrant 时才第一次面对过期语义, 那时
//     每个调用方都要重新想一遍"过期了怎么办".
//
//   反双胞胎:
//     - **不做文本子串过滤** —— 内存版按子串过滤 / Qdrant 版按向量过滤, 是"同一内核
//       换实现后行为变了"的最难查漂移. 内存版的 query 只用于日志; 排序退化为
//       重要度 → 发生时间, 并在代码与文档里显式写明"无语义相关度".
//     - 不在 remember 时抛"重复 id" —— 记忆写入天然会重放 (重试 / 跨会话接续),
//       幂等覆盖 (后写为准) 才是正确语义.
//     - 不给 recall 加"分页游标" —— WP2 的召回量是 Top5 量级, 分页是过度设计.
//     - 不做"重要度衰减" —— 衰减 (竞争抑制遗忘) 属 WP2 的算法, 本期只存该字段.
//
//   如何验证:
//     1. pnpm build 0 错
//     2. test/engine-core/engine-core.spec.ts 覆盖: 写入召回 / tier 过滤 / limit clamp / TTL 过期 / importance 校验

import { EngineCoreError, EngineErrorCode } from '../domain/engine-errors';
import type { MemoryEntry, MemoryHit, MemoryRecallQuery, MemoryStore } from '../domain/ports/memory.store';

/** 默认召回条数 (对齐 WP2 的 Top5 口径). */
export const DEFAULT_MEMORY_RECALL_LIMIT = 5;

/** 单次召回条数上限 (防止调用方一次拉爆内存). */
export const MAX_MEMORY_RECALL_LIMIT = 50;

/** 记忆内存仓储构造选项. */
export interface InMemoryMemoryStoreOptions {
  /**
   * 条目未显式指定 ttlMs 时的默认存活时长 (ms).
   * 省略 / null = 永不过期 (默认). 该值只影响"省略 ttlMs"的条目.
   */
  readonly defaultTtlMs?: number | null;
  /** 时钟注入 (测试用; 默认 Date.now). */
  readonly now?: () => number;
}

/** 内部存储条目: 输入形状 + 物化后的绝对过期时刻. */
interface StoredMemoryEntry {
  readonly entry: MemoryEntry;
  readonly expiresAt: number | null;
}

/** 记忆内存仓储. */
export class InMemoryMemoryStore implements MemoryStore {
  /** 记忆 id → 条目. */
  private readonly entries = new Map<string, StoredMemoryEntry>();
  /** 默认存活时长 (ms); null = 永不过期. */
  private readonly defaultTtlMs: number | null;
  /** 时钟. */
  private readonly now: () => number;

  constructor(options: InMemoryMemoryStoreOptions = {}) {
    this.defaultTtlMs = options.defaultTtlMs ?? null;
    this.now = options.now ?? Date.now;
  }

  async remember(entry: MemoryEntry): Promise<void> {
    this.assertValidEntry(entry);
    const ttlMs = entry.ttlMs === undefined ? this.defaultTtlMs : entry.ttlMs;
    const expiresAt = ttlMs === null ? null : this.now() + ttlMs;
    // 幂等: 同 id 后写为准.
    this.entries.set(entry.id, { entry: { ...entry }, expiresAt });
    this.sweepExpired();
  }

  async recall(query: MemoryRecallQuery): Promise<readonly MemoryHit[]> {
    if (!query.tenantId) {
      throw new EngineCoreError(EngineErrorCode.INVALID_INPUT, 'InMemoryMemoryStore.recall: tenantId 不能为空');
    }
    if (!query.sessionId) {
      throw new EngineCoreError(EngineErrorCode.INVALID_INPUT, 'InMemoryMemoryStore.recall: sessionId 不能为空');
    }
    const limit = this.resolveLimit(query.limit);
    const now = this.now();
    const hits: MemoryHit[] = [];

    for (const stored of this.entries.values()) {
      const entry = stored.entry;
      // 租户 + 会话双条件: 跨租户 / 跨会话都不该被召回.
      if (entry.tenantId !== query.tenantId) continue;
      if (entry.sessionId !== query.sessionId) continue;
      if (stored.expiresAt !== null && stored.expiresAt <= now) continue;
      if (query.tiers && !query.tiers.includes(entry.tier)) continue;
      if (query.minImportance !== undefined && entry.importance < query.minImportance) continue;
      // 无语义相关度: score 恒 0, 排序退化为重要度 → 发生时间.
      hits.push({ entry: { ...entry }, score: 0 });
    }

    hits.sort((a, b) => b.entry.importance - a.entry.importance || b.entry.occurredAt - a.entry.occurredAt);
    return hits.slice(0, limit);
  }

  // ── private ────────────────────────────────────────────────────

  /** 清扫已过期条目 (写入时顺带做, 避免专门跑定时任务). */
  private sweepExpired(): void {
    const now = this.now();
    for (const [id, stored] of this.entries) {
      if (stored.expiresAt !== null && stored.expiresAt <= now) {
        this.entries.delete(id);
      }
    }
  }

  private resolveLimit(limit: number | undefined): number {
    if (limit === undefined) return DEFAULT_MEMORY_RECALL_LIMIT;
    if (!Number.isFinite(limit) || limit < 1) {
      throw new EngineCoreError(EngineErrorCode.INVALID_INPUT, `InMemoryMemoryStore.recall: limit 必须是 >= 1 的有限数, 收到 ${limit}`);
    }
    return Math.min(Math.floor(limit), MAX_MEMORY_RECALL_LIMIT);
  }

  private assertValidEntry(entry: MemoryEntry): void {
    if (!entry.tenantId) {
      throw new EngineCoreError(EngineErrorCode.INVALID_INPUT, 'InMemoryMemoryStore.remember: tenantId 不能为空');
    }
    if (!entry.id) {
      throw new EngineCoreError(EngineErrorCode.INVALID_INPUT, 'InMemoryMemoryStore.remember: id 不能为空');
    }
    if (!entry.sessionId) {
      throw new EngineCoreError(EngineErrorCode.INVALID_INPUT, 'InMemoryMemoryStore.remember: sessionId 不能为空');
    }
    if (!Number.isFinite(entry.importance) || entry.importance < 0 || entry.importance > 1) {
      throw new EngineCoreError(
        EngineErrorCode.INVALID_INPUT,
        `InMemoryMemoryStore.remember: importance 必须落在 [0,1], 收到 ${entry.importance}`,
        { id: entry.id, importance: entry.importance },
      );
    }
    if (entry.ttlMs !== undefined && entry.ttlMs !== null && (!Number.isFinite(entry.ttlMs) || entry.ttlMs < 0)) {
      throw new EngineCoreError(
        EngineErrorCode.INVALID_INPUT,
        `InMemoryMemoryStore.remember: ttlMs 必须是非负有限数或 null, 收到 ${entry.ttlMs}`,
        { id: entry.id, ttlMs: entry.ttlMs },
      );
    }
  }
}
