# records/ 任务记录包

一个任务一个目录：`records/<contextId>/<taskId>/`

```
manifest.json          # 工件清单 + SHA-256 + 回执引用（机读唯一入口）
task-sheet.md          # 登记时的任务单快照，登记后不可变
receipt-*.json         # durable 回执副本（可多份，按 receiptId 去重）
delivery-record.md     # 可选：交付记录副本（正文仍在 completed/）
```

约定：

- 任务单只读。要改范围请走 `task reissue` 重签发，不原地改记录包；
- 状态不进 manifest 作为真相，只在 `task-state-index.json` / 事件日志；
- 历史任务单迁移后索引里的旧 `artifacts.taskSheet` 指针可能仍指向 `pending/`，
  读取侧用 `resolveTaskSheet` 回退到 manifest 并校验哈希；
- 校验：`node scripts/orchestration/cli.mjs worklog verify`；
- 迁移报告：`records/migration-report-2026-11-20.json`。
