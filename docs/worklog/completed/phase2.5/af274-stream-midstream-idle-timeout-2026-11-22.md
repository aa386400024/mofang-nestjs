# AF-274 · 流式首包后块间停摆超时治理 — 交付记录（2026-11-22）

## 结论

首包之后上游彻底停摆不再能挂 300 秒。`LlmRenderAdapter` 对首包后的每一次 `iterator.next()` 施加块间空闲超时（当前复用 `config.timeoutMs`），到点先 abort 上游，再收尾降级；已出声不切备。外部取消在首包前不切备、不污染主备熔断器，在首包后仍能真正中止上游。

真实 router smoke 用本机 SSE 先吐一句再永久停写：`ttftMs=51`、`wallElapsedMs=1071`、`deltas=1`、`providerHint=degraded`、`degraded=true`，不再等 SDK 约 300s。

## 根因

AF-270 只覆盖「接受连接但不回首包」；首 delta 一到就清掉定时器，`openStream` 返回的异步迭代器进入 `for await` 后没有任何兜底。上游吐一句后停摆时，只有 SDK 的 headersTimeout（约 300s）会结束，整轮对练表现为长时间静默。AF-269 / AF-271 / AF-273 的故障注入全部在首包前，没有覆盖这条路径。

## 改了什么

### 1. `src/engine-adapters/rendering/llm-render.adapter.ts`

- 新增 `StreamIdleTimeoutError` 与 `nextStreamChunk()`：每次等待下一块 chunk 都带 `config.timeoutMs` 空闲上限，到点先 `abort()` 上游再 reject。每条 chunk（含空 delta 的用量 / 心跳块）都会重置计时，因此限制的是「块间停摆」，不是整轮总时长。
- `streamAttempt` 首个 delta 与后续循环全部纳入 `try/finally`；`finally` 调用 `opened.dispose()`，正常结束、空闲超时、消费方抛错都释放外部监听。
- 空闲超时按**已锁定**处理：记候选失败（`markFailure`），返回 `degrade`，不切备。
- 新增 `createStreamGuard()`：把首包定时器、外部取消监听与幂等清理从 `openStream` 抽出。首 delta 到达只清「首包定时器」，外部监听保留到流结束；修复锁定后 barge-in 无法中止上游的问题。
- 首包前外部取消返回 `cancelled: true`，不记失败、不进入备候选；避免一次 barge-in 同时打穿主备两个熔断器（MiniMax 评审 P0-2）。

### 2. `bin/visitor-render-smoke.ts`

- `FaultMode` 新增 `midstream-stall`；`DEGRADED_FAULT_MODES` 包含 `auth` 与 `midstream-stall`，两者只允许 `--expect-degraded`。
- 本机故障服务在 `midstream-stall` 下返回合法 SSE 头与一条 assistant chunk，然后永久不写、不结束，精确模拟「吐一句就卡死」。
- 新增 `--expect-degraded-within-ms N`，对降级总耗时做机器断言。
- 新增硬断言：`midstream-stall` 必须至少产生 1 个可见增量，否则说明首包没到，测到的是首包超时而不是块间停摆。
- `midstream-stall` 跳过聚合探针（该故障的聚合请求本身能返回，探针测不到），证据由流式轮次承担。
- 把候选链断言、故障服务判定、主候选探针抽成 `assertCandidateChain` / `needsFaultServer` / `probePrimary`，主流程 cognitive complexity 从 28 降到 25 以内。

### 3. `test/engine-adapters/af274-stream-idle-timeout.spec.ts`（新增 5 例）

1. 首包后停摆 → 超时 abort、收尾降级、不切备、`consecutiveFailures=1`。
2. 持续空块 / 心跳块 → 整轮超过 timeout 不误杀，两句话完整输出。
3. 上游不响应 abort → 计时器仍结束本轮，不挂死。
4. 首包前外部取消 → 只尝试主候选、主备熔断计数都为 0。
5. 首包后外部取消 → 真正 abort 上游、不记候选失败。

### 4. `test/engine-adapters/af270-stream-timeout.spec.ts`（1 例调整）

原「首包后长流不被误杀」用 2×timeout 的单次间隔，按 AF-274 新语义属于块间停摆，应降级。改为总时长超过 timeout、但每隔 `timeout/2` 有一个空块，继续验证「首包定时器不限制整轮总时长」。

## 真实 smoke 证据

| 场景 | 关键结果 |
| --- | --- |
| `midstream-stall`，1 轮，`--timeout-ms 1000`，上限 5000ms | exit 0；`wallElapsedMs=1071`；`ttftMs=51`；`deltas=1`；`providerHint=degraded`；`degraded=true`；`fallbackUsed=true`；候选 `doubao,minimax`；`primaryProbe=null` |
| 正常路径，3 轮，`--timeout-ms 30000` | exit 0；3/3 `providerHint=doubao`；`fallbackUsed=false`；`degraded=false`；`finishReason=stop`；TTFT 609 / 528 / 564ms；wall 1723ms |

`fallbackUsed=true` 表示走了降级兜底，不是切到备候选；smoke 的 `providerHint=degraded` 与 `deltas=1` 证明首包已真实到达后才降级。

## 闸门

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 定向单测 | `pnpm exec vitest run af274-stream-idle-timeout.spec.ts af270-stream-timeout.spec.ts` | 8/8 passed |
| 类型 | `pnpm exec tsc --noEmit -p tsconfig.json` | exit 0 |
| lint | `pnpm lint` | 0 error / 0 warning，exit 0 |
| 真实 midstream smoke | `visitor-render-smoke.ts --provider doubao --caller router --turns 1 --fail-primary --fail-primary-mode midstream-stall --expect-degraded --timeout-ms 1000 --expect-degraded-within-ms 5000` | exit 0；wall 1071ms；deltas 1 |
| 正常路径回归 | `visitor-render-smoke.ts --provider doubao --caller router --turns 3 --timeout-ms 30000` | exit 0；3/3 doubao、零降级 |
| 全量测试 | `pnpm test` | 265 files passed + 1 skipped；4283 tests passed + 4 skipped；23.52s |
| 纯层 | `git diff --stat HEAD -- src/engine-core` | 空 |

## 关键设计决策与偏差

1. **复用 `config.timeoutMs` 作为块间空闲上限，未在本任务新增 `ENGINE_RENDER_STREAM_IDLE_TIMEOUT_MS`。** MiniMax 评审建议把首包与块间空闲解耦成独立键、语义变为「首包 + 块间空闲上限」；该改动需要动 `render-adapter.config.ts` 与 `.env.example`，超出 AF-274 已登记 scope，拆到 AF-275 一起做，避免本任务继续扩大。
2. **首包后停摆必须降级，不切备。** 已经通过 `onDelta` 出过声，切到备候选会从第二句重新开口，用户听到两段拼接；只有首包前失败才允许 `retry`。
3. **空 delta chunk 也重置空闲计时。** 上游的用量块、心跳块不代表停摆；只看 `chunk.delta` 会把正常的长思考 / 收尾用量误判成 stall。
4. **外部取消与上游故障分离。** 首包前取消返回 `cancelled`，不记失败、不切备；首包后取消走降级但不记失败。这样 barge-in 不会把主备熔断器同时打到冷却。
5. **`fallbackUsed=true` 语义沿用既有实现。** 降级兜底也会置 `fallbackUsed`，本任务没有改这个字段语义；用 `providerHint=degraded` + `deltas>=1` 区分「已出声后降级」与「切备成功」。

## MiniMax Code 只读评审回收

评审回复文件：`docs/worklog/pending/relay-response-AF-273-REVIEW-20261122-1220.md`。

采纳并已修：

- **P0-2** 外部取消仍会 `markFailure` + `retryable`，主备熔断器可被一次 barge-in 同时污染 → AF-274 首包前返回 `cancelled`，不记失败、不切备；单测覆盖。
- **P1-8** 首包后外部取消监听被清掉 → AF-274 保留到流结束并真正 abort 上游；单测覆盖。

未在本任务修，已登记后续：

- **P0-3** 自动补备候选未校验 key 存在 → AF-275。
- **P0-4** 401 仍不切备，主 key 轮换时整体降级 → AF-275。
- **P1-9** 回滚态并发 + 超时组合 → 继续保留 backlog。
- **P2-12** 重试备注夸大 → 文档口径修正。

## 已知缺口

- **空闲超时仍复用 `ENGINE_RENDER_TIMEOUT_MS`，一个键承担三种语义。** 需要独立 `ENGINE_RENDER_STREAM_IDLE_TIMEOUT_MS`，并同步 `.env.example`；AF-275。
- **首包固定 30s 可能误杀高 `maxTokens` 慢首包。** MiniMax 建议按 `max(8000, maxTokens*8)` 放宽；AF-275 评估。
- **MiniMax HttpClient 传输层计时未单独放大。** headersTimeout 是否仍会先于适配器触发，需要结合 SDK 计时参数单独验证；AF-275。
- **客户端自动重试会把 raw Error 透传。** 需要在 WS 层转标准 error/end 事件并抑制自动重试；登记 backlog。
- **无空闲超时观测指标。** 建议记录 `stream_idle_timeout_total`、`phase`、`candidate`；登记 backlog。

## 回执字段速览

- `gateResults`：定向 8/8；tsc exit 0；lint 0/0；midstream smoke exit 0（wall 1071ms、deltas 1、degraded true）；正常 3 轮 exit 0（3/3 doubao、零降级、TTFT 609/528/564ms）；全量 265 files +1 skipped、4283 tests +4 skipped、23.52s；engine-core diff 为空。
- `scopeCheck`：in-scope；改 `llm-render.adapter.ts`、`bin/visitor-render-smoke.ts`、AF-274 新测与 AF-270 既有测试语义调整、交付记录；未触碰 engine-core、未改 `.env`。
- `contractChecks`：单任务号 AF-274；状态只经 CLI；回执六组字段闭合；未提交密钥与日志；未用 `--no-verify`。
- `backlogItems`：`visitor-stream-idle-timeout-key`、`visitor-stream-first-delta-budget`、`minimax-httpclient-transport-timing`、`visitor-stream-client-auto-retry`、`visitor-stream-idle-observability`、`visitor-rollback-concurrency-long-context`、`minimax-official-pricing`。
- `deviationTable`：复用 `config.timeoutMs` 未新增独立键；`fallbackUsed` 语义未改；AF-270 原「长流不误杀」用例按新语义改为持续空块。
- `reviewVerdict`：passed（MiniMax P0-2 / P1-8 已修，P0-3 / P0-4 转 AF-275）。

## commit message

`fix(af274): 治理流式首包后块间停摆并隔离外部取消`
