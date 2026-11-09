// V2026-11-09 治本 (Phase2.5 闸门 trace 查询接口 · 闸门决策落库):
//   职责: 把一条闸门决策写进 MySQL (真相源) —— 列表 / 详情端点查的就是它.
//   边界: 只写一行; 不做查询, 不做聚合; 写失败只记日志, 绝不抛.
//
//   为什么写失败不抛 (与 Redis 侧同款纪律):
//     闸门 trace 是**观察面** —— 写不进去不是会话失败. 抛出去会把"看板没数据"
//     变成"整场对练失败", 那是**观察面绑架主流程**.
//     但失败要**打 warn** (带 sessionId / turnIndex 定位), 不能静默 ——
//     静默丢弃最难受: 看板空着, 没人知道是"没数据"还是"写失败了".
//
//   ⚠️ **隐私**: 落库的只有枚举 / 数值 / 阈值 / 耗时 —— 零对话原文.
//
//   验证: npx tsc -p tsconfig.build.json --noEmit 0 错
//   时间戳: 2026-11-09

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import { shanghaiDateKey } from '../../../shared/time/shanghai-date.js';
import type { GateTraceRecord } from '../deliberation-gate.trace.js';
import { GateDecisionEntity } from './gate-decision.entity.js';

/**
 * 闸门决策落库器 (MySQL 真相源).
 */
@Injectable()
export class GateDecisionStore {
  private readonly logger = new Logger('GateDecisionStore');

  /**
   * @param repo gate_decisions 仓储 (只写这一张表)
   */
  constructor(@InjectRepository(GateDecisionEntity) private readonly repo: Repository<GateDecisionEntity>) {}

  /**
   * 写一条闸门决策 (**永不抛**).
   *
   * @param record 决策记录 (与 Redis 侧同一份)
   */
  async write(record: GateTraceRecord): Promise<void> {
    const occurredAt = new Date(record.recordedAt);
    try {
      await this.repo.insert({
        sessionId: record.sessionId,
        // ⚠️ 空值写 NULL (不是空串 / 0) —— "没有落库会话"与"落库 id 是 0"是两件事.
        dbSessionId: record.dbSessionId ?? null,
        userId: record.userId ?? null,
        turnIndex: record.turnIndex,
        mode: record.mode,
        decision: record.decision,
        reason: record.reason,
        thresholdUsed: record.thresholdUsed,
        deltaSummary: record.deltaSummary ?? null,
        elapsedMs: record.elapsedMs,
        recordedAt: occurredAt,
        // 按天口径写进数据里 (与环境时区无关, 见实体注释).
        recordedDay: shanghaiDateKey(occurredAt),
      });
    } catch (error) {
      this.logger.warn(
        `[gate_decision_persist_failed] sessionId=${record.sessionId} turn=${record.turnIndex}: ${messageOf(error)}`,
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
