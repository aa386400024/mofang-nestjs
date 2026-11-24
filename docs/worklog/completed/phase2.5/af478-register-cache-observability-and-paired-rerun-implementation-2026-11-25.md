# AF-478 · 缓存命中观测与 paired 600 轮评测交付记录

## 一、交付内容

1. **缓存命中从 provider 到评测报告端到端透传**
   - `ChatCompletionChunk` / `ChatCompletionResponse.usage` 增加可选 `cachedTokens`。
   - OpenAI 兼容 provider 同时解析 `usage_metadata.input_token_details.cache_read`、`prompt_tokens_details.cached_tokens`、`cache_read_input_tokens` 及 `response_metadata` 同形字段；`resolveCachedTokens()` 对负数、字符串、`Infinity` 忽略，0 保留。
   - 流式累计、聚合、重试合并、`StreamRenderOutcome`、`TurnRenderResult`、debug trace、逐轮 row、`metrics.json`、`latency-attribution.json`、报告全部打通。
   - 缺省一律为 `null/undefined`，表示“上游没报”，不拿 0 冒充“没命中”。

2. **修复 paired active 假对照**
   - 根因：`VISITOR_REGISTER_MODE` 默认 `off`，`registerMode='active'` 只是传字段，解析器仍按全局开关返回空语域；两臂 prompt 完全相同。
   - 处理：README 明确 paired 必须在启动 3010 时设 `VISITOR_REGISTER_MODE=active`；`run-sessions` 增加“假对照熔断”，active `registerTurnCount=0` 直接失败并解释原因。
   - 修复后 600 轮 active 全部 30/30 注入，base 全部 0。

3. **真实 10 角色 paired 600 轮**
   - 20 场 / 600 轮，0 失败，`manifest.paired=true`。
   - 成本门按预注册中位口径通过：prompt 字符 `+16.9%`，p95 中位 `+12.45%`。
   - 缓存命中 base `56.0%` / active `60.2%`；扣缓存后未缓存输入只 `+5.8%`。
   - 详细数字见 `af478-register-paired-cost-rerun-2026-11-25.md`。

## 二、改动文件

- `src/llm/common/interfaces/chat-provider.interface.ts`
- `src/llm/common/base/openai-compatible-chat.provider.ts`
- `src/engine-adapters/rendering/streaming-render.port.ts`
- `src/engine-adapters/rendering/llm-render.adapter.ts`
- `src/engine-adapters/rendering/turn-render-orchestrator.ts`
- `src/engine-adapters/wiring/engine-stream-backend.adapter.ts`
- `src/engine-adapters/wiring/llm-service-chat-caller.ts`
- `src/engine-adapters/wiring/turn-idempotency.service.ts`
- `src/engine-adapters/observability/session-cost.ts`
- `src/admin-debug/debug-session.service.ts`
- `src/admin-debug/trace-recorder.service.ts`
- `src/agent/llm/llm.types.ts`
- `src/agent/llm/llm.service.ts`
- `src/voice/voice.types.ts`
- `src/voice/voice.service.ts`
- `test/llm/cached-tokens.spec.ts`（新增 7 tests）
- `scripts/eval/visitor-register-stability/metrics.mjs`
- `scripts/eval/visitor-register-stability/analyze-latency.mjs`
- `scripts/eval/visitor-register-stability/latency-attribution.mjs`
- `scripts/eval/visitor-register-stability/render-report.mjs`
- `scripts/eval/visitor-register-stability/run-sessions.mjs`
- `scripts/eval/visitor-register-stability/README.md`
- `scripts/eval/visitor-register-stability/__tests__/metrics.spec.mjs`（新增 2 tests，总 13）

`src/engine-core` 一行未改：`git diff --stat HEAD -- src/engine-core` 为空。

## 三、关键设计决策

- **不把缓存字段塞进内核 `RenderResult` 契约**：只在适配层用同构扩展携带，避免动纯层；`turn-render-orchestrator` 用 `cachedUsageField()` 从 unknown 结构读取并过滤非法值。
- **缺失语义严格区分**：provider 不报 → 不出键；debug trace 统一 `null`；评测聚合只在有限数字时计入，`null` 不进分母。
- **paired 不改生产语域开关语义**：全局开关仍是灰度总闸，per-session `off` 用于 base；`active` 必须全局开启才生效。用 README + 假对照熔断防再次静默跑出假数据。
- **报告只给可复算事实**：缓存 token 不折算金额（无厂商 cache-read 单价）；p95 历史差异不强行归因，明确跨 run 绝对值不可比。

## 四、闸门数字

| 闸门                                                        | 结果                                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `pnpm lint`                                                 | 0 error                                                                           |
| `pnpm typecheck`                                            | 0 error                                                                           |
| `pnpm build`                                                | 成功                                                                              |
| 目标单测（5 文件）                                          | 96 passed / 0 failed                                                              |
| 全量 `pnpm test`（本机含 gitignored 语料）                  | 4948 passed、1 failed；唯一失败是既有 AF-427 语料漂移债，已由 AF-479 承担         |
| 全量 `pnpm test`（CI 等价：临时移走 `data/debug-sessions`） | 335 files passed、1 skipped；4948 passed、5 skipped、0 failed；跑完已恢复语料目录 |
| `git diff --stat HEAD -- src/engine-core`                   | 空                                                                                |

## 五、偏差表

| 任务单                           | 实际                                         | 理由                                                                              |
| -------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------- |
| runId `af476-2026-11-25-10roles` | `af478-2026-11-25-10roles`                   | 任务单由 AF-476 复制，runId 与 taskId 不一致；按 AF-478 命名，便于追溯            |
| 交付记录/成本报告路径 `af476-*`  | `af478-*`                                    | 同上，避免与已归档 AF-476 混淆                                                    |
| 未要求修 paired active 注入      | 增加 README 口径 + `run-sessions` 假对照熔断 | 首次冒烟发现 active prompt 与 base 完全一致；不修会产出假对照 600 轮              |
| 全量闸门“跑一次”                 | 跑两次：含语料一次、CI 等价一次              | 含语料时唯一失败是 AF-427 历史债；AF-479 修复前不能把本机语料失败算成 AF-478 回归 |

## 六、遗留

- AF-479 修复 `af427-operator-delta-ledger.spec.mjs` 对本地语料规模的硬编码；修完后本机全量测试应无需移目录。
- 角色级 p95 尾部风险：`workplace +32.4%`、`general_secure +28.4%`、`grief +16.6%`，若要做全角色 SLA，需按单变量实验继续压缩后段上下文。
- 3010 后端仍在运行（`VISITOR_REGISTER_MODE=active`），仅用于本轮评测；交付后应停止。
