# WP68 交付记录 — 意图锁定机制（基础版）

> 任务单：[`wp68-deliberation-intention-lock-2026-11-05.md`](wp68-deliberation-intention-lock-2026-11-05.md)
> 日期：2026-11-05
> 红线：**engine-core 零改动**（`git diff --stat HEAD -- src/engine-core` 为空）
> 定位：**PoC 组（WP63–WP68）最后一单**

---

## 1. 实际改了哪些文件

### 1.1 适配层：改 4 个（任务单 §3.1 + §3.2 —— 文件数对得上，归属层有一处调整，见 §2.1）

| 文件 | 改什么 |
|---|---|
| `src/engine-adapters/deliberation/deliberation-types.ts` | ① 新增 `DeliberationIntentionShift`（`targetStrategy` + `reason`）；② `DeliberationOutput` 加 `intentionShift: DeliberationIntentionShift \| null`（**必填、可为 null**）；③ 新增内核 8 种行为策略的**运行时清单** `DELIBERATION_BEHAVIOR_STRATEGIES` + 类型守卫 `isBehaviorStrategy()` |
| `src/engine-adapters/deliberation/deliberation-prompt.ts` | ① user prompt 新增「**当前行为策略**」区块；② schema 描述加 `intentionShift` 的写法 + 8 种合法策略（带中文含义）；③ system prompt 加第 9 条硬约束（`intentionShift` 是可选的，大多数轮次都该是 null） |
| `src/engine-adapters/deliberation/llm-deliberation.service.ts` | ① `DeliberationShadowInput` 加 `ruleStrategy: BehaviorStrategy`；② `DeliberationTraceRecord` 加 4 个字段（`ruleStrategy` / `llmIntentionShift` / `lockedStrategy` / `llmIntentionAccepted`）；③ `validateDeliberationOutput` 加 `intentionShift` 校验；④ 新增纯函数 `resolveIntentionLock()` + 状态类型 `IntentionLockState` + key 构造 `buildDeliberationIntentionLockKey()`；⑤ 新增私有 `resolveLock()` / `loadIntentionLockState()` / `saveIntentionLockState()` / `resolveIntentionLockRounds()`；⑥ 成功路径：算锁定 → 写 trace → 落锁状态 |
| `src/engine-adapters/rendering/turn-render-orchestrator.ts` | **只多传一个字段**：审议入参加 `ruleStrategy`（取 `spec.intention.strategy`）。**门面的其它逻辑一个字没动** |

> ⚠️ **任务单 §3.1 写的 processor 层本单实际零改动** —— 锁定逻辑与锁状态都落在 service 层（已与大炮确认，见 §2.1）。

### 1.2 配置：2 改

| 文件 | 改什么 |
|---|---|
| `.env.example` | 加 `ENGINE_DELIBERATION_INTENTION_LOCK_ROUNDS=`（生效行 + 注释块） |
| `typings/global.d.ts` | 加 `ENGINE_DELIBERATION_INTENTION_LOCK_ROUNDS?: string` |

### 1.3 测试：1 增 5 改

| 文件 | 改什么 | 用例数 |
|---|---|---|
| `test/engine-adapters/wp68-deliberation-intention-lock.spec.ts` | **新增**。覆盖任务单 §5 的 13 条 + 14 条防漂移 | **27** |
| `test/engine-adapters/wp63-deliberation-schema.spec.ts` | 2 处（user prompt 入参加 `ruleStrategy`；"四个区块"→"**五个区块**"并加新标题断言） | 24（原样） |
| `test/engine-adapters/wp64-deliberation-shadow.spec.ts` | 3 处（`buildInput` 加 `ruleStrategy`；`okResult` 加 `intentionShift: null`；Redis 替身补 `get`）+ **trace 计数改法**（见 §2.9） | 33（原样） |
| `test/engine-adapters/wp65-deliberation-queue.spec.ts` | 3 处（同上三件） | 21（原样） |
| `test/engine-adapters/wp66-deliberation-retry.spec.ts` | 3 处（同上三件）+ **trace 计数改法** | 21（原样） |
| `test/engine-adapters/wp67-deliberation-circuit-breaker.spec.ts` | 1 处（`buildInput` 加 `ruleStrategy`） | 25（原样） |

### 1.4 零改动（逐条核实过）

- ✅ `src/engine-core/**` —— **一行不动**（`git diff --stat HEAD -- src/engine-core` 输出为空；用例 ④-16 扫全内核树断言零审议代码）
- ✅ 内核 `planIntention()` 的意图选择逻辑 —— **一行不动**。影子模式下主流程仍然走规则算子选意图
- ✅ 内核 `BehaviorStrategy` 类型 —— **只 import, 不改**（`src/engine-core/index.ts:34` 已有导出）
- ✅ `validateDeliberationOutput` 的 **delta 校验逻辑** —— **一行不动**（只加 `intentionShift` 这一项独立校验）
- ✅ `DeliberationProcessor` —— **一行不动**（锁定逻辑归 service，队列层零感知）
- ✅ `engine.module.ts` / `engine.providers.ts` / `redis.constants.ts` —— 一行不动（不新增 provider、不新增队列）
- ✅ 全项目统一的 `defaultJobOptions` —— 一个字不动

---

## 2. 关键设计决策（与任务单有出入的地方 + 为什么）

### 2.1 决策 D1（已与大炮确认）：**锁定逻辑与锁状态放 service 层**，processor 零改动

任务单 §3.1 写的是「processor 新增 `resolveIntentionLock()` / `loadIntentionLockState()` / `saveIntentionLockState()`，在 `processJob()` 里跑完 LLM 后过一遍锁定逻辑」，同时「service 的 trace 记录里加 4 个字段」。

**这两条放在一起是矛盾的** —— trace 是 `service.executeShadowMode()` **内部**写的（WP65 起就定的"队列层不自己写 trace"纪律）。processor 拿到结局时 trace 早已写完，要把这 4 个字段塞进去只能**二次改写 Redis**（读-改-写，有竞态窗口，每轮多 2 次往返）。

**落法（方案 A，已确认）**：判定与锁状态读写全在 service。

- 判定结果在**写 trace 之前**算好 → trace **一次写成**，无竞态、无额外往返；
- 与「观察面归 service」这条既有纪律一致；
- **锁定是观察工具**（影子模式下不改变任何主流程行为），不是控制闸门 —— 控制闸门才归 processor（WP67 的熔断器就是：它决定"要不要入队"，必须在 LLM 跑之前判定）。

### 2.2 决策 D2（**最实质的一处偏差**）：锁状态拆成 `ruleStrategy` + `effectiveStrategy` **两个**字段

任务单 §4.2/§4.3 的状态只有**一个** `currentStrategy`，情况 2 的判定是 `state.currentStrategy !== currentStrategy`，注释写的是「**规则算子**选的策略变了 —— 说明内核的意图切换了」。

**代码和它自己的注释对不上**：情况 4 会把 `currentStrategy` 写成 **LLM 建议的**策略。于是照抄之后，影子模式下会出现一个假象：

> LLM 的建议被采纳一次 → 下一轮 `state.currentStrategy`(=LLM 建议) 必然 ≠ `currentStrategy`(=规则策略) → **每轮都走情况 2** → 锁被反复重新上锁、**永不过期** → 「锁定机制拦住率」被这个假象**撑爆** → PoC 结论直接失真。

**落法**：状态拆成两个字段 ——

| 字段 | 含义 |
|---|---|
| `ruleStrategy` | 上一轮**规则算子**选的行为策略（内核的真实意图） |
| `effectiveStrategy` | 锁定后**实际生效**的行为策略（可能是 LLM 建议的） |

情况 2 的触发因此变成「`state.ruleStrategy !== currentStrategy`」—— **只在内核真的换了意图时触发**，与它注释里写的意图一致。

**连带**：情况 3 / 5 返回的是 `state.effectiveStrategy`（不是 `currentStrategy`）—— 采纳过的切换要在**锁定期内保持**，否则"锁定"就白锁了。用例 ⑤-18 钉死这条。

### 2.3 决策 D3：**prompt 必须告诉模型"当前行为策略"**（任务单 §3.2 没提）

`intentionShift` 的语义是"**换**到另一个策略"。模型不知道当前用的是哪个，就无从判断该不该换 —— 只能瞎猜。**缺了这个字段，WP68 想回答的问题（"LLM 会不会乱改意图"）就问不出答案。**

**落法**：user prompt 新增「【当前行为策略】」区块，内容 `英文名（中文）`。

- 取 `spec.intention.strategy`（**本轮渲染实际用的那个策略**）：`buildRenderSpec` 保证它永远有值（内核意图缺失时兜底 `simple_response`），而 `output.intention` 在类型上是可选的 —— 用 `spec` 更可靠，且与渲染口径**同一个来源**；
- **英文名在前、中文在后**：模型要**原样输出英文名**（`targetStrategy` 的白名单是英文），中文在前会让模型倾向输出中文 → 校验层直接丢掉。

### 2.4 决策 D4：8 种策略的**运行时清单放适配层**，用**穷尽 Record** 保证"内核加策略 → TS 报错"

内核只导出 `BehaviorStrategy` **类型**（union），运行期没有值 —— 而 prompt 要列合法取值、校验层要拿它做白名单，都需要**运行期**清单。给内核加一个数组 = **破红线**，所以清单落在适配层。

清单用 `Record<BehaviorStrategy, true>` 而不是 `as const` 数组 + `satisfies`：

- `satisfies readonly BehaviorStrategy[]` 只保证"**不多**"（子集），内核加第 9 种策略时数组少一个、**编译期不报错**，模型却永远选不到它；
- `Record<BehaviorStrategy, true>` 反过来 —— 内核加策略而这里没跟 → **TS 直接报错**，逼着补（与渲染层 `STRATEGY_LABEL` / `EMOTION_EXPRESSION` 同一范式）。

### 2.5 决策 D5：`DeliberationOutput.intentionShift` 是**必填但可为 null**（任务单写的是"可选字段"）

蓝图 §2.2 的输出示例就是 `"intentionShift": null` 这个形状。字段**永远存在**（值可能是 null），消费方不用到处判 `undefined`；LLM 不返回它时校验层补 `null`。

### 2.6 决策 D6：非法 `intentionShift` **丢掉当 null + 留证据**，不整份判不合法

任务单 §5.2-7/8 说「校验失败，丢掉」。落法与**单条 delta** 的处理同款：策略名不在 8 种里 / `reason` 为空 → 丢掉这个建议（当 null），原始值进 `rejectedEntries`。

⚠️ **不整份判不合法** —— 一条非法建议不该让整轮审议白跑（那正是 WP66 的重试机制要救的场景）。用例 ②-10 钉死。

### 2.7 决策 D7：**锁状态读失败按"没锁过"**（fail-open），失败轮次**不动**锁状态

- 读失败 → 当没锁过（从第一轮重新算起）。理由与 WP67 的熔断器同款：锁定是**观察工具**不是正确性保障，Redis 抖动不该让所有会话的判定失真；
- 状态写坏（不是合法 JSON / 策略名非法）→ 同样当没锁过，**不让一个坏 key 永久卡住会话**（用例 ⑤-22）；
- **审议失败的那一轮不写锁状态** —— 压根没有建议可判（用例 ⑤-21）。

### 2.8 决策 D8：锁定 0 轮 = **关掉锁定**（合法值，不是非法值）

`ENGINE_DELIBERATION_INTENTION_LOCK_ROUNDS=0` → `lockedUntilRound = 当前轮` → 下一轮就不锁了。这是做**对照实验**（"没有锁定机制时 LLM 有多爱乱改"）的必需档位，所以 0 合法；只有 `< 0` / 非数字 / 空串才回退默认 3。

### 2.9 决策 D9：**既有测试必然要改**（任务单 §6.2 要求"既有用例零回归"，做不到）

`DeliberationShadowInput` 加了必填字段、`DeliberationOutput` 加了必填字段、`executeShadowMode` 一次成功审议现在写**两个** Redis key（trace + 锁状态）—— 凡是断言"`set` 被调用了几次"的用例必然失效。

- `wp64` ②：`expect(set).toHaveBeenCalledTimes(1)` → 改成断言 **trace 写入次数**为 1；
- `wp66` ⑤-e：`expect(set).toHaveBeenCalledTimes(2)` → 改成断言 **trace 写入次数**为 2。

落法是给两个 spec 各加一个 `traceWrites(set)` 辅助（按 trace key 前缀过滤），**既有用例的语义反而更强**（从"set 总调用次数"变成"trace 写了几次"）。**用例数一条没减。**

### 2.10 决策 D10：失败轮次的 4 个新字段**占位**，保持 trace 形状一致

失败时没有跑锁定判定，`llmIntentionShift` / `llmIntentionAccepted` 记 `null` / `false`，`lockedStrategy` 记规则策略占位。理由：消费方（PoC 统计脚本）**不用判成功/失败两种分支**。

### 2.11 决策 D11：优先级标注**不一致**（任务单 🟡 P1，母版 🟢 P2）

任务单抬头写 🟡 P1，母版 `phase2-wp-list` 的 WP68 行与统计表都归在 🟢 P2 技术债桶。**本单按母版口径**（🟢 P2）回写，没改优先级 —— 那是产品口径的取舍，不是本单该定的。

---

## 3. 验收对照（任务单 §6）

### 3.1 功能验收（§6.1）

| 条目 | 要求 | 结果 |
|---|---|---|
| 审议 Schema 加 intentionShift 字段 | ✅ 可选，LLM 觉得不需要就返回 null | ✅（字段必填、可为 null；LLM 不返回时校验层补 null） |
| 意图锁定逻辑 | ✅ 锁定 N 轮，期间忽略 LLM 建议 | ✅（纯函数五情况 + Redis 跨轮状态） |
| 影子模式下可观测 | ✅ trace 里有 ruleStrategy / llmIntentionShift / lockedStrategy / llmIntentionAccepted | ✅（4 个字段，成功与失败两种形状一致） |
| 配置 env 可调 | ✅ 锁定轮数 env 可配 | ✅（默认 3；0 = 关掉；非法值回退不抛错） |

### 3.2 闸门验收（§6.2）

| 闸门 | 要求 | 实测 |
|---|---|---|
| `npx eslint "src/**/*.ts" "test/**/*.ts"` | 0 error | **0 error**（exit 0） |
| `npx tsc -p tsconfig.build.json --noEmit` | 0 error | **0 error**（exit 0） |
| `npx vitest run --exclude '**/e2e/**/*.ts'` | 全绿，既有零回归 | **106 文件 / 1790 例全绿**（WP67 基线 105 文件 / 1763 例 → 本单 **+1 文件 / +27 例**） |
| `git diff --stat HEAD -- src/engine-core` | 为空 | **空** |

> `npx vitest run`（**不带** `--exclude`）会把 e2e 拉进来报 DI 装配失败 —— e2e 要真 DB / Redis，与本单无关。仓库口径一直是带 `--exclude` 跑。

### 3.3 测试用例要求（§5 的 13 条 → 实际 27 条）

| 任务单 §5 | 用例 | 本单 spec 对应 |
|---|---|---|
| 5.1-1 没锁过（第一轮）→ 用规则算子的策略, 开始锁定 | ✅ | ①-1 |
| 5.1-2 规则算子选的策略变了 → 重新锁定 | ✅ | ①-2 |
| 5.1-3 还在锁定期内 → 忽略 LLM 建议 | ✅ | ①-3 |
| 5.1-4 锁定期过了 + LLM 有建议 → 接受建议, 重新锁定 | ✅ | ①-4 |
| 5.1-5 锁定期过了 + LLM 没建议 → 继续用当前策略 | ✅ | ①-5 |
| 5.2-6 targetStrategy 合法 → 校验通过 | ✅ | ②-6 |
| 5.2-7 targetStrategy 非法 → 校验失败, 丢掉 | ✅ | ②-7 |
| 5.2-8 reason 为空字符串 → 校验失败, 丢掉 | ✅ | ②-8 |
| 5.3-9 `ENGINE_DELIBERATION_INTENTION_LOCK_ROUNDS` 默认 3 | ✅ | ③-11 |
| 5.3-10 env 配非法值时回退默认 3, 不抛错 | ✅ | ③-12 |
| 5.4-11 开关关闭时, 不跑意图锁定逻辑 | ✅ | ④-14（**Redis 都不碰**） |
| 5.4-12 Redis key 带租户与会话长度前缀 | ✅ | ④-15 |
| 5.4-13 内核零改动 | ✅ | ④-16 + `boundary.spec.ts` 全绿 |

**额外 14 条防漂移**（②-9/②-10 · ③-13 · ⑤-17~⑤-22 · ⑥-23~⑥-27）：

- 缺省 `intentionShift` → null 且**不算**被丢掉的条目；
- 非法建议**不影响**整份输出的合法性；
- 锁定 0 轮 = 关掉锁定（合法值）；
- **端到端**：锁定期内的建议被拦住、到期放行；
- **端到端**：采纳后锁定期内**保持** LLM 建议的策略（不被规则策略顶掉）；
- **端到端**：规则算子换意图 → 重新锁定；
- **端到端**：没有建议时锁定期**不重置**；
- **端到端**：失败轮次**不动**锁状态；
- **端到端**：锁状态写坏 → 当"没锁过"；
- 策略枚举与内核 8 种**逐字一致**且不多不少；
- prompt 里有「当前行为策略」；
- schema 描述里有 `intentionShift` 写法 + 8 种策略；
- 编排门面**不做**锁定判定、**不 import** 任何锁定相关符号；
- 隐私红线：锁定相关日志只出定位信息，**不出**审议原文。

---

## 4. 留给后续的事（本单刻意没做）

1. **触发事件白名单（母版描述里的"提前解锁"）**：任务单 §2 D5 已明确 PoC 阶段**不做** —— "咨询师直接提问了这个意图相关的话题"是 NLP 级判断。**要单独一单。**
2. **切灰度（Phase3A）之前必补**：① WP65 的 **per-session mutex + 快照版本号**；② 审议输出要过**约束校验层**（delta cap + 临床合理性）才能落快照（蓝图 §2.3）；③ 意图锁定的"内核采纳"路径 —— 影子模式下内核永远不采纳 `effectiveStrategy`，切灰度后这条链要重写（现在的情况 2 判定在灰度后语义会变，见 §2.2）。
3. **锁定期的校准**：3 轮是**工程种子值，不是临床数字**。PoC 跑完按督导反馈校准（蓝图 §3.3 明说"意图锁定粒度 → 做成可配置参数，不同角色类型不同"）。
4. **锁状态与熔断状态同属一个会话的 Redis key 家族**，但目前**没有**统一的会话状态查询入口 —— PoC 统计只能直接扫 trace 表。要做督导端"这个会话现在的意图状态"查询，是独立一单。
5. **`llmIntentionShift` 的理由文本进 trace**（含心理内容）—— 与其它 trace 字段同性质：只落 Redis，**不进普通日志**（隐私红线 AGENTS.md §5.4）。

---

## 5. 运维须知（跑 PoC 前必读）

1. **开关默认关**：`ENGINE_DELIBERATION_ENABLED=false`。
2. **锁定轮数**：`ENGINE_DELIBERATION_INTENTION_LOCK_ROUNDS`（留空 = **3**；非法值回退 3，**不抛错**；填 **0** = 关掉锁定做对照实验）。
3. ⚠️ **锁定轮数是"轮"不是"次"** —— 审议**第一轮会被跳过**（没有上一轮快照可比），所以第一次建立锁定是在**第 2 轮**，锁定窗口是第 2~4 轮。
4. **锁状态 TTL = 24 小时**，每次更新刷新 —— 活跃会话永不过期，不活跃的自动清掉。
5. ⚠️ **PoC 统计口径**：
   - 「LLM 建议了切换」= `llmIntentionShift != null`；
   - 「被锁定拦住了」= `llmIntentionShift != null && !llmIntentionAccepted`；
   - 「真的切了」= `lockedStrategy != ruleStrategy`（影子模式下这是**推演值**，主流程实际用的仍是 `ruleStrategy`）。
6. **锁状态读失败按"没锁过"** —— Redis 抖动时锁定判定会退化（不是数据错，是少拦），观察面本身也在丢数据。
7. **每次成功审议多写一个 Redis key**（锁状态）—— 审议的 Redis 写入量比 WP67 之前**翻倍**（trace + 锁状态）。键都很小、TTL 有限，可接受。

---

## 6. commit message（**未自动提交**，等大炮手动提交）

```
feat(wp68): 意图锁定机制（基础版） —— 审议输出加可选 intentionShift，影子期旁路模拟锁定 N 轮
```

> 工作区当前**只有 WP68 的改动**（WP67 已由大炮提交为 `40c201c`），所以这是一条干净的独立提交。

---

_交付：2026-11-05 · engine-core 零改动 · 闸门 0 error / 1790 例全绿 · PoC 组（WP63–WP68）收官_
