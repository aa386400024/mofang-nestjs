// V2026-10-28 治本 (WP0 · 引擎内核 · 记忆仓储端口):
//   职责: 定义来访者分层记忆 (工作 / 短时 / 长时) 的读写契约.
//         WP0 立端口 + 内存实现; WP2 追加可选字段 + Qdrant 版实现, **端口签名不破坏**.
//   边界: 纯 TS, 零 @nestjs/* / typeorm. 禁止出现 Qdrant 客户端 / EntityManager.
//
//   反双胞胎:
//     - 不用 TypeORM generic Repository<MemoryEntry> —— 同 bdi-state.repository.ts:
//       会把框架实体概念漏进内核.
//     - 不直接暴露 Qdrant 的 PointStruct / Filter —— 那是 Qdrant 版实现的内部语言,
//       漏进端口 = 所有实现都被 Qdrant 绑架, "接口不变"直接作废.
//     - 不用"三套独立接口"(工作记忆接口 / 短时记忆接口 / 长时记忆接口) —— 三级记忆是
//       **同一份记忆的不同保留期**, 写入路径与检索路径共用; 拆三套接口会让
//       "一条记忆从工作级晋升到长时级"写成跨接口搬运仪式, 而实际上只是 tier 字段变了.
//     - 不把"召回条数"硬编在实现里 —— 召回上限是**调用方的策略**, 由查询参数传入,
//       实现只负责 clamp 到安全区间.
//
//   三级记忆 (借 AnnaAgent) 与本端口的对应:
//     - Working  工作记忆: 当前回合上下文, 最近 8 轮, 直接参与本轮决策
//     - ShortTerm 短时记忆: 单会话完整摘要, 伴随会话全程, 会话结束转长时
//     - LongTerm  长时记忆: 跨会话核心事实 / 情绪体验 / 关系变化
//
//   WP2 演进 (只追加可选字段, 向后兼容):
//     - MemoryEntry 追加 visitorId / topicKey / supersededBy;
//     - MemoryRecallQuery 追加 visitorId / scope;
//     - 新增 MemoryRecallScope (字符串联合, 非 enum —— 它是纯控制流判别式,
//       不需要运行时值, 用 union 可让内核零运行时依赖).
//     WP0/WP1 已发布的签名与既有测试**零改动**继续成立.
//
//   为什么共享校验/上限常量放在**端口文件**里 (而不是某个实现里):
//     内存版与 Qdrant 版必须对"什么算合法条目 / 召回上限多少"有**同一份**答案.
//     两边各写一份 = 迟早漂移, 而漂移方向恰好是"某版放过了另一版拦住的脏数据".
//     契约级的东西放契约文件, 是唯一能杜绝这种双胞胎的位置.
//
//   如何验证:
//     1. pnpm build 0 错
//     2. InMemoryMemoryStore 的 TTL 过期 / limit clamp / tier 过滤有单测覆盖
//     3. WP2 换 Qdrant 实现时本文件只需追加, 不改既有字段

import { EngineCoreError, EngineErrorCode } from '../engine-errors';

/** 记忆分层 (三级记忆). */
export enum MemoryTier {
  /** 工作记忆: 当前回合上下文, 最近 8 轮, 直接参与本轮决策. */
  WORKING = 'working',
  /** 短时记忆: 单会话完整摘要, 伴随会话全程, 会话结束转长时. */
  SHORT_TERM = 'shortTerm',
  /** 长时记忆: 跨会话核心事实 / 情绪体验 / 关系变化. */
  LONG_TERM = 'longTerm',
}

/** 记忆来源 (决定该条记忆的信任口径与后续处理路径). */
export enum MemorySource {
  /** 来自会话原始轮次 (工作记忆主力来源). */
  TURN = 'turn',
  /** 来自模型生成的会话摘要 (短时记忆主力来源). */
  SUMMARY = 'summary',
  /** 来自人工 / 外部注入 (如督导标注的关键事实). */
  MANUAL = 'manual',
}

/**
 * 召回范围.
 *
 * 用字符串联合而不是 enum:
 *   - 它是**纯控制流判别式**, 不需要运行时值 (不需要 `MemoryRecallScope.VISITOR`);
 *   - 内核保持"零运行时导出"的纯 TS 形态, 整包搬走时不需要附带常量表;
 *   - 调用点写 `'visitor'` 比写 `MemoryRecallScope.VISITOR` 更短, 且
 *     序列化 (JSON payload / 跨进程调用) 时天然是字符串, 无转换成本.
 */
export type MemoryRecallScope = 'session' | 'visitor';

/**
 * 一条记忆.
 *
 * 字段口径:
 *   - tier      决定保留期与检索路径 (三级记忆的核心区分)
 *   - importance 重要度 [0,1]: 1 = 绝不可忘
 *   - ttlMs     相对过期时长. null = 永不过期; 省略 = 由实现侧的默认 TTL 决定
 *   - occurredAt 事件发生时刻 (ms). 与写入时刻分离 —— 跨会话接续时二者可能差很远
 *   - visitorId 稳定来访者标识. 带 visitorId 的长时记忆可被访客范围跨会话召回;
 *               不带 = 会话级长时 (WP0 语义), 访客范围不可见 (写入期不拒收)
 *   - topicKey  冲突消解分组键. 同 tenant+visitor+topicKey 内只留存活者
 *   - supersededBy 被哪条存活条目取代. 非空 = 已被取代, **不参与召回**
 */
export interface MemoryEntry {
  /** 租户隔离键. 与会话 id 组成复合归属, 防跨租户召回. */
  readonly tenantId: string;
  /** 记忆 id (全局唯一). */
  readonly id: string;
  /** 归属会话 id. */
  readonly sessionId: string;
  /** 记忆分层. */
  readonly tier: MemoryTier;
  /** 记忆来源. */
  readonly source: MemorySource;
  /** 记忆正文. */
  readonly content: string;
  /** 重要度 [0,1]. */
  readonly importance: number;
  /** 事件发生时刻 (ms timestamp). */
  readonly occurredAt: number;
  /** 相对过期时长 (ms). null = 永不过期; 省略 = 用实现侧默认值. */
  readonly ttlMs?: number | null;
  /**
   * 稳定来访者标识 (WP2).
   *
   * 跨会话召回按 tenant+visitor 归属, 不按 sessionId
   * (sessionId 每场会话都变, 用它归属 = 永远召不回到上一场).
   *
   * 可缺省, 两种语义:
   *   - 带 visitorId → 可被 scope='visitor' 跨会话召回;
   *   - 不带         → 会话级记忆, 只能在本会话内召回.
   * 写入期**不强制**: 缺 visitorId 的后果是"这条跨会话召不回" (可用性损失),
   * 而不是"别的访客召回了我的记忆" (隐私事故) —— 失败方向必须安全.
   */
  readonly visitorId?: string;
  /**
   * 冲突消解分组键 (WP2).
   *
   * 同 tenant + visitor + topicKey 的多条记忆视为同一"主题", 由
   * memory/conflict-resolution.ts 的纯函数选存活者. 本期由写入方显式给,
   * 不做语义聚类 (聚类需向量/模型, 超本期).
   */
  readonly topicKey?: string;
  /**
   * 被哪条存活条目取代 (WP2).
   *
   * 非空 = 该条已被取代, 召回时排除. 冲突消解**只标记不删除** (M4),
   * 保留审计可回溯.
   */
  readonly supersededBy?: string | null;
}

/**
 * 召回查询.
 *
 * `query` 字段语义: 当前议题的语义检索词 (Qdrant 版用它做向量检索 Top5).
 * 内存实现**不做**文本过滤 —— 见 InMemoryMemoryStore 的注释, 避免"内存版按子串过滤、
 * Qdrant 版按向量过滤"的双胞胎行为差异 (同一份内核代码换实现后行为变了, 是最难查的漂移).
 */
export interface MemoryRecallQuery {
  /** 租户隔离键. */
  readonly tenantId: string;
  /** 归属会话 id. */
  readonly sessionId: string;
  /** 当前议题语义检索词. */
  readonly query: string;
  /** 召回条数上限. 省略取默认 (5), 实现侧 clamp 到安全区间. */
  readonly limit?: number;
  /**
   * 重要度下限过滤. 省略 = 不过滤.
   *
   * ⚠️ **按范围口径不同** (这是刻意的, 不是疏漏):
   *   - scope='session' → 按条目**原始** importance 比 (与 WP0 完全一致, 不引入衰减);
   *   - scope='visitor' → 按**衰减后**的有效重要度比 —— 长时召回问的是"现在还重要吗",
   *     若拿原始值比, 30 天前的重要事实永远满分, 衰减机制就形同虚设.
   */
  readonly minImportance?: number;
  /** 分层过滤. 省略 = 全层召回. */
  readonly tiers?: readonly MemoryTier[];
  /**
   * 跨会话召回归属键 (WP2). scope='visitor' 时必填.
   *
   * 缺省 = 走 scope='session' 的 WP0 行为 (不报错), 保证向后兼容.
   */
  readonly visitorId?: string;
  /**
   * 召回范围 (WP2):
   *   - 'session' (默认) —— tenant + sessionId 双匹配, 行为与 WP0 完全一致;
   *   - 'visitor'       —— tenant + visitorId 跨会话, **只返回 LONG_TERM**.
   */
  readonly scope?: MemoryRecallScope;
}

/**
 * 召回命中项.
 *
 * `score` = 相关度 [0,1]. 内存实现无语义检索, 恒为 0 (表示"无相关度可计算",
 * 排序退化为重要度 + 时间); Qdrant 实现填 cosine 相似度 (负值 clamp 到 0).
 * 保留这个字段是让 WP2 换实现时**端口签名不变** (任务单 §6 明确要求"接口不变").
 */
export interface MemoryHit {
  /** 命中的记忆条目. */
  readonly entry: MemoryEntry;
  /** 相关度 [0,1]. */
  readonly score: number;
}

/**
 * 记忆仓储端口.
 *
 * 实现方约定:
 *   - remember 幂等: 同 id 重复写入以**后写为准**覆盖;
 *   - recall 只返回未过期、未被取代的条目;
 *   - recall 返回的 entry 必须是副本, 调用方改动不影响仓储内部状态;
 *   - recall 的**判定语义**统一走 memory/recall-policy.ts 的纯函数, 不允许各实现自写一套.
 */
export interface MemoryStore {
  /**
   * 写入一条记忆.
   * @param entry 待写条目
   * @throws EngineCoreError code=INVALID_INPUT tenantId / id / sessionId 为空 / importance 越界 /
   *         ttlMs 非法 / LONG_TERM 缺 visitorId
   */
  remember(entry: MemoryEntry): Promise<void>;

  /**
   * 按租户 + 会话 (或租户 + 来访者) 召回记忆.
   * @param query 召回条件
   * @returns 命中列表, 已按相关度 / 有效重要度 / 时间排序并截断
   */
  recall(query: MemoryRecallQuery): Promise<readonly MemoryHit[]>;
}

// ────────────────────────────────────────────────────────────────────
// 共享契约辅助 —— 内存版与 Qdrant 版**必须**用同一份, 杜绝双胞胎漂移
// ────────────────────────────────────────────────────────────────────

/** 默认召回条数 (对齐 WP2 的 Top5 口径). */
export const DEFAULT_MEMORY_RECALL_LIMIT = 5;

/** 单次召回条数上限 (防止调用方一次拉爆内存). */
export const MAX_MEMORY_RECALL_LIMIT = 50;

/**
 * 归一化召回条数: 默认 5, 上限 50, 非法值抛错.
 *
 * @param limit 调用方传入的条数 (可省略)
 * @returns 归一化后的条数
 * @throws EngineCoreError code=INVALID_INPUT limit 非有限数或 < 1
 */
export function resolveMemoryRecallLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_MEMORY_RECALL_LIMIT;
  if (!Number.isFinite(limit) || limit < 1) {
    throw new EngineCoreError(EngineErrorCode.INVALID_INPUT, `resolveMemoryRecallLimit: limit 必须是 >= 1 的有限数, 收到 ${limit}`);
  }
  return Math.min(Math.floor(limit), MAX_MEMORY_RECALL_LIMIT);
}

/**
 * 校验一条记忆条目 (所有实现共用的唯一口径).
 *
 * @param entry 待校验条目
 * @throws EngineCoreError code=INVALID_INPUT 字段非法
 */
export function assertValidMemoryEntry(entry: MemoryEntry): void {
  if (!entry.tenantId) {
    throw new EngineCoreError(EngineErrorCode.INVALID_INPUT, 'assertValidMemoryEntry: tenantId 不能为空');
  }
  if (!entry.id) {
    throw new EngineCoreError(EngineErrorCode.INVALID_INPUT, 'assertValidMemoryEntry: id 不能为空');
  }
  if (!entry.sessionId) {
    throw new EngineCoreError(EngineErrorCode.INVALID_INPUT, 'assertValidMemoryEntry: sessionId 不能为空');
  }
  if (!Number.isFinite(entry.importance) || entry.importance < 0 || entry.importance > 1) {
    throw new EngineCoreError(
      EngineErrorCode.INVALID_INPUT,
      `assertValidMemoryEntry: importance 必须落在 [0,1], 收到 ${entry.importance}`,
      { id: entry.id, importance: entry.importance },
    );
  }
  if (entry.ttlMs !== undefined && entry.ttlMs !== null && (!Number.isFinite(entry.ttlMs) || entry.ttlMs < 0)) {
    throw new EngineCoreError(EngineErrorCode.INVALID_INPUT, `assertValidMemoryEntry: ttlMs 必须是非负有限数或 null, 收到 ${entry.ttlMs}`, {
      id: entry.id,
      ttlMs: entry.ttlMs,
    });
  }
  // 注意: 这里**不**强制"长时记忆必须带 visitorId".
  //
  // 长时记忆有两种合法形态:
  //   a) 会话级长时 (无 visitorId) —— 归属于某个 session, 只在本会话内召回;
  //   b) 跨会话长时 (有 visitorId) —— 归属于稳定来访者, 可被 scope=visitor 召回.
  // 在写入期强制要求 visitorId, 等于把形态 (a) 判成非法 —— 而 WP0 的记忆仓储契约
  // (tier 过滤 / TTL / 租户隔离) 明确允许"本场会话内的长时事实"不带 visitorId.
  // 硬校验会直接把既有合法用法打成 INVALID_INPUT, 属于对既有契约的破坏.
  //
  // 跨会话可见性改由**召回期**判定: scope=visitor 只召回带 visitorId 且与查询
  // visitorId 相等的条目; 不带 visitorId 的长时条目在访客范围下天然不可见.
  // 这样"漏写 visitorId"的后果是"这条记忆跨会话召不回" (可用性损失),
  // 而不是"别的访客召回了我的记忆" (隐私事故) —— 失败方向是安全的.
}

/**
 * 校验一条召回查询 (所有实现共用的唯一口径).
 *
 * @param query 待校验查询
 * @throws EngineCoreError code=INVALID_INPUT 字段非法
 */
export function assertValidMemoryRecallQuery(query: MemoryRecallQuery): void {
  if (!query.tenantId) {
    throw new EngineCoreError(EngineErrorCode.INVALID_INPUT, 'assertValidMemoryRecallQuery: tenantId 不能为空');
  }
  if (!query.sessionId) {
    throw new EngineCoreError(EngineErrorCode.INVALID_INPUT, 'assertValidMemoryRecallQuery: sessionId 不能为空');
  }
  if (query.scope === 'visitor' && !query.visitorId) {
    throw new EngineCoreError(EngineErrorCode.INVALID_INPUT, 'assertValidMemoryRecallQuery: scope=visitor 必须带 visitorId');
  }
}
