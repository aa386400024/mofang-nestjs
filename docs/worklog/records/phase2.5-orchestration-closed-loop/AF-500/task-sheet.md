---
taskId: AF-500
contextId: phase2.5-orchestration-closed-loop
title: 验收残留比对豁免已声明的交付记录与任务单
type: fix
status: backlog
baselineRef: a12f76aa44dad966abaf5aa31727500354273843
dependsOn: []
priorTasks: [AF-499, AF-498]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.2, conventions.md#1.3]
createdAt: 2026-11-25T09:42:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/acceptance-runner.mjs
    - scripts/orchestration/__tests__/orchestration.spec.mjs
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af500-acceptance-artifact-exemption-2026-11-25.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__
    threshold: 全绿
    check: 编排测试全绿
successCriteria:
  - 验收残留比对把 task.artifacts.deliveryRecord 与 task.artifacts.taskSheet 视为任务自身产物，不再判 scope 外
  - 非声明文档仍按 scope 校验，不放宽任意 docs 路径
---

# AF-500 · 验收残留比对工件豁免

## 背景

AF-499 回执验收被拒，唯一 fail 是 `scope 外提交文件：docs/worklog/completed/phase2.5/af499-ci-anchor-portability-2026-11-25.md`。

`acceptance-runner.mjs` 的 `checkResidualByCommits` 只把状态面和任务单排除，未把任务在 `artifacts.deliveryRecord` 里声明的交付记录排除。交付记录天然不在代码 scope 内，却被 commit 事实算进交付面，导致每个任务都可能在验收阶段被自己的交付记录打成 rejected——这正是“按任务号反复返工”的结构性来源之一。

## 修复

在按 commit 事实比对时，把本任务声明的 `artifacts.deliveryRecord` 与 `artifacts.taskSheet` 一并归入任务自身产物，不参与 scope 残留判定；其他 docs 路径仍按 scope 校验。

## 验收

- 新增回归：commit 同时含代码文件与已声明交付记录时验收通过；含未声明 docs 文件时仍 rejected。
- 编排测试全绿，lint/typecheck 0 error，engine-core 未改。
