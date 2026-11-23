---
taskId: AF-432
contextId: phase2.5-orchestration-closed-loop
title: 回执与记录收口：把 AF-431 的冻结回执纳入版本控制并收口状态面
type: fix
status: backlog
baselineRef: 67e54372e171920fad603e667b181cfce59cb9b7
dependsOn: []
priorTasks: [AF-431, AF-429, AF-427]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T06:35:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af432-receipt-durable-commit-2026-11-24.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs worklog verify --strict
    check: 记录包校验 PASS
    threshold: exit=0
---

# 背景

AF-431 归档后的冻结回执 `receipt-RC-AF-431-1.json` 与 manifest 更新仍留在工作区：归档后任务已不在活跃列表，pre-commit 的「必须在办任务」门无法为「回执入库」这一步找到可归口的任务。

同时 CI 的 ACCTP 要求 PR HEAD 上存在 `completed/archived + passed durable 回执`，因此回执必须真的进版本控制，不能只躺在 gitignore 的 `transport/` 里。

# 目标

1. 把 AF-431 的冻结回执与 manifest 纳入版本控制（durable 副本）。
2. 收口状态面（归档事件后生成的索引 / journal / 快照 / dashboard data）。

# 做法

用本任务作为「回执入库」的在办归属：记录类文件与本单回执一起提交，状态面单独提交。

# 成功判据

1. `git ls-files docs/worklog/records/.../AF-431/receipt-RC-AF-431-1.json` 有输出。
2. `worklog verify --strict` PASS。
3. CI Orchestration Gate 下一次运行通过。
