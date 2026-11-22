# AF-294 · smoke 双候选故障注入与 exhausted 真实取证（implementation）

> 交付日期：2026-11-22
> 分支：`task/AF-294-smoke-fail-backup`（自 `integrate` b8e6d617）
> 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-294/task-sheet.md`
> 来源：AF-292 交付记录遗留项 `visitor-render-smoke-no-backup-fault`
> 性质：测试工具补口 + 真实故障链路取证

## 1. 落地

一句话：给渲染 smoke 增加“备候选也故障”的注入能力，第一次在真实 HTTP 链路上制造两候选同时 429 的 `exhausted` 轮次，并用指标证明轮次分母能把它收进去。

| 文件 | 改动 |
| --- | --- |
| `bin/visitor-render-smoke.ts` | 新增 `--fail-backup`、`--expect-exhausted`；`FaultFlags` 扩为 failPrimary/failBackup/mode/expectFallback/expectDegraded/expectExhausted；备候选探针写入 `backupProbe`；主备候选按各自故障开关分别指向本机故障上游 |
| `docs/runbooks/render-telemetry-alerting.md` | 盲区新增：`fallback_total` 是切换尝试而不是回退成功；补充 exhausted 的真实 smoke 命令 |

### 关键设计决策

- **故障上游复用同一条本机 HTTP server**：`--fail-primary --fail-backup` 同时把 doubao 与 minimax 的 baseUrl 指到同一个临时端口；不写 `.env`，不消耗真实额度。
- **组合校验 fail fast**：`--fail-backup` 必须与 `--fail-primary` 同用；`--expect-exhausted` 与 fallback/degraded 三者互斥；`midstream-stall` 明确拒绝 exhausted（首包后停摆不会切候选）。
- **`backupProbe` 只作旁证**：真实终局证据仍由轮次与指标给出；探针证明备候选确实被指向故障上游，不替代 `rounds_total`。
- **抽出 `assertFaultScope` / `assertBackupExpectation`**：组合校验分支密集，独立成函数把 cognitive complexity 从 27 压到阈值内，同时保持每条错误信息可读。

## 2. 证据

### 闸门

| 命令 | exit | 结果 | 备注 |
| --- | --- | --- | --- |
| `pnpm typecheck` | 0 | 0 error | 日志 `data/af294-typecheck2.log` |
| 定向 `pnpm exec eslint bin/visitor-render-smoke.ts` | 0 | 0 error / 0 warning | 日志 `data/af294-eslint3.log` |
| `pnpm exec tsx bin/visitor-render-smoke.ts --provider doubao --caller router --fail-primary --fail-backup --fail-primary-mode rate-limit --expect-exhausted --turns 1 --dump-render-metrics` | 0 | ok=true；`rounds{exhausted}=1`；两候选 failure 各 1；`degraded{exhausted}=1` | 日志 `data/af294-smoke-exhausted2.log` |
| `pnpm exec tsx bin/visitor-render-smoke.ts --provider doubao --caller router --fail-primary --fail-primary-mode rate-limit --expect-fallback --turns 1 --dump-render-metrics` | 0 | ok=true；providerHint=minimax；`rounds{success}=1`；degraded 空 | 回归；日志 `data/af294-smoke-fallback2.log` |
| `pnpm lint`（全量） | 1 | 5 error / 4 warning，全部在未跟踪 AF-280/AF-281 半成品 | 本单文件 0；日志 `data/af294-lint-full.log` |
| `pnpm test`（全量） | 1 | 277 passed / 1 failed files（1 skipped）；4345 passed / 4 failed / 4 skipped tests；25.81s | 4 failed 全在未跟踪 `af280-render-prompt-variant.spec.ts`；日志 `data/af294-test-full.log` |
| `git diff --stat HEAD -- src/engine-core` | 0 | 空 | 内核零改动 |

### exhausted 真实 smoke 指标

- 场景：doubao 与 minimax 同时指向本机 429 上游；单轮、`--expect-exhausted`。
- 结果：`ok=true`，`providerHint=degraded`，`fallbackUsed=true`，返回系统兜底句“我先缓一下，我们接着说。”，`chars=14`，`wallElapsedMs=22`。
- 探针：`primaryProbe` 429（62ms），`backupProbe` 429（8ms）。
- `visitor_render_rounds_total{outcome="exhausted"} = 1`，整轮只记一次。
- `visitor_render_failure_total{candidate="doubao",cause="rate-limit"} = 1`。
- `visitor_render_failure_total{candidate="minimax",cause="rate-limit"} = 1`。
- `visitor_render_fallback_total{from="doubao",to="minimax",cause="rate-limit"} = 1`。
- `visitor_render_degraded_total{cause="exhausted"} = 1`。
- `visitor_render_cooldown_served_total = 0`；`failureThreshold=3` 未触发熔断，说明这一轮是“候选真的试完败”，不是熔断挡掉。

### 真实全损（冷却后继续请求）指标

- 场景：同一进程内 `--turns 4`，doubao 与 minimax 同时 429；前 3 轮把两候选失败计数推到阈值 3 并进入 60s 冷却，第 4 轮在两者都未到半开时点时直接无候选可用。
- 前 3 轮：`attempts{outcome="retry"}` 两候选各 3；`failure{rate-limit}` 两候选各 3；`candidate_cooldown_seconds` 两候选各 `_count=1`、`sum=60`。
- 第 4 轮：`elapsedMs=0`、`deltas=0`，没有发起任何候选请求；`rounds{exhausted}` 累计 4；`degraded{exhausted}` 累计 4。
- `visitor_render_cooldown_served_total = 2`，`candidate_cooldown_until_seconds` 两候选均约剩 59.97s。
- 这组证据第一次在真实链路把 AF-286 的“全员冷却全损”与 AF-292 的 `rounds{exhausted}` 同框验证。日志 `data/af294-smoke-allcooldown.log`。

> 口径发现：`cooldown_served_total=2` 而第 4 轮只有 1 个无候选轮次。原因是 `RenderFailoverRuntime.next()` 在“本轮已试完所有候选、再次 next 仍无候选”时也会自增；第 3 轮收尾已经贡献一次，第 4 轮再贡献一次。因此它统计的是“无候选的 next() 次数”，不是严格的“整轮全损次数”。已登记 backlog `visitor-cooldown-served-per-round`。

### 回归 smoke 指标

- 主候选 429，备候选真实调用成功：providerHint=minimax，model=MiniMax-M3，finishReason=stop，TTFT=1647ms，wall=2091ms。
- `rounds{success}=1`；`failure{doubao,rate-limit}=1`；`fallback_total=1`；`degraded_total` 空。

## 3. 偏差与遗留

- **任务单验收口径写的是 `fallback_total` 为空，实际为 1**：`fallback_total` 记的是“主备切换尝试”，不是“回退后成功拿到回复”。exhausted 轮次必然先发生一次 doubao→minimax 切换，再由 minimax 失败收尾。正确判据应是 `rounds{exhausted}=1` 且 `degraded{exhausted}=1`；已在 Runbook 盲区写明，避免把回退率 100% 误读成“回退成功”。
- 真实 smoke 的 429 故障上游是本机临时 HTTP server，不是外部供应商的真实限流；它验证的是适配器与指标口径，不验证供应商侧 SLA。
- 鉴权 / 5xx / 超时 / 首包后停摆与 exhausted 的组合仍由既有单测和 AF-274 单候选 smoke 覆盖；本单未逐一复跑所有故障模式。
- 遗留 backlog：`visitor-fallback-rate-attempt-vs-success`（回退率分子是尝试数，exhausted 轮也会计入，是否需要拆出“成功回退率”另议）、`visitor-cooldown-served-per-round`（`cooldown_served_total` 按无候选 next() 次数而非整轮计数，全损轮可能 >1）。

## 4. 提交

`feat(AF-294): smoke 双候选故障注入与 exhausted 真实取证`
