# AF-299 · 渲染故障矩阵真实回放交付记录

- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-299/task-sheet.md`
- 分支：`task/AF-299-render-fault-matrix`
- 基线：`eb30f22f5f3ea99c4374903097a09c6898f89de5`（AF-298 合并后的 integrate）
- 状态提交：`2a7f859d`（登记 + 领单，含任务单/清单）
- 实现提交：本提交
- 日期：2026-11-22

## 1. 结论

AF-295 只真实验证了 rate-limit 一种故障；本单把 **5xx、首包超时、401、连接失败、首包后停摆** 五条路径全部真实回放，并把“故障模式 → 命令 → 期望指标”固化成 Runbook §5.1 矩阵表。五条回放全部 `ok=true`，但暴露两处判读口径差异，已写入 Runbook 与 backlog：

1. `--fail-primary-mode timeout` 在流式路径上先触发首包预算，`failure{cause}` 记 `first-delta` 而不是 `timeout`；按 cause=`timeout` 报警会漏判。
2. `--fail-primary-mode network` 的连接错误没有独立枚举，落到 `failure{cause=other}`；`other` 在线上混合了未分类异常，不能单凭它定位网络层。

任务本身为纯验证 + 文档，未改业务代码、未新增指标、未碰 engine-core。

## 2. 真实回放取证

统一基线：`--provider doubao --caller router --turns 1 --dump-render-metrics`，主候选 `doubao-seed-character-260628`、备候选 `MiniMax-M3`。

| 故障 | 回放参数 | 真实结果 | 证据 |
| --- | --- | --- | --- |
| 双候选 5xx | `--fail-primary --fail-backup --fail-primary-mode server-error --expect-exhausted` | 两 probe 均 500（46ms / 6ms）；`rounds{exhausted}=1`、`degraded{exhausted}=1`、两候选 `attempts{retry}=1`、两候选 `failure{server}=1`、`fallback{from=doubao,to=minimax,cause=server}=1`、`cooldown_served_total=0`、其余候选级计数器为空；wall 18ms；chars 14 | `data/af299-server-error.log` |
| 双候选首包超时 | `... --fail-primary-mode timeout --expect-exhausted` | 两 probe `Request timed out`（2031ms / 2011ms）；`rounds{exhausted}=1`、`degraded{exhausted}=1`、两候选 `stream_timeout{phase=first-delta}=1`、两候选 `failure{first-delta}=1`、`fallback{cause=first-delta}=1`、`cooldown_served_total=0`；wall 16018ms（8s×2） | `data/af299-timeout.log` |
| 双候选 401 | `... --fail-primary-mode auth --expect-exhausted` | 两 probe 401（194ms / 152ms）；`rounds{exhausted}=1`、`degraded{exhausted}=1`、两候选 `auth_failure_total=1`、两候选 `failure{auth}=1`、`fallback{cause=auth}=1`；`stream_timeout` 空；wall 103ms | `data/af299-auth.log` |
| 双候选连接失败 | `... --fail-primary-mode network --expect-exhausted` | 两 probe `Connection error`（20ms / 2ms）；`rounds{exhausted}=1`、`degraded{exhausted}=1`、两候选 `failure{other}=1`、`fallback{cause=other}=1`；`auth_failure`/`stream_timeout` 空；wall 12ms | `data/af299-network.log` |
| 单候选首包后停摆 | `--fail-primary --fail-primary-mode midstream-stall --expect-degraded` | TTFT 53ms、deltas 1；30s 后 idle 超时；`rounds{degrade}=1`、`degraded{idle}=1`、`stream_timeout{phase=idle}=1`、`failure{idle}=1`、`attempts{degrade}=1`、`fallback_total` 空；wall 30076ms；chars 14 | `data/af299-midstream.log` |

共同点：五条路径最终都交付 14 字降级兜底句，未向用户抛出异常；`chars` 与 `preview` 一致。

## 3. 改了什么

**`docs/runbooks/render-telemetry-alerting.md`**

- 新增 §5.1「故障矩阵真实回放」：五行表，逐行给出追加参数、关键期望指标、已知口径差异。
- 明确 `--dump-render-metrics` 是**进程内本轮增量**，不是线上累计值，避免用 smoke 数字直接对 Grafana 曲线。
- 写明判读纪律：先认 `rounds` 结局，再对 `failure`/`degraded` 的 cause，最后看候选级计数器；至少核对两条相互独立指标。
- 记录 timeout → first-delta、network → other 两处差异，与 backlog 名称。

## 4. 关键设计决策

- **不在本单扩大 scope 去加 `network` 枚举**：任务单明确“不新增代码”，且新增 cause 会牵动指标标签、告警、看板、历史数据兼容；先以 Runbook 标注 + backlog 承接，避免把验证单做成实现单。
- **矩阵按“用户可见故障形态”而非内部异常名组织**：5xx、首包超时、401、连接失败、首包后停摆，对应值班第一反应；内部 cause 差异放在同一行备注，防止按 cause 名误判。
- **停摆只跑单候选**：`midstream-stall` 与 `expect-exhausted` 互斥（已有守卫），其语义是“首包已出但流断”，不涉及候选切换，用 `--expect-degraded` 单独取证。

## 5. 闸门数字

| 闸门 | 结果 | 证据 |
| --- | --- | --- |
| `git diff --stat HEAD -- src bin test` | 空 | 交付前核对输出为空 |
| `pnpm typecheck` | exit 0 | `data/af299-typecheck.log` |
| `pnpm lint`（全量） | exit 0 | `data/af299-lint-full.log` |
| `pnpm test`（首次全量） | 1 failed / 278 passed / 1 skipped files；4362 passed / 4 skipped / 1 failed（23.70s） | `data/af299-test-full.log` |
| 失败用例定向复跑 | `test/admin-debug/debug-session-persistence.spec.ts` 28 passed（3.02s） | `data/af299-flaky-rerun.log` |
| `pnpm test`（全量复跑） | 279 passed / 1 skipped files；4363 passed / 4 skipped / 0 failed（23.98s） | `data/af299-test-full2.log` |
| `git diff --stat HEAD -- src/engine-core` | 空 | 交付前核对 |

首次全量失败为既有 flaky：`debug-session-persistence.spec.ts` 的 `waitFor 超时: 条件在 10000ms 内没成立`，单文件复跑与全量复跑均通过；与本单改动无因果关系（本单只改 Runbook/记录）。

## 6. 偏差与边界

- 任务单标题写“四类故障”，实际回放五条（把 `midstream-stall` 单列），因为它是唯一“已有首包后失败”的形态，runbook 不写会造成判读空洞。
- 任务单预期“`timeout` → `failure{timeout}`”被现实推翻，实际为 `first-delta`；已在 §2、Runbook §5.1 与 backlog 记录。
- 未改阈值、未改业务代码、未新增指标、未碰 engine-core、未碰看板与告警文件。

## 7. 遗留 backlog

- `visitor-render-network-cause-classify`：连接错误当前落 `other`，建议新增 `network` cause 或按错误码细分；涉及指标标签与历史数据兼容，另单评估。
- `visitor-render-timeout-cause-naming`：流式首包超时统一记 `first-delta`，聚合路径可能记 `timeout`；建议在 Runbook 之外补一条“按路径读 cause”的对照，或统一命名。
- 既有 backlog 不重复登记：`visitor-render-perceived-failure-alert-threshold`、`visitor-render-round-label-rename`、`visitor-first-delta-vs-ttft-semantics`。

## 8. commit message

`docs(AF-299): 渲染故障矩阵真实回放与判读口径`
