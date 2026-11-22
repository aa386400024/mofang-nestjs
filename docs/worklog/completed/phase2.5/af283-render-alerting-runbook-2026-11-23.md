# AF-283 · 渲染遥测告警规则与灰度判读 Runbook

## 一、结论

渲染遥测从“能留痕”推进到“能判读、能告警、能回滚”：

- Prometheus 新增 `visitor-render` 组 6 条规则，覆盖降级率、鉴权失败、首包 P95、流式超时、回退率、失败原因分面；
- Grafana 总览新增 4 块渲染面板，降级率与取消率分线，barge-in 不再被读成故障；
- 新增 `docs/runbooks/render-telemetry-alerting.md`，写清指标口径、cause→处置、四段灰度放量判据、硬回滚线与回滚命令。

`engine-core` 零改动；未启新组件、未改渲染行为。

## 二、改了什么

### 2.1 告警规则 `docker/prometheus/alerts.yml`

新增 `visitor-render` 组：

| 告警 | 表达式口径 | 初版阈值 |
| --- | --- | --- |
| `VisitorRenderDegradedRateHigh` | `degraded / attempts{outcome=~"success\|degrade"}` | >3%，10m |
| `VisitorRenderAuthFailure` | `increase(auth_failure_total[5m])` | >0，1m |
| `VisitorRenderFirstDeltaSlow` | `histogram_quantile(0.95, rate(first_delta_bucket))` | >2s，10m |
| `VisitorRenderStreamTimeoutSpike` | `increase(timeout_total) by phase` | >5/10m，5m |
| `VisitorRenderFallbackRateHigh` | `fallback / 终局 attempts` | >10%，10m |
| `VisitorRenderFailureCauseSpike` | `increase(failure_total) by cause` | >10/10m，5m |

关键口径：降级率与回退率的分母都只用 `success + degrade`（终局轮次），**不含 retry、不含 cancelled**；barge-in 走高取消率不会把降级率顶上去。

### 2.2 看板 `docker/grafana/dashboards/mofang-overview.json`

新增 4 块面板（id 10–13）：

1. 来访者渲染：降级率 / 取消率（两条线分开，取消率仅观察）；
2. 来访者渲染：首包 P95（first-delta）；
3. 来访者渲染：候选级失败原因（按 cause）；
4. 来访者渲染：候选回退率。

### 2.3 Runbook `docs/runbooks/render-telemetry-alerting.md`

- 指标“能回答什么 / 不能回答什么”对照表；
- 告警清单 → 第一动作；
- `cause` 处置表（auth / rate-limit / server / timeout / first-delta / idle / empty / truncated / guard / config / exhausted / cancelled）；
- 四段灰度放量（影子 → 5% → 25% → 100%）与每段进入/停止条件；
- 硬回滚线：auth 任一、降级率 >5% 10m、首包 P95 >3s 15m、单 cause >20/10m 且备成功率 <90%；
- 明确“不是回滚线”：取消率上升、单次 guard；
- 回滚/恢复命令：`VISITOR_LLM_PROVIDER=minimax`、`pnpm exec tsx bin/visitor-switch-check.ts`、`visitor-render-smoke.ts`；
- 已知盲区：熔断 vs 耗尽、first-delta vs TTFT、聚合路径无指标、无 Alertmanager 外发。

### 2.4 守卫测试 `test/config/af283-render-alerting.spec.ts`

5 例：

1. `visitor-render` 组存在且 6 条告警齐全；
2. 告警/看板引用的 `visitor_render_*` 指标全部已在 `MetricsService` 注册；
3. 降级率/回退率表达式分母不含 `cancelled`；
4. 看板 JSON 可解析，含 4 块渲染面板与真实表达式；
5. Runbook 写明 barge-in 口径、回滚线、回滚命令与 Alertmanager 现状。

## 三、闸门真实数字

| 闸门 | 结果 |
| --- | --- |
| 定向两 spec（AF-283 + WP45） | 9/9 passed，262ms |
| `pnpm typecheck` | exit 0 |
| AF-283 spec scoped eslint | exit 0，0 error / 0 warning |
| `pnpm test`（全量） | 4330 passed + 4 skipped；4 failed 仍为未跟踪 AF-280 并行 spec，与本单无关 |
| `git diff --stat HEAD -- src/engine-core` | 空 |

## 四、偏差与设计决策

1. **阈值先宽后紧**：生产样本不足，初版 3%/2s/5 次/10% 都是保守值，Runbook 标注“按 P95/P99 重校”，不伪装成 SLA。
2. **降级率分母用终局轮次**：不用 attempts 全部，否则一次 retry 会稀释降级率；也不用 cancelled，否则 barge-in 会污染。
3. **不启用 Alertmanager**：任务非目标；当前“可告警”= Prometheus 规则 firing + Grafana 可查，外发通道留 backlog。
4. **不改 `prometheus.yml`**：`rule_files` 已加载 `alerts.yml`，无需新增挂载。
5. **不做自动回滚**：Runbook 只给人工判据与命令；自动回滚涉及环境写操作，留 L4 批准。

## 五、机读标记

### gateResults

- 定向两 spec 9/9 passed。
- `pnpm typecheck` exit 0。
- scoped eslint exit 0（0 error / 0 warning）。
- 全量 `pnpm test`：4330 passed + 4 skipped；4 failed 均属未跟踪 AF-280 并行 spec。
- engine-core diff 为空。

### scopeCheck

改动落在任务单 scope：`docker/prometheus/alerts.yml`、`docker/grafana/dashboards/mofang-overview.json`、`docs/runbooks/`、`test/config/`、worklog 记录。未改 `src/engine-core`、`bin/`、`admin-dashboard/`、Flutter。

### contractChecks

- taskId：分支 `task/AF-283-render-alerting-runbook`。
- state-write：register / promote / branch / run-once 均经 CLI。
- engine-boundary：`src/engine-core` 零改动。
- telemetry-privacy：告警/看板只引用指标与标签，不含 prompt、台词、会话内容。

### backlogItems

- `visitor-render-breaker-vs-exhausted`
- `visitor-first-delta-vs-ttft-semantics`
- `visitor-aggregate-path-telemetry`
- `visitor-alertmanager-paging`
- `visitor-render-auto-rollback`

### deviationTable

1. 阈值是灰度初版，非 SLA。
2. 告警外发需 Alertmanager，本单未启用。
3. 不做自动回滚。

### reviewVerdict

passed。
