# AF-423 取消说明：scope 漏写交付记录目录

- 日期：2026-11-24
- 任务：AF-423（fix / orchestrator）
- 状态：`canceled`（未提交任何实现，分支 `task/AF-423-legacy-record-packages` 废弃）
- 原因：任务单 `scope.files` 只写了 `scripts/orchestration/`、`docs/team/agent-orchestration/`、`docs/worklog/pending/archive/`、`docs/worklog/records/phase2.5-orchestration-closed-loop/`，漏写 `docs/worklog/completed/phase2.5/`。交付记录落在 scope 外，`receipt freeze` 预检直接判 `changedFiles：超出任务 scope`（AF-084：scope 不原地改写）。
- 处置：按 AF-419 → AF-420 的同款路径，`task cancel` 后重登 AF-424（`priorTasks: [AF-423, AF-370]`），scope 补齐 `docs/worklog/completed/phase2.5/`；同一批交付改由 AF-424 承接，交付记录见 `af424-legacy-record-packages-2026-11-24.md`。
- 遗留教训：任务单写 scope 时按「实现目录 + 交付记录目录 + 记录包目录」三类一次写全；交付记录目录（`docs/worklog/completed/<phase>/`）最容易漏。
