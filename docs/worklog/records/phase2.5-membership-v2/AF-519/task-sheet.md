---
taskId: AF-519
contextId: phase2.5-membership-v2
title: 会员栈迁移号冲突消解与受保护 PR 收口
type: fix
status: backlog
baselineRef: 7fb875ceac11812ae77c54f23c293f32d13cdbb6
dependsOn: []
priorTasks: [AF-518]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, conventions.md#1.3, conventions.md#2.5, autonomous-team-design.md#6.1]
createdAt: 2026-11-26T01:50:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/membership/
    - src/billing/
    - src/counselor/dto/billing.dto.ts
    - src/counselor/providers/billing.service.ts
    - src/profile/
    - src/app.module.ts
    - src/common/exceptions/
    - src/user/enums/audit-event.enum.ts
    - src/shared/infra/metrics/metrics.service.ts
    - src/migration/
    - bin/ormconfig.ts
    - test/membership/
    - docs/worklog/pending/
    - docs/worklog/completed/
    - docs/worklog/records/
  modules: [membership]
  interfaces: [MembershipController, MembershipAdminController, MembershipOrderService, MembershipAccountService]
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af519-membership-migration-pr-closure-implementation-2026-11-26.md
    kind: report
---

# AF-519 · 会员栈迁移号冲突消解与受保护 PR 收口

> 状态：待执行（2026-11-26）
> 执行方：自做
> 基线：最新 `integrate` `7fb875ce`
> 重签发：AF-518 因任务 scope 误含 orchestrator 专属资源域（`docs/specs/active/`、`docs/team/agent-orchestration/`）被调度器拒绝，按 `task rescope` 重签发为 AF-519；目标、基线、实现内容不变。

## 1. 目标

把会员 v2 三段能力重放到最新 `integrate`，消除迁移号冲突与状态面分叉，形成一条可被受保护 PR 合并的干净分支。

## 2. 范围

**在范围内：**

- 从 AF-517 HEAD 取会员业务最终态，落到最新 integrate 基线，不改会员业务语义。
- 会员三段迁移重排为 `1714900000054 / 55 / 56`，同步类名、`bin/ormconfig.ts`、`src/migration/index.ts`。
- 修正会员测试在 TypeScript 6 / 新版 Vitest 下的类型写法，不改变断言语义。
- 复制 AF-512/516/517 交付记录与记录包，保留原始证据。
- 登记、回执、归档与 PR 收口；关闭被 supersede 的 #249/#250。
- 回写 backlog，说明旧栈 PR 已被本任务整合 PR 取代。

**不在范围内：**

- 不改会员业务规则、价格、权益、活动预算算法。
- 不接真实支付、回调验签、自动续费、部分退款语义。
- 不改 `src/engine-core/**`、Flutter、`admin-dashboard/**`。
- 不改 `docs/specs/active/membership-system-v2.0.md`；spec 同步另开文档任务。
- 不重写旧 AF-512/516/517 已归档提交；旧分支保留为证据。

## 3. 交付物

1. 会员业务代码、测试、迁移与接线落在最新 integrate 基线上。
2. 迁移 `54/55/56` 唯一且已注册；本地 `mofang_dev` 台账同步，`migration:run` 可重复执行。
3. 会员定向 69 例、typecheck、lint、build、smoke 全绿。
4. AF-519 交付记录、机读回执、归档记录。
5. 一条新的受保护 PR；#249/#250 关闭并标注 supersede。

## 4. 验收标准

- `git grep` 不再出现会员迁移 `1714900000049/50/51` 的类名或路径。
- `bin/ormconfig.ts` 与 `src/migration/index.ts` 均只注册 `1714900000054/55/56` 会员迁移。
- `pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm test:smoke` 全绿。
- `pnpm vitest run test/membership` 13 文件 / 69 例全过。
- `git diff --stat HEAD -- src/engine-core` 为空。
- 新 PR 目标 `integrate`，最终 HEAD 为 AF-519 已归档状态。
