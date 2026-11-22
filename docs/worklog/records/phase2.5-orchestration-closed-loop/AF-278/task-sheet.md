---
taskId: AF-278
contextId: phase2.5-orchestration-closed-loop
title: 渲染链路 Prometheus 可观测性（超时/鉴权/回退/降级/候选维度）
type: implementation
status: backlog
baselineRef: 74a9062c0100214a3e127fbd60371d7dd52fdeac
dependsOn: [AF-277, AF-276, AF-275, AF-274]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-22T13:45:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - src/shared/infra/metrics/metrics.service.ts
    - src/engine-adapters/rendering/render-telemetry.port.ts
    - src/engine-adapters/rendering/render-metrics.telemetry.ts
    - src/engine-adapters/rendering/llm-render.adapter.ts
    - src/engine-adapters/wiring/render-config.factory.ts
    - src/engine-adapters/wiring/engine.module.ts
    - test/engine-adapters/
    - test/shared/infra/metrics/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af278-render-telemetry-metrics-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/engine-adapters/af278-render-telemetry.spec.ts test/shared/infra/metrics/render-telemetry-metrics.spec.ts
    check: 回调与指标映射全绿
    threshold: exit=0
  - command: pnpm typecheck
    check: 类型闭合
    threshold: exit=0
  - command: pnpm lint
    check: 0 error / 0 warning
    threshold: exit=0
  - command: pnpm test
    check: 全量回归
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: 输出为空
---
# AF-278 · 渲染链路 Prometheus 可观测性

## 背景

AF-276 已用日志区分 `phase=first-delta` / `phase=idle`，AF-277 又发现 block 后 `degraded=false`、auth 回退无计数。渲染链路目前没有任何 Prometheus 指标：`MetricsService` 只有 HTTP/auth/oauth/audit/ASR；`engine-adapters` 无 metrics 依赖；`buildEngineRenderPort` 无 telemetry 参数。生产上线后无法从看板判断“是超时、鉴权、限流还是候选耗尽”。

## 目标

1. 新增纯接口 `RenderTelemetryPort`（attempt / first-delta / stream-timeout / auth-failure / fallback / degraded），不依赖 NestJS、不依赖 prom-client。
2. 在 `LlmRenderAdapter` 的真实候选循环与流式状态机关键点回调；失败原因归类为封闭枚举，避免标签爆炸。
3. 新增 `RenderMetricsTelemetry` 适配器，把回调映射到 `MetricsService` 的 Prometheus 指标：
   - `visitor_render_attempts_total{candidate,model,outcome}`
   - `visitor_render_first_delta_seconds{candidate,model}`（Histogram）
   - `visitor_render_stream_timeout_total{candidate,phase}`
   - `visitor_render_auth_failure_total{candidate}`
   - `visitor_render_fallback_total{from,to,cause}`
   - `visitor_render_degraded_total{cause}`
4. `ENGINE_RENDER_PORT` 装配时注入 metrics；`metrics.enabled=false` 时所有记录 no-op。
5. 单元测试覆盖回调触发点、指标标签与 no-op；不改 engine-core。

## 非目标

- 不记录任何 prompt / 台词 / 会话内容。
- 不做 Grafana 看板与告警规则。
- 不改 smoke CLI。

## 验收

- 定向两个 spec 全绿。
- `pnpm typecheck` / `pnpm lint` / `pnpm test` 全绿。
- `git diff --stat HEAD -- src/engine-core` 为空。
- 交付记录含六组机读字段标记。
