# AF-387 工作区产物收口验收返修 — 交付记录

- 任务：AF-387（R1 / light / orchestrator）
- 基线：`57bcf1cc8012353cc5a362355ea134bcbba61451`（AF-386 分支 HEAD）
- 日期：2026-11-23
- 分支：`task/AF-387-workspace-artifact-cleanup-acceptance-fix`

## 结论

AF-386 的实际文件收口保持不变：`.gitignore` 仍阻断 `.tmp/`、`data/handoff/`、`data/phase25-exit/`，3 份 relay-response 已入库，AF-371 已移出 records。AF-387 只补机读验收缺口：把 `records/phase2.5-orchestration-closed-loop/AF-386/` 纳入 scope，并按六组字段要求重写交付记录。AF-386 的 rejected 历史不修改、不重写、不 force push。

## 机读字段标记

- gateResults：见下表，lint、typecheck、test、preflight、空白检查均通过。
- scopeCheck：in-scope；AF-386 记录包与本任务记录包均在 `docs/worklog/records/phase2.5-orchestration-closed-loop/` scope 内。
- contractChecks：taskId 一致；状态面只经 CLI；索引 schema 1.2.0；事件链哈希连续；engine-core 零改动。
- backlogItems：无新增；AF-386 机读验收口径问题已在本任务闭合，不新增遗留。
- deviationTable：AF-386 任务单 scope 未预列登记落点，AF-387 已用目录级 scope 覆盖；不改写历史提交。
- reviewVerdict：passed。

## 改动清单

1. 新增本交付记录 `docs/worklog/completed/phase2.5/af387-workspace-artifact-cleanup-acceptance-fix-2026-11-23.md`。
2. 新增 AF-387 任务单与 manifest，scope 覆盖 `docs/worklog/records/phase2.5-orchestration-closed-loop/`，使 AF-386 的 `manifest.json` 不再成为 scope 外文件。
3. 不改 `.gitignore`、不改 relay-response 文档、不恢复 AF-371；AF-386 的实际收口动作保持原样。

## 闸门与证据

| 闸门             | 命令                                      | 结果                                                                       |
| ---------------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| 空白检查         | `git diff --check`                        | exit 0，无输出                                                             |
| 编排前置门       | `pnpm orchestration:preflight`            | PASS                                                                       |
| ESLint           | `pnpm lint`                               | exit 0，0 error                                                            |
| 类型检查         | `pnpm typecheck`                          | exit 0，0 error                                                            |
| 全量单测         | `pnpm test`                               | 312 文件：311 passed / 1 skipped；4755 例：4751 passed / 4 skipped；28.40s |
| engine-core 红线 | `git diff --stat HEAD -- src/engine-core` | 空                                                                         |

## 验收差异

AF-386 机读结论为 rejected，原因有两条：

1. 回执 `changedFiles.commits` 比对到 `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-386/manifest.json`，而 AF-386 任务单 scope 没有这个登记落点。
2. AF-386 交付记录使用中文块标题，没有出现 `gateResults`、`scopeCheck`、`contractChecks`、`backlogItems`、`deviationTable`、`reviewVerdict` 六个机读锚点。

AF-387 按编排规则从 AF-386 HEAD 起 stacked 分支，保留原提交与证据，只补 scope 与交付字段；不把 AF-386 的 rejected 改成 completed，也不关闭 AF-386 的原始 PR 后重新伪造通过结论。
