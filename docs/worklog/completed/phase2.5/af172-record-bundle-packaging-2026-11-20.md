# AF-172 交付记录 · 发布树记录包与墓碑证据补齐

- 日期：2026-11-20
- 任务：AF-172
- 角色：orchestrator（主 AI 自做）
- 分支：task/AF-172-record-bundle-packaging（stacked 于 AF-171 头 926406d）
- 关联：PR #52 Orchestration Gate 日志、AF-163 迁移报告、AF-171

## 1. 问题

PR #52 的 `Orchestration Gate` 在 `worklog verify --strict` 阶段报大量：

```
记录包缺 manifest：AF-131 … AF-167
```

本地校验通过、CI 失败，是因为 AF-163 补齐的 117 份 manifest 与 legacy/墓碑证据只落盘、
从未进入提交树。CI 在干净 checkout 上自然看不到这些文件。

## 2. 改动

- `docs/worklog/records/`：把已归档任务的 record bundle 完整入库，包括
  `manifest.json`、不可变 `task-sheet.md`、回执副本、`README.md`、`TOMBSTONES.md`
  与 `migration-report-2026-11-20.json`。
- 不改任何历史任务单、回执或 manifest 的内容；只把工作区已有文件纳入版本控制。
- 排除 AF-170：该记录包属于被拒后放弃的分支，不在当前状态索引内。

## 3. gateResults

| 命令 | 结果 |
| --- | --- |
| `node scripts/orchestration/cli.mjs worklog verify --strict` | PASS，记录包数 = 归档数 |
| `node scripts/orchestration/cli.mjs events verify` | PASS，哈希链与索引投影一致 |
| `git status --short docs/worklog/records` | 仅 AF-170 孤儿目录未入库 |

## 4. scopeCheck

改动仅落在 `docs/worklog/records/`、`docs/worklog/completed/`、
`docs/team/agent-orchestration/`。未改 `src/`、`scripts/`、`bin/`、`admin-dashboard/`。

## 5. contractChecks

- taskId：AF-172，与任务单一致。
- 记录包结构：manifest 与 task-sheet 一一对应。
- 事件链：`events verify` 通过。
- 证据不变性：仅新增文件，无历史内容改写。

## 6. backlogItems

无新增遗留。PR #52 将在新 PR 全绿后关闭并标注 superseded。

## 7. deviationTable

无偏差。任务单预估 117 份 manifest，实际补齐 182 份 record bundle；差异来自
AF-163 迁移时未入库的全部记录，属于同一根因的完整收敛。

## 8. reviewVerdict

passed。干净 checkout 的记录包完整性由提交树本身保证；远端 Orchestration Gate 待复核。
