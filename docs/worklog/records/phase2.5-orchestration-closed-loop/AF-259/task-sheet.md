---
taskId: AF-259
contextId: phase2.5-orchestration-closed-loop
title: 引擎渲染生产 RouterChatCaller 豆包 smoke
type: implementation
status: backlog
baselineRef: b13f4e1b63d2b4bac572780bbafc2c76332e996a
dependsOn: [AF-258]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-22T08:40:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - bin/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af259-render-router-doubao-smoke-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec tsx bin/visitor-render-smoke.ts --caller router --provider doubao --max-tokens 160 --timeout-ms 45000
    check: 生产 RouterChatCaller 路径真实豆包出话
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm exec tsc --noEmit -p tsconfig.json
    check: CI 全量 typecheck 0 error
    threshold: exit=0
---
# AF-259 · 引擎渲染生产 RouterChatCaller 豆包 smoke

## 背景

AF-258 用 `LlmServiceChatCaller` 直连 `LlmService` 证明了渲染适配器与豆包 provider 能端到端出话，但没有覆盖生产装配的 `RouterChatCaller → LlmRouterService → ProviderRegistry → DoubaoChatProvider` 路由链。AF-258 的 backlog 已登记 `visitor-render-router-smoke`。

本任务给 smoke CLI 增加 `--caller router`：用真实 `ProviderRegistryService` 注册 `DoubaoChatProvider`，构造 `LlmRouterService` 与 `RouterChatCaller`，再走 `RenderConfigFactory → buildEngineRenderPort → LlmRenderAdapter → RouterChatCaller → LlmRouterService → 豆包`。不启动完整 Nest 容器、不写库。

## 目标

1. `bin/visitor-render-smoke.ts` 支持 `--caller router|llm-service`，默认 `router`。
2. router 路径构造真实注册表、真实 Router、真实 `RouterChatCaller`，并强制 `LLM_DEFAULT_CHAT_PROVIDER=doubao`。
3. 真实跑一次 router 路径 smoke，输出 `callerPath`、候选、模型、TTFT、usage、finishReason、降级标记与预览。
4. 保留 `llm-service` 路径作为对照。

## 非目标

- 不改 `src/engine-core`。
- 不改生产 `.env`。
- 不启动 Nest、不写库、不注册 minimax 备用 provider（回退由 router 默认 provider 兜底）。
- 不做并发、429/5xx、长对话压测与成本分 provider 分账。

## 验收

- router 路径真实 smoke：`providerHint=doubao`、文本非空、usage 非全 0、无回退无降级。
- lint 0 error；CI 同口径 tsc 0 error。
- `git diff HEAD -- src/engine-core` 为空。
