---
taskId: AF-266
contextId: phase2.5-orchestration-closed-loop
title: 豆包角色模型按模型单价计费
type: implementation
status: backlog
baselineRef: db6783491a0141902d7f486df101db59bc91a78b
dependsOn: [AF-265]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-22T10:05:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-adapters/observability/
    - src/engine-adapters/wiring/
    - test/engine-adapters/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af266-model-cost-pricing-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/engine-adapters/af266-model-cost-pricing.spec.ts test/engine-adapters/af261-provider-cost.spec.ts test/engine-adapters/wp24-session-cost-log.spec.ts
    check: 模型价、provider 价、回落价三种口径与分桶守恒
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm exec tsc --noEmit -p tsconfig.json
    check: CI 全量 typecheck 0 error
    threshold: exit=0
---
# AF-266 · 豆包角色模型按模型单价计费

## 背景

AF-261 只做到 provider 维度分账，仓库没有内置任何厂商报价，豆包会话一直按 MiniMax 全局价估算。火山方舟模型详情页公开了 `doubao-seed-character-260628` 的在线推理价：输入 0.8 元/百万 tokens、输出 2 元/百万 tokens（输入 ≤32k 档，2026-11-22 查）。按 MiniMax 全局价 1.5/4.5 估算，豆包角色模型成本被高估约 1.9–2.3 倍。

provider 级覆盖价不能直接填 0.0008/0.002：同一豆包账号还跑 `doubao-seed-2-1-pro`（6/30 元每百万），一刀切会把 pro 调用严重低估。必须补**模型维度**。

## 目标

1. `SessionCostPricingTable` 增加 `byModel`，键为 `provider/model`。
2. 内置已核对的官方模型价常量 `OFFICIAL_MODEL_PRICING`，先只收录 `doubao/doubao-seed-character-260628`。
3. 计价优先级：模型价 → provider 覆盖价 → 全局回落价；`pricingSource` 增加 `model`。
4. `estimateSessionCost` 与 `buildProviderBreakdown` 走同一个解析函数，避免总价与明细两套口径。
5. env 支持 `LLM_PRICE_INPUT_PER_1K_MODEL_DOUBAO_SEED_CHARACTER_260628` 一类模型覆盖键（可选）。
6. 新增 5 例单测覆盖模型价命中、未知模型回落、跨 provider 分桶、env 覆盖、明细来源标记。

## 非目标

- 不收录未核对报价（MiniMax M3 仍走全局回落）。
- 不改管理后台成本看板 UI。
- 不改 usage 采集链路。

## 验收

- 角色模型桶用 0.0008/0.002，`pricingSource=model`。
- 同场 MiniMax 桶仍用回落价，总价等于各桶之和。
- 未知豆包模型回落 provider 覆盖价（未配则回落全局）。
- 定向 5 + AF-261 6 + WP24 18 全绿；lint/tsc 0 error；engine-core 零改动。
