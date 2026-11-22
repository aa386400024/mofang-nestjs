---
taskId: AF-248
contextId: phase2.5-orchestration-closed-loop
title: 生产 visitor 豆包 Seed Character 路由与 V5 prompt 开关（默认关闭）
type: implementation
status: backlog
baselineRef: 7bfe4c98c5207e1242c20c6ad3abf1f9ac88d235
dependsOn: [AF-243, AF-247]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-22T06:55:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - .env.example
    - src/agent/visitor/
    - src/agent/llm/
    - test/agent/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af248-visitor-provider-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/agent/visitor-runtime-config.spec.ts test/agent/visitor-prompt-v5.spec.ts test/agent/llm-endpoint.spec.ts
    check: 定向单测全绿
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm exec tsc --noEmit -p tsconfig.json
    check: CI 全量 typecheck 0 error
    threshold: exit=0
  - command: pnpm test
    check: 全量单测全绿
    threshold: exit=0
---

# AF-248 · 生产 visitor 豆包 Seed Character 路由与 V5 prompt 开关

## 背景

V5 已是当前最强候选：AF-243 三轮 36 场 0 失败，H 均值 `4.055556`，比 V2 高 `0.166667`；AF-245 逐 persona 审计三轮合并 7 改善 / 5 持平 / 0 回落，增益主要来自关系在场。AF-244 已排除 V5.1 的标签硬枚举。

现在生产 `VisitorService` 仍固定走 `LlmService` + `MINIMAX_LLM_MODEL` + `renderSystemPrompt` 的 shared prompt，没有任何开关能让 V5 走灰度。AF-246/247 已补齐影子审计工具的 CI 类型错误。

## 目标

1. 新增生产 visitor 运行时配置解析：`VISITOR_LLM_PROVIDER`（`minimax` / `doubao`，默认 `minimax`）、`VISITOR_PROMPT_VARIANT`（`shared` / `seed-v5`，默认 `shared`）、`VISITOR_DOUBAO_MODEL`（默认 `doubao-seed-character-260628`）。
2. `LlmService` 支持 per-call `provider: 'minimax' | 'doubao'`：豆包走 `LLM_DOUBAO_BASE_URL` + `LLM_DOUBAO_API_KEY` + `/chat/completions`；MiniMax 保持 `/v1/chat/completions`。
3. `renderSystemPrompt` 增加可选 `seed-v5` 变体：零抽象标签、接触防御、具体情绪；默认 `shared` 输出逐字不变。
4. 默认关闭：不配 env 时生产行为与 AF-247 完全一致；切换只靠 env，回滚只改 env。
5. `.env.example` 记录三个开关与回滚口径。

## 非目标

- 不改 `src/engine-core`。
- 不做未知 emotion 投影（另开任务）。
- 不做真人双标，不重跑影子实验。
- 不改 `MINIMAX_LLM_MODEL` / `MINIMAX_BASE_URL` 全局值。

## 验收

- 默认配置解析为 `minimax + shared`，渲染输出与旧版逐字一致。
- `seed-v5` 渲染包含三条核心约束，且不含 V4/V1/V2 影子实验术语。
- 豆包端点拼接为 `.../api/v3/chat/completions`，MiniMax 仍为 `.../v1/chat/completions`。
- 定向单测、lint、CI 同口径 tsc、全量测试全绿。
