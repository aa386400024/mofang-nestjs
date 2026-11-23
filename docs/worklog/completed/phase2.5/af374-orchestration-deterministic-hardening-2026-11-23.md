# AF-374 编排闭环确定性收口返修：回执冻结、归档不写记录包、Task trailer、合并后状态自愈

> 状态：实现完成，待回执冻结与验收（2026-11-23）
> 执行方：Doubao 主控 AI（orchestrator 自做）
> 仓库：`D:\work\Project\backend\mofang-nestjs-af281r`，分支 `task/AF-374-orchestration-deterministic-hardening`
> 任务性质：编排适配层修复 + 契约操作文档
> 改动范围：仅 `scripts/orchestration/`、`.husky/`、`package.json` 与 `docs/team/agent-orchestration/`；不触碰 engine-core 与业务代码。

## 1. 背景与目标

AF-365 → AF-373 收口中反复出现四类确定性缝隙：回执在提交后才补进记录包、归档阶段回写 manifest、提交任务号靠 subject 猜、合并后本地状态面靠人工 stash 恢复。AF-373 已完成实现与归档，但未合并 PR #180 因首个提交不含任务单被 Orchestration Gate 判为 `no-active-task`。本任务按“已归档任务的未合并 PR 返修”口径承接同一范围，以正确提交序列重建，并把四类缝隙改成机器可判、不可绕过的操作契约。

## 2. 改动清单

### 2.1 回执冻结与不可变

- `scripts/orchestration/worklog.mjs`
  - 新增 `findBundledReceipt`：只有记录包存在同 `receiptId` + 同内容 sha256 的副本才算冻结。
  - 新增 `isTaskSheetBundled`：已入 records 的任务单不再参与归档回写。
  - `copyReceiptToBundle` 改为内容寻址：同 `receiptId` 内容变化生成 `receipt-<id>-<sha8>.json`，原文件永不覆盖。
  - `ensureTaskRecordBundle` / manifest 写入改为语义幂等，只有除 `updatedAt` 外内容变化才落盘。
- `scripts/orchestration/receipts.mjs`
  - `archiveTaskSheetFile` 对已在 records 的任务单直接返回，不再写 manifest。
  - `ingestReceipts` 新增 `requireBundled`：未冻结回执产生 `receipt-not-frozen`，不进入验收。
- `scripts/orchestration/scheduler.mjs`
  - `archiveTask` 只迁移状态；已入包任务不再调用 `ensureTaskRecordBundle`。
  - `run-once` 真实路径显式开启 `requireBundledReceipt`。
- `scripts/orchestration/cli.mjs`
  - 新增 `receipt freeze --taskId [--path]`：先跑七组字段/scope 预检，再冻结进记录包并输出内容哈希。

### 2.2 Task trailer 与提交门

- 新增 `scripts/orchestration/commit-trailer.mjs`：根据暂存文件与在办任务自动补 `Task: AF-xxx` 或 `Task: none`；无法唯一归属时阻断。
- `.husky/commit-msg`：conventional commit 通过后调用 trailer 生成器。
- `scripts/orchestration/ci-task-gate.mjs`：
  - 新增 `extractTaskTrailer` / `resolveCommitTaskId`，trailer 优先于 subject。
  - 新增三类硬失败：`missing-task-trailer`、trailer/subject 冲突、`state-none-with-impl`。
  - 生效时间 `TASK_TRAILER_ENFORCED_SINCE=2026-11-23T09:00:00Z`，历史提交不受影响。
- `scripts/orchestration/branch-workflow.mjs` / `pr-release.mjs`：squash 提交正文带 `Task:`；PR 标题只保留 conventional 首行，避免 GitHub 标题换行。

### 2.3 已提交回执不可原地改写

- `scripts/orchestration/task-entry-gate.mjs` 新增 `findImmutableReceiptViolations`：已跟踪的 `records/**/receipt-*.json` 若 staged 内容与 HEAD 不同，preflight 以 `immutable-receipt-modified` 阻断。修订只能生成新摘要副本。

### 2.4 合并后状态面自愈

- 新增 `scripts/orchestration/state-seal.mjs` + `pnpm orchestration:state:seal`：
  - 仅允许在 `integrate` 执行。
  - 只丢弃生成态脏文件（索引 / journal / snapshot / data.js），先备份到 `.tmp/state-seal/<timestamp>/`。
  - 任何业务或记录包脏文件直接阻断。
  - `fetch + merge --ff-only origin/integrate` 后自动跑 `events verify` 与 `worklog verify --strict`。

### 2.5 文档

- `docs/team/agent-orchestration/README.md` 新增 §4.0.1 固定收尾顺序、命令表三行与环境声明。
- 框架仓 `docs/task-contract.md` §6、`docs/receipt-contract.md` §4.1、`CHANGELOG.md` Unreleased 同步回执不可变与 Task trailer 的操作契约。

## 3. 与任务单的偏差

无。任务单 scope 覆盖全部改动；未升级框架 schema 版本，符合任务单 outOfScope。

## 4. 闸门结果

| 闸门                | 命令                                                                          | 结果                                                                |
| ------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 编排单测            | `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 268 passed / 0 failed                                               |
| v2.1 适配层         | `pnpm exec vitest run scripts/orchestration/__tests__/v21-adapters.spec.mjs`  | 13 passed / 0 failed                                                |
| 状态面/回执/CI 子套 | 5 个 spec 合并执行                                                            | 316 passed / 0 failed                                               |
| Lint                | `pnpm lint`                                                                   | exit 0                                                              |
| 类型检查            | `pnpm typecheck`                                                              | exit 0                                                              |
| 全量测试            | `pnpm test`                                                                   | 311 files passed / 1 skipped；4747 tests passed / 4 skipped；exit 0 |
| 契约包              | `pnpm orchestration:contracts`                                                | PASS：15 文件哈希与框架 2.1.0 一致                                  |
| 契约/索引校验       | `node scripts/orchestration/cli.mjs validate`                                 | PASS（含 AF-374 运行态任务单）                                      |
| 事件链              | `node scripts/orchestration/cli.mjs events verify`                            | PASS（AF-374 登记后追加事件，条数以 CLI 输出为准）                  |
| 记录包              | `node scripts/orchestration/cli.mjs worklog verify --strict --state-free`     | PASS（记录包 362，状态面孤儿按解耦口径跳过）                        |

`git diff --stat HEAD~1 -- src/engine-core` 为空。

## 5. 提交序列

1. 首个提交同时包含 `docs/worklog/records/.../AF-374/task-sheet.md` 与实现，确保 PR 逐提交门能解析任务归属。
2. 第二个提交只包含交付记录、冻结回执与 manifest，随后更新 PR。

（首个提交哈希在回执中以 `changedFiles.commits` 记录。）

## 6. 回执冻结流程（本任务实操）

1. `pnpm orchestration:receipt scaffold --taskId AF-374 --apply`
2. 填七组字段与本交付记录指针
3. `pnpm orchestration:receipt lint --taskId AF-374`
4. `pnpm orchestration:receipt freeze --taskId AF-374`
5. 提交回执副本与 manifest（`Task: AF-374`）
6. `pnpm orchestration:run`：验收 → completed → archive，只写状态面

## 7. 遗留与后续

- 框架契约包仍为 2.1.0；本次只新增操作约束文档，未改 schema，不需要重发版本。
- AF-373 的未合并 PR #180 由 AF-374 新 PR 取代，按 `pr-release close` 关闭。
- 旧分支若在 trailer 生效时间后产生无 trailer 提交，CI 会拒绝；需补 `Task:` 后重推。
