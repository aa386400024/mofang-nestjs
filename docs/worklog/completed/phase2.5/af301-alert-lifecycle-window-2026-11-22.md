# AF-301 · 突发告警按故障生命周期分窗交付记录

- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-301/task-sheet.md`
- 分支：`task/AF-301-alert-lifecycle-window`
- 基线：`2a00b9ddd4d60021715630c491c281ce3832a61d`（AF-300 合并后的 integrate）
- 状态提交：`9445de40`（登记 + 领单，含任务单/清单）
- 实现提交：本提交
- 日期：2026-11-22

## 1. 结论

AF-292-REVIEW 的 C2 指出：突发计数器用 10m 窗口，故障结束后还会被旧样本拖着继续 firing；AF-298 只在 Runbook 补了“滞后 5–10 分钟”说明，没有从表达式上收口。本单给四条 Spike 告警加“最近 1m 仍有同维度事件”的持续条件，故障停止后最多 1 分钟转 false；`for: 5m` 保留，仍防抖开始阶段。鉴权告警故意不加，避免低流量自动消警掩盖坏 key。

## 2. 改了什么

**`docker/prometheus/alerts.yml`**

- `VisitorRenderStreamTimeoutSpike`：`10m by (phase) > 5 and 1m by (phase) > 0`。
- `VisitorRenderFailureCauseSpike`：`10m by (cause) > 10 and 1m by (cause) > 0`。
- `VisitorRenderCooldownServedSpike`：`10m > 3 and 1m > 0`。
- `VisitorRenderCandidateCooldownSpike`：`10m by (candidate, cause) > 5 and 1m by (candidate, cause) > 0`。
- 注释说明“10m 判强度、1m 判是否仍在发生”；`VisitorRenderAuthFailure` 未改。

**`test/config/af283-render-alerting.spec.ts`**

- 新增“突发 Spike 告警都带 1m 持续条件，鉴权告警不误加”：逐条断言 4 条规则含 10m/`and`/1m 与相同分组维度；Auth 块不含 `[1m]`，仍按 candidate 聚合。
- 反向验证：临时删 FailureCauseSpike 的 1m 两行，定向测试 1 failed / 9 passed，精确报 `expected ... to contain 'and'`；恢复后 10/10 全绿。

**`docs/runbooks/render-telemetry-alerting.md`**

- §2 四条 Spike 触发条件补“且最近 1m 同维度仍有事件”；新增“生命周期分窗（AF-301）”段，说明开始仍受 `for: 5m` 约束、Auth 不加快期条件、极低流量取舍。
- §7 新增一条：Spike 告警停止后最多 1 分钟转 false；Auth 例外。

## 3. 关键设计决策

- **只改 Spike，不改比率与恒等式**：比率类用 `increase[10m]` 表达“窗口内强度”，本来就没有“当前是否仍在发生”的语义；恒等式是自洽校验，不按生命周期收敛。
- **鉴权告警保持单次即报**：401 是配置错误，不是流量现象；低流量 1 分钟无请求时自动消警会掩盖坏 key，因此不加 1m 条件。
- **用 `and` 做同维度集合匹配**：两侧都 `by (phase)` / `by (cause)` / `by (candidate, cause)`，PromQL 按标签集合求交，避免串维度。
- **接受低流量漏报**：每分钟不足一轮时 1m 可能为 0，Spike 不触发；Runbook 明确改用 `failure_total` 原始计数，不为低频场景放宽阈值。

## 4. 闸门数字

| 闸门 | 结果 | 证据 |
| --- | --- | --- |
| `pnpm exec vitest run test/config/af283-render-alerting.spec.ts` | 10 passed / 0 failed（271ms） | `data/af301-target4.log` |
| 反向删 FailureCauseSpike 1m 条件 | 1 failed / 9 passed，精确报缺 `and` | `data/af301-guard-negative.log` |
| YAML 解析 | 15 条规则可解析，含 1m 条件恰为 4 条 Spike | `data/af301-yaml-parse.log` |
| `pnpm typecheck` | exit 0 | `data/af301-typecheck.log` |
| `pnpm lint`（全量） | exit 0 | `data/af301-lint-full.log` |
| `pnpm test`（全量） | 279 passed / 1 skipped files；4365 passed / 4 skipped；0 failed（24.21s） | `data/af301-test-full.log` |
| `git diff --stat HEAD -- src/engine-core` | 空 | 交付前核对 |

过程修正：测试首版用 `expect(block, name)` 传第二参数，`vitest/valid-expect` 拒绝；去掉 message 参数并用 `eslint --fix` 修 Prettier 换行后全绿。该修正只影响测试写法。

## 5. 偏差与边界

- 任务单写“四条 Spike”，实际只给其中四条按次数判定的规则加条件；`VisitorRenderFirstDeltaSlow` 是直方图分位，不属于“次数 Spike”，未改。
- 未改任何阈值、`for` 时长、看板、业务代码；未碰 engine-core。
- 未引入 Alertmanager；规则 firing 仍需人工看 Prometheus/Grafana（既有现状）。

## 6. 遗留 backlog

- `visitor-render-alert-onset-latency`：`for: 5m` 仍使 Spike 开始阶段滞后；若要更快，需要评估短窗口 + 抑制规则，而不是简单降 `for`。
- `visitor-render-low-traffic-spike`：极低流量下 1m 条件可能漏报；需要按实际灰度流量决定是否补“无流量时看原始计数”的前端提示。
- `visitor-render-timeout-cause-naming` 继续保留（AF-299/300 已登记），不在本单处理。

## 7. commit message

`fix(AF-301): 突发告警按故障生命周期分窗`
