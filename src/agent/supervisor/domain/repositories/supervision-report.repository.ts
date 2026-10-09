// V2026-10-09 治本 (SupervisionReport 仓储接口 — SPEC §11.2):
//   抽象: SupervisorService 只依赖 SupervisionReportRepository 接口 +
//     SUPERVISION_REPORT_REPOSITORY token, 不感知 V0.x 内存 / V1.x TypeORM 切换
//   关键方法:
//     - save(row): 写库 (insert + update 合一, 内存实现用 id 自增, TypeORM 走 upsert)
//     - findBySessionId(tenantId, sessionId): 查 session 最新一份报告 (V0.x 调试用)
//     - listByTenant(tenantId, limit): 列租户最近报告 (V1.x admin 后台)
//   V0.x: 内存实现 (data/supervision-report.repository.memory.ts)
//   V1.x: TypeORM 实现 (data/supervision-report.repository.typeorm.ts) —
//     字段映射零成本, 实体直接走 repository.save
//
//   反双胞胎:
//     - 不用 generic Repository<T> — 督导报告是核心业务实体, 自定义方法更可读
//     - 不暴露 EntityManager — 业务层不写 SQL
//     - 不在接口里加 update/delete — V0.x 不写, V1.x 由 admin 模块补
//     - save 不做 partial update — 督导报告写完即终态, 不可改写
//
//   如何验证:
//     1. 单元测试 mock SupervisionReportRepository, SupervisorService 不感知具体实现
//     2. V0.x 启动后 save → findBySessionId 能查到
//     3. findBySessionId 不存在 → 返回 null, 不 throw (业务层显式判空)

import type { SupervisionReportRow } from '../../supervisor.types';

/** 仓储接口契约. */
export interface SupervisionReportRepository {
  /**
   * 写一行督导报告. V0.x 内存 mock: row.id 已有则覆盖, 无则新增.
   *   V1.x TypeORM: repository.save(row) 走 upsert.
   * @param row 完整报告行 (含 status / rawResponse / createdAt)
   * @returns 写库后的行 (V0.x 直接返回 row)
   */
  save(row: SupervisionReportRow): Promise<SupervisionReportRow>;

  /**
   * 按 sessionId 查最新一份督导报告.
   * V0.x: 调试 / 单元测试用, V1.x: 前端查看历史报告.
   * @param tenantId 租户隔离
   * @param sessionId voice session id
   * @returns 找不到返回 null
   */
  findBySessionId(tenantId: string, sessionId: string): Promise<SupervisionReportRow | null>;

  /**
   * 列租户最近督导报告, 按 createdAt 倒序.
   * V0.x: 调试用, 默认 limit 50.
   * V1.x: admin 后台报告列表页.
   * @param tenantId 租户隔离
   * @param limit 默认 50, 上限 200
   */
  listByTenant(tenantId: string, limit?: number): Promise<readonly SupervisionReportRow[]>;
}

/** DI token — NestJS 注入用. */
export const SUPERVISION_REPORT_REPOSITORY = Symbol('SUPERVISION_REPORT_REPOSITORY');
