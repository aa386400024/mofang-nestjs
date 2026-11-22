# AF-269 · 来访者渲染限流 / 5xx / 超时三类故障的真实候选回退 smoke — 交付记录（2026-11-22）

## 结论

三类生产高频上游故障全部用**真实 HTTP 上游语义**取证通过：豆包主候选失败后真实切到 MiniMax 备候选，`fallbackUsed=true`、`degraded=false`、`finishReason=stop`、输出非兜底句。

| 模式 | 主候选失败 | 探针耗时 | 渲染 provider | 回退 | 降级 | 输出字符 | 渲染墙钟 | TTFT |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `rate-limit` 429 | `429 af269 simulated rate limit` | 51 ms | `minimax` | true | false | 36 | 2 177 ms | 1 918 ms |
| `server-error` 500 | `500 af269 simulated server error` | 50 ms | `minimax` | true | false | 42 | 2 080 ms | 1 702 ms |
| `timeout` 挂起 | `Request timed out.` | 2 023 ms | `minimax` | true | false | 43 | **307 355 ms** | **307 019 ms** |

正常路径 3 轮复跑：3/3 `doubao`、`fallbackUsed=false`、`degraded=false`、`finishReason=stop`，墙钟 3 111 ms，usage 2 338 / 45 / 2 383。

**重要发现：超时模式虽然通过，但主候选实际挂到约 307 秒才切备。** 生产 `LlmRenderAdapter.openStream` 没有用 `config.timeoutMs` 约束流式调用，`--timeout-ms` 与 provider `requestTimeoutMs` 只作用于非流式 `callOnce`。探针 2 秒就超时，渲染却等 SDK 默认 headersTimeout（约 300 秒）。这条缺口不属于「只补证据」的 AF-269 范围，已登记独立 backlog，需另开生产修复任务。

## 改了什么

仅改 `bin/visitor-render-smoke.ts`，生产代码零改动，`src/engine-core` 零改动。

### 1. 故障模式扩展

`FaultMode` 从 `auth | network` 扩为：

```text
auth | network | rate-limit | server-error | timeout
```

`FALLBACK_FAULT_MODES = {network, rate-limit, server-error, timeout}`：可重试故障只允许 `--expect-fallback`；`auth` 仍只允许 `--expect-degraded`，保持 AF-264 结论。

### 2. 本机临时故障上游

`startFaultServer(mode)` 在 `127.0.0.1:0` 起临时 HTTP 服务：

- `rate-limit`：返回 429 + `{"error":{"message":"af269 simulated rate limit","type":"rate_limit_error"}}`；
- `server-error`：返回 500 + `server_error`；
- `timeout`：不写响应，让客户端自己超时；
- 收尾 `closeAllConnections()` 后 `server.close()`。

把豆包候选 `baseUrl` 指向该服务，`maxRetries=0`；`timeout` 模式给 provider 配 `requestTimeoutMs=2000`（仅约束探针的 `callOnce`）。

不改 `.env`、不打真实豆包额度、不消耗真实上游限流配额。

### 3. 探针耗时进机读报告

`probePrimaryFailure` 增加 `elapsedMs`，报告 `primaryProbe.elapsedMs`，便于区分「快速失败」与「挂死」。

### 4. 回退场景默认放宽 completion 上限

MiniMax M3 的 reasoning token 计入 completion 上限。用默认 300 时 500 模式出现过 `finish_reason=length`、正文被截空，被 smoke 误判成假降级。现在 `--expect-fallback` 且未显式给 `--max-tokens` 时默认 800，保证任务单里不带该参数的 gate 命令可稳定复跑。

这是 smoke 工具的默认值，不影响生产参数。

## 实测命令

```powershell
pnpm exec tsx bin/visitor-render-smoke.ts --provider doubao --fail-primary --fail-primary-mode rate-limit --expect-fallback
pnpm exec tsx bin/visitor-render-smoke.ts --provider doubao --fail-primary --fail-primary-mode server-error --expect-fallback
pnpm exec tsx bin/visitor-render-smoke.ts --provider doubao --fail-primary --fail-primary-mode timeout --expect-fallback
pnpm exec tsx bin/visitor-render-smoke.ts --provider doubao --turns 3
```

证据日志（未提交）：

- `data/af269-rate-limit.log`
- `data/af269-server-error.log`
- `data/af269-timeout-gate.log`
- `data/af269-normal3.log`

## 超时缺口根因

已读代码确认：

- `src/engine-adapters/wiring/render-config.factory.ts:126` 已把 `ENGINE_RENDER_TIMEOUT_MS`（本次门命令默认 60 000）写进适配器 config；
- `src/engine-adapters/rendering/llm-render.adapter.ts` 的 `openStream` 只把 `handlers.signal` 传给 `chatCaller.stream`，没有按 `config.timeoutMs` 建 `AbortController`；
- 同文件 `callOnce` 才有 `AbortController` + `config.timeoutMs`；
- 生产 router 走 SDK 流式调用，SDK 自身 headersTimeout 约 300 秒才报 `Request timed out. Node.js fetch timed out waiting for response headers`。

影响：来访者渲染在流式路径上遇到上游「接受连接但不返回首包」时，回退延迟可达 5 分钟，会直接拖死语音对练首包体验。修复应让 `openStream` / `streamAttempt` 用 `config.timeoutMs` 建超时，或给 `RouterChatCaller` 的 SDK 流式请求传 timeout / headersTimeout；修复后需重跑本任务 timeout 模式，期望秒级切备。

## 闸门

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 类型 | `pnpm exec tsc --noEmit -p tsconfig.json` | exit 0 |
| lint | `pnpm lint` | 0 error / 0 warning，exit 0 |
| 429 回退 | 上述 rate-limit 命令 | exit 0，fallback true / degraded false |
| 500 回退 | 上述 server-error 命令 | exit 0，fallback true / degraded false |
| 超时回退 | 上述 timeout 命令 | exit 0，fallback true / degraded false（延迟 307 s） |
| 正常回归 | `--turns 3` | exit 0，3/3 豆包，无回退无降级 |
| 全量测试 | `pnpm test` | 262 files passed + 1 skipped；4 269 tests passed + 4 skipped |
| 纯层 | `git diff --stat HEAD -- src/engine-core` | 空 |

## 关键设计决策与偏差

1. **偏差：回退场景默认 `max-tokens=800`。** 任务单 gate 命令不带 `--max-tokens`，MiniMax M3 的 reasoning token 会把 300 的预算吃光并截断正文，导致假降级。改成 `expectFallback` 时默认 800，只在 smoke 工具内生效，生产参数未动。
2. **偏差：超时模式延迟 307 秒仍判通过。** 验收只要求「exit 0、回退成功、degraded=false」，未设延迟上限；本次如实记录 307 秒，并把「流式超时不生效」作为独立 backlog，不在本任务改生产适配器（任务单非目标明确不改 `LlmRenderAdapter`）。
3. **429 / 500 的主候选耗时显著小于超时模式**：51 ms / 50 ms 对 2 023 ms 探针、307 355 ms 渲染，满足验收第 72 行。
4. **不改真实 `.env`。** 仍为 `VISITOR_LLM_PROVIDER=doubao` / `VISITOR_DOUBAO_MODEL=doubao-seed-character-260628`。
5. **正常路径复跑用 3 轮。** 任务单只要求 3 轮；长上下文已由 AF-268 的 40 轮覆盖。

## 已知缺口

- **流式超时不生效**：见上节根因，需独立生产修复任务；修复前 timeout 场景生产回退延迟不可接受。
- **未测 `Retry-After` 退避**：生产当前同候选内不退避，本任务只证明切备可用。
- **401 策略未决**：`visitor-auth-failure-fallback-policy` 仍待产品决定「快速降级」还是「切 MiniMax 保连续」。
- **未覆盖半开连接、DNS 失败、TLS 握手失败**等更细的传输故障分类。
- **未验证多实例/多副本下的故障切换一致性**；当前 smoke 为单进程路由链。

## 回执字段速览

- `gateResults`：tsc exit 0、lint 0/0、三条故障 gate 全 exit 0、正常 3 轮 exit 0、全量 4 269 passed + 4 skipped、engine-core diff 为空。
- `scopeCheck`：in-scope，只改 `bin/visitor-render-smoke.ts` 与 AF-269 记录/交付文档。
- `contractChecks`：taskId 单任务号、状态写入全经 CLI、回执六组字段闭合、AF-264/265/268 兼容、未触碰 engine-core。
- `backlogItems`：`visitor-stream-timeout-unbounded`、`visitor-auth-failure-fallback-policy`、`visitor-retry-after-backoff`。
- `deviationTable`：回退场景默认 max-tokens 800；timeout 307 秒仍通过但登记独立修复任务。
- `reviewVerdict`：passed。

## commit message

`feat(af269): 限流/5xx/超时三类真实故障候选回退 smoke`
