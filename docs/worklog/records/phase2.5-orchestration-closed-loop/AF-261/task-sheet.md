---
taskId: AF-261
contextId: phase2.5-orchestration-closed-loop
title: 单场成本按 provider 分账
type: implementation
status: backlog
baselineRef: 785a60f436d6f6781064e20726179c1c24124261
dependsOn: [AF-260]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-22T09:10:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-adapters/observability/
    - src/engine-adapters/wiring/
    - test/engine-adapters/
    - .env.example
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af261-provider-cost-breakdown-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/engine-adapters/af261-provider-cost.spec.ts test/engine-adapters/wp24-session-cost-log.spec.ts
    check: provider 分账与既有成本口径回归
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm exec tsc --noEmit -p tsconfig.json
    check: CI 全量 typecheck 0 error
    threshold: exit=0
---
# AF-261 · 单场成本按 provider 分账

## 背景

AF-250/258/259/260 已让豆包 usage 逐轮回传，但 `session_cost_summary` 仍把整场 token 按同一对单价折算。豆包与 MiniMax 单价不同，且一场可能在主候选失败后切到备候选，统一单价会系统性失真。

## 目标

1. `SessionUsageDelta` 增加 `provider`；累加时按 provider 维护 `byProvider` token 桶。
2. `SessionUsageTotals.byProvider` 保持可选，空起点形状不变，旧调用零回归。
3. 新增 `SessionCostPricingTable` 与 `resolveSessionCostPricingTable`：支持 `LLM_PRICE_*_PER_1K` 默认价与 `LLM_PRICE_*_PER_1K_DOUBAO` / `..._MINIMAX` 覆盖价；未配置 provider 价时回落默认价。
4. `estimateSessionCost` 在存在 `byProvider` 时逐桶计价后求和；`buildSessionCostSummary` 输出 `providerBreakdown`。
5. 引擎链路把 `render.providerHint` 带入累加；`EngineWiringModule` 注入定价表。
6. `.env.example` 增补两个 provider 覆盖键与说明。

## 非目标

- 不引入数据库定价表；单价仍走 env 配置。
- 不编造豆包官方单价；未配置覆盖价时如实回落默认价。
- 不改 `src/engine-core`。
- 不改成本看板聚合口径（看板继续复用 `estimateSessionCost`）。
- 不做按租户/按用户汇总。

## 验收

- 新单测覆盖：两家 provider 不同单价分别计价、混合会话求和、缺输入侧时沿用 `output_only`、未配置 provider 价回落默认。
- 既有 `wp24-session-cost-log.spec.ts` 全绿。
- `session_cost_summary` 带 `providerBreakdown`，且 `estimatedCostCny` 等于各桶之和。
- lint 0 error；CI 同口径 tsc 0 error；`git diff HEAD -- src/engine-core` 为空。
