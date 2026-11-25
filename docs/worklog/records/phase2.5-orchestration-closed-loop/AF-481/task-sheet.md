---
taskId: AF-481
contextId: phase2.5-orchestration-closed-loop
title: 补齐 cachedTokens 跨层接线（wiring / observability / agent-llm）
type: fix
status: backlog
baselineRef: 221475aab79d9e2c06aa1a9844bf4402c879018d
dependsOn: [AF-478]
priorTasks: [AF-478, AF-480]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.2, conventions.md#1.3]
createdAt: 2026-11-25T01:35:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-adapters/wiring/
    - src/engine-adapters/observability/
    - src/agent/llm/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-481/
  modules:
    - engine-wiring-usage
    - session-cost
    - agent-llm-usage
  interfaces:
    - engine-stream-usage
    - turn-idempotency-usage
    - voice-llm-done-usage
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af481-cache-wiring-2026-11-25.md
    kind: report
gates:
  - command: pnpm exec vitest run test/llm/cached-tokens.spec.ts test/admin-debug/wp58-debug-session.spec.ts test/engine-adapters/wp8b-stream-render.spec.ts
    check: 缓存透传相关单测全绿
    threshold: 0 failed
  - command: pnpm lint
    check: lint 通过
    threshold: 0 error
  - command: pnpm typecheck
    check: 类型检查通过
    threshold: 0 error
successCriteria:
  - wiring / observability / agent-llm 六处把 cachedTokens 写入 done、幂等快照、session cost 与 llm_done usage。
  - 缺失仍为不可得（null/undefined），报 0 保留，不把缺失折算成 0。
  - 不改 src/engine-core、不改生产 prompt、不把台词原文写入仓库。
---

## 1. 背景

AF-478 已交付 provider、渲染适配、debug trace 与评测脚本，但 `cachedTokens` 还要经过 `src/engine-adapters/wiring`、`src/engine-adapters/observability` 与 `src/agent/llm` 才能进入 done 事件、幂等快照、session cost 与 voice `llm_done`。这些文件不在 AF-478 scope，按框架单独承接。

## 2. 实现口径

- `engine-stream-backend.adapter.ts`：done 事件 usage、幂等快照 usage、本场累计 usage、`TurnTrace.llmUsage` 都带缓存字段；新增 `readCachedTokens()` / `cachedUsageField()`。
- `llm-service-chat-caller.ts`：final chunk 映射 `usage.cachedTokens`。
- `turn-idempotency.service.ts`：`TurnUsageSnapshot` 增加可选缓存字段。
- `session-cost.ts`：`SessionUsageDelta` / `SessionUsageTotals` / `ProviderUsageTotals` 增加可选缓存；累加保留；`SessionCostSummary` 增加 `totalCachedTokens`。
- `agent/llm/llm.types.ts` / `llm.service.ts`：`LlmUsage` 增加缓存字段；MiniMax stream delta 解析 `prompt_tokens_details.cached_tokens` 与 `cache_read_input_tokens`；非法值过滤，0 保留。

## 3. 非目标

- 不改 `src/engine-core`；不改渲染适配、评测脚本与 AF-427 测试（分别由 AF-478 / AF-482 承担）。
- 不改生产 prompt、context budget、MAX_HISTORY_TURNS。
