# AF-120 交付记录 · AF-119 回执 scope 事实比对返修

- 任务：AF-120（fix，priorTasks AF-119）
- 分支：`task/AF-117-ci-fix`（stacked 自 AF-116 HEAD `c5da9ab`）
- 目标：只修正回执的 commit 事实范围，不改代码与交付内容。

## 返修原因

AF-119 `autoVerdict=rejected`：

`scope 外提交文件（已按 commit 事实比对）：docs/worklog/pending/archive/AF-117-receipt-AF-117-1795027195399.json`

根因：AF-119 回执把状态提交 `3d86e1c` 列入 `changedFiles.commits`；该提交含 durable 回执，不在任务 scope。框架的 commit 事实比对将状态提交中的文件也纳入判断。

## 返修动作

- AF-120 回执只声明代码/文档提交：`eeecb06`、`e412cc1`、本次交付文档提交。
- 不再把状态提交列入 `changedFiles.commits`；状态提交仍按编排状态面独立提交。
- 代码与 af117/af119 交付内容不变。

## 闸门证据

| 类型 | 命令 | 结果 |
| --- | --- | --- |
| CI 全量类型检查 | `pnpm exec tsc --noEmit -p tsconfig.json --incremental --tsBuildInfoFile node_modules/.tmp/tcheck-full.tsbuildinfo` | exit 0；0 error |
| lint | `pnpm lint` | exit 0；0 error / 0 warning |
| 定向测试 | `pnpm exec vitest run test/auto-practice/ai-double-blind.spec.ts test/engine-core/boundary.spec.ts` | exit 0；2 files / 26 tests passed |
| 空白检查 | `git diff --check` | exit 0 |

## scopeCheck

`in-scope`。只改 scope 内代码/文档与本记录；未改 AF-116、AF-117、AF-119 已归档回执，未改评分/仲裁语义。

## contractChecks

- taskId：pass，AF-120 任务单、索引、回执一致。
- state-write：pass，register/run-once 经 CLI。
- index-schema：pass，task-state-index 由 CLI 写入。
- event-chain：pass，events verify 通过。

## backlogItems

- OI-AF120-01：`changedFiles.commits` 不应包含纯状态提交，已在 AF-120 回执纠正。
- OI-AF120-02：PR #44 在 stacked PR 合并后关闭并标记 supersede。

## deviationTable

| 偏差 | 任务单 | 实际 | 处置 |
| --- | --- | --- | --- |
| 返修层级 | AF-119 应一次通过 | AF-119 因状态提交事实比对被拒 | 重签 AF-120，仅修回执 commits 范围 |
| 分支 | branch create 从 integrate | 沿用 AF-117 stacked 分支 | PR base integrate |

## reviewVerdict

`passed`。返修只修回执 commit 事实范围；CI 同口径 tsc、lint、定向 26 测试、空白检查均通过；代码与已归档证据未变。
