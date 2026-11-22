# AF-289 · 候选冷却当前状态指标 + 真实故障链路指标取证（implementation）

> 交付日期：2026-11-22
> 分支：`task/AF-289-af-289`（自 `integrate` 613ca88b）
> 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-289/task-sheet.md`
> 性质：可观测性补口 + 真实故障链路验证

## 1. 落地

一句话：把“哪个候选此刻还在冷却”从只能翻日志变成一条可查询 gauge，并让 smoke 在真实 429 故障下直接导出指标，第一次用生产链路验证 AF-287 的冷却直方图与 AF-289 的当前状态。

| 文件 | 改动 |
| --- | --- |
| `src/engine-adapters/rendering/render-telemetry.port.ts` | 新增可选 `onCandidateCooldownState(candidateId, model, cooldownUntilMs)`；`0` 表示已恢复 |
| `src/engine-adapters/rendering/llm-render.adapter.ts` | 抽出 `notifyCandidateCooldownState`，只在“新进/延长/恢复”时回调；避免主循环复杂度膨胀 |
| `src/shared/infra/metrics/metrics.service.ts` | 新增 `Gauge visitor_render_candidate_cooldown_until_seconds{candidate,model}` 与 `setVisitorRenderCandidateCooldownUntil` |
| `src/engine-adapters/rendering/render-metrics.telemetry.ts` | 映射状态回调，毫秒转 Unix 秒；非法值丢弃 |
| `bin/visitor-render-smoke.ts` | 新增 `--dump-render-metrics`，显式注入 `RenderMetricsTelemetry`，报告输出 `visitor_render_*` 样本与 `renderMetricsObservedAt` |
| `docker/grafana/dashboards/mofang-overview.json` | 新增 id 17「候选冷却剩余（实时）」，表达式 `clamp_min(until - time(), 0)` |
| `docs/runbooks/render-telemetry-alerting.md` | 增 gauge 指标行、PromQL、第八块面板说明与盲区口径 |
| `test/engine-adapters/af289-candidate-cooldown-state.spec.ts` | 3 例：进入冷却上报到期、半开探测成功恢复上报 0、探测失败延长上报新到期 |
| `test/shared/infra/metrics/render-telemetry-metrics.spec.ts` | 十一类指标，含 gauge 值与类型断言 |
| `test/config/af283-render-alerting.spec.ts` | 守卫扩到 gauge 注册、面板关键词与 Runbook 口径 |

## 2. 证据

### 闸门

| 命令 | exit | 结果 | 备注 |
| --- | --- | --- | --- |
| `pnpm exec vitest run test/engine-adapters/af289-candidate-cooldown-state.spec.ts test/shared/infra/metrics/render-telemetry-metrics.spec.ts test/config/af283-render-alerting.spec.ts` | 0 | 3 files / 11 tests passed，744ms | 日志 `data/af289-target2.log` |
| `pnpm typecheck` | 0 | 0 error | 日志 `data/af289-typecheck3.log` |
| 定向 `pnpm exec eslint <本单 8 文件>` | 0 | 0 error / 0 warning | 日志 `data/af289-eslint2.log`、`data/af289-eslint3.log` |
| `pnpm lint`（全量） | 1 | 5 error / 4 warning，全部在未跟踪 AF-280/AF-281 半成品（`src/shared/realism/visitor-prompt-variants.ts`、`test/agent/visitor/af280-visitor-prompt-variant.spec.ts`、`test/engine-adapters/af280-render-prompt-variant.spec.ts`） | 本单文件 0；日志 `data/af289-lint-full.log` |
| `pnpm test`（全量） | 1 | 276 passed / 1 failed files；4338 passed / 4 failed / 4 skipped tests；27.41s | 4 failed 全在未跟踪 `af280-render-prompt-variant.spec.ts`；日志 `data/af289-test-full.log` |
| `git diff --stat HEAD -- src/engine-core` | 0 | 空 | 内核零改动 |

### 真实故障链路取证

命令：

```text
pnpm exec tsx bin/visitor-render-smoke.ts --provider doubao --caller router \
  --fail-primary --fail-primary-mode rate-limit --expect-fallback --turns 3 --dump-render-metrics
```

结果（`data/af289-fault-metrics2.log`）：

- 3/3 轮 `stop`，`fallbackUsed=true`，`degraded=false`，`guardLevel=pass`；墙钟 4760ms。
- `visitor_render_failure_total{candidate=doubao,cause=rate-limit}=3`。
- `visitor_render_fallback_total{from=doubao,to=minimax,cause=rate-limit}=3`。
- `visitor_render_candidate_cooldown_seconds_count{candidate=doubao,cause=rate-limit}=1`（首次 429 进入 60s 冷却后，后续两轮直接被跳过，符合退避语义）。
- `visitor_render_candidate_cooldown_until_seconds{candidate=doubao}=1795336257.61`；`renderMetricsObservedAt=1795336199.012`，剩余 **58.6s > 0**，证明 gauge 在真实链路中确实表达“此刻仍在冷却”。
- `visitor_render_cooldown_served_total=0`：备候选可用，没有发生整轮全损，口径正确。

这说明 AF-287 直方图与 AF-289 gauge 不是只在单测里存在，生产路由链 + 真实上游故障注入下都能产出正确标签与值。

## 3. 范围

scopeCheck：`in-scope`。只改 `src/engine-adapters/rendering`、`src/shared/infra/metrics`、`bin/visitor-render-smoke.ts`、`docker/grafana`、`docs/runbooks`、`test` 与 worklog；未改 `src/engine-core/**`，未改告警阈值，未新增告警规则，未碰 `admin-dashboard/` 或 Flutter。

parallelArtifactsExcluded：`true`。未跟踪 AF-280/AF-281 半成品、`data/batch-reports/*`、`docs/worklog/inbox/*` 均未纳入提交；全量 lint/test 的失败仅作为基线记录，不是本单引入。

noOutscopeRefactor：`true`。复杂度超限时只抽出一个私有方法 `notifyCandidateCooldownState`，未改候选选择、退避算法或失败阈值。

## 4. 契约

contractChecks：

| 项 | 结果 | 说明 |
| --- | --- | --- |
| taskId | pass | 分支 `task/AF-289-af-289`；提交只含 AF-289 |
| state-write | pass | register / promote / run-once / branch create 均经 CLI |
| receipt-groups | pass | 本记录含 gateResults / scopeCheck / contractChecks / backlogItems / deviationTable / reviewVerdict |
| engine-boundary | pass | `src/engine-core` 零改动 |
| metric-name | pass | gauge 与 dashboard 表达式同名，静态守卫已覆盖 |
| privacy | pass | 指标只带 candidate/model，不带 prompt、台词、会话 id |

口径真相源：gauge 语义在 `render-telemetry.port.ts` 与 `MetricsService` help；告警阈值仍在 `alerts.yml`，本单未改。

## 5. 遗留

backlogItems：

- `visitor-candidate-cooldown-current-state`：**关闭**。gauge 已落地并有真实故障链路证据。
- `visitor-concurrency-above-8-unknown`：仍在。8 路并发无 429 不等于 32/64 路安全。
- `visitor-smoke-history-limit-metadata`：仍在。plain smoke 的 `historyLimitTurns` 仍只是元数据。
- `visitor-candidate-cooldown-alert-calibration`：仍在。当前无 active-cooldown 告警，面板与 Runbook 先上线观察，阈值标定留给灰度数据。

openQuestions：无。

manualReviewList：无。

## 6. 偏差

deviationTable：

| 任务单原方案 | 实际 | 原因 |
| --- | --- | --- |
| 面板新增“候选冷却剩余 (10m)” | 改成“候选冷却剩余（实时）” | gauge 是绝对到期时刻，不应套 10m 窗口；窗口会把仍在冷却但 10m 内无变化的候选漏掉 |
| smoke 报告输出指标样本 | 额外输出 `renderMetricsObservedAt` | 冷却 60s 会在日志回看时自然过期；没有观测时刻就无法事后证明 `until > time()` |
| 任务单只提 gauge | 增加真实 429 故障注入取证 | 只落 gauge 仍是单测覆盖；用户要生产可用性，必须让真实链路同时验证直方图与 gauge |

## 7. 结论

finalStatus：`completed`
reviewVerdict：`passed`
verdictRationale：gauge 语义、适配器回调条件、指标映射与看板/Runbook 口径一致；定向 11 例、typecheck 与 scoped ESLint 全绿；真实 429 故障链路下冷却计数、回退计数与当前到期时刻同时正确，且备候选可用时 `cooldown_served_total=0` 未被误记。全量 lint/test 失败均为未跟踪 AF-280 并行产物，本单零引入。内核边界干净。
