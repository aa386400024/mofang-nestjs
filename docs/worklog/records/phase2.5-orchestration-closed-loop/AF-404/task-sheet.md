---
taskId: AF-404
contextId: phase2.5-orchestration-closed-loop
title: zero_motion 可观测性补齐（记录 idle/closure 场次明细）
type: implementation
status: backlog
baselineRef: 2ff6cfcc3687aed72cc602c5a330ab6189dd58c7
dependsOn: []
priorTasks: [AF-402]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T02:38:00+08:00
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
    path: docs/worklog/completed/phase2.5/af404-zero-motion-observability-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/wp-k-batch-compute.spec.ts
    check: 批次指标单测全绿，含新增零变化明细断言
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
successCriteria:
  - ZeroMotionBreakdown 增加可选 closureSessions / idleSessions 明细
  - 明细只含 debugSessionId / characterSlug / counselorModeId / turns / eventTagCounts，不含对话文本
  - schema 守卫接受新增字段，缺省时旧快照仍可读
  - 单测覆盖 idle、closure、有动作三类场次与字段联系
  - 完整字段解释写入交付记录，可直接用于定位缺失逐字稿的零变化场次
---

## 背景

`zero_motion` 根因分析发现批次指标只有 `{total, closure, idle}` 三个计数，没有持久化具体是哪几场零变化、事件标签分布是什么。最新批次 48 场里 37 场逐字稿缺失，导致另外 7 场 idle 无法定位。这是可观测性缺口，不是 BDI 计算错误。

## 目标

在批次指标里增量持久化零变化场次明细，供后续批次直接定位 sessionId 与事件标签分布，不依赖逐字稿文件是否在本机。字段只增不删，旧快照缺省兼容。

## 范围隔离

只改 `src/auto-practice/metrics/` 与对应测试、交付记录；不碰 `src/engine-core`、`src/voice`、前端。
