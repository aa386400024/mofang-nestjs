# AF-171 交付记录 · 修复 Orchestration Gate 零依赖与编排单测夹具

- 日期：2026-11-20
- 任务：AF-171
- 角色：orchestrator（主 AI 自做）
- 分支：task/AF-171-release-gate-fix（stacked 于 AF-169 发布头 096011f）
- 关联：PR #51 失败日志、AF-170、AF-169、AF-168、AF-163

## 1. 问题

PR #51 的 `Orchestration Gate` 在 `worklog verify --strict` 阶段失败：

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'yaml' imported from
scripts/orchestration/task-intake.mjs
```

根因是 `cli.mjs` 顶层静态导入 `task-intake.mjs`，而 Gate 按设计不安装 `node_modules`。
同一轮 `Unit (shard 1/2/3)` 全部失败，三个用例引用
`docs/worklog/records/legacy/AF-023/task-sheet.md`，该路径只在部分工作区存在、不在
提交树中，导致 CI checkout 后 V1 任务单检查失败，验收结论被降为 `rejected`。

AF-170 首次执行时，回执 `changedFiles.commits` 的 commit 指针笔误，验收被拒；
AF-171 从 AF-169 发布头重新提交同一修复面，不复用被拒提交。

## 2. 改动

- `scripts/orchestration/cli.mjs`
  - 移除对 `task-intake.mjs` 的顶层静态导入，改为在 `task` 子命令与 `validate --sheet`
    实际需要时动态 `import()`。
  - `repoRelativePath` 改用本文件已有的 `pathToPosix`，不再依赖 task-intake。
  - 结果：`worklog verify` 的模块图不触达 yaml，Gate 零依赖约束恢复。
- `scripts/orchestration/__tests__/fixtures/task-sheet.md`
- `scripts/orchestration/__tests__/fixtures/delivery-record.md`
  - 新增仓内确定性夹具，含验收所需的六组字段标记。
- `scripts/orchestration/__tests__/orchestration.spec.mjs`
  - 三处历史任务单 / 交付记录指针改为仓内夹具，不再依赖被忽略的历史文件。

## 3. gateResults

| 命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs scripts/orchestration/__tests__/worklog.spec.mjs` | 2 files / 279 tests passed |
| `pnpm lint` | exit 0 |
| `node scripts/orchestration/cli.mjs worklog verify --strict` | PASS 活跃=1 归档=184 记录包=185 |
| `node scripts/orchestration/cli.mjs events verify` | PASS 746 条事件，哈希链与投影一致 |
| 移除 `node_modules/yaml` 后 `worklog verify --strict` | PASS（模拟 Gate 无依赖环境） |

## 4. scopeCheck

改动文件均落在任务 scope：

- `scripts/orchestration/`：CLI、单测、夹具。
- `docs/worklog/`：任务记录包与交付记录。
- `docs/team/agent-orchestration/`：状态面。

未改 `src/`、`bin/`、`admin-dashboard/`，engine-core diff 为空。

## 5. contractChecks

- taskId：AF-171，与任务单一致。
- 状态写入：仅经 CLI（register / promote / run-once）。
- 索引 schema：`worklog verify --strict` 通过。
- 事件链：`events verify` schema、哈希链、索引投影一致。

## 6. backlogItems

无新增遗留。PR #51 将在新 PR 全绿后关闭并标注 superseded。

## 7. deviationTable

无偏差。AF-170 的 rejected 属回执指针笔误，已用新任务重开；修复面与计划一致。

## 8. reviewVerdict

passed。零依赖 Gate 与确定性单测夹具均已本地实证；远端 13 项检查待 PR 触发后复核。
