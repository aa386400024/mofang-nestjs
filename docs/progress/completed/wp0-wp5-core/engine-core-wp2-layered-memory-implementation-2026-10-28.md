# WP2 · 分层记忆引擎 V1（三级记忆 + 长时向量召回 + 跨会话接续）后端交付记录

> 任务单: [`engine-core-wp2-layered-memory-backend-2026-10-28.md`](./engine-core-wp2-layered-memory-backend-2026-10-28.md)
> 母版: [`../architecture/ai-engine-roadmap-v1.1.md`](../architecture/ai-engine-roadmap-v1.1.md) WP2
> 前置: [`engine-core-wp0-boundary-skeleton-backend-2026-10-28.md`](./engine-core-wp0-boundary-skeleton-backend-2026-10-28.md)（边界骨架）、
>       [`engine-core-wp1-bdi-cognitive-engine-backend-2026-10-28.md`](./engine-core-wp1-bdi-cognitive-engine-backend-2026-10-28.md)（BDI 规则轨）
> 仓库: `E:\Work\Project\backend\mofang-nestjs`
> 日期: 2026-10-28 ｜ 状态: 🟢 **已交付并自跑复跑绿**（eslint 0 / tsc 0 / jest 5 套件 95 用例全绿；WP0·WP1 既有 42 用例零回归）

---

## 1. 闸门复跑结果（本轮自跑，Windows PowerShell）

| # | 命令 | 结果 |
|---|---|---|
| 1 | `npx eslint "src/**/*.ts"` | **exit 0**，0 error（含 B 层新文件） |
| 2 | `npx tsc -p tsconfig.build.json --noEmit` | **exit 0**，0 error |
| 3 | `npx jest test/engine-core` | **4 套件 / 82 用例全绿**（WP0+WP1 既有 42 零回归 + WP2 新增 40） |
| 4 | `npx jest test/engine-adapters` | **1 套件 / 13 用例全绿**（B 层 stub，不触网） |

合并跑 `npx jest test/engine-core test/engine-adapters` → `Test Suites: 5 passed, 5 total / Tests: 95 passed, 95 total`。

> 本轮未跑 `pnpm build`（全量构建）与既有业务测试 —— 本期零 entity / migration / module 改动，`src/engine-core` 与 `src/engine-adapters` 均未被 `app.module.ts` 引用，不影响既有行为；全量构建请在合并前补跑。

---

## 2. 交付范围逐条对照（任务单 §1.1 / §9）

| 任务单条目 | 交付 | 落点 |
|---|---|---|
| §1.1-1 端口只追加可选字段，向后兼容 | ✅ | `domain/ports/memory.store.ts`：`MemoryEntry` 追加 `visitorId/topicKey/supersededBy`，`MemoryRecallQuery` 追加 `visitorId/scope`；`scope` 用字符串联合 `MemoryRecallScope`（非 enum，内核零运行时导出） |
| §1.1-2 工作记忆窗口（N=8，运行时不落库） | ✅ | `memory/working-window.ts`（纯函数）+ `InMemoryEngineSession` 运行时窗口（最近 8 轮文本，**不落库**）+ `workingContext(handleId)` 观测口 |
| §1.1-3 短时→长时晋升（纯函数，`closeSession` 不写库） | ✅ | `memory/promotion.ts`；`closeSession(): void` **保持同步幂等、不写库**，未改一行 |
| §1.1-4 重要度衰减（只降权不删） | ✅ | `memory/importance-decay.ts`：`decayImportance` / `effectiveImportance`，半衰期 30 天（工程种子值），阈值 `RECALL_MIN_EFFECTIVE_IMPORTANCE=0.1` |
| §1.1-5 冲突消解（显式 topicKey，只标记不删） | ✅ | `memory/conflict-resolution.ts`：`resolveConflict` / `markSuperseded` / `applyConflictResolution`；判序 = 时间新 > 重要度高 > id 字典序（确定性） |
| §1.1-6 长时向量召回（B 层 Qdrant，Top5） | ✅ | `src/engine-adapters/persistence/qdrant-memory.store.ts`：collection `visitor_long_memory`，复用现有 `QdrantService`（窄接口 `QdrantMemoryClient`），命中带 `score` |
| §1.1-7 跨会话开场上下文（`resume` 首论） | ✅ | `InMemoryEngineSession.turn` 第 6 步 `collectOpeningContext()`：仅 resume 会话首论，`scope=visitor + tiers=[LONG_TERM] + minImportance=0.5 + limit=5`；只读挂出参 `openingContext`，**不改 BDI 快照、不产口语** |
| §1.1-8 软降级（Qdrant/embed 失败不阻断 turn） | ✅ | 三条降级路径（upsert 失败 / embed 空向量 / search 失败）全部回落内存 + warn，**不抛** |
| §1.1-9 单测覆盖 | ✅ | `test/engine-core/wp2-memory.spec.ts`（40 用例）+ `test/engine-adapters/qdrant-memory-store.spec.ts`（13 用例） |
| §2 边界红线（内核零框架 / B 层外置） | ✅ | `boundary.spec.ts` 新增断言 ⑨：B 层实现必须在内核包之外，内核树内不得出现 `qdrant` / `engine-adapters` 说明符（AST 级） |
| §7 异常与边界表 | ✅ | 端口共享 helper：`assertValidMemoryEntry` / `assertValidMemoryRecallQuery` / `resolveMemoryRecallLimit`，内存版与 Qdrant 版**共用同一份口径** |
| §9 验收清单 | ✅ | 全部勾选，详见任务单 §13 回写 |

### 任务单未点名、但属「治本」范畴的额外交付

| # | 额外项 | 理由 |
|---|---|---|
| A | **`memory/recall-policy.ts`（内核第 5 个 memory 文件）** —— `evaluateRecallCandidate` 召回判定纯函数 | 内存版与 Qdrant 版**共用唯一判定口径**。不抽出来就是"换实现即漂移"的双胞胎：内存版按原始重要度过滤、Qdrant 版按衰减后过滤，开发期单测全绿、生产召回却不一样，且极难查。塞进任一既有文件都会让该文件同时承担"策略"与"判定"两职，独立成文件是最小代价的治本做法 |
| B | **端口文件内的共享 helper**（校验 + limit clamp） | "什么算合法条目 / 召回上限多少"是契约级事实，两版各写一份必然漂移，且漂移方向恰好是"某版放过了另一版拦住的脏数据" |
| C | **`Embedder` 端口独立成文件** | 向量化是内核的对外依赖抽象；B 层 `OpenAICompatEmbedder` 走 `LlmRouterService.embed()`（**不**用基类 `embedQuery()`——后者不在 `EmbeddingProvider` 接口上，走接口不绑定具体基类） |
| D | **Qdrant payload 额外带 `expiresAt`** | 任务单 payload 清单未列，但长时记忆默认永久；保留该字段使 TTL 语义在两版实现间对齐，将来"到期即删"不用改 payload 结构 |
| E | **`boundary.spec.ts` 断言 ⑨** | 光断言"内核里没有 @nestjs"不够——有人把 Qdrant 实现塞进内核包时断言①仍会绿（qdrant 不是 @nestjs），但内核已被绑死在向量库上 |

---

## 3. 文件清单

### 新增 · 内核 `src/engine-core/`（整包仍零框架、零 typeorm、第三方依赖仅 `{ nanoid }`）

```
src/engine-core/
├── domain/ports/
│   └── embedder.ts                     【新】向量化端口（内核只依赖该接口）
└── memory/                             【新目录·WP2】
    ├── working-window.ts               工作记忆窗口（纯函数，N=8）
    ├── importance-decay.ts             重要度衰减（纯函数，30 天半衰期）
    ├── conflict-resolution.ts          显式 topicKey 冲突消解（纯函数）
    ├── promotion.ts                    短时→长时晋升（纯函数，不落库）
    └── recall-policy.ts                【任务单外新增】共享召回判定（内存版/Qdrant 版共用）
```

### 修改 · 内核 `src/engine-core/`

```
src/engine-core/
├── domain/ports/memory.store.ts        追加可选字段 + MemoryRecallScope + 共享 helper
├── domain/engine-session.types.ts      EngineTurnOutput 追加 openingContext?
├── in-memory/in-memory-memory.store.ts 支持 scope=visitor / 衰减 / superseded 过滤
├── in-memory/in-memory-engine-session.ts 运行时工作窗口 + resume 开场上下文
└── index.ts                            追加 WP2 全部公开导出
```

### 新增 · B 层 `src/engine-adapters/`（触框架/触网络，**在内核包之外**）

```
src/engine-adapters/
├── persistence/qdrant-memory.store.ts  QdrantMemoryStore implements MemoryStore（软降级）
└── embedder/openai-compat.embedder.ts  OpenAICompatEmbedder implements Embedder（异常吞为降级）
```

### 新增/修改 · 测试

```
test/engine-core/wp2-memory.spec.ts              【新】WP2 内核 40 用例（任务单 §8 清单 1-8 + 冲突闭环 + 端口校验分支）
test/engine-adapters/qdrant-memory-store.spec.ts 【新】B 层 13 用例（stub client + stub embedder，不触网）
test/engine-core/boundary.spec.ts                【改】白名单 + 目录清单同步 + 新增断言 ⑨
```

> WP0 / WP1 的既有测试文件**零改动**（`engine-core.spec.ts` / `wp1-bdi.spec.ts` 未动一个字符）。

---

## 4. 关键设计决策（实施层，任务单 §11 之外的补充）

1. **M1 端口只追加可选字段**：`scope` 用字符串联合 `MemoryRecallScope`（纯控制流判别式，内核零运行时导出），不用 enum。
2. **衰减只在 `scope=visitor` 生效**：`scope=session` 保持 WP0 原样（原始 `importance` 过滤 + 原排序），保证「行为与 WP0 完全一致」且零回归。
3. **`minImportance` 口径按范围分**：`session` 用原始 `importance`，`visitor` 用衰减后有效重要度（否则衰减机制形同虚设）。已在端口 JSDoc 显式标注。
4. **`promoteShortTermToLongTerm` 严格校验 `tier === SHORT_TERM`**：工作记忆是来访者原话，越级晋升 = 跨会话隐私泄漏，直接拒。
5. **B 层依赖窄接口 `QdrantMemoryClient`**（只要 `upsert` + `search`）：单测可用极小 stub，不绑死整个 `QdrantService`，将来换向量库只影响这一个窄面。
6. **Qdrant = 长时存储 / 内存 = 会话级存储**（分工而非并存）：`LONG_TERM` → embed + upsert；工作/短时 → 内存回落仓；`scope=visitor` → Qdrant 语义检索，`scope=session` → 内存回落仓。
7. **冲突消解判序必须确定**：时间新 > 重要度高 > id 字典序。同刻同重要度时若无兜底，两版实现可能选出不同存活者，冲突标记就会来回翻转。
8. **测试台铁律：store 与 session 必须注入同一个 `now`**：本轮踩了两次 —— 内核与 B 层各一次。store 用真实 `Date.now()`（2026）而夹具 `occurredAt` 是 2023 时，衰减会把有效重要度打到阈值以下，样本被整体滤掉，断言变成"因为衰减没了"而不是"因为映射错了"。这类失败**测的不是想测的东西**，必须在夹具层根治。

### 4.1 一处自查纠正：长时记忆缺 `visitorId` 的写入期校验

初版实现把「`LONG_TERM` 必须带 `visitorId`」做成 `remember` 期的 `INVALID_INPUT` 硬抛错，WP0 的「tier 过滤生效」用例**当场被它打红** —— 而那条用例写的是**会话级长时记忆**（本场会话内的长期事实，本就不该有跨会话归属），属 WP0 已发布的合法用法。

> 硬校验把合法用法判成非法，属于对既有契约的破坏。**跨会话可见性改由召回期判定**：`scope=visitor` 只召回带 `visitorId` 且与查询 `visitorId` 相等的条目；不带 `visitorId` 的长时条目在访客范围下天然不可见。
>
> 这样"漏写 `visitorId`"的后果是**「这条记忆跨会话召不回」（可用性损失）**，而不是**「别的访客召回了我的记忆」（隐私事故）** —— 失败方向必须安全。
>
> 该行为已写进端口 JSDoc，并用单测锁死（可写入 + 会话范围照常召回 + 访客范围不可见）。

---

## 5. 已知缺口与风险（交付时必须知会）

| # | 缺口 | 性质 | 影响 / 处置 |
|---|---|---|---|
| 1 | **Qdrant 版写侧不做冲突标记** | **技术性缺口，非设计选择**：现有 `QdrantService` 未暴露 `setPayload`（只改 payload 不改向量），也没有"仅按 filter 取点"（scroll）能力；靠向量相似度反查冲突分组会漏召回 | 内核已提供 `resolveConflict` / `applyConflictResolution` / `markSuperseded` 纯函数，**由编排层在内存态算好后随新条目一起落仓**。若下轮要"在 Qdrant 内原地标记"，需先给 `QdrantService` 补 `setPayload`（属基建改动，未在本期做） |
| 2 | B 层未接线 `app.module.ts` / WS / 端点 | 任务单明确本期不接线 | 内核与 B 层均为可直接 `new` 的独立类；接线另起装配轮 |
| 3 | 短时记忆**无自动写入路径** | 本期短时记忆由写入方显式 `remember`（规则拼接占位，不调 LLM） | 会话结束编排层（异步落仓）尚未实现，晋升纯函数已就位待接 |
| 4 | 衰减半衰期 30 天 / 阈值 0.1 为**工程种子值** | 未标定 | 需真实数据校准，常量已集中便于调 |
| 5 | `pnpm build` 全量构建与既有业务测试本轮未跑 | 范围之外 | 本期零 entity / migration / module 改动，内核未被模块引用；合并前建议补跑 |

---

## 6. 验证命令（复跑）

```powershell
cd E:\Work\Project\backend\mofang-nestjs
npx eslint "src/**/*.ts"
npx tsc -p tsconfig.build.json --noEmit
npx jest test/engine-core
npx jest test/engine-adapters
```

无新增 env 开关；本期零 `.env` 改动、零 migration/entity/新表、零 LLM 调用、零口语产出（`reply` 仍恒 `''`）。
