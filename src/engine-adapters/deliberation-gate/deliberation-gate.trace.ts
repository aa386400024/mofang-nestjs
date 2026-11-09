// V2026-11-09 治本 (Phase2.5 WP-C · 触发式审议闸门 · 决策留痕):
//   职责: 把每一次闸门判定写进 Redis (决策 + 理由 + delta 摘要 + 当时用的阈值 + 耗时).
//   边界: 只写 trace; 不参与判定; 写失败只记日志, 绝不抛.
//
//   为什么要有 trace:
//     闸门是"**决定花钱不花钱**"的开关 —— 它判错了, 症状是"成本曲线不对"或
//     "该跑审议的轮次没跑", 光看代码看不出来. 没有留痕 = 灰度期只能靠猜.
//     尤其要看的是: 各种 reason 的占比 (多少轮被冷却挡掉 / 多少轮触发了不确定).
//
//   ⚠️ **隐私**: trace 里只有 sessionId / 轮次 / 枚举 / 数值 —— **零对话原文**,
//     连"心理画像"都没有 (delta 是状态数值, 与审议 trace 同一档).
//     心理内容禁止进普通日志, 这条红线同样适用于这里.
//
//   V2026-11-09 治本 (Phase2.5 · 闸门 trace 查询接口): **三写** (Redis / MySQL / 写时计数)
//     职责: 同一条决策写三处 ——
//       ① Redis: 每轮一个 key (7 天热读, 原有逻辑**逐字不变**);
//       ② MySQL (`gate_decisions`): **真相源**, 长期可查 (列表 / 详情端点的数据源);
//       ③ Redis 日计数器 (`gate_stats:global:YYYY-MM-DD`): 看板按天聚合, O(1) 读.
//     为什么: WP-C 只写 Redis → 7 天 TTL + LRU 淘汰后数据没了 (复盘时最需要的就是它),
//       而且 Redis 里"每轮一个 key"没法全局列表 (只能 SCAN 全库, 生产阻塞命令).
//
//     ⚠️ **三处写互不影响**: 每一处各自 try/catch —— MySQL 挂了不影响 Redis 热读,
//       计数挂了不影响落库. 写不进去只是"少几行 / 少几个计数", 不是会话失败.
//
//     ⚠️ **隐私**: 落库的仍然只有 sessionId / 轮次 / 枚举 / 数值 / 阈值 / 耗时 ——
//       零对话原文, 零心理画像 (与本文件原有纪律同款).
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/deliberation-gate/quotas.spec.ts 覆盖 trace 写入
//     3. test/admin-debug/gate-decisions.spec.ts 覆盖查询口径与视图映射

import { Logger } from '@nestjs/common';

import type { RedisService } from '../../shared/infra/redis/redis.service.js';
import type { GateDecision, GateMode, GateReason, GateThresholds } from './deliberation-gate.types.js';
import { applyGateStats } from './gate-decision/gate-decision-stats.js';

/**
 * 闸门决策 trace 的 Redis key 前缀.
 *
 * ⚠️ 沿用审议层既有的 key 前缀风格 (deliberation_trace / deliberation_circuit),
 *   只是换成冒号分层 —— 运维按前缀扫 key 的习惯不用改.
 */
export const GATE_TRACE_KEY_PREFIX = 'deliberation:gate:trace';

/**
 * 闸门 trace 的存活时长 (秒) —— 7 天.
 *
 * ⚠️ 为什么 7 天而不是审议层的 30 天:
 *   闸门 trace 的量级是"每轮一条" (比审议 trace 大一个数量级), 但它的用途是
 *   "灰度期调阈值" —— 阈值一周内调完就够了, 之后留着只是白占内存.
 */
export const GATE_TRACE_TTL_SECONDS = 604_800;

/**
 * 一条闸门决策 trace.
 */
export interface GateTraceRecord {
  /** 业务会话 id. */
  readonly sessionId: string;
  /**
   * 落库会话 id (`training_sessions.id`) —— 可选.
   *
   * V2026-11-09: 闸门决策落 MySQL 后, admin 后台要按**落库 id** 查会话 ——
   *   于是 trace 需要两个会话口径 (引擎侧 / 落库). 缺省 = 这场没有落库会话 → 落库写 NULL.
   */
  readonly dbSessionId?: string | null;
  /**
   * 学员账号 id —— 可选 (落库后按它做学员隔离).
   *
   * ⚠️ 缺省 = 无归属 (自动对练) → 落库写 NULL → 学员身份看不到这些行.
   */
  readonly userId?: string | null;
  /** 本轮轮次. */
  readonly turnIndex: number;
  /** 走的哪条路径 (影子 / 生效). */
  readonly mode: GateMode;
  /** 跑 / 不跑. */
  readonly decision: GateDecision;
  /** 理由 (可枚举). */
  readonly reason: GateReason;
  /** 11 维逐维 delta (数值). */
  readonly deltaSummary: Readonly<Record<string, number>>;
  /** 当时用的阈值 (看板要能看出"按什么标准判的"). */
  readonly thresholdUsed: GateThresholds;
  /** 本次判定耗时 (毫秒). */
  readonly elapsedMs: number;
  /** 落库时刻 (毫秒时间戳). */
  readonly recordedAt: number;
}

/**
 * 构造闸门 trace 的 Redis key.
 *
 * ⚠️ 长度前缀复合键 (与审议 trace / 熔断 key / BDI 状态仓储同一套纪律):
 *   直接用 ':' 拼的话, (会话 "a:b") 与 (会话 "a") 加上后缀可能撞键 ——
 *   撞键的后果是**跨会话串数据** (A 场的闸门决策被记到 B 场头上), 静默的观测事故.
 *
 * @param sessionId 业务会话 id
 * @param turnIndex 轮次
 * @param mode 模式
 * @returns trace key
 */
export function buildGateTraceKey(sessionId: string, turnIndex: number, mode: GateMode): string {
  return `${GATE_TRACE_KEY_PREFIX}:${sessionId.length}:${sessionId}:${turnIndex}:${mode}`;
}

/**
 * 闸门决策的**持久化端口** (窄接口).
 *
 * ⚠️ 为什么是接口而不是直接依赖仓储类: 写入器是**纯类** (零 @nestjs),
 *   而 MySQL 落库要靠 Nest 的仓储注入 —— 接口把两者隔开, 单测能用极小替身覆盖.
 *   (与仓库既有窄端口纪律同款: DeliberationGatePort / TurnDeltaAuditPort.)
 */
export interface GateDecisionPersistencePort {
  /**
   * 落一条闸门决策 (**永不抛** —— 失败由实现自己兜住).
   *
   * @param record 决策记录
   */
  write(record: GateTraceRecord): Promise<void>;
}

/**
 * 闸门 trace 写入器.
 */
export class DeliberationGateTrace {
  private readonly logger = new Logger('DeliberationGateTrace');

  /**
   * @param redis Redis 客户端 (基础设施窄面)
   * @param persistence MySQL 落库口 (缺省 = 只写 Redis; 单测与"未装 ORM"的场景走这条)
   */
  constructor(
    private readonly redis: RedisService,
    private readonly persistence?: GateDecisionPersistencePort,
  ) {}

  /**
   * 写一条决策 trace.
   *
   * ⚠️ **写失败只记日志, 不抛** —— 留痕是观察面, 写不进去不是会话失败
   *   (与审议层的 writeTrace 同款纪律: 观察面挂了就挂了, 不能炸主流程).
   *
   * @param record 决策记录
   */
  async record(record: GateTraceRecord): Promise<void> {
    await this.writeRedisTrace(record);
    await this.writeStats(record);
    await this.writePersistence(record);
  }

  /**
   * 写 Redis 热读 trace (**原有逻辑逐字不变**: 每轮一个 key, 7 天 TTL).
   *
   * ⚠️ Redis 里的 JSON 现在多了 `dbSessionId` / `userId` 两个**可选**字段 ——
   *   旧记录没有这两个键 (读侧按缺省处理), 新记录有 —— 向后兼容.
   *
   * @param record 决策记录
   */
  private async writeRedisTrace(record: GateTraceRecord): Promise<void> {
    try {
      await this.redis.set(
        buildGateTraceKey(record.sessionId, record.turnIndex, record.mode),
        JSON.stringify(record),
        GATE_TRACE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `[deliberation_gate_trace_write_failed] sessionId=${record.sessionId} turn=${record.turnIndex}: ${messageOf(error)}`,
      );
    }
  }

  /**
   * 累加当日统计计数器 (**写时聚合**, 看板按天读它).
   *
   * ⚠️ 失败只打 warn —— 统计写失败 = 少几个计数, 不是会话失败.
   *
   * @param record 决策记录
   */
  private async writeStats(record: GateTraceRecord): Promise<void> {
    try {
      await applyGateStats(this.redis, {
        decision: record.decision,
        reason: record.reason,
        mode: record.mode,
        recordedAt: record.recordedAt,
      });
    } catch (error) {
      this.logger.warn(
        `[deliberation_gate_stats_write_failed] sessionId=${record.sessionId} turn=${record.turnIndex}: ${messageOf(error)}`,
      );
    }
  }

  /**
   * 落 MySQL 真相源 (`gate_decisions`).
   *
   * ⚠️ 写失败只打 warn —— 观察面挂了不该炸对练.
   *
   * @param record 决策记录
   */
  private async writePersistence(record: GateTraceRecord): Promise<void> {
    const persistence = this.persistence;
    if (!persistence) return;
    try {
      await persistence.write(record);
    } catch (error) {
      this.logger.warn(
        `[deliberation_gate_persist_write_failed] sessionId=${record.sessionId} turn=${record.turnIndex}: ${messageOf(error)}`,
      );
    }
  }
}

/**
 * 把异常压成一行短消息 (日志里不堆栈).
 *
 * @param error 异常
 * @returns 短消息
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
