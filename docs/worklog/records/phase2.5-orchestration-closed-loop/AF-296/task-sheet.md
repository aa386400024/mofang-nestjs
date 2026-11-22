---
taskId: AF-296
contextId: phase2.5-orchestration-closed-loop
title: Grafana 比率面板回合口径对齐与逐面板守卫
type: fix
status: backlog
baselineRef: bbc48ee44a804151b740b4e12a1f3ed22b698763
dependsOn: []
priorTasks: [AF-292, AF-295]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, conventions.md#1.3]
createdAt: "2026-11-22T18:10:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - docker/grafana/dashboards/mofang-overview.json
    - test/config/af283-render-alerting.spec.ts
    - docs/runbooks/render-telemetry-alerting.md
    - docs/worklog/completed/phase2.5/af296-grafana-round-ratio-2026-11-22.md
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-296/
  modules: []
  interfaces: []
artifacts:
  - name: AF-296 交付记录
    path: docs/worklog/completed/phase2.5/af296-grafana-round-ratio-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/config/af283-render-alerting.spec.ts
    check: 告警/看板/Runbook 守卫
    threshold: exit=0
  - command: pnpm typecheck
    check: TypeScript 全量类型检查
    threshold: exit=0
successCriteria:
  - 看板“降级率”分子排除 cause=guard，分母改为 visitor_render_rounds_total，与 VisitorRenderDegradedRateHigh 完全一致。
  - 看板“取消率”分母改为 visitor_render_rounds_total，不再用 attempts{success|degrade}。
  - 看板“回退率”分母改为 visitor_render_rounds_total，与 VisitorRenderFallbackRateHigh 一致。
  - 测试新增逐面板守卫：标题含降级率/回退率/取消率的面板，每条 expr 必须含 rounds_total 且不得含 attempts_total；守卫能对旧表达式报错。
  - Runbook 写明突发告警 increase[10m]+for:5m 的结构性滞后，以及 cancelled 只进取消率分母、不进降级分母。
  - 不改告警阈值、不改生产代码、不碰 engine-core。
---

# AF-296 · Grafana 比率面板回合口径对齐与逐面板守卫（fix / executor）

> 状态：📋 待执行（2026-11-22）
> 来源：AF-292 外审 P0-A1。告警已改 rounds 分母，但看板 id 10 降级率/取消率、id 13 回退率仍是 attempts 旧分母；现有守卫只做全局子串包含，新面板让守卫自然满足，拦不住单面板口径漂移。

## 1. 范围

**在范围内：**

- `mofang-overview.json` 三条比率表达式改为 rounds 分母；降级分子加 `cause!="guard"`。
- `af283-render-alerting.spec.ts` 新增逐面板守卫，并保留“告警与看板口径一致”的机械检查。
- Runbook 补两处判读口径：告警滞后、cancelled 分母归属。
- 定向 vitest、typecheck、全量 lint/test 收尾取证。

**不在范围内：**

- 不改 `alerts.yml` 阈值与规则结构。
- 不拆 provider 健康度 / 用户可感知失败率 / 取消率三条新口径（外审 A2，单独立项）。
- 不改 `render()`/`streamRender()` 的 try/finally（外审 A6，单独立项）。
- 不碰 engine-core、admin-dashboard、Flutter。

## 2. 验收口径

- id 10 降级率 expr = `sum(increase(visitor_render_degraded_total{cause!="guard"}[10m])) / clamp_min(sum(increase(visitor_render_rounds_total[10m])), 0.001)`。
- id 10 取消率 expr = `sum(increase(visitor_render_cancelled_total[10m])) / clamp_min(sum(increase(visitor_render_rounds_total[10m])), 0.001)`。
- id 13 回退率 expr = `sum(increase(visitor_render_fallback_total[10m])) / clamp_min(sum(increase(visitor_render_rounds_total[10m])), 0.001)`。
- 逐面板守卫对含三个关键词的任一面板逐 target 检查，缺 rounds 或出现 attempts 即 fail。
- `pnpm exec vitest run test/config/af283-render-alerting.spec.ts` 全绿；`pnpm typecheck` exit 0。

## 3. 红线

- 只改看板 JSON 的 expr 与必要文案，不动面板布局与 id。
- 测试用机械断言，不靠人工比对字符串。
- 状态面只经 CLI；任务单正文不改写历史。
