# pending/ 已退役为历史参考目录

> 2026-11-20（AF-161）起，本目录**不再承载 AF 任务单**。

## 现在的分工

| 目录                          | 用途                                                                 |
| ----------------------------- | -------------------------------------------------------------------- |
| `docs/worklog/inbox/`         | 只放**尚未登记**的任务单草稿；`task register` 成功后文件即移走       |
| `docs/worklog/records/`       | 一任务一个不可变记录包：`manifest.json` + `task-sheet.md` + 回执副本 |
| `docs/worklog/completed/`     | 交付记录（人读）                                                     |
| `docs/worklog/pending/`       | 本目录：Phase2/2.5 常驻母版、backlog、relay 回交记录等历史参考资料    |
| `docs/worklog/pending/archive/` | 旧回执路径，只读兼容；新回执写入记录包                              |

## 为什么保留这些文件

本目录剩余的 Phase2/2.5 总览、WP 清单、backlog、relay 回交记录被全仓约 550KB 文档、
历史回执与看板数据引用。搬迁会打断不可变证据链，因此按“历史参考”保留，只禁止再放新任务单。

## 新任务怎么走

```powershell
# 1. 写草稿
docs/worklog/inbox/af<编号>-<slug>-task-<日期>.md

# 2. 登记（文件自动进入 records/<contextId>/<taskId>/task-sheet.md）
pnpm orchestration:task register --sheet docs/worklog/inbox/af<编号>-<slug>-task-<日期>.md --status ready

# 3. 领单 / 执行 / 回执 / 归档
pnpm orchestration:run
node scripts/orchestration/cli.mjs archive <taskId> --status completed
```

任务单登记后不可变；状态只在 `docs/team/agent-orchestration/task-state-index.json` 与事件日志中流转。
完整性校验：`node scripts/orchestration/cli.mjs worklog verify`。
