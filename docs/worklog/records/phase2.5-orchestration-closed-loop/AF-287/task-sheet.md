---
taskId: AF-287
contextId: phase2.5-orchestration-closed-loop
title: 候选级熔断归因（冷却时长直方图 + 告警 + 面板 + 守卫文案）
type: implementation
status: backlog
baselineRef: 42d61e77a1b56de4424ef0585bf01abd4070a8dc
dependsOn: [AF-286]
priorTasks: [AF-278, AF-282, AF-283, AF-286]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-22T16:05:00+08:00"
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
    - test/config/
    - docker/prometheus/alerts.yml
    - docker/grafana/dashboards/mofang-overview.json
    - docs/runbooks/render-telemetry-alerting.md
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 候选级熔断归因交付记录
    path: docs/worklog/completed/phase2.5/af287-candidate-cooldown-attribution-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/engine-adapters/af287-candidate-cooldown.spec.ts test/engine-adapters/af286-cooldown-served.spec.ts test/engine-adapters/af282-render-telemetry-correctness.spec.ts test/shared/infra/metrics/render-telemetry-metrics.spec.ts test/config/af283-render-alerting.spec.ts
    check: 候选级冷却、全损、遥测、指标与告警守卫全绿
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
# AF-287 · 候选级熔断归因

## 背景

AF-286 已让“熔断全损 vs 候选试完败”可区分，但 `visitor_render_cooldown_served_total` 是进程级、无标签计数：值班知道“这一轮全损了”，仍不知道“哪个候选被熔断、熔了多久、因什么原因”。`RenderFailoverRuntime.health()` 已有候选级 `inCooldown / cooldownDurationMs / consecutiveFailures` 快照，但只供日志与测试，没有进 Prometheus。AF-286 交付记录已把 `visitor-cooldown-candidate-attribution` 登记为 backlog。

## 目标

1. 遥测端口新增 `onCandidateCooldown(candidateId, model, cause, cooldownMs)`，在候选失败后**新进入冷却或冷却时长被延长**时上报；未达阈值的普通失败不上报。
2. `MetricsService` 注册直方图 `visitor_render_candidate_cooldown_seconds{candidate,model,cause}`，记录本次冷却墙钟时长；其 `_count` 同时表达“进入冷却次数”。
3. `docker/prometheus/alerts.yml` 增加 `VisitorRenderCandidateCooldownSpike`（10m 内进入冷却 >5 次，for 5m，warning）。
4. Grafana 总览增加两块面板：候选/原因熔断次数（10m）、候选熔断时长 P95（10m）。
5. Runbook 增加指标、告警、面板与判读路径；把“候选归因不可知”盲区改写成剩余风险（进程级累计、多实例需分实例查看）。
6. 顺带修正 AF-283 守卫 spec 标题“六个告警”的过期文案（`visitor-af283-guard-wording`）。
7. 测试：候选首次进冷却上报一次并带正确 cause/duration；未达阈值的失败不上报；半开探测失败延长冷却时再次上报；指标直方图可读。

## 非目标

- 不改冷却算法、失败阈值、退避参数、候选顺序、prompt、模型配置。
- 不新增 `RenderFailureCause` 枚举值。
- 不接 Alertmanager、不做自动回滚。
- 不加 `/metrics` 定时快照或新的健康端点；直方图只记录“进入/延长冷却”事件。
- 不改 `src/engine-core/**`。

## 方法

- 适配器在 `runCandidateLoop` 里对当前候选做 `health()` 前后快照；`attempt` 返回后若 `inCooldown=true` 且（之前不在冷却或 `cooldownDurationMs` 变大），说明本次失败新进冷却或延长了冷却，上报 after 快照的时长。
- 直方图而不是 gauge：冷却剩余时间需要周期性采集才有意义，当前没有采集器；直方图能回答“熔了多久”的分布，`_count` 能回答“熔了几次”，且不引入新的采集链路。
- 告警只按 `_count` 增长，不看时长；时长阈值不适合做统一告警（不同模型/场景容忍度不同），留给面板判读。

## 验收

- 新 spec 覆盖首次进入冷却、未达阈值不上报、半开探测失败延长冷却再次上报。
- 指标 spec 读出 `visitor_render_candidate_cooldown_seconds_count{...}=1` 且 `_sum` 为冷却秒数。
- 告警 YAML 解析 8 条规则；看板解析 14 panels；AF-283 守卫全绿且标题不再写“六个告警”。
- typecheck exit 0；scoped eslint 0；全量 test 全绿；engine-core diff 为空。
