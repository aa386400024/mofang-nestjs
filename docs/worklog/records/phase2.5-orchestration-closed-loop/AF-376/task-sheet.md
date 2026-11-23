---
taskId: AF-376
contextId: phase2.5-orchestration-closed-loop
title: 修复纯状态面提交被 subject 任务号误判冲突
type: fix
status: backlog
baselineRef: d333af504d989463fca242423e434a8b677d8e4f
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3, agent-orchestration/README.md#强制准入]
createdAt: 2026-11-23T18:50:00+08:00
deadline: null
agentRole: orchestrator
riskClass: R1
riskRationale: 只改 CI 编排门任务号解析与单测，不改业务、engine-core、状态面生成物。
gateProfile: full
objective: "让 Task: none 的纯状态面提交可以自然提及所属任务号，不再被误判为 trailer/subject 冲突"
successCriteria:
  - "Task: none 与 subject 含任务号时解析为 none，不抛冲突"
  - "Task: none 携带实现文件仍被 state-none-with-impl 硬失败"
  - "Task trailer 与 subject 任务号不一致仍硬失败"
outOfScope:
  - 不改 engine-core、业务代码、数据库
  - 不放宽纯状态面判定
references: []
priorTasks:
  - AF-375
  - AF-374
constraints:
  - 不放宽 Task none 只允许纯状态面的约束
scope:
  files:
    - scripts/orchestration/
    - docs/worklog/records/
    - docs/worklog/completed/phase2.5/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af376-state-none-subject-2026-11-23.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测全绿
    threshold: exit 0，0 failed
assertions:
  - "纯状态面提交 subject 提及任务号不再 ambiguous-task-id"
  - "实现提交 Task: none 仍被拒绝"
---

## 背景

AF-375 的状态快照提交使用 `Task: none`，subject 自然带 `AF-375`，CI 逐提交门返回 `ambiguous-task-id`，导致 PR #182 失败。`Task: none` 已由 `state-none-with-impl` 保证只用于纯状态面，subject 提及任务号是合法上下文，不应再作为冲突。

## 范围

- 只调整 `resolveCommitTaskId` 的 none 分支与对应单测。
- 不放宽 `state-none-with-impl` 与 trailer/subject 不一致的硬失败。
