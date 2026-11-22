# 来访者渲染遥测告警与灰度判读 Runbook

适用版本：AF-278 指标接入、AF-282 语义修正、AF-283 告警规则与看板、AF-286 熔断全损可观测、AF-287 候选级熔断归因、AF-289 冷却当前态、AF-292 轮次分母与鉴权标签修正之后。
适用范围：`visitor_render_*` 指标（主候选 `doubao-seed-character-260628`，备候选 MiniMax）。

---

## 1. 先看结论：哪些数能当判据，哪些不能

| 指标 | 能回答什么 | 不能回答什么 |
| --- | --- | --- |
| `visitor_render_attempts_total{outcome}` | 候选尝试次数与终局（success/retry/degrade） | 单候选/末次候选具体错因（看 `failure_total`） |
| `visitor_render_rounds_total{outcome}` | **整轮终局**（success/degrade/guard/exhausted/cancelled），每个 render/streamRender 恰好 +1 | 轮内试了几个候选（看 `attempts_total`） |
| `visitor_render_failure_total{cause}` | **候选级**真实失败原因 | 轮次是否最终降级（看 `degraded_total`） |
| `visitor_render_degraded_total{cause}` | 轮次最终降级；`exhausted`=候选耗尽 | 具体是"试完败"还是"熔断挡掉"，看 `cooldown_served_total` |
| `visitor_render_cooldown_served_total` | 整轮无候选可用（全员冷却且未到半开时点）的全损轮次 | 半开探测可用时不算；不是单候选熔断次数 |
| `visitor_render_candidate_cooldown_seconds{candidate,model,cause}` | 候选**新进入冷却或冷却被延长**的生效时长分布；`_count`=进入冷却次数 | 当前是否仍在冷却、剩余多久看下一个 gauge |
| `visitor_render_candidate_cooldown_until_seconds{candidate,model}` | 候选当前冷却到期 Unix 秒；0=已恢复/不在冷却 | 用 `值 - time() > 0` 判“此刻仍在冷却”；绝对值随时间自然失效，不依赖后台清零 |
| `visitor_render_cancelled_total` | barge-in / 暂停 | **不是故障**，不进降级分子；但进统一轮次分母 `rounds{cancelled}` |
| `visitor_render_fallback_total{from,to,cause}` | 真的切到了下一个候选 | 候选耗尽时没有 to，不会产生假标签 |
| `visitor_render_first_delta_seconds` | raw chunk 首包预算的分布（P95 用分位） | 首个**可见闭合句**的 TTFT（同名不同义，已知 backlog） |
| `visitor_render_auth_failure_total` | 401/403 | 配额耗尽/限流（看 `failure{cause=rate-limit}`） |

**口径红线（AF-292 / AF-298 之后）**

- 三条比率各司其职，不要再合成一个“降级率”：
  - **provider 降级率**：分子 `degraded_total{cause!="guard"}`，分母 `rounds{outcome=~"success|degrade|exhausted"}`（排除 cancelled 与 guard）。这是灰度判据与 `VisitorRenderDegradedRateHigh` 用的口径。
  - **体验失败率**：分子全量 `degraded_total`（含 guard），分母 `rounds{outcome!="cancelled"}`。给产品/体验判断“用户该听到却没听到”的比例。
  - **取消占比**：分子 `cancelled_total`，分母 `rounds_total`。只描述 barge-in/暂停在全部交互中的占比，不参与 provider 健康度判读。
- 比率分母绝不用 `attempts`：`attempts` 会随重试膨胀；“全员冷却直接返回”不产生任何尝试，用 `attempts` 做分母会让最该报警的全损轮次反而进不了分母。
- provider 降级分子排除 `cause="guard"`：守卫命中是正确拦截，不指向 provider；guard 由体验失败率与 `rounds{guard}` 单独承载。
- barge-in 高频是**正常语音交互**。provider 降级率与回退率的分母已排除 `rounds{cancelled}`，25% barge-in 不再把 4% 真实降级稀释成 3.0%；取消只进“取消占比”，绝不作为回滚依据。
- `degraded_total{cause=exhausted}` 表示“这一轮没有可用候选”；先对照 `cooldown_served_total`：同步上涨=熔断挡掉，没涨=候选真的试完败。单次失败的 429、5xx、超时还是 guard，一律去 `failure_total{cause}` 看。
- **恒等式**：每个降级轮次恰好调一次 `onDegraded`，所以 `degraded_total` 的增量必须等于 `rounds{outcome=~"degrade|guard|exhausted"}` 的增量。两者不等时先查是否重复/漏记轮次，而不是先调阈值。

---

## 2. 告警清单与第一动作

| 告警 | 触发条件（初版） | 级别 | 第一动作 |
| --- | --- | --- | --- |
| `VisitorRenderAuthFailure` | 5m 内单 candidate auth 失败 >0（按 candidate 聚合） | critical | 立即查该候选 provider key / 配额 / 账号状态；任一候选鉴权坏掉就不放量 |
| `VisitorRenderDegradedRateHigh` | 10m provider 降级率 >3%（分母排除 cancelled/guard） | warning | 看 `degraded_total` 的 cause 与 `failure_total` cause 分布；区分上游故障 vs guard |
| `VisitorRenderRoundInvariantMismatch` | 10m `degraded_total` 增量 > 对应 `rounds` 增量 | warning | 先查重复/漏记轮次（AF-297 的 sink、degrade 路径），不要先调阈值；对照看板 id 18 outcome 分布 |
| `VisitorRenderFirstDeltaSlow` | 10m 首包 P95 >2s | warning | 查上游冷启动、模型档位、网络；对比 AF-277 回滚态基线 |
| `VisitorRenderStreamTimeoutSpike` | 10m 超时 >5（按 phase），且最近 1m 同 phase 仍有超时 | warning | `first-delta` 看建流/冷启动；`idle` 看上游断流与网关空闲超时 |
| `VisitorRenderFallbackRateHigh` | 10m 回退率 >10% | warning | 看 `fallback{cause}` 与主候选 `failure`；主候选是否持续限流/5xx |
| `VisitorRenderFailureCauseSpike` | 10m 单 cause >10，且最近 1m 同 cause 仍有失败 | warning | 按 cause 走 §3 处置表 |
| `VisitorRenderCooldownServedSpike` | 10m 全损 >3 轮，且最近 1m 仍有全损 | warning | 看 `health()` 快照与冷却时长；确认是持续故障还是退避后自愈，再决定人工回滚 |
| `VisitorRenderCandidateCooldownSpike` | 10m 单候选单 cause 进冷却 >5 次，且最近 1m 同 candidate+cause 仍进冷却 | warning | 看候选熔断次数与 P95 时长；区分“同一候选反复进退冷却”与“多候选轮换故障” |

阈值是**灰度初版**，不是 SLA：AF-268/AF-277/AF-278 实测 TTFT 0.5–1.3s、回滚态 0.6–5.0s，生产样本足够后按 P95/P99 重新校准。改阈值只改 `docker/prometheus/alerts.yml`，同步更新本节。

**生命周期分窗（AF-301）**：四条 Spike 规则用“10m 判强度 + 1m 判是否仍在发生”的 `and` 组合。故障停止后，最近 1m 没有新事件，表达式转为 false，告警不再被 10m 旧样本拖着继续 firing；`for: 5m` 仍会让它在**开始**阶段滞后 5 分钟，这是有意的防抖。`VisitorRenderAuthFailure` 不加快期条件：任一次 401 都说明配置坏了，低流量时也不能自动消警。

取舍：极低流量（每分钟不足一轮）时，1m 条件可能读到 0，Spike 告警不触发；这类场景先看 `failure_total` 原始计数，不依赖 Spike 频率告警。

> 部署现状：`prometheus.yml` 已加载 `alerts.yml`，Prometheus UI 的 Alerts 页可见；**通知外发需要 Alertmanager**，当前 compose 未启用（见 `prometheus.yml` 注释）。没有 Alertmanager 时，“可告警”= 规则会 firing + Grafana 可查，不等于会发钉钉/短信。

---

## 3. cause → 处置表

| cause | 典型来源 | 处置 |
| --- | --- | --- |
| `auth` | 401/403、key 失效、账号停用 | **最高优先级**；换 key / 恢复账号；不要靠切备掩盖 |
| `rate-limit` | 429、QPS/TPM 超限 | 降并发或降档；确认备候选可用；持续 >10/10m 暂停放量 |
| `server` | 5xx、网关错误 | 查上游状态页；备候选承接；持续则回滚 |
| `network` | 连接拒绝/重置、DNS 失败、socket hang up | 查本机出网、代理、DNS 与 TLS；与上游 5xx 分开处置；不要先怀疑模型 |
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
| S1 小流量 | 5% 会话 | 30m 内 auth=0；provider 降级率 ≤2%；首包 P95 ≤2s；回退率 ≤5% | provider 降级率 >3% 持续 10m，或 auth 任一 |
| S2 半量 | 25% 会话 | 60m 内 provider 降级率 ≤3%；首包 P95 ≤2s；failure 单 cause ≤5/10m | provider 降级率 >5% 持续 10m；首包 P95 >3s 持续 15m |
| S3 全量 | 100% | 24h 内 provider 降级率 ≤3%；无 auth；无持续 5xx/429 尖峰 | provider 降级率 >5% 持续 10m；auth 任一；上游 5xx 连续 3 个 5m 窗口 |

**窗口纪律**：表中的 “30m/60m/24h” 必须用对应窗口自己算（例如 `increase(visitor_render_degraded_total{cause!="guard"}[30m]) / clamp_min(increase(visitor_render_rounds_total{outcome=~"success|degrade|exhausted"}[30m]), 0.001)`），**不要直接读 10m 告警面板的值当 30m 判据**。告警的 `increase[10m] + for:10m` 本身有 5–10 分钟结构性滞后，只用于触发观察，不是阶段放行数字。

**硬回滚线（不看阶段，触发即回滚）**

1. `increase(visitor_render_auth_failure_total[5m]) > 0`：鉴权坏了，继续放量只会全量降级。
2. `provider_degraded_rate > 5%` 持续 10 分钟：说明备候选也接不住。
3. 首包 P95 >3s 持续 15 分钟：语音对练体验已经不可用。
4. 同一 cause 的 `failure_total` >20/10m 且备候选成功率 <90%：上游系统性故障。

> 单次 401 即回滚（第 1 条）是当前保守口径；AF-275 已支持鉴权失败切备，若 key 轮换期出现瞬时 401，可先确认备候选接管。按 ≥2 次/5m 校准属于 backlog `visitor-auth-rollback-threshold`。

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
# provider 降级率（分母排除 cancelled/guard）
sum(increase(visitor_render_degraded_total{cause!="guard"}[10m]))
/
clamp_min(sum(increase(visitor_render_rounds_total{outcome=~"success|degrade|exhausted"}[10m])), 0.001)

# 体验失败率（分子含 guard，分母排除 cancelled）
sum(increase(visitor_render_degraded_total[10m]))
/
clamp_min(sum(increase(visitor_render_rounds_total{outcome!="cancelled"}[10m])), 0.001)

# 轮次恒等式对账（两边应相等；degraded 多出即重复/漏记）
sum(increase(visitor_render_degraded_total[10m]))
unless
sum(increase(visitor_render_rounds_total{outcome=~"degrade|guard|exhausted"}[10m]))

# 轮次结局分布（success/degrade/guard/exhausted/cancelled）
sum(increase(visitor_render_rounds_total[10m])) by (outcome)

# 回退率（分母排除 cancelled/guard，分子是主备切换事件）
sum(increase(visitor_render_fallback_total[10m]))
/
clamp_min(sum(increase(visitor_render_rounds_total{outcome=~"success|degrade|exhausted"}[10m])), 0.001)

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

### 5.1 故障矩阵真实回放（AF-299）

下表每条命令都在本机起临时故障上游，不消耗真实模型额度；`--dump-render-metrics` 打出的是**本轮进程内**计数增量，不是线上累计值。判读时先认 `rounds` 结局，再对 `failure`/`degraded` 的 cause，最后看候选级计数器。

| 故障形态 | 命令（在 `--provider doubao --caller router --turns 1` 基础上追加） | 关键期望指标 | 已知口径差异 |
| --- | --- | --- | --- |
| 双候选 5xx | `--fail-primary --fail-backup --fail-primary-mode server-error --expect-exhausted` | `rounds{exhausted}=1`、`degraded{exhausted}=1`、两候选 `attempts{retry}=1`、两候选 `failure{server}=1`、`fallback{from=doubao,to=minimax,cause=server}=1`、`cooldown_served_total=0` | 无 |
| 双候选首包超时 | `--fail-primary --fail-backup --fail-primary-mode timeout --expect-exhausted` | `rounds{exhausted}=1`、`degraded{exhausted}=1`、两候选 `stream_timeout{phase=first-delta}=1`、两候选 `failure{first-delta}=1`、`fallback{cause=first-delta}=1`、wall ≈ 16s（8s×2 候选） | cause 记成 `first-delta` 而非 `timeout`：流式路径先触发首包预算；`failure{timeout}` 在这条路径上不会出现 |
| 双候选 401 | `--fail-primary --fail-backup --fail-primary-mode auth --expect-exhausted` | `rounds{exhausted}=1`、`degraded{exhausted}=1`、两候选 `auth_failure_total=1`、两候选 `failure{auth}=1`、`fallback{cause=auth}=1` | 无 |
| 双候选连接失败 | `--fail-primary --fail-backup --fail-primary-mode network --expect-exhausted` | `rounds{exhausted}=1`、`degraded{exhausted}=1`、两候选 `failure{network}=1`、`fallback{cause=network}=1`、`auth_failure`/`stream_timeout` 空 | 连接层错误独立归 `network`（AF-300）；与 `timeout` 分开：连接没建立/被断开才是 network，连接已建立但等不到响应是 timeout |
| 单候选首包后停摆 | `--fail-primary --fail-primary-mode midstream-stall --expect-degraded` | `rounds{degrade}=1`、`degraded{idle}=1`、`stream_timeout{phase=idle}=1`、`failure{idle}=1`、`attempts{degrade}=1`、`fallback_total` 空、wall ≈ 30s（idle 预算） | 已有首包（TTFT ≈ 53ms，`first_delta_seconds_count=1`）；不走候选切换，直接收尾降级 |
| 主候选 5xx → 备候选成功 | `--fail-primary --fail-primary-mode server-error --expect-fallback` | `rounds{success}=1`、`attempts{doubao,retry}=1`、`attempts{minimax,success}=1`、`failure{doubao,server}=1`、`fallback{from=doubao,to=minimax,cause=server}=1`、`degraded_total=0`、`cooldown_served_total=0`、wall ≈ 2s | 健康路径：用户仍拿到完整内容（实测 31 字）；`degraded_total` 不注册该标签即视为 0，不要误判为「指标丢了」 |

回放记录归档在 `data/af299-{server-error,timeout,auth,network,midstream}.log`；`eval` 只看 `ok=true` 不够，必须核对上表至少两条相互独立的指标（例如 `rounds` 结局 + `failure` cause），避免单一指标误判。

### 5.2 一键自证（AF-302 / AF-303）

上表已经固化成验收器（AF-303 补入「主候选失败→备候选成功」的健康路径），一条命令跑完六条场景并自动判定：

```powershell
pnpm exec tsx bin/visitor-render-acceptance.ts
pnpm exec tsx bin/visitor-render-acceptance.ts --only double-auth
pnpm exec tsx bin/visitor-render-acceptance.ts --keep-going
```

判读纪律：

- 每条场景先要求 smoke 退出码 0、报告 `ok=true`，再逐条比对指标；任一不符打印「期望 X=值，实际 Y」并使进程退出码为 1，可直接接 CI 或发布前门禁。
- `--only <id,id>` 只跑子集（id 见输出首列：`double-server` / `double-timeout` / `double-auth` / `double-network` / `single-midstream` / `single-fallback`）；未知 id 直接报错。
- 默认遇错即停；`--keep-going` 跑完全部再汇总，适合排障时一次看全貌。
- 指标仍是**本轮进程内增量**（`--dump-render-metrics` 的 JSON 报告），不是线上累计值；不要拿它和 Prometheus 的 `increase()` 结果做等值比较。
- 单场景耗时：5 条秒级（含回退成功约 2s），首包超时约 16s，首包后停摆约 30s；全跑约 50–60s，不含进程启动。

---

## 6. 看板

`docker/grafana/dashboards/mofang-overview.json` 新增九块：

1. 来访者渲染：provider 降级率 / 体验失败率 / 取消占比（三条线分开：前两条决定健康度与体验，取消只描述 barge-in 形态）；
2. 来访者渲染：首包 P95（first-delta）；
3. 来访者渲染：候选级失败原因（按 cause 堆叠）；
4. 来访者渲染：候选回退率。
5. 来访者渲染：熔断全损（10m）。
6. 来访者渲染：候选熔断次数（10m，按 candidate/cause）。
7. 来访者渲染：候选熔断时长 P95（10m，按 candidate）。
8. 来访者渲染：候选冷却剩余（实时，按 candidate；`until - time()` clamp 到 0）。
9. 来访者渲染：轮次结局（10m，按 outcome；provider 降级率/回退率的分母来源）。

看板刷新 30s；Grafana 通过 `docker/grafana/provisioning/dashboards/dashboards.yml` 自动加载。

---

## 7. 已知盲区（不要用本 Runbook 过度解读）

- `cooldown_served_total` 只回答“这一轮是不是全员冷却导致无候选可用”；“哪个候选被熔断、熔了多久”看 `candidate_cooldown_seconds`（AF-287），“此刻是否仍在冷却、还剩多久”看 `candidate_cooldown_until_seconds`（AF-289）。三者都是进程内状态，多实例部署时需按实例分别观察；gauge 是最后一次状态变化时写入的绝对到期时刻，若候选在恢复后长时间没有新请求，面板最多显示为 0（`until - time()` 为负被 clamp），不会伪报仍在冷却。
- `rounds_total` 是“轮次终局”的唯一分母；它不区分轮内试了几个候选。排查单候选坏掉要看 `attempts_total`/`failure_total`。provider 降级率/回退率分母已排除 `cancelled`，取消只出现在“取消占比”；体验失败率分母仅排除 `cancelled`、分子含 guard。
- `degraded{exhausted}` 与 `cooldown_served_total` 时间窗不完全对齐：前者是轮次终局，后者在 `next()` 时自增；同一轮两者都应出现，短暂错位属正常。
- `fallback_total` 统计的是**主备切换尝试**，不是“回退成功”。两候选同时 429 时仍会先发生一次 doubao→minimax 切换，随后 minimax 也失败，轮次终局是 `rounds{exhausted}`、`degraded{exhausted}` 各 1；因此回退率 100% 不代表用户拿到了可用回复，必须与 `rounds` 结局一起读。
- 比率类告警全部是 `increase(...[10m])` + `for: 5–10m`，存在 5–10 分钟**结构性滞后**：故障发生后最快也要等窗口累积，再过 `for` 时长才 firing。它不是秒级探针，不能用“刚出问题但告警没响”反推系统正常；看板 30s 刷新也不等于告警实时。突发故障先看 `failure_total` 与 `rounds` 的即时增量，告警用于确认持续性。
- 四条 Spike 类告警（stream timeout / failure cause / cooldown served / candidate cooldown）已加最近 1m 持续条件：故障停止后最多 1 分钟就会转 false，不再被 10m 旧样本拖着继续 firing；但开始时仍受 `for: 5m` 约束。`VisitorRenderAuthFailure` 故意不加快期条件，避免低流量时自动消警掩盖坏 key。
- `cancelled` 只进“取消占比”的分母，不参与 provider 降级率/回退率的分母：取消既不进降级/回退分子，也不进它们的分母。AF-298 之前 barge-in 会稀释降级率（25% 取消时 4% 真实降级显示为 3.0%），现在不会；如果看到降级率与体验失败率不一致，先看 guard 占比（体验失败率含 guard）。
- `rounds{exhausted}` 已可用真实 smoke 复现：`--fail-primary --fail-backup --fail-primary-mode rate-limit --expect-exhausted --turns 1 --dump-render-metrics`，两候选同时指向本机临时 429 上游，不消耗真实额度。
- `visitor_render_first_delta_seconds` 量 raw chunk，TTFT 量首个可见闭合句；纯推理流可能零信号（backlog `visitor-first-delta-vs-ttft-semantics`）。
- 聚合路径（调用出口不支持流式）没有 first-delta / stream_timeout 指标（backlog `visitor-aggregate-path-telemetry`）。
- 当前没有 Alertmanager 外发通道；规则 firing 需人工看 Prometheus / Grafana。
