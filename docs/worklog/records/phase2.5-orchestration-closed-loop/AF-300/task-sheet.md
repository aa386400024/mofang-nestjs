---
taskId: AF-300
contextId: phase2.5-orchestration-closed-loop
title: 渲染连接类失败独立 network cause
type: fix
status: backlog
baselineRef: 75993239f9359619b955bbc1ccc493fe2901d070
dependsOn: []
priorTasks: [AF-292, AF-295, AF-299]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, conventions.md#1.3]
createdAt: "2026-11-22T18:56:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-adapters/rendering/render-telemetry.port.ts
    - src/engine-adapters/rendering/llm-render.adapter.ts
    - test/engine-adapters/af282-render-telemetry-correctness.spec.ts
    - docs/runbooks/render-telemetry-alerting.md
    - docs/worklog/completed/phase2.5/af300-render-network-cause-2026-11-22.md
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-300/
  modules: [engine-adapters]
  interfaces:
    - RenderFailureCause
artifacts:
  - name: AF-300 交付记录
    path: docs/worklog/completed/phase2.5/af300-render-network-cause-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/engine-adapters/af282-render-telemetry-correctness.spec.ts
    check: network 连接错误分类用例通过，既有 cause 用例不回归
    threshold: exit=0 且 0 failed
  - command: pnpm exec tsx bin/visitor-render-smoke.ts --provider doubao --caller router --turns 1 --fail-primary --fail-backup --fail-primary-mode network --expect-exhausted --dump-render-metrics
    check: 真实 network 故障回放
    threshold: ok=true 且 failure cause 为 network
successCriteria:
  - RenderFailureCause 新增 network，连接类错误（Connection error/ECONNREFUSED/ENOTFOUND/fetch failed/socket hang up 等）归因 network。
  - HTTP 状态语义不变：429 仍 rate-limit、5xx 仍 server、401 走 auth 分支。
  - 单测覆盖连接错误分类；af282 原有用例全绿。
  - network smoke 的 failure/fallback cause 从 other 变为 network。
  - Runbook 故障矩阵与 cause 处置表同步 network；不新增告警阈值。
---

# AF-300 · 渲染连接类失败独立 network cause（fix / executor）

> 状态：📋 待执行（2026-11-22）
> 来源：AF-299 真实回放发现 `network` 模式落 `failure{cause=other}`，线上无法区分网络层故障与未知异常。

## 1. 范围

**在范围内：**

- `RenderFailureCause` 增加 `network`。
- `classifyErrorCause()` 增加连接类错误识别，顺序在 timeout 之前、429/5xx 之后。
- `af282-render-telemetry-correctness.spec.ts` 增加连接错误 → network 的用例。
- Runbook 故障矩阵 network 行改为 `failure{network}`，§3 cause 处置表补 network。
- 真实 smoke 回放 network，验证 failure/fallback cause 为 network。

**不在范围内：**

- 不改告警阈值、不改看板查询（cause 为堆叠标签，新值自动出现）。
- 不改 engine-core、不改 smoke 参数解析。
- 不重命名 `timeout`/`first-delta` 既有语义。

## 2. 验收口径

- `Connection error.`、`ECONNREFUSED`、`ENOTFOUND`、`fetch failed`、`socket hang up` 全部归 network。
- `429`、`502`、`401` 分类不变。
- network smoke：两候选 failure cause=network、fallback cause=network、rounds{exhausted}=1。
- 定向测试与 typecheck/lint/全量测试全绿；engine-core 零改动。
