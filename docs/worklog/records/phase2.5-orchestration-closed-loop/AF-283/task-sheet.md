---
taskId: AF-283
contextId: phase2.5-orchestration-closed-loop
title: 渲染遥测告警规则与灰度判读 Runbook（Prometheus 规则 + Grafana 面板 + 回滚判据）
type: implementation
status: backlog
baselineRef: a9cdc4b8afbe2b6ee8ecfb1df238a8adf5764662
dependsOn: [AF-282]
priorTasks: [AF-278, AF-279, AF-282]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-23T14:55:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - docker/prometheus/alerts.yml
    - docker/grafana/dashboards/mofang-overview.json
    - docs/runbooks/render-telemetry-alerting.md
    - test/config/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 告警与灰度判读 Runbook
    path: docs/runbooks/render-telemetry-alerting.md
    kind: report
gates:
  - command: pnpm exec vitest run test/config/af283-render-alerting.spec.ts test/config/wp45-prometheus-alert-metrics.spec.ts
    check: 新规则与既有规则守卫全绿
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
# AF-283 · 渲染遥测告警规则与灰度判读 Runbook

## 背景

AF-278 把渲染链路六类指标接到 Prometheus，AF-282 修掉 barge-in 被计成降级、末次候选失败原因塌缩两条 P0，并新增 `visitor_render_failure_total` 与 `visitor_render_cancelled_total`。指标已经“可留痕”，但仓库里还没有任何针对渲染链路的告警规则、看板面板和灰度判读/回滚判据 —— 灰度期仍然只能靠人盯日志。

## 目标

1. `docker/prometheus/alerts.yml` 新增 `visitor-render` 告警组，覆盖：
   - 降级率异常（排除 barge-in 后的真实降级）；
   - 鉴权失败（任何一次都值得告警）；
   - 首包 P95 过慢；
   - 流式超时（首包 / 块间）；
   - 候选回退率异常；
   - 候选级失败原因分布（按 cause）。
2. `docker/grafana/dashboards/mofang-overview.json` 新增渲染链路面板：降级率、取消率、失败原因、首包 TTFT、候选回退。
3. 新增 `docs/runbooks/render-telemetry-alerting.md`：每个告警的指标口径、阈值依据、排查步骤、灰度放量判据与回滚动作；明确 barge-in 不再计入降级率。
4. 新增静态守卫测试：告警规则必须引用本轮已注册的渲染指标；看板必须包含关键面板表达式；Runbook 必须写清回滚阈值。

## 非目标

- 不启 Prometheus / Grafana 容器，不引入新 exporter。
- 不改渲染候选选择、冷却、重试、prompt、模型配置。
- 不改 `src/engine-core/**`。
- 不做自动回滚脚本（只写人工回滚判据与命令）。

## 方法

- 告警表达式统一用 `increase()` 描述“窗口内次数”，用 `histogram_quantile()` 描述首包分位；`for` 留出灰度噪声窗口。
- 降级率分母用 `visitor_render_attempts_total` 的 success+retry+degrade 总数，分子只用 `visitor_render_degraded_total`；`cancelled` 不进任何一侧。
- 阈值初版按 AF-268/AF-277/AF-278 实测（TTFT 0.5–1.3s、回滚态 0.6–5.0s）留出余量，Runbook 标注“灰度期可调”。
- 看板面板复用现有 datasource 与 gridPos 风格，不重排既有面板。

## 验收

- `test/config/af283-render-alerting.spec.ts` 覆盖：渲染告警组存在且引用已注册指标；看板含 5 类渲染面板；Runbook 含回滚阈值与命令。
- 定向两 spec 全绿；`pnpm typecheck` exit 0；`pnpm lint` 0 error / 0 warning；`pnpm test` 全绿；engine-core diff 为空。
- 交付记录写清阈值依据、与任务单偏差；回执六组字段齐全。
