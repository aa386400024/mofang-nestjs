# AF-264 · 来访者主候选故障真实回退 smoke（2026-11-22）

## 结论

通过，但实测出一个生产行为差异：**鉴权失败（401）不会切备候选，而是直接显式降级**；**传输失败（连接不可达）才会真实切到 MiniMax**。两类故障都已做成可复现 smoke。

## scopeCheck

- `bin/visitor-render-smoke.ts`：router 路径补注册 MiniMax 备候选，新增 `--fail-primary`、`--fail-primary-mode auth|network`、`--expect-fallback`、`--expect-degraded`；在 scope 内。
- `docs/worklog/completed/phase2.5/af264-visitor-fallback-smoke-2026-11-22.md`：本交付记录；在 scope 内。
- `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-264/`：任务单、manifest、回执；在 scope 内。
- 未改 `.env`；故障注入只在 smoke 进程内生效；未暂存 `web/orchestration/data.js` 与 `data/` 取证日志。

## contractChecks

- 分支 `task/AF-264-visitor-fallback-smoke` 自 `integrate 478a8afb` 切出。
- 备候选 `minimax` 真实注册，避免 router 的“未注册 → 回落默认”把回退变成假回退。
- 鉴权模式只把进程内 `LLM_DOUBAO_API_KEY` 换成固定无效串，不打印原 key、不写 `.env`。
- 传输模式只把 smoke 内豆包 provider 的 baseUrl 指向 `http://127.0.0.1:9/v1`，`maxRetries=0`，不影响真实 `.env`。
- 未改 `src/engine-core`，未改生产回退策略。

## gateResults

- 鉴权降级 smoke：`pnpm exec tsx bin/visitor-render-smoke.ts --caller router --provider doubao --turns 1 --fail-primary --fail-primary-mode auth --expect-degraded` → exit 0；`providerHint=degraded`、`degraded=true`、`fallbackUsed=true`、输出为非空兜底句“……”；主候选探针真实返回 `401 The API key format is incorrect`；日志 `data/af264-auth-degraded.log`。
- 传输回退 smoke：`... --fail-primary-mode network --expect-fallback` → exit 0；主候选探针 `Connection error.`；`providerHint=minimax`、`model=MiniMax-M3`、`fallbackUsed=true`、`degraded=false`、`chars=58`、`elapsedMs=2450`、`ttftMs=2141`、usage 821/147/968（reasoning 122）、`finishReason=stop`、`guardLevel=pass`；日志 `data/af264-network-fallback.log`。
- 正常路径 6 轮：`--caller router --provider doubao --turns 6` → exit 0；6/6 `providerHint=doubao`、`fallbackUsed=false`、`degraded=false`；`totalUsage` 4946/74/5020；TTFT 687/899/829/669/427/791ms；日志 `data/af264-normal6.log`。
- lint：`pnpm lint` → 0 error / 0 warning。
- CI 同口径 typecheck：`pnpm exec tsc --noEmit -p tsconfig.json` → 0 error。
- 全量：`pnpm test` → 261 passed + 1 skipped files / 4264 passed + 4 skipped tests，exit 0。
- engine-core：`git diff --stat HEAD -- src/engine-core` 为空。

## backlogItems

- `visitor-auth-failure-fallback-policy`：401 当前直接降级、不切备候选；需产品/架构决定是保留“坏 key 快速失败”语义，还是切 MiniMax 保对练连续性。当前按生产既有策略如实记录，不在本任务改。
- `visitor-failover-concurrency-smoke`：未做并发下同一 provider 冷却共享、半开探测单飞的注入验证。
- `visitor-failover-5xx-timeout`：未覆盖 429/5xx/读超时的候选切换与冷却退避。
- `visitor-failover-multi-turn-recovery`：未验证主候选恢复后从 MiniMax 切回豆包的完整多轮回切。

## deviationTable

- `taskSays`: 主候选 401 后应回退到 MiniMax。
  `reality`: `LlmRenderAdapter` 把鉴权失败判为不可重试，记录错误后直接 `degraded=true` 兜底句，不进入候选切换。
  `action`: 保留生产策略不改；新增 `--expect-degraded` 固化该行为，真实回退证据改用传输失败模式。
  `why`: 401 是配置错误，盲目切候选会掩盖坏 key；是否改策略属于产品决策，不能顺手改。
- `taskSays`: 只加 `--fail-primary` 一个开关。
  `reality`: 两类故障语义不同，一个开关无法同时表达“应降级”和“应回退”。
  `action`: 增加 `--fail-primary-mode auth|network` 与两个互斥断言开关。
  `why`: smoke 要能区分预期，否则会把正确降级误判为回退失败。

## reviewVerdict

`passed`。两类故障都有真实上游证据；回退路径确实调到了 MiniMax 并产出非空、guard pass 的回复；正常路径未受影响；lint/tsc/全量全绿；engine-core 零改动。鉴权失败不回退是既有生产语义，已作为决策项登记，不在本任务擅自变更。

## 变更文件

- `bin/visitor-render-smoke.ts`（修改）
- `docs/worklog/completed/phase2.5/af264-visitor-fallback-smoke-2026-11-22.md`（本任务）
- `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-264/`
- `docs/team/agent-orchestration/` 状态面

## commit message

`feat(af264): 来访者主候选鉴权降级与传输回退真实 smoke`
