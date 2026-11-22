# AF-260 · 引擎渲染豆包多轮连续 smoke（2026-11-22）

## 结论

通过。生产 `RouterChatCaller` 路径在同一进程连续 6 轮真实豆包请求全轮命中 `doubao-seed-character-260628`，历史随轮次进入 `RenderSpec.recentTurns`（prompt token 从 745 递增到 879），第 3 轮开始主动承接前文“跟妈妈吵架”，未出现空输出、降级或备候选回退。AF-258/259 的 `visitor-render-multi-turn-smoke` 由此关闭。

## scopeCheck

- `bin/visitor-render-smoke.ts`：新增 `--turns`、多轮历史装配、逐轮校验与逐轮摘要；在 scope 内。
- `docs/worklog/completed/phase2.5/af260-render-multi-turn-smoke-2026-11-22.md`：本交付记录；在 scope 内。
- `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-260/`：任务单、manifest、回执；在 scope 内。
- 未暂存 `web/orchestration/data.js` 的并行本地改动；`data/af260-*.log` 仅为本机取证日志，不提交。
- 未改 `src/`、`test/`、生产 `.env`。

## contractChecks

- 分支 `task/AF-260-render-multi-turn-smoke` 自 `integrate 766aca7f` 切出；状态 `submitted`。
- `--turns` 默认 1，单轮行为与 AF-259 兼容；多轮时第 N 轮把上一轮 counselor/visitor 都追加进 `recentTurns`。
- 每轮独立校验：非空、`providerHint=doubao`、`degraded=false`、`fallbackUsed=false`；任一轮失败立即非 0 退出并标明轮次。
- 输出保留单轮顶层字段，新增 `turns`、`totalUsage`、`turnDetails`。
- 未打印 API key 与完整 prompt；未改 `src/engine-core`。

## gateResults

- 定向回归：`pnpm exec vitest run test/engine-adapters/af258-llm-service-chat-caller.spec.ts test/engine-adapters/af252-visitor-render-provider.spec.ts` → 2 files / 10 passed，exit 0。
- lint：`pnpm lint` → 0 error / 0 warning，exit 0。
- CI 同口径 typecheck：`pnpm exec tsc --noEmit -p tsconfig.json` → 0 error，exit 0。
- 全量：`pnpm test` → 260 passed + 1 skipped files / 4258 passed + 4 skipped tests，exit 0。
- engine-core：`git diff --stat HEAD -- src/engine-core` 为空。

真实 6 轮 smoke（`pnpm exec tsx bin/visitor-render-smoke.ts --caller router --provider doubao --turns 6 --max-tokens 160 --timeout-ms 45000`）：

| 轮 | 咨询师 | chars | ttftMs | promptTokens | completionTokens | 来访回复 |
| -- | ------ | ----- | ------ | ------------ | ---------------- | -------- |
| 1 | 最近这一周，你睡得怎么样？ | 4 | 611 | 745 | 3 | 不太好。 |
| 2 | 听起来夜里很难熬，白天会补觉吗？ | 17 | 759 | 768 | 13 | 会，躺床上刷手机，能眯一两个钟头。 |
| 3 | 躺下之后，有没有什么事一直在脑子里转？ | 11 | 561 | 800 | 10 | 就上周跟我妈吵的那架。 |
| 4 | 这种状态大概持续多久了？ | 11 | 590 | 826 | 8 | 吵完就这样了，快一周。 |
| 5 | 你希望我们今天从哪里开始聊？ | 7 | 760 | 852 | 6 | 就聊吵架的事？ |
| 6 | 如果这周试着记录一下睡眠，你觉得可行吗？ | 11 | 500 | 879 | 9 | 应该行吧？就是怕我忘。 |

- 全轮 `providerHint=doubao`、`model=doubao-seed-character-260628`、`finishReason=stop`、`guardLevel=pass`。
- 全场 `fallbackUsed=false`、`degraded=false`；`totalUsage` prompt 4870 / completion 49 / total 4919。
- 历史生效：第 3 轮起主动承接“跟妈妈吵架”，第 4 轮回答“快一周”，第 5 轮把话题收束到吵架事件。

## backlogItems

- `doubao-cost-per-provider`：usage 已逐轮回传，但 `session_cost_summary` 仍按统一 token 汇总；豆包与 MiniMax 单价不同，未按 provider 分账；影响成本观测准确性。
- `visitor-render-router-retry-smoke`：本 smoke 只覆盖路由成功分支，未覆盖主候选失败后切 MiniMax 回退的真实网络分支。
- `visitor-render-concurrency-smoke`：6 轮是串行；并发多会话、429/5xx、超时与重试尚未验证。
- `visitor-render-long-context-smoke`：6 轮 prompt 仅到 879 token；长对话摘要 `sessionSummary` 触发点与窗口裁剪尚未验证。

## deviationTable

- `taskSays`: 6 轮可用固定咨询师台词。
  `reality`: CLI 内置 6 条按时序递进的台词；`--prompt` 只覆盖第 1 轮。
  `action`: 在任务说明与记录中固定台词序列，保证可复现。
  `why`: 若每轮随机台词，无法比较 prompt 增长与历史承接；固定序列让证据可复跑。

## reviewVerdict

`passed`。scope 与提交事实一致；六组机读字段齐全；定向 10 例、lint、CI 同口径 tsc、全量 4258 例全绿；6 轮真实生产路由豆包 smoke 全轮命中主候选、历史承接可见、无空输出无降级无回退；engine-core 零改动。

## 变更文件

- `bin/visitor-render-smoke.ts`（修改：多轮执行、历史装配、逐轮校验与摘要）
- `docs/worklog/completed/phase2.5/af260-render-multi-turn-smoke-2026-11-22.md`（本任务）
- `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-260/`（任务单、manifest、回执）
- `docs/team/agent-orchestration/` 状态面

## commit message

`feat(af260): 渲染 smoke 支持豆包多轮连续上下文`
