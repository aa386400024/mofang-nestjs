# AF-258 · 从最新 integrate 重新交付引擎渲染豆包 smoke（2026-11-22）

## 结论

通过。AF-255 的实现、单测、真实 smoke 与门禁结果在最新 `integrate` `7435b12f` 上重新落地，代码与行为不变；PR #102 因旧分支状态面事件链与 AF-257 后的 `integrate` 冲突而关闭，本任务用新任务号恢复同一交付，保持事件链单一真相。

## scopeCheck

- `src/engine-adapters/wiring/llm-service-chat-caller.ts`：`ChatCaller` 适配器与消息/用量映射；在 scope 内。
- `test/engine-adapters/af258-llm-service-chat-caller.spec.ts`：4 例；在 scope 内。
- `bin/visitor-render-smoke.ts`：真实渲染 smoke CLI；在 scope 内。
- `docs/worklog/completed/phase2.5/af258-render-doubao-smoke-2026-11-22.md`：本交付记录；在 scope 内。
- `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-258/`：任务单、manifest、回执；在 scope 内。
- 未暂存 `web/orchestration/data.js` 的并行本地改动；`data/af258-*.log` 仅为本机取证日志，不提交。

## contractChecks

- 任务单 frontmatter 完整：`taskId: AF-258`、`type: implementation`、`baselineRef: 7435b12f`、`dependsOn: [AF-257]`、`scope`、`gates`、`artifacts`。
- 实现内容与 AF-255 的 `e3c39abd` 一致；仅单测文件名改为 `af258-*`。
- 回执六组字段齐全：`gateResults`、`scopeCheck`、`contractChecks`、`backlogItems`、`deviationTable`、`reviewVerdict`。
- 未改 `src/engine-core`：`git diff --stat HEAD -- src/engine-core` 为空。
- 未改生产 `.env`：smoke 只在进程内覆写 `VISITOR_LLM_PROVIDER` / `ENGINE_RENDER_MAX_TOKENS` / `ENGINE_RENDER_TIMEOUT_MS`；未打印 key 与完整 prompt。

## gateResults

- 定向 chat caller + 渲染回归：`pnpm exec vitest run test/engine-adapters/af258-llm-service-chat-caller.spec.ts test/engine-adapters/af252-visitor-render-provider.spec.ts` → 2 files / 10 passed（AF-258 4 + AF-252 6），exit 0。
- lint：`pnpm lint` → 0 error，exit 0。
- CI 同口径 typecheck：`pnpm exec tsc --noEmit -p tsconfig.json` → 0 error，exit 0。
- 全量：`pnpm test` → 260 passed + 1 skipped files / 4258 passed + 4 skipped tests，exit 0。
- engine-core：`git diff --stat HEAD -- src/engine-core` 为空。

真实 smoke 关键证据：

```json
{
  "ok": true,
  "requestedProvider": "doubao",
  "configuredCandidates": [
    { "id": "doubao", "chatModel": "doubao-seed-character-260628" },
    { "id": "minimax", "chatModel": "MiniMax-M3" }
  ],
  "providerHint": "doubao",
  "model": "doubao-seed-character-260628",
  "elapsedMs": 691,
  "ttftMs": 484,
  "deltas": 2,
  "chars": 15,
  "usage": { "completionTokens": 13, "totalTokens": 758, "promptTokens": 745 },
  "finishReason": "stop",
  "fallbackUsed": false,
  "degraded": false,
  "guardLevel": "pass",
  "preview": "不太好。总翻来覆去，静不下心。"
}
```

- 主候选确认：`providerHint=doubao`，`model=doubao-seed-character-260628`。
- 文本非空：15 字，2 个 delta chunk，首 token 484ms。
- usage 非全 0：prompt 745 / completion 13 / total 758。
- 未回退、未降级：`fallbackUsed=false`、`degraded=false`、`guardLevel=pass`。

## backlogItems

- `doubao-cost-per-provider`：usage 已回传，但 `session_cost_summary` 仍按统一 token 汇总，豆包与 MiniMax 单价不同，未按 provider 分账；影响成本观测准确性。
- `visitor-render-router-smoke`：本 smoke 使用 `LlmServiceChatCaller` 直连 `LlmService`，未覆盖生产装配的 `RouterChatCaller` 路由与重试分支。
- `visitor-render-multi-turn-smoke`：只验证单轮最小 RenderSpec；多轮、长对话、并发、429/5xx 与超时行为尚未验证。

## deviationTable

- `taskSays`: 从最新 integrate 重新交付 AF-255 的同一批代码。
  `reality`: 代码与行为一致，单测文件名从 `af255-*` 改为 `af258-*`，交付记录与回执重新生成。
  `action`: 在记录中显式说明 AF-255 / PR #102 被关闭的原因。
  `why`: 旧分支的事件序号与 AF-257 后的 integrate 重叠，rebase 会产生两套同序号事件，不能伪造哈希链。
- `taskSays`: smoke 应走生产 `ChatCaller` 链路。
  `reality`: 本任务仍使用 `LlmServiceChatCaller` 直连 `LlmService`，没有使用 `RouterChatCaller`。
  `action`: 显式标注边界，真实调用覆盖 `RenderConfigFactory → LlmRenderAdapter → ChatCaller → LlmService → 豆包`。
  `why`: 任务目标是复用 `LlmServiceChatCaller` 先证明渲染适配器与豆包 provider 端到端出话；Router 分支另列 backlog。

## reviewVerdict

`passed`。scope 与提交事实一致；六组机读字段齐全；定向 10 例、lint、CI 同口径 tsc、全量 4258 例全绿；真实豆包渲染 smoke 命中主候选、文本非空、usage 非全 0、无回退无降级；engine-core 零改动。

## 变更文件

- `src/engine-adapters/wiring/llm-service-chat-caller.ts`（新增）
- `test/engine-adapters/af258-llm-service-chat-caller.spec.ts`（新增）
- `bin/visitor-render-smoke.ts`（新增）
- `docs/worklog/completed/phase2.5/af258-render-doubao-smoke-2026-11-22.md`（本任务）
- `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-258/`（任务单、manifest、回执）
- `docs/team/agent-orchestration/` 状态面

## commit message

`feat(af258): 从最新 integrate 交付引擎渲染豆包 smoke`
