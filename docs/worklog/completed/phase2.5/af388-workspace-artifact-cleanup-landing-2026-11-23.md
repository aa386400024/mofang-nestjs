# AF-388 工作区产物收口线性化落地 — 交付记录

- 任务：AF-388（R1 / light / orchestrator）
- 基线：`78f0501653ebbd62006c8bf9c3cc699c42938e71`
- 日期：2026-11-23
- 分支：`task/AF-387-workspace-artifact-cleanup-final`

## 结论

把 AF-386/AF-387 已完成的文件收口内容在 integrate 基线上线性落地：`.gitignore` 阻断 `.tmp/`、`data/handoff/`、`data/phase25-exit/`；3 份 relay-response 作为复审证据入库；AF-371 草稿不再进入 records；AF-386/AF-387 记录包与交付记录作为历史证据保留。AF-386 的 rejected 状态不改、原分支不重写、不 force push。

## 机读字段标记

- gateResults：见下表；lint、typecheck、test、preflight、空白检查与 engine-core 空 diff 均通过。
- scopeCheck：in-scope；实现提交的 15 个文件全部落在 `.gitignore`、`docs/worklog/pending/archive/`、`docs/worklog/records/phase2.5-orchestration-closed-loop/`、`docs/worklog/completed/phase2.5/`。
- contractChecks：taskId 一致；状态面只经 CLI；索引 schema 1.2.0；事件链哈希连续；AF-388 自身任务单与回执可解析。
- backlogItems：无新增；AF-386 的 scope 漏列与 AF-387 stacked rejected 提交问题已在本任务用线性落地闭合。
- deviationTable：AF-388 不沿用 AF-386 提交历史，而是在 integrate 基线重放同一批文件；这是为了通过逐提交编排门，不改变文件内容与最终工作区状态。
- reviewVerdict：passed。

## 改动清单

1. `.gitignore` 增加 `.tmp/`、`data/handoff/`、`data/phase25-exit/` 三段阻断与说明。
2. 新增 `relay-response-AF357/358/359` 三份复审证据到 `docs/worklog/pending/archive/`。
3. 新增 AF-386、AF-387、AF-388 任务单/manifest/回执副本到 `docs/worklog/records/phase2.5-orchestration-closed-loop/`。
4. 新增 AF-386、AF-387、AF-388 三份交付记录到 `docs/worklog/completed/phase2.5/`。
5. 未改 `src/`、`test/`、`bin/`、`engine-core/`；未提交 `.tmp/` 与 `data/` 实验产物。

## 闸门与证据

| 闸门             | 命令                                      | 结果                                                                       |
| ---------------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| 空白检查         | `git diff --check`                        | exit 0，无输出                                                             |
| 编排前置门       | `pnpm orchestration:preflight`            | PASS；实现提交 files=15 covered=15                                         |
| ESLint           | `pnpm lint`                               | exit 0，0 error                                                            |
| 类型检查         | `pnpm typecheck`                          | exit 0，0 error                                                            |
| 全量单测         | `pnpm test`                               | 312 文件：311 passed / 1 skipped；4755 例：4751 passed / 4 skipped；28.40s |
| engine-core 红线 | `git diff --stat HEAD -- src/engine-core` | 空                                                                         |

## 验收差异

AF-386 机读 rejected 的两条原因与 AF-387 的 stacked 分支问题，最终处理如下：

1. AF-386 任务单 scope 未覆盖 `records/.../AF-386/manifest.json`：AF-388 scope 使用目录级 `docs/worklog/records/phase2.5-orchestration-closed-loop/` 覆盖，且不修改 AF-386 任务单。
2. AF-386 交付记录缺六组英文机读字段：AF-387/AF-388 交付记录均显式包含六组标记。
3. AF-387 从 AF-386 HEAD stacked，逐提交门会看到 AF-386 rejected 提交：AF-388 在 integrate 基线用单个实现提交重放文件内容，避免把 rejected 提交带进 PR 历史，同时保留 AF-386/AF-387 记录包与交付记录作为历史证据。
