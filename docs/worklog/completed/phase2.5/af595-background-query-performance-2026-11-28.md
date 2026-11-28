# AF-595 交付记录 — 后台导出与聚合查询性能治理

- 任务单：`docs/worklog/records/phase2.5-quality-gates/AF-595/task-sheet.md`
- 分支：`task/AF-595-background-query-performance`（stacked 自 AF-594 `41b87497`）
- 日期：2026-11-28
- 结论：**passed** — 导出异步化、Analytics SQL 分桶、首页并行、会员 cron 有界并发 4 项全部落地；定向 124 例、全量 5220 例全绿。

## 问题

上一轮性能审计的后台固定开销：

1. `ExportService.exportData` 在 HTTP 请求内串行采集 14 域、全量 `JSON.stringify`、ZIP CRC、base64 写 Redis 24h。
2. `AnalyticsService.buildTrend` 把时间窗内全部 `createdAt` 拉回 Node 逐条分桶；两个 KPI 计数串行。
3. 首页 `HomeOverviewService` 的 profile / user / mood / companions / unread 串行，`fetchCompanions` 先全量查再 `slice(0,3)`。
4. 会员年付发放与过期订单关单每条一个事务串行跑，批量 500 条时 cron 窗口被拉长。

## 改动

| 文件 | 改动 |
| --- | --- |
| `src/profile/providers/export-queue.service.ts` | 新增导出队列服务：独立 `profile-export` 队列 + Worker（并发 2），payload 仅 `taskId/uid/format`；处理器由 `ExportService` 注册，避免 DI 环；失败日志含 taskId，任务持久化在 BullMQ |
| `src/profile/providers/export.service.ts` | `exportData` 只做 60s 用户锁 + 落 `pending` 元数据 + 入队，立即返回；新增 `processTask` 走 `processing → completed/failed`；失败先落盘再抛出交由 BullMQ 重试，最终失败仍可查询；下载增加完成态校验 |
| `src/profile/profile.module.ts` | 注册 `ExportQueueService` |
| `src/profile/controllers/export.controller.ts` | Swagger 文案改为异步 + 轮询查询 |
| `src/analytics/domain/repositories/analytics-event.repository.ts` | 端口 `findCreatedAtBetween` 替换为 `countBucketed(..., bucketCount)`，只回传定长计数数组 |
| `src/analytics/data/analytics-event.repository.typeorm.ts` | SQL `GROUP BY` 分桶：`FLOOR(TIMESTAMPDIFF(MICROSECOND, start, created_at)/1000/桶宽)`，末桶 `LEAST(..., bucketCount-1)`；租户/事件/时间窗条件不变 |
| `src/analytics/providers/analytics.service.ts` | KPI 1/2 + trend 三查询 `Promise.all` 并行；`buildTrend` 只接收定长桶计数，不再遍历事件行 |
| `src/home/providers/home-overview.service.ts` | 基础数据 5 路并行（profile/user/mood/companions/unread），微干预 3 路并行；`fetchCompanions` 改 `take: 3` + `count` 并行 |
| `src/membership/providers/concurrency.ts` | 新增 `forEachWithConcurrency` + `MEMBERSHIP_CRON_CONCURRENCY = 8` |
| `src/membership/providers/membership-plan-grant.service.ts` | `refreshTerms` 改有界并发；每条 term 仍独立事务 + 行锁 |
| `src/membership/providers/membership-order.service.ts` | `closeExpired` 改有界并发；每单仍独立事务 + 行锁 + 预占释放 |
| `test/profile/export.spec.ts` | 改为 pending → worker 消费 → completed；新增失败落 failed、失败下载 404 断言 |
| `test/analytics/td13-analytics-repository-port.spec.ts` | 端口替身改 `countBucketed`，保留 KPI/桶数/tenantId/时间窗断言 |
| `test/membership/membership-concurrency.spec.ts` | 新增：40 项处理完整、并发峰值 ≤ 8、空列表不启动协程 |

关键设计决策：

1. **队列与业务服务解耦**。`ExportQueueService` 不注入 `ExportService`，由后者构造时 `registerProcessor`；避免循环依赖，也让队列服务可独立替换。
2. **失败必须可查询**。`processTask` 先写 `failed` 再抛出；BullMQ 重试时重新置 `processing`，最终一次仍失败则保持 `failed`，不会静默丢失。
3. **桶号在 SQL 里算**。内存只保留 `bucketCount` 个计数，年窗口事件量再大也不再线性占内存；末桶 clamp 与旧实现一致。
4. **并发不等于放宽事务边界**。会员 cron 只是把「逐条 await」改成「8 个协程领任务」，单条事务、行锁、幂等 reference key 全部保留。
5. **首页只两波并发**。第一波基础数据不依赖情绪；第二波微干预必须等 `effectiveEmotion`，因此不强行合并成一波。

## 闸门

<!-- gateResults -->

| 命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run test/profile test/analytics test/home test/membership` | 18 files passed，124 passed / 0 failed，66.40s |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm lint` | exit 0，0 error / 0 warning |
| `pnpm test` | 371 files passed / 1 skipped，5220 passed / 0 failed / 4 skipped，837.90s |
| `git diff --stat HEAD -- src/engine-core` | 空 |

全量首跑因宿主 D 盘 0 字节可用、Tee 日志写入失败而中断（测试本身未报失败）；经用户确认清空 D 盘回收站后重跑，上述 5220 例为最终结果。

<!-- /gateResults -->

## scope 自检

<!-- scopeCheck -->

- 代码：`src/profile/`、`src/analytics/`、`src/home/providers/`、`src/membership/providers/` 均在任务单 files 内。
- 测试：`test/profile/`、`test/analytics/`、`test/membership/` 均在内。
- 记录：本文件在 `docs/worklog/completed/phase2.5/`，任务记录包在 `docs/worklog/records/phase2.5-quality-gates/`。
- 未改表结构、未加 migration、未引入依赖、未改 `src/engine-core/**`、未碰前端与 admin-dashboard。

<!-- /scopeCheck -->

## 契约核对

<!-- contractChecks -->

- 导出仍保留 60s 用户锁、uid 归属校验、24h TTL 与审计事件。
- 下载仅在 `completed` 且文件存在时返回；pending / processing / failed 一律 404，不泄露任务存在性。
- Analytics 租户隔离（`tenant_id`）与事件类型过滤条件未改，桶数仍为 today=24 / week=7 / month=30 / year=12。
- 会员单条事务与 `pessimistic_write` 行锁未改，批次并发上限来自单一常量。
- 状态面只经 CLI（`task register/promote`、`run-once`）。

<!-- /contractChecks -->

## backlog 遗留项

<!-- backlogItems -->

- **AF595-B1**（ops）：导出队列 Worker 与 HTTP 进程同机部署；多实例时同一任务只会被一个 Worker 消费（BullMQ 语义），但队列长度/积压目前只进日志，未接 Prometheus 指标。后续可补 `profile_export_queue_depth` gauge。
- **AF595-B2**（product）：Flutter 导出页目前是 POST 后 3s 提示，未真轮询 `GET /export/:taskId`。后端已支持 pending/processing/completed/failed，客户端轮询属独立前端任务，未在本单改动。

<!-- /backlogItems -->

## 偏差表

<!-- deviationTable -->

| 项 | 任务单写的 | 实际 | 处置 |
| --- | --- | --- | --- |
| 导出拆分 | `createTask` / `processTask` | `exportData` 负责登记 + 入队，`processTask` 负责 Worker 侧处理 | 等价拆分，避免多一个仅内部使用的公开方法 |
| Analytics 方法名 | `countByTimeBucket` | `countBucketed` | 语义一致，按端口现有命名风格收敛 |
| 首页 companions | `findAndCount + take 3` | `find({ take: 3 })` + `count()` 并行 | `findAndCount` 在 TypeORM 会先 count 再 find，串行；两查询并行更快且结果一致 |
| 会员并发配置 | 默认 8 且可单测 | 常量 `MEMBERSHIP_CRON_CONCURRENCY = 8`，两个 cron 共用，单测直接引用 | 未加 env 旋钮，避免引入未要求的配置面；常量本身可单测 |
| 导出队列名 | 未指定 | 独立 `profile-export` | 不复用 audit 队列，payload 与消费逻辑不同 |

<!-- /deviationTable -->

## 验收结论

<!-- reviewVerdict -->

passed — 4 项后台性能治理全部落地并有定向 + 全量证据；导出异步化保持权限、频率、TTL、审计与失败可查询，Analytics 桶口径与会员事务边界未削弱。
<!-- /reviewVerdict -->

## commit message

`fix(af595): async export and bounded aggregation fan-out`
