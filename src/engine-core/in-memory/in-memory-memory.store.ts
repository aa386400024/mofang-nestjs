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
//       有效重要度 → 发生时间, 并在代码与文档里显式写明"无语义相关度".
//     - 不在 remember 时抛"重复 id" —— 记忆写入天然会重放 (重试 / 跨会话接续),
//       幂等覆盖 (后写为准) 才是正确语义.
//     - 不给 recall 加"分页游标" —— 召回量是 Top5 量级, 分页是过度设计.
//     - **不自己写召回判定** —— 判定统一走 memory/recall-policy.ts 的纯函数
//       (内存版与 Qdrant 版共用), 杜绝"两套实现两套语义"的漂移.
//     - 不自己写条目校验 / limit clamp —— 同上, 走 domain/ports/memory.store.ts 的共享 helper.
//
//   WP2 行为变化 (scope=visitor):
//     - scope='session' (默认): 与 WP0 **完全一致** (租户+会话, 原始 important 过滤,
//       有效重要度 = 原始 important, 排序 = 重要度 → 时间). 零回归.
//     - scope='visitor': 租户+来访者跨会话, 只返回长时, 叠加重要度衰减与阈值过滤.
//
//   如何验证:
//     1. pnpm build 0 错
//     2. test/engine-core/engine-core.spec.ts (WP0 既有) 零改动通过
//     3. test/engine-core/wp2-memory.spec.ts 覆盖: scope=visitor / 衰减 / superseded 过滤

import {
  assertValidMemoryEntry,
  assertValidMemoryRecallQuery,
  resolveMemoryRecallLimit,
  type MemoryEntry,
  type MemoryHit,
  type MemoryRecallQuery,
  type MemoryStore,
} from '../domain/ports/memory.store';
import { evaluateRecallCandidate } from '../memory/recall-policy';

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

/** 召回命中 + 排序用的有效重要度 (内部用, 不进端口契约). */
interface RankedHit {
  readonly hit: MemoryHit;
  readonly effectiveImportance: number;
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
    assertValidMemoryEntry(entry);
    const ttlMs = entry.ttlMs === undefined ? this.defaultTtlMs : entry.ttlMs;
    const expiresAt = ttlMs === null ? null : this.now() + ttlMs;
    // 幂等: 同 id 后写为准.
    this.entries.set(entry.id, { entry: { ...entry }, expiresAt });
    this.sweepExpired();
  }

  async recall(query: MemoryRecallQuery): Promise<readonly MemoryHit[]> {
    assertValidMemoryRecallQuery(query);
    const limit = resolveMemoryRecallLimit(query.limit);
    const now = this.now();
    const ranked: RankedHit[] = [];

    for (const stored of this.entries.values()) {
      const evaluation = evaluateRecallCandidate(stored.entry, stored.expiresAt, query, now);
      if (!evaluation.accepted) continue;
      // 无语义相关度: score 恒 0, 排序退化为有效重要度 → 发生时间.
      ranked.push({
        hit: { entry: { ...stored.entry }, score: 0 },
        effectiveImportance: evaluation.effectiveImportance,
      });
    }

    ranked.sort((a, b) => b.effectiveImportance - a.effectiveImportance || b.hit.entry.occurredAt - a.hit.entry.occurredAt);
    return ranked.slice(0, limit).map((item) => item.hit);
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
}
