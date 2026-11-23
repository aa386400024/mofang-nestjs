---
taskId: AF-400
contextId: phase2.5-orchestration-closed-loop
title: 编排健康回执误报修复（仅统计在办任务）
type: implementation
status: backlog
baselineRef: e89b2a2471f5feb0407d5ff9d5440b62eb01b1d0
dependsOn: []
priorTasks: [AF-398, AF-396]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T01:44:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
    - docs/worklog/pending/archive/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af400-orchestration-health-false-positive-2026-11-24.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs status
    check: 回执校验失败=0，AF-382 / AF-389 不再出现在健康区
    threshold: 回执校验失败=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
successCriteria:
  - printOperationalHealth 只统计 index.tasks 中的在办任务
  - 已归档 / 已取消任务的陈旧 receiptErrors 不再计入
  - 租约过期与回执无指纹同样只统计在办任务
---

## 背景

AF-382、AF-389 已归档，但 `status` 运行健康区仍把它们的陈旧 `receiptErrors` 计为“回执校验失败=2”。根因是 `printOperationalHealth()` 直接遍历 `runtime.tasks`，未按 `index.tasks` 过滤终态任务。

## 目标

健康统计只覆盖在办任务；终态任务的运行态残留不再产生告警。
