# AF-287 · 候选级熔断归因（冷却时长直方图 + 告警 + 面板 + 守卫文案）

- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-287/task-sheet.md`
- 分支：`task/AF-287-candidate-cooldown`
- 基线：`42d61e77a1b56de4424ef0585bf01abd4070a8dc`（AF-286 merge）
- 日期：2026-11-22

## 一、为什么做

AF-286 把“熔断全损”和“候选试完败”拆开了，但 `visitor_render_cooldown_served_total` 是进程级、无标签计数。值班看到全损上涨，仍然回答不了三个问题：

1. 哪个候选被熔断了？
2. 熔了多久？
3. 因为什么原因？

`RenderFailoverRuntime.health()` 里其实已有 `inCooldown / cooldownDurationMs / consecutiveFailures`，但只用于日志和测试，没有进 Prometheus。AF-286 交付记录已把 `visitor-cooldown-candidate-attribution` 登记为 backlog。本单就是收这条。

## 二、改了什么

### 2.1 遥测端口

`src/engine-adapters/rendering/render-telemetry.port.ts`

新增可选回调：

```ts
onCandidateCooldown?(candidateId: string, model: string, cause: RenderFailureCause, cooldownMs: number): void;
```

语义与 `onCooldownServed` 明确分工：

- `onCooldownServed`：整轮一个候选都不可用（全损）；
- `onCandidateCooldown`：单个候选**新进入冷却**，或半开探测失败导致**冷却时长被延长**；
- `cooldownMs` 是本次生效的冷却墙钟时长（指数退避后的值），不是剩余时间。

### 2.2 适配器

`src/engine-adapters/rendering/llm-render.adapter.ts`

在 `runCandidateLoop` 每次 `attempt(candidate)` 前后读 `runtime.health()[candidate.id]`：

```text
healthBefore -> attempt -> healthAfter
若 healthAfter.inCooldown
且 (healthBefore 不在冷却 或 healthAfter.cooldownDurationMs > healthBefore.cooldownDurationMs)
则上报 onCandidateCooldown(candidate, model, cause, healthAfter.cooldownDurationMs)
```

这样做的取舍：

- 不把 `markFailure` 的每个调用点都改一遍，只在候选循环的单一出口判断，减少漏报；
- 未达失败阈值的普通失败不报（`healthAfter.inCooldown=false`）；
- 成功路径 `markSuccess` 会清零，不报；
- 半开探测失败会把冷却翻倍，`cooldownDurationMs` 变大，能再次上报；
- `cause` 取本次 `AttemptOutcome` 的真实原因，不新增 `RenderFailureCause` 枚举值。

### 2.3 指标

`src/shared/infra/metrics/metrics.service.ts`

新增直方图：

```text
visitor_render_candidate_cooldown_seconds{candidate,model,cause}
buckets: 1,2,5,10,20,30,60,120,300,600,1200,1800 秒
```

为什么是直方图不是 gauge：冷却“剩余时间”需要周期性采集才有意义，当前没有采集器；直方图能回答“熔了多久”的分布，`_count` 能回答“熔了几次”，且不引入新的采集链路。

`render-metrics.telemetry.ts` 增 `onCandidateCooldown` 映射，毫秒转秒，非法值直接丢弃，异常吞掉不影响渲染主流程。

### 2.4 告警

`docker/prometheus/alerts.yml` 第 8 条：

```text
VisitorRenderCandidateCooldownSpike
sum(increase(visitor_render_candidate_cooldown_seconds_count[10m])) by (candidate, cause) > 5
for: 5m / warning / team=ai-engine
```

只按进入冷却次数告警，不按时长告警：不同候选/场景的冷却容忍度不同，统一时长阈值会误报；时长留给面板 P95 判读。

### 2.5 看板

`docker/grafana/dashboards/mofang-overview.json` 新增 2 块（共 14 panels，渲染 7 块）：

- id 15「来访者渲染: 候选熔断次数 (10m)」：按 `candidate,cause` 分面；
- id 16「来访者渲染: 候选熔断时长 P95 (10m)」：按 `candidate` 分面，单位秒。

### 2.6 Runbook

`docs/runbooks/render-telemetry-alerting.md`：

- 指标表新增 `visitor_render_candidate_cooldown_seconds` 行；
- 告警表新增第 8 条与第一动作；
- PromQL 增加“候选熔断次数”“候选熔断时长 P95”两条；
- 看板说明从五块改为七块；
- 盲区第一条改写：候选归因已可查，剩余风险是“进程内累计、多实例需分实例观察、不回答当前是否还在冷却”。

### 2.7 守卫文案

`test/config/af283-render-alerting.spec.ts`：

- `REQUIRED_METRICS` 增 `cooldown_served_total` 与 `candidate_cooldown_seconds`；
- `REQUIRED_ALERTS` 增两条 cooldown 告警；
- `REQUIRED_PANELS` 增“熔断”；
- 标题从“六个告警”“四类面板”改成不再写死数量的“关键告警”“渲染面板”；
- 增加看板表达式必须含 `candidate_cooldown_seconds_count/bucket` 的断言。

这条同时收掉 AF-286 回执里登记的 `visitor-af283-guard-wording`。

## 三、测试

新增 `test/engine-adapters/af287-candidate-cooldown.spec.ts` 3 例：

1. 单候选 429，`failureThreshold=1`：首次进冷却上报一次，cause=`rate-limit`，cooldownMs=1000；
2. `failureThreshold=2`：一次 429 未达阈值，只记失败、不产生冷却事件；
3. 注入时钟：第一次 429 冷却 1000ms；推进到半开时点后探测失败 500，冷却翻倍到 2000ms，再次上报 `cause=server`、`cooldownMs=2000`。

同时扩 `render-telemetry-metrics.spec.ts` 为十类指标，断言直方图 le=60 桶计数为 1。

## 四、闸门

| 闸门 | 结果 | 证据 |
| --- | --- | --- |
| 定向 vitest | 5 files / 20 tests 全绿（906ms） | `data/af287-target1.log` |
| `pnpm typecheck` | exit 0 | `data/af287-typecheck2.log` |
| scoped eslint | 首轮 2 个 prettier，`--fix` 后 exit 0 / 0 warning | `data/af287-eslint1.log`、`data/af287-eslint2.log` |
| YAML/JSON 解析 | visitor-render 8 条规则；看板 14 panels / 渲染 7 块 | 命令行输出 |
| `pnpm test` | 4335 passed + 4 skipped；4 failed 全在未跟踪 AF-280 spec | `data/af287-test-full.log` |
| `git diff --stat HEAD -- src/engine-core` | 输出为空 | 命令行输出 |
| CI 同款全量 `tsc -p tsconfig.json` | 7 个 error 全在未跟踪 AF-280 spec，本单文件 0 | `data/af287-tsc-full.log` |

## 五、偏差与风险

1. **没有做“当前是否在冷却”的 gauge**：需要周期性采样 runtime 健康状态，当前没有采集器；本单明确不做，写进 Runbook 剩余风险。
2. **直方图只记事件，不记剩余时间**：判读“现在还在冷却吗”仍需日志或 health 快照；Prometheus 侧能回答“最近熔了几次、熔了多久”。
3. **全量测试 4 例失败**：全部来自未跟踪 `test/engine-adapters/af280-render-prompt-variant.spec.ts`（AF-281 并行半成品），不属本单 scope，未改动、未删除。
4. **未接 Alertmanager**：规则会 firing，但不会外发；沿用 AF-283 现状。

## 六、commit

`feat(AF-287): 候选级熔断归因、冷却时长直方图与守卫文案`
