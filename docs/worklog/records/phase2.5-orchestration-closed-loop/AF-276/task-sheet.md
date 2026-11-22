---
taskId: AF-276
contextId: phase2.5-orchestration-closed-loop
title: 流式超时语义拆分与首包预算按输出上限放宽
type: implementation
status: backlog
baselineRef: e2250741cbd081d93888e692c1fc4ca4a404d4be
dependsOn: [AF-275, AF-274]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-22T13:10:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-adapters/rendering/render-adapter.config.ts
    - src/engine-adapters/rendering/llm-render.adapter.ts
    - src/engine-adapters/wiring/render-config.factory.ts
    - .env.example
    - test/engine-adapters/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af276-stream-timeout-semantics-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/engine-adapters/af276-stream-timeout-semantics.spec.ts test/engine-adapters/af274-stream-idle-timeout.spec.ts test/engine-adapters/af270-stream-timeout.spec.ts test/engine-adapters/wp25-env-example-coverage.spec.ts
    check: 超时语义拆分 + 首包预算 + 既有流式超时回归 + 模板覆盖
    threshold: exit=0
  - command: pnpm exec tsc --noEmit -p tsconfig.json
    check: 新配置字段类型闭合
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm exec tsx bin/visitor-render-smoke.ts --provider doubao --caller router --turns 1 --fail-primary --fail-primary-mode midstream-stall --expect-degraded --timeout-ms 1000 --expect-degraded-within-ms 5000
    check: 真实块间停摆仍按独立空闲键降级
    threshold: exit=0
  - command: pnpm exec tsx bin/visitor-render-smoke.ts --provider doubao --caller router --turns 3 --timeout-ms 30000
    check: 正常路径零回归
    threshold: exit=0
---
# AF-276 · 流式超时语义拆分与首包预算按输出上限放宽

## 背景

AF-270 / AF-274 把首包超时与块间停摆都挂在 `ENGINE_RENDER_TIMEOUT_MS` 上。这个键同时承担聚合调用总超时、流式首包等待、块间空闲等待三种语义：调大聚合超时会把停摆兜底拖慢，调小停摆兜底会把正常长首包误杀。

同时首包固定 30s 对高 `maxCompletionTokens` 的慢生成不安全：上游可能在生成大段思考 token，首包合法地晚于 30s。MiniMax 评审建议按 `max(8000, maxTokens*8)` 设定首包预算。

## 目标

1. 新增独立配置 `streamIdleTimeoutMs`，对应 `ENGINE_RENDER_STREAM_IDLE_TIMEOUT_MS`，只约束首 delta 之后的**块间空闲**。
2. 新增独立配置 `streamFirstDeltaTimeoutMs`，对应 `ENGINE_RENDER_STREAM_FIRST_DELTA_TIMEOUT_MS`，作为首包等待**下限**；实际预算 `max(下限, maxCompletionTokens*8)`。
3. `timeoutMs` / `ENGINE_RENDER_TIMEOUT_MS` 只保留聚合调用总超时语义，不再影响流式首包与块间空闲。
4. 首包超时与块间空闲日志、错误 reason 带明确 phase 与生效预算，现场可区分。
5. `.env.example` 声明两个新键并写清默认值与联动公式。

## 非目标

- 不新增 Prometheus 指标（AF-277）。
- 不改候选熔断、冷却、半开探测语义。
- 不改 MiniMax HttpClient 的传输层参数（单独任务核对）。
- 不做线上双跑或切流演练。

## 验收

- 纯函数 `resolveStreamFirstDeltaTimeoutMs(base, maxTokens)` 覆盖：base 下限、maxTokens 放大、缺省/非法值。
- 块间空闲只读 `streamIdleTimeoutMs`：`timeoutMs=10ms`、`streamIdleTimeoutMs=500ms` 时，20ms 一块的流不被误杀。
- 块间停摆用独立键降级：首 delta 后停写，按 `streamIdleTimeoutMs` 收尾降级。
- 首包预算按 `maxCompletionTokens` 放大：高上限请求的首包不会被固定下限误杀。
- tsc 0 error；lint 0 error；全量测试全绿；`git diff --stat HEAD -- src/engine-core` 为空。
