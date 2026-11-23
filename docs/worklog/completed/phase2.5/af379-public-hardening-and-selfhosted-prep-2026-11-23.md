# AF-379 处置记录：已取消（资源域越界）

- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-379/task-sheet.md`
- 状态：canceled
- 原因：scope 含 `docs/runbooks/`，不在 orchestrator 资源域，`run-once` 返回 `scope-domain-conflict`。
- 处置：重签 AF-380；runbook 改放 `docs/security/`。
