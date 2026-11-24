# AF-457 · AF-456 交付记录入库补齐（交付记录）

- 任务：AF-457（documentation / orchestrator）
- 上下文：phase2.5-orchestration-closed-loop
- 基线：`d3e85a47865a6d2f8cdbee95497fd91b3b6e4fcc`
- 前序：AF-456（候选改进统一入库）→ AF-455（归档补齐件）
- 日期：2026-11-24

## 一、要解决的问题

AF-456 在本地就地执行时把顺序走反了：先 `receipt freeze` + `run-once`（`receipt-ingested`、`archive-completed`），之后才提交 AF-456 的交付记录与记录包。此时 pre-commit 的 `orchestration:preflight` 找不到任何处于 `ready / submitted / working / input-required / completed` 的在办任务，把 AF-456 的交付记录与记录包判为越界：

```
[ORCH-GATE] 没有处于 ready/submitted/working/input-required/completed 的编排任务；
            若实现提交发生在 run-once 之后，请按两阶段提交：
            先提交实现（任务仍为 submitted），回执摄入与 completed/archived 状态面单独提交
```

显式传 `ORCH_TASK_ID=AF-456` 得到同一条提示（已归档任务不再参与写入判定）。闸门本身没错，错的是执行顺序。

本任务按纪律「已归档任务的未合并产物若需补齐，登记新任务并从旧 HEAD 切 stacked 分支」补齐，不改写 AF-456 的任何已落盘内容。

## 二、改动清单

| 文件                                                                        | 性质                 | 说明                                                                            |
| --------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------- |
| `docs/worklog/completed/phase2.5/af456-improvement-intake-2026-11-24.md`    | 新增入库（内容未改） | AF-456 交付记录，本次只是把它纳入版本库                                         |
| `docs/worklog/completed/phase2.5/af457-commit-order-backfill-2026-11-24.md` | 新增                 | 本文件                                                                          |
| `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-456/`           | 新增入库             | 任务单 + manifest + 冻结回执副本 `receipt-RC-AF-456-1.json`（哈希 `1b4111fd…`） |
| `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-457/`           | 新增                 | 本任务记录包                                                                    |

`improvement-log.json`（AF-456 的 11 条新条目 IM-074~IM-084）属状态面生成物，按纪律随状态面单独提交，不在本任务实现提交内。

## 三、闸门

| 闸门         | 命令                                                         | 结果         |
| ------------ | ------------------------------------------------------------ | ------------ |
| 记录包完整性 | `node scripts/orchestration/cli.mjs worklog verify --strict` | exit 0，PASS |
| 代码零改动   | `git diff --stat HEAD -- src/`                               | 空输出       |

## 四、与任务单的偏差

无。

## 五、本次新增的流程口径（供后续同类操作复用）

1. **两阶段提交顺序**：实现与交付记录提交（任务处于 `submitted`）→ `receipt freeze` → `run-once` 收口 → 状态面与冻结回执副本单独提交（`ORCH_ALLOW_STATE_COMMIT=1`）。
2. **已归档任务的产物补齐**：不得回头写已归档任务；登记一个 scope 覆盖该产物路径的新任务，提交在新任务名下。
3. **不要先收口后提交**：`archive-completed` 之后再提交交付记录，本地 preflight 必拦，且没有豁免开关（只能走新任务补齐）。

## 六、遗留

- 该流程坑已作为候选改进记入 AF-457 回执 backlogItems，后续统一入库（台账本轮已由 AF-456 从 73 条扩到 84 条，新条目需另起任务写入）。
