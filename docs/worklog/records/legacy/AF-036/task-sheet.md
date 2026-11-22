---
taskId: AF-036
contextId: phase2.5-orchestration-closed-loop
title: 持单动作透传真实释放原因（AF-035-B1）
type: implementation
status: backlog
baselineRef: 306870288568ef12bf0c2218cd3f748d5c651bd6
dependsOn: [AF-035]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.3
  - conventions.md#1.4
createdAt: 2026-11-17T03:22:00.000Z
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
    - docs/worklog/pending/
    - docs/worklog/completed/
  modules: []
  interfaces: []
artifacts:
  - name: 持单原因透传记录
    path: docs/worklog/completed/phase2.5/af036-held-reason-passthrough-2026-11-17.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测全绿
    threshold: 'failed=0'
successCriteria:
  - held-for-human 动作的 reason 取运行态 releaseReason，缺省回落 held-for-human
  - 单测覆盖 GUI 投递降级持单与租约超时持单两种原因
evidenceFormat: 命令 + exit code + 用例数 + 动作输出
---

# AF-036 任务单（持单动作透传真实释放原因）

## 1. 背景

AF-035 演练时 `run-once` 打出 `held-for-human AF-035（lease-expired）`，而运行态真实原因是 `gui-delivery-failed`。事件流与动作流是最外层排障面，标签写错会把排障引向租约方向。

## 2. 目标

`claimReadyTasks` 的持单动作取 `entry.releaseReason`，缺省回落 `held-for-human`；单测锁住两种来源（`gui-delivery-failed`、`lease-expired`）。

## 3. 切片

`scripts/orchestration/scheduler.mjs`、单测、本单文档。不改状态机分支、不改配置。

## 4. 验收

单测全绿（169 passed），`events verify` PASS，动作输出与运行态一致。

## 5. 状态

✅ 已交付，见 `docs/worklog/completed/phase2.5/af036-held-reason-passthrough-2026-11-17.md`。
