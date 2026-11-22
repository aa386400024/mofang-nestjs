# AF-300 · 渲染连接类失败独立 network cause 交付记录

- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-300/task-sheet.md`
- 分支：`task/AF-300-af-300`
- 基线：`75993239f9359619b955bbc1ccc493fe2901d070`（AF-299 合并后的 integrate）
- 状态提交：`314933c9`（登记 + 领单，含任务单/清单）
- 实现提交：本提交
- 日期：2026-11-22

## 1. 结论

AF-299 真实回放发现 `--fail-primary-mode network` 的连接错误被归到 `failure{cause=other}`，与未知异常混在一起，线上无法区分“出网/DNS/连接被掐断”和“代码异常”。本单把连接层失败独立为 `network` cause，HTTP 语义保持不变，真实 smoke 已验证 `failure{network}=1`（两候选）与 `fallback{cause=network}=1`。

## 2. 改了什么

**`src/engine-adapters/rendering/render-telemetry.port.ts`**

- `RenderFailureCause` 增加 `network`，枚举注释写清“连接没建立/被断开”与“连接已建立但等不到响应（timeout）”的边界。

**`src/engine-adapters/rendering/llm-render.adapter.ts`**

- 新增 `NETWORK_ERROR_PATTERNS`：`connection error/refused/reset`、`econnrefused/econnreset/enotfound/eai_again`、`fetch failed/socket hang up/network error`、`getaddrinfo/dns lookup`。
- `classifyErrorCause()` 在 429/5xx 结构化判断之后、timeout 文案之前判 network，避免 `socket hang up` 被 timeout 抢走。

**`test/engine-adapters/af282-render-telemetry-correctness.spec.ts`**

- 新增“连接层失败：failure/fallback 归因 network，不再落 other”，用两候选 `Connection error.` 与 `socket hang up ECONNRESET`，断言失败原因、回退原因与 `degraded{exhausted}`，并断言不记 timeout。

**`docs/runbooks/render-telemetry-alerting.md`**

- §3 cause 处置表新增 `network` 行：查本机出网/代理/DNS/TLS，与上游 5xx 分开处置。
- §5.1 故障矩阵 network 行改为 `failure{network}`、`fallback{cause=network}`，并写清与 `timeout` 的边界。

## 3. 真实回放

命令：

```powershell
pnpm exec tsx bin/visitor-render-smoke.ts --provider doubao --caller router --turns 1 --fail-primary --fail-backup --fail-primary-mode network --expect-exhausted --dump-render-metrics
```

结果（`data/af300-network-smoke.log`）：

- `ok=true`；两 probe `Connection error`（20ms / 3ms）。
- `rounds{exhausted}=1`、`degraded{exhausted}=1`。
- 两候选 `attempts{retry}=1`、`failure{network}=1`。
- `fallback{from=doubao,to=minimax,cause=network}=1`。
- `auth_failure_total`、`stream_timeout_total`、`cooldown_seconds`、`cooldown_until` 均空。
- wall 13ms，chars 14，降级兜底句正常返回。

## 4. 关键设计决策

- **只扩枚举，不动告警查询**：`failure_total` 与 `fallback_total` 的 cause 是标签值，看板按 cause 堆叠，新值自动出现；不新增阈值，避免凭空定基线。
- **network 判在 timeout 之前**：`ECONNRESET` 与 `socket hang up` 也常被上层包成 “aborted”，若先判 timeout 会继续误归类；连接层优先符合处置直觉。
- **不改 HTTP 4xx 语义**：401 走 `isAuthFailure` 分支记 auth；其余 4xx 仍 other，避免把业务拒绝误报成网络故障。
- **不重命名既有 `timeout`/`first-delta`**：AF-299 已记录流式路径按阶段记 first-delta；本单只解决 network 缺失，不扩大契约变更。

## 5. 闸门数字

| 闸门 | 结果 | 证据 |
| --- | --- | --- |
| `pnpm exec vitest run test/engine-adapters/af282-render-telemetry-correctness.spec.ts` | 8 passed / 0 failed（805ms） | `data/af300-target.log` |
| network 真实 smoke | `ok=true`，`failure{network}=1` 两候选，`fallback{cause=network}=1` | `data/af300-network-smoke.log` |
| `pnpm typecheck` | exit 0 | `data/af300-typecheck.log` |
| `pnpm lint`（全量） | exit 0 | `data/af300-lint-full.log` |
| `pnpm test`（全量） | 279 passed / 1 skipped files；4364 passed / 4 skipped；0 failed（24.57s） | `data/af300-test-full.log` |
| `git diff --stat HEAD -- src/engine-core` | 空 | 交付前核对 |

lint 首轮因单行正则 173 字符触发 `max-len`，拆成 `NETWORK_ERROR_PATTERNS` 常量数组后复跑通过；已记录，不作为遗留。

## 6. 偏差与边界

- 任务单写“连接错误归 network”，实际还覆盖 DNS（`getaddrinfo`/`enotfound`/`eai_again`）与 socket 层（`ECONNRESET`/`hang up`）；同一处置域，未超范围。
- 未改 smoke 参数、未改告警阈值、未改看板 JSON、未碰 engine-core。
- 历史数据中已记为 `other` 的 network 事件不回填；只影响新产生的指标。

## 7. 遗留 backlog

- `visitor-render-timeout-cause-naming`（AF-299 登记）：流式 first-delta 与聚合 timeout 仍需对照表或统一命名。
- `visitor-render-perceived-failure-alert-threshold`、`visitor-render-round-label-rename` 继续保留，不在本单处理。
- `visitor-render-network-cause-classify` 已由本单完成，可从 backlog 移除。

## 8. commit message

`fix(AF-300): 渲染连接类失败独立 network cause`
