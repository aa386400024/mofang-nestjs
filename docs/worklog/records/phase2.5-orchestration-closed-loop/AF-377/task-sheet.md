---
taskId: AF-377
contextId: phase2.5-orchestration-closed-loop
title: squash 合并提交按任务单 scope 并集判定
type: fix
status: backlog
baselineRef: 27663341b299e01552fa5635092e1c78db4142c5
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3, agent-orchestration/README.md#强制准入]
createdAt: 2026-11-23T19:00:00+08:00
deadline: null
agentRole: orchestrator
riskClass: R1
riskRationale: 只改 CI 编排门对 stacked PR squash 提交的 scope 判定与单测，不放宽单任务 scope。
gateProfile: full
objective: 修复 stacked PR squash 后单个任务号无法覆盖前序任务文件导致的 scope-residual
successCriteria:
  - squash 提交包含多个任务单时，scope 取这些任务单的并集
  - 单任务提交仍只按自己的 scope 判定，越界仍失败
  - AF-375/AF-376 的 squash 提交在本地复跑通过
outOfScope:
  - 不改 engine-core、业务代码与状态面生成物
  - 不改变 PR 逐提交判定
references: []
priorTasks:
  - AF-376
  - AF-375
constraints:
  - 并集仅来自提交内实际变更的任务单，不读取活跃任务作为放水来源
scope:
  files:
    - scripts/orchestration/
    - docs/worklog/records/
    - docs/worklog/completed/phase2.5/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af377-squash-scope-union-2026-11-23.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测全绿
    threshold: exit 0，0 failed
assertions:
  - stacked squash 的 scope 为提交内任务单并集
  - 单任务越界仍被 scope-residual 拒绝
---

## 背景

PR #183 将 AF-375 与 AF-376 堆叠合并，squash 提交只携带 `Task: AF-376`，于是 AF-375 改动的 `.github/workflows/ci.yml`、状态面与 `web/orchestration/data.js` 被 CI 判为越出 AF-376 scope，integrate 的 Orchestration Gate failure。

## 范围

- 在逐提交快照判定中收集该提交内变更的所有 `records/**/task-sheet.md`，将其 scope 作为并集。
- 单任务提交仍等价于原行为；不读取索引里的活跃任务来扩大范围。
