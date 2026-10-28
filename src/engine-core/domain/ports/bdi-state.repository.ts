// V2026-10-28 治本 (WP0 · 引擎内核 · BDI 状态仓储端口):
//   职责: 定义 BDI 状态快照的读写契约. 内核只认这个接口, 不认任何具体实现
//         (内存版 / 未来 MySQL 版 / 未来 Redis 版都可替换, 上层零感知).
//   边界: 纯 TS, 零 @nestjs/* / typeorm. 禁止在这里出现 EntityManager / Repository<T>.
//
//   反双胞胎:
//     - 不用 TypeORM 的 generic Repository<BdiState> —— 那会把"框架实体"概念漏进内核,
//       将来内核搬去独立微服务时整包带不走 (roadmap 第 0 原则).
//     - 不暴露 EntityManager —— 内核不写 SQL, 也不该有能力写 SQL.
//     - 不把领域模型 BdiSnapshot 和存储行 BdiStateRecord 合成一个类型 ——
//       领域模型是"状态是什么", 存储行是"这条记录怎么落库" (revision / updatedAt 是
//       持久化侧概念). 合成一个类型的后果: 领域模型被迫背上持久化字段, 而
//       Qdrant 版 / Redis 版根本没有"行"的概念, 届时要么造伪字段, 要么改契约.
//     - 不在接口里加 delete / list —— WP0 无删除语义; 需要时按"接口演进"另起版本,
//       而不是提前铺一堆没人调的方法.
//
//   并发语义 (重要): 端口约定 **乐观锁** ——
//     save 传入的 record.revision 必须严格大于已存 revision, 否则视为并发写冲突.
//     理由: 内核未来多实例部署 (每实例一个 handle 表), 两个实例可能同时读到同一
//     revision 并各自推进. 没有这条约束, 后写者会静默覆盖先写者的状态, 且**无法追溯** ——
//     这是"内核无全局单例假设"必须配套的最后一块拼图.
//
//   如何验证:
//     1. pnpm build 0 错
//     2. InMemoryBdiStateRepository 的 revision 冲突路径有单测覆盖
//     3. 换实现 (Qdrant/Redis) 时本文件零改动

import type { BdiSnapshot } from '../bdi-snapshot';

/**
 * BDI 状态的持久化记录.
 *
 * 与领域模型 BdiSnapshot 的分工:
 *   - BdiSnapshot  = "状态本身" (纯领域语义, 无存储痕迹)
 *   - BdiStateRecord = "这条状态怎么存的" (租户归属 + 会话归属 + 版本 + 时间戳)
 */
export interface BdiStateRecord {
  /**
   * 租户隔离键.
   *
   * 为什么按租户+会话双键, 而不是只用 sessionId:
   *   本仓库既有仓储 (PersonaRepository / SupervisionReportRepository) **一律**租户隔离,
   *   这里若只按 sessionId 建索引, 等于埋一个"sessionId 全局唯一"的隐含假设 ——
   *   而 sessionId 的生成策略未来可能改 (比如按租户递增), 届时跨租户串号是静默的.
   *   显式双键 = 把隔离写进契约, 换成任何存储实现都不会漏.
   */
  readonly tenantId: string;
  /** 会话 id (状态归属维度). */
  readonly sessionId: string;
  /**
   * 版本号 (单调递增).
   * 首次落库为 1; 之后每次 save 必须是「已存 revision + 1」, 否则仓储抛 STATE_CONFLICT.
   */
  readonly revision: number;
  /** 最后写入时间 (ms timestamp). */
  readonly updatedAt: number;
  /** 状态快照. */
  readonly snapshot: BdiSnapshot;
}

/**
 * BDI 状态仓储端口.
 *
 * 实现方约定:
 *   - load 未命中返回 null (**不抛错**) —— "还没有状态"是正常分支, 由调用方显式判空;
 *   - save 返回**落库后的记录** (含仓储侧归一化结果, 如补齐时间戳);
 *   - save 必须在存取边界做防御性拷贝, 调用方持有的快照与仓储持有的快照互不影响.
 */
export interface BdiStateRepository {
  /**
   * 按租户 + 会话加载状态.
   * @param tenantId 租户隔离键
   * @param sessionId 会话 id
   * @returns 状态记录; 从未存过则返回 null (不抛错)
   */
  load(tenantId: string, sessionId: string): Promise<BdiStateRecord | null>;

  /**
   * 保存状态 (乐观锁).
   *
   * @param record 待存记录; revision 必须大于已存 revision (首次落库 >= 1)
   * @returns 落库后的记录
   * @throws EngineCoreError code=STATE_CONFLICT revision 不单调递增
   * @throws EngineCoreError code=INVALID_INPUT tenantId / sessionId 为空 / revision 非法
   */
  save(record: BdiStateRecord): Promise<BdiStateRecord>;
}
