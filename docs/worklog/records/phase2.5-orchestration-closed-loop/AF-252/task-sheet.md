---
taskId: AF-252
contextId: phase2.5-orchestration-closed-loop
title: 单一 VISITOR_LLM_PROVIDER 开关同时切换 VisitorService 与引擎渲染主候选
type: implementation
status: backlog
baselineRef: 84c5f8d3bff82ca0cfe5ee52c33e9c9537873f31
dependsOn: [AF-248, AF-251]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-22T07:42:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-adapters/wiring/
    - test/engine-adapters/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af252-visitor-render-provider-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/engine-adapters/af252-visitor-render-provider.spec.ts test/engine-adapters/af210-render-model-override.spec.ts
    check: VISITOR_LLM_PROVIDER=doubao 时主候选切豆包并保留 minimax 回退；未开启时旧候选序列逐字不变
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm exec tsc --noEmit -p tsconfig.json
    check: CI 全量 typecheck 0 error
    threshold: exit=0
---
# AF-252 · visitor 渲染路由双路径切换

## 背景

AF-248 只把 `VisitorService`（旧语音链路）切到豆包；生产对练/模拟器的引擎渲染路径仍由 `RenderConfigFactory` 决定候选，当前 `ENGINE_RENDER_PRIMARY_PROVIDER=minimax`。结果是同一个 `VISITOR_LLM_PROVIDER` 开关覆盖不到引擎渲染，来访者模拟器主候选仍停在 MiniMax。

## 目标

1. `RenderConfigFactory.buildCandidates()` 读取 `VISITOR_LLM_PROVIDER`：
   - 未配置或 `minimax`：候选序列与现在逐字一致（`ENGINE_RENDER_PRIMARY_PROVIDER` + `ENGINE_RENDER_FALLBACK_PROVIDERS`）；
   - `doubao`：主候选强制为 `doubao`，即使 `ENGINE_RENDER_PRIMARY_PROVIDER=minimax` 也让位；
   - 未显式配置 `ENGINE_RENDER_FALLBACK_PROVIDERS` 时，自动补 `minimax` 作为回退，避免单候选熔断全损；
   - 非法值启动期抛错，不静默回落。
2. 豆包候选模型解析顺序：`ENGINE_RENDER_<KIND>_MODEL_DOUBAO` > `VISITOR_DOUBAO_MODEL` > `doubao-seed-character-260628`；`ENGINE_RENDER_<KIND>_MODEL` 全局键仍保持既有最高优先级。
3. 新增装配期单测 `test/engine-adapters/af252-visitor-render-provider.spec.ts`，覆盖：
   - 未开启时旧序列不变；
   - 开启后主候选 doubao、回退 minimax；
   - 模型默认 seed-character、`VISITOR_DOUBAO_MODEL` 覆盖、provider 键优先级；
   - 已有 fallback 列表保留并去重；
   - 非法值抛错。
4. 不改 `.env` 实际值；只改代码读取逻辑与 `.env.example` 注释说明（如需）。

## 非目标

- 不改 `src/engine-core`。
- 不改 MiniMax 默认行为与旧语音链路。
- 不改评分模型、评分协议或影子实验 CLI。
- 不把 `VISITOR_LLM_PROVIDER=doubao` 设为默认（默认仍是 minimax + shared）。

## 验收

- `VISITOR_LLM_PROVIDER` 未配置时，`test/engine-adapters/af210-render-model-override.spec.ts` 5 例全过。
- `VISITOR_LLM_PROVIDER=doubao` + `ENGINE_RENDER_PRIMARY_PROVIDER=minimax` 时，候选序列为 `['doubao','minimax']`，豆包 chat/stable/advanced 模型均解析为 `doubao-seed-character-260628`。
- `VISITOR_DOUBAO_MODEL=custom-model` 时覆盖默认；`ENGINE_RENDER_CHAT_MODEL_DOUBAO` 仍优先。
- 非法值（如 `openai`）启动期抛 `Error`。
- lint、CI 同口径 tsc、全量测试全绿；`git diff HEAD -- src/engine-core` 为空。
