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

// V2026-10-27 治本 (SupervisionReport 仓储 — 补批量查询出口):
//   原因: 练习历史列表 (`GET /counselor/training-sessions`) 要给每个列表项补
//     「报告状态 / 总分」两个派生字段, 报告行在 `supervision_reports` 表.
//     逐行 `findBySessionId` = 一页 20 条发 20 次查询 (N+1), 列表接口直接被
//     DB 往返拖垮 —— 而这个列表是成长 tab 的首屏, 每次进来都要跑.
//   修法: 补 `findBySessionIds(tenantId, sessionIds)` —— 一次 `sessionId IN (...)`
//     批量取回, 按 sessionId 建 Map 返回; 调用方 (列表 service) 先分页查会话行,
//     收集本页 id, 再一次批量取报告, 然后按 id 查表填聚合字段.
//   反双胞胎:
//     - 不在列表 service 里循环调 `findBySessionId`: 那就是 N+1, 治标不治本
//     - 不给仓储加 "按 userId 查" 的新方法: 报告行的归属靠 tenant 隔离 +
//       sessionId 白名单 (本单只查当前用户自己分页出来的那批 id), 不需要第二把钥匙
//     - 不返回数组让调用方自己转 Map: Map 是"按 id 查表"的天然形状, 转换逻辑
//       收在仓储里一处, 调用方不重复写
//   验证:
//     1. tsc 0 错
//     2. 单元测试: 内存实现 batch 与逐个查结果一致
//   时间戳: 2026-10-27 09:20 GMT+8

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
   * 按一批 sessionId 批量取每个会话的最新一份报告.
   *
   * V0.x: 内存实现遍历桶过滤; V1.x: `sessionId IN (...) AND tenantId = ?` 一次查询.
   *
   * @param tenantId 租户隔离
   * @param sessionIds 会话 id 列表 (调用方已保证是当前用户自己的会话)
   * @returns sessionId → 报告行 的映射 (无报告的会话不出现在 Map 里)
   */
  findBySessionIds(tenantId: string, sessionIds: string[]): Promise<Map<string, SupervisionReportRow>>;

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
