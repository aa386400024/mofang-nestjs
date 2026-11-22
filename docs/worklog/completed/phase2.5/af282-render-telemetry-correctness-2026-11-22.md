# AF-282 · 渲染遥测语义修正（barge-in 不计降级 + 候选失败原因指标 + 安全拦截 cause 统一）

## 一、结论

AF-279 评审提出的两条 P0 已修：barge-in 不再污染降级率，候选级失败原因不再塌缩成 `exhausted`。同时收掉了 P1-1（安全拦截 cause 不一致）、P1-3（锁定后鉴权失败不记 auth）、P1-6（取消被误判成首包超时）三条会直接影响告警判读的归因问题。

对外渲染语义未变：barge-in 仍返回兜底结果（已出声不能撤回），只修指标口径；任何遥测实现抛错都不影响这一轮渲染。`engine-core` 零改动。

## 二、改了什么

### 2.1 端口：`RenderTelemetryPort`

`src/engine-adapters/rendering/render-telemetry.port.ts` 新增两个可选回调：

- `onFailure(candidateId, model, cause)`：每次**候选级**失败记一次，含末次候选。
- `onCancelled(candidateId, model)`：外部取消（barge-in / 暂停）单独计数。

契约注释写明：failure 保留候选级失败原因，避免单候选 / 末次候选塌缩成 `exhausted`；cancelled 是外部取消，不是降级。

### 2.2 指标：`MetricsService` 新增两组

| 指标 | 类型 | 标签 |
| --- | --- | --- |
| `visitor_render_failure_total` | Counter | `candidate, model, cause` |
| `visitor_render_cancelled_total` | Counter | `candidate` |

记录方法 `incVisitorRenderFailure` / `incVisitorRenderCancelled` 沿用 `metrics.enabled` 早返回，关闭时 no-op。

### 2.3 映射：`RenderMetricsTelemetry`

实现 `onFailure` / `onCancelled`，继续走 `safe(fn)`，指标异常不反向影响渲染。

### 2.4 埋点：`LlmRenderAdapter`

- `runCandidateLoop`：
  - 非 success 且 `cause='cancelled'` → 只报 `onCancelled`，**不记** `onAttemptOutcome(..., 'degrade')`，直接结束本轮；
  - 其余非 success 终局 → `onFailure(candidate.id, model, cause ?? 'other')`，末次候选与单候选都保留真实原因。
- `degradeOutcome` 增加 `recordDegraded` 参数：`cancelled` 跳过 `onDegraded`。
- `streamAttempt`：
  - 首包前外部取消返回 `cause='cancelled'`；
  - 锁定后中断抽出 `classifyLockedInterruption`：**外部取消优先** → `cancelled`；其次鉴权 → `onAuthFailure + auth`；其余按 `classifyErrorCause`。
  - 抽出方法同时把 `streamAttempt` 圈复杂度降回 lint 上限内（22 → 20 以下）。
- `openStream` catch：`guard.externalAborted()` 判定移到 `guard.timedOut()` 之前，避免取消中止上游后被误记成 `first-delta`。
- 安全拦截 cause 统一：
  - `handleText` 重生成预算耗尽 → `guard`；
  - `regenerate` 后 block → `guard`；
  - 真人度重试后 block → `guard`。
- 二次上游调用的失败原因保留：`regenerate` 与真人度重试的 `callOnce` 失败分支补 `cause: call.cause ?? 'other'`，限流 / 5xx / 超时不再丢。

## 三、测试

新增 `test/engine-adapters/af282-render-telemetry-correctness.spec.ts` 7 例：

1. 首包后外部取消：只记 `cancelled`，不记 `degraded` / `attempts{degrade}` / `failure` / `fallback` / `timeout`；
2. 首包前外部取消：不切备、不记超时，只记 `cancelled`；
3. 单候选 429：`failure{rate-limit}` + `degraded{exhausted}`，attempts outcome 仍为 `retry`；
4. 双候选末次 502：`failure{rate-limit}`、`failure{server}`，不塌缩；
5. 安全拦截：`degraded{guard}` + `failure{guard}`；
6. 锁定后 401：`authFailure`、`failure{auth}`、`degraded{auth}`，不切备；
7. 新回调抛错：渲染结果不变。

`test/shared/infra/metrics/render-telemetry-metrics.spec.ts` 同步扩到八类指标，覆盖 `failure` / `cancelled` 标签与 `metrics.enabled=false` no-op。

## 四、闸门真实数字

| 闸门 | 结果 |
| --- | --- |
| 定向三 spec（AF-282 + AF-278 + metrics） | 16/16 passed |
| `pnpm typecheck` | exit 0 |
| AF-282 改动文件 scoped eslint | exit 0，0 error / 0 warning |
| `pnpm test`（全量） | 4325 passed + 4 skipped；4 failed 全部在**未跟踪**的 AF-280/AF-281 并行 spec（`test/engine-adapters/af280-render-prompt-variant.spec.ts` / `test/agent/visitor/`），与本单文件域无关，也不会进 CI |
| `git diff --stat HEAD -- src/engine-core` | 空 |

说明：本工作树里有 AF-280/AF-281 的未跟踪半成品（`src/shared/realism/visitor-prompt-variants.ts`、两个 af280 spec），`pnpm lint` 全量会扫到它们并报 11 error；AF-282 自己的 6 个改动文件 scoped eslint 为 0。CI 只校验提交内容，不受影响。

## 五、偏差与设计决策

1. **barge-in 仍返回降级结果**：`StreamRenderOutcome.degraded` 保持 true，调用方拿到的兜底话术不变；只让指标不记降级。避免把"已出声撤回不了"的真实状态伪装成成功。
2. **attempts outcome 不改语义**：单候选 429 的 attempt 仍记 `retry`（描述"这次试错可重试"），失败原因交给 `failure{cause}`。两者分工不同，不强行合并。
3. **取消时完全不记 attemptOutcome**：若记 `degrade` 会让 attempts 分母与降级率再次被 barge-in 污染；取消由 `cancelled_total` 单独承载。
4. **未做**：P1-4（熔断全损与候选试完仍同记 exhausted）、P1-7（first-delta 量 raw chunk 与 TTFT 同名不同义）、P1-8（聚合路径无 first_delta/stream_timeout）。这些留作后续单，不在本单扩围。
5. **未改**候选选择、冷却、重试、prompt、模型配置与 `engine-core`。

## 六、机读标记

### gateResults

- 定向三 spec 16/16 passed。
- `pnpm typecheck` exit 0。
- AF-282 文件 scoped eslint exit 0（0 error / 0 warning）。
- 全量 `pnpm test`：4325 passed + 4 skipped；4 failed 均属未跟踪 AF-280 并行 spec。
- `git diff --stat HEAD -- src/engine-core` 输出为空。

### scopeCheck

改动落在任务单 scope：`src/shared/infra/metrics/`、`src/engine-adapters/rendering/`、`test/engine-adapters/`、`test/shared/infra/metrics/`、`docs/worklog/completed/phase2.5/`、`docs/worklog/records/phase2.5-orchestration-closed-loop/`。未改 `engine-core`、`bin/`、`admin-dashboard/`、Flutter。

### contractChecks

- taskId：分支 `task/AF-282-render-telemetry-correctness`，提交只含 AF-282。
- state-write：register / promote / run-once / 分支均经 CLI。
- engine-boundary：`src/engine-core` 零改动。
- telemetry-privacy：新增标签只有 candidate / model / 封闭 cause，不含 prompt、台词、会话 id、原始错误文案。

### backlogItems

- `visitor-render-breaker-vs-exhausted`：熔断挡掉的轮次与候选试完全败仍同记 `exhausted`。
- `visitor-first-delta-vs-ttft-semantics`：first-delta 超时量 raw chunk，TTFT 量首个可见闭合句，同名不同义。
- `visitor-aggregate-path-telemetry`：聚合路径无 first_delta / stream_timeout，且缺测试。
- `visitor-render-alerting-runbook`：指标已可告警判读，Grafana 面板与阈值/runbook 仍未建。

### deviationTable

1. barge-in 的返回结果仍为 degraded，只修指标口径。
2. 单候选 429 的 attempts outcome 保持 retry，不改成 degrade。
3. 取消不记 attemptOutcome，由 cancelled 单独承载。
4. P1-4 / P1-7 / P1-8 未纳入本单。

### reviewVerdict

passed。两条 P0 已关闭，P1-1 / P1-3 / P1-6 同步修复；定向 16 例、typecheck、scoped eslint 全绿，engine-core 零改动。
