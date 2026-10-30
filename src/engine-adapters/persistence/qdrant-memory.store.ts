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
//       upsert + search + setPayload + scroll 四个方法; 声明窄接口让单测能用极小 stub,
//       也让"以后换向量库"只需换这一个窄面, 而不是整个 service.
//     - **不自己写召回判定** —— 判定统一走内核的 evaluateRecallCandidate (内存版同款),
//       杜绝"内存版按原始重要度过滤 / Qdrant 版按衰减后过滤"这种换实现即漂移.
//     - **不用文本子串过滤** —— 语义检索由向量负责; 再加一层子串过滤等于把
//       "同义词也算相关"的语义检索降级成关键词匹配.
//     - **不物理删除被取代的记忆** (M4) —— 只在 payload 上标 supersededBy.
//
//   V2026-10-30 治本 (WP12 · 补 WP2 写侧缺口):
//     **写侧冲突消解标记** —— WP2 交付时本文件**没有**做冲突标记, 原因是当时
//     QdrantService 既没有 "只改 payload 不改向量" (setPayload), 也没有
//     "仅按 filter 取点" (scroll) 两个能力. WP12 把这两个能力补上后, 缺口关闭:
//       写新记忆前 → scroll 出同 tenant+visitor+topicKey 的旧点 →
//       走内核 `applyConflictResolution` 选存活者 →
//       存活者是新条目: 给旧点 setPayload({supersededBy: 新条目 id});
//       存活者是旧条目: 新条目**带着** supersededBy 一起落库.
//     仍然**不物理删除**旧点 (M4): 被取代的记忆是审计线索.
//
//   V2026-10-30 治本 (WP12 · §1.3 配置化):
//     衰减半衰期与访客范围召回阈值改为**可配置** (见 persistence/memory-config.ts).
//     本文件在 visitor 范围用配置值算"有效重要度"(门槛判定 + 排序都用它),
//     内核的共享判定仍原样跑 (内核常量本轮不改, 见 memory-config.ts 顶部说明).
//     默认配置下 (30 天 / 0.1) 与现状**逐字一致**.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/qdrant-memory-store.spec.ts: payload 映射 / score 映射 / 降级不炸
//     3. test/engine-adapters/wp12-memory-closeout.spec.ts: 冲突标记 / 配置门槛

import { Logger } from '@nestjs/common';

import { DEFAULT_MEMORY_CONFIG, type MemoryConfig } from './memory-config';
import {
  applyConflictResolution,
  assertValidMemoryEntry,
  assertValidMemoryRecallQuery,
  effectiveImportance,
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
 * 冲突扫描的最大取点数 (WP12).
 *
 * 为什么封顶: scroll 是**无分页的全量取**, 一个来访者的同一主题理论上可以无限多条.
 * 不封顶的话, 一个"什么都往同一个 topicKey 里塞"的来访者能把一次写入拖成全表扫描.
 * 封顶后的失败方向是安全的: 超出部分**不被标记** (旧点仍可召回) —— 也就是
 * "少标记几条冲突", 而不是"错标 / 误删".
 */
export const CONFLICT_SCAN_LIMIT = 200;

/**
 * B 层对 Qdrant 的**最小依赖面**.
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
  /**
   * 只改 payload, 不动向量 (WP12 · 冲突标记).
   *
   * 必须存在: 没有它就**无法**做"只标记不删除" —— 重新 upsert 会连向量一起覆盖.
   */
  setPayload(collection: string, id: string, payload: Record<string, unknown>): Promise<void>;
  /**
   * 按 filter 滚动取点 (WP12 · 冲突扫描).
   *
   * 必须存在: 用向量相似度反查冲突分组会**漏召回** (语义相近 ≠ 同主题).
   */
  scroll(collection: string, filter: Record<string, unknown>, limit?: number): Promise<{ id: string; payload: Record<string, unknown> }[]>;
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
  /** 衰减/召回配置 (WP12; 省略 = 内核同值种子 30 天 / 0.1). */
  readonly config?: MemoryConfig;
}

/** payload → 条目的解析结果 (含存储侧才有的过期时刻). */
interface DecodedEntry {
  readonly entry: MemoryEntry;
  readonly expiresAt: number | null;
}

/** 冲突消解后待落库的结果 (WP12). */
interface ConflictResolved {
  /** 真正要落库的条目 (可能带上了 supersededBy). */
  readonly entry: MemoryEntry;
  /** 需要被标 supersededBy 的**旧**点 id (存活者是新条目时才有). */
  readonly oldLoserIds: readonly string[];
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
  /** 衰减/召回配置 (WP12). */
  private readonly config: MemoryConfig;

  constructor(options: QdrantMemoryStoreOptions) {
    this.qdrant = options.qdrant;
    this.embedder = options.embedder;
    this.fallback = options.fallback ?? new InMemoryMemoryStore();
    this.collection = options.collection ?? VISITOR_LONG_MEMORY_COLLECTION;
    this.defaultTtlMs = options.defaultTtlMs ?? null;
    this.now = options.now ?? Date.now;
    this.config = options.config ?? DEFAULT_MEMORY_CONFIG;
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

    // WP12: 写新点**之前**先做冲突消解 —— 顺序不能反:
    //   先写后标记 → 新点已经落库, 旧点还没标记, 那个窗口里召回会同时返回新旧两条;
    //   先算后写   → 落库那一刻 payload 就是最终态, 没有中间态.
    const resolved = await this.resolveConflict(entry);

    try {
      await this.qdrant.upsert(this.collection, resolved.entry.id, [...vector], this.toPayload(resolved.entry));
    } catch (e) {
      this.logger.warn(`[remember] Qdrant 写入失败, 落会话级回落仓 id=${entry.id}: ${(e as Error).message}`);
      await this.fallback.remember(resolved.entry);
      return;
    }

    // 标记旧点: 失败只 warn —— 标记失败的后果是"旧点没被排除"(可能同时召回新旧两条),
    // 不是数据损坏. 但**必须留痕**, 否则这种漂移在审计里看不见.
    for (const loserId of resolved.oldLoserIds) {
      try {
        await this.qdrant.setPayload(this.collection, loserId, { supersededBy: resolved.entry.id });
      } catch (e) {
        this.logger.warn(`[remember] 冲突标记失败 (旧点未被排除) loser=${loserId} survivor=${resolved.entry.id}: ${(e as Error).message}`);
      }
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

      // WP12: 配置化的有效重要度 (半衰期来自 env).
      //   默认配置下 (30 天) 与内核口径**完全一致**, 这里等于不做任何改变;
      //   env 调过之后, 门槛判定与排序都以配置口径为准 (内核地板仍在, 见 memory-config.ts).
      const configuredEffective = effectiveImportance(decoded.entry, now, this.config.decayHalfLifeMs);
      if (configuredEffective < this.config.recallThreshold) continue;

      ranked.push({
        hit: { entry: decoded.entry, score: clamp01(point.score) },
        effectiveImportance: configuredEffective,
      });
    }

    // 排序: 语义相关度为主, 有效重要度为辅 (WP2 §5.2).
    ranked.sort((a, b) => b.hit.score - a.hit.score || b.effectiveImportance - a.effectiveImportance);
    return ranked.slice(0, limit).map((item) => item.hit);
  }

  // ── private ────────────────────────────────────────────────────

  /**
   * 冲突消解: 找出同主题旧点, 走内核纯函数选存活者 (WP12).
   *
   * 走内核纯函数而不是自己判"新的赢": 内核 `applyConflictResolution` 的规则是
   * **时间新 → 重要度高 → id 字典序**, 三级确定性. 自己写一遍"新的赢"= 换一套规则,
   * 与内存版对不上 (同一份记忆, 换个存储实现结论就变 —— 那是最难查的漂移).
   *
   * 失败方向是安全的: 扫描失败 → 不做标记 (旧点仍可召回, 少一条冲突标记);
   * 绝不因为"标不了"就把新条目也拒掉.
   *
   * @param entry 待写入的新条目
   * @returns 落库条目 + 需要打标的旧点 id
   */
  private async resolveConflict(entry: MemoryEntry): Promise<ConflictResolved> {
    const topicKey = entry.topicKey?.trim() ?? '';
    // 冲突分组键是"同 tenant + 同 visitor + 同 topicKey"; 缺任一 → 不构成冲突组.
    if (!topicKey || !entry.visitorId) {
      return { entry, oldLoserIds: [] };
    }

    let points: { id: string; payload: Record<string, unknown> }[];
    try {
      points = await this.qdrant.scroll(this.collection, this.buildConflictFilter(entry, topicKey), CONFLICT_SCAN_LIMIT);
    } catch (e) {
      this.logger.warn(`[remember] 冲突扫描失败, 跳过标记 (不阻断写入) id=${entry.id}: ${(e as Error).message}`);
      return { entry, oldLoserIds: [] };
    }

    const group: MemoryEntry[] = [];
    for (const point of points) {
      const decoded = this.toEntry(point.id, point.payload);
      if (!decoded) continue;
      // 已被取代的点不再参与冲突组 —— 否则会出现"A 取代 B, B 又取代 A"的链式打架.
      if (decoded.entry.supersededBy) continue;
      if (decoded.entry.id === entry.id) continue;
      group.push(decoded.entry);
    }
    if (group.length === 0) {
      return { entry, oldLoserIds: [] };
    }

    const { survivor, superseded } = applyConflictResolution([...group, entry]);
    const oldLosers = superseded.filter((item) => item.id !== entry.id).map((item) => item.id);

    if (survivor.id === entry.id) {
      // 新条目存活 → 旧点全部打标.
      return { entry, oldLoserIds: oldLosers };
    }
    // 旧条目存活 → 新条目自己带上 supersededBy 一起落库 (它一落库就已经是"被取代"态).
    const newLoser = superseded.find((item) => item.id === entry.id);
    const supersededBy = newLoser?.supersededBy ?? survivor.id;
    return { entry: { ...entry, supersededBy }, oldLoserIds: oldLosers };
  }

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

  /**
   * 冲突扫描过滤条件 (WP12): 租户 + 来访者 + 主题键.
   *
   * 刻意**不带** sessionId: 冲突要跨会话找 (同一来访者同一主题, 上一场写的也要找出来).
   */
  private buildConflictFilter(entry: MemoryEntry, topicKey: string): Record<string, unknown> {
    return {
      must: [
        { key: 'tenantId', match: { value: entry.tenantId } },
        { key: 'visitorId', match: { value: entry.visitorId } },
        { key: 'topicKey', match: { value: topicKey } },
      ],
    };
  }
}
