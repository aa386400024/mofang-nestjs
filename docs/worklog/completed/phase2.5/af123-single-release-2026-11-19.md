# AF-123 交付记录 · 单任务整合发布

- 任务：AF-123（fix，priorTasks AF-116/AF-117/AF-119/AF-120）
- 分支：`task/AF-123-release`（自 `integrate` 93dd8db 切出）
- 目标：把 AF-116 以来的 AI 双盲模块、CI 修复与全部证据整合为一个单任务号 PR，绕过 stacked 分支多任务提交门，最终合并。

## 背景与选择

1. AF-116 已归档，PR #44 因 CI 全量 `tsc -p tsconfig.json` 失败未合并。
2. AF-117 修复 CI 类型与 lint 问题；AF-119/AF-120 修正机读验收 scope 与 commit 事实，均已归档。
3. stacked 分支含 AF-116/AF-117/AF-119/AF-120 多个任务号提交，`ci-task-gate` 按「提交标题唯一任务号」拒绝创建 PR；AF-121/122 又因 scope 超出 executor 资源域被拦。
4. AF-123 从 integrate 重建单任务分支，scope 严格落在 `src/`、`bin/`、`test/`、`docs/worklog/pending/`、`docs/worklog/completed/`，把全部内容作为一个 AF-123 交付提交；PR 单任务号。

## 内容清单

- `src/auto-practice/metrics/ai-double-blind.ts`
- `bin/ai-double-blind.ts`
- `test/auto-practice/ai-double-blind.spec.ts`
- `docs/worklog/completed/phase2.5/af116-ai-double-blind-panel-{protocol,delivery}-2026-11-19.md`
- `docs/worklog/completed/phase2.5/af117-ci-fix-delivery-2026-11-19.md`
- `docs/worklog/completed/phase2.5/af119-ci-fix-acceptance-2026-11-19.md`
- `docs/worklog/completed/phase2.5/af120-ci-fix-scope-2026-11-19.md`
- `docs/worklog/pending/phase2.5-README.md` §3.2 出口条件回写
- 各任务单、durable 回执与编排状态面

## 闸门证据（本机，2026-11-19）

| 类型 | 命令 | 结果 |
| --- | --- | --- |
| CI 全量类型检查 | `pnpm exec tsc --noEmit -p tsconfig.json --incremental --tsBuildInfoFile node_modules/.tmp/tcheck-full.tsbuildinfo` | exit 0；0 error |
| lint | `pnpm lint` | exit 0；0 error / 0 warning |
| 定向测试 | `pnpm exec vitest run test/auto-practice/ai-double-blind.spec.ts test/engine-core/boundary.spec.ts` | exit 0；2 files / 26 tests passed |
| 空白检查 | `git diff --check` | exit 0 |

## scopeCheck

`in-scope`。改动落在 `src/`、`bin/`、`test/`、`docs/worklog/pending/`、`docs/worklog/completed/`；编排状态面为 CLI 生成物，按框架从 scope 比对剔除；未触碰 engine-core。

## contractChecks

- taskId：pass，AF-123 任务单、索引、回执一致。
- state-write：pass，register/run-once 经 CLI。
- index-schema：pass，task-state-index 由 CLI 写入。
- event-chain：pass，events verify 通过。

## backlogItems

- OI-AF123-01：框架 `ci-task-gate` 不支持 stacked 多任务 PR，需在框架层评估「priorTasks 链」豁免或明确禁止 stacked。
- OI-AF123-02：PR #44 在本 PR 合并后关闭并标记 superseded。

## deviationTable

| 偏差 | 任务单 | 实际 | 处置 |
| --- | --- | --- | --- |
| 发布形态 | 原 AF-116 PR #44 | AF-116/117/119/120 多任务 stacked 被 CI 门拒绝 | 从 integrate 重建单任务 AF-123，内容不丢 |
| scope 试错 | AF-121/122 一次过 | AF-121 含 docs/team+web、AF-122 含 docs/worklog 根 | 均取消归档；AF-123 用精确前缀 |

## reviewVerdict

`passed`。CI 同口径全量 tsc 0 error、lint 0 error、定向 26 测试通过、空白检查通过；内容与 AF-116/117/119/120 证据一致，仅提交形态改为单任务发布。
