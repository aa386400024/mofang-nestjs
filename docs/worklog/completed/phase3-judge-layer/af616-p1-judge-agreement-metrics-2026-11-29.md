# AF-616 交付记录

## 1. 任务与授权

- 任务单：`docs/worklog/records/phase3-judge-layer/AF-616/task-sheet.md`
- 执行仓 / 类型：`mofang-nestjs` / `nestjs`
- 基线 / 分支：`67bd90e6aada453f0c1743e57d10de0d8f200899` / `task/AF-616-judge-layer-p1-a-scope-judge-agreement`
- 授权与前置门禁：AF-616 经 CLI 登记、promote、run-once 领取为 submitted；AF-611 已完成归档，依赖满足；工作分支自 `origin/integrate 98d745f1`（已含 AF-611 squash 合并）切出，代码基线包含任务单 `baselineRef`。
- 任务来源：AF-612 在 submitted 状态下无法经 `task reissue/rescope` 原地扩 scope，按审计口径重签发的 successor 单；scope 增加既有字典断言文件 `test/auto-practice/wp-k-metric-dictionary.spec.ts`。
- 回执：`docs/team/agent-orchestration/transport/receipts/AF-616.json`；durable 副本 `docs/worklog/records/phase3-judge-layer/AF-616/receipt-RC-AF-616-1.json`

## 2. Scope 与排除项

- 允许改动：`docs/worklog/records/phase3-judge-layer/AF-616/`、`docs/worklog/completed/phase3-judge-layer/af616-p1-judge-agreement-metrics-2026-11-29.md`、`src/engine-adapters/judge/judge.agreement.ts`、`src/engine-adapters/judge/judge.types.ts`、`src/auto-practice/metrics/metric-dictionary.ts`、`src/auto-practice/metrics/batch-metrics.schema.ts`、`test/engine-adapters/judge/judge-agreement.spec.ts`、`test/auto-practice/wp-k-metric-dictionary.spec.ts`
- 排除项：第二模型族 Provider、第三方 LLM SDK / 评分库 / DB 驱动、双 Judge 并发编排；P2 回归判据与 Regression evaluator；DB 表 / migration；HTTP / 管理端 / 标注台；AF-613 人工队列、AF-614 AI/真人矩阵；drills 判定引擎与 DrillVerdict；冻结期 PsyGuard、Flutter 客户端、framework 规范件。
- 授权交付物：交付记录与 AF-616 记录包/回执。
- 开工前并行/既有改动：主工作区约有 500 项历史脏文件（状态面投影、legacy manifest、Web data.js、未跟踪 legacy 记录包等），全部未进入本任务 worktree；本任务在独立 worktree 从 `origin/integrate` 起栈，开工前仅含基线文件。

## 3. 实现摘要

- `judge.agreement.ts`：新增同场配对纯函数 `pairJudgeReviews`（按 sessionId 配对，任一侧 null 不计入分母）、单场 `computePair`（逐维 0/1/2 一致、三维整体一致集合、整体信心绝对差、分歧维度清单）、批次 `aggregateJudgeAgreement`（配对场次、逐维/整体一致率、分歧维度分布、低样本全 null）、`buildJudgeAgreementSection` 与 `assertJudgeAgreementSection`（快照可选子段严格守卫）。
- `judge.types.ts`：新增 `JudgeAgreementLineageRef`、`JudgeAgreementSection`，并在 `JudgeSnapshotSection` 增加可选 `agreement` 子段；P0 既有结果形状不变。
- `metric-dictionary.ts`：新增 8 项 `judge.agreement.*` 指标（配对场次、整体率、三维一致率、三维分歧计数），全部 `neutral + nullable`；字典版本 `dict-v4 → dict-v5`。
- `batch-metrics.schema.ts`：v1 快照 Judge 段存在时串接 agreement 子段守卫；`schemaVersion` 保持 1，旧快照缺省与 `agreement:null` 兼容，非法子段拒绝。
- 测试：新增 16 例 agreement 单测，覆盖完全一致、逐维分歧、单侧 null、双侧 null、低样本 null、信心差/分歧清单、快照子段兼容与拒绝、dict-v5 指标；既有字典断言同步 `dict-v5`。
- 边界：一致率只引用两侧既有 lineage；未发起任何 Provider 调用；未接第二 Provider、未设回归阈值、未改 Regression evaluator。

## 4. 实际改动文件

- 新增：`src/engine-adapters/judge/judge.agreement.ts`、`test/engine-adapters/judge/judge-agreement.spec.ts`、`docs/worklog/completed/phase3-judge-layer/af616-p1-judge-agreement-metrics-2026-11-29.md`、`docs/worklog/records/phase3-judge-layer/AF-616/task-sheet.md`、`docs/worklog/records/phase3-judge-layer/AF-616/receipt-RC-AF-616-1.json`
- 修改：`src/engine-adapters/judge/judge.types.ts`、`src/auto-practice/metrics/metric-dictionary.ts`、`src/auto-practice/metrics/batch-metrics.schema.ts`、`test/auto-practice/wp-k-metric-dictionary.spec.ts`、`docs/worklog/records/phase3-judge-layer/AF-616/manifest.json`
- 删除：无
- 删除引用核对：不适用

## 5. 验收清单

| 验收项                                                                               | 结果 | 证据                                                                 |
| ------------------------------------------------------------------------------------ | ---- | -------------------------------------------------------------------- |
| 纯函数计算逐维一致、整体一致集合、信心差与分歧维度清单；单侧 null 不计入分母         | pass | `test/engine-adapters/judge/judge-agreement.spec.ts` 配对与聚合用例  |
| 批次聚合输出配对场次、逐维/整体一致率、分歧维度分布；低样本一致率 null 且无达标结论  | pass | `aggregateJudgeAgreement` 与低样本用例                               |
| 字典新增 `judge.agreement.*` neutral 段，版本升 `dict-v5`                            | pass | 字典 8 项断言 + `wp-k-metric-dictionary.spec.ts`                     |
| v1 快照保持 v1，agreement 为 judge 可选子段；旧快照/缺省兼容、非法段拒绝             | pass | `judge-agreement.spec.ts` 快照子段 6 例 + batch schema 入口拒绝      |
| agreement 只引用两侧既有 lineage，不发起 Provider 调用                               | pass | `buildJudgeAgreementSection` 仅裁剪 `JudgeReviewLineage`；无端口调用 |
| 单测覆盖完全一致、逐维分歧、单侧 null、双侧 null、低样本、信心差/清单、快照兼容/拒绝 | pass | 16 条单测                                                            |
| 交付记录登记指标 id/类型/纯函数位置/测试结果/第二 Provider 遗留                      | pass | 本记录 §3、§6、§8                                                    |

## 6. 闸门证据

| 实际命令                                                                                                           | 退出码 | 错误 | 警告 | 用例/文件等关键数字                                                       | 原始证据                              |
| ------------------------------------------------------------------------------------------------------------------ | -----: | ---: | ---: | ------------------------------------------------------------------------- | ------------------------------------- |
| `node scripts/orchestration/cli.mjs events verify`                                                                 |      0 |    0 |    0 | 事件 2538 条，哈希链与索引投影一致                                        | 终端输出                              |
| `node scripts/orchestration/cli.mjs validate --sheet docs/worklog/records/phase3-judge-layer/AF-616/task-sheet.md` |      0 |    0 |    0 | AF-616 任务单元、状态索引、事件链、工具契约、协议视图、Agent Card 全 PASS | 终端输出                              |
| `pnpm lint`                                                                                                        |      0 |    0 |    0 | 全仓 TS + scripts lint 通过                                               | 终端输出                              |
| `pnpm typecheck`                                                                                                   |      0 |    0 |    0 | tsc --noEmit 通过；node>=26 仅 pnpm engine WARN                           | 终端输出                              |
| `pnpm exec vitest run test/engine-adapters/judge test/auto-practice/wp-k-metric-dictionary.spec.ts`                |      0 |    0 |    0 | 7 files / 67 tests passed                                                 | 终端输出                              |
| `pnpm test`                                                                                                        |      0 |    0 |    0 | 全量回归（见复现说明）                                                    | `.tmp/af616-evidence/vitest-full.log` |
| `pnpm orchestration:preflight`                                                                                     |      0 |    0 |    0 | 暂存唯一归属 AF-616                                                       | 终端输出                              |

复现说明：Windows DESKTOP-E3VQ9P，Node v22.23.2 / pnpm 9.15.0，AF-616 独立 worktree `origin/integrate 98d745f1`。顺序：events verify → validate -> lint → typecheck → 目标 Vitest → 全量 `pnpm test` → preflight。首次全量在 worktree 缺 `.env` 时 3 条 batch-report CLI 用例因 JWT 环境校验退出 1；补本地 `.env` 后重跑全量作为最终证据，未改任何运行时代码。

## 7. Scope、契约与并行隔离

- `scopeCheck`：`in-scope`；依据：新增/修改均落在 AF-616 `scope.files` 与 records 记录包内。
- 并行产物已排除：`true`；依据：主工作区约 500 项历史脏文件未进入本 worktree，提交只含上述文件。
- 无越界重构：`true`；未改 drills、Regression evaluator、PsyGuard、Flutter、framework 规范件。
- 契约核对：taskId / state-write / scope-file / contract-ref / event-chain 全 pass。
- 字段对齐与真相源：`aligned`；任务单、交付记录、回执同 taskId、同数字、同结论；台账以 `docs/worklog` 为唯一事实源。
- Framework 规范件：未修改。
- PsyGuard：未触碰。

## 8. 偏差、遗留与人工复核

- 偏差：AF-612 在 submitted 无法原地扩 scope，改由 successor AF-616 承接并加入字典测试文件；AF-615 在首轮 run-once 被误派发后取消，未开工，需编排侧另发 review 单承接。
- Backlog：第二模型族 Provider 未接入（依赖外部模型 key，另开任务单）；AF-613/614 依赖需由编排侧从 AF-612 改指 AF-616。
- 未决问题：无代码层未决；下游依赖指向需编排侧处理。
- 人工/小豆复核：核对 AF-616 回执、changedFiles、scope 与更正后的依赖台账。

## 9. 提交、推送与结论

- Commit：`fc361ea99fddf17cca44f2a60136496b5eef30c8`（9 files, +937/-8；Task trailer `AF-616`）
- Push / PR：任务分支已推送 `origin/task/AF-616-judge-layer-p1-a-scope-judge-agreement`；draft PR #315 https://github.com/aa386400024/mofang-nestjs/pull/315 （base `integrate`，合并门未执行）
- `finalStatus`：`completed`
- `reviewVerdict`：`passed`
- 结论依据：AF-616 全部验收项与闸门真实通过；scope 内无并行产物、无越界重构；契约与字段对齐；遗留仅第二 Provider 未接入与编排侧依赖改指。

交回小豆：回执 JSON `docs/team/agent-orchestration/transport/receipts/AF-616.json`；交付记录 `docs/worklog/completed/phase3-judge-layer/af616-p1-judge-agreement-metrics-2026-11-29.md`。由小豆核对证据和 scope 后更新台账。
