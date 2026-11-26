---
taskId: AF-550
contextId: phase2.5-audit-remediation
title: GraphQL 查询深度限制与资源域返修
type: fix
status: backlog
baselineRef: 31c26d0aa6c81a4729d62307ba6204a5864a183b
riskClass: R2
gateProfile: full
dependsOn: [AF-547]
priorTasks: [AF-547, AF-549]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1]
createdAt: 2026-11-26T19:45:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - docs/team/agent-orchestration/agent-cards
    - src/gql
    - test/gql
    - package.json
    - pnpm-lock.yaml
    - docs/worklog/records
    - docs/worklog/completed
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af550-graphql-depth-limit-2026-11-26.md
    kind: report
gates:
  - command: pnpm exec vitest run test/gql
    check: 深度限制单测全绿
    threshold: exit 0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit 0
  - command: pnpm lint
    check: 0 error 0 warning
    threshold: exit 0
  - command: pnpm test
    check: 全绿
    threshold: exit 0
successCriteria:
  - GraphQL 请求在进入 resolver 前按字段嵌套深度被拒绝，深度阈值明确且可测试
  - 深度限制规则通过 Apollo 驱动配置接入 GqlModule，而不是只写在文档里
  - 覆盖片段、内联片段、别名等常见绕法，防止通过包装结构绕过阈值
  - executor 资源域允许 pnpm-lock.yaml，依赖变更不再越域
  - 不触碰 src/engine-core，不改变现有 HTTP / 鉴权行为
---

## 背景

AF-547 审计收口时，GraphQL 深度限制因任务单「不新增第三方依赖」未实现，登记为 BL-AF547-02。用户已批准新增依赖。

AF-549 先补了 executor 资源域（允许 `pnpm-lock.yaml`），但因改动全在 `docs/` 下被风险门判为 R0，Unit 分片 job 整体跳过、矩阵名未展开，required checks 永远缺失，PR #268 无法合并。AF-549 已归档，PR 已关闭并被本任务 supersede；本任务从 AF-549 分支 HEAD 堆叠，保留其提交，并显式声明 `gateProfile: full` 强制完整门禁。

## 实现要求

- 保留 AF-549 的 `executor.json` 资源域修复。
- 使用 `graphql-depth-limit` 作为验证规则；配套 `@types/graphql-depth-limit` 仅开发依赖。
- 深度阈值集中为一个常量，默认 10 层；不读取环境变量制造部署漂移。
- 在 `GraphQLModule.forRootAsync` 的 Apollo 配置里合并 `validationRules`，保留 ConfigService 已有配置。
- 规则在解析/校验阶段拒绝超深查询，错误信息可定位，不能等到执行 resolver 才失败。
- 覆盖普通嵌套、命名片段、内联片段、别名四种形态；同时验证阈值内查询可正常通过。
- 不实现复杂度/成本限制，不引入第二套 GraphQL 服务，不改变现有 schema 与 resolver 行为。

## 非目标

- 不碰 `src/engine-core`。
- 不把 `GqlModule` / `SampleModule` 挂回 `AppModule`（会改变对外路由面，需单独产品决策）。
- 不做 GraphQL 查询成本/复杂度评分、分页强制、持久化查询。
- 不改动认证、角色或现有 resolver 的业务逻辑。

## 验收

- `pnpm exec vitest run test/gql` 全绿，覆盖四种绕法与阈值内放行。
- `pnpm typecheck` / `pnpm lint` / `pnpm test` 全绿。
- `git diff --stat HEAD -- src/engine-core` 为空。
- 交付记录写清依赖版本、阈值、接入点、AF-549 堆叠关系与测试证据。
