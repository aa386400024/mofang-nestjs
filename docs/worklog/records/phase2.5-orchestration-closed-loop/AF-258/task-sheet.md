---
taskId: AF-258
contextId: phase2.5-orchestration-closed-loop
title: 从最新 integrate 重新交付引擎渲染豆包 smoke
type: implementation
status: backlog
baselineRef: 7435b12fd50f30ae37a08ded543a401aba1e76dd
dependsOn: [AF-257]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-22T08:35:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-adapters/wiring/
    - test/engine-adapters/
    - bin/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af258-render-doubao-smoke-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/engine-adapters/af258-llm-service-chat-caller.spec.ts
    check: LlmService ChatCaller 映射与错误语义全绿
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm exec tsc --noEmit -p tsconfig.json
    check: CI 全量 typecheck 0 error
    threshold: exit=0
---
# AF-258 · 从最新 integrate 重新交付引擎渲染豆包 smoke

## 背景

AF-255 已在旧 `integrate` `393cb30c` 上完成实现、真实 smoke、交付记录与归档，并创建 PR #102。随后 AF-254 / AF-256 / AF-257 的归档文档先合入 `integrate`，把状态面事件推进到 `eventSeq 1136`。AF-255 分支的登记/归档事件仍从 `1127` 起编号，rebase 到新 `integrate` 时出现同一序号区间的两套事件和哈希链断裂，无法在不伪造事件的前提下合并。

PR #102 已关闭。本任务从最新 `integrate` `7435b12f` 独立切出，用新任务号重新交付同一批代码与 smoke 证据，保证状态面单一真相。

## 目标

1. 重新加入 `LlmServiceChatCaller`：把 `LlmService.streamChat` 映射为 `ChatCaller.stream`。
2. 重新加入 `bin/visitor-render-smoke.ts`，走 `RenderConfigFactory → buildEngineRenderPort → LlmRenderAdapter → ChatCaller → LlmService → 豆包`。
3. 单测覆盖 content/done/error、参数透传、tool 拒绝与 chat 入口失败。
4. 真实跑一次豆包 smoke，输出候选、模型、TTFT、usage、finishReason、降级标记与前 80 字预览。

## 非目标

- 不改 `src/engine-core`。
- 不改生产 `.env`。
- 不改 AF-252 / AF-253 的候选解析逻辑。
- 不做并发、429/5xx、长对话压测与成本分 provider 分账。

## 验收

- 定向单测全绿；lint 0 error；CI 同口径 tsc 0 error。
- 真实 smoke：`providerHint=doubao`、文本非空、usage 非全 0、无回退无降级。
- `git diff HEAD -- src/engine-core` 为空。
