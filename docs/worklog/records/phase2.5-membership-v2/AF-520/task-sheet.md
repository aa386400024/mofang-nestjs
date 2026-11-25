---
taskId: AF-520
contextId: phase2.5-membership-v2
title: CounselorModule 接入 MembershipModule 修复 E2E 依赖解析
type: fix
status: backlog
baselineRef: 81cb57f25aa6b91d803b50f0814800dc9f56b99d
dependsOn: []
priorTasks: [AF-519]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, conventions.md#1.3, conventions.md#2.5, autonomous-team-design.md#6.1]
createdAt: 2026-11-26T02:02:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/counselor/counselor.module.ts
  modules: [counselor]
  interfaces: [BillingService]
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af520-counselor-membership-wiring-2026-11-26.md
    kind: report
---

# AF-520 · CounselorModule 接入 MembershipModule

> 状态：待执行（2026-11-26）
> 基线：AF-519 PR 分支 HEAD `81cb57f2`
> 触发：PR #251 E2E 失败，`Nest can't resolve dependencies of the BillingService (?, QuotaLedgerService)`，CounselorModule 缺少 MembershipAccountService。

## 1. 目标

在 `CounselorModule` 导入 `MembershipModule`，让 `BillingService` 能解析 `MembershipAccountService` 与 `QuotaLedgerService`，修复会员栈重放后漏掉的模块接线。

## 2. 范围

- `src/counselor/counselor.module.ts`：新增 `MembershipModule` import 与 `imports` 项。
- 不改 BillingService 业务逻辑，不新增会员规则。

## 3. 验收

- `pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm test:smoke` 全绿。
- `test/e2e/v2-user-flow.spec.ts` 可启动 Nest 测试模块，不再报 BillingService 依赖解析失败。
- `Task: AF-520` trailer 与 scope 通过 CI 编排门。
