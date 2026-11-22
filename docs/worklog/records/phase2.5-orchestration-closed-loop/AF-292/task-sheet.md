---
taskId: AF-292
contextId: phase2.5-orchestration-closed-loop
title: 渲染轮次分母与鉴权告警标签修正
type: fix
status: backlog
baselineRef: 2b8a1cf6eb0fc2ca40ee528e9b159cf1a1b139f6
dependsOn: []
priorTasks: [AF-291]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, conventions.md#1.3]
createdAt: "2026-11-22T17:10:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-adapters/rendering/render-telemetry.port.ts
    - src/engine-adapters/rendering/llm-render.adapter.ts
    - src/engine-adapters/rendering/render-metrics.telemetry.ts
    - src/shared/infra/metrics/metrics.service.ts
    - docker/prometheus/alerts.yml
    - docker/grafana/dashboards/mofang-overview.json
    - docs/runbooks/render-telemetry-alerting.md
    - test/shared/infra/metrics/render-telemetry-metrics.spec.ts
    - test/config/af283-render-alerting.spec.ts
    - test/engine-adapters/af292-render-round-outcome.spec.ts
    - bin/visitor-render-smoke.ts
    - docs/worklog/completed/phase2.5/af292-render-round-denominator-2026-11-22.md
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-292/
  modules: []
  interfaces: [RenderTelemetryPort, MetricsService]
artifacts:
  - name: AF-292 交付记录
    path: docs/worklog/completed/phase2.5/af292-render-round-denominator-2026-11-22.md
    kind: report
gates:
  - command: pnpm typecheck
    check: TypeScript 全量类型检查
    threshold: exit=0
  - command: pnpm exec vitest run test/engine-adapters/af292-render-round-outcome.spec.ts test/config/af283-render-alerting.spec.ts test/shared/infra/metrics/render-telemetry-metrics.spec.ts
    check: 本单定向测试
    threshold: 全绿
successCriteria:
  - 轮次级 visitor_render_rounds_total{outcome} 在每个 render/streamRender 轮次恰好记一次，覆盖 success/degrade/guard/exhausted/cancelled。
  - 降级率与回退率的分母改用 rounds_total，降级分子排除 cause=guard，避免守卫正确行为指向 provider。
  - VisitorRenderAuthFailure 表达式带 by (candidate)，annotation 的 $labels.candidate 不再为空。
  - 告警静态守卫能机械校验 $labels.X 必须出现在 expr 的 by(...) 中。
  - 不新增业务语义，不改 engine-core，不碰 AF-280/AF-281 未跟踪半成品。
---

# AF-292 · 渲染轮次分母与鉴权告警标签修正（fix / executor）

> 状态：📋 待执行（2026-11-22）
> 来源：AF-288-REVIEW 只读评审 P0-1 与 P0-3。P0-2 已在 AF-289 修复。

## 1. 范围

**在范围内：**

- 新增轮次级计数器 `visitor_render_rounds_total{outcome}`，在 `render()` / `streamRender()` 的每个终局恰好记一次。
- 降级率与回退率的分母从候选 `attempts_total{outcome=~"success|degrade"}` 换成轮次 `rounds_total`；降级分子排除 `cause="guard"`。
- `VisitorRenderAuthFailure` 改为按 candidate 聚合；静态守卫校验 `$labels.X` 与 `by(...)` 一致。
- 更新 Grafana 一块“轮次结局”面板与 Runbook 指标/口径/面板说明。
- 定向单测与真实 smoke 取证。

**不在范围内：**

- 不改 `src/engine-core/**`。
- 不调整退避参数，不改告警阈值，不做并发+故障 smoke（另单）。
- 不碰 AF-280/AF-281 未跟踪半成品、`admin-dashboard/`、Flutter。

## 2. 验收口径

- 单测覆盖 success / degrade / guard / exhausted / cancelled 五种轮次结局，且每轮只记一次。
- 降级率表达式分母为 `visitor_render_rounds_total`，分子 `cause!="guard"`；回退率分母同。
- `VisitorRenderAuthFailure` 的 expr 含 `by (candidate)`，annotation `$labels.candidate` 非空。
- `af283-render-alerting.spec.ts` 能对每个告警校验 `$labels.X` 必须出现在 expr 的 `by(...)`。
- 真实 smoke 的 `--dump-render-metrics` 输出 `visitor_render_rounds_total` 样本。
- `pnpm typecheck` exit 0；本单定向测试全绿；全量 lint/test 记录真实基线（排除未跟踪半成品失败）。
- `git diff --stat HEAD -- src/engine-core` 为空。

## 3. 红线

- 指标标签只用封闭枚举，不带 prompt、台词、会话内容。
- 状态面只经 CLI；任务单正文不改写历史。
- 遥测回调永不抛错，故障不得反向影响渲染主流程。
