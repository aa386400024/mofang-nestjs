# AF-343 / AF-344 · 取消记录（已由 AF-345 收敛）

两份任务单均为 AF-342 机读 rejected 后的返修尝试，未产生交付物，先后取消。最终以 AF-345 单提交收敛完成，保留此记录用于编排台账一致性。

## AF-343

- 原因：`dependsOn: [AF-342]` 而 AF-342 归档状态为 `rejected`，`task promote` 被依赖门拒绝。
- 处置：`task cancel --taskId AF-343`，状态 `canceled`。

## AF-344

- 原因：文档返修提交所在分支仍包含 AF-342 实现提交，无法通过逐提交门；改为 AF-345 单提交闭环。
- 处置：`task cancel --taskId AF-344`，状态 `canceled`。

## 最终交付

AF-345：`feat(af345): 真人度签名判据 v1 与零调用回验闭环`，已归档 `completed`。

## gateResults

| 闸门 | 结果 |
| --- | --- |
| `node scripts/orchestration/cli.mjs worklog verify --strict` | PASS 活跃=0 归档=336 记录包=337 inbox=0 |
| 代码闸门 | 无代码改动，沿用 AF-345 的 typecheck 0 error / lint 0 error / 4554 例通过 |

## scopeCheck

- 允许域：`docs/worklog/completed/`。
- 实际改动：本文件一份；无代码、无配置、无数据改动。

## contractChecks

| 契约 | 结果 |
| --- | --- |
| taskId | pass：AF-346 经 CLI register / promote / run-once |
| state-write | pass：状态面由 CLI 生成 |
| scope | pass：仅补记录 |
| 临床边界 | pass：无任何有效性宣称 |

## backlogItems

| ID | 事项 | 状态 |
| --- | --- | --- |
| AF346-B1 | 取消任务记录应纳入归档模板，避免记录包缺交付记录 | open |

## deviationTable

| 项 | 任务单预期 | 实际 | 理由 |
| --- | --- | --- | --- |
| 记录形式 | 一份合并记录 | 一份文件同时服务 AF-343 与 AF-344 | 两份 manifest 指向同一路径 |

## reviewVerdict

- 结论：`passed`。
- 依据：取消记录补齐，`worklog verify --strict` 通过；不动 AF-345 交付物。
