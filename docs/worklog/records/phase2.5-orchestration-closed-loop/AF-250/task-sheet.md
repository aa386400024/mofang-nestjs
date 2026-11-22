---
taskId: AF-250
contextId: phase2.5-orchestration-closed-loop
title: 豆包流式 usage 计量修复（stream_options.include_usage）
type: fix
status: backlog
baselineRef: f88579f8807dbaaea961d86abc2049e30bfabecb
dependsOn: [AF-249]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-22T07:10:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/agent/llm/
    - test/agent/
    - bin/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af250-doubao-stream-usage-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/agent/llm-doubao-usage.spec.ts
    check: 豆包请求带 stream_options.include_usage，末尾 usage chunk 被正确解析
    threshold: exit=0
  - command: pnpm exec tsx bin/visitor-doubao-smoke.ts
    check: 真实豆包调用 usage.totalTokens > 0
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm exec tsc --noEmit -p tsconfig.json
    check: CI 全量 typecheck 0 error
    threshold: exit=0
---

# AF-250 · 豆包流式 usage 计量修复

## 背景

AF-249 真实 smoke 发现：`doubao-seed-character-260628` 的 SSE 响应没有 usage，`LlmService` 把 `promptTokens/completionTokens/totalTokens` 全记为 0。火山方舟文档明确：流式默认不统计 token 用量，需请求体设置 `stream_options.include_usage=true`，服务端会在 `[DONE]` 前额外返回一个 `choices=[]`、`usage` 非空的 chunk。

## 目标

1. `MiniMaxChatRequest` 增加可选 `stream_options?: { include_usage: boolean }`。
2. 仅当 `provider='doubao'` 时下发 `stream_options: { include_usage: true }`；MiniMax 请求体逐字不变。
3. 用单测断言请求体形状，并模拟末尾 usage chunk，断言 `done` chunk 的 usage 非 0。
4. 用 AF-249 smoke 真实复验 `usage.totalTokens > 0`。

## 非目标

- 不改 `src/engine-core`。
- 不改 MiniMax 的请求字段与解析行为。
- 不做成本估算兜底；如果真实上游仍不回 usage，再单独评估 `costBasis='estimated'`。

## 验收

- 单测：豆包请求体含 `stream_options.include_usage=true`，MiniMax 不含；末尾 usage chunk 正确落到 `done`。
- 真实 smoke：`usage.totalTokens > 0`，且 finishReason 仍为 `stop`。
- lint、CI 同口径 tsc、全量测试全绿。
