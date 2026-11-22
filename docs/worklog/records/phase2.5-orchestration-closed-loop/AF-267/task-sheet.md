---
taskId: AF-267
contextId: phase2.5-orchestration-closed-loop
title: 模型级成本覆盖键装配与模板声明
type: implementation
status: backlog
baselineRef: b0f6d59702703cb161aa2dbe741632282de42b78
dependsOn: [AF-266]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-22T10:20:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-adapters/wiring/
    - .env.example
    - test/config/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af267-model-price-env-wiring-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/config/wp25-env-example-coverage.spec.ts test/engine-adapters/af266-model-cost-pricing.spec.ts
    check: .env.example 覆盖与模型价解析
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm exec tsc --noEmit -p tsconfig.json
    check: CI 全量 typecheck 0 error
    threshold: exit=0
---
# AF-267 · 模型级成本覆盖键装配与模板声明

## 背景

AF-266 已内置火山方舟官方模型价并让 `resolveSessionCostPricingTable` 支持 `models` 入参，但 `engine.module.ts` 还没读 `LLM_PRICE_INPUT_PER_1K_MODEL_DOUBAO_SEED_CHARACTER_260628` / `LLM_PRICE_OUTPUT_PER_1K_MODEL_DOUBAO_SEED_CHARACTER_260628`，`.env.example` 也没有对应声明行。部署方目前只能吃内置价，无法按当期账单纠偏。

AF-266 scope 不含 `.env.example`，装配后 WP25 的 env 覆盖测试会失败，因此本任务独立补装配与模板声明。

## 目标

1. `engine.module.ts` 定价表装配新增 `models`，键 `doubao/doubao-seed-character-260628`，读上述两个 env 键。
2. `.env.example` 在 AF-261 provider 覆盖价区块后补模型覆盖价区块，声明两个键，并说明优先级与留空语义。
3. 确认 `test/config/wp25-env-example-coverage.spec.ts` 通过；AF-266 的 5 例仍全绿。
4. 不改变 AF-266 已内置官方价与三档优先级。

## 非目标

- 不收录未核对报价（MiniMax M3 仍走全局回落）。
- 不改管理后台看板与 usage 采集链路。
- 不改 `.env` 真实值。

## 验收

- `engine.module.ts` 装配 `models`，env 键可覆盖内置官方价。
- `.env.example` 出现两个模型价键，WP25 覆盖测试 exit 0。
- 定向 WP25 + AF-266 全绿；lint/tsc 0 error；engine-core 零改动。
