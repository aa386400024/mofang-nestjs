// V2026-11-09 治本 (Phase2.5 WP-F · 成本看板来源适配器 · 正式训练):
//   职责: 查 `training_sessions`, 产出**统一行模型** `CostSourceSession`.
//   边界: 只做 IO + 归一; 口径换算 / 合并 / 排序都在纯函数层 (`cost-view.ts`).
//
//   为什么要有"来源适配器"这一层 (WP-F 任务单 §5):
//     ① **不在 controller 拼 SQL / UNION 两张表** —— 口径换算散进 SQL 就没法单测,
//        也看不出"这个数字是哪个源算的";
//     ② **不建 MySQL VIEW** —— 应用层的计数规则 (failed 算钱但不算 session) 写不进视图,
//        硬写进视图就是把业务规则藏进 DB.
//     两张表各自读、各自归一成同一个行模型, 合并只剩**一份**纯函数实现.
//
//   数据源仍是**留痕快照** (`turn_debug_trace[].llmUsage`) —— 与 WP31 既有口径一致:
//     留痕关着时 tokens / cost 恒 0 (但场次照样计入), 那个"有场次但 0 token"的信号
//     不能因为合并了自动对练就丢掉.
//
//   验证: npx vitest run test/admin-debug/wp-f-cost-board-merge.spec.ts
//   时间戳: 2026-11-09 GMT+8

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { FindOptionsWhere, Repository } from 'typeorm';

import { aggregateSessionCost, readTraces, type CostSourceSession } from './cost-view.js';
import { TrainingSession } from '../counselor/entities/training-session.entity.js';
import type { SessionCostPricing } from '../engine-adapters/observability/session-cost.js';

/**
 * 正式训练来源的查询参数.
 */
export interface FormalCostSourceQuery {
  /** where 片段 (由调用方拼: 软删过滤 + 归属过滤 + 时间窗口). */
  readonly where: FindOptionsWhere<TrainingSession>;
  /** 取多少行 (扫描上限). */
  readonly take: number;
  /** 单价 (元 / 千 token) —— 与自动对练共用同一张定价表. */
  readonly pricing: SessionCostPricing;
}

/**
 * 正式训练成本来源 (读 `training_sessions`).
 */
@Injectable()
export class FormalCostSource {
  constructor(
    @InjectRepository(TrainingSession)
    private readonly sessionRepo: Repository<TrainingSession>,
  ) {}

  /**
   * 取窗口内的正式训练会话成本行.
   *
   * @param query 查询参数
   * @returns 归一后的行 (按 startedAt 倒序)
   */
  async fetchSessions(query: FormalCostSourceQuery): Promise<CostSourceSession[]> {
    const rows = await this.sessionRepo.find({
      where: query.where,
      order: { startedAt: 'DESC' },
      take: query.take,
      select: { id: true, personaName: true, startedAt: true, turnDebugTrace: true },
    });
    return rows.map((row) => {
      const aggregate = aggregateSessionCost(readTraces(row.turnDebugTrace), query.pricing);
      return {
        source: 'formal',
        sessionId: row.id,
        visitorAlias: row.personaName,
        startedAt: row.startedAt,
        totalTokens: aggregate.totalTokens,
        costCny: aggregate.costCny,
        costBasis: aggregate.costBasis,
        // 正式训练**窗口内每一场都算一次会话** —— 与 WP31 既有口径一致, 本单不改.
        // (自动对练那边 failed / canceled 不算 session, 两边规则不同 → 登记在交付记录 §偏差.)
        countsAsSession: true,
      };
    });
  }
}
