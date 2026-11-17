---
taskId: AF-032
contextId: phase2.5-orchestration-closed-loop
title: IM-028 派发决策链运行时接线与降级回收收口
type: implementation
status: backlog
baselineRef: 306870288568ef12bf0c2218cd3f748d5c651bd6
dependsOn: [AF-023]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.3
  - conventions.md#1.4
createdAt: 2026-11-17T03:09:00.000Z
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
    - docs/team/agent-orchestration/
    - docs/worklog/pending/
    - docs/worklog/completed/
  modules: []
  interfaces: []
artifacts:
  - name: 决策链接线与降级回收记录
    path: docs/worklog/completed/phase2.5/af032-dispatch-decision-wiring-2026-11-17.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测全绿
    threshold: 'failed=0'
  - command: ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate
    check: 适配层框架 schema 校验全 PASS
    threshold: 'fail=0'
successCriteria:
  - 通道选路由 resolveChannelSelection 决策产出，调度层不再散落 if，决策随领单落运行态与事件
  - releaseFailedDeliveries 按运行时决策链分流：不可恢复 → failed；预算耗尽 / 可恢复 → ready + heldForHuman
  - 无现场事实时不得假定不可恢复
  - 单测覆盖选路矩阵与回收分流，validate 0 FAIL
evidenceFormat: 命令 + exit code + 用例数；决策与回收行为用单测名与断言指认
---

# AF-032 任务单（IM-028 决策链接线）

## 1. 背景

AF-024 交付了 GUI 通道与投递协议，但留了两条欠账：

- `IM-028`：`dispatch-channel.mjs#resolveDispatchDecision`（进程 / 登录门 / 会话层 / 重试预算的决策链）只存在于规则层与单测，运行时回收环节对 `delivery.state` 几乎零读取——已降级的任务会被当成「在正常执行」，回收时一律 `heldForHuman`，既不看不可恢复类别，也不看预算。
- `AF-024-R2`：降级回收路径只有单测，没有真实跑过 failed → 持单 → `task resume` → 重派。

本单修 `IM-028`；`AF-024-R2` 由 AF-033 的实弹演练承接（executor 角色，才能走 GUI 通道）。

## 2. 目标

1. 领单选路收成可审计决策 `resolveChannelSelection()`（角色 → 上轮投递事实 → 配置通道 → 枚举收敛），决策落 `entry.dispatchDecision` 并进事件日志。
2. `releaseFailedDeliveries` 把 relay 上报的现场事实（`channel fallback` 写入 `delivery.lastAttempt`）喂给 `resolveDispatchDecision`，按动作分流：`fail-terminal` → 任务 `failed`；`human-escalate` → `ready` + `heldForHuman`（`gui-delivery-budget-exhausted`）；其余 → `ready` + `heldForHuman`（`gui-delivery-failed`）。
3. 缺现场事实时不得假定不可恢复，保持既有持单口径。

## 3. 切片（scope）

`scripts/orchestration/`（dispatch / scheduler / gui-dispatch / cli 与单测）、`docs/team/agent-orchestration/`（README §5.1）、`docs/worklog/` 本单文档。

## 4. 验收

- 单测覆盖：选路 5 种原因、failed→降级通道、关闭兜底→重试 relay、枚举收敛、回收分流（终态 / 预算 / 缺省）。
- `validate` 0 FAIL、事件链一致、任务归档 `completed`。

## 5. 状态

✅ 已交付，见 `docs/worklog/completed/phase2.5/af032-dispatch-decision-wiring-2026-11-17.md`。
