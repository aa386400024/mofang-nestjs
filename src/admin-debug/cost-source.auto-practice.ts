// V2026-11-09 治本 (Phase2.5 WP-F · 成本看板来源适配器 · 自动对练):
//   职责: 查 `ap_practice_sessions`, 产出**统一行模型** `CostSourceSession`.
//   边界: 只做 IO + 归一; 合并 / 排序 / 分桶都在纯函数层 (`cost-view.ts`).
//
//   数据源是 **Step 0 落库的列** (`total_tokens` / `total_cost_cny` / `cost_basis`):
//     自动对练没有留痕 JSON 列, token 与成本是 runner 结算时写进去的
//     (金额单位 = **人民币元**, 跟正式训练同一张定价表 + 同一个 `estimateSessionCost()`).
//     ⚠️ 没有这层落库, 合并看板的自动对练那一栏永远是 0 —— 那就是"合并了个寂寞".
//
//   计数规则 (与任务单 §4.2 一致):
//     · **成本照算** —— failed / running 也花了钱, 钱就是钱;
//     · **sessions 只算跑成的** —— completed / crisis_ended / stagnant 才算"一场对练",
//       failed / canceled 不算 session (但成本照算).
//     两件事拆成两个字段 (`costCny` / `countsAsSession`), 不让"该不该计一次会话"
//     这个业务判断去污染成本数字.
//
//   ⚠️ 学员隔离不在这一层做 —— 自动对练没有 userId 归属, 谁能看到这一源
//     由 controller 按身份 (管理员 basic 凭据) 决定 (见 `admin-debug.controller.ts`).
//
//   验证: npx vitest run test/admin-debug/wp-f-cost-board-merge.spec.ts
//   时间戳: 2026-11-09 GMT+8

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, type FindOptionsWhere, type Repository } from 'typeorm';

import type { CostSourceSession, MergedCostBasis } from './cost-view.js';
import { PracticeSession, type PracticeSessionStatus } from '../auto-practice/entities/practice-session.entity.js';

/**
 * 计入"跑成了一场对练"的状态.
 *
 * failed / canceled 不算 session —— 但它们的**成本照算** (钱花了就是花了).
 */
const SESSION_COUNTED_STATUSES: ReadonlySet<string> = new Set<PracticeSessionStatus>(['completed', 'crisis_ended', 'stagnant']);

/**
 * 自动对练成本来源的查询参数.
 */
export interface AutoPracticeCostSourceQuery {
  /** 时间窗口起点 (缺省 = 不限). */
  readonly cutoff?: Date | undefined;
  /** 取多少行 (扫描上限). */
  readonly take: number;
}

/**
 * 自动对练成本来源 (读 `ap_practice_sessions`).
 */
@Injectable()
export class AutoPracticeCostSource {
  constructor(
    @InjectRepository(PracticeSession)
    private readonly practiceRepo: Repository<PracticeSession>,
  ) {}

  /**
   * 取自动对练场次成本行.
   *
   * @param query 查询参数
   * @returns 归一后的行 (按 startedAt 倒序)
   */
  async fetchSessions(query: AutoPracticeCostSourceQuery): Promise<CostSourceSession[]> {
    const where: FindOptionsWhere<PracticeSession> = query.cutoff ? { startedAt: MoreThanOrEqual(query.cutoff) } : {};
    const rows = await this.practiceRepo.find({
      where,
      order: { startedAt: 'DESC' },
      take: query.take,
      select: {
        id: true,
        characterSlug: true,
        counselorModeId: true,
        batchId: true,
        status: true,
        startedAt: true,
        totalTokens: true,
        totalCostCny: true,
        costBasis: true,
      },
    });
    return rows.map((row) => ({
      source: 'auto_practice',
      sessionId: row.id,
      // 来访者别名用角色 slug 兜底 (自动对练没有 personaName).
      visitorAlias: row.characterSlug,
      startedAt: row.startedAt,
      totalTokens: row.totalTokens ?? 0,
      costCny: toCostNumber(row.totalCostCny),
      costBasis: resolveCostBasis(row.totalCostCny, row.costBasis),
      countsAsSession: SESSION_COUNTED_STATUSES.has(row.status),
      characterSlug: row.characterSlug,
      counselorModeId: row.counselorModeId,
      batchId: row.batchId,
      status: row.status,
    }));
  }
}

/**
 * DECIMAL 列取回来是**字符串** (mysql2 驱动) —— 统一转成 number, 读不出来当 0.
 *
 * @param raw 原始列值
 * @returns 金额 (元)
 */
function toCostNumber(raw: number | string | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 成本口径.
 *
 * - 有成本记录 → 用落库的 `cost_basis` (full / output_only);
 * - 没有成本记录 (WP-F 之前跑的历史场次) → `estimated` ——
 *   **没有口径背书**的数, 不能拿 0 冒充"这场免费".
 *
 * @param totalCostCny 落库成本 (null = 没有记录)
 * @param costBasis 落库口径
 * @returns 看板用的口径
 */
function resolveCostBasis(totalCostCny: number | string | null | undefined, costBasis: string | null): MergedCostBasis {
  if (totalCostCny === null || totalCostCny === undefined) return 'estimated';
  if (costBasis === 'full' || costBasis === 'output_only') return costBasis;
  return 'estimated';
}
