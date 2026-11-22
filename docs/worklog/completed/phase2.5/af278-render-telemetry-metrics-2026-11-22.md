# AF-278 · 渲染链路 Prometheus 可观测性

## 一、结论

渲染链路第一次有了可从 `/metrics` 读到的生产观测面：候选尝试、首包时延、流式超时、鉴权失败、候选回退、降级六类事件全部落到 Prometheus，且标签只使用封闭枚举，不携带 prompt、台词或原始错误文案。

实现保持“遥测旁路”原则：适配器只回调事件，未注入 `telemetry` 时静默跳过；指标实现抛错被吞掉，任何观测失败都不会改变这一轮的渲染结果。`engine-core` 零改动。

## 二、改了什么

### 2.1 纯接口：`RenderTelemetryPort`

新增 `src/engine-adapters/rendering/render-telemetry.port.ts`：

- `RenderStreamTimeoutPhase = 'first-delta' | 'idle'`
- `RenderFailureCause` 封闭枚举：`auth | rate-limit | server | timeout | first-delta | idle | empty | truncated | config | guard | exhausted | cancelled | other`
- `RenderAttemptOutcome = 'success' | 'retry' | 'degrade'`
- 可选回调：`onAttempt`、`onAttemptOutcome`、`onFirstDelta`、`onStreamTimeout`、`onAuthFailure`、`onFallback`、`onDegraded`
- 契约注释明确：实现不得抛错、不得携带 prompt 台词。

不依赖 NestJS、不依赖 prom-client，`engine-adapters` 仍可独立测试。

### 2.2 指标：`MetricsService` 新增六组

`src/shared/infra/metrics/metrics.service.ts`：

| 指标 | 类型 | 标签 |
| --- | --- | --- |
| `visitor_render_attempts_total` | Counter | `candidate, model, outcome` |
| `visitor_render_first_delta_seconds` | Histogram | `candidate, model` |
| `visitor_render_stream_timeout_total` | Counter | `candidate, phase` |
| `visitor_render_auth_failure_total` | Counter | `candidate` |
| `visitor_render_fallback_total` | Counter | `from, to, cause` |
| `visitor_render_degraded_total` | Counter | `cause` |

TTFT buckets：`0.1 / 0.25 / 0.5 / 0.8 / 1 / 1.5 / 2 / 3 / 5 / 8 / 12 / 20 / 30`，覆盖 AF-268 实测 517–1255ms 与 AF-277 回滚态 594–4968ms 的分布。

所有记录方法先判 `metrics.enabled`，关闭时 no-op，不访问未初始化字段。

### 2.3 映射：`RenderMetricsTelemetry`

新增 `src/engine-adapters/rendering/render-metrics.telemetry.ts`：

- 实现 `RenderTelemetryPort`，构造入参 `MetricsService`。
- `onFirstDelta` 把 `ttftMs / 1000` 送 Histogram；非法或负值直接丢弃。
- 所有方法经 `safe(fn)` try/catch，指标异常不影响渲染。

### 2.4 埋点：`LlmRenderAdapter`

`src/engine-adapters/rendering/llm-render.adapter.ts`：

- `LlmRenderAdapterDeps` 新增可选 `telemetry`；类内 `notify()` 统一做“未注入跳过 + 异常吞掉”。
- `runCandidateLoop(spec, attempt)` 接收 spec，用于解析当前候选真实模型名：
  - 每次尝试前 `onAttempt(candidate.id, model)`；
  - 尝试后 `onAttemptOutcome(candidate.id, model, success|retry|degrade)`；
  - 真正选到下一个候选时 `onFallback(from, to, cause)`；
  - 候选耗尽返回 `cause='exhausted'`。
- 失败原因归类：
  - `classifyFailure` 返回 `cause`，auth 时同时 `onAuthFailure(candidate.id)`；
  - `classifyErrorCause`：结构化 429 → `rate-limit`，5xx → `server`，文案 timeout/abort → `timeout`，其余 → `other`；不使用原始 message 当标签。
- 流式关键点：
  - 首个可见增量锁定候选时 `onFirstDelta(candidate.id, model, ttftMs)`；
  - 首包超时 `onStreamTimeout(candidate.id, 'first-delta')` 并返回 `cause='first-delta'`；
  - 块间停摆 `onStreamTimeout(candidate.id, 'idle')` 并返回 `cause='idle'`。
- 降级入口 `degrade` / `degradeOutcome` 统一 `onDegraded(cause)`；空上下文 `empty`、前置预检 block `guard`、空内容 / 无可见台词 `empty`、截断 `truncated`、未配置模型 `config` 均带 cause。

### 2.5 装配

- `buildEngineRenderDeps(caller, config, probe?, telemetry?)` 与 `buildEngineRenderPort(...)` 增加可选第 4 参数，仅在注入时展开 `telemetry`。
- `ENGINE_RENDER_PORT` 工厂注入 `MetricsService`，装配 `new RenderMetricsTelemetry(metrics)`。`MetricsModule` 已是 `@Global()`，DI 可用。

## 三、测试与闸门

新增两个 spec：

- `test/engine-adapters/af278-render-telemetry.spec.ts` 6 例：
  1. 主候选成功：attempt → outcome success → firstDelta 一次，无回退、无降级；
  2. 429 回退：outcome `retry,success`，fallback `primary→backup cause=rate-limit`，不记 auth；
  3. 401 回退：`onAuthFailure(primary)`，fallback `cause=auth`；
  4. 首包无增量：`onStreamTimeout(primary,'first-delta')` 并切备；
  5. 首包后停摆：`onStreamTimeout(primary,'idle')`、`onDegraded('idle')`，不切备；
  6. 遥测实现抛错：渲染结果不变。
- `test/shared/infra/metrics/render-telemetry-metrics.spec.ts` 3 例：
  1. 六类指标按 candidate / phase / cause 标签读出，Histogram bucket 1.2s 落在 `le=1.5`；
  2. `metrics.enabled=false` 全部 no-op；
  3. 指标实现抛错被吞掉且仍被调用一次。

闸门真实数字：

| 闸门 | 结果 |
| --- | --- |
| 定向两 spec | 9/9 passed，约 1.0s |
| `pnpm typecheck` | exit 0（`tsc -b tsconfig.check.json`） |
| 本地复跑 CI 全量 | `pnpm exec tsc --noEmit -p tsconfig.json` exit 0 |
| `pnpm lint` | exit 0，0 error / 0 warning |
| `pnpm test` | 270 files passed + 1 skipped；4313 tests passed + 4 skipped；23.87s |
| `git diff --stat HEAD -- src/engine-core` | 空 |

真实 smoke（改动后回归）：`--provider doubao --caller router --turns 3`，3/3 `doubao-seed-character-260628`，fallback false，degraded false，stop 3/3，wall 2651ms，TTFT 683 / 1252 / 696ms，prompt tokens 745→775→811。

取证日志：`data/af278-targeted1..3.log`、`data/af278-typecheck1..3.log`、`data/af278-lint1..2.log`、`data/af278-eslint-fix.log`、`data/af278-full-test1.log`、`data/af278-smoke3.log`。

CI 首轮 `Lint + Typecheck` 失败，原因是本地 `tsconfig.check.json` 与 CI `tsc --noEmit -p tsconfig.json` 的严格项不同：测试里的指标样例被强转成自定义 `MetricSample[]`，触发 `TS2352`；`labels` 的索引签名访问触发 `TS4111`。修复为 `as unknown as MetricSample[]`、`labels['candidate']` 等下标访问，并把 `labels` 值类型改为 `string | number`（Histogram 的 `le` 实际是 number）。修复后本地复跑 CI 同款全量 tsc exit 0，定向 3/3 通过，lint exit 0。

## 四、偏差与设计决策

1. **候选耗尽不补 from→? 回退**：`onFallback` 只在真正选到下一候选时记录；候选全部耗尽时只记 `onDegraded('exhausted')`。这样 `from/to` 都是真实候选 id，避免出现 `to=degraded` 这类假标签。代价是“最后一次失败没有回退目标”这件事只能从 attempts + degraded 组合推断。
2. **遥测原因与重试决策分离**：`classifyErrorCause` 只服务标签，不参与 retry；重试仍由 `classifyFailure` 的 `retryable` 决定，避免观测口径反向影响生产行为。
3. **model 标签在尝试前解析**：`resolveParams(spec, candidate)` 是纯函数，提前解析可让 `onAttempt` 与 `onAttemptOutcome` 的 model 一致；未配置模型时也会以候选 task 默认名上报，随后 attempt 返回 `config` 降级。
4. **不做 Grafana / 告警规则**：按任务单非目标执行，本次只保证指标注册、标签稳定与 `/metrics` 可读。

## 五、遗留项

- `visitor-minimax-reasoning-token-budget-floor`：回滚态渲染最小 `maxCompletionTokens` 下限，避免 reasoning 吃穿预算。
- `visitor-stream-block-degraded-semantics`：流式 block 替换兜底句时 `degraded=false`，需要在指标或状态语义上补记。
- `visitor-concurrency-fault-injection`：单进程并发 + 故障注入互斥，共享熔断器并发语义未验证。
- `visitor-render-metrics-grafana`：指标已就绪，Grafana 面板与告警阈值仍待建。
- `visitor-smoke-stream-timeout-flags`：smoke CLI 仍无独立 idle / 首包参数。

## 六、机读标记

### gateResults（闸门结果）

- 定向 `af278-render-telemetry.spec.ts` + `render-telemetry-metrics.spec.ts`：9/9 passed。
- `pnpm typecheck` exit 0；`pnpm lint` exit 0（0 error / 0 warning）。
- 全量 `pnpm test`：270 files passed + 1 skipped；4313 tests passed + 4 skipped。
- 真实 smoke 3 轮：3/3 doubao，fallback false，degraded false，stop 3/3。
- `git diff --stat HEAD -- src/engine-core` 输出为空。

### scopeCheck（范围核对）

改动落在任务单 scope：`src/shared/infra/metrics/`、`src/engine-adapters/rendering/`、`src/engine-adapters/wiring/`、`test/engine-adapters/`、`test/shared/infra/metrics/`、`docs/worklog/completed/phase2.5/`、`docs/worklog/records/phase2.5-orchestration-closed-loop/`。未改 `engine-core`、`bin/`、`admin-dashboard/`、Flutter。

### contractChecks（契约核对）

- taskId：分支名 `task/AF-278-render-telemetry-metrics` 与提交标题只含 AF-278。
- state-write：register / promote / run-once / branch 均经 CLI，状态索引与事件链未手改。
- index-schema：交付记录六组机读字段齐全。
- engine-boundary：`src/engine-core` 零改动。
- telemetry-privacy：指标标签不含 prompt、台词、会话 id 或原始错误文案。

### backlogItems（遗留项）

- `visitor-minimax-reasoning-token-budget-floor`
- `visitor-stream-block-degraded-semantics`
- `visitor-concurrency-fault-injection`
- `visitor-render-metrics-grafana`
- `visitor-smoke-stream-timeout-flags`

### deviationTable（偏差说明）

1. 候选耗尽只记 `degraded{exhausted}`，不伪造 `fallback{to=?}`。
2. 错误 cause 只做遥测标签，不参与重试决策。
3. `onAttempt` 的 model 在尝试前用 `resolveParams` 解析。
4. 未做 Grafana 面板与告警，按任务单非目标执行。

### reviewVerdict（验收结论）

passed。六类指标注册、标签映射、no-op、异常隔离与真实 smoke 回归全部成立；全量 4313 例全绿；engine-core 零改动。
