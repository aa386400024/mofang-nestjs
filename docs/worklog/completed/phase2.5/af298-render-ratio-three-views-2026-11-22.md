# AF-298 · 渲染比率三口径自证与轮次恒等式告警交付记录

- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-298/task-sheet.md`
- 分支：`task/AF-298-render-ratio-three-views`
- 基线：`54d71994d2d10763c74c3b1dc58ec7dbe04d09de`（AF-297 合并后的 integrate）
- 状态提交：`994ff212`（登记 + 领单，含任务单/清单）
- 实现提交：本提交
- 日期：2026-11-22

## 1. 改了什么

**`docker/prometheus/alerts.yml`**

- `VisitorRenderDegradedRateHigh` 分母改为 `rounds{outcome=~"success|degrade|exhausted"}`，排除 cancelled 与 guard；注释写清 barge-in 稀释机理（25% 取消时 4% → 3.0%）。
- `VisitorRenderFallbackRateHigh` 同分母，保持 provider 口径一致。
- 新增 `VisitorRenderRoundInvariantMismatch`：`degraded_total` 的 10m 增量 `unless` `rounds{outcome=~"degrade|guard|exhausted"}` 的 10m 增量，`for: 10m`。两侧都无样本时不触发。

**`docker/grafana/dashboards/mofang-overview.json`（id 10）**

- 标题改为“provider 降级率 / 体验失败率 / 取消占比”。
- 三条曲线：
  - A：`degraded{cause!="guard"} / rounds{success|degrade|exhausted}`；
  - B：`degraded（全量，含 guard） / rounds{outcome!="cancelled"}`；
  - C：`cancelled_total / rounds_total`（占全部交互；不采用外审的 non-cancelled 分母，避免 barge-in 多数时比例 >100%）。

**`test/config/af283-render-alerting.spec.ts`**

- `REQUIRED_ALERTS` 增 `VisitorRenderRoundInvariantMismatch`。
- 原“降级率/回退率分母”用例改为精确断言 `outcome=~"success|degrade|exhausted"`，禁止 attempts/cancelled。
- 新增恒等式用例：必须含 `degraded_total[10m]`、corresponding rounds、`unless`。
- 看板用例：三条曲线逐条断言；取消占比仍用 `rounds_total`；通用逐面板守卫保留 attempts 禁令。

**`docs/runbooks/render-telemetry-alerting.md`**

- §1 三口径定义（provider 健康度 / 体验失败率 / 取消占比）+ 恒等式说明。
- §2 新增恒等式告警行；降级率触发条件标注“分母排除 cancelled/guard”。
- §4 灰度判据改称 provider 降级率，新增“30m/60m/24h 必须用对应窗口自己算，不要读 10m 告警面板”的窗口纪律；硬回滚线第 2 条改 provider_degraded_rate，401 保守口径与 backlog 关联。
- §5 PromQL 换成三口径 + 恒等式对账。
- §6/§7 面板名、取消口径、告警滞后 `for: 5–10m` 同步。

## 2. 关键设计决策

- **体验失败率不单独设告警阈值**：缺灰度基线，先上曲线与 Runbook；阈值校准登记 backlog，避免凭空制造噪音。
- **取消占比保留 `rounds_total` 分母**：外审公式 `cancelled / rounds{outcome!="cancelled"}` 在 barge-in 占多数时会产生 >100% 的“率”，语义不成立；用“取消占全部交互”的占比更稳。
- **恒等式用 `unless` 而非 `!=`**：两侧都无样本（无降级也无轮次）时不应告警；`unless` 只处理“左侧有值而右侧缺失/不等”的真实不自洽。
- **不改 `outcome` 标签名**（A7）：重命名涉及指标、告警、看板、Runbook 全链路兼容与历史数据，另单评估；本单先把口径语义写进 Runbook。

## 3. 闸门数字

| 闸门 | 结果 | 证据 |
| --- | --- | --- |
| `pnpm exec vitest run test/config/af283-render-alerting.spec.ts` | 9 passed / 0 failed（293ms） | `data/af298-target.log` |
| 反向验证：临时去掉 A 曲线分母的 outcome 过滤 | 1 failed / 8 passed，精确报 `expected ... to contain outcome=~...` | `data/af298-guard-negative.log` |
| `pnpm typecheck` | exit 0 | `data/af298-typecheck.log` |
| `pnpm lint`（全量） | exit 0 | `data/af298-lint-full.log` |
| `pnpm test`（全量） | 279 passed / 1 skipped files；4363 passed / 4 skipped tests；0 failed（23.85s） | `data/af298-test-full.log` |
| `git diff --stat HEAD -- src/engine-core` | 空 | 交付前核对 |

## 4. 偏差与边界

- 外审 ③ 的取消率公式改为 `cancelled / rounds_total`，理由见 §2；其余按建议落地。
- 未改阈值、未改业务代码、未新增指标、未碰 engine-core。
- 体验失败率阈值告警登记 backlog `visitor-render-perceived-failure-alert-threshold`。

## 5. 遗留 backlog

- `visitor-render-perceived-failure-alert-threshold`：体验失败率（含 guard）需灰度基线后再定阈值与 for 窗口。
- `visitor-render-round-label-rename`：`rounds_total{outcome}` 与 `attempts_total{outcome}` 值域不同，建议改名 `result`；涉及全链路引用与历史数据。
- AF-296 已登记的 provider 健康度拆分、恒等式守卫（本单已实现告警侧）、鉴权阈值不重复登记。

## 6. commit message

`fix(AF-298): 渲染比率三口径拆分与轮次恒等式告警`
