# AF-265 · 来访者渲染并发 smoke（2026-11-22）

## 结论

通过。同一渲染端口 8 路并发全部命中豆包，输出非空、无降级、无备候选回退；8 路总墙钟 908ms，TTFT 520–808ms，无串话、无共享状态互踩。串行 6 轮保持原行为。

## scopeCheck

- `bin/visitor-render-smoke.ts`：新增 `--concurrency N`，抽出 `executeSessions` 与 `printReport`；在 scope 内。
- `docs/worklog/completed/phase2.5/af265-visitor-concurrency-smoke-2026-11-22.md`：本交付记录；在 scope 内。
- `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-265/`：任务单、manifest、回执；在 scope 内。
- 未改 `.env`；未暂存 `web/orchestration/data.js` 与 `data/` 取证日志。

## contractChecks

- 分支 `task/AF-265-visitor-concurrency-smoke` 自 `integrate 6bada58a` 切出。
- 并发模式固定单轮，与 `--turns`、`--prompt`、故障注入开关互斥，避免语义歧义。
- 每路独立 `history=[]` 与不同咨询师开场，避免同文案掩盖串话。
- 未改 `src/engine-core` 与渲染适配器实现，只扩展 smoke CLI。

## gateResults

- 8 路并发：`pnpm exec tsx bin/visitor-render-smoke.ts --caller router --provider doubao --concurrency 8 --max-tokens 120 --timeout-ms 60000` → exit 0；8/8 `providerHint=doubao`、`model=doubao-seed-character-260628`、`fallbackUsed=false`、`degraded=false`、`finishReason=stop`、`guardLevel=pass`；`wallElapsedMs=908`；TTFT `520/795/808/557/735/724/718/751ms`；chars `22/19/19/7/10/19/10/13`；`totalUsage` 5952/93/6045；日志 `data/af265-concurrency8.log`。
- 串行 6 轮：`--turns 6 --max-tokens 160` → exit 0；6/6 `providerHint=doubao`、`fallbackUsed=false`、`degraded=false`；`wallElapsedMs=3615`；`totalUsage` 4879/56/4935；日志 `data/af265-normal6.log`。
- lint：`pnpm lint` → 0 error / 0 warning。
- CI 同口径 typecheck：`pnpm exec tsc --noEmit -p tsconfig.json` → 0 error。
- 全量：`pnpm test` → 261 passed + 1 skipped files / 4264 passed + 4 skipped tests，exit 0。
- engine-core：`git diff --stat HEAD -- src/engine-core` 为空。

## backlogItems

- `visitor-failover-concurrency-smoke`：并发下的故障回退未验证（本任务只测主候选健康路径）。
- `visitor-stress-ladder`：未做阶梯升压（16/32 路）与持续压测。
- `visitor-429-concurrency`：未覆盖 429/5xx 下多路并发同时触发冷却与半开探测。

## deviationTable

无偏差。`--concurrency` 为新增开关，串行路径行为未变。

## reviewVerdict

`passed`。8 路并发全绿，延迟与输出规模落在预期；共享渲染端口未出现串话或状态互踩；串行路径无回归；lint/tsc/全量全绿；engine-core 零改动。

## 变更文件

- `bin/visitor-render-smoke.ts`（修改）
- `docs/worklog/completed/phase2.5/af265-visitor-concurrency-smoke-2026-11-22.md`（本任务）
- `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-265/`
- `docs/team/agent-orchestration/` 状态面

## commit message

`feat(af265): 来访者渲染 8 路并发 smoke`
