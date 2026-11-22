# 来访者渲染遥测告警与灰度判读 Runbook

适用版本：AF-278 指标接入、AF-282 语义修正、AF-283 告警规则与看板、AF-286 熔断全损可观测、AF-287 候选级熔断归因之后。
适用范围：`visitor_render_*` 指标（主候选 `doubao-seed-character-260628`，备候选 MiniMax）。

---

## 1. 先看结论：哪些数能当判据，哪些不能

| 指标 | 能回答什么 | 不能回答什么 |
| --- | --- | --- |
| `visitor_render_attempts_total{outcome}` | 候选尝试次数与终局（success/retry/degrade） | 单候选/末次候选具体错因（看 `failure_total`） |
| `visitor_render_failure_total{cause}` | **候选级**真实失败原因 | 轮次是否最终降级（看 `degraded_total`） |
| `visitor_render_degraded_total{cause}` | 轮次最终降级；`exhausted`=候选耗尽 | 具体是"试完败"还是"熔断挡掉"，看 `cooldown_served_total` |
| `visitor_render_cooldown_served_total` | 整轮无候选可用（全员冷却且未到半开时点）的全损轮次 | 半开探测可用时不算；不是单候选熔断次数 |
| `visitor_render_candidate_cooldown_seconds{candidate,model,cause}` | 候选**新进入冷却或冷却被延长**的生效时长分布；`_count`=进入冷却次数 | 当前是否仍在冷却、剩余多久看下一个 gauge |
| `visitor_render_candidate_cooldown_until_seconds{candidate,model}` | 候选当前冷却到期 Unix 秒；0=已恢复/不在冷却 | 用 `值 - time() > 0` 判“此刻仍在冷却”；绝对值随时间自然失效，不依赖后台清零 |
| `visitor_render_cancelled_total` | barge-in / 暂停 | **不是故障**，不进降级率分子/分母 |
| `visitor_render_fallback_total{from,to,cause}` | 真的切到了下一个候选 | 候选耗尽时没有 to，不会产生假标签 |
| `visitor_render_first_delta_seconds` | raw chunk 首包预算的分布（P95 用分位） | 首个**可见闭合句**的 TTFT（同名不同义，已知 backlog） |
| `visitor_render_auth_failure_total` | 401/403 | 配额耗尽/限流（看 `failure{cause=rate-limit}`） |

**口径红线（AF-282 之后）**

- 降级率分母只用 `attempts{outcome=~"success|degrade"}`（终局轮次），不含 retry，也不含 cancelled。
- barge-in 高频是**正常语音交互**。取消率只做容量/体验观察，绝不作为回滚依据。
- `degraded_total{cause=exhausted}` 表示“这一轮没有可用候选”；先对照 `cooldown_served_total`：同步上涨=熔断挡掉，没涨=候选真的试完败。单次失败的 429、5xx、超时还是 guard，一律去 `failure_total{cause}` 看。

---

## 2. 告警清单与第一动作

| 告警 | 触发条件（初版） | 级别 | 第一动作 |
| --- | --- | --- | --- |
| `VisitorRenderAuthFailure` | 5m 内 auth 失败 >0 | critical | 立即查 provider key / 配额 / 账号状态；任一候选鉴权坏掉就不放量 |
| `VisitorRenderDegradedRateHigh` | 10m 真实降级率 >3% | warning | 看 `degraded_total` 的 cause 与 `failure_total` cause 分布；区分上游故障 vs guard |
| `VisitorRenderFirstDeltaSlow` | 10m 首包 P95 >2s | warning | 查上游冷启动、模型档位、网络；对比 AF-277 回滚态基线 |
| `VisitorRenderStreamTimeoutSpike` | 10m 超时 >5（按 phase） | warning | `first-delta` 看建流/冷启动；`idle` 看上游断流与网关空闲超时 |
| `VisitorRenderFallbackRateHigh` | 10m 回退率 >10% | warning | 看 `fallback{cause}` 与主候选 `failure`；主候选是否持续限流/5xx |
| `VisitorRenderFailureCauseSpike` | 10m 单 cause >10 | warning | 按 cause 走 §3 处置表 |
| `VisitorRenderCooldownServedSpike` | 10m 全损 >3 轮 | warning | 看 `health()` 快照与冷却时长；确认是持续故障还是退避后自愈，再决定人工回滚 |
| `VisitorRenderCandidateCooldownSpike` | 10m 单候选单 cause 进冷却 >5 次 | warning | 看候选熔断次数与 P95 时长；区分“同一候选反复进退冷却”与“多候选轮换故障” |

阈值是**灰度初版**，不是 SLA：AF-268/AF-277/AF-278 实测 TTFT 0.5–1.3s、回滚态 0.6–5.0s，生产样本足够后按 P95/P99 重新校准。改阈值只改 `docker/prometheus/alerts.yml`，同步更新本节。

> 部署现状：`prometheus.yml` 已加载 `alerts.yml`，Prometheus UI 的 Alerts 页可见；**通知外发需要 Alertmanager**，当前 compose 未启用（见 `prometheus.yml` 注释）。没有 Alertmanager 时，“可告警”= 规则会 firing + Grafana 可查，不等于会发钉钉/短信。

---

## 3. cause → 处置表

| cause | 典型来源 | 处置 |
| --- | --- | --- |
| `auth` | 401/403、key 失效、账号停用 | **最高优先级**；换 key / 恢复账号；不要靠切备掩盖 |
| `rate-limit` | 429、QPS/TPM 超限 | 降并发或降档；确认备候选可用；持续 >10/10m 暂停放量 |
| `server` | 5xx、网关错误 | 查上游状态页；备候选承接；持续则回滚 |
| `timeout` | 上游请求超时 | 查网络与上游延迟；区分聚合总超时 / 首包 / idle |
| `first-delta` | 首包预算内无 raw chunk | 冷启动或上游排队；结合 P95 判断 |
| `idle` | 首包后停摆 | 上游断流 / 连接被中间设备掐断 |
| `empty` | 空内容、仅推理块、无可见台词 | 检查模型档位与 prompt；单候选部署会直接降级 |
| `truncated` | `finish_reason=length` 且无完整句 | 检查 `maxCompletionTokens` 与 thinking 预算 |
| `guard` | 输出侧安全拦截 | 看 `onSafetySignal` 日志；**不要为了降级率放过高危文本** |
| `config` | 候选未配置模型 | 配置错误，立即修 env；不是上游问题 |
| `exhausted` | 候选耗尽（轮次级，只在 degraded） | 对照 `cooldown_served_total`：涨=熔断挡掉，不涨=候选试完败；再结合 failure cause 判断根因 |
| `cancelled` | barge-in / 暂停（只在 cancelled） | 正常交互；不处置、不回滚 |

---

## 4. 灰度放量判据

按“影子 → 小流量 → 半量 → 全量”四段走，每段至少观察 30 分钟或 200 轮（取先到者）。

| 阶段 | 放量 | 进入下一阶段的条件 | 停止/回滚条件 |
| --- | --- | --- | --- |
| S0 影子 | 0%（只跑 smoke/离线） | 定向 smoke 3/3 命中豆包，fallback/degraded 均 false | 任一 auth 失败 |
| S1 小流量 | 5% 会话 | 30m 内 auth=0；降级率 ≤2%；首包 P95 ≤2s；回退率 ≤5% | 降级率 >3% 持续 10m，或 auth 任一 |
| S2 半量 | 25% 会话 | 60m 内降级率 ≤3%；首包 P95 ≤2s；failure 单 cause ≤5/10m | 降级率 >5% 持续 10m；首包 P95 >3s 持续 15m |
| S3 全量 | 100% | 24h 内降级率 ≤3%；无 auth；无持续 5xx/429 尖峰 | 降级率 >5% 持续 10m；auth 任一；上游 5xx 连续 3 个 5m 窗口 |

**硬回滚线（不看阶段，触发即回滚）**

1. `increase(visitor_render_auth_failure_total[5m]) > 0`：鉴权坏了，继续放量只会全量降级。
2. `degraded_rate > 5%` 持续 10 分钟：说明备候选也接不住。
3. 首包 P95 >3s 持续 15 分钟：语音对练体验已经不可用。
4. 同一 cause 的 `failure_total` >20/10m 且备候选成功率 <90%：上游系统性故障。

**不是回滚线**：`cancelled_total` 上升（barge-in 变多只说明用户在打断）、单次 `guard`（安全拦截是正确行为）。

---

## 5. 回滚与验证命令

回滚只动来访者主候选开关，不动模型价、prompt、候选链结构：

```powershell
# 1) 回滚主候选到 MiniMax（备候选 doubao 保留）
#    .env 中改一行：VISITOR_LLM_PROVIDER=minimax
# 2) 确认当前真实开关（只读，不发网络）
pnpm exec tsx bin/visitor-switch-check.ts --expect-primary minimax
# 3) 重启 API 进程 / 滚动发布后，跑真实 smoke
pnpm exec tsx bin/visitor-render-smoke.ts --provider minimax --caller router --turns 3
```

恢复豆包：

```powershell
# .env：VISITOR_LLM_PROVIDER=doubao
pnpm exec tsx bin/visitor-switch-check.ts --expect-primary doubao
pnpm exec tsx bin/visitor-render-smoke.ts --provider doubao --caller router --turns 3
```

Prometheus 侧核对（UI 或 API）：

```promql
# 真实降级率（排除 barge-in）
sum(increase(visitor_render_degraded_total[10m]))
/
clamp_min(sum(increase(visitor_render_attempts_total{outcome=~"success|degrade"}[10m])), 0.001)

# 失败原因分布
sum(increase(visitor_render_failure_total[10m])) by (cause)

# 候选熔断次数（谁被熔、因为什么）
sum(increase(visitor_render_candidate_cooldown_seconds_count[10m])) by (candidate, cause)

# 候选熔断时长 P95（熔了多久）
histogram_quantile(0.95, sum(rate(visitor_render_candidate_cooldown_seconds_bucket[10m])) by (le, candidate))

# 候选当前冷剩余（>0 表示此刻仍在冷却；无需定时清零）
max by (candidate) (clamp_min(visitor_render_candidate_cooldown_until_seconds - time(), 0))

# 取消（只观察，不告警）
sum(increase(visitor_render_cancelled_total[10m]))
```

---

## 6. 看板

`docker/grafana/dashboards/mofang-overview.json` 新增八块：

1. 来访者渲染：降级率 / 取消率（两条线分开，避免把 barge-in 读成故障）；
2. 来访者渲染：首包 P95（first-delta）；
3. 来访者渲染：候选级失败原因（按 cause 堆叠）；
4. 来访者渲染：候选回退率。
5. 来访者渲染：熔断全损（10m）。
6. 来访者渲染：候选熔断次数（10m，按 candidate/cause）。
7. 来访者渲染：候选熔断时长 P95（10m，按 candidate）。
8. 来访者渲染：候选冷却剩余（实时，按 candidate；`until - time()` clamp 到 0）。

看板刷新 30s；Grafana 通过 `docker/grafana/provisioning/dashboards/dashboards.yml` 自动加载。

---

## 7. 已知盲区（不要用本 Runbook 过度解读）

- `cooldown_served_total` 只回答“这一轮是不是全员冷却导致无候选可用”；“哪个候选被熔断、熔了多久”看 `candidate_cooldown_seconds`（AF-287），“此刻是否仍在冷却、还剩多久”看 `candidate_cooldown_until_seconds`（AF-289）。三者都是进程内状态，多实例部署时需按实例分别观察；gauge 是最后一次状态变化时写入的绝对到期时刻，若候选在恢复后长时间没有新请求，面板最多显示为 0（`until - time()` 为负被 clamp），不会伪报仍在冷却。
- `degraded{exhausted}` 与 `cooldown_served_total` 时间窗不完全对齐：前者是轮次终局，后者在 `next()` 时自增；同一轮两者都应出现，短暂错位属正常。
- `visitor_render_first_delta_seconds` 量 raw chunk，TTFT 量首个可见闭合句；纯推理流可能零信号（backlog `visitor-first-delta-vs-ttft-semantics`）。
- 聚合路径（调用出口不支持流式）没有 first-delta / stream_timeout 指标（backlog `visitor-aggregate-path-telemetry`）。
- 当前没有 Alertmanager 外发通道；规则 firing 需人工看 Prometheus / Grafana。
