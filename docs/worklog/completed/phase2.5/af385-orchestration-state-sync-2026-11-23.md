# AF-385 编排状态面同步与取消任务记录补齐

- 日期：2026-11-23
- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-385/task-sheet.md`
- 结论：completed

## 改动清单

| 文件/目录                                                         | 动作                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------ |
| `docs/team/agent-orchestration/task-state-index.json`             | 同步 AF-384 completed 与 AF-379/AF-380/AF-381 canceled |
| `docs/team/agent-orchestration/orchestration-snapshot.json`       | 刷新状态快照                                           |
| `docs/team/agent-orchestration/state/journal.jsonl`               | 追加本轮事件                                           |
| `docs/team/agent-orchestration/state/archived-notes.json`         | 同步归档备注                                           |
| `web/orchestration/data.js`                                       | 刷新看板数据源                                         |
| `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-379/` | 补齐取消任务单与 manifest                              |
| `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-380/` | 补齐取消任务单与 manifest                              |
| `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-381/` | 补齐取消任务单与 manifest                              |
| `docs/worklog/records/legacy/AF-382/`                             | 删除重复副本，保留 canonical 记录包                    |

## 关键决策

1. AF-384 的实现、回执与 PR #187 已合入 `integrate`（mergeSha `813c4cc93be88aff94a567e974378af167c2fb13`），但 `run-once` 在回执提交后才归档，状态面投影未随 PR 进入远端。本任务只补状态面，不改已冻结的回执与交付记录。
2. AF-379/AF-380/AF-381 的取消记录包此前只存在于工作树，索引已指向 `records/`，因此按索引落点补齐，不移动到 legacy。
3. `records/legacy/AF-382` 与 canonical `records/phase2.5-orchestration-closed-loop/AF-382` 的任务单哈希相同，属重复投影；删除 legacy 副本，canonical manifest 与回执保持不动。

## 闸门数字

- `node scripts/orchestration/cli.mjs events verify`：PASS，事件日志 1653 条，schema `urn:agent-collaboration-framework:schema:state-event:1.0.0`，哈希链与索引投影一致。
- `pnpm lint`：exit 0。
- `pnpm typecheck`：exit 0。
- `pnpm test`：311 passed / 1 skipped 文件；4751 passed / 4 skipped 用例；27.51s。
- `git diff --stat HEAD -- src/engine-core`：空。

## 偏差表

无。

## 遗留

- `data/phase25-exit/`、`.tmp/`、`data/handoff/` 仍是本地未跟踪产物，本任务不处理。
- AF-363..AF-372、AF-376 的历史归档事件未回放，`worklog verify --strict` 仍需 state-free 模式。
