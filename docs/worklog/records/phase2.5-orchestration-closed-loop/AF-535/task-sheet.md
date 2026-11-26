---
taskId: AF-535
contextId: phase2.5-orchestration-closed-loop
title: AF-534 验收补正：AF-533 取消记录、重走回执与 PR 收口
type: implementation
status: backlog
baselineRef: ed6a2f43a8e8a65916d55505578d550f1f943131
dependsOn: []
priorTasks: [AF-534, AF-533]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.2, conventions.md#1.3]
createdAt: 2026-11-26T16:35:00+08:00
deadline: null
agentRole: executor
riskClass: R2
riskRationale: 承接 AF-534 的四域交付与验收补正；不改代码语义，只补 AF-533 归档记录并重走回执/验收/PR。
gateProfile: full
objective: 修复 AF-534 验收被 AF-533 缺失交付记录阻断的问题，补齐取消说明、重签回执并完成 PR 收口。
successCriteria:
  - AF-533 计划工件路径存在且如实说明取消/重签发，worklog verify strict 通过。
  - AF-534 四块交付（调试落盘、部分退款、spec、后台活动页）事实保留且闸门证据可复现。
  - 新任务回执六组齐全，run-once 完成并归档。
  - PR 通过 13 项 required checks 后 squash 合并进 integrate。
outOfScope:
  - 不改业务代码语义、不改数据库结构、不实现按比例退款。
scope:
  files:
    - src/admin-debug/debug-session.service.ts
    - src/admin-debug/debug-session.controller.ts
    - src/auto-practice/adapters/debug-turn-engine.adapter.ts
    - test/admin-debug/debug-session-persistence.spec.ts
    - test/admin-debug/wp58-debug-session.spec.ts
    - test/admin-debug/wp69-debug-panel-improvements.spec.ts
    - src/membership/providers/membership-order.service.ts
    - test/membership/membership-order.service.spec.ts
    - docs/specs/active/membership-system-v2.0.md
    - docs/team/agent-orchestration/agent-cards/executor.json
    - admin-dashboard/src/api/
    - admin-dashboard/src/views/MembershipPromotions.vue
    - admin-dashboard/src/router/index.ts
    - admin-dashboard/src/App.vue
    - admin-dashboard/src/i18n/locales/
    - docs/worklog/completed/
    - docs/worklog/records/
  modules: [admin-debug, auto-practice, membership, admin-dashboard]
  interfaces: [DebugSessionService.closeSession, MembershipOrderService.refund, admin/membership/promotions]
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af535-acceptance-remediation-2026-11-26.md
    kind: report
gates:
  - command: pnpm lint
    check: lint 0 error
    threshold: exit=0
  - command: pnpm typecheck
    check: typecheck 0 error
    threshold: exit=0
  - command: pnpm test
    check: 全量单测全绿
    threshold: exit=0
  - command: pnpm --dir admin-dashboard type-check
    check: vue-tsc 0 error
    threshold: exit=0
  - command: pnpm --dir admin-dashboard build-only
    check: vite build 成功
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: 内核零改动
    threshold: 输出为空
---

# AF-535 AF-534 验收补正

## 背景

AF-534 在 `run-once` 摄入回执后进入验收，但 `worklog verify --strict` 因 AF-533（重签发前被 cancel 并归档）的计划工件 `docs/worklog/completed/phase2.5/af533-phase25-final-tails-2026-11-26.md` 不存在而失败，导致任务被 rejected 归档。代码与闸门证据完整，缺的是取消任务的归档说明。

## 范围

1. 补 AF-533 取消说明，指向 AF-534 实际交付，消除 worklog 缺失工件。
2. 以 AF-535 承接 AF-534 的提交与证据，重签回执、重走验收。
3. 创建并合并 PR，保留 AF-534/AF-535 任务链。
