---
taskId: AF-456
contextId: phase2.5-orchestration-closed-loop
title: AF-446~AF-455 候选改进统一入库台账
type: documentation
status: backlog
baselineRef: d3e85a47865a6d2f8cdbee95497fd91b3b6e4fcc
dependsOn: []
priorTasks: [AF-455, AF-454, AF-452, AF-451, AF-450, AF-449, AF-446]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.2]
createdAt: 2026-11-24T11:00:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/team/agent-orchestration/improvement-log.json
    - docs/worklog/completed/phase2.5/af456-improvement-intake-2026-11-24.md
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-456/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af456-improvement-intake-2026-11-24.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs improvements --summary
    check: 台账可解析、计数自洽
    threshold: exit=0
  - command: git diff --stat HEAD -- src/
    check: 本任务零代码改动
    threshold: exit=0
successCriteria:
  - AF-446~AF-455 期间登记在回执 backlogItems 里、且仍未关闭的候选改进，全部以 candidate 入 improvement-log.json，逐条带 source/type/layer/relatedTaskId/evidence/impact/suggestion。
  - 已在后续任务真实关闭的条目（AF446-B1/B2 由 AF-454 关闭、AF449-B2 由 AF-450 关闭、AF450-B1 由 AF-451 关闭、AF450-B3/AF451-B3 lint warning 已消失）不入 candidate，改为入库即 dontfix 或直接不登记，理由写进交付记录。
  - 同一事实的多条重复候选（AF450-B2 与 AF451-B2、AF450-B3 与 AF451-B3）合并为一条，evidence 同时挂两个来源。
  - improvements --summary 可正常解析，条目 ID 连续、无重复、枚举值全部落在封闭集合内。
  - git diff --stat HEAD -- src/ 为空。
---

# AF-456 · AF-446~AF-455 候选改进统一入库台账

## 背景

AF-446 ~ AF-455 十个任务收口时，各回执的 `backlogItems` 里累计了 13 条以上候选改进（AF446-B1~B2、AF449-B1~B3、AF450-B1~B3、AF451-B1~B3、AF452-B1~B2，以及 AF-454/AF-455 新增项）。这些候选一直只活在 `docs/team/agent-orchestration/transport/receipts/*.json`（gitignored）里，没有进 `docs/team/agent-orchestration/improvement-log.json`，后果是：下次治理时会被当成新问题重新提一遍，之前攒的分析等于白做。

台账属状态面生成物，只能经 `improvements --add / --transition` 写入（枚举封闭、流转单向），因此需要一次带状态面写入权限的任务——即本任务。

## 范围

- `docs/team/agent-orchestration/improvement-log.json`（唯一写入目标，只经 CLI）
- `docs/worklog/completed/phase2.5/af456-improvement-intake-2026-11-24.md`（交付记录）
- `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-456/`（记录包）

## 验收

1. 仍有效的候选全部入库，每条至少能追溯到一篇已提交的交付记录作为 evidence。
2. 已关闭项不重复登记；重复事实合并；取舍理由逐条写进交付记录。
3. `improvements --summary` 解析通过，计数自洽（候选数增量 = 新增条数）。
4. 台账结构未被破坏：顶层键仍为 `schemaVersion / note / updatedAt / improvements`，条目字段与既有 73 条一致。
5. `git diff --stat HEAD -- src/` 为空。

## 不做

- 不改任何 `src/` 代码，不动 `engine-core`。
- 不对既有 73 条做 `--transition`（除本任务新增条目自身的状态说明外），历史状态保持原样。
- 不在本任务里处理 MiniMax worktree 隔离（另开任务）。
