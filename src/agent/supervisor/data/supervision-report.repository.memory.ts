// V2026-10-09 治本 (SupervisionReport 内存仓储 — V0.x 兜底):
//   存储策略:
//     - 索引: Map<sessionId, SupervisionReportRow>, 一个 session 一份报告
//     - 多租户: 桶内 row.tenantId 过滤, 'default' 兜底
//     - save 语义: 同 sessionId 覆盖最新 (session 结束 → push 队列 → 写一份)
//     - listByTenant: 全桶倒序 (按 createdAt desc), 默认 50, 上限 200
//   V1.x 切 TypeORM:
//     - save → repository.save(row) 走 upsert (V1.x 由 id PK 管理, V0.x 走 sessionId 覆盖)
//     - findBySessionId → repository.findOne({ where: { sessionId, tenantId } })
//     - listByTenant → repository.find({ where: { tenantId }, order: { createdAt: 'DESC' }, take: limit })
//   接口零变化, 上层 SupervisorService 无感知.
//
//   反双胞胎:
//     - 不用 lodash groupBy — 原生 Map 够用, 引库增 70KB
//     - 不存全量 LLM 响应 — rawResponse 字段 (parse 失败时存原文) 足够 debug
//     - 不做软删除 (isActive) — 督导报告写完即终态, 不需要软删
//     - 不延迟加载 — 启动时不 seed, 督导报告由 session 结束触发写入
//
//   如何验证:
//     1. pnpm build 无 type error
//     2. module 启动后 listByTenant('default') 返回 []
//     3. save → findBySessionId 能查到同 sessionId 最新一份
//     4. 同 sessionId 二次 save 覆盖, 桶内仍只一份
//     5. listByTenant limit 默认 50, 上限 200

import { Injectable, Logger } from '@nestjs/common';

import type { SupervisionReportRepository } from '../domain/repositories/supervision-report.repository';
import type { SupervisionReportRow } from '../supervisor.types';

/** 单租户单次查询默认上限. */
const DEFAULT_LIST_LIMIT = 50;
/** listByTenant 硬上限, 防 OOM. */
const HARD_LIMIT_CAP = 200;

@Injectable()
export class SupervisionReportRepositoryMemory implements SupervisionReportRepository {
  private readonly logger = new Logger(SupervisionReportRepositoryMemory.name);
  /** sessionId → 最新报告行. 一个 session 一份, 覆盖语义. */
  private readonly bySession = new Map<string, SupervisionReportRow>();

  async save(row: SupervisionReportRow): Promise<SupervisionReportRow> {
    this.bySession.set(row.sessionId, row);
    this.logger.log(
      `[save] tenant=${row.tenantId} session=${row.sessionId} ` +
        `status=${row.status} score=${row.overallScore} annotations=${row.annotations.length}`,
    );
    return row;
  }

  async findBySessionId(tenantId: string, sessionId: string): Promise<SupervisionReportRow | null> {
    const row = this.bySession.get(sessionId);
    if (!row) return null;
    // 跨租户隔离校验
    return row.tenantId === tenantId ? row : null;
  }

  async listByTenant(tenantId: string, limit?: number): Promise<readonly SupervisionReportRow[]> {
    const effectiveLimit = Math.min(Math.max(limit ?? DEFAULT_LIST_LIMIT, 1), HARD_LIMIT_CAP);
    const all = Array.from(this.bySession.values())
      .filter((row) => row.tenantId === tenantId)
      .toSorted((a, b) => b.createdAt - a.createdAt);
    return all.slice(0, effectiveLimit);
  }

  // ── 内部辅助 (供单元测试 / 调试) ────────────────────────────

  /** 内存清空, 单元测试 setup/teardown 用. */
  clear(): void {
    this.bySession.clear();
  }

  /** 当前桶内行数, 健康检查用. */
  size(): number {
    return this.bySession.size;
  }
}
