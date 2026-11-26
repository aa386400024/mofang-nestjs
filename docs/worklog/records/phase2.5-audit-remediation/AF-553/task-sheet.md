---
taskId: AF-553
contextId: phase2.5-audit-remediation
title: 挂载 GraphQL 模块并隔离样例模块
type: implementation
status: backlog
baselineRef: c55458a992b335041afbc75709ff5c34de8fb86b
riskClass: R2
gateProfile: full
dependsOn: [AF-551]
priorTasks: [AF-547, AF-551, AF-552]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-26T20:50:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - src/app.module.ts
    - src/config/module-flags.ts
    - src/sample/controllers/crud.controller.ts
    - test/app/af553-module-wiring.spec.ts
    - docs/worklog/completed/phase2.5
    - docs/worklog/records/phase2.5-audit-remediation/AF-553
  modules: [app, gql, sample]
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af553-module-wiring-2026-11-26.md
    kind: report
gates:
  - command: pnpm exec vitest run test/app test/gql
    check: 模块接线与 GraphQL 深度限制单测全绿
    threshold: exit 0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit 0
  - command: pnpm lint
    check: 0 error 0 warning
    threshold: exit 0
  - command: pnpm test
    check: 全量测试全绿
    threshold: exit 0
successCriteria:
  - GqlModule 进入 AppModule，生产 graphiql/debug 保持关闭，深度限制继续生效
  - SampleModule 为模板 demo，生产环境永不挂载；仅非生产且 ENABLE_SAMPLE_API=true 时挂载
  - CrudController 即使被显式开启也必须有 JWT + admin 角色双门禁
  - 模块选择策略有单测覆盖生产硬拒绝、默认关闭、显式开启
  - src/engine-core 零改动
---

## 背景

AF-551 已交付 GraphQL 深度限制，但 `GqlModule` 仍未挂载到 `AppModule`，线上 `/graphql` 不可达。`SampleModule` 是脚手架 demo，含无鉴权 `CrudController` 与示例表实体，直接挂载会把增删改查暴露到公网，不符合生产安全基线。

## 实现要求

1. `AppModule` 直接挂载 `GqlModule`。
2. 新增模块选择策略：`SampleModule` 仅当 `NODE_ENV !== 'production'` 且 `ENABLE_SAMPLE_API === 'true'` 时挂载；生产环境即使误设 flag 也硬拒绝。
3. `CrudController` 补 `JwtAuthGuard + RolesGuard` 与 `@Roles('admin')`，作为显式开启后的第二道门禁。
4. 新增 `test/app/af553-module-wiring.spec.ts`：生产硬拒绝、默认关闭、非生产显式开启、`AppModule` imports 含 `GqlModule`、`CrudController` 元数据含 guard/role。
5. 更新 `AppModule` 顶部历史注释，说明 demo 模块不再无条件挂载。

## 非目标

- 不删除 `src/sample` 目录，保留脚手架可复用性。
- 不修改 GraphQL schema、resolver 业务语义与深度阈值。
- 不改 `src/engine-core`。
- 不新增第三方依赖。

## 验收

- `pnpm exec vitest run test/app test/gql` 全绿。
- `pnpm test` 全量全绿，`pnpm typecheck` / `pnpm lint` 0 error。
- `git diff --stat HEAD -- src/engine-core` 为空。
- 生产配置下 `/graphql` 可用且 GraphiQL 关闭；`/sample`、`/crud` 不进入路由表。
