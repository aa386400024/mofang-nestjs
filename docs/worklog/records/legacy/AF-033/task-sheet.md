---
taskId: AF-033
contextId: phase2.5-orchestration-closed-loop
title: GUI 投递降级回收实弹演练（AF-024-R2）
type: verification
status: backlog
baselineRef: 306870288568ef12bf0c2218cd3f748d5c651bd6
dependsOn: [AF-032]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.3
  - conventions.md#1.4
createdAt: 2026-11-17T03:16:00.000Z
deadline: null
agentRole: executor
scope:
  files:
    - docs/worklog/pending/
    - docs/worklog/completed/
  modules: []
  interfaces: []
artifacts:
  - name: 降级回收演练记录
    path: docs/worklog/completed/phase2.5/af033-gui-delivery-failure-drill-2026-11-17.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs channel state --taskId AF-033
    check: 降级后通道与投递状态可读
    threshold: 'channel=gui-file-fallback 且 delivery.state=failed'
  - command: node scripts/orchestration/cli.mjs events verify
    check: 演练全程事件链一致
    threshold: 'PASS'
successCriteria:
  - GUI 投递 pending 状态下 mirror 失败并降级，现场事实落 delivery.lastAttempt
  - run-once 回收后任务回 ready + heldForHuman，releaseReason=gui-delivery-failed
  - task resume 解除持单，重派走文件降级通道（delivery-fallback-after-failure），任务最终归档
evidenceFormat: 六步命令原文 + 每步关键输出 + 运行态字段摘录
---

# AF-033 任务单（GUI 投递降级回收实弹演练）

## 1. 背景

AF-024 交付的 GUI 通道 + AF-032 接线的决策链，降级回收路径此前只有单测（AF-024-R2 欠账）。本单用 executor 角色真实走一遍：领单生成投递件 → 模拟桌面 relay 失败并降级 → 回收持单 → `task resume` → 重派走降级通道 → 交付演练记录归档。

选 executor 角色是被测对象决定的：只有执行代理角色才走 `gui-relay`，编排者角色固定文件通道。

## 2. 演练步骤（六步，全程真实 CLI）

1. `task register` + `task promote`：登记并提级；
2. `run-once`：领单 + `dispatch-decision=configured-channel` + 投递件落 `transport/briefs/AF-033.brief.md`，`delivery.state=pending`；
3. `channel fallback --cause flaky`：模拟桌面 relay 失败，通道降级 `gui-file-fallback`，现场事实落 `delivery.lastAttempt`；
4. `run-once`：回收 → `ready` + `heldForHuman`，`releaseReason=gui-delivery-failed`；
5. `task resume`：解除持单；
6. `run-once`：重派，`dispatch-decision=delivery-fallback-after-failure`，走文件降级通道；随后写演练记录 + 回执，`run-once` 归档。

## 3. 切片（scope）

只写 `docs/worklog/` 下的本单任务单、演练记录与归档件，不改代码、不改运行态配置。

## 4. 验收

事件链 `verify` PASS；回收与重派的 `dispatch-decision` 原因可在事件日志指认；任务归档 `completed`。

## 5. 状态

✅ 演练完成，见 `docs/worklog/completed/phase2.5/af033-gui-delivery-failure-drill-2026-11-17.md`。
