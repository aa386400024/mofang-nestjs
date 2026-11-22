# AF-286 · 熔断全损可观测

## 一、结论

AF-283 Runbook 的第一条盲区“熔断挡掉 vs 候选试完败”已经收口：新增 `visitor_render_cooldown_served_total`，只统计“整轮无候选可用（全员冷却且未到半开时点）”的全损轮次，并在 Prometheus 加第 7 条告警、Grafana 加第 12 块面板、Runbook 加判读路径。

`exhausted` 仍是轮次终局标签，但值班现在可以对照 `cooldown_served_total` 判断：同步上涨=熔断挡掉，没涨=候选真的试完败。

## 二、改了什么

### 2.1 遥测端口与适配器

- `RenderTelemetryPort` 新增 `onCooldownServed?()`；无标签、无内容，只表达“这一轮全损”。
- `LlmRenderAdapter.runCandidateLoop` 在 `runtime.next()` 前后读 `stats().cooldownServed` 差值，差值 >0 才上报；有备候选可用、半开探测可用时不记。
- 不新增 `RenderFailureCause` 枚举值，避免标签口径扩散。

### 2.2 指标

`MetricsService` 注册 `visitor_render_cooldown_served_total`（无标签 Counter）与 `incVisitorRenderCooldownServed()`。

为什么无标签：全损是进程级事实，熔断时“哪个候选该被归因”不可知；带标签会出现“全候选都冷却却只挂一个候选”的误导。

### 2.3 告警与看板

- `docker/prometheus/alerts.yml`：`visitor-render` 组新增 `VisitorRenderCooldownServedSpike`，`sum(increase(visitor_render_cooldown_served_total[10m])) > 3`，for 5m，warning。
- `docker/grafana/dashboards/mofang-overview.json`：新增面板 id 14「来访者渲染: 熔断全损 (10m)」，full width，共 12 panels。

### 2.4 Runbook

- 指标口径表新增 `cooldown_served_total` 行，写明“半开探测可用时不算、不是单候选熔断次数”。
- 告警表新增第 7 条与第一动作。
- `exhausted` 的 cause 处置改为“先对照 cooldown_served_total”。
- 盲区条目改写为剩余风险：进程级计数、多实例需分实例观察、与 degraded 时间窗短暂错位。

### 2.5 测试

- 新 `test/engine-adapters/af286-cooldown-served.spec.ts` 2 例：
  - 单候选 429 进冷却后，第二轮零 attempt / 零 failure / 零 outcome，只记一次 cooldown；
  - 有备候选可用时正常回退，不算熔断全损。
- `render-telemetry-metrics.spec.ts` 扩为九类指标，读出 cooldown 计数。
- AF-282 七例与 AF-283 五例守卫继续通过。

## 三、闸门真实数字

| 闸门 | 结果 |
| --- | --- |
| 定向四 spec（AF-286 + AF-282 + metrics + AF-283） | 17/17 passed，801ms |
| `pnpm typecheck` | exit 0 |
| scoped eslint（4 个 src 文件 + 2 个 test 文件） | exit 0，0 error / 0 warning |
| `alerts.yml` YAML 解析 | `visitor-render` 7 条规则 |
| Grafana JSON 解析 | 12 panels |
| `pnpm test`（全量） | 4332 passed + 4 skipped；4 failed 仍为未跟踪 AF-280 并行 spec |
| `git diff --stat HEAD -- src/engine-core` | 空 |

## 四、偏差与设计决策

1. **不加 cause 枚举**：新增 `cooling` 会扩散到所有看板/告警标签，且 `exhausted` 的轮次语义仍然成立；用独立计数器表达“全损来源”更稳。
2. **计数器无标签**：见 2.2；代价是无法按候选归因，写进 Runbook 剩余风险。
3. **阈值 3 次/10m**：灰度初版，不是 SLA；Runbook 标注可调。
4. **AF-283 守卫 spec 的测试标题仍写“六个告警”**：守卫只断言六个必须存在的告警名，新增第 7 条不破坏；改名属测试文案整理，留待后续 docs/TD 单处理，不在本单扩 scope。

## 五、机读标记

### gateResults

- 定向四 spec：17/17 passed。
- `pnpm typecheck` exit 0。
- scoped eslint exit 0（0 error / 0 warning）。
- YAML 解析 7 条规则；看板 12 panels。
- 全量 `pnpm test`：4332 passed + 4 skipped；4 failed 均为未跟踪 AF-280 并行 spec。
- engine-core diff 为空。

### scopeCheck

in-scope。改动限于遥测端口、适配器、MetricsService、两个测试、告警/看板、Runbook、worklog。未改冷却算法、候选顺序、prompt、`.env`、`engine-core`。

### contractChecks

- taskId：分支 `task/AF-286-cooldown-served`，提交只含 AF-286。
- state-write：register / promote / branch / run-once 均经 CLI。
- engine-boundary：`src/engine-core` 零改动。
- telemetry-privacy：新指标无标签、无 prompt/台词/会话内容。

### backlogItems

- `visitor-cooldown-candidate-attribution`：cooldown_served 是进程级全损计数，无法回答“哪个候选被熔断、熔了多久”，需 health 快照或候选级熔断计数。
- `visitor-af283-guard-wording`：AF-283 守卫 spec 标题仍写“六个告警”，新增第 7 条后文案过期。

### deviationTable

1. 不新增 cause 枚举，用独立计数器表达熔断全损。
2. 计数器无候选标签，归因能力有限。
3. 阈值是灰度初版。
4. AF-283 守卫 spec 标题文案未改。

### reviewVerdict

passed。
