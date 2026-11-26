---
taskId: AF-534
contextId: phase2.5-orchestration-closed-loop
title: Phase2.5 收尾：调试落盘等待、会员退款边界与后台活动页
type: implementation
status: backlog
baselineRef: 321e2e4cf4145a79d1e4e82b91225f619fd06b43
dependsOn: []
priorTasks: [AF-533]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.2, conventions.md#1.3]
createdAt: 2026-11-26T16:25:00+08:00
deadline: null
agentRole: executor
riskClass: R2
riskRationale: 跨 admin-debug、membership、admin-dashboard 与 spec 四个域；含退款终态语义与调试关闭持久化行为变更，需全量闸门。
gateProfile: full
objective: 一次性收口四项遗留：调试会话关闭等待落盘、会员部分退款 fail-closed、会员系统 spec 同步、管理后台会员活动页。
successCriteria:
  - 调试 closeSession 返回前 await markCompleted，失败只告警；controller 与适配器无悬浮 Promise；目标测试全绿。
  - 会员退款金额小于订单实付时 fail-closed 拒绝，订单与权益不变；全额退款不变；新增部分退款用例通过。
  - 会员系统 spec 补齐活动预占、过期关闭、部分退款边界、审计与指标口径。
  - 管理后台新增会员活动页，接入 promotions 列表/启停/统计，路由与菜单可进入。
  - pnpm lint、pnpm typecheck、pnpm test 全绿；admin-dashboard type-check 与 build-only 通过；engine-core 零 diff。
outOfScope:
  - 不实现按比例退款、审批流、真实支付网关退款。
  - 不改 Flutter、不改后端 promotions 接口、不改数据库结构。
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
  modules: [admin-debug, auto-practice, membership, admin-dashboard]
  interfaces: [DebugSessionService.closeSession, MembershipOrderService.refund, admin/membership/promotions]
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af534-phase25-final-tails-2026-11-26.md
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

# AF-534 Phase2.5 收尾四项

## 背景

调试落盘等待、会员退款边界、会员 spec 同步、后台活动页此前分别登记，串行编排下反复争用状态面与资源域。合并为一个任务一次性交付，代码范围不变；同时把 `docs/specs/` 明确纳入 executor 可写资源域。

## 范围

1. 调试：`closeSession` 返回前 await `store.markCompleted`，失败只告警；controller 与内核适配器调用点同步。
2. 会员：`refund()` 对部分退款 fail-closed；补充单测；同步会员系统 spec。
3. 后台：新增会员活动页，接入 promotions 列表、启停与统计；路由、菜单与 i18n 补齐。
4. 资源域：executor agent card 增加 `docs/specs/`，仅用于本任务及后续明确授权的 spec 同步。

## 验收

- 四块均有可复现测试或构建证据；全量闸门通过。
- 不把部分退款写成已支持；不伪造按比例权益。
