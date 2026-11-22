---
taskId: AF-286
contextId: phase2.5-orchestration-closed-loop
title: 熔断全损可观测（cooldown_served 指标 + 告警 + 面板 + 盲区收口）
type: implementation
status: backlog
baselineRef: 3ae89bf64dfd0c31f37bbfc88b1ce6ffe8faec8f
dependsOn: [AF-283]
priorTasks: [AF-278, AF-282, AF-283]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-22T15:40:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-adapters/rendering/render-telemetry.port.ts
    - src/engine-adapters/rendering/render-metrics.telemetry.ts
    - src/engine-adapters/rendering/llm-render.adapter.ts
    - src/shared/infra/metrics/metrics.service.ts
    - test/engine-adapters/
    - test/shared/infra/metrics/
    - docker/prometheus/alerts.yml
    - docker/grafana/dashboards/mofang-overview.json
    - docs/runbooks/render-telemetry-alerting.md
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 熔断全损可观测交付记录
    path: docs/worklog/completed/phase2.5/af286-cooldown-served-observability-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/engine-adapters/af282-render-telemetry-correctness.spec.ts test/engine-adapters/af286-cooldown-served.spec.ts test/shared/infra/metrics/render-telemetry-metrics.spec.ts test/config/af283-render-alerting.spec.ts
    check: 遥测、指标与告警守卫全绿
    threshold: exit=0
  - command: pnpm typecheck
    check: 类型闭合
    threshold: exit=0
  - command: pnpm eslint <改动 ts 文件>
    check: scoped 0 error / 0 warning
    threshold: exit=0
  - command: pnpm test
    check: 全量回归
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: 输出为空
---
# AF-286 · 熔断全损可观测

## 背景

AF-283 Runbook 的第一条已知盲区是“熔断挡掉 vs 候选试完败”无法区分：两者最终都记 `visitor_render_degraded_total{cause="exhausted"}`。运行时 `RenderFailoverRuntime.stats().cooldownServed` 已经统计“冷却期内无任何候选可用”的次数，但只写进日志，没有进 Prometheus，也没有告警与面板；灰度期发生全损时，值班只能翻日志。

## 目标

1. 遥测端口新增 `onCooldownServed()`（无标签、无内容），适配器在 `runtime.next()` 返回 null 且 `cooldownServed` 计数增长时上报。
2. `MetricsService` 注册 `visitor_render_cooldown_served_total` 计数器与方法。
3. `docker/prometheus/alerts.yml` 增加 `VisitorRenderCooldownServedSpike`（10m 内 >3 次，for 5m）。
4. Grafana 总览增加一块“熔断全损（10m）”面板，放在失败原因面板之后。
5. Runbook 增加告警行、cause/熔断判读说明，并把“熔断 vs 耗尽”盲区条目改写成剩余风险。
6. 测试：适配器在被熔断挡住时只上报一次 cooldown，不产生候选尝试/失败；指标注册可读；AF-283 守卫继续通过。

## 非目标

- 不改冷却算法、退避参数、候选顺序、prompt、模型配置。
- 不新增 `RenderFailureCause` 枚举值（避免标签口径扩散）。
- 不接 Alertmanager、不做自动回滚。
- 不改 `src/engine-core/**`。

## 方法

- 适配器在 `runCandidateLoop` 调 `runtime.next()` 前后读 `stats().cooldownServed` 差值；差值 >0 才上报，避免把“已尝试完”误记成熔断。
- 指标无标签：全损是进程级事实，候选维度在熔断时不可知；带标签会产生“全候选都冷却但只挂一个候选”的误导。
- 告警阈值按“整轮无候选可用”计，不做百分比；3 次/10m 是灰度期保守起点，Runbook 标注可调。

## 验收

- 新 spec 覆盖：单候选失败进入冷却后，第二次渲染不产生 attempt/failure，只产生一次 cooldownServed。
- 指标 spec 读出 `visitor_render_cooldown_served_total = 1`。
- 告警 YAML 解析 7 条规则；看板解析 12 panels；AF-283 守卫全绿。
- typecheck exit 0；scoped eslint 0；全量 test 全绿；engine-core diff 为空。
