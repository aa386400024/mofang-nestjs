# WP55 交付记录 — 会话摘要补齐来访者侧（滚动摘要从「咨询侧纪要」→「两侧对话纪要」）

> 状态: ✅ 已交付
> 任务单: [`wp55-session-summary-both-sides-2026-11-04.md`](wp55-session-summary-both-sides-2026-11-04.md)
> 日期: 2026-11-04
> 红线: ✅ **engine-core 一行未动**（`git diff --stat HEAD -- src/engine-core` 为空）

---

## 1. 实际改了哪些文件

### 1.1 适配层（`src/engine-adapters/**`）：2 改 + 2 改（无新增文件）

| 文件 | 改了什么 |
|---|---|
| `src/engine-adapters/persistence/rolling-summary.generator.ts` | **输入结构改造**：新增 `RollingSummaryRound`（`counselor` + `visitor: string \| null`）；`RollingSummaryInput.newLines` → `rounds`；`formatRollingSummaryInput` 输出**问答交替两行**；系统提示词从「咨询师一侧的发言记录」改成「咨询师与来访者的对话记录（问答交替）」，「不要编造」约束同步改写 |
| `src/engine-adapters/persistence/rolling-session-summary.service.ts` | **状态模型重构**：`pending: string[]` → `pendingRounds` + `evictedRounds`（两个都是**完整轮次**）；新增 `recordRound()`（门面上报一轮）；`recordOverflow()` 退化成**淘汰信号**（把被淘汰的咨询师话匹配到对应轮次）；新增 `RollingSummaryCleanupPort` 窄面；`stateOf` 重构（按 tenant/session/visitor 建状态） |
| `src/engine-adapters/rendering/turn-render-orchestrator.ts` | 新增 `reportRound()`；`settleTurn` 落账时上报完整轮次（降级轮次来访者侧 = `null`）；`settleBlockedTurn` 落账时上报（来访者侧 = `null`）；**`histories` 缓冲一行未动** |
| `src/engine-adapters/wiring/engine-turn.service.ts` | `close()` 增加滚动摘要状态释放（修 WP37 遗留泄漏）；构造参数新增 `@Optional() @Inject(ROLLING_SUMMARY_CLEANUP) rollingSummary?: RollingSummaryCleanupPort`；清理放 `finally`（内核 close 抛错时也要清） |
| `src/engine-adapters/wiring/engine.tokens.ts` | **新增** `ROLLING_SUMMARY_CLEANUP` token（见 §2.10） |
| `src/engine-adapters/wiring/engine.module.ts` | 新增 `{ provide: ROLLING_SUMMARY_CLEANUP, useFactory: (s) => s, inject: [RollingSessionSummaryService] }` 装配 |

### 1.2 配置

| 文件 | 改了什么 |
|---|---|
| `.env.example` | `SESSION_SUMMARY_BATCH_SIZE` 的注释口径更新：**单位从「3 条咨询师发言」改成「3 轮问答对」**（数值不变，**无新增 env 键**） |

### 1.3 测试

| 文件 | 改了什么 |
|---|---|
| `test/engine-adapters/wp55-rolling-summary-both-sides.spec.ts` | **新增**，22 例（两侧输入 / **配对不错位** / 淘汰匹配 / 失败回滚 / 门面上报三态 / 会话关闭清理 + **DI token 守卫** / 零回归） |
| `test/engine-adapters/wp37-rolling-session-summary.spec.ts` | **适配**（21 例，断言口径不变）：服务的输入模型变了（轮次记录取代单条咨询师文本），用例改走 `reportAndEvict()` 助手（门面上报 + 内核淘汰两步合一） |

### 1.4 文档

| 文件 | 改了什么 |
|---|---|
| `docs/worklog/pending/phase2-wp-list-2026-11-03.md` | WP55 行 ✅ + 交付记录链接；统计与进度行回写（5/34 → 6/34） |
| `docs/worklog/README.md` | Phase2 已开工列表 +WP55；进度回写；目录结构说明 +WP55 |

---

## 2. 关键设计决策（与任务单有出入的地方 + 为什么）

### 2.1 偏差①（最重要）：**不做「双队列 + min 配对」，改做「轮次记录」单队列** —— 任务单的方案会产出**假问答对**

**任务单 §4.3 的方案**：两条独立队列 —— 咨询师文本（内核溢出回调给）与来访者文本（门面历史缓冲截断时给），攒批时取 `min(两队列长度)` 逐位配对。

**问题**：这两条流**不是同时到达、也不是等长**的。真实对话里某一轮可能**没有来访者发言**（阻断轮次 `disposal.action === 'block'`、渲染降级轮次），这时两条流就**错开一格**，按下标配对就会把 A 轮的问题和 B 轮的回答配成一对。

**反例（逐轮推演，与真实代码路径一致）**：

对话 6 轮，第 4 轮被阻断（AI 不出声 → 没有来访者回复）：

| 轮次 | 咨询师 | 来访者 |
|---|---|---|
| 1 | c1 | v1 |
| 2 | c2 | v2 |
| 3 | c3 | v3 |
| **4** | **c4** | **（无回复）** |
| 5 | c5 | v5 |
| 6 | c6 | v6 |

- **内核淘汰流**（工作窗口按轮次淘汰，顺序恒定）：c1, c2, c3, c4, c5, c6
- **门面截断流**（历史缓冲是**半轮**列表，16 条按"条"丢不按"轮"丢）：第 4 轮只有咨询师那一条，于是 c4 与上一轮的 v3 被一起丢掉，而 v4（不存在）没有对应条目 → **来访者流整体晚一轮**

于是 `min` 配对的结果是：

- 第 1 批：`(c1,v1) (c2,v2) (c3,v3)` ✓
- 第 2 批：`(c4,v3) (c5,v5) (c6,v6)` ← **`(c4,v3)` 是假问答对**

摘要里会写出「咨询师: c4 / 来访者: v3」—— 而 v3 回答的其实是 c3。模型读到这行会当成**事实**继续推演（"他上一轮说过凌晨三点才睡"），这就是 WP37 交付记录里点名的**最坏的一种失真：凭空捏造被当真**。而且错位一旦发生，**后面所有轮次全部偏移**。

**实际做法**：两侧**绑成一个不可拆的单位** —— `RollingSummaryRound { counselor, visitor }`。配对正确性由**类型系统**保证，不靠下标对齐，调用方也拆不开：

- 门面上报的是**完整轮次**（咨询师话 + 来访者话，来访者没发言就是 `null`）；
- 内核的溢出事件退化成**淘汰信号**（"哪一轮离开了工作窗口"）；
- 两者都按**轮次顺序**到达，天然一一对齐。

同样的反例在新模型下：摘要拿到的是 `(c1,v1) (c2,v2) (c3,v3) (c4,null) (c5,v5) (c6,v6)` —— 第 4 轮显示为「（本轮来访者无回复）」，**零错配**。

`test/engine-adapters/wp55-rolling-summary-both-sides.spec.ts` 的 ② 组就是这个反例的**回归防线**（逐字断言整个批次）。

### 2.2 偏差②：门面**不在 `setHistory` 截断处**捕获来访者文本，改为**每轮落账时上报完整轮次**

**任务单 §4.1 写**：在 `setHistory` 里算溢出数量，从被挤掉的条目里筛出 `role === 'visitor'` 的文本交给摘要服务。

**为什么改**：截断处**拿不到配对信息**。门面历史缓冲是**半轮**列表（`MAX_HISTORY_TURNS = 16` 条），被挤掉的条目里只剩"谁被丢了"，**这一轮的问答是否成对已经断了**（跨截断边界会把一对问答拆到两次丢弃里，见 §2.1 的反例推演）。

改在**落账处**上报（`settleTurn` / `settleBlockedTurn`）：那一刻两侧还在手里，是**一个完整的轮次**，配对天然正确。

**副作用（是好事）**：门面的 `histories` 缓冲**一行未动** → prompt **逐字不变**（任务单 §6.2 的零回归要求达成，且比任务单的方案更强：任务单方案要改 `setHistory`，必然要重新论证截断边界）。

### 2.3 偏差③：端口方法从 `recordVisitorOverflow(..., visitorTexts)` 改为 `recordRound(..., counselor, visitor)`

**任务单 §4.2 写**：`recordVisitorOverflow(tenantId, sessionId, visitorId, visitorTexts: readonly string[])`。

**实际交付**：`recordRound(tenantId, sessionId, visitorId, counselor: string, visitor: string | null)`。

理由同 §2.1/§2.2：**只给来访者侧，等于把配对责任留给下游**。来访者话离开它的咨询师话就没法保证是同一轮。带上来访者话 + 它的咨询师话，配对就在结构里。

另：`visitor` 用 `null` 而不是空串 —— "这一轮没说话"和"说了空话"是两回事，空串会被当成一句发言。

### 2.4 偏差④：生成器输入从「两个平行数组」改为「一个轮次数组」

**任务单 §4.5 写**：`counselorLines: readonly string[]` + `visitorLines: readonly string[]`（按下标配对）。

**实际交付**：`rounds: readonly RollingSummaryRound[]`。

两个平行数组的不变量（"第 i 个咨询师与第 i 个来访者同轮"）是**隐式**的 —— 任何一处只 push 一个数组就会静默错位。轮次数组让这个不变量**结构性成立**。

`formatRollingSummaryInput` 的**输出格式与任务单逐字一致**（「咨询师: xxx\n来访者: yyy」交替 + 无回复写「（本轮来访者无回复）」），所以提示词口径不变。

### 2.5 偏差⑤：会话关闭清理的接线位置 —— 走**构造注入**，不走 `engine.module.ts` 的 deps 工厂

**任务单 §4.4 写**：「`engine.module.ts` 里 `EngineTurnService` 的 deps 注入 `RollingSessionSummaryService`」。

**代码实际**：`EngineTurnService` 是**类 provider**（`engine.module.ts` 的 providers 数组里直接列 `EngineTurnService,`），Nest 按**构造参数元数据**注入，没有 useFactory 可改。

**实际交付**：给 `EngineTurnService` 的构造参数加第 4 位 `@Optional() rollingSummary?: RollingSummaryCleanupPort`，Nest 从同模块的 provider 里解析（`RollingSessionSummaryService` 已在 WP37 装配为模块单例 ✓）。

`@Optional()` 的理由：滚动摘要是**增强**，装配缺席时只是"没有滚动摘要"，不能让整个引擎门面开不起来（与仓库里 `LlmRouterService` 的做法同理）。

**另抽了一个窄面 `RollingSummaryCleanupPort`**（只有 `forgetSession` 一个动作）：会话门面只依赖"释放状态"这一件事，单测能用桩替换，也不会因为服务类重构而被迫改签名。

### 2.6 决策：`close()` 里**先取归属**、清理放 `finally`

- **先取归属**：`registry.remove(handleId)` 在 `finally` 里，清完就查不到 tenant/session 了 —— 而释放滚动摘要状态**需要**这两个键。
- **清理放 `finally`**：内核 `closeSession` 抛错时，滚动摘要的队列与摘要对象同样不能留在内存里（那也是泄漏）。
- **未压队列直接丢弃，不做最后一次 flush**：会话结束时 WP12 的收尾服务会从逐字稿全量压最终摘要并晋升长时记忆，那份摘要覆盖了全部内容 —— 这里再压一次就是重复消耗额度，还可能与最终摘要说法不一致。

### 2.7 决策：内核溢出事件保留，但它只当**淘汰信号**用

内核的 `WorkingWindowOverflowEvent` 结构**一行未改**（任务单 §5 的要求 ✓）：内核只交出"被挤出了哪几轮咨询师话"。

它在新模型里的角色从"内容来源"变成"**时机信号**"：

- 内核负责"**什么时候**该压缩"（窗口裁剪是内核策略）；
- 适配层负责"**怎么**压缩"（内容 + LLM + 落库）。

匹配策略：先按**队首**取（O(1)，正常路径下内核与门面的轮次顺序严格一致），再**全表兜底**（某一轮落账被异常打断时队列会错开一格），**找不到就跳过并记 warn —— 绝不猜**。宁可漏一轮（内容缺失），也不能错配（内容造假）。

### 2.8 决策：提示词从「咨询师一侧」改成「问答交替」，「不要编造」约束同步改写

- 开头一句：`咨询师一侧的发言记录（来访者的话没有出现在这里）` → `咨询师与来访者的对话记录（问答交替）`。
- 第 1 条约束：`不要替来访者编造他没说过的经历…` → `不要编造对话里没有提到的经历、感受或承诺`（现在两侧都在输入里，约束从"别替来访者编造"收紧为"别编造对话之外的东西"）。
- 其余约束（滚动并入上一版、120 字上限、JSON 输出格式）**不变**。

### 2.10 决策：清理端口必须用**显式 Symbol token** 注入（这是本单差点埋进去的一个真坑）

`RollingSummaryCleanupPort` 是 **interface** —— TypeScript 的 interface 编译后**没有运行时值**，`emitDecoratorMetadata` 只能把它降级成 `Object`。而 Nest 正是靠 `design:paramtypes` 决定注入什么：**不给显式 token，它会去容器里找一个叫 `Object` 的 provider** —— 找不到，加上 `@Optional()` 之后就会**静默注入 `undefined`**。

症状极其阴险：应用正常启动、接口正常返回，但**会话关掉了滚动摘要状态永远不释放** —— 正是本单要修的那个泄漏，而且**测试全绿**（单测是手工 `new` 出来的，走不到 Nest 解析这一步）。

这与 `engine.providers.ts` 文件头记的「启动炸弹」（`design:paramtypes = [Function, Object]` → 容器里找不到 `Function` → 启动直接抛）是**同一类坑的两个方向**：一个是炸，一个是静默错。

**实际交付**：

- `engine.tokens.ts` 新增 `ROLLING_SUMMARY_CLEANUP = Symbol('ROLLING_SUMMARY_CLEANUP')`（与既有三个 token 同一范式，Symbol 不会与别的 provider 撞名）；
- `EngineTurnService` 的构造参数用 `@Optional() @Inject(ROLLING_SUMMARY_CLEANUP)` 显式指认；
- `engine.module.ts` 注册 `{ provide: ROLLING_SUMMARY_CLEANUP, useFactory: (s) => s, inject: [RollingSessionSummaryService] }` —— **同一个实例**（清另一份状态等于没清）。

**守卫**：新增两条用例 —— ① token 是 symbol 且与另外三个不撞车；② 读 `engine.module.ts` 源码断言 `provide: ROLLING_SUMMARY_CLEANUP` 与 `inject: [RollingSessionSummaryService]` 都在（"声明了 token 但没注册 provider" = 静默失效，必须挡住）。另有一条用**真服务**跑 `close()` 的用例，断言 `trackedSessionCount()` 真的归零（不只验桩被调用）。

### 2.11 决策：`SESSION_SUMMARY_BATCH_SIZE` 单位换成「轮问答对」，数值不变

任务单 §4.6 已提出，本轮落实：3 条咨询师发言 → 3 轮问答对。**不新增 env 键**，`.env.example` 只改注释口径。内核零 env 读取不变（`boundary.spec.ts` 断言⑩ 仍绿）。

---

## 3. 闸门数字

| 闸门 | 结果 |
|---|---|
| `npx eslint "src/**/*.ts" "test/**/*.ts" "bin/**/*.ts"` | **0 error**（exit 0） |
| `npx tsc -p tsconfig.build.json --noEmit` | **0 error**（exit 0） |
| `npx vitest run --exclude '**/e2e/**/*.ts'` | **93 个测试文件 / 1400 例全绿**（WP37 基线 92 文件 / 1378 例 + 本轮新增 **1 文件 / 22 例**，**零回归**） |
| `npx vitest run test/engine-adapters/wp55-rolling-summary-both-sides.spec.ts` | **22 例全绿** |
| `npx vitest run test/engine-adapters/wp37-rolling-session-summary.spec.ts` | **21 例全绿**（适配后） |
| `git diff --stat HEAD -- src/engine-core` | **空**（本 WP 不碰内核 ✅） |

**回归确认**：

- 没有摘要的会话，门面的历史与 prompt **逐字不变**（`histories` 缓冲一行未动 + `sessionSummary` 缺省不带键）；
- 未装配滚动摘要服务时，门面行为与 WP37 **逐字一致**（`reportRound` 在没装端口时直接返回）；
- WP37 的 21 条行为断言（攒批 / 滚动并入 / SHORT_TERM 落库 / 三档失败降级 / 租户会话隔离 / env 装配 / prompt 接线）**全部保留**，只改了调用姿势。

---

## 4. 本期**没做**的（明确留给后续，别当漏做）

1. **摘要仍是「一段文字」，没有层次** —— 终局蓝图 §4「记忆系统层」要的是「核心议题 / 关键事件 / 情绪转折点」三段式摘要。现在还是一段 ≤120 字的流水摘要，本轮只解决"两侧都在"这一层，层次化是下一步。
2. **会话关闭时不做最后一次 flush** —— 见 §2.6（WP12 最终摘要已覆盖全量内容）。
3. **滚动摘要仍是进程内状态**（模块单例）—— 进程重启后本场会话的滚动摘要丢失。跨会话连续性由 WP2 长期记忆 + WP12 最终摘要承担，那是另一条路。
4. **`spec.recall` 仍不进 prompt** —— 长期记忆召回在语言生成侧仍然断着（既有缺口，已在 Phase2 清单 **WP56**）。
5. **摘要不进对话轮次序列** —— 只作为 system prompt 里的一行「背景」注入，**不伪装成对话轮次**（伪装会让模型以为来访者真说过那段话）。
6. **摘要的字数上限仍是 120 字** —— 两侧内容比原来密，120 字可能压缩得更狠；本轮按任务单要求不动这个数（它是工程种子，不是临床数字），后续按真实对练校准。

---

_创建：2026-11-04_
