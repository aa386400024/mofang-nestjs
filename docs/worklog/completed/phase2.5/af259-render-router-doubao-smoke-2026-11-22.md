# AF-259 · 引擎渲染生产 RouterChatCaller 豆包 smoke（2026-11-22）

## 结论

通过。`bin/visitor-render-smoke.ts` 新增 `--caller router|llm-service`，默认 `router`；router 路径用真实 `ProviderRegistryService` + `DoubaoChatProvider` + `LlmRouterService` + `RouterChatCaller` 跑生产路由链，真实豆包请求命中 `doubao-seed-character-260628`，文本非空、usage 非全 0、无回退无降级。AF-258 backoff 的 `visitor-render-router-smoke` 由此关闭。

## scopeCheck

- `bin/visitor-render-smoke.ts`：新增 caller 路径选择与生产 router 装配；在 scope 内。
- `docs/worklog/completed/phase2.5/af259-render-router-doubao-smoke-2026-11-22.md`：本交付记录；在 scope 内。
- `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-259/`：任务单、manifest、回执；在 scope 内。
- 未暂存 `web/orchestration/data.js` 的并行本地改动；`data/af259-*.log` 仅为本机取证日志，不提交。
- 未改 `src/`、`test/`、生产 `.env`。

## contractChecks

- 分支 `task/AF-259-render-router-doubao-smoke` 自 `integrate b13f4e1b` 切出；状态 `submitted`。
- `--caller` 默认 `router`，`llm-service` 保留为 AF-258 对照路径；router 当前只接受 `--provider doubao`，避免把未注册的 MiniMax 伪装成生产路由。
- 生产路由链完整：`RenderConfigFactory → buildEngineRenderPort → LlmRenderAdapter → RouterChatCaller → LlmRouterService → DoubaoChatProvider`。
- 未打印 API key 与完整 prompt；smoke 只在进程内覆写 `VISITOR_LLM_PROVIDER` / `ENGINE_RENDER_MAX_TOKENS` / `ENGINE_RENDER_TIMEOUT_MS` / `LLM_DEFAULT_CHAT_PROVIDER`。
- 未改 `src/engine-core`：`git diff --stat HEAD -- src/engine-core` 为空。

## gateResults

- 定向 chat caller + 渲染回归：`pnpm exec vitest run test/engine-adapters/af258-llm-service-chat-caller.spec.ts test/engine-adapters/af252-visitor-render-provider.spec.ts` → 2 files / 10 passed，exit 0。
- lint：`pnpm lint` → 0 error / 0 warning，exit 0。
- CI 同口径 typecheck：`pnpm exec tsc --noEmit -p tsconfig.json` → 0 error，exit 0。
- 全量：`pnpm test` → 260 passed + 1 skipped files / 4258 passed + 4 skipped tests，exit 0。
  - 首次全量出现 1 例无关超时 `test/admin-debug/debug-session-persistence.spec.ts > 跑满 3 轮 → 自动生成标题`（`waitFor 10000ms`）；单跑该文件 28/28 通过，随后全量重跑 4258 全绿，判定为环境抖动，非本任务引入。
- engine-core：`git diff --stat HEAD -- src/engine-core` 为空。

真实生产 router smoke 输出：

```json
{
  "ok": true,
  "callerPath": "router",
  "requestedProvider": "doubao",
  "configuredCandidates": [
    { "id": "doubao", "chatModel": "doubao-seed-character-260628" },
    { "id": "minimax", "chatModel": "MiniMax-M3" }
  ],
  "providerHint": "doubao",
  "model": "doubao-seed-character-260628",
  "elapsedMs": 781,
  "ttftMs": 552,
  "deltas": 2,
  "chars": 22,
  "usage": { "completionTokens": 17, "totalTokens": 762, "promptTokens": 745, "reasoningTokens": 0 },
  "finishReason": "stop",
  "fallbackUsed": false,
  "degraded": false,
  "guardLevel": "pass",
  "preview": "不太好。翻来覆去的，要躺一两个小时才能睡着。"
}
```

- 路径确认：`callerPath=router`，`ProviderRegistryService` 日志 `Registered chat provider: doubao`。
- 主候选确认：`providerHint=doubao`，`model=doubao-seed-character-260628`。
- 文本非空：22 字，2 个 delta chunk，首 token 552ms。
- usage 非全 0：prompt 745 / completion 17 / total 762。
- 未回退、未降级：`fallbackUsed=false`、`degraded=false`、`guardLevel=pass`。

## backlogItems

- `doubao-cost-per-provider`：usage 已回传，但 `session_cost_summary` 仍按统一 token 汇总，豆包与 MiniMax 单价不同，未按 provider 分账；影响成本观测准确性。
- `visitor-render-multi-turn-smoke`：只验证单轮最小 RenderSpec；多轮、长对话、并发、429/5xx、超时与重试行为尚未验证。
- `visitor-render-router-retry-smoke`：本 smoke 只覆盖路由成功分支，未覆盖 `RouterChatCaller` 在主候选失败后切 MiniMax 回退的真实网络分支。

## deviationTable

- `taskSays`: `--caller router|llm-service`，默认 `router`。
  `reality`: 已实现；router 路径当前仅支持 `--provider doubao`，其他 provider 直接显式失败。
  `action`: 在 CLI 中加前置校验，并在记录中说明。
  `why`: 本任务只注册豆包 provider；若允许 `minimax` 会调到一个未注册的 provider，产生假路由结论。
- `taskSays`: router 路径用真实 `ProviderRegistryService` + `DoubaoChatProvider` + `LlmRouterService` + `RouterChatCaller`。
  `reality`: 完全按生产构造链装配，`LLM_DEFAULT_CHAT_PROVIDER` 在进程内设为 `doubao`。
  `action`: 输出新增 `callerPath` 字段，便于回执与后续 smoke 区分两条链路。
  `why`: 防止把 AF-258 的 `llm-service` 结果误认为生产 router 结果。

## reviewVerdict

`passed`。scope 与提交事实一致；六组机读字段齐全；定向 10 例、lint、CI 同口径 tsc、全量 4258 例全绿；真实生产 `RouterChatCaller` 豆包 smoke 命中主候选、文本非空、usage 非全 0、无回退无降级；engine-core 零改动。

## 变更文件

- `bin/visitor-render-smoke.ts`（修改：caller 路径与生产 router 装配）
- `docs/worklog/completed/phase2.5/af259-render-router-doubao-smoke-2026-11-22.md`（本任务）
- `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-259/`（任务单、manifest、回执）
- `docs/team/agent-orchestration/` 状态面

## commit message

`feat(af259): 渲染 smoke 接入生产 RouterChatCaller 豆包链路`
