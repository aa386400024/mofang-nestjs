# AF-292 · 渲染轮次分母与鉴权告警标签修正（implementation）

> 交付日期：2026-11-22
> 分支：`task/AF-292-render-round-denominator`（自 `integrate` 2b8a1cf6）
> 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-292/task-sheet.md`
> 来源：AF-288-REVIEW 只读评审 P0-1（轮次分母漏记）与 P0-3（鉴权告警标签丢失）；P0-2 冷却延长判定已在 AF-289 修复
> 性质：可观测性口径修正 + 告警静态守卫

## 1. 落地

一句话：把“降级率/回退率”的分母从候选尝试数换成整轮终局数，让无候选可用、guard 提前降级、取消这些轮次也进入分母；同时把鉴权告警从裸 `sum` 改成 `by (candidate)`，并加一条机械守卫，防止 annotation 引用不存在的标签。

| 文件 | 改动 |
| --- | --- |
| `src/engine-adapters/rendering/render-telemetry.port.ts` | 新增 `RenderRoundOutcome = 'success' \| 'degrade' \| 'guard' \| 'exhausted' \| 'cancelled'` 与可选 `onRoundOutcome` |
| `src/engine-adapters/rendering/llm-render.adapter.ts` | `render()` / `streamRender()` 每个终局恰好上报一次；`degrade()` / `degradeOutcome()` 内统一上报；导出 `toRoundOutcome` 供单测 |
| `src/engine-adapters/rendering/render-metrics.telemetry.ts` | `onRoundOutcome` 映射到 `incVisitorRenderRound` |
| `src/shared/infra/metrics/metrics.service.ts` | 新增 `Counter visitor_render_rounds_total{outcome}` 与 `incVisitorRenderRound` |
| `docker/prometheus/alerts.yml` | 降级率/回退率分母改 `visitor_render_rounds_total`；降级分子排除 `cause="guard"`；`VisitorRenderAuthFailure` 改 `by (candidate)`；文件头口径注释同步 |
| `docker/grafana/dashboards/mofang-overview.json` | 新增 id 18「来访者渲染: 轮次结局 (10m)」，表达式 `sum(increase(visitor_render_rounds_total[10m])) by (outcome)`；渲染面板 8→9，总面板 16 |
| `docs/runbooks/render-telemetry-alerting.md` | 指标表新增 `rounds_total`；口径红线改 rounds 分母与 guard 排除；PromQL 增轮次结局与回退率分母；面板清单加第 9 块；盲区补“rounds 不区分轮内尝试数、cancelled 进分母不进降级分子” |
| `test/engine-adapters/af292-render-round-outcome.spec.ts` | 5 例：聚合 success、两候选 429→exhausted 只记一次、流式 precheck guard→guard、空上下文→degrade、`toRoundOutcome` 含 cancelled |
| `test/shared/infra/metrics/render-telemetry-metrics.spec.ts` | 升级到 12 类指标，新增 rounds 样本断言；no-op 与“实现抛错被吞”也校验 rounds |
| `test/config/af283-render-alerting.spec.ts` | 逐行解析 alert block，机械校验每个 `$labels.X` 必须出现在 expr 的 `by(...)`；rounds 加入必检清单；面板关键词与分母/guard 断言改 AF-292 口径 |

### 关键设计决策

- **终局上报点收敛在 `degrade()` / `degradeOutcome()`**：流式提前 empty/guard、候选耗尽、异常兜底都走同一出口，避免主流程每加一条 return 就漏一次计数。`streamViaAggregate` 复用 `render()`，不会重复计入。
- **success 在成功返回前上报**：只有拿到可用文本才算 success；429 后回退成功仍记 success，回退次数由 `fallback_total` 单独表达，两个口径不混。
- **`toRoundOutcome` 导出**：把“failure cause → 轮次结局”的映射变成可直接断言的纯函数，防止将来新增 cause 时默认落错桶。
- **告警守卫改为结构化解析**：不再用动态正则拼标签名，避免 super-linear 与转义坑；按 `- alert:` 逐行切块，再从 `expr:` 到 `labels:` 取表达式文本，解析 `by(...)` 标签集合做集合校验。

## 2. 证据

### 闸门

| 命令 | exit | 结果 | 备注 |
| --- | --- | --- | --- |
| `pnpm exec vitest run test/engine-adapters/af292-render-round-outcome.spec.ts test/config/af283-render-alerting.spec.ts test/shared/infra/metrics/render-telemetry-metrics.spec.ts` | 0 | 3 files / 15 tests passed，763ms | 日志 `data/af292-target2.log` |
| `pnpm typecheck` | 0 | 0 error | 日志 `data/af292-typecheck.log` |
| 定向 `pnpm exec eslint <本单 7 个 ts 文件>` | 0 | 0 error / 0 warning | 日志 `data/af292-eslint3.log` |
| `pnpm lint`（全量） | 1 | 5 error / 4 warning，全部在未跟踪 AF-280/AF-281 半成品（`src/shared/realism/visitor-prompt-variants.ts`、`test/agent/visitor/af280-visitor-prompt-variant.spec.ts`、`test/engine-adapters/af280-render-prompt-variant.spec.ts`） | 本单文件 0；日志 `data/af292-lint-full.log` |
| `pnpm test`（全量） | 1 | 277 passed / 1 failed files（1 skipped）；4345 passed / 4 failed / 4 skipped tests；23.66s | 4 failed 全在未跟踪 `af280-render-prompt-variant.spec.ts`（缺 `visitorPromptVariant()` 方法）；日志 `data/af292-test-full.log` |
| `git diff --stat HEAD -- src/engine-core` | 0 | 空 | 内核零改动 |

### 真实 smoke 取证

**成功路径（2 轮，`--provider doubao --caller router --turns 2 --dump-render-metrics`）**

- `ok=true`，2/2 `finishReason=stop`，`fallbackUsed=false`，`degraded=false`。
- `visitor_render_rounds_total{outcome="success"} = 2`，与轮次数严格一致。
- `visitor_render_attempts_total{candidate="doubao",outcome="success"} = 2`。
- TTFT：753ms / 925ms；prompt 745→771。
- 日志 `data/af292-smoke-success.log`。

**主候选 429 回退路径（3 轮，`--fail-primary --fail-primary-mode rate-limit --expect-fallback --turns 3 --dump-render-metrics`）**

- `ok=true`，3/3 `finishReason=stop`，`fallbackUsed=true`，`degraded=false`。
- `visitor_render_rounds_total{outcome="success"} = 3`：回退成功仍是成功轮次，分母按“轮”计而不是按“候选尝试”计。
- `visitor_render_failure_total{candidate="doubao",cause="rate-limit"} = 3`。
- `visitor_render_fallback_total{from="doubao",to="minimax",cause="rate-limit"} = 3`；按新口径回退率 = 3/3 = 100%。
- `visitor_render_candidate_cooldown_seconds{candidate="doubao",cause="rate-limit"}_count = 1`，`sum = 60`（60s 上限）。
- `visitor_render_candidate_cooldown_until_seconds{candidate="doubao"} = 1795338962.792`，观测时刻 `1795338904.026`，剩余约 58.8s。
- `visitor_render_cooldown_served_total = 0`：minimax 兜底成功，没有全损轮次。
- 日志 `data/af292-smoke-fallback.log`。

### 未覆盖项与说明

- **真实 exhausted 轮次未单独 smoke**：现有 `bin/visitor-render-smoke.ts` 只能注入主候选故障，备份候选仍可用，因此真实链路只能产出 success；`exhausted` 与“无候选可用”路径由 `af292-render-round-outcome.spec.ts` 用双候选 429 单测覆盖。要真实复现需要能同时断开两个候选，属 P1-4「并发 + 主候选故障」同族能力，另单处理。
- **告警窗口与硬回滚线未动**：评审 P1 的突发计数器 `for: 5m`、Runbook 硬回滚线 #1、`health()` 动作、多实例语义仍按任务单“不调整告警阈值”保留，未在本单扩大范围。

## 3. 偏差与遗留

- 任务单 `scope.files` 列了 `bin/visitor-render-smoke.ts`，实际无需改动：`--dump-render-metrics` 已在 AF-289 落地，新指标自动进入导出。已在记录中说明，不额外改文件。
- P0-2 的“半开探测失败计数”仍未实现；AF-289 只修了“冷却是否延长”的判定。
- 遗留 backlog：`visitor-render-rounds-denominator`、`visitor-render-auth-alert-empty-label` 本单完成后可关闭；`visitor-concurrency-above-8-unknown`、`visitor-candidate-cooldown-alert-calibration`、`visitor-aggregate-path-telemetry` 等保持原状。

## 4. 提交

`fix(AF-292): 渲染轮次分母与鉴权告警标签修正`
