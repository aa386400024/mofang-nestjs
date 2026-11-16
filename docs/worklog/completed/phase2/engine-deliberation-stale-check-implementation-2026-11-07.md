# 过期判定与丢弃 交付记录 — 审议结果快照版本校验

> 状态: ✅ 已交付
> 任务单: [`deliberation-stale-check-2026-11-07.md`](deliberation-stale-check-2026-11-07.md)
> 日期: 2026-11-07
> 红线: ✅ **engine-core 零改动** —— `git diff --stat HEAD -- src/engine-core` = **空**（直接用内核现有 `BdiStateRepository.load()`，不动内核代码）
> 边界断言: ✅ `boundary.spec.ts` 全绿（12 例，零改动即零影响）
> 北极星: [`../../../architecture/hybrid-bdi-agent-blueprint-v1.0.md`](../../../architecture/hybrid-bdi-agent-blueprint-v1.0.md) §2.3 约束校验层 + 切灰度前置
> 承接: WP65 后半段（mutex + 快照版本号透传）/ 约束校验层（delta cap）
> ⚠️ **影子模式不变** —— 审议结果照旧**不写** BDI 快照；本单只是把"过期"这个事实**测出来并记进 trace**，切灰度后才用这个判定决定"要不要 apply"

---

## 1. 实际改了哪些文件

### 1.1 生产代码：1 改

| 文件 | 改了什么 |
|---|---|
| `src/engine-adapters/deliberation/llm-deliberation.service.ts` | **改**（+约 150 行 / -约 5 行）：① 新增导出类型 `DeliberationStaleCheck`；② 新增私有方法 `checkStale(tenantId, sessionId, baseRevision)` → `{ stale, currentRevision }`（load 一次当前快照的 revision 并对比）；③ constructor 新增第 4 个依赖 `@Inject(ENGINE_BDI_STATE_REPOSITORY) private readonly bdiStates: BdiStateRepository`；④ `DeliberationTraceRecord` 加**必填**字段 `stale` + `currentRevision`；⑤ `executeShadowMode` 的 ok 分支在 `buildSuccessRecord` **之前**插入过期判定；⑥ `buildSuccessRecord` 多收一个 `staleCheck` 参数并把两个字段塞进 trace；⑦ `buildFailureRecord` 填 `stale: false` + `currentRevision: null`（形状与成功轮次一致）；⑧ import 加 `Inject` + `type BdiStateRepository` + `ENGINE_BDI_STATE_REPOSITORY` token |

### 1.2 测试：1 增 7 改

| 文件 | 改了什么 |
|---|---|
| `test/engine-adapters/wp-deliberation-stale-check.spec.ts` | **新增 16 例**（本单主测试）：① 判定口径（表驱动 4 例）② 保守兜底 2 例 ③ trace 形状 3 例 ④ 端到端（真仓储 + 真轮次推进）3 例 ⑤ 锚 R1 口径 2 例 ⑥ 隐私边界 1 例 ⑦ DI 契约 1 例 |
| `test/engine-adapters/wp64-deliberation-shadow.spec.ts` | **改**：service 构造补第 4 个依赖（BDI 仓储替身） |
| `test/engine-adapters/wp65-deliberation-queue.spec.ts` | **改**：同上 |
| `test/engine-adapters/wp65-deliberation-mutex-revision.spec.ts` | **改**：同上（本文件用**真的** `InMemoryBdiStateRepository` —— 它本来就 import 了） |
| `test/engine-adapters/wp66-deliberation-retry.spec.ts` | **改**：同上 |
| `test/engine-adapters/wp68-deliberation-intention-lock.spec.ts` | **改**：同上 |
| `test/engine-adapters/wp-deliberation-delta-cap.spec.ts` | **改**：同上 |
| `test/admin-debug/wp58-debug-session.spec.ts` | **改**：`makeDeliberationRecord()` 造的 trace 字面量补 `stale` + `currentRevision`（新字段是**必填**）—— 与 delta-cap 那单同款处理 |

### 1.3 文档

| 文件 | 改了什么 |
|---|---|
| `docs/worklog/pending/deliberation-stale-check-2026-11-07.md` | 状态行改 ✅ + 指向交付记录；追加「§十二 交付后补记」偏差表 → 移入 `completed/phase2/` |
| `docs/worklog/pending/phase2-wp-list-2026-11-03.md` | 「过期判定与丢弃」那条打 ✅；PoC 组小结的"下一站"改为"只剩临床合理性校验" |
| `docs/worklog/README.md` | Phase2 已开工列表加一条（过期判定与丢弃） |

### 1.4 **零改动**（逐条核实过）

- `src/engine-core/**` —— **一行未动**（`git diff --stat HEAD -- src/engine-core` = 空）
- `src/engine-adapters/wiring/engine.module.ts` —— **一行未动**（`ENGINE_BDI_STATE_REPOSITORY` 这个 provider **早就存在**，本单只是让审议层也注入它）
- 内核 `BdiStateRepository` 端口 —— **零改动**（直接用现成的 `load()`）
- 审议 prompt / 格式校验 / delta cap / 意图锁定 / 熔断器 —— **全部零改动**
- 无 migration / 无 entity / 无新表 / 无新列
- **不新增 env 开关** —— 复用 `ENGINE_DELIBERATION_ENABLED`（审议总开关，关着就啥都不跑，包括过期判定）
- **不新增 admin 接口** —— `stale` / `currentRevision` 直接出现在 Redis trace 的 JSON 里（admin 侧是 `JSON.parse(raw) as DeliberationTraceRecord` 透传，无字段枚举 → 形状零影响）
- `admin-dashboard/` —— 零改动（前端另一个 AI 的活）

---

## 2. 关键设计决策（与任务单有出入的地方 + 为什么）

> 任务单与代码不符的地方按 `team/conventions.md` §2.5 处理：**先 grep 核实 → 找企业级最佳方案 → 在交付记录里写明偏差**。
> 任务单 §二的 8 条核实清单**逐条自己 grep 核实过** —— 其中**第 3 条任务单写错了**（见 §2.1）。

### 2.1 决策 D1（最重要）：任务单核实清单第 3 条**写错了** —— DI 必须用 token，不能用接口类型

**任务单原文**：

> | 3 | `BdiStateRepository` 已经在 engine.module 里提供了 | ✅ 已确认（`engine.module.ts:300`，`bdiStates: BdiStateRepository`） |

**核实过程**：

- `engine.module.ts:300` 那一行是 `ENGINE_SESSION_PORT` 这个 provider 的 **useFactory 形参列表**（`bdiStates: BdiStateRepository,`）—— 那是 **TypeScript 类型标注**，**不是 provider 注册**；
- 真正的 provider 注册在 `engine.module.ts:277`：`{ provide: ENGINE_BDI_STATE_REPOSITORY, useFactory: (config, redis): BdiStateRepository => ... }` —— token 是个 **Symbol**；
- 也就是说：**`BdiStateRepository` 这个"名字"在 Nest 容器里根本不是一个可注入的 token**。

**为什么这条必须改**（不能照抄任务单）：

- `BdiStateRepository` 是 **interface** —— TypeScript 的 interface 编译后**没有运行时值**（仓库自己的 `engine.tokens.ts:44-50` 把这个坑写得很清楚："interface 编译后没有运行时值, `emitDecoratorMetadata` 只能把它降级成 `Object`"）；
- 任务单 §4.1 写的 `加一个参数 private readonly bdiStates: BdiStateRepository`（**不带 `@Inject`**）会让 Nest 按 `design:paramtypes` 去找名为 `Object` 的 provider —— **找不到，就静默注入 undefined**（`@Optional()` 还会把这个静默失败变成"看起来正常"的运行结果）；
- **症状极其隐蔽**：不报错、不崩、审议照跑，但过期判定**永远走兜底分支** → `stale` 恒为 `false` → **过期率恒为 0**。切灰度的人看到"过期率 0%"会以为"审议结果永远不过期"，从而**放弃这道安全网** —— 这正是我们要防的那个事故，只是方向反了。

**落法**（与仓库既有先例逐字一致）：`@Inject(ENGINE_BDI_STATE_REPOSITORY) private readonly bdiStates: BdiStateRepository`

- 先例：`src/admin-debug/debug-kernel-state.ts:342` 的 `DebugKernelStateRestorer` **就是同一个 token、同一个写法**（注入 BDI 状态仓储）；
- 同一个 token ⇒ **同一个单例实例** ⇒ 审议层读到的与内核写侧是**同一份真相**（WP38 把仓储提成独立 provider 就是为了这个）。

**并且**：`ENGINE_BDI_STATE_REPOSITORY` 已在 `EngineWiringModule` 的 `exports` 里（`:540`），`LlmDeliberationService` 也在**同一个 module** 的 `providers` 里（`:523`）→ **装配层零改动**。

**用例 ⑦-1 把这条钉死**（逐行扫源码注释掉注释行，断言声明参数那一行带 `@Inject`）—— 防止后人"顺手简化"成裸接口类型。

### 2.2 决策 D2：过期判定放在 `resolveLock` **之后**、`buildSuccessRecord` **之前**

**为什么不是任务单 §4.3 字面写的"LLM 跑完、格式校验通过、cap 砍幅做完之后"**：

- `cap` 砍幅其实是在 `buildSuccessRecord` **内部**做的（delta-cap 那单的结构性设计：进 trace 的 delta 必然过了约束校验层）—— 所以"cap 做完之后"在代码里**没有独立的一步**，只能在 `buildSuccessRecord` 之前插；
- `resolveLock`（意图锁定判定）也在 `buildSuccessRecord` 之前，它要读一次 Redis 的锁状态。**把过期判定放在它后面**，是让"读当前 revision"离"写 trace"更近 —— 审议与写 trace 之间隔得越久，"中间有没有跑别的轮次"这个判断就越准；
- 两个判定都只依赖 `input` 与仓储/Redis，**互不依赖**，顺序不影响正确性。

### 2.3 决策 D3：判定口径 **`currentRevision > baseRevision`** —— 严格大于，不是 `!=`

**任务单 §三** 列了三种情况：`==` 没过期、`>` 过期、`<` "不可能（防御性处理）"。

**落法**（与 §三 完全一致）：

| currentRevision vs baseRevision | stale | 说明 |
|---|---|---|
| `==` | `false` | 中间没跑别的轮次 |
| `>` | `true` | 中间又跑了几轮 |
| `<` | `false` | 不可能发生（防御性地当作没过期） |

**为什么 `<` 要兜成"没过期"而不是"过期"**：`<` 在真实链路里不可能（`baseRevision` 是仓储写回的权威值，`currentRevision` 是同一个仓储读出来的，同一条版本链单调递增）。真出现了，说明**有我没预料到的状态** —— 这种时候**保守**（判没过期）比**激进**（判过期）安全：激进方向会平白丢掉本来有效的审议结果。

### 2.4 决策 D4：**锚 R1 而不是 R0** —— 任务单 §三 已经写清楚，本单照办并用用例钉死

**口径复核**（grep 实证，不是照抄任务单）：

- `in-memory-engine-session.ts:418`：`revision: base.revision + 1` → 本轮**落库后**的版本 = R1；
- `in-memory-engine-session.ts:452`：`revision: saved.revision`（**取仓储返回的权威值**）→ `EngineTurnOutput.revision` = R1；
- `turn-render-orchestrator.ts:715`：`baseRevision: output.revision ?? 0` → 门面原样透传 R1；
- `llm-deliberation.service.ts` 入参 `baseRevision` = R1。**链路逐字一致**。

**为什么必须锚 R1**（任务单 §三 的论证，本单复核无误）：

- 审议在本轮落库**之后**才入队 → 回来时当前版本**必然 `>= R1`**；
- 若锚 R0（= R1 - 1），回来时当前版本是 R1 > R0 → 判定**永远**为"过期" → 切灰度后审议结果**全被丢弃** → 机制静默失效。

**用例 ⑤-1 / ⑤-2** 把这两端都钉死（`currentRevision == R1` → 不判过期；`currentRevision == R0` → 防御性地不判过期）。

### 2.5 决策 D5：保守兜底 —— load 失败 / 会话不存在 → `{ stale: false, currentRevision: null }`

**任务单 §三 的方向完全正确，照办**。理由复述并**补一条代码依据**：

- `RedisBdiStateRepository.load()` 在底层不可达时**抛 `EngineCoreError(STORAGE_FAILURE)`**（`redis-bdi-state.repository.ts:301`）—— 不是返回 null，所以 **try/catch 是必需的**，不能只判 null；
- `load()` 返回 null 的两种情况：会话从未落库 / 已被清理（端口注释明确"load 未命中返回 null（不抛错）"）；
- **为什么保守**：影子期只是观测。误判过期 → "过期率"虚高 → **把切灰度决策带偏**（会让人以为"审议结果大多无效"，从而不敢切）；误判没过期 → 只是少记几条。**两个方向的代价不对称，保守方向是对的**。

**日志口径**：`[deliberation_stale] 快照读取失败, 按未过期处理 (session=...)` —— 只出**定位信息**（session id + 错误消息），**不含对话原文 / 心理内容**（隐私红线 AGENTS.md §5.4）。

### 2.6 决策 D6：失败轮次**不跑**过期判定，但 trace 形状**保持一致**

任务单 §4.4 的要求：`buildFailureRecord` 也填 `stale: false` + `currentRevision: null`。

**为什么失败轮次不用判**：失败轮次**没有审议结果可丢弃**（"过期"这个概念对它没有意义）。**形状一致**是硬要求 —— 消费方（debug 面板、未来的灰度判定代码）**不用判分支**就能读字段。

**用例 ③-2 / ③-3** 钉死这一点。

### 2.7 决策 D7：不新增 env 开关、不新增 admin 接口

- 任务单 §六 说"不需要新增 env 开关 —— 过期判定是审议的内部机制，审议开了就该有" —— **正确，照办**。复用 `ENGINE_DELIBERATION_ENABLED`：总开关关着时连审议都不跑，自然也不判过期；
- 任务单 §五 说"本期不新增 admin 查询接口 —— `stale` 和 `currentRevision` 直接出现在 Redis trace 的 JSON 里" —— **核实通过**：admin 侧读 trace 是 `JSON.parse(raw) as DeliberationTraceRecord`（`debug-session.service.ts:954`）**透传，无字段枚举** → 新字段自动可见，debug 面板零改动。

---

## 3. 闸门数字（本单实跑）

| 闸门 | 命令 | 结果 |
|---|---|---|
| lint | `npx eslint "{src,test,bin}/**/*.ts"` | **0 error** ✅ |
| 类型 | `npx tsc -p tsconfig.build.json --noEmit` | **0 error** ✅ |
| 本单新增单测 | `npx vitest run test/engine-adapters/wp-deliberation-stale-check.spec.ts` | **16 例全绿** ✅ |
| 审议组回归 | `npx vitest run`（8 个审议 spec） | **186 例全绿** ✅ |
| 全量单测 | `npx vitest run --exclude '**/e2e/**/*.ts'` | **126 文件 / 2152 例全绿** ✅ |
| 边界断言 | `npx vitest run test/engine-core/boundary.spec.ts` | **12 例全绿** ✅ |
| **engine-core 红线** | `git diff --stat HEAD -- src/engine-core` | **空**（零改动） ✅ |

**全量单测对比**：改动前 **125 文件 / 2136 例**，改动后 **126 文件 / 2152 例**（+1 文件 = 本单新测试；+16 例 = 本单新增用例；**既有 2136 例零失败**）。

**`npx tsc --noEmit`（根 tsconfig，含 test/）说明**：根配置**改动前就有 2 个既有报错**（`wp58-debug-session.spec.ts:227` 的 `CharacterProfile` 缺两个字段、`:456` 的构造函数参数）—— 已用 `git stash` 实测确认是**基线既有问题**，与本单无关。本单**没有新增任何类型报错**（改完后 `wp58` 只剩那 2 条基线报错；本单新文件零报错）。

---

## 4. 验收逐条（任务单 §九）

| # | 闸门 | 要求 | 结果 |
|---|---|---|---|
| 1 | ESLint | 0 problem | ✅ **0 error** |
| 2 | TypeScript | 0 error | ✅ **0 error** |
| 3 | 单测 | 全量跑通，不新增失败 | ✅ **126 文件 / 2152 例全绿** |
| 4 | engine-core | 零改动 | ✅ **`git diff --stat HEAD -- src/engine-core` = 空** |
| 5 | 判定口径 | `currentRevision > baseRevision` → `stale: true` | ✅ 用例 ①（表驱动，含 `9 > 7` / `8 > 7`） |
| 6 | 边界 | `currentRevision === baseRevision` → `stale: false` | ✅ 用例 ①（`7 == 7`） |
| 7 | 兜底 | load 失败 / 会话不存在 → `stale: false` + `currentRevision: null` | ✅ 用例 ②-1（抛错）/ ②-2（返回 null） |
| 8 | trace 形状 | 成功 / 失败两种情况下形状一致（都有 `stale` + `currentRevision`） | ✅ 用例 ③-2 / ③-3 |

**额外覆盖**（任务单未列，本单补的）：

- ④ 端到端（**真仓储** + 真轮次推进）3 例 —— 用 `InMemoryBdiStateRepository` 落 revision=7 → 审议 → 落 revision=8 → 判过期，验的是**真实链路**不是替身；
- ⑤ 锚 R1 的口径 2 例 —— 钉死"锚 R1 不是 R0"；
- ⑥ 隐私边界 1 例 —— `stale` / `currentRevision` 只有数字，不含对话原文；
- ⑦ DI 契约 1 例 —— 钉死"必须用 token 注入"（防止后人简化成裸接口类型 → 静默失效）。

---

## 5. 切灰度时必须知道的两件事（**本单不写进代码**，留给 Phase3A）

1. **过期判定是"观测"，不是"拦截"** —— 影子期审议结果照旧不写 BDI 快照。切灰度后，这道判定要变成"**过期就丢弃**"（任务单 §八 明确"不做'过期了就重试'"）。
2. **`currentRevision: null` 的记录要单独看** —— 它表示"判定没做成"（load 失败 / 会话不存在），**不等于"没过期"**。切灰度后如果把 `null` 当成"有效"，就会把一批**判定失败**的审议结果误当成有效 —— 建议切灰度时把 `stale === false && currentRevision !== null` 作为"可 apply"的完整条件（`currentRevision === null` 一律丢弃）。影子期先看这批记录的占比，再决定要不要把兜底方向调保守。
