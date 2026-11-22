# AF-119 交付记录 · AF-117 机读验收返修

- 任务：AF-119（fix，priorTasks AF-117，dependsOn 空）
- 分支：`task/AF-117-ci-fix`（stacked 自 AF-116 HEAD `c5da9ab`）
- 范围：`bin/ai-double-blind.ts`、`test/auto-practice/ai-double-blind.spec.ts`、af117 交付记录、本记录
- 目标：只补 scope 与交付记录五组字段标记，不改代码语义。

## 返修原因

AF-117 机读验收 `autoVerdict=rejected`：

1. `scope 外提交文件：docs/worklog/completed/phase2.5/af117-ci-fix-delivery-2026-11-19.md`；
2. af117 交付记录缺 `scopeCheck` / `contractChecks` / `backlogItems` / `deviationTable` / `reviewVerdict` 五个字段标记。

## 返修动作

- AF-119 scope 显式包含 af117 交付记录与本记录。
- af117 交付记录补齐五组字段标记。
- 代码保持 `eeecb06` 不变，未新增语义改动。

## 闸门证据

| 类型 | 命令 | 结果 |
| --- | --- | --- |
| CI 全量类型检查 | `pnpm exec tsc --noEmit -p tsconfig.json --incremental --tsBuildInfoFile node_modules/.tmp/tcheck-full.tsbuildinfo` | exit 0；0 error |
| lint | `pnpm lint` | exit 0；0 error / 0 warning |
| 定向测试 | `pnpm exec vitest run test/auto-practice/ai-double-blind.spec.ts test/engine-core/boundary.spec.ts` | exit 0；2 files / 26 tests passed |
| 空白检查 | `git diff --check` | exit 0 |

## scopeCheck

`in-scope`。只改 scope 内代码、af117 交付记录与本记录；未改 AF-116 回执与评分/仲裁语义。

## contractChecks

- taskId：pass，AF-119 任务单、索引、回执一致。
- state-write：pass，register/run-once 经 CLI。
- index-schema：pass，task-state-index 由 CLI 写入。
- event-chain：pass，events verify 通过。

## backlogItems

- OI-AF119-01：AF-117 已 rejected 归档，保留其回执作为返修证据；不重写。
- OI-AF119-02：PR #44 在 stacked PR 合并后关闭并标记 supersede。

## deviationTable

| 偏差 | 任务单 | 实际 | 处置 |
| --- | --- | --- | --- |
| 任务编号 | 原计划 AF-118 | AF-118 因 dependsOn rejected 的 AF-117 被取消 | 重签 AF-119，dependsOn 置空，priorTasks 承接 |
| 分支 | branch create 从 integrate | 沿用 AF-117 stacked 分支 | 回执登记；PR base integrate |

## reviewVerdict

`passed`。返修只补 scope 与交付记录字段标记；CI 同口径 tsc、lint、定向 26 测试、空白检查均通过；代码语义与 AF-116 证据未变。
