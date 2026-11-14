// V2026-11-14 治本 (TD-15 · C+ 枚举外移 · P-DEBT-11 / L-1):
//   业务事件类型枚举 —— 从 `entities/analytics-event.entity.ts` 外移到独立纯枚举文件.
//
//   治本:
//     - 枚举原先定义在 entity 文件里, 任何**值位置**导入它的代码 (service / spec)
//       都会把 entity 文件拉进模块加载期 → 顶层 @Entity / @Column 装饰器求值 →
//       typeorm 经**传递**闭包进入 (TD-11 实测 type-only 收窄收益为 0 的根因).
//       移到零 typeorm 依赖的独立文件后, 这条边即解除.
//     - 本文件**零** typeorm / @nestjs/typeorm 依赖, 不引用任何 entity 类,
//       无装饰器 / 无 Nest / 无 process.env / 无网络 —— 纯枚举定义.
//     - 枚举成员名与字符串值**逐字不变** (业务语义零漂移).
//
//   反双胞胎:
//     - 不复用别的域的同名枚举 —— analytics 事件枚举跟 KB / 生活图谱的状态枚举
//       各自独立, 混用会让 KPI 口径跟客户端 7.8 AnalyticsPage 脱钩.
//
//   如何验证:
//     1. tsc 0 错; 全量测试用例数与既有断言逐字不变;
//     2. grep 复核: 本文件 typeorm import = 0; 原 `entities/` 路径下的枚举 import 残留 = 0.
//
//   时间戳: 2026-11-14 GMT+8

/**
 * 业务事件类型 — 跟客户端 7.8 AnalyticsPage 4 KPI 计算逻辑严格对应.
 *
 * - KbPublished        计数 → KPI 1 (KB 发布量)
 * - DraftSubmitted     分母 → KPI 2 (草稿→发布转化率)
 * - ReviewApproved     分子 → KPI 2
 * - KbArchived         (V0.x 占位, 4 KPI 不直接用)
 * - KbRestored         (V0.x 占位)
 * - KbScheduled        分母 → KPI 4 (排期发布占比)
 * - KbScheduleFired    分子 → KPI 4 (实际到点发布的 item)
 */
export enum AnalyticsEventType {
  KbPublished = 'KB_PUBLISHED',
  DraftSubmitted = 'DRAFT_SUBMITTED',
  ReviewApproved = 'REVIEW_APPROVED',
  KbArchived = 'KB_ARCHIVED',
  KbRestored = 'KB_RESTORED',
  KbScheduled = 'KB_SCHEDULED',
  KbScheduleFired = 'KB_SCHEDULE_FIRED',
}
