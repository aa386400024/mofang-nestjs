---
taskId: AF-406
contextId: phase2.5-orchestration-closed-loop
title: AF-405 提交合规返修（实现提交随带任务单，过 Orchestration Gate）
type: fix
status: backlog
baselineRef: eb051e3c06914cb91cd938713dcdf301f906eac9
dependsOn: []
priorTasks: [AF-405]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T03:00:00+08:00
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
    path: docs/worklog/completed/phase2.5/af406-af405-commit-compliance-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/wp-k-batch-compute.spec.ts
    check: 批次指标单测全绿（复用 AF-405 用例）
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
successCriteria:
  - 实现提交同时新增 AF-406 任务单，满足 CI 两阶段提交入场条件
  - AF-405 已交付代码与交付记录原样承接，不重写业务逻辑
  - 新分支提交通过 Orchestration Gate、单测、lint、typecheck
  - 交付记录说明 AF-405 归档过早导致 no-active-task 的返修原因与处置
---

## 背景

AF-405 的代码、交付记录、回执、归档都已完成，但实现提交 `1a22abd1` 只带业务文件与交付记录，没有同时新增任务单；归档后 CI 逐提交门按提交树内的状态索引判定为 `no-active-task`，PR #198 Orchestration Gate 失败。仓库已有两阶段入场规则：实现提交同时新增该任务的 records 任务单、标题含唯一任务号、当前/父索引都没有该任务时，可按 submitted 入场。本次返修用 `task reissue` 从 AF-405 重签发 AF-406，保留审计链路，并按合规形态重放同一份已验收代码。

## 目标

把 AF-405 的代码与证据原样承接到 AF-406 分支，实现提交随身携带 AF-406 任务单，使远端 Orchestration Gate 通过；不改业务逻辑、不改阈值、不碰 `src/engine-core`。

## 范围隔离

只改 `src/auto-practice/metrics/`、`test/auto-practice/`、交付记录与记录包；不碰 `src/engine-core`、`src/voice`、前端、数据库。
