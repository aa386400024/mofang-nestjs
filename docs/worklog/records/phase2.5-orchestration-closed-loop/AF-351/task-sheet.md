---
taskId: AF-351
contextId: phase2.5-orchestration-closed-loop
title: 修正取消任务指针提交的多任务编号并重写任务分支历史
type: fix
status: backlog
baselineRef: 5620a89159e7bd4c59b350d89f6bac9e264443d3
dependsOn: []
priorTasks: [AF-347, AF-348, AF-349, AF-350]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-23T09:25:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - docs/worklog/completed/
    - docs/worklog/records/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af351-history-rewrite-2026-11-23.md
    kind: report
gates:
  - command: node scripts/orchestration/ci-task-gate.mjs --base origin/integrate --head HEAD --require-accepted --task-id task/AF-349-bdi-semantic
    check: 逐提交任务门通过
    threshold: exit=0
successCriteria:
  - 任务分支历史中不再存在“提交标题含多个任务编号”的提交。
  - 逐提交任务门与 PR 的 Orchestration Gate 转 success。
  - 不改 AF-347 / AF-348 / AF-349 / AF-350 的既有证据内容。
---

# AF-351 · 修正多任务编号提交

AF-350 的提交标题同时出现 AF-350 / AF-347 / AF-348，`ci-task-gate.mjs` 判为 `ambiguous-task-id`，PR #172 的 Orchestration Gate 因此失败。

本单只重写任务分支上该提交的消息与历史，使每个提交标题只含一个任务编号；不改任何证据文件内容，不动代码。
