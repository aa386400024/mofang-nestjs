# WP2 · 分层记忆引擎 V1（三级记忆 + 长时向量召回 + 跨会话接续）后端任务单

> 母版: [`../architecture/ai-engine-roadmap-v1.1.md`](../architecture/ai-engine-roadmap-v1.1.md) WP2（127–138 行）
> 前置: [`engine-core-wp0-boundary-skeleton-backend-2026-10-28.md`](./engine-core-wp0-boundary-skeleton-backend-2026-10-28.md)（边界骨架，已交付）、
>       [`engine-core-wp1-bdi-cognitive-engine-backend-2026-10-28.md`](./engine-core-wp1-bdi-cognitive-engine-backend-2026-10-28.md)（BDI 规则轨认知引擎，**已由前端侧完成并复跑绿：jest 42 / tsc 0 / eslint 0**）
> 仓库: `E:\Work\Project\backend\mofang-nestjs`
> 日期: 2026-10-28 ｜ 类型: 引擎内核记忆层（纯策略算子 + 端口演进）+ B 层 Qdrant 适配器
> 目标读者: 后端；内核命令同 WP0/WP1，由大炮在 Windows 复跑 `build` / `lint` / `test`
> **状态**: 🟢 **已交付并自跑复跑绿**（eslint 0 / tsc 0 / jest 5 套件 95 用例全绿；WP0·WP1 既有 42 用例零回归）
> **交付记录**: [`engine-core-wp2-layered-memory-implementation-2026-10-28.md`](./engine-core-wp2-layered-memory-implementation-2026-10-28.md)

---

## 0. 一句话目标

在 WP0/WP1 已跑通的「事件分类 → 状态迁移 → 意图规划」内核上，补齐**三级记忆（工作 / 短时 / 长时）**：工作记忆维护最近 8 轮窗口，短时记忆随本场留存、结束晋升长时，长时记忆入 Qdrant `visitor_long_memory` 做语义 Top5 召回，并支持**同一来访者跨会话接续**（第二次开场能带上次议题/情绪）。**本期记忆只做存储、召回、晋升、衰减、冲突消解的骨架；摘要文本用规则占位，不调 LLM，不生成开场白口语。**

> 衔接说明：WP1 已经落地了 `BdiSnapshot` 五槽位、规则事件分类器、状态迁移算子、意图规划器，`turn` 管线为 `classify → transitionState → planIntention → save`。**WP2 不重写、不改这条管线**，只在其旁补记忆层，并在 `resume` 接续分支读取长时记忆。WP1 的 `reply` 仍恒 `''`（口语渲染归 WP5），本期同样不产出任何口语。

---

## 1. 范围与 Done 定义

### 1.1 本期做到（In Scope）

1. **端口向后兼容演进**：`MemoryStore` / `MemoryEntry` / `MemoryRecallQuery` 只**追加可选字段**（`visitorId` / `scope` / `topicKey` / `supersededBy`），不破坏 WP0/WP1 已发布签名与既有测试。
2. **工作记忆窗口**：纯函数维护最近 N=8 轮上下文（运行时窗口，不落 Qdrant、不进长时召回）。
3. **短时记忆 → 长时晋升（纯函数策略）**：提供 `promoteShortTermToLongTerm` 纯函数，把本场短时条目派生为长时条目（`tier` 改写、TTL 置永不过期、importance 保留、继承 visitorId）；**`closeSession` 保持同步幂等、不写库**，异步落仓由会话结束编排（B 层）调用该函数后负责。
4. **重要度时间衰减**：纯函数 `decayImportance`，召回排序叠加衰减后的有效重要度；低重要度 + 高龄降权不召回（物理不删除）。
5. **冲突消解（显式主题键）**：同 `tenantId + visitorId + topicKey` 内多条，取「时间更新 + 重要度更高」者存活，其余标记 `supersededBy`，记录冲突点供审计。**本期不做语义聚类。**
6. **长时向量召回（B 层 Qdrant）**：新建 B 层 `QdrantMemoryStore implements MemoryStore`，collection `visitor_long_memory`，复用现有 `QdrantService` 与现有 OpenAI 兼容 embedding（`embedQuery`），Top5 语义召回，命中带 `score`。
7. **跨会话开场上下文**：`resume` 接续分支除搬 BDI 快照外，召回该 visitor 的高权重长时记忆，作为只读开场上下文块挂到出参（**不生成口语、不直接改 BDI 状态**）。
8. **软降级**：Qdrant 不可达 / embed 失败时回退内存实现或降级落仓，记 warn，**不阻断 turn 主流程**。
9. 单测覆盖窗口、衰减、冲突消解、session/visitor 隔离、TTL、limit clamp、向后兼容、晋升。

### 1.2 明确不做（Out of Scope，后期 WP 再入）

| 不做项 | 归属 |
|---|---|
| 调 LLM 生成本场摘要、开场白/承接口语、任何来访渲染 | WP5（本期摘要规则拼接占位） |
| 竞争抑制遗忘的精细权重 / 激活竞争 / 记忆合并摘要 | Phase2 |
| Chinese-MentalBERT 专用心理向量（先用现有通用 embedding） | Phase2 评估 |
| Redis 热状态、MySQL 记忆表、新增 entity / migration / 列、改 `.env` | 本期零存储 schema 改动 |
| 记忆自动回写、激活或改写 WP1 核心/短期信念 | 后续认知轮 |
| 把内核接进 `app.module.ts` / WS / 端点（接线另轮） | 装配轮 |
| 多流派差异化记忆参数、情绪累积复杂动力学 | Phase2 |
| 语义聚类 / 自动主题抽取（topicKey 由写入方显式给） | 本期 |

---

## 2. 边界红线（继承 WP0/WP1，继续生效）

- `src/engine-core/` 整树**零** `@nestjs/*`、零 `typeorm`、零逃出本目录的相对 import、零 NestJS 装饰器；新增第三方依赖仍仅限 `{ nanoid }` + `node:*`，**内核层不得新增 Qdrant SDK / embedding 包**。
- **Qdrant / embedding 实现必须放内核包之外的 B 层**（见 §3.2），写进 `engine-core/` 会直接破掉 `boundary.spec.ts` 的 AST/grep 断言，属于架构回退。
- 端口方法签名**不破坏**：`openSession` / `turn` / `closeSession` 三方法名与返回形态不变；入参/出参/端口 DTO 只追加可选字段。
- 内核不读数据库、不发网络、不调模型；网络/客户端只出现在 B 层。
- 测试仍放 `test/engine-core/`，直接 `new` 内存实现跑，不启动 NestJS 容器；B 层适配器测试可单独放 `test/engine-adapters/`（不触网，用 stub client）。

> ⚠️ `test/engine-core/boundary.spec.ts` 的公开面白名单（断言⑥）与目录清单（断言⑦）是**硬编码**。本期内核新增导出/新文件后，**必须同步更新这两个断言**，不得删断言绕过。

---

## 3. 目录落点

### 3.1 内核层（`src/engine-core/`，纯 TS，零框架）

```
src/engine-core/
├── domain/
│   ├── ports/
│   │   ├── memory.store.ts          【改】MemoryEntry/MemoryRecallQuery 追加可选字段（向后兼容）
│   │   └── embedder.ts               【新】Embedder 纯接口（embed(text) → number[]），内核不实现
│   └── ...（WP1 文件不动）
├── memory/                          【新】记忆纯策略算子（无状态、无网络、无随机）
│   ├── working-window.ts            【新】最近 8 轮窗口裁剪 trimWorkingWindow(lines, n=8)
│   ├── importance-decay.ts          【新】decayImportance / effectiveImportance / 召回阈值常量
│   ├── conflict-resolution.ts       【新】同 topicKey 选存活 + 标记 supersededBy + 冲突点记录
│   └── promotion.ts                 【新】promoteShortTermToLongTerm 纯函数（短时→长时派生，不落库）
├── in-memory/
│   ├── in-memory-memory.store.ts    【改】recall 支持 scope=visitor；写入幂等/TTL/limit clamp 沿用
│   └── in-memory-engine-session.ts 【改】resume 分支召回长时开场上下文；closeSession 仍同步幂等不写库
└── index.ts                         【改】导出新增纯函数/类型（同步 boundary 白名单）
```

### 3.2 B 层（新建 `src/engine-adapters/`，触框架，**不在 engine-core 内**）

> 约定见 `src/engine-core/adapters/README.md` §2/§5：接口跟内核走，实现跟环境走；Qdrant 实现落这里。

```
src/engine-adapters/                 【新目录，内核包之外】
├── persistence/
│   └── qdrant-memory.store.ts       【新】implements MemoryStore；复用现有 QdrantService
└── embedder/
    └── openai-compat.embedder.ts   【新】implements Embedder；桥接现有 llm embedding embedQuery
```

- 复用 `src/ai-engine/providers/qdrant.service.ts` 既有 `ensureCollection / upsert / search / delete`，**不新造 QdrantClient、不重复探活逻辑**。
- embedding 经 `src/llm` 现有 ProviderRegistryService 取 OpenAI 兼容 provider，调用其 `embedQuery(text, apiKey)`；B 层自己负责拿配置/key。
- B 层不承载业务决策（衰减/冲突/窗口规则在内核纯函数里），只做桥接、落库、错误映射、软降级。

---

## 4. 类型契约（可直接施工）

### 4.1 端口演进（`domain/ports/memory.store.ts`，全部为可选追加）

```ts
export interface MemoryEntry {
  readonly tenantId: string;
  readonly id: string;
  readonly sessionId: string;
  readonly tier: MemoryTier;
  readonly source: MemorySource;
  readonly content: string;
  readonly importance: number;          // [0,1]
  readonly occurredAt: number;
  readonly ttlMs?: number | null;
  // ── WP2 追加（可选，向后兼容）──
  /** 稳定来访者标识（长时记忆必填；工作/短时可缺省）。跨会话长时召回的归属键。 */
  readonly visitorId?: string;
  /** 冲突消解分组键：同 tenant+visitor+topicKey 内只留存活者。本期由写入方显式给。 */
  readonly topicKey?: string;
  /** 被哪条存活条目取代（冲突消解结果；未被取代省略）。 */
  readonly supersededBy?: string | null;
}

export interface MemoryRecallQuery {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly query: string;
  readonly limit?: number;
  readonly minImportance?: number;
  readonly tiers?: readonly MemoryTier[];
  // ── WP2 追加 ──
  /** 跨会话召回归属键（scope=visitor 时必填）。 */
  readonly visitorId?: string;
  /** 召回范围：'session'（默认，tenant+sessionId，同 WP0 行为）| 'visitor'（tenant+visitorId 跨会话，仅 LONG_TERM）。 */
  readonly scope?: 'session' | 'visitor';
}
```

### 4.2 Embedder 端口（`domain/ports/embedder.ts`，新）

```ts
/** 向量化抽象：内核只依赖该接口，不关心是 OpenAI 兼容 / 本地模型 / 云 API。 */
export interface Embedder {
  /** 把一段文本编码为向量；失败由 B 层决定降级，不得让异常炸穿 turn。 */
  embed(text: string): Promise<readonly number[]>;
}
```

### 4.3 工作记忆窗口（`memory/working-window.ts`，纯函数）

```ts
/** 保留最近 n 轮（默认 8），超出丢弃最旧；纯函数，返回新数组，不改入参。 */
export function trimWorkingWindow(lines: readonly string[], n = 8): readonly string[];
```

### 4.4 重要度衰减（`memory/importance-decay.ts`，纯函数）

```ts
/** 默认半衰期（工程种子值，30 天，待真实数据校准；集中为常量便于调）。 */
export const DEFAULT_DECAY_HALF_LIFE_MS = 30 * 24 * 3600 * 1000;

/** importance * 2^(-ageMs/halfLifeMs)，单调不增，结果 clamp [0,1]。 */
export function decayImportance(importance: number, ageMs: number, halfLifeMs?: number): number;

/** 召回用有效重要度 = 衰减后值；低于 RECALL_MIN_EFFECTIVE_IMPORTANCE 的条目不召回。 */
export const RECALL_MIN_EFFECTIVE_IMPORTANCE = 0.1;
export function effectiveImportance(entry: MemoryEntry, now: number, halfLifeMs?: number): number;
```

### 4.5 冲突消解（`memory/conflict-resolution.ts`，纯函数）

```ts
/** 一条冲突记录（供审计，不删除旧条目）。 */
export interface ConflictRecord {
  readonly survivorId: string;
  readonly supersededIds: readonly string[];
  readonly topicKey: string;
}

/**
 * 同组（同 tenant+visitor+topicKey）内选存活：occurredAt 更新优先；同刻取 importance 更高。
 * 返回存活条目与被取代清单；纯函数，不做任何 IO，不做语义聚类。
 */
export function resolveConflict(group: readonly MemoryEntry[]): {
  readonly survivor: MemoryEntry;
  readonly conflicts: readonly ConflictRecord[];
};
```

### 4.6 短时→长时晋升（`memory/promotion.ts`，纯函数，不落库）

```ts
/**
 * 把一条短时条目派生为长时条目（纯函数，不写仓储）。
 * tier 改写为 LONG_TERM；ttlMs 置 null（永久）；occurredAt / importance / content /
 * topicKey 保留；继承 visitorId。新 id 由调用方生成后写入。
 */
export function promoteShortTermToLongTerm(
  entry: MemoryEntry,
  visitorId: string,
  makeId: () => string,
): MemoryEntry;
```

> `closeSession(handleId): void` 是同步、幂等、**不做持久化**的（见 `engine-session.port.ts`），晋升绝不能塞进它内部写库；由会话结束编排（B 层）先取本场 SHORT_TERM，逐条调本函数派生，再异步 `remember` 落长时。

### 4.7 出参追加（`domain/engine-session.types.ts`）

在 `EngineTurnOutput` 新增**可选**只读字段：

```ts
/** 跨会话开场上下文（仅 resume 首论携带）：高权重长时命中，供 WP5 组织承接与观测。 */
readonly openingContext?: readonly MemoryHit[];
```

只承载长时召回命中，**不含口语、不参与 BDI 决策、不改快照数值**；非 resume 或无命中时省略。

---

## 5. 三级记忆语义与读写规则

| 级 | 生命周期 | 写入时机 | 存储 | 召回路径 |
|---|---|---|---|---|
| WORKING 工作 | 当前会话最近 8 轮 | 每轮结束 | 运行时窗口（内存，不落 Qdrant） | 本轮决策上下文，不进长时召回 |
| SHORT_TERM 短时 | 单会话全程 | 每轮/阶段规则拼接关键事实（占位，不调 LLM） | 仓储（内存；Qdrant 版可只存长时） | 本场内检索；会话结束由编排层调晋升函数转 LONG_TERM |
| LONG_TERM 长时 | 跨会话永久 | 短时晋升 + 人工标注注入 | Qdrant `visitor_long_memory` | 新会话按当前议题语义 Top5，scope=visitor |

### 5.1 写入
- `remember` 幂等：同 id 后写为准（沿用 WP0）。
- WORKING 条目 importance 用现有默认值；LONG_TERM 必须带 `visitorId`；可带 `topicKey`。
- 晋升：会话结束编排（B 层）取本场 SHORT_TERM，逐条调 `promoteShortTermToLongTerm` 派生为 LONG_TERM（`ttlMs=null`、`occurredAt` 保留、`importance` 保留、继承 visitorId）后异步落仓；`closeSession` 本身不写库。原短时条目是否清理由实现定，**不得删除不可恢复的审计信息**。

### 5.2 检索
- `scope=session`（默认）：`tenantId` + `sessionId` 双匹配，行为与 WP0 完全一致。
- `scope=visitor`：`tenantId` + `visitorId`，**只返回 LONG_TERM**，忽略 sessionId；过滤已过期、`supersededBy` 非空者、有效重要度低于阈值者。
- 排序：Qdrant 版按 `score`（cosine）为主、importance 为辅；内存版无 score，退化为衰减后重要度 → 时间。
- `limit` 沿用既有 clamp（默认 5，上限 50）。

### 5.3 遗忘与冲突
- 遗忘只降权不物理删（本期）；衰减见 §4.4。
- 冲突消解见 §4.5：存活者保留，旧者 `supersededBy=存活id` 且不被召回；冲突点写进审计/日志可观测。

### 5.4 跨会话接续
- `resumeFromSessionId` 分支继续先搬上一场 BDI 快照（WP0 逻辑不动）；**额外**按 `scope=visitor, tiers=[LONG_TERM], minImportance=0.5, limit=5` 召回高权重长时记忆，作为开场上下文。
- 召回结果填入本轮出参 `openingContext`（§4.7）；**只供 WP5 组织承接与督导观测**，本期不生成口语、不修改快照数值。

---

## 6. Qdrant collection 与软降级（B 层）

- collection 名：`visitor_long_memory`，**与知识库 RAG collection 隔离**，不复用知识文章库。
- payload：`tenantId / visitorId / sessionId / tier / source / content / importance / occurredAt / topicKey / supersededBy`；向量只存 LONG_TERM（WORKING/SHORT_TERM 不强制向量化）。
- 维度对齐所用 embedding 模型；`ensureCollection` 维度 mismatch 抛错时由软降级兜住，不炸启动。
- **软降级**：
  - Qdrant 不可达 / upsert 抛错 → 回退 `InMemoryMemoryStore`（组合持有），记 warn，turn 继续；
  - `embed` 失败 → 该条不向量化（可仅结构化落仓或跳过），不抛断主流程；
  - 降级状态只记日志/指标，不在本期向用户暴露。

---

## 7. 异常与边界

| 场景 | 行为 |
|---|---|
| `remember` 缺 tenantId/id/sessionId，importance 越界，ttlMs 非法 | 抛 `EngineCoreError(INVALID_INPUT)`，沿用 WP0 校验 |
| `scope=visitor` 但缺 `visitorId` | 抛 `INVALID_INPUT` |
| `scope=session` 不带 visitorId | 行为同 WP0（向后兼容，不报错） |
| Qdrant 连接/写入失败 | 软降级内存，warn，不抛 |
| embed 失败 | 本条降级，不阻断 |
| 同 id 重复写 | 后写为准（幂等） |
| 过期条目 / 被取代条目 | 不召回 |
| 跨租户 / 跨 visitor / 跨会话 | 严格隔离，绝不串号 |

---

## 8. 单测清单

**内核（`test/engine-core/`，纯内存，不触网）**
1. `trimWorkingWindow` 超过 8 轮丢弃最旧、不足 8 轮原样、不改入参。
2. `decayImportance` 单调不增、半衰期处减半、clamp [0,1]；`effectiveImportance` 低于阈值判为不召回。
3. `resolveConflict`：同 topicKey 选时间更新者；同刻选 importance 高者；输出 supersededIds。
4. `scope=session` 行为与 WP0 一致（不带新字段也通过）。
5. `scope=visitor` 只召回本 tenant+visitor 的 LONG_TERM，不串会话/不串 visitor/不串租户。
6. TTL 过期不召回；limit clamp；minImportance 过滤。
7. `promoteShortTermToLongTerm` 纯函数：派生 `tier=LONG_TERM`、`ttlMs=null`、importance/content/occurredAt/topicKey 保留、带上 visitorId、生成新 id，不改原条目。
8. resume 首论 `openingContext` 能取到上次高权重长时记忆，且不改动 BDI 快照数值、不含口语。

**B 层（`test/engine-adapters/`，stub client，不触网）**
9. `QdrantMemoryStore.remember/recall` 正确映射 payload 与 score；降级路径在 client 抛错时回退不炸。
10. Embedder 适配器正确桥接 `embedQuery`，异常被吞为降级。

---

## 9. 验收清单（逐条可勾选）

- [x] `tsc -p tsconfig.build.json --noEmit` 0 错。
- [x] `eslint "src/**/*.ts"` 0 error（B 层新文件一并纳入；遵守既有 complexity/prettier/import-order）。
- [x] `npx jest test/engine-core` 全绿；**WP0/WP1 既有 42 用例零回归**。
- [x] `boundary.spec.ts` 全绿：内核整树零 `@nestjs`/`typeorm`；Qdrant/embedding 实现**不在** `engine-core/` 内；新增导出/文件已进白名单与目录清单。
- [x] 同 visitor 跨两次会话，第二次开场能召回上次高权重长时记忆（§5.4）。
- [x] 召回 Top5 可审计：命中带 `score / importance / occurredAt / source / topicKey`。
- [x] 软降级：Qdrant/embed 失败不阻断 turn。
- [x] 本期零口语、零 LLM 调用、零 migration/entity/新表、零 `.env` 改动。

---

## 10. 交付闸门（大炮在 Windows 跑）

```powershell
cd E:\Work\Project\backend\mofang-nestjs
npx eslint "src/**/*.ts"
npx tsc -p tsconfig.build.json --noEmit
npx jest test/engine-core
# B 层用例（若建）：
npx jest test/engine-adapters
```

**新增 env 开关**：无新增内核 env；B 层复用现有 Qdrant / llm embedding 配置，不在本期新增 `.env` 项。

---

## 11. 关键决策记录（已定，实施中不反复）

| # | 决策 | 理由 / 备选 |
|---|---|---|
| M1 | 端口只追加可选字段，`scope` 默认 `session` | 向后兼容，WP0/WP1 测试零改动即通过；避免破坏已发布契约 |
| M2 | Qdrant/embedding 实现放 B 层 `src/engine-adapters/`，内核零框架 | 守 WP0「整包搬走只换适配器」第 0 原则，过 boundary AST 断言 |
| M3 | 本期摘要规则拼接占位，不调 LLM；开场不出口语 | LLM 摘要/渲染属 WP5 低温/高温模型链；本期先把记忆骨架与召回跑通 |
| M4 | 遗忘只降权不物理删，冲突只标记不删除 | 保留审计可回溯；竞争抑制精细权重留 Phase2 |
| M5 | 冲突消解用显式 `topicKey`，不做语义聚类 | 语义聚类需向量/模型，超本期；topicKey 由写入方给，内核纯函数可测 |
| M6 | 复用现有 `QdrantService` 与 `embedQuery`，不新造客户端 | 避免双探活/双配置/双维度管理 |
| M7 | 长时跨会话按 `visitorId` 归属，而非 `sessionId` | sessionId 每场一变，无法跨会话；visitorId 是稳定来访者键 |
| M8 | 晋升用纯函数 `promoteShortTermToLongTerm`，由会话结束编排层异步落仓；`closeSession` 保持同步幂等、不写库 | 守 `closeSession(): void` 既有契约（不做持久化），避免把异步仓储写进同步关闭路径 |

### 待大炮过目（不阻塞开工，有异议再调）

- 衰减半衰期默认 30 天、召回有效重要度阈值 0.1 为**工程种子值**，非标定，后期靠真实训练数据校准。
- 若希望本期就上「LLM 生成本场摘要」，需借 WP5 低温结构化模型链，建议后置到 WP5 一并做，避免记忆层提前耦合模型。
- WORKING 窗口本期只在运行时保留 8 轮，不持久化；若要跨进程保留热窗口属 Redis 热状态，本期不做。

---

## 12. 下一步（本期不做，另起任务单）

1. WP3 会话轨迹控制引擎（三模式：强覆盖 / 修正 / 触发，伦理盲盒触发点一致）。
2. WP5 渲染接线：消费长时开场上下文 + `Intention` 生成承接口语（本期 `reply=''` 在此填值），并把 LLM 摘要接入短时记忆。
3. Phase2：竞争抑制精细遗忘权重、Chinese-MentalBERT 评估、记忆自动回写信念。

---

## 13. 交付状态（2026-10-28 回写）

**代码已交付并自跑复跑绿**，逐条对照见交付记录
[`engine-core-wp2-layered-memory-implementation-2026-10-28.md`](./engine-core-wp2-layered-memory-implementation-2026-10-28.md)。

### 13.1 闸门

| 命令 | 结果 |
|---|---|
| `npx eslint "src/**/*.ts"` | exit 0，0 error |
| `npx tsc -p tsconfig.build.json --noEmit` | exit 0，0 error |
| `npx jest test/engine-core` | 4 套件 / 82 用例全绿（WP0+WP1 既有 42 **零回归** + WP2 新增 40） |
| `npx jest test/engine-adapters` | 1 套件 / 13 用例全绿（stub client，不触网） |

`pnpm build` 全量构建与既有业务测试本轮未跑（本期零 entity / migration / module 改动，内核未被 `app.module.ts` 引用）。

### 13.2 与任务单的差异（须知会）

| # | 差异 | 理由 |
|---|---|---|
| 1 | **新增第 5 个内核 memory 文件 `memory/recall-policy.ts`**（§3.1 只列 4 个） | 召回判定必须只有一份，内存版与 Qdrant 版共用；不抽出来就是"换实现即漂移"的双胞胎。塞进任一既有文件会让该文件同时承担"策略"与"判定"两职 |
| 2 | **`scope` 用字符串联合 `MemoryRecallScope`，非 enum** | 纯控制流判别式，内核零运行时导出，整包搬走不必附带常量表 |
| 3 | **衰减只在 `scope=visitor` 生效；`scope=session` 保持 WP0 原样** | 「行为与 WP0 完全一致」是硬要求；且 session 范围叠加衰减会改变 WP0 已发布语义 |
| 4 | **`minImportance` 口径按范围分**（session 用原始 importance，visitor 用衰减后有效重要度） | 否则衰减机制形同虚设；已在端口 JSDoc 显式标注 |
| 5 | **Qdrant payload 额外带 `expiresAt`**（§6 payload 清单未列） | 长时记忆默认永久，但保留该字段使 TTL 语义在两版实现间对齐 |
| 6 | **「长时记忆必须带 visitorId」不在写入期硬校验** | 写入期硬校验会把 WP0 的合法用法（会话级长时事实）判成非法，**实测打红了 WP0 既有用例**；跨会话可见性改由召回期判定，失败方向安全（漏写 = 召不回，而非被别人召回） |
| 7 | **embedder 走 `LlmRouterService.embed()` 而非基类 `embedQuery()`** | `embedQuery` 不在 `EmbeddingProvider` 接口上，走接口不绑定具体基类；调用形态与既有 `RagService` 同路径 |

### 13.3 已知缺口（下一轮需决策）

1. **Qdrant 版写侧冲突标记未实现**（技术性缺口）：现有 `QdrantService` 未暴露 `setPayload`，也无"仅按 filter 取点"（scroll）能力，靠向量相似度反查冲突分组会漏召回。内核已提供 `resolveConflict` / `applyConflictResolution` 纯函数，由编排层在内存态算好后随新条目落仓；若要在 Qdrant 内原地标记，需先给 `QdrantService` 补 `setPayload`（基建改动，未在本期做）。
2. **短时记忆无自动写入路径**：本期由写入方显式 `remember`（规则拼接占位，不调 LLM）；会话结束编排层（异步落仓）未实现，晋升纯函数已就位待接。
3. **衰减半衰期 30 天 / 阈值 0.1 为工程种子值**，未标定，待真实数据校准。
