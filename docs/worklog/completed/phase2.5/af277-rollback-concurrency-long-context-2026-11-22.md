# AF-277 · 回滚态并发、40 轮长上下文与故障回退组合验证

## 一、结论

回滚态（来访者主候选 = MiniMax-M3、豆包备候选 = `doubao-seed-character-260628`）的四条生产证据全部成立：

1. **候选链自检**：`minimax,doubao`，两家 `candidateApiKeys.present=true`。
2. **回滚态并发 8**：8/8 走 MiniMax，零回退、零降级，全部 `finishReason=stop`，wall 5508ms。
3. **回滚态 8 路并行 429 回退**：8/8 回退到豆包 Seed Character，零降级，wall 531–773ms。
4. **回滚态门面 40 轮**：40/40 MiniMax，零回退、零降级，全部 stop；prompt tokens 在第 9 轮后封顶在约 1199–1253；摘要从第 20 轮起进入 prompt；wall 59858ms。

同时发现一条必须先登记的生产风险：**MiniMax 的 reasoning token 会吃穿小预算**。同一门面 40 轮用 `--max-tokens 120` 时，第 1 轮就被 reasoning 耗尽预算、零可见台词，门面判降级并中止。回滚态下不能用豆包时代的 120 预算，至少需要 400。

## 二、验证环境与命令

真实上游、真实 router 调用链，未 mock 上游。所有命令在 `task/AF-277-rollback-concurrency-long-context` 上执行，基线 `03a9496a`。

| # | 场景 | 命令 | 结果 |
| --- | --- | --- | --- |
| 1 | 候选链自检 | `pnpm exec tsx bin/visitor-switch-check.ts --expect-primary minimax --simulate-visitor-provider minimax` | exit 0 |
| 2 | 回滚态并发 | `pnpm exec tsx bin/visitor-render-smoke.ts --provider minimax --caller router --turns 1 --concurrency 8` | exit 0 |
| 3 | 8 路并行 429 回退 | 8 个独立进程并行执行 `... --turns 1 --fail-primary --fail-primary-mode rate-limit --expect-fallback` | 8/8 exit 0 |
| 4 | 回滚态门面 40 轮 | `pnpm exec tsx bin/visitor-render-smoke.ts --provider minimax --orchestrated --turns 40 --summary-after 20 --max-tokens 400 --timeout-ms 60000` | exit 0 |

取证日志：

- `data/af277-check.log`
- `data/af277-concurrency8.log`
- `data/af277-fallback-parallel-{1..8}.log`、`data/af277-fallback-parallel-summary.log`、`data/af277-fallback-parallel-details.log`
- `data/af277-rollback-40.log`（直连、非门面、`max-tokens` 默认 800）
- `data/af277-rollback-40-orchestrated.log`（120 预算失败）
- `data/af277-rollback-40-orchestrated-400.log`（400 预算通过）

## 三、关键数字

### 3.1 候选链自检

- `visitorRuntime.llmProvider=minimax`，`promptVariant=shared`。
- `engineRender.primary=minimax`，`candidates=[minimax: MiniMax-M3, doubao: doubao-seed-character-260628]`。
- `fallbackProviders=[doubao]`。
- `MINIMAX_API_KEY`、`LLM_DOUBAO_API_KEY` 均 present=true（未打印值）。

### 3.2 回滚态并发 8（无故障）

| 指标 | 值 |
| --- | --- |
| 成功轮次 | 8/8 MiniMax-M3 |
| fallbackUsed / degraded | false / false |
| finishReason | 8/8 stop |
| wall | 5508ms |
| 单轮 elapsed | 1915–5503ms |
| TTFT | 1644–4968ms |
| prompt tokens | 818–821（8 个独立单轮，无历史累积） |
| deltas | 2–3 |

这是“8 个并发单轮请求”，不是 8 条并行长会话；并发模式固定单轮，不能与 `--turns` 叠加。

### 3.3 8 路并行 429 回退

| lane | wall | TTFT | model | fallback | degraded | finish |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 531ms | 517ms | doubao-seed-character-260628 | true | false | stop |
| 2 | 745ms | 538ms | doubao-seed-character-260628 | true | false | stop |
| 3 | 652ms | 636ms | doubao-seed-character-260628 | true | false | stop |
| 4 | 773ms | 761ms | doubao-seed-character-260628 | true | false | stop |
| 5 | 769ms | 756ms | doubao-seed-character-260628 | true | false | stop |
| 6 | 589ms | 577ms | doubao-seed-character-260628 | true | false | stop |
| 7 | 557ms | 503ms | doubao-seed-character-260628 | true | false | stop |
| 8 | 640ms | 627ms | doubao-seed-character-260628 | true | false | stop |

8/8 都在一次 429 后切到豆包，首包 503–761ms，没有走到降级兜底。

### 3.4 回滚态门面 40 轮（400 预算）

| 指标 | 值 |
| --- | --- |
| 成功轮次 | 40/40 MiniMax-M3 |
| fallbackUsed / degraded | false / false |
| finishReason | 40/40 stop |
| wall | 59858ms |
| TTFT | 594–3764ms |
| prompt tokens | 873 → 1210（第 9 轮封顶）→ 1199–1253 平台 |
| 系统提示词字符 | 1091（1–19 轮）→ 1149（20–40 轮） |
| 摘要进入 prompt | 20–40 轮，共 21 轮 |
| 最大单轮耗时 | 第 36 轮 4424ms（reasoning 326 tokens） |
| 最大 TTFT | 第 36 轮 3764ms |

`promptTokensSeries` 第 9 轮 1210、第 10–19 轮 1199–1213、第 20–40 轮 1213–1253，证明 `MAX_HISTORY_TURNS=16` 半轮 = 8 完整轮的窗口封顶在回滚态同样生效，摘要进入后只抬升约 50–60 tokens 后再次平台化。

### 3.5 120 预算失败

`--max-tokens 120` 时第 1 轮：

- 输出 guard `categories=empty`；
- `[TurnRenderOrchestrator] [turnStream] 流式渲染结果为空, 降级为中性兜底句`；
- `[FAIL] 第 1/40 轮（门面）走了降级路径：provider=degraded`。

同一进程在 400 预算下第 1 轮 `completionTokens=150`、`reasoningTokens=124`，说明 120 连“思考 + 一句台词”都不够。MiniMax-M3 在渲染路径虽然默认 `reasoningEffort=low`，仍会产出 100–326 reasoning tokens。

### 3.6 直连 40 轮（非门面）的边界

`--turns 40` 直连路径不经过 `TurnRenderOrchestrator`，history 无界：prompt tokens 从 821 线性涨到 2363，`promptSummaryTurns=[]`。40/40 仍是 MiniMax、零回退，但这条不能用来证明“窗口封顶”，封顶证据只认 3.4 的门面路径。

直连路径还出现 2 次 `guardLevel=block`（第 10、22 轮，`categories=foreign_word`）：MiniMax 输出了英文 “Sorry”，被输出侧词表判 block 后替换成中文兜底句，但顶层 `degraded=false`、`finishReason=stop`。这暴露两个观察点：

- 英文借词在中文来访者台词里会被判 `foreign_word`，实际生产会触发兜底；
- 流式路径的 block 只做替换、不置 `degraded`，与“降级”语义不一致，指标/告警会漏记。

## 四、改了什么

**零代码改动。** 仅新增交付记录与任务记录包，未改 `src/`、`bin/`、`test/`、`.env.example`。

## 五、偏差与设计决策

1. **并发参数互斥**：任务单写的 `--turns 3 --concurrency 8` 不可执行，smoke 明确报 `--concurrency 与 --turns 互斥：并发模式固定单轮`。实际改为 `--turns 1 --concurrency 8`，语义是 8 个并发单轮。
2. **并发与故障注入互斥**：`--concurrency` 不能和 `--fail-primary` 同用。为拿到“并发 + 回退”组合证据，改为 8 个独立进程并行跑同一个 429 回退用例。覆盖的是真实上游并发限流下的回退，但不是单进程内 8 路共享熔断器；共享熔断器并发语义仍未验证。
3. **40 轮预算**：任务单未写 `--max-tokens`。豆包时代 AF-268 用 120 可行，MiniMax 120 会 reasoning 吃穿预算。实际用 400；120 的失败作为独立发现保留。
4. **直连 40 轮不作为封顶证据**：直连路径无界，只有 `--orchestrated` 才走生产门面。记录中明确区分，避免把 2363 的增长误读成“封顶失效”。

## 六、遗留项

- `visitor-minimax-reasoning-token-budget-floor`：回滚态渲染的最小 `maxCompletionTokens` 需要按模型设下限或按 reasoning 观测动态抬升，不能沿用豆包 120。
- `visitor-stream-block-degraded-semantics`：流式输出 block 替换兜底句时 `degraded=false`，需要统一语义或单独计数。
- `visitor-concurrency-fault-injection`：单进程内并发 + 故障注入互斥，共享熔断器在并发故障下的行为未验证。
- `visitor-stream-idle-observability`：idle / first-delta / auth / fallback / degraded 仍无 Prometheus 指标。
- `visitor-smoke-stream-timeout-flags`：smoke CLI 仍无独立 idle / 首包参数。

## 七、机读标记

### gateResults（闸门结果）

- 候选链自检 exit 0；回滚态并发 8 exit 0；8 路并行 429 回退 8/8 exit 0；回滚态门面 40 轮 exit 0。
- 回滚态 40 轮：40/40 MiniMax，fallback false，degraded false，stop 40/40。
- `pnpm lint` exit 0（0 error / 0 warning）；`pnpm typecheck` exit 0。
- 全量 `pnpm test` 首跑 1 例失败：`test/admin-debug/debug-session-persistence.spec.ts` 的标题生成 `waitFor` 10s 超时（与渲染链路无关）。定向复跑该文件 28/28 通过；全量复跑 268 files passed + 1 skipped；4304 tests passed + 4 skipped，22.52s。判定为全量并发下的既有偶发，不是本任务引入。
- engine-core：`git diff --stat HEAD -- src/engine-core` 为空。

### scopeCheck（范围核对）

改动仅落在任务单 scope：`docs/worklog/completed/phase2.5/` 与 `docs/worklog/records/phase2.5-orchestration-closed-loop/`。未改 `src/`、`bin/`、`test/`、`admin-dashboard/`、Flutter。

### contractChecks（契约核对）

- taskId：分支名与提交标题只含 AF-277。
- state-write：register / promote / run-once / branch 均经 CLI，状态索引与事件链未手改。
- index-schema：回执六组字段齐全。
- engine-boundary：engine-core 零改动。

### backlogItems（遗留项）

- `visitor-minimax-reasoning-token-budget-floor`
- `visitor-stream-block-degraded-semantics`
- `visitor-concurrency-fault-injection`
- `visitor-stream-idle-observability`
- `visitor-smoke-stream-timeout-flags`

### deviationTable（偏差说明）

1. `--turns 3 --concurrency 8` 不可用，改为 `--turns 1 --concurrency 8`。
2. 并发与故障注入互斥，改用 8 个独立进程并行验证 429 回退。
3. 40 轮门面预算从豆包时代的 120 抬到 400；120 失败单独记录。
4. 直连 40 轮无界，不作为窗口封顶证据。

### reviewVerdict（验收结论）

passed。回滚态四条证据全部成立；零代码改动；全量 4304 例保持全绿；engine-core 零改动。新发现三条生产风险均已登记为遗留项，其中 reasoning 预算下限需要在下一任务中优先处理。
