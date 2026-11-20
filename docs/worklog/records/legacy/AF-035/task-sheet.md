---
taskId: AF-035
contextId: phase2.5-orchestration-closed-loop
title: GUI 投递降级回收实弹演练（AF-024-R2）
type: verification
status: backlog
baselineRef: 306870288568ef12bf0c2218cd3f748d5c651bd6
dependsOn: [AF-034]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.3
  - conventions.md#1.4
createdAt: 2026-11-17T03:20:00.000Z
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
    path: docs/worklog/completed/phase2.5/af035-gui-delivery-failure-drill-2026-11-17.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs channel state --taskId AF-035
    check: 降级后通道与投递状态可读
    threshold: 'channel=gui-file-fallback 且 delivery.state=failed'
  - command: node scripts/orchestration/cli.mjs events verify
    check: 演练全程事件链一致
    threshold: 'PASS'
successCriteria:
  - 领单走 gui-relay 并生成投递件，delivery.state=pending
  - 降级后 delivery.lastAttempt 落现场事实，通道改 gui-file-fallback
  - run-once 回收为 ready + heldForHuman，releaseReason=gui-delivery-failed
  - task resume 解除持单，重派决策为 delivery-fallback-after-failure 并走降级通道
  - 演练记录归档，任务终态 completed
evidenceFormat: 六步命令原文 + 每步关键输出 + 运行态字段摘录
---

# AF-035 任务单（GUI 投递降级回收实弹演练）

## 1. 背景

AF-024 的降级回收路径（AF-024-R2）此前只有单测。AF-033 首次演练被配置丢段缺陷阻塞并取消；AF-034 修好配置归一后，本单重做演练。

用 executor 角色是被测对象决定的：只有执行代理角色的任务才走 `gui-relay`，编排者角色固定文件通道。

## 2. 演练步骤（真实 CLI，不写替身）

1. `task register` + `task promote`；
2. `run-once` → `claim` + `dispatch-decision=configured-channel` + 投递件 `transport/briefs/AF-035.brief.md` + `delivery.state=pending`；
3. `channel fallback --cause flaky --attempt-count 2`：模拟桌面 relay 会话失焦，通道降级 `gui-file-fallback`，现场事实落 `delivery.lastAttempt`；
4. `run-once` → 回收 `ready` + `heldForHuman`，`releaseReason=gui-delivery-failed`；
5. `task resume` → `heldForHuman=false`；
6. `run-once` → 重派决策 `delivery-fallback-after-failure`，走文件降级通道；写演练记录 + 回执后 `run-once` 归档。

## 3. 切片（scope）

只写 `docs/worklog/` 本单文档；不改代码、不改配置。

## 4. 验收

六步输出全部留证；`verify` PASS；任务归档 `completed`。

## 5. 状态

✅ 演练完成，见 `docs/worklog/completed/phase2.5/af035-gui-delivery-failure-drill-2026-11-17.md`。
