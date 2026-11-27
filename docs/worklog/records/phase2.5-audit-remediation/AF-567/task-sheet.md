---
taskId: AF-567
contextId: phase2.5-audit-remediation
title: dev 接口三问题：fragment limit DTO / quote 背景图假域名 / 构建与 DI 核对
type: fix
status: backlog
baselineRef: eddf560414fd82e1c630a2d51c5ad2b0d1fbae46
riskClass: R2
gateProfile: full
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-27T09:40:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/inner_world/dto/
    - src/counselor/dto/
    - src/counselor/config/
    - bin/seed-quotes.ts
    - test/inner_world/
    - test/counselor/
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-audit-remediation/AF-567/
  modules: [inner-world, counselor]
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af567-dev-api-fixes-2026-11-27.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 0 error
    threshold: exit 0
  - command: pnpm lint
    check: 0 error
    threshold: exit 0
  - command: pnpm exec vitest run test/inner_world test/counselor/td21-counselor-quote-port-c2-batch5.spec.ts
    check: 定向测试全绿
    threshold: exit 0
successCriteria:
  - GET /inner-world/fragments/logs?limit=30 通过 DTO 校验；limit=0/abc 400；省略 limit 200
  - 扫描 src/inner_world/dto 与 src/counselor/dto 所有数值 query 字段，缺 @Type 的同形问题一起修复
  - 金句 backgroundUrl 不再默认指向 cdn.xinsu.app；无 CDN 配置时 seed 写空串，前端走本地 asset
  - 核对 watch 增量编译与 quotes/badges DI，给出证据结论
  - engine-core 零 diff
---

# AF-567 · dev 接口三问题

## 背景

dev 环境 4 条接口问题，前端已排除：

1. P0：`GET /inner-world/fragments/logs?limit=30` 稳定 400。query 的 "30" 未被转成 number，`@IsInt` / `@Min` 双失败。全局 ValidationPipe 未开 `enableImplicitConversion`，最小修法是给字段补 `@Type(() => Number)`。
2. P1：`GET /counselor/quotes/today` 的 `backgroundUrl` 指向 `https://cdn.xinsu.app/quote/...`，该域名 NXDOMAIN，图片必 404。默认值不应指向未拥有的域名。
3. P2：`/inner-world/badges`、`/counselor/practice/progress` 曾 500，现已不可复现；核对 watch 编译与 DI exports，排除旧实例/旧代码。

## 范围

- `src/inner_world/dto/`、`src/counselor/dto/`：数值 query 字段补 `@Type(() => Number)`，扫同形问题。
- `src/counselor/config/quote-seeds.ts`、`bin/seed-quotes.ts`：无 CDN 配置时不再拼假域名，seed 写空串。
- `test/inner_world/`、`test/counselor/`：补 DTO 转换与 quote base 回归。
- 执行 `pnpm seed:quotes` 刷新 16 行 `background_url`（数据面变更）。

## 不在范围

- 不开全局 `transformOptions.enableImplicitConversion`。
- 不新接对象存储/CDN，不改生产部署。
- 不改 500 两条接口的业务实现，除非核对发现真实 DI 缺失。
