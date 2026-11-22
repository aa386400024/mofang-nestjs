# AF-255 · 引擎渲染路径豆包端到端 smoke 交付记录（2026-11-22）

## 结论

通过。新增 `LlmServiceChatCaller` 把真实 `LlmService.streamChat` 映射为引擎渲染所需的 `ChatCaller.stream`，并新增 `bin/visitor-render-smoke.ts` 走完 `RenderConfigFactory → buildEngineRenderPort → LlmRenderAdapter → ChatCaller → LlmService → 豆包` 全链。真实调用一次成功：主候选命中 `doubao-seed-character-260628`，文本非空，usage 非全 0，未触发回退与降级，guard 通过。

## scopeCheck

- `src/engine-adapters/wiring/llm-service-chat-caller.ts`：新增，`ChatCaller` 适配器与消息/用量映射；在 `src/engine-adapters/wiring/` scope 内。
- `test/engine-adapters/af255-llm-service-chat-caller.spec.ts`：新增 4 例；在 `test/engine-adapters/` scope 内。
- `bin/visitor-render-smoke.ts`：新增真实渲染 smoke CLI；在 `bin/` scope 内。
- `docs/worklog/completed/phase2.5/af255-render-doubao-smoke-2026-11-22.md`：本交付记录；在 `docs/worklog/completed/phase2.5/` scope 内。
- `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-255/`：任务单、manifest、回执；在 `docs/worklog/records/phase2.5-orchestration-closed-loop/` scope 内。
- 未出现 scope 外业务文件；`web/orchestration/data.js` 的并行本地改动没有进入本任务提交；`data/af255-*.log` 仅为本机取证日志，不提交。

## contractChecks

- 任务单 frontmatter 完整：`taskId`、`contextId`、`type: implementation`、`baselineRef: 393cb30c`、`dependsOn: [AF-253]`、`priorTasks: [AF-254]`、`scope`、`gates`、`artifacts`。
- stacked 关系显式：本任务从 `integrate` `393cb30c` 切出，`priorTasks` 指向已取消的 AF-254，依赖仅指向已合入的 AF-253。
- 回执六组字段齐全：`gateResults`、`scopeCheck`、`contractChecks`、`backlogItems`、`deviationTable`、`reviewVerdict`，另含 `taskId`、`recordedAt` 与 `changedFiles`。
- 回执 JSON 为完整根对象；`backlogItems` 使用 `{id, impact}`；`deviationTable` 使用 `{taskSays, reality, action, why}`。
- 未改 `src/engine-core`：`git diff --stat HEAD -- src/engine-core` 为空。
- 未改生产 `.env`：smoke 只在进程内覆写 `VISITOR_LLM_PROVIDER` / `ENGINE_RENDER_MAX_TOKENS` / `ENGINE_RENDER_TIMEOUT_MS`；未打印 key 与完整 prompt。

## gateResults

- 定向 chat caller：`pnpm exec vitest run test/engine-adapters/af255-llm-service-chat-caller.spec.ts` → 1 file / 4 passed，exit 0。
- 定向渲染回归：`pnpm exec vitest run test/engine-adapters/af255-llm-service-chat-caller.spec.ts test/engine-adapters/af252-visitor-render-provider.spec.ts` → 2 files / 10 passed，exit 0。
- 定向 lint：`pnpm exec eslint src/engine-adapters/wiring/llm-service-chat-caller.ts test/engine-adapters/af255-llm-service-chat-caller.spec.ts bin/visitor-render-smoke.ts` → exit 0。
- lint：`pnpm lint` → 0 error，exit 0。
- CI 同口径 typecheck：`pnpm exec tsc --noEmit -p tsconfig.json` → 0 error，exit 0。
- 全量：`pnpm test` → 260 passed + 1 skipped files / 4258 passed + 4 skipped tests，exit 0。
- 真实 smoke：`pnpm exec tsx bin/visitor-render-smoke.ts --provider doubao --max-tokens 160 --timeout-ms 45000` → exit 0。

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
  "elapsedMs": 1023,
  "ttftMs": 868,
  "deltas": 2,
  "chars": 23,
  "usage": { "completionTokens": 17, "totalTokens": 762, "promptTokens": 745 },
  "finishReason": "stop",
  "fallbackUsed": false,
  "degraded": false,
  "guardLevel": "pass",
  "preview": "不太好。躺下总翻来覆去，得一两个钟头才能睡着。"
}
```

- 主候选确认：`providerHint=doubao`，`model=doubao-seed-character-260628`。
- 文本非空：23 字，2 个 delta chunk，首 token 868ms。
- usage 非全 0：prompt 745 / completion 17 / total 762。
- 未回退、未降级：`fallbackUsed=false`、`degraded=false`、`guardLevel=pass`。

## backlogItems

- `doubao-cost-per-provider`：usage 已能回传，但 `session_cost_summary` 仍按统一 token 汇总，豆包与 MiniMax 单价不同，未按 provider 分账；影响成本观测准确性。
- `visitor-render-router-smoke`：本 smoke 使用 `LlmServiceChatCaller` 直连 `LlmService`，未覆盖生产装配的 `RouterChatCaller` 路由与重试分支；影响生产切换的最后一段信心。
- `visitor-render-multi-turn-smoke`：只验证单轮最小 RenderSpec；多轮、长对话、并发、429/5xx 与超时行为尚未验证。

## deviationTable

- `taskSays`: smoke 应走生产 `ChatCaller` 链路。
  `reality`: 本任务新增 `LlmServiceChatCaller` 直连 `LlmService`，没有使用生产装配的 `RouterChatCaller`。
  `action`: 在 smoke 与记录中显式标注该边界，真实调用仍覆盖 `RenderConfigFactory → LlmRenderAdapter → ChatCaller → LlmService → 豆包`。
  `why`: 任务目标第 1 条明确要求新增可复用的 `LlmServiceChatCaller`，用最小适配面先证明渲染适配器与豆包 provider 能端到端出话；Router 分支另列 backlog。
- `taskSays`: 真实 smoke 只读 `.env`，不改生产环境。
  `reality`: CLI 在进程内覆写 `VISITOR_LLM_PROVIDER` 等三个变量，不写回 `.env`。
  `action`: 记录进程内覆写范围，并确认未打印 key 与完整 prompt。
  `why`: 保证默认生产配置不被 smoke 污染，同时让单次命令可复现豆包路径。

## reviewVerdict

`passed`。scope 声明与提交事实一致；六组机读字段齐全；定向 10 例、lint、CI 同口径 tsc、全量 4258 例全绿；真实豆包渲染 smoke 命中主候选、文本非空、usage 非全 0、无回退无降级；engine-core 零改动。

## 变更文件

- `src/engine-adapters/wiring/llm-service-chat-caller.ts`（新增）
- `test/engine-adapters/af255-llm-service-chat-caller.spec.ts`（新增）
- `bin/visitor-render-smoke.ts`（新增）
- `docs/worklog/completed/phase2.5/af255-render-doubao-smoke-2026-11-22.md`（本任务）
- `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-255/`（任务单、manifest、回执）
- `docs/team/agent-orchestration/` 状态面（snapshot、journal、task-state-index）

## commit message

`feat(af255): 用真实豆包跑通引擎渲染端到端 smoke`
