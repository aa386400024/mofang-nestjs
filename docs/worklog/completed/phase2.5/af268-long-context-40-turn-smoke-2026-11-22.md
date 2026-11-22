# AF-268 · 来访者长上下文 40 轮真实路由 smoke — 交付记录（2026-11-22）

## 结论

真实 `TurnRenderOrchestrator` 门面下跑满 40 轮豆包角色模型，**40/40 走 `doubao-seed-character-260628`，零回退、零降级、零空输出**，全部 `finishReason=stop`。

两条「长上下文」关键证据都成立：

1. **上下文在窗口处封顶。** 真实上游 `promptTokens` 从第 1 轮 799 逐轮上升到第 9 轮 1046，之后在 ~1049–1059 平台震荡（第 9–19 轮），不再线性增长。`MAX_HISTORY_TURNS = 16` 半轮 = 8 个完整对话轮，正好在第 9 轮填满。
2. **滚动摘要真的进了 system prompt。** 第 1–19 轮 `promptHasSummary=false`，系统提示词字符数恒定 1091；第 20 轮起 `promptHasSummary=true`，系统提示词字符数跳到 1149（+58），此后 21 轮保持 1149。`promptTokens` 同时从 ~1049 抬到 ~1093–1124，说明摘要不是旁路日志，而是进入了真实请求体。

## 改了什么

仅改 `bin/visitor-render-smoke.ts`，生产代码零改动，`src/engine-core` 零改动。

### 1. 新增 `--orchestrated` 门面模式

不再直接调 `port.streamRender` 并自持无界 history，而是构造真实 `TurnRenderOrchestrator`：

- `session`：假内核会话 `buildFakeSession()`，`openSession` 返回固定 handle，`turn` 只递增轮次并返回固定中性 `BdiSnapshot`（render 只依赖 trust/safety/bond/emotion/resistance/transference/coreBeliefs）；不模拟 BDI 决策，符合任务非目标。
- `renderer`：真实 `StreamingRenderPort`（`buildEngineRenderPort` + 真实 router / LlmService），即真实豆包上游。
- `memories`：只读空实现，不写库。
- `resolveSession`：固定 `af268-smoke / af268-session / af268-visitor` 三元组。
- `tokenBudget`：`contextTokens=512`（可 `--context-tokens` 覆盖）、`maxCompletionTokens` 取 `--max-tokens`。

每轮调 `turnStream(handleId, {userText}, {onDelta}, {includePromptFull: true})`，历史裁剪、`fitContextToBudget`、规格组装、摘要读取全部走生产门面。

### 2. 新增 `--summary-after N` 摘要桩

`buildSummaryStub(afterTurns)` 实现 `RollingSummaryPort`：

- `recordRound` 递增计数；
- `latestSummary` 在 `recordedTurns + 1 >= N` 时返回固定三段摘要 `核心议题：睡眠困扰；关键事件：夜里反复醒来；情绪转折：从疲惫到愿意尝试记录。`

固定文案让「摘要是否进 prompt」可机读判定，不依赖真实摘要 LLM（真实摘要生成由 WP37/WP55 既有测试覆盖）。

### 3. 机读报告新增字段

- 每轮 `promptChars`：`promptFull.length`；
- 每轮 `promptHasSummary`：`promptFull.includes('此前我们聊过')`；
- 顶层 `promptCharsSeries`、`promptTokensSeries`、`promptSummaryTurns`、`historyLimitTurns`、`orchestrated`、`summaryAfter`。

### 4. 边界断言复用

抽出 `assertSmokeOutcome()`，直连端口路径与门面路径共用同一套断言：reply 非空、非兜底句、期望 provider、`fallbackUsed`、`degraded`。

门面 `TurnRenderResult.render` **没有 `degraded` 字段**，门面模式下 `degraded = providerHint === 'degraded'`，与生产语义对齐。

### 5. 参数互斥与复杂度治理

- `--orchestrated` 与 `--concurrency` 互斥；
- `--orchestrated` 暂不与 `--fail-primary` / `--expect-fallback` / `--expect-degraded` 同时使用（故障注入仍走 AF-264 直连路径）；
- 参数解析与校验抽成 `resolveRunOptions()`，`main()` 的 Cognitive Complexity 从 28 降到阈值内。

## 实测结果

命令：

```powershell
pnpm exec tsx bin/visitor-render-smoke.ts --orchestrated --turns 40 --summary-after 20 --max-tokens 120 --timeout-ms 60000
```

证据日志：`data/af268-smoke40.log`（未提交，含真实上游返回与会话内容，不进仓库）。

| 指标 | 结果 |
| --- | --- |
| exit code | 0 |
| 轮次 | 40 |
| providerHint | 40/40 `doubao` |
| model | `doubao-seed-character-260628` |
| fallbackUsed | false |
| degraded | false |
| finishReason | 40/40 `stop` |
| 墙钟 | 29 644 ms |
| totalUsage | 42 145 prompt / 573 completion / 42 718 total |
| TTFT | 517–1255 ms |
| 每轮字符数 | 9–39 |
| historyLimitTurns | 16 |
| 摘要出现轮次 | 20–40 |

`promptTokens` 序列（关键窗口证据）：

```text
799,826,857,882,916,953,979,1010,1046,1055,1057,1059,1057,1053,1055,1059,1058,1053,1049,
1093,1097,1107,1111,1107,1099,1117,1124,1121,1117,1111,1104,1116,1123,1114,1104,1111,1108,1113,1116,1109
```

`promptChars`（system prompt 字符数）：

```text
前 19 轮 1091；第 20–40 轮 1149
```

逐轮 `providerHint`：

```text
doubao × 40
```

## 闸门

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 类型 | `pnpm exec tsc --noEmit -p tsconfig.json` | exit 0 |
| lint | `pnpm lint` | 0 error / 0 warning，exit 0 |
| smoke | 上述 40 轮命令 | exit 0，40/40 豆包，无回退无降级 |
| 纯层 | `git diff --stat HEAD -- src/engine-core` | 空 |

## 关键设计决策与偏差

1. **偏差：`promptChars` 只量 system prompt。** 生产 `buildPromptFull()` 只取 `messages` 里的 system 消息，不含 history/user 消息。单看 `promptChars` 不能证明历史窗口封顶，因此补了 `promptTokensSeries`（真实上游 usage，含完整请求体）作为窗口封顶证据。任务单第 47 行「每轮记录 prompt 字符数」已满足，第 48 行「prompt 在窗口封顶后不再线性增长」以 `promptTokens` 序列证明。
2. **偏差：门面无 `degraded`。** 门面结果只有 `providerHint`，故 `degraded = providerHint === 'degraded'`。直连路径仍用原 `degraded` 字段。
3. **摘要措辞耦合。** `promptHasSummary` 依赖 `spec-assembler` 的固定措辞「此前我们聊过」。措辞一旦改动，本 smoke 会误报 false；已在脚本内用常量注释标注，后续改措辞需同步。
4. **假内核会话不验证 BDI 质量。** 只验证渲染门面的历史/摘要/上下文预算链路，不评价来访话语义质量；语义质量由既有来访者评测链路负责。
5. **未改生产门面。** `MAX_HISTORY_TURNS`、`fitContextToBudget`、`spec-assembler`、`llm-render.adapter` 全部零改动。

## 已知缺口

- 未验证真实滚动摘要 LLM 生成质量与失败回退；本任务只验证「摘要读取 → prompt 接线」。
- 未验证超长会话（>100 轮）下摘要压缩是否会造成关键信息丢失；当前 40 轮只覆盖一次摘要注入。
- 未覆盖限流 / 5xx / 超时三类上游故障的候选切换；401 鉴权失败仍走快速降级（AF-264 已登记 `visitor-auth-failure-fallback-policy`）。

## 回执字段速览

- `gateResults`：tsc exit 0、lint 0/0、40 轮 smoke exit 0、全量 4269 passed + 4 skipped、engine-core diff 为空。
- `scopeCheck`：in-scope，只改 `bin/visitor-render-smoke.ts` 与 AF-268 记录/交付文档。
- `contractChecks`：taskId 单任务号、状态写入全经 CLI、回执六组字段闭合、AF-263/264/265 兼容、未触碰 engine-core。
- `backlogItems`：`visitor-long-session-summary-loss`、`visitor-upstream-fault-fallback`。
- `deviationTable`：`promptChars` 只量 system prompt，以 `promptTokensSeries` 补窗口证据；门面无 `degraded`，改用 `providerHint === 'degraded'`。
- `reviewVerdict`：passed。

## commit message

`feat(af268): 长上下文 40 轮门面 smoke 与摘要注入取证`
