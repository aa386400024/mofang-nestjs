# AF-594 交付记录 — AI 会话热路径内存与写放大根治

- 任务单：`docs/worklog/records/phase2.5-quality-gates/AF-594/task-sheet.md`
- 分支：`task/AF-594-ai-hotpath-performance`（stacked 自 AF-593 `122fd586`）
- 日期：2026-11-28
- 结论：**passed** — 热路径 5 项全部落地，定向 182 例、全量 5217 例全绿，engine-core 零 diff。

## 问题

上一轮性能审计的 P0 项集中在 AI 会话热路径：

1. `InMemoryMemoryStore` 是进程级单 Map，默认 TTL null，`remember()` 每次全 Map sweep；对练每轮写 2 条，`forgetSession` 不清记忆，Qdrant 对非长时也回落同一仓。
2. 续聊每轮先 `findOne` 再 `save` 整行，流末 `update`，recorder 再 `findOne + save`，加 consent 查询约 5~6 次 DB 往返。
3. `promptTokens` 硬编码 0，`completionTokens` 每轮覆盖而非累加，token 字段不可用于成本审计。
4. 同意前置校验每轮查 `user_consents`。
5. LLM chat / embedding 客户端每请求 `new`。

## 改动

| 文件 | 改动 |
| --- | --- |
| `src/engine-adapters/persistence/bounded-in-memory-memory.store.ts` | 新增有界记忆仓：按 tenant+session 分桶；单会话 200 条、全局 1000 会话、会话空闲 TTL 6h、条目默认 TTL 6h；写入只清本桶过期条目，超限按 `occurredAt` 淘汰最旧；召回只扫本会话；复用内核 `evaluateRecallCandidate` 与同一排序；提供可选 `forgetSession` / `stats` |
| `src/engine-adapters/wiring/engine.providers.ts` | 纯内存与 Qdrant 两条路径统一改用 `BoundedInMemoryMemoryStore` 作为 fallback，`recallPolicy` 继续透传 |
| `src/engine-adapters/persistence/qdrant-memory.store.ts` | 新增 `forgetSession` 代理，转发给回落仓（不改 `MemoryStore` 端口） |
| `src/engine-adapters/rendering/turn-render-orchestrator.ts` | `forgetSession(handleId)` 在删除 histories 前，按 `resolveContext` 的 tenant/session 调可选记忆清理能力 |
| `src/ai-engine/providers/llm-orchestrator.service.ts` | 新会话才 INSERT；续聊只做归属校验；流结束用一条 `update` + 原始表达式做 token 原子累加，保留 `crisisEventId` / `endedAt`；`promptTokens` 从 chunk 回填，`completionTokens` 优先 provider 累计值、缺省回退 `tokenCount` |
| `src/consent/providers/consent.service.ts` | `assertAccepted` 正缓存 300s（键含版本/类型/uid）；`record` / `withdraw` 主动失效；Redis 可选注入、读写失败静默回落 DB |
| `src/llm/common/base/openai-compatible-chat.provider.ts` | 按 apiKey/model/生成参数/timeout 复用 ChatOpenAI，池上限 32 |
| `src/llm/common/base/openai-compatible-embedding.provider.ts` | 按 apiKey 复用 OpenAIEmbeddings，池上限 32 |
| `test/engine-adapters/af594-bounded-memory-store.spec.ts` | 新增 6 例：单会话淘汰、会话 LRU、空闲 TTL、forgetSession 租户隔离、会话隔离、条目 TTL |
| `test/consent/af594-consent-cache.spec.ts` | 新增 3 例：缓存命中不打 DB、撤回失效、未同意不缓存 |
| `test/ai-engine/llm-chat-conversations.spec.ts` | 增断言：续聊不 save 整行，token 走单条 UPDATE 原子累加 |
| `test/engine-adapters/wp8-wiring.spec.ts` | 装配断言改为 `BoundedInMemoryMemoryStore` |

关键设计决策：

1. **有界仓放 adapter，内核端口一行不改**。`MemoryStore` 仍只有 `remember/recall`；会话清理是适配层可选能力，`TurnRenderOrchestrator` 用结构性类型判断调用，Qdrant / 其他实现不受影响。
2. **召回语义复用内核纯函数**。不复制第二套判定，`evaluateRecallCandidate` + `effectiveImportance → occurredAt` 排序保持与内存版逐字一致。
3. **写路径只清本会话**。旧实现每次写入全 Map 扫描，累计轮次越多越慢；新实现把清扫限制在当前桶，全局只做一次空闲 TTL 扫描（上限 1000 会话，成本可控）。
4. **token 用 DB 原始表达式累加**。`prompt_tokens = prompt_tokens + delta` 避免并发轮次读改写互相覆盖；同时只发一条 UPDATE。
5. **consent 缓存只缓存正结果**。未同意不缓存，避免绑定/补记录后仍被旧否定命中；键带版本，配置升版自然失效。

## 闸门

<!-- gateResults -->

| 命令 | 结果 |
| --- | --- |
| `pnpm test -- test/ai-engine/llm-chat-conversations.spec.ts test/consent/af594-consent-cache.spec.ts test/consent/td17-consent-port-c2-batch1.spec.ts test/engine-adapters/af594-bounded-memory-store.spec.ts test/engine-adapters/wp8-wiring.spec.ts test/engine-adapters/qdrant-memory-store.spec.ts test/engine-adapters/wp12-memory-closeout.spec.ts test/engine-adapters/wp7-turn-render.spec.ts test/llm/custom-embedding-provider.spec.ts test/llm/llm-retry.spec.ts` | 10 files passed，182 passed / 0 failed，42.50s |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm lint` | exit 0，0 error / 0 warning |
| `pnpm test` | 370 files passed / 1 skipped，5217 passed / 0 failed / 4 skipped，738.48s |
| `git diff --stat HEAD -- src/engine-core` | 空 |

<!-- /gateResults -->

## scope 自检

<!-- scopeCheck -->

- 代码：`src/engine-adapters/{persistence,rendering,wiring}`、`src/ai-engine/providers`、`src/consent/providers`、`src/llm/common/base` 均在任务单 files 内。
- 测试：`test/engine-adapters`、`test/ai-engine`、`test/consent` 均在内。
- 记录：本文件在 `docs/worklog/completed/phase2.5/`，任务记录包在 `docs/worklog/records/phase2.5-quality-gates/`。
- 未改 `src/engine-core/**`、未改表结构、未引入依赖、未碰前端与 admin-dashboard。

<!-- /scopeCheck -->

## 契约核对

<!-- contractChecks -->

- taskId / 分支 / 交付记录路径与任务单一致。
- `MemoryStore` 端口签名未变，`engine-core` 零 diff。
- 续聊越权仍抛 `LlmConversationNotFound`，归属校验未放宽。
- token 更新保留 `crisisEventId` 与 `endedAt`。
- 状态面只经 CLI（`task register/promote`、`run-once`）。

<!-- /contractChecks -->

## backlog 遗留项

<!-- backlogItems -->

- **AF594-B1**（adapter）：`ChatSessionRecorder` 仍是 `findOne + save` 整行回写。要再压一次往返需改成 DB `INSERT ... ON DUPLICATE KEY UPDATE`（含 `GREATEST(round_count, ?)` 与 `COALESCE(summary_title, ?)`），涉及原生 SQL 与 MySQL 方言，超出本单“能安全合并则合并”的边界，登记为后续。
- **AF594-B2**（ops）：Qdrant 回落仓的内存条目在 Qdrant 恢复后不会自动回填，仍依赖后续写入；当前行为与改造前一致，未扩大风险面。

<!-- /backlogItems -->

## 偏差表

<!-- deviationTable -->

| 项 | 任务单写的 | 实际 | 处置 |
| --- | --- | --- | --- |
| 会话清理接入 | 门面结构性类型判断调用 bounded store | 额外给 `QdrantMemoryStore` 加了 `forgetSession` 代理，门面统一调 `this.deps.memories` 的可选能力 | 必要偏差：装配层注入的可能是 Qdrant 版，代理保证两条路径行为一致 |
| ConsentService 依赖 | 未写注入方式 | 用 `@Optional()` 注入 Redis，未改既有 13 例直接 `new ConsentService(repo, config)` 的测试 | 最小侵入；Redis 缺失时回落 DB |
| ChatSessionRecorder | 减少一次不必要的整行回写（能安全合并则合并） | 未改，仍为 `findOne + save` | 安全合并需要原生 upsert + GREATEST/COALESCE，登记 AF594-B1 |
| 客户端缓存上限 | 32 | 32 | 一致 |

<!-- /deviationTable -->

## 验收结论

<!-- reviewVerdict -->

passed — 五项热路径修复均有定向回归与全量闸门证据，边界未越线，剩余一项 recorder 写放大已显式登记。
<!-- /reviewVerdict -->

## commit message

`fix(af594): bound engine memory and collapse chat writes`
