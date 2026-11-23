---
taskId: AF-407
contextId: phase2.5-orchestration-closed-loop
title: zero_motion 归因口径承接（合规提交形态）
type: fix
status: backlog
baselineRef: eb051e3c06914cb91cd938713dcdf301f906eac9
dependsOn: []
priorTasks: [AF-405, AF-406]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T03:10:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/auto-practice/metrics/
    - test/auto-practice/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
    - docs/worklog/pending/archive/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af407-zero-motion-attribution-carryover-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/wp-k-batch-compute.spec.ts
    check: 批次指标单测全绿
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
successCriteria:
  - 实现提交标题只含 AF-407，且同一提交新增 AF-407 任务单
  - 代码与 AF-405 / AF-406 逐字一致，不重写业务逻辑
  - 远端 Orchestration Gate、单测、lint、typecheck 全绿
  - 交付记录说明两次返修原因与最终合规形态
---

## 背景

AF-405 代码与证据已验收，但实现提交未随带任务单，归档后 CI 判 `no-active-task`。AF-406 补上了任务单，但提交标题同时出现 AF-406 与 AF-405 两个任务编号，`pr-release` 在创建 PR 前拒绝。两次返修均未改变业务逻辑，问题只在提交形态。

## 目标

用 AF-407 重新承接同一份已验收代码与证据，实现提交标题唯一、同提交新增 AF-407 任务单；在归档前完成实现、回执两个提交，最后再落状态面，避免再次出现“归档后无法补实现提交”。

## 范围隔离

只改 `src/auto-practice/metrics/`、`test/auto-practice/`、交付记录与记录包；不碰 `src/engine-core`、`src/voice`、前端、数据库。
