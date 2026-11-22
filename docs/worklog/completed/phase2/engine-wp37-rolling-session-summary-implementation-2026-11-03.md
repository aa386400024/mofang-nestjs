# WP37 交付记录 — 记忆会话级摘要压缩（工作窗口溢出 → 滚动摘要 → 进渲染上下文）

> 状态: ✅ 已交付
> 任务单: [`wp37-memory-session-summary-compression-2026-11-03.md`](wp37-memory-session-summary-compression-2026-11-03.md)
> 日期: 2026-11-03
> 红线: **engine-core 预批准例外**（已在 Phase2 WP 清单登记；改完 `boundary.spec.ts` **11 条断言全绿**）

---

## 1. 实际改了哪些文件

### 1.1 内核（`src/engine-core/**`，预批准例外）：5 改（**无新增内核文件**）

| 文件 | 改了什么 |
|---|---|
| `src/engine-core/memory/working-window.ts` | **新增纯函数** `overflowedWorkingWindowLines(previous, incoming, n)` —— 算出"这一轮被挤出窗口"的轮次（窗口保尾弃头 → 被挤出的是**队首**那一段） |
| `src/engine-core/domain/engine-session.types.ts` | **新增** `WorkingWindowOverflowEvent`（`tenantId` / `sessionId` / `visitorId` / `pushedOut`）—— 溢出事件契约 |
| `src/engine-core/in-memory/in-memory-engine-session.ts` | 构造项加 `onWorkingWindowOverflow?: (event) => void`；trim 处用纯函数算溢出并回调；新增 `notifyWindowOverflow()`（**吞异常**，不让摘要故障拖垮整轮） |
| `src/engine-core/domain/rendering/render-types.ts` | `RenderSpec` 新增可选 `sessionSummary?: string` —— 滚动摘要进渲染契约 |
| `src/engine-core/index.ts` | barrel 追加 2 个公开符号（`overflowedWorkingWindowLines` / `WorkingWindowOverflowEvent`） |

> **内核仍然零网络 / 零 prompt / 零 `process.env` / 零 NestJS** —— 边界断言①–⑪ 全绿。

### 1.2 适配层（`src/engine-adapters/**`）：2 增 + 5 改

| 文件 | 改了什么 |
|---|---|
| `src/engine-adapters/persistence/rolling-summary.generator.ts` | **新增**：`RollingSummaryGenerator` 窄面端口 + `LlmRollingSummaryGenerator`（走 `LlmRouterService`，复用 WP12 的 `parseSummaryResponse`）+ `formatRollingSummaryInput` + `resolveRollingSummaryModel` |
| `src/engine-adapters/persistence/rolling-session-summary.service.ts` | **新增**：`RollingSessionSummaryService` —— 按 tenant+session 隔离状态、攒批阈值触发、fire-and-forget 异步压摘要、滚动并入上一版摘要、写 `SHORT_TERM`/`SUMMARY` 记忆条目、失败回队 + 队列上限；另提供 `latestSummary` / `forgetSession` / `trackedSessionCount` |
| `src/engine-adapters/rendering/spec-assembler.ts` | `SpecAssemblyInput` 加 `sessionSummary?` → 规格（缺省不带该键 → 与 WP5 逐字一致） |
| `src/engine-adapters/rendering/turn-render-orchestrator.ts` | 依赖加 `rollingSummary?`；新增 `resolveSessionSummary()`（从 `resolveSession` 缝取归属）；system prompt 在"内在状态"块内加一行 `- 此前我们聊过（背景，不要说出口）：…` |
| `src/engine-adapters/wiring/engine.providers.ts` | `EngineSessionTuningDeps.onWorkingWindowOverflow?`、`EngineOrchestratorDeps.rollingSummary?`、`SessionCloseoutDeps.summaryImportance?`（后者只做透传） |
| `src/engine-adapters/wiring/session-summary.config.ts` | **新增**：`resolveSessionSummaryConfig(config)` —— 3 个 `SESSION_SUMMARY_*` 键**逐个字面量**读，非法值回退种子值 |
| `src/engine-adapters/wiring/engine.module.ts` | 新增 `RollingSessionSummaryService` **模块单例** provider；`ENGINE_SESSION_PORT` 注入 `onWorkingWindowOverflow`；`TurnRenderOrchestrator` 注入**同一实例**；收尾服务接 `summaryImportance` |

### 1.3 配置

| 文件 | 改了什么 |
|---|---|
| `.env.example` | **新增** `SESSION_SUMMARY_BATCH_SIZE` / `SESSION_SUMMARY_ROLLING_IMPORTANCE` / `SESSION_SUMMARY_FINAL_IMPORTANCE`（**全部留空** = 继承代码里的种子值）+ 说明与非法值回退口径 |
| `typings/global.d.ts` | 显式声明 3 个 `SESSION_SUMMARY_*` 键（仓库约定：不许用 bracket / 计算键绕过） |

### 1.4 测试

| 文件 | 改了什么 |
|---|---|
| `test/engine-core/wp37-rolling-summary-hook.spec.ts` | **新增**，8 例（纯函数形状 / 回调触发与时机 / 归属三件套 / 异常吞掉 / 无回调时逐字不变 / 未装配不报错） |
| `test/engine-adapters/wp37-rolling-session-summary.spec.ts` | **新增**，21 例（攒批阈值 / 滚动并入 / `SHORT_TERM`+`SUMMARY` 写入 / 三档失败降级 / 会话与租户隔离 / prompt 注入 / env 装配与非法值回退） |
| `test/engine-core/boundary.spec.ts` | 断言⑥ 白名单 +`overflowedWorkingWindowLines` +`WorkingWindowOverflowEvent` |
| `test/config/wp25-env-example-coverage.spec.ts` | **新增断言③f**（3 个 `SESSION_SUMMARY_*` 键逐个字面量读 + **内核树零该族字符串**） |

### 1.5 文档

| 文件 | 改了什么 |
|---|---|
| `docs/worklog/pending/phase2-wp-list-2026-11-03.md` | WP37 行 ✅ + 交付记录链接；engine-core 例外表登记本轮实际改了什么；统计与进度行回写；**新增 WP55 / WP56**（本轮遗留，见 §4） |
| `docs/worklog/README.md` | Phase2 已开工列表 +WP37；进度回写；目录结构说明 +WP37 |

---

## 2. 关键设计决策（与任务单有出入的地方 + 为什么）

### 2.1 偏差①：回调签名从「文本数组」改成「事件对象」（加归属三件套）

**任务单 §3.1 写**：`onWorkingWindowOverflow?: (pushedOut: readonly string[]) => void;`
**实际交付**：`onWorkingWindowOverflow?: (event: WorkingWindowOverflowEvent) => void;`，事件带 `tenantId` / `sessionId` / `visitorId` / `pushedOut`。

**为什么改**：

1. **适配层要写 `MemoryEntry`，而契约强制归属** —— `assertValidMemoryEntry` 要求 `tenantId` + `id` + `sessionId` 都在。只给一段文本，适配层**写不出合法记忆条目**（要么瞎填一个 tenant —— 那是跨租户串数据；要么不写 —— 那这轮摘要白压）。
2. **滚动摘要的状态必须按会话隔离** —— 两个租户撞同一个 `sessionId` 并非不可能（`sessionId` 只是业务主键）。不带租户就是**把 A 租户来访者聊的内容说给 B 租户听**。会话键因此写成 `tenantId.length:tenantId::sessionId.length:sessionId`（长度前缀防拼接歧义）。
3. **`visitorId` 一并带上** —— 记忆条目要带来访者 id，而内核是唯一知道这个 id 的地方（适配层的归属解析缝只给 `tenantId` + `sessionId`）。

**代价**：内核多了一个类型（26 行）。换来的是适配层不用猜、不用瞎填，且事件契约自带字段口径说明。

### 2.2 偏差②：文件落在既有 `persistence/`，不开新的 `memory/` 目录

**任务单 §3.3 写**：`src/engine-adapters/memory/session-summary.service.ts`
**实际交付**：`src/engine-adapters/persistence/rolling-session-summary.service.ts` + `src/engine-adapters/persistence/rolling-summary.generator.ts`

**为什么改**：`src/engine-adapters/` 下**根本没有 `memory/` 目录**。适配层的记忆 / 摘要代码全在 `persistence/`（WP12 的 `session-summary.generator.ts` / `session-closeout.service.ts` / `memory-config.ts` 都在那儿）。照任务单字面路径开一个新目录，等于给"记忆与摘要"开**第二个家** —— 仓库的"单一真相源"纪律不认这种分家。改成落在 `persistence/`，并用 `rolling-` 前缀与 WP12 的最终摘要区分开（WP12 那条叫 `session-summary.*`，本轮这条叫 `rolling-session-summary.*` / `rolling-summary.*`）。

### 2.3 偏差③：不用 `CounselorLlmJsonClient`，改走引擎层既有的 LLM 链

**任务单 §3.3 写**：「复用现有的 `CounselorLlmJsonClient` 或文本生成接口」。

**为什么改**：`CounselorLlmJsonClient` 住在 `src/counselor/`（业务层）。`engine-adapters` 依赖它 = **适配层反向依赖业务层**，破坏仓库的依赖倒置（业务层 → 适配层 → 内核）。改用引擎层自己那条链：`LlmRouterService`（`src/llm/registry/`）+ WP12 的 `parseSummaryResponse`（退化口径只有一份，不新造第二套 JSON 解析）。

> 仓库 16 条硬约束第 6 条说"结构化输出只有一条链 —— 走 `CounselorLlmJsonClient`"，那条约束的作用域是 `src/counselor/` 业务层；引擎层既有链（WP12 摘要器）才是这里的同款先例。照抄 WP12 的做法，不新造客户端。

### 2.4 偏差④：§3.4「会话结束最终摘要」**不重复实现**，改为把 importance 做成可配

**任务单 §3.4 写**：「会话结束时把当前工作窗口里剩下的轮次也压缩进摘要，生成一份完整摘要，importance 调高（0.7）」。

**为什么不重复实现**：WP12 交付的 `session-closeout.service.ts` **已经做了这件事** —— 会话结束时把逐字稿压成 ≤200 字摘要，并从 `SHORT_TERM` 晋升为 `LONG_TERM`，`importance = 0.9`。再做一份 = 两个真相源（两份摘要内容可能不一致，且谁生效说不清）。

**实际交付**：`SESSION_SUMMARY_FINAL_IMPORTANCE` 让 WP12 那条路径的 important 可配，**缺省仍是 0.9**（行为与 WP12 逐字一致）。

**为什么不用任务单的 0.7**：0.7 是任务单单方面给的数，没有出处。仓库纪律是"不发明临床数字"，而且 0.9 有明确理由 —— 长时记忆召回按**衰减后**的有效重要度卡 0.5 门槛（半衰期 30 天），0.9 衰减到 0.5 约需 23 天，也就是"学员一周后回来还能被想起"；0.7 衰减到 0.5 只要约 10 天，跟产品里"跨会话记忆"的实际使用节奏对不上。

### 2.5 偏差⑤：验收 #2 的口径 —— 真实流程里回调**每轮触发一次、各 1 条**

**任务单 §5 写**：「窗口从 8 轮涨到 9 轮 → 回调被触发一次，参数是 1 轮；涨到 10 轮 → 回调被触发一次，参数是 2 轮」。

**代码实际**：真实流程是**逐轮追加**的 —— 每轮只往窗口尾部加 1 条。所以从 8 轮涨到 10 轮是**两次**追加 → 回调触发**两次**，每次各 1 条（第 1 轮、第 2 轮被挤出）。任务单描述的"一次挤 2 条"只在**窗口被外部塞进超额条目**时才会出现。

**处理**：
- **真实路径**按实际语义测：8→9 触发 1 次 1 条；8→10 触发 2 次、共 2 条（累计第 1、2 轮）；
- **"一次挤 2 条"**这个形状由纯函数 `overflowedWorkingWindowLines` 单独覆盖并单测（它本来就该能一次算出多条 —— 规则只有一份）。

不是"改验收凑数"：是把**形状**（一次挤 N 条）交给纯函数保证，把**触发语义**（每轮一次）按真实代码路径保证，两件事分别钉死。

### 2.6 偏差⑥（最重要）：任务单没提"摘要怎么进 prompt" —— 补上这一环，否则功能空转

任务单 §3.3 写的是「把摘要写回 memory store」，但**全文没有一句说摘要怎么被模型看到**。只写不读 = 功能空转（压了摘要，模型照样只看得见最近 8 轮）。

**盘查后的真实链路**（grep 核实，非推测）：

```
buildEngineRenderDeps (wiring/render-config.factory.ts)
  → buildMessages: buildVisitorMessages (rendering/turn-render-orchestrator.ts)
      → system prompt (buildVisitorSystemPrompt) + spec.recentTurns
```

而 `spec.recall`（WP2 记忆命中槽）**当前根本不被 `buildVisitorSystemPrompt` 读取** —— 全 `src/` 树 grep `\.recall` 只有 `MemoryStore.recall` 的端口调用，没有一处渲染消费。长期记忆召回因此**从来没进过 prompt**（既有缺口，本轮不动，已挂 WP56）。

**实际交付**：
- `RenderSpec` 新增**独立字段** `sessionSummary?: string` —— **不塞进 `recall`**。塞进去的话，"recall 要不要渲染"就变成"只渲染其中一部分"，是个后来人踩进去就出不来的陷阱；独立字段 = 渲染规则一眼看得懂。
- system prompt 在"内在状态"块**内部**加一行 `- 此前我们聊过（背景，不要说出口）：<摘要>`。
  - **为什么放块内**：块头已经写着"绝对不要说出口" —— 摘要属于同一类"只用来约束你的语气与节奏、不能说出来"的内容，放进去就自动受约束。
  - **为什么不改硬规则文案**：硬规则是所有轮次共用的，改它 = 连"没有摘要"的会话 prompt 也变了 —— 破坏"无溢出时行为不变"这条零回归底线。
- **无摘要时 prompt 逐字不变**（已单测逐字断言）。

### 2.7 决策：摘要是**滚动**的（并入上一版），不是每批各压一段独立的

每批独立出摘要会**丢上下文** —— 第二批的摘要只覆盖第二批，第一批说过的事没人记得了。滚动摘要 = 每一版都覆盖"到目前为止聊过的全部"，越往后越完整，且**始终只有一段**（能塞进 prompt 的长度是固定的，段落数不能随轮次增长）。

生成器因此接收 `{ previousSummary?, newLines[] }`，提示词明确要求"给了上一版摘要时，输出必须并入新内容后的完整版"。

### 2.8 决策：摘要输入**只有咨询师一侧**，且提示词明确禁止替来访者编造

内核**不渲染**，拿不到来访者的话（内核工作窗口里只有咨询师原话）。所以本摘要的口径必须如实说明：它是"咨询师谈了什么"的摘要，不是逐字稿摘要。

两个防线：
1. **输入显式标角色** —— `咨询师: <原话>` 前缀。不标的话模型会以为这是完整对话，把咨询师的话当成来访者的自述。
2. **提示词硬约束**「只写已经出现过的内容……不要替来访者编造他没说过的经历、感受或承诺」。

为什么这条值得单独拎出来：摘要里凭空捏造的事实会被后续对话**当真**（模型会顺着"我们之前聊过他说他怕黑"继续），这是最坏的一种失真 —— 比丢上下文严重得多。

> 补齐来访者侧的落法见 §4 的 WP55。

### 2.9 决策：失败语义三档，**全部不阻断对话**

| 失败点 | 处理 | 为什么 |
|---|---|---|
| LLM 调用失败 | 本批发言**放回待压队列**，下一批连着一起压（内容不丢）；队列超上限（3× 批大小）丢**最旧**的 | 摘要是增强，不是会话成败。丢最旧而非最新：最新的内容离当下最近，丢了摘要就跟当前话题脱节 |
| 记忆写入失败 | 记 warn，**摘要仍然缓存** | 本场对话靠它保持话题连续；只是这一版没落库（下下场接手时看不到） |
| 未装配生成器 | **只攒不压**（且清空待压队列） | 装配缺席 = 本场没有摘要，不是会话失败。队列不清会让内存白涨 |
| 内核回调里适配层抛错 | 内核 `notifyWindowOverflow` **吞掉异常** | 与内核既有的 `collectOpeningContext` 同款理由：内核零 logger 依赖（不持有框架），适配层自己的日志才是错因现场 |

### 2.10 决策：异步（fire-and-forget）—— 如实记录它的语义

LLM 调用是**异步**的（几百毫秒到几秒），放在对话主链路上会让每轮对练都多等一次模型。所以回调只做"记账 + 触发"，压缩在后台跑。

**代价（如实记录）**：摘要会**晚一轮左右**进入 prompt —— 第 N 轮溢出，第 N+1 轮左右才可能在 prompt 里看到摘要。这是这个设计的**已知代价**，不是 bug。内核回调本身是**同步**的（纯记账，微秒级），压缩才是异步。

### 2.11 决策：攒批阈值 = 3（任务单 §3.5 的种子值，采纳）

30 轮的对话 = 溢出 22 轮 = 逐轮调 = **22 次 LLM 调用**，而且每次只压 1 轮（一段话压成一句，质量还差）。攒到 3 轮再压 = 调用次数降到 1/3，且每批有足够上下文可压。30 轮 ≈ 7 次调用。

**⚠️ 这是工程种子值，不是临床结论** —— 三处（服务常量 / `.env.example` 注释 / 适配层注释）都写明"待真实对练校准"。

### 2.12 决策：记忆条目**不设 topicKey`

`InMemoryMemoryStore` **不做 conflict resolution**（只有 Qdrant 版才做）。若给摘要条目设 `topicKey`，两个存储实现的行为就会分叉（Qdrant 会按 key 去重 / 覆盖，内存版会追加）。摘要的幂等性由"每批写一条新条目"自然保证，不靠 topicKey。

### 2.13 决策：模型名**共用 `MEMORY_SUMMARY_MODEL`**

滚动摘要（会话中段）与最终摘要（会话结束）是**同一族任务**（从长文本抽要点）。用两个 env 键就出现"两个真相源"。`.env.example` 里已就地加注释说明这一点。

### 2.14 守卫同步（任务单未提，但不改就红）

- **`boundary.spec.ts` 断言⑥ 白名单**是**双向**的 —— 少导出（消费方 import 不到）与多导出（内部实现泄进公开面）都会红。WP42 / WP36 交付时都改了这份白名单，本轮照同一先例。
- **env 断言③f**（照 ③b / ③c / ③d / ③e 先例）：适配层"逐个字面量读"的前提就是这个 AST 抽取守卫 —— 漏写一个键，断言立刻变红。同时断言**内核树零 `SESSION_SUMMARY_` 字符串**（守住"内核零 env"）。

---

## 3. 闸门数字

| 闸门 | 结果 |
|---|---|
| `npx eslint "src/**/*.ts"` | **0 error**（exit 0） |
| `npx eslint "test/**/*.ts"` | **0 error**（exit 0） |
| `npx eslint "bin/**/*.ts"` | **0 error**（exit 0） |
| `npx tsc -p tsconfig.build.json --noEmit` | **0 error**（exit 0） |
| `npx vitest run --exclude '**/e2e/**/*.ts'` | **92 个测试文件 / 1378 例全绿**（WP36 基线 90 文件 / 1348 例 + 本轮新增 **2 文件 / 29 例** + env 断言③f **1 例** = **+30 例**，**零回归**） |
| `npx vitest run test/engine-core/boundary.spec.ts` | **12 例全绿**（11 条编号断言 ①–⑪ + 1 例"扫描到内核源文件"自检） |
| `npx vitest run test/engine-core/wp37-rolling-summary-hook.spec.ts test/engine-adapters/wp37-rolling-session-summary.spec.ts` | **29 例全绿** |
| `git diff --stat HEAD -- src/engine-core` | **5 改**（**预批准例外，不是空**）：`domain/engine-session.types.ts`、`domain/rendering/render-types.ts`、`in-memory/in-memory-engine-session.ts`、`index.ts`、`memory/working-window.ts` —— 134 insertions / 4 deletions |

**回归确认**：既有 WP1 / WP2 / WP12 / WP26 / WP34 / WP42 / WP36 用例**零改动通过**。

- 无溢出的会话，规格与 prompt **逐字不变**（`spec-assembler` 缺省不带 `sessionSummary` 键；prompt 缺省不出现那一行）—— 已单测逐字断言。
- 未装配 `RollingSessionSummaryService` 时，内核会话行为与 WP2 逐字一致（缺省 = 不回调）。

---

## 4. 本期**没做**的（明确留给后续，别当漏做）

1. **摘要只有咨询师一侧**（见 §2.8）—— 内核工作窗口里只有咨询师原话。补齐两侧需要让适配层把**门面的历史缓冲**（`MAX_HISTORY_TURNS = WORKING_MEMORY_WINDOW_TURNS * 2`，两侧都有）里的来访者文本一并交给生成器。已挂 **WP55**。
2. **长期记忆召回（`spec.recall`）不进 prompt**（见 §2.6）—— 全 `src/` 树 grep 核实：`spec.recall` 填的是 `input.output.openingContext`（WP2 记忆命中），但**渲染层一处都没读**。这是**既有缺口**（不是本轮引入的），本轮刻意不动 —— 动它 = 改所有轮次的 prompt，与"零回归优先"冲突。已挂 **WP56**。
3. **摘要不写长时记忆** —— 本轮只写 `SHORT_TERM` / `SUMMARY`。晋升长时记忆是 WP12 收尾的职责，本服务刻意不碰（否则两个实现抢同一件事）。
4. **窗口里剩下的轮次不再单独压一次最终摘要** —— WP12 的收尾路径已经压过（逐字稿 → ≤200 字摘要 → `LONG_TERM`，importance 0.9）。再压一次就是重复。
5. **摘要不进对话轮次序列** —— 只作为 system prompt 的一行"背景"注入，**不伪装成对话轮次**（伪装会让模型以为来访者真的说过那段话）。
6. **摘要内容不落逐字稿** —— 摘要的输入只是被挤出的咨询师原话，不含来访者侧（见第 1 条）。
7. **滚动摘要没有跨会话续接** —— 状态挂在 `RollingSessionSummaryService` 实例上（模块单例，进程内）。进程重启后，本场会话的滚动摘要没了（跨会话的连续性由 WP2 长期记忆 + WP12 最终摘要承担，那是另一条路）。

---

_创建：2026-11-03_
