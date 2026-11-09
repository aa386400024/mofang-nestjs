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
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/deliberation-gate/quotas.spec.ts 覆盖 trace 写入

import { Logger } from '@nestjs/common';

import type { GateDecision, GateMode, GateReason, GateThresholds } from './deliberation-gate.types.js';
import type { RedisService } from '../../shared/infra/redis/redis.service.js';

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
 * 闸门 trace 写入器.
 */
export class DeliberationGateTrace {
  private readonly logger = new Logger('DeliberationGateTrace');

  /**
   * @param redis Redis 客户端 (基础设施窄面)
   */
  constructor(private readonly redis: RedisService) {}

  /**
   * 写一条决策 trace.
   *
   * ⚠️ **写失败只记日志, 不抛** —— 留痕是观察面, 写不进去不是会话失败
   *   (与审议层的 writeTrace 同款纪律: 观察面挂了就挂了, 不能炸主流程).
   *
   * @param record 决策记录
   */
  async record(record: GateTraceRecord): Promise<void> {
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
