// V2026-10-28 治本 (WP0 · 引擎内核 · 记忆仓储端口):
//   职责: 定义来访者分层记忆 (工作 / 短时 / 长时) 的读写契约.
//         WP0 只立端口 + 内存实现; WP2 用 Qdrant 版替换内存版, **接口不变**.
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
//   如何验证:
//     1. pnpm build 0 错
//     2. InMemoryMemoryStore 的 TTL 过期 / limit clamp / tier 过滤有单测覆盖
//     3. WP2 换 Qdrant 实现时本文件零改动

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
 * 一条记忆.
 *
 * 字段口径:
 *   - tier      决定保留期与检索路径 (三级记忆的核心区分)
 *   - importance 重要度 [0,1]: 1 = 绝不可忘. 遗忘机制 (竞争抑制) 属 WP2,
 *                 WP0 只把该字段纳入契约并做区间校验, 保证 Qdrant 版有同样的取值域
 *   - ttlMs     相对过期时长. null = 永不过期; 省略 = 由实现侧的默认 TTL 决定
 *   - occurredAt 事件发生时刻 (ms). 与写入时刻分离 —— 跨会话接续时二者可能差很远
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
}

/**
 * 召回查询.
 *
 * `query` 字段语义: 当前议题的语义检索词 (WP2 用它做向量检索 Top5).
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
  /** 重要度下限过滤. 省略 = 不按重要度过滤. */
  readonly minImportance?: number;
  /** 分层过滤. 省略 = 全层召回. */
  readonly tiers?: readonly MemoryTier[];
}

/**
 * 召回命中项.
 *
 * `score` = 相关度 [0,1]. 内存实现无语义检索, 恒为 0 (表示"无相关度可计算",
 * 排序退化为重要度 + 时间); Qdrant 实现填 cosine 相似度.
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
 *   - recall 只返回未过期的条目;
 *   - recall 返回的 entry 必须是副本, 调用方改动不影响仓储内部状态.
 */
export interface MemoryStore {
  /**
   * 写入一条记忆.
   * @param entry 待写条目
   * @throws EngineCoreError code=INVALID_INPUT tenantId / id / sessionId 为空 / importance 越界 / ttlMs 非法
   */
  remember(entry: MemoryEntry): Promise<void>;

  /**
   * 按租户 + 会话召回记忆.
   * @param query 召回条件
   * @returns 命中列表, 已按相关度 / 重要度 / 时间排序并截断
   */
  recall(query: MemoryRecallQuery): Promise<readonly MemoryHit[]>;
}
