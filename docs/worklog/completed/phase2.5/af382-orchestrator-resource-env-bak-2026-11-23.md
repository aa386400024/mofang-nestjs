# AF-382 处置记录：rejected（回执冻结顺序错误）

- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-382/task-sheet.md`
- 状态：rejected
- 原因：先 `run-once` 后 `receipt freeze`，首次摄入判 `receipt-not-frozen`，任务被拒。
- 处置：AF-383 重签同一资源域补丁；流程固定为“实现提交 → 回执冻结并提交 → run-once”。
- 代码改动已由 AF-383 重新落地，AF-382 分支不再合并。
