---
taskId: AF-549
contextId: phase2.5-audit-remediation
title: executor 资源域补齐 pnpm-lock
type: fix
status: backlog
baselineRef: 2414d749835df16fe560038fd4b1868bcf598e14
dependsOn: [AF-547]
priorTasks: [AF-547]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1]
createdAt: 2026-11-26T19:30:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/team/agent-orchestration/agent-cards
    - docs/worklog/records
    - docs/worklog/completed
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af549-executor-lockfile-resource-2026-11-26.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs validate
    check: 编排状态面校验通过
    threshold: exit 0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit 0
  - command: pnpm lint
    check: 0 error 0 warning
    threshold: exit 0
successCriteria:
  - executor Agent Card 的 resources 声明 pnpm-lock.yaml，使依赖类任务可合法落入执行域
  - 不改变 executor 的 cannotDo / requiresApproval 边界
  - 不修改其他角色卡片或编排策略
---

## 背景

AF-548（GraphQL 查询深度限制）在 `run-once` 领单时被 `scope-domain-conflict` 拒绝：`pnpm-lock.yaml` 不在 `executor` 的角色资源域内。依赖安装必然修改 lockfile，若绕过会把依赖变更落在任务 scope 之外，属于治理缺口。

AF-548 已取消，拆为本前置任务 + 后续实现任务。本任务只修资源域声明，不改任何业务代码。

## 实现要求

- 在 `docs/team/agent-orchestration/agent-cards/executor.json` 的 `resources` 中新增 `pnpm-lock.yaml`。
- 保持 `limits.cannotDo` / `limits.requiresApproval` 原样：本次只是让「任务单已声明的新增依赖」有合法落点，不等于放宽依赖审批。
- 不修改 `orchestrator.json`、不修改 scheduler 校验逻辑、不新增角色。

## 非目标

- 不安装任何依赖、不改 `package.json` / `pnpm-lock.yaml`。
- 不实现 GraphQL 深度限制（由后续任务承担）。
- 不碰 `src/engine-core`。

## 验收

- `node scripts/orchestration/cli.mjs validate` 通过。
- `pnpm typecheck` / `pnpm lint` 全绿。
- 交付记录写清缺口、修复位置与后续任务编号。
