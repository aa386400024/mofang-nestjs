---
taskId: AF-289
contextId: phase2.5-orchestration-closed-loop
title: 候选冷却当前状态指标 + 真实故障链路指标取证
type: implementation
status: backlog
baselineRef: 613ca88b62701bf9672737450b8f1bfbd0deaf27
dependsOn: [AF-288]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, conventions.md#1.3]
createdAt: 2026-11-22T16:25:00+08:00
agentRole: orchestrator
---

# AF-289 · 候选冷却当前状态指标 + 真实故障链路指标取证（implementation）

> 状态：📋 待执行（2026-11-22）
> 执行方：自做
> 仓库：D:\work\Project\backend\mofang-nestjs-af070，分支 task/AF-289-...
> 唯一事实源：`docs/runbooks/render-telemetry-alerting.md`、AF-287 交付记录
> 任务性质：可观测性补口 + 真实链路验证
> 改动范围：仅后端 src/test/bin + docker + docs

## 0. 【必读入口】

1. `README.md`
2. `docs/README.md`
3. `docs/team/conventions.md`
4. `docs/worklog/completed/phase2.5/af287-candidate-cooldown-attribution-2026-11-22.md`
5. `docs/runbooks/render-telemetry-alerting.md`
6. 本任务单

## 1. 背景

AF-287 已能回答“哪个候选在什么时间因什么原因进入/延长冷却、冷却多久”，但回答不了“此刻哪个候选仍在冷却”。直方图是累计事件，`_count` 只说明进入次数；值班想知道当前是否还有候选被熔断，只能翻日志或等下一轮请求。AF-288 的三组真实 smoke 都没有触发 429/5xx，因此 AF-287 的冷却直方图只有单测覆盖，没有真实故障链路证据。

### 关键现状

- `RenderFailoverRuntime.health()` 已返回每个候选的 `inCooldown`、`cooldownUntil`、`cooldownDurationMs`、`halfOpenAfterMs`、`probeInFlight`。
- `LlmRenderAdapter.runCandidateLoop` 已在候选尝试前后读取 health，并回调 `onCandidateCooldown`；成功路径 `markSuccess` 会清零冷却。
- 指标注册集中在 `MetricsService.onModuleInit`，渲染映射在 `RenderMetricsTelemetry`，`buildEngineRenderPort` 已支持第 4 个可选 `telemetry` 参数。
- `bin/visitor-render-smoke.ts` 支持 `--fail-primary` / `--fail-primary-mode rate-limit|auth|server-error|timeout|midstream-stall`，但未注入渲染遥测，跑完看不到指标。

## 2. 范围

**在范围内：**

- `src/engine-adapters/rendering/render-telemetry.port.ts`：新增可选 `onCandidateCooldownState(candidateId, model, cooldownUntilMs)`。
- `src/engine-adapters/rendering/llm-render.adapter.ts`：候选尝试后，冷却新进/延长或由冷却恢复时回调当前状态；`cooldownUntilMs=0` 表示已恢复。
- `src/shared/infra/metrics/metrics.service.ts`：新增 `Gauge` `visitor_render_candidate_cooldown_until_seconds{candidate,model}`；方法 `setVisitorRenderCandidateCooldownUntil`。
- `src/engine-adapters/rendering/render-metrics.telemetry.ts`：映射上述回调，毫秒转秒；非法值丢弃。
- `bin/visitor-render-smoke.ts`：新增 `--dump-render-metrics`，仅注入 `RenderMetricsTelemetry` + 启用 metrics 的 `MetricsService`，报告里输出 `visitor_render_*` 指标样本；不改生产默认路径。
- `docker/prometheus/alerts.yml` / `docker/grafana/dashboards/mofang-overview.json` / `docs/runbooks/render-telemetry-alerting.md`：新增“当前冷却剩余时间”面板与 Runbook 判读，不新增告警规则。
- `test/engine-adapters/af289-candidate-cooldown-state.spec.ts`：真实适配器路径断言进入冷却上报、成功恢复上报 0。
- `test/shared/infra/metrics/render-telemetry-metrics.spec.ts`：gauge 注册与值断言。
- `test/config/af283-render-alerting.spec.ts`：守卫增加 gauge 指标、面板与 Runbook 文案。
- 真实 smoke 取证：`--fail-primary --fail-primary-mode rate-limit --expect-fallback --turns 3 --dump-render-metrics`，确认直方图 `_count>=1`、gauge `cooldown_until > time()`、fallback/原因指标同时出现。
- 交付记录与编排回执。

**不在范围内：**

- 不改 `src/engine-core/**`，不改 `boundary.spec.ts`。
- 不改候选选择、退避算法、失败阈值、告警阈值；不新增 `RenderFailureCause` 枚举值。
- 不新增告警规则；不启用 Alertmanager。
- 不碰 `admin-dashboard/`、Flutter、MiniMax Code 回执文件、未跟踪 AF-280/AF-281 半成品。
- 不做 32/64 路并发，不在本单解决 `visitor-smoke-history-limit-metadata`。

## 3. 目标架构 / 交付物

- **交付物 1：当前冷却 gauge** —— `visitor_render_candidate_cooldown_until_seconds{candidate,model}`，值为该候选冷却到期 Unix 秒；0 表示已恢复/不在冷却。PromQL 用 `gauge - time() > 0` 判“此刻仍在冷却”，gauge 绝对值随时间自然失效，不依赖后台清零定时器。
- **交付物 2：适配器状态回调** —— `runCandidateLoop` 在冷却新进/延长或 healthBefore 在冷却而 healthAfter 已恢复时上报；不增加每次请求的常态回调。
- **交付物 3：真实故障指标取证** —— smoke `--dump-render-metrics` 输出结构化指标样本；rate-limit 3 轮真实链路必须出现候选冷却计数与 active gauge。
- **交付物 4：面板与 Runbook** —— 看板新增“候选冷却剩余 (10m)”面板；Runbook 写明“直方图回答历史进入次数，gauge 回答当前是否仍在冷却”，并给出 PromQL。

**口径真相源**：gauge 语义以 `render-telemetry.port.ts` 注释与 `MetricsService` help 为准；阈值唯一真相源仍是 `docker/prometheus/alerts.yml`，本单不改阈值。

## 4. 红线

- engine-core 零改动；`git diff --stat HEAD -- src/engine-core` 必须为空。
- 遥测实现永不抛错、永不改变渲染结果；心理原文不进指标/日志。
- gauge 只带 candidate/model，不带 cause/session/prompt。
- smoke 默认不注入 metrics；只有显式 `--dump-render-metrics` 才启用。
- 提交只含本单文件；不混入未跟踪并行产物。

## 5. 闸门

- 定向：`pnpm exec vitest run test/engine-adapters/af289-candidate-cooldown-state.spec.ts test/shared/infra/metrics/render-telemetry-metrics.spec.ts test/config/af283-render-alerting.spec.ts`
- 类型：`pnpm typecheck`
- Lint：`pnpm lint`
- 全量：`pnpm test`（仅收尾一次，记录机器状态）
- 真实 smoke：`pnpm exec tsx bin/visitor-render-smoke.ts --provider doubao --caller router --fail-primary --fail-primary-mode rate-limit --expect-fallback --turns 3 --dump-render-metrics`
- YAML/JSON：解析 alerts.yml 与 dashboard JSON，断言面板存在。
- 边界：`git diff --stat HEAD -- src/engine-core` 为空。

## 6. 交付记录

`docs/worklog/completed/phase2.5/af289-candidate-cooldown-current-state-2026-11-22.md`

## 7. 交付回写清单

- [ ] 交付记录落盘
- [ ] 记录包 manifest / receipt / durable 副本
- [ ] `run-once` 摄入、验收、归档
- [ ] PR 创建、13 项检查、squash 合并、清理分支
- [ ] `worklog verify --strict`、`events verify`、`status`
- [ ] backlog 回写：`visitor-candidate-cooldown-current-state` 关闭；如真实故障暴露新问题另登记

## 8. 回复输出约定

完成后报告真实闸门数字、smoke 指标样本、任务状态与合并 SHA。
