---
taskId: AF-595
contextId: phase2.5-quality-gates
title: 后台导出与聚合查询性能治理
type: fix
status: backlog
baselineRef: 41b87497
dependsOn: [AF-594]
priorTasks: [AF-591, AF-594]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-28T08:40:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/profile/
    - src/analytics/
    - src/home/providers/
    - src/membership/providers/
    - src/shared/infra/queue/
    - test/profile/
    - test/analytics/
    - test/home/
    - test/membership/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-quality-gates/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af595-background-query-performance-2026-11-28.md
    kind: report
gates:
  - command: pnpm exec vitest run test/profile test/analytics test/home test/membership
    check: 后台链路定向测试全绿
    threshold: 0 failed
  - command: pnpm typecheck
    check: 类型检查 0 error
    threshold: exit 0
  - command: pnpm lint
    check: Lint 0 error
    threshold: exit 0
  - command: pnpm test
    check: 全量测试全绿
    threshold: 0 failed
successCriteria:
  - 导出 POST 只登记任务并返回 pending，采集/序列化/base64 全部移到 BullMQ worker，HTTP 请求不再等待全量序列化
  - 导出任务状态支持 pending / processing / completed / failed，失败可查询，下载仍只允许任务所有者且 24h 有效
  - Analytics 趋势改为 SQL 时间桶聚合，不再把时间窗内全部 createdAt 拉进 Node；KPI 计数并行
  - 首页 profile/user、companions/unread 并行；陪伴者只取前 3 条并用 count 取总数
  - 会员年付发放与过期订单关单改为有限并发批处理，单条事务与行锁语义不变
  - 定向测试、typecheck、lint、全量测试全绿
objective: 把后台导出、分析聚合、首页高频读与会员 cron 的固定开销降下来，不改变计费、权限与状态机语义
outOfScope:
  - 不改数据库表结构 / 不加 migration
  - 不改导出文件 schema 版本与已纳入域清单
  - 不改会员发放规则、订单状态机与配额口径
  - 不引入新依赖
constraints:
  - 导出 worker 必须保持 uid 归属校验与 60s 频率限制
  - 导出失败必须落 failed 状态，不得静默丢失
  - Analytics 时间桶边界必须与现有 today/week/month/year 口径一致
  - 会员批量并发不得突破连接池承受范围，默认并发 8 且可单测
---

# AF-595 · 后台导出与聚合查询性能治理

> 状态：📋 待执行（2026-11-28）
> 执行方：自做
> 分支：task/AF-595-background-query-performance（自 integrate）
> 唯一事实源：本轮性能审计结论 + Flutter `privacy_settings_page.dart` 已按 pending + getExportTask 口径预留
> 改动范围：仅后端 src/test/docs

## 0. 必读入口

1. `README.md`
2. `docs/README.md`
3. `docs/team/conventions.md`
4. `docs/team/agent-orchestration/README.md`
5. 本任务单

## 1. 背景

- 导出在 HTTP 请求内完成 14 域串行采集、全量 `JSON.stringify`、ZIP CRC、base64 写 Redis，用户数据越多请求越久，且同步 CPU 阻塞事件循环。
- Analytics `buildTrend` 把时间窗内所有 `createdAt` 拉回 Node 分桶；年窗口可能几十万行。
- 首页 profile/user、companions/unread 串行，companions 先全量取再 slice 前 3。
- 会员年付发放与过期订单关单每条一个事务串行跑。

Flutter 导出页已把 POST 返回视为 `pending` 并预留 `getExportTask`，导出异步化不需要改客户端。

## 2. 范围

**在范围内：**

- `ExportService` 改为 BullMQ 异步任务；新增导出 worker。
- `ExportTaskRecord` 支持 pending / processing / completed / failed。
- Analytics 仓储新增 SQL 时间桶聚合方法；service 改用它并并行 KPI。
- 首页聚合并行化与 companions 限量。
- 会员 cron 有限并发批处理。

**明确不在范围内：**

- 不改导出 schema 1.1 与域清单。
- 不做导出包加密 / 对象存储 / 签名 URL。
- 不改会员规则、配额、订单状态。
- 不改表结构与 migration。
- 不引入新依赖。

## 3. 交付物

1. `ExportQueueService`：`Queue` + `Worker`，payload 只含 taskId/uid/format；POST 落 pending 后入队；worker 落 processing → completed/failed。
2. `ExportService`：拆分 `createTask` / `processTask`，保留 60s 用户锁、uid 归属、24h TTL、审计。
3. `AnalyticsEventRepository.countByTimeBucket`：SQL 按 `TIMESTAMPDIFF` 分桶；service 并行 KPI 与 trend，可选 60s Redis 缓存。
4. `HomeOverviewService`：profile/user/mood 并行；micro/scenarios/stats/companions/unread 并行；companions 用 `findAndCount + take 3`。
5. 会员两个 cron 改有限并发（默认 8），保留单条事务与行锁。
6. 测试：导出 pending/complete/fail；SQL 桶边界；首页并行与 take；会员并发与幂等。

## 4. 红线

- 导出下载只允许任务所有者；不得因异步丢失归属校验。
- 导出失败必须可查询，不得只 warn。
- 会员发放/关单幂等与行锁不得削弱。
- Analytics 租户隔离不得削弱。

## 5. 闸门

- 定向：`pnpm exec vitest run test/profile test/analytics test/home test/membership`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`

## 6. 交付记录

`docs/worklog/completed/phase2.5/af595-background-query-performance-2026-11-28.md`，含七组机读标记。

## 7. 回写清单

- 交付记录、状态面归档、PR、commit message `fix(af595): async export and bounded aggregation fan-out`。
</content>
