# AF-481 · cachedTokens 跨层接线交付记录

## 交付内容

AF-478 已把 `cachedTokens` 从 provider 贯通到渲染适配、debug trace 与评测脚本；本任务补齐这条链路的后半段，保证缓存字段真正进入运行时产物：

- `src/engine-adapters/wiring/engine-stream-backend.adapter.ts`
  - `done` 事件 usage、幂等快照 usage、本场累计 usage、`TurnTrace.llmUsage` 都带缓存字段。
  - 新增 `readCachedTokens()` 与 `cachedUsageField()`，非法值不出键。
- `src/engine-adapters/wiring/llm-service-chat-caller.ts`
  - final chunk 映射 `chunk.usage.cachedTokens`。
- `src/engine-adapters/wiring/turn-idempotency.service.ts`
  - `TurnUsageSnapshot` 增加可选缓存字段，缺失仍为不可得。
- `src/engine-adapters/observability/session-cost.ts`
  - `SessionUsageDelta` / `SessionUsageTotals` / `ProviderUsageTotals` 增加可选缓存；
  - `accumulateSessionUsage()` 与 provider 桶累加保留缓存；
  - `SessionCostSummary` 增加 `totalCachedTokens`。
- `src/agent/llm/llm.types.ts` / `src/agent/llm/llm.service.ts`
  - `LlmUsage` 增加缓存字段；
  - `MiniMaxStreamDelta.usage` 解析 `prompt_tokens_details.cached_tokens` 与 `cache_read_input_tokens`；
  - 非法值过滤，0 保留。

## 设计口径

- 缓存是可选观测：上游没报就是 `null/undefined`，不拿 0 冒充“没命中”。
- 不改 `src/engine-core`；不改 `RenderResult` 内核契约，只在适配层同构扩展。
- 不把台词原文、会话内容写入任何日志或仓库。

## 闸门

| 闸门                                                                                                                                              | 结果                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `pnpm exec vitest run test/llm/cached-tokens.spec.ts test/admin-debug/wp58-debug-session.spec.ts test/engine-adapters/wp8b-stream-render.spec.ts` | 3 files / 60 tests passed |
| `pnpm typecheck`                                                                                                                                  | 0 error                   |
| `pnpm lint`                                                                                                                                       | 0 error                   |
| `git diff --stat HEAD -- src/engine-core`                                                                                                         | 空                        |

本机含语料的全量 `pnpm test` 仍会被 AF-427 旧断言阻断；该测试债由 AF-482 在同一发布栈上修复，修复后全量闸门以 AF-482 记录为准。

## 偏差

- 任务单约束“不修改渲染适配与评测脚本”：本任务只改 wiring / observability / agent-llm 六文件，未触碰上述模块。
- 任务单基线取 AF-478 提交 `221475aa`，因为本任务叠加在 AF-478 分支之上；不重复声明 AF-478 的文件。
