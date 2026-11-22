# AF-270 · 流式渲染首包超时治理 — 交付记录（2026-11-22）

## 结论

生产 `LlmRenderAdapter.openStream` 已用 `config.timeoutMs` 建立首包超时。上游「接受连接但不回首包」时，主候选在 5 秒配置下被主动 abort，随后切到 MiniMax；AF-269 暴露的「挂 307 秒才切备」被压到 **8.0 秒总耗时**（含 2 秒探针 + 5 秒首包超时 + 备候选出话）。

真实 timeout smoke：

| 指标 | 结果 |
| --- | --- |
| 命令 | `--provider doubao --fail-primary --fail-primary-mode timeout --expect-fallback --timeout-ms 5000 --expect-fallback-within-ms 15000` |
| exit code | 0 |
| primaryProbe | `Request timed out.`，2 031 ms |
| 主候选流式失败 | `流式首包超时 (5000ms)` |
| providerHint | `minimax` |
| fallbackUsed | true |
| degraded | false |
| finishReason | `stop` |
| chars | 35 |
| wallElapsedMs | 8 001 ms |
| TTFT | 7 731 ms |
| expectFallbackWithinMs | 15 000 |

对照 AF-269 同场景 307 355 ms：**延迟下降约 38 倍**。

## 根因

- `callOnce` 有 `AbortController` + `config.timeoutMs`，探针 2 秒即失败；
- `openStream` 只把 `handlers.signal` 透传给 `chatCaller.stream`，没有用 `config.timeoutMs` 建超时；
- 生产 router 的流式 SDK 自身 headersTimeout 约 300 秒，导致主候选挂死，备候选长期轮不到。

## 改了什么

### 1. `src/engine-adapters/rendering/llm-render.adapter.ts`

`openStream` 新增首包超时控制：

- 用 `new AbortController()` 建本次候选的流式取消信号；
- 合并外部 `handlers.signal`：外部已取消则立即 abort，否则监听一次 abort；
- `setTimeout(config.timeoutMs)` 到点 `controller.abort()`，并标记 `timedOut=true`；
- 把 `controller.signal` 传给 `chatCaller.stream`，确保 abort 能真正中止上游连接（避免幽灵连接继续占额度）；
- 首个非空 delta 到达后，`finally` 统一清理定时器与外部监听，正常长回复不会被首包定时器误杀；
- 超时失败单独返回 `{retryable:true, reason:'流式首包超时 (Nms)'}`，并 `markFailure`，走既有候选循环切备。

外部取消仍沿用既有语义：abort 后失败按可重试归类，候选耗尽则降级；未改变「已出声不重试」。

### 2. `test/engine-adapters/af270-stream-timeout.spec.ts`

新增 3 例（全 mock，无网络）：

1. 主候选首包挂起 → 100 ms 配置超时内 abort → 切备成功，`providerHint=backup`、`fallbackUsed=true`、`degraded=false`；
2. 首包到达后清定时器 → 后续 200 ms 延迟（超过 100 ms 配置）不被误杀，两段台词完整输出；
3. 外部 signal 已取消 → 挂起流立即中止，不把调用挂到 SDK headersTimeout。

### 3. `bin/visitor-render-smoke.ts`

新增 `--expect-fallback-within-ms N`：

- 必须配合 `--expect-fallback`；只接受正整数；
- 报告新增 `expectFallbackWithinMs`；
- 批量结束后若 `wallElapsedMs > N`，exit 2 并输出明确失败信息。

这样「秒级切备」不是靠人工看日志，而是可机读 gate。

## 闸门

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 类型 | `pnpm exec tsc --noEmit -p tsconfig.json` | exit 0 |
| lint | `pnpm lint` | 0 error / 0 warning，exit 0 |
| 定向单测 | `pnpm exec vitest run test/engine-adapters/af270-stream-timeout.spec.ts` | 3/3 passed |
| 真实超时 smoke | 上述命令 | exit 0，8 001 ms，fallback true / degraded false |
| 全量测试 | `pnpm test` | 263 files passed + 1 skipped；4 272 tests passed + 4 skipped |
| 纯层 | `git diff --stat HEAD -- src/engine-core` | 空 |

## 关键设计决策与偏差

1. **只做首包超时，不做全流总时长限制。** 任务目标是把「首包前挂死」治掉，同时不截断正常长回复；已出声后的中途停顿仍按既有「不切备、收尾降级」处理。全流 stall 检测单列 backlog。
2. **超时后立即 abort 上游。** 只 reject Promise 不 abort 会让 SDK 连接继续挂着，形成幽灵连接；用 controller 传给 provider 才能释放上游资源。
3. **首 delta 到达即清定时器。** 这意味着「首包慢但最终会回」的场景只受首包窗口约束，不会因为总生成时间长而被误杀。
4. **外部取消仍可能走备候选。** 既有 `handlers.signal` 语义未改；如果产品希望「用户取消 = 立即停止、不切备、不吐兜底」，需另立任务改取消语义，本任务只保证不挂死。
5. **`--expect-fallback-within-ms` 只用于 smoke。** 不进生产配置，不影响运行时。

## 已知缺口

- **全流中途 stall 未设总超时**：首包之后若上游卡住，仍可能长时间无增量；需要另立任务评估「无增量心跳超时」，并避免误杀长回复。
- **未覆盖 MiniMax 备候选自身的首包挂起**：当前 smoke 只让主候选挂起；备候选同类故障由同一适配器逻辑覆盖，但没有真实双挂起证据。
- **未验证并发下的 abort 资源释放**：AF-265 并发 smoke 未加入 timeout 组合。
- **未验证 SDK 在 abort 后的重试风暴**：`maxRetries=0` 只在 smoke 故障服务上配置，生产 provider 的重试策略未审计。

## 回执字段速览

- `gateResults`：tsc exit 0、lint 0/0、定向 3/3、真实 timeout smoke exit 0 / 8 001 ms、全量 4 272 passed + 4 skipped、engine-core diff 为空。
- `scopeCheck`：in-scope，改渲染适配器、AF-270 单测、smoke 工具与记录文档。
- `contractChecks`：taskId 单任务号、状态写入全经 CLI、回执六组字段闭合、AF-269 smoke 兼容、未触碰 engine-core。
- `backlogItems`：`visitor-stream-midstream-stall-timeout`、`visitor-cancel-no-fallback-policy`、`visitor-concurrency-timeout-combo`。
- `deviationTable`：只做首包超时非全流总超时；外部取消仍沿用既有可重试/降级语义。
- `reviewVerdict`：passed。

## commit message

`fix(af270): 流式首包超时受 ENGINE_RENDER_TIMEOUT_MS 约束`
