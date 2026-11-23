# AF-432 交付记录：回执与记录收口

- 日期：2026-11-24
- 任务：AF-432（fix / orchestrator）
- 基线：`67e54372e171920fad603e667b181cfce59cb9b7`
- 分支：`task/AF-427-operator-delta-ledger`（随 PR #212 合入）

## 1. 做了什么

把 AF-431 的冻结回执与 manifest 纳入版本控制，并收口归档后的状态面。

## 2. 为什么需要这一单

AF-431 归档后已不在活跃任务列表，而提交时 pre-commit 的「必须有在办任务」门无法为「回执入库」这一步找到归属；同时 CI 的 ACCTP 要求 PR HEAD 上存在 durable 回执，回执必须真正进版本控制，不能只留在 gitignore 的 `transport/`。

## 3. 结果

- `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-431/receipt-RC-AF-431-1.json` 入库。
- `worklog verify --strict` PASS。
- 状态面（索引 / journal / 快照 / dashboard）单独提交。

## 4. 闸门

| 闸门       | 命令                                                              | 结果 |
| ---------- | ----------------------------------------------------------------- | ---- |
| 记录包校验 | `node scripts/orchestration/cli.mjs worklog verify --strict`      | PASS |
| 回执预检   | `node scripts/orchestration/cli.mjs receipt lint --taskId AF-432` | PASS |

## 5. 教训

**归档顺序：回执入库 → 再归档。** 先归档再提交回执，会陷入「没有在办任务可归口」的死角，只能再开一单当归属——本单就是这条死角的产物。
