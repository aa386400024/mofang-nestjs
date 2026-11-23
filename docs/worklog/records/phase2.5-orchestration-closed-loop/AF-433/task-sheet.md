---
taskId: AF-433
contextId: phase2.5-orchestration-closed-loop
title: PR #212 收口：无语料守卫、语料版本漂移取证与历史回执一次性入库
type: fix
status: backlog
baselineRef: 67e54372e171920fad603e667b181cfce59cb9b7
dependsOn: []
priorTasks: [AF-427, AF-428, AF-429, AF-431, AF-432]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T06:45:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/__tests__/af427-operator-delta-ledger.spec.mjs
    - docs/architecture/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af433-pr212-closeout-2026-11-24.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs worklog verify --strict
    check: 记录包校验 PASS
    threshold: exit=0
  - command: pnpm exec vitest run scripts/orchestration/__tests__/af427-operator-delta-ledger.spec.mjs
    check: 9 passed
    threshold: exit=0
---

# 背景

PR #212 的 Orchestration Gate 连续两轮不通，原因都在提交组织而非代码：

1. 首轮：`fix(af429): AF-427 ...` 标题同时出现两个 taskId → `ambiguous-task-id`。
2. 次轮：历史重排后 `fix(af431)` 的提交快照里没有任何 active 任务 → `no-active-task`；另一条 `docs(af432): AF-431 ...` 又出现两个 taskId。

`ci-task-gate.mjs` 的规则是**逐提交按该提交的索引快照判定**：实现提交必须在任务 `submitted`/`ready` 等活跃态时提交；状态面单独提交；标题只能含一个 taskId。事后重排历史无法满足「当时活跃」，只能把待入库内容在一个新的活跃任务下重做两阶段提交。

# 目标

1. 一个活跃任务（AF-433）下完成实现提交：无语料守卫 + 两份台账/取证文档 + 历史任务记录入库。
2. 状态面（登记 / 归档）各单独提交。
3. 每条提交标题只含 `af433` 这一个 taskId。

# 做法

登记 → 状态面登记提交 → 实现提交（含本单回执冻结副本）→ 摄入归档 → 状态面归档提交 → 推送并由 CI 复核。

# 成功判据

1. CI Orchestration Gate 逐提交 PASS，ACCEPTANCE pass。
2. `worklog verify --strict` PASS。
3. 定向单测 9 passed。
