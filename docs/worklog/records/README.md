# records/ 任务记录包

一个任务一个目录：`records/<contextId>/<taskId>/`

```
manifest.json          # 工件清单 + SHA-256 + 交付指针 + 回执引用（机读唯一入口）
task-sheet.md          # 登记时的任务单快照，登记后不可变；不可恢复时为空并带 tombstone
receipt-*.json         # durable 回执副本（可多份，按 receiptId 去重）
delivery-record.md     # 可选：交付记录副本（正文仍在 completed/）
```

约定：

- 任务单只读。要改范围请走 `task reissue` 重签发，不原地改记录包；
- 状态不进 manifest 作为真相，只在 `task-state-index.json` / 事件日志；
- `manifest.deliveryRecord` 是交付指针的规范位置；索引旧指针失效时读取侧以 manifest 为准，不把坏指针覆盖进 manifest；
- 历史任务单迁移后索引里的旧 `artifacts.taskSheet` 指针可能仍指向 `pending/`，
  读取侧用 `resolveTaskSheet` 回退到 manifest 并校验哈希；
- 终态任务若任务单在全部 git 历史中不可恢复，manifest 写 `tombstone` 证据块，
  并在 `TOMBSTONES.md` 登记，不以交付记录或索引条目冒充任务单；
- 从历史恢复的任务单在 manifest 写 `recoveredFrom`（来源提交、原路径、来源 context）；
- 校验：`node scripts/orchestration/cli.mjs worklog verify`；`--strict` 额外要求
  completed 任务存在可解析交付记录、终态无任务单必须有墓碑；
- 统计：`node scripts/orchestration/cli.mjs worklog stats`（含墓碑数）；
- 迁移报告：`records/migration-report-2026-11-20.json`。

