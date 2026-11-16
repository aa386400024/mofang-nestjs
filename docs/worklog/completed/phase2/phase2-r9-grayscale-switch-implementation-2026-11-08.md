# R9 灰度切换开关 · 交付记录

> **路径**：`docs/worklog/completed/phase2/phase2-r9-grayscale-switch-implementation-2026-11-08.md`
> **任务单**：`docs/worklog/completed/phase2/phase2-r9-grayscale-switch-closeout-2026-11-08.md`（已从 `pending/` 移入）
> **状态**：✅ 已交付
> **日期**：2026-11-08
> **性质**：**引擎能力** 单 —— 审议从「旁路观察」升级为「可配置生效」，含 **engine-core 例外改动**（用户明确批准）
> **蓝图依据**：`docs/architecture/hybrid-bdi-agent-blueprint-v1.0.md` §6 Phase 3A「两种模式可配置切换，不硬切」+ §7 红线 4（考核必须可复现）

---

## 一、结论速览

| # | 交付物 | 结果 |
|---|---|---|
| **1** | 内核审议钩子端口 | ✅ 新增 `src/engine-core/runtime/deliberation-hook.port.ts`（**纯类型**，103 行）：同步 / 稀疏补丁 / 失败回退三条契约写死 |
| **2** | 内核 `turn()` 第 5.5 步 | ✅ 规则 delta 与剧本 delta 合并并过 cap **之后**、落到快照 **之前**，多一道「问审议」的口子；**不注入 = 整段跳过 = 决策链逐字不变** |
| **3** | 三态生效模式 + 会话灰度名单 | ✅ `ENGINE_DELIBERATION_EFFECTIVE_MODE`（shadow / rule_only / llm_active）+ `ENGINE_DELIBERATION_GRAYSCALE_SESSIONS`；缺省组合 = **纯规则** |
| **4** | 真实生效路径 | ✅ 复用 `LlmDeliberationService`（同一份 prompt / 校验 / cap / 临床规则 / trace），**不走 BullMQ**；两拍分离，建议**滞后一轮** |
| **5** | 四层兜底 | ✅ LLM 失败 / 格式非法 / **过期（版本号比对）** / 临床可疑维度 → 一律回退规则 delta，**主流程绝不炸** |
| **6** | 测试 3 份 | ✅ 内核 10 例 + 适配层钩子 14 例 + 模式配置 13 例 = **37 例全绿**；另**收紧** WP65–68 的 4 条边界断言（不弱化 / 不 skip / 不删用例） |
| **7** | 闸门 | ✅ tsc **0 error** · 全量 **145 文件 / 2375 例 / 2356 passed / 19 skipped / 0 failed**（93.26s，skip **不增**）· eslint **0 error / 0 warning** · boundary **12 用例全绿** · engine-core diff **2 文件 +78/-1 + 1 新文件**（例外批准） |

> ⚠️ **一句话口径**：本单让「审议真的生效」这件事**可配置、可灰度、可回退**了；但**缺省仍然是纯规则** —— 生效路径要显式开两个 env 键才会被装配。

---

## 二、改动清单

### 2.1 新增（7 个）

| # | 文件 | 作用 |
|---|---|---|
| 1 | `src/engine-core/runtime/deliberation-hook.port.ts` | **内核**审议钩子端口（纯类型：`DeliberationHookContext` / `DeliberationDeltaPatch` / `DeliberationHookPort`） |
| 2 | `src/engine-adapters/deliberation/deliberation-mode.config.ts` | 三态模式解析 + 会话白名单解析 + 超时解析 + 总开关折叠 + 会话级判定 |
| 3 | `src/engine-adapters/deliberation/llm-deliberation-hook.ts` | 生效钩子实现（两拍分离 + 四层兜底 + 建议缓存 + 过期判定） |
| 4 | `src/engine-adapters/deliberation/llm-deliberation-effective.ts` | 产出拍执行器（把上下文翻译成审议入参 → 稀疏补丁） |
| 5 | `test/engine-core/r9-deliberation-hook.spec.ts` | 内核 10 例：零回归 / 生效 / 稀疏语义 / 抛错回退 / null 回退 / cap 不可绕 / 上下文 / 滞后一轮 |
| 6 | `test/engine-adapters/r9-deliberation-hook.spec.ts` | 适配层 14 例：两拍分离 / 过期 / TTL / 模式三态 / 四层兜底 / 稀疏转换 / 临床剔除 |
| 7 | `test/engine-adapters/r9-deliberation-mode-config.spec.ts` | 适配层 13 例：三态解析 / 非法回退 / 白名单 / 总开关折叠 / 会话判定矩阵 / 场景路由 / 超时 |

### 2.2 修改（12 个）

| # | 文件 | 改了什么 |
|---|---|---|
| 1 | `src/engine-core/in-memory/in-memory-engine-session.ts` | **+78/-1**：`InMemoryEngineSessionOptions` 加可选 `deliberationHook`；`turn()` 第 5.5 步调钩子；新增私有 `applyDeliberationHook()`（合并后**再过一次 cap**，异常吞掉回退规则 delta） |
| 2 | `src/engine-core/index.ts` | **+1**：barrel 再导出 3 个端口类型（公开面是契约 → `boundary.spec.ts` 断言⑥白名单同步加） |
| 3 | `src/engine-adapters/deliberation/llm-deliberation.service.ts` | 新增 `runEffectiveDeliberation()`（生效路径入口，复用私有 `runDeliberation` + cap + 临床规则 + trace + 意图锁）+ `DeliberationEffectiveInput/Outcome` + 纯函数 `dropClinicalFlaggedDimensions()` |
| 4 | `src/engine-adapters/rendering/turn-render-orchestrator.ts` | `shadowDeliberation()` → `deliberationRound()`：影子旁路与生效拍**共用同一个调用点**（同一份起始快照 / 同一份规则 delta / 同一份归属） |
| 5 | `src/engine-adapters/wiring/engine.tokens.ts` | 新增 2 个 token：`ENGINE_DELIBERATION_MODE_CONFIG` / `ENGINE_DELIBERATION_HOOK` |
| 6 | `src/engine-adapters/wiring/engine.providers.ts` | `EngineSessionTuningDeps` 加 `deliberationHook`；`EngineOrchestratorDeps` 加 `deliberationHook`；两处**可选透传**（缺省 = 装配缺席 = 逐字不变） |
| 7 | `src/engine-adapters/wiring/engine.module.ts` | 2 个新 provider（模式配置 + 钩子单例）；内核会话端口**只在 `llm_active` 模式**挂钩子；影子端口**只在 `shadow` 模式**挂；启动期打一行模式日志 |
| 8 | `.env.example` | 新增 2 个生效行 + 文档块（含「总开关优先」「按会话不按用户」两条口径） |
| 9 | `typings/global.d.ts` | `ProcessEnv` 显式声明 2 个新键 |
| 10 | `test/engine-core/boundary.spec.ts` | 断言⑦文件清单加 `runtime/deliberation-hook.port.ts`；断言⑥导出白名单加 3 个类型名 |
| 11–14 | `test/engine-adapters/wp65-deliberation-queue.spec.ts` / `wp66-deliberation-retry.spec.ts` / `wp67-deliberation-circuit-breaker.spec.ts` / `wp68-deliberation-intention-lock.spec.ts` | 各自的「内核树里零审议代码」断言**收紧**（见 §5 偏差 #9） |

---

## 三、关键设计决策

### 3.1 两拍分离（同步端口 + 滞后一轮）—— 本单最核心的决策

**问题**：审议要调 LLM（秒级网络往返）。任务单原文写的是「审议是**同步**的（await）—— 状态是原子更新的，渲染基于最终状态」。但语音对练是**实时对话产品**，每轮 await 一个 LLM 往返 = 每轮多等 1–8 秒 —— 实时对话节奏直接崩。

**做法**：

| 拍 | 谁跑 | 什么时候 | 结果去哪 |
|---|---|---|---|
| 产出拍 | 适配层（门面 → 执行器 → 审议服务） | 本轮**渲染完成后**（fire-and-forget，**不 await**） | 进程内缓存（按 sessionId 存最近一条） |
| 消费拍 | 内核（同步问钩子） | **下一轮**落库前 | 稀疏补丁合并进规则 delta |

**代价（诚实标注）**：建议**滞后一轮** —— 第 N 轮算出来的建议在第 N+1 轮生效。
**为什么这笔交易划算**：① 实时性是产品底线；② 与「每轮都审议」的成本方向不冲突（产出拍仍是每轮一次，不加频次）；③ 内核决策链保持**同步**（内核永不 await 外部调用 → 纯层性质不变）。

**代价的可控性**：滞后意味着建议可能过时 → 用**版本号比对**判定过期（见 §3.4），过时直接丢弃回退规则 delta。

### 3.2 稀疏补丁（不是完整 delta）

审议模型通常只对 2–3 个维度有话说。若内核把返回值当**完整 delta** 整体替换，未提及的维度会被**清零** —— 规则算子那轮算出的情绪 / 阻抗 / 移情变化凭空消失。

所以端口的返回类型是 `DeliberationDeltaPatch = Readonly<Partial<DeltaVector>>`，内核的合并语义是「**在规则 delta 之上逐维覆盖**」。

> 这条不是靠注释保证的，是靠**测试**保证的：`test/engine-core/r9-deliberation-hook.spec.ts` ③ 用**整份快照深比较**（把被覆盖的那一维换回基线值 → 两份快照必须逐字相等）。整体替换的实现会立刻变红。

### 3.3 再过一次 cap（审议不得绕过同一把尺子）

合并完的 delta 必须再过一次 `capTurnDelta(merged, this.capConfig)` —— **构造注入的同一份** `capConfig`，与规则侧口径恒等。审议结果没有"特权通道"。

### 3.4 过期判定用**版本号**（不是猜）

- 内核在消费拍里报出 `context.currentRevision` = 本轮**开始时载入的状态记录版本**（R1 = 上一轮**落库后**的版本）；
- 产出拍记下"这份建议是基于第几版算的"（`baseRevision`）；
- **不相等 = 两拍之间状态被动过**（会话恢复 / 别的进程改了状态）→ 建议作废，回退规则 delta。

> ⚠️ 口径锚点与既有影子模式的 `checkStale` **同锚 R1**（不是 R0）—— 锚 R0 会让判定**永远**为「过期」。
> ⚠️ 版本号在 `BdiStateRecord` 上，**不在** `BdiSnapshot` 上（内核刻意不让快照带版本）—— 取值时踩过这个坑，已在端口注释里写死。

### 3.5 会话白名单（不是用户名单）

| 理由 | 说明 |
|---|---|
| 装配期拿不到用户 | `ENGINE_SESSION_PORT` 是**单例**（`engine.module.ts` useFactory 造一个 `InMemoryEngineSession`）→ 装配期根本不知道"当前用户是谁" |
| 内核每轮拿得到 sessionId | 内核 runtime 里有 sessionId；userId（学员账号 id）在 voice 层，内核只有 visitorId（来访者角色 id） |
| 同一场会话内模式必须恒定 | 若中途改名单，同一场会话前半场规则、后半场 LLM → **状态轨迹不可复现**（实训平台命根子） |
| 仓库既有范式 | `ENGINE_STREAM_GRAYSCALE_SESSIONS` 就是会话白名单 |

名单外会话判为 **rule_only**（而不是 shadow）：名单外会话此刻是纯规则状态，**不该跑审议烧 LLM**。

### 3.6 缺省 = 纯规则（零回归是**构造性**的，不是"结果一样"）

缺省组合（`ENGINE_DELIBERATION_ENABLED` 未配 + `ENGINE_DELIBERATION_EFFECTIVE_MODE` 未配）→
`ENABLED 关` → 模式折叠成 `rule_only` → **内核根本不挂钩子** → 内核第 5.5 步整段跳过。

即「不是结果一样，是**根本没走那条路**」。另有一层：即使挂了子，钩子在 shadow / rule_only 模式下也会在**产出拍之前**就返回（runner 调用次数 = 0，断言在测试里钉死）。

### 3.7 生效模式关掉影子旁路（省成本 + 防 trace 互撞）

生效模式下**不挂**影子端口，两个理由：
① 同一轮跑两次 LLM = 双份成本；
② 两条路径写**同一个 trace key**（tenant + session + turn）→ 互相覆盖，灰度期的对比数据会丢一半。

生效路径**自己写同一份 trace**（`buildSuccessRecord` 逐字复用，字段形状相同：`deltaDiff` / `capEntries` / `clinicalFlags` / `stale`），看板不受影响。

### 3.8 临床合理性在生效期从「观察」升级为「安全网」

- 影子期：`applyClinicalSanityCheck` 只**标记**，不拦不砍（要的是数据）；
- 生效期：**强制开启**（**不受** `ENGINE_CLINICAL_SANITY_ENABLED` 控制 —— 那个开关是观察面的，省开销用的；**观察面可以关，安全网不能关**），且被标记为 `warn` 的**维度**被剔除（不是整份建议剔）—— 一条建议里只可疑的那一维不落状态，其余维度照常生效。

### 3.9 考核场景恒为 rule_only（可复现性红线）

`ScenarioRouteConfig.exam` 的类型是**字面量** `'rule_only'`（不是三态）→ 编译期就写死，不靠配置自觉。依据：蓝图 §7 红线 4「考核场景必须能锁版本、锁温度、逐字复现」，而 LLM 输出不可复现。

> ⚠️ **本单只定义这张表，不接路由逻辑** —— 场景类型机制（`VoiceSessionMode` 只有 text/voice）还没建，现在接路由就是猜（任务单 §2.2 自己也这么说）。Phase 4 填表即可（`resolveDeliberationModeConfig` 是唯一接入口）。

---

## 四、闸门实测

> 全部为**本单实测**（2026-11-08），命令与数字一一对应，可复跑。

| 闸门 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc -p tsconfig.build.json --noEmit` | ✅ **0 error**（exit 0） |
| 全量测试（任务单口径） | `npx vitest run` | ✅ **145 文件 / 2375 例 / 2356 passed / 19 skipped / 0 failed**，90.56s（交付前**连跑 2 次全绿**：90.56s + 93.26s） |
| 全量测试（仓库 `pnpm test` 口径） | `npx vitest run --exclude "**/e2e/**/*.ts"` | ✅ **139 文件 / 2338 例 / 2334 passed / 4 skipped / 0 failed**，78.99s |
| 边界断言 | `npx vitest run test/engine-core/boundary.spec.ts` | ✅ **12 用例全绿**，1.96s |
| Lint（任务单口径） | `npx eslint src/engine-core/ src/engine-adapters/deliberation/ --max-warnings 0` | ✅ **0 error / 0 warning**（exit 0） |
| Lint（本单全部 15 个改动文件） | `npx eslint <15 个文件> --max-warnings 0` | ✅ **0 error / 0 warning**（exit 0） |
| 内核红线 | `git diff --stat HEAD -- src/engine-core` | ⚠️ **2 files changed, 78 insertions(+), 1 deletion(-)** + 新增未跟踪文件 `runtime/deliberation-hook.port.ts`（103 行）—— **用户明确批准的例外** |

### 4.1 与基线对比（skip 不增，红不增）

| 口径 | 基线（Phase2 封版记录，2026-11-08） | 本单 | 差值 |
|---|---|---|---|
| 文件数 | 142 | 145 | **+3**（本单 3 份新测试） |
| 用例数 | 2338 | 2375 | **+37**（10 + 14 + 13） |
| skipped | 19 | 19 | **不增** ✅ |
| failed | 0 | 0 | **不增** ✅ |

### 4.2 engine-core 改动清单（例外批准的边界）

| 文件 | 性质 |
|---|---|
| `src/engine-core/runtime/deliberation-hook.port.ts`（新） | **纯类型端口**：零 `@nestjs` / 零网络 / 零 prompt / 零 `process.env` / 零 `globalThis`；只有 2 个 interface + 1 个 type alias |
| `src/engine-core/in-memory/in-memory-engine-session.ts`（+78/-1） | 只加：① 可选构造参数 `deliberationHook`；② `turn()` 第 5.5 步的一次调用；③ 私有合并方法。**规则算子 / cap / 状态迁移 / 落库逻辑一行未改** |
| `src/engine-core/index.ts`（+1） | 只加 3 个 type 的再导出 |

> ✅ `boundary.spec.ts` 的 **12 条断言全绿**（AST 级扫描：零 `@nestjs` / 零 typeorm / 零逃出目录的相对 import / 外部依赖白名单 / 零装饰器 / 零 `process.env` / 零 `globalThis` / barrel 白名单双向 / 文件清单双向）。

---

## 五、偏差说明

| # | 任务单怎么写的 | 本单实际做的 | 理由 |
|---|---|---|---|
| 1 | 端口 **async**：`applyDeliberation(): Promise<DeltaVector>`，内核 `await` 它 | 端口**同步**（`applyDeliberation(): DeliberationDeltaPatch \| null`），审议**两拍分离**（适配层异步产出 → 缓存 → 内核下一轮同步读） | 语音对练每轮 await 一个 LLM 往返 = 每轮多等 1–8 秒，实时对话节奏崩。内核永不 await 外部调用 → 纯层性质不变。**代价：建议滞后一轮**（已写进端口契约与测试） |
| 2 | 端口返回**完整** `DeltaVector` | 返回**稀疏补丁** `Readonly<Partial<DeltaVector>>`，内核「逐维覆盖」 | 整体替换会把规则算子算出的其余维度**清零**（数值仍合法，只是悄悄变 0）—— 最不容易被发现的一类实现错误 |
| 3 | 按**用户**灰度：`ENGINE_DELIBERATION_GRAYSCALE_USER_IDS` | 按**会话**灰度：`ENGINE_DELIBERATION_GRAYSCALE_SESSIONS` | ① 内核会话端口是单例 → 装配期拿不到当前用户；② 同一场会话内模式必须恒定（否则状态轨迹不可复现）；③ 仓库既有范式即会话白名单（`ENGINE_STREAM_GRAYSCALE_SESSIONS`） |
| 4 | 两个实现：`NoopDeliberationHook` + `LlmDeliberationHook` | **只有** `LlmDeliberationHook`；缺省 = **不注入端口** | 「不注入」比「注入一个返回原值的 Noop」更彻底：内核**根本没有审议这一步**（而不是"走了但返回原值"）。内核零回归由构造保证，不靠运行时分支 |
| 5 | 端口 context 含 `visitorText?` 与 `sessionKind` | **不进内核端口**；改放适配层的产出拍入参 `DeliberationProduceExtras` | ① `visitorText` 是**渲染产物**，内核 `turn()` 跑在渲染**之前** → 内核拿不到；② `sessionKind` / 场景类型机制**还没建**（任务单 §2.2 自己说的）→ 现在传就是猜。内核契约保持"内核拿得到的就这些" |
| 6 | 场景路由表三态可配（freeform / full_simulation / exam） | **恒为全 `rule_only`**，且 `exam` 的类型是字面量 | 场景类型机制还没建 → 现在配任何路由都是猜；考核恒 `rule_only` 是蓝图 §7 红线 4（可复现性），**写死在类型里**不靠配置自觉。Phase 4 填表即可 |
| 7 | 文件名 `noop-deliberation.hook.ts` / `llm-deliberation.hook.ts`（点号） | `llm-deliberation-hook.ts`（连字符） | 仓库既有范式是连字符（`llm-deliberation.service.ts` / `llm-deliberation.processor.ts`）→ 跟既有命名对齐 |
| 8 | 没提总开关 `ENGINE_DELIBERATION_ENABLED` 与新模式的关系 | 装配时把**总开关折叠进模式**（总开关关 → 模式一律降级 `rule_only`） | 两个能互相打架的开关 = 最贵的一类运维坑（"以为在灰度其实没生效" / "以为关了其实还在烧钱"）。少一个歧义源；缺省组合 = 纯规则 = 零回归 |
| 9 | §5.3 红线闸门：「缺省配置下，**所有现有测试逐字通过**」 | WP65–68 的 4 条「内核树里零审议代码」断言**收紧**为精确断言（白名单三处 + 端口零实现 + 端口零外部引用） | 任务单 §3.2 要求**内核加钩子端口** → 内核树必然出现 "deliberat" 字样 → §5.3 与 §3.2 冲突。取舍：**核心交付（内核端口）优先**，同时把粗粒度断言**收紧**而不是删掉：不弱化、不 `it.skip`、不删用例，且**追加了三条更严的断言**（端口文件零 `class`/`function`/`const`、端口不 import 适配层/框架、白名单恰好三处）。另：`boundary.spec.ts` 的 12 条断言才是内核纯度的**主护栏**，本来就是 AST 级精确扫描 |
| 10 | 生效路径直接复用影子模式的结果 | 生效路径**不走 BullMQ 队列**，进程内直跑；**trace 记录逐字同款**（同一份 `buildSuccessRecord`） | 队列的延迟与重试语义对不上「下一轮就要用」；直跑才能让建议在下一轮生效。trace 同款 → 灰度期看板字段不变 |
| 11 | 临床合理性校验：沿用影子期的「只标记不拦截」 | 生效期**强制开启**且**剔除被标记为 `warn` 的维度** | 观察面可以关，安全网不能关；落进状态的改动撤不回来（状态轨迹不可回滚）→ 保守方向是不落。只剔**那一维**不剔整份建议（否则一条可疑建议把整轮审议废掉，灰度白灰） |
| 12 | §4.3：交付记录放 `completed/phase3/`，README 加「Phase3 开工状态行」 | 交付记录放 `completed/phase2/`（沿用 `phase2-` 前缀）；README 改加**R9 交付行**（母版 §2.3 登记独立单 #10） | R9 是 **Phase2 的收尾任务**（任务单自己的定位说明：「做完本任务，Phase2 才正式封版」）；Phase3 尚未开工 → 写「Phase3 开工」会把状态写错 |
| 13 | 建议「超时降级」用新增的 `ENGINE_DELIBERATION_TIMEOUT_MS` | **复用既有键**（该键早已存在，`llm-deliberation.service.ts` 的 `resolveTimeoutMs()` 在用，缺省 3000） | 不重复定义同一个 env 键（两个真相源 = 迟早漂移）；模式配置里也读同一个键，口径一致 |

---

## 六、功能闸门逐条对照

| 闸门（任务单 §5.2） | 结果 | 证据 |
|---|---|---|
| 缺省行为零回归 | ✅ | 缺省组合 → `rule_only` → **内核不挂钩子** → 第 5.5 步整段跳过 |
| Noop 注入零回归（不传钩子 = 逐字一致） | ✅ | 内核测试 ①：不注入 vs 装「永远给 null」的钩子 → **落库快照深比较完全相同** |
| 审议失败兜底（异常 / 超时 / 格式非法 → 回退规则 delta，主流程不炸） | ✅ | 内核测试 ④⑤（端口抛错 / 返回 null）；适配层测试⑤（runner 抛错 / 返回 null / 空补丁） |
| 灰度名单生效 | ✅（**按会话**，偏差 #3） | 适配层测试④：名单内生效、**名单外 runner 调用次数 = 0**（不烧 LLM） |
| 超时降级生效 | ✅ | 复用 `ENGINE_DELIBERATION_TIMEOUT_MS`（缺省 3000），超时由审议服务既有链路处理 → 结局 `failed` → 无建议 → 回退规则 delta |
| 引擎红线（零 NestJS / 零网络 / 零 prompt） | ✅ | `boundary.spec.ts` 12 条 AST 级断言全绿 |

---

## 七、母版回写（本单动了哪几处）

| 文件 | 改了什么 |
|---|---|
| `docs/worklog/pending/phase2-overview-2026-11-03.md` | §2.3 独立单清单新增 **#10 R9 灰度切换开关**（登记表纪律：每个独立单必须登记一行） |
| `docs/worklog/README.md` | §0 Phase2 交付清单新增 R9 一行（口径 + 闸门 + 交付记录链接） |
| `docs/worklog/audits/phase2-code-vs-blueprint-audit-2026-11-08.md` | §6 表格下方新增一行**状态补注**（R9 已交付 + 指向本记录）—— **不改动审计结论本身**（那是只读审计快照） |
| `docs/worklog/pending/phase2-r9-grayscale-switch-closeout-2026-11-08.md` → `completed/phase2/` | 任务单移入 completed/，顶部状态行改 ✅ 并指向本交付记录 |

> ⚠️ **如实登记**：`completed/phase2/phase2-freeze-2026-11-08.md`（封版记录）§八 仍写着「6 项 Phase3 阻塞未解（含 R9）」—— 那是**封版当天的快照**，本单不改写历史；R9 的当前状态以**母版 §2.3 第 10 行** + 本交付记录为准。

---

## 八、未提交清单 + 建议 commit message

> ⚠️ **本单不 commit / 不打 tag / 不 push**。以下清单给项目主理人照单提交。

**代码与测试改动（21 个文件）**：

| # | 状态 | 文件 |
|---|---|---|
| 1 | M | `.env.example` |
| 2 | M | `src/engine-adapters/deliberation/llm-deliberation.service.ts` |
| 3 | M | `src/engine-adapters/rendering/turn-render-orchestrator.ts` |
| 4 | M | `src/engine-adapters/wiring/engine.module.ts` |
| 5 | M | `src/engine-adapters/wiring/engine.providers.ts` |
| 6 | M | `src/engine-adapters/wiring/engine.tokens.ts` |
| 7 | M | `src/engine-core/in-memory/in-memory-engine-session.ts` |
| 8 | M | `src/engine-core/index.ts` |
| 9 | M | `typings/global.d.ts` |
| 10 | M | `test/engine-core/boundary.spec.ts` |
| 11 | M | `test/engine-adapters/wp65-deliberation-queue.spec.ts` |
| 12 | M | `test/engine-adapters/wp66-deliberation-retry.spec.ts` |
| 13 | M | `test/engine-adapters/wp67-deliberation-circuit-breaker.spec.ts` |
| 14 | M | `test/engine-adapters/wp68-deliberation-intention-lock.spec.ts` |
| 15 | ?? | `src/engine-core/runtime/deliberation-hook.port.ts` |
| 16 | ?? | `src/engine-adapters/deliberation/deliberation-mode.config.ts` |
| 17 | ?? | `src/engine-adapters/deliberation/llm-deliberation-hook.ts` |
| 18 | ?? | `src/engine-adapters/deliberation/llm-deliberation-effective.ts` |
| 19 | ?? | `test/engine-core/r9-deliberation-hook.spec.ts` |
| 20 | ?? | `test/engine-adapters/r9-deliberation-hook.spec.ts` |
| 21 | ?? | `test/engine-adapters/r9-deliberation-mode-config.spec.ts` |

**本单文档（5 个）**：

| # | 状态 | 文件 |
|---|---|---|
| 22 | ?? | `docs/worklog/completed/phase2/phase2-r9-grayscale-switch-closeout-2026-11-08.md`（任务单，已移入） |
| 23 | ?? | `docs/worklog/completed/phase2/phase2-r9-grayscale-switch-implementation-2026-11-08.md`（本交付记录） |
| 24 | M | `docs/worklog/pending/phase2-overview-2026-11-03.md`（母版 §2.3 登记独立单 #10） |
| 25 | M | `docs/worklog/README.md`（§0 加 R9 行） |
| 26 | M | `docs/worklog/audits/phase2-code-vs-blueprint-audit-2026-11-08.md`（§6 加状态补注） |

**合计 26 个文件**（代码与测试 21 + 文档 5）—— 与 `git status --short` 实测一致。

**建议 commit message**（两笔，边界更清楚）：

```text
feat(engine): R9 灰度切换开关 —— 内核加纯类型审议钩子端口, 审议从旁路观察升级为可配置生效 (shadow/rule_only/llm_active 三态 + 会话白名单, 缺省仍纯规则零回归)

test(engine): R9 三份测试 + 收紧 WP65-68 的内核零审议断言为白名单精确断言 (端口零实现/零外部引用), 不弱化不 skip 不删用例
```

---

## 九、本单**没做**的（留给 Phase3 / Phase4，如实登记）

| 项 | 为什么不做 | 什么时候做 |
|---|---|---|
| 按**场景类型**路由（自由练习 / 全真执业 / 考核） | 场景类型机制还没建（`VoiceSessionMode` 只有 text/voice）→ 现在接路由就是猜。表结构已留好，Phase 4 直接填 | Phase 4 |
| 考核场景锁死纯规则的**运行时**判定 | 同上（现在只是**类型层**写死 + 表恒 `rule_only`） | Phase 4 |
| 按比例灰度（10% / 50% / 100%） | 内测期名单灰度够用 | 后续按需 |
| BullMQ 队列化生效路径 | 生效路径要的是「下一轮就能用」，队列延迟语义对不上 | 暂不做 |
| R4 可复现控制 / R6 心理数据合规 / R7 考核公平性 / R8 上下文与成本 / R12 抽检流 | 审计报告里的**另外 5 项** Phase3 阻塞，与本单无关 | 各自独立单 |
| 建议的**频率闸门**（每轮都审议的成本问题 = R8） | 属 R8 的范围；本单不改变「每轮一拍」的现状 | R8 |
| 真实场次灰度数据 | 需要真人在内测环境跑场次 + 盯 token 账单 | Phase2.5 出口条件 |

> ⚠️ **本单没有产生任何真实场次数据** —— 生效路径的**质量**（审议建议到底准不准）**尚未被真实对话验证**，只过了机制层闸门。

---

## 十、收尾自查（交付前最后一轮）

| # | 自查项 | 结果 |
|---|---|---|
| 1 | 缺省配置下行为与改造前逐字一致 | ✅ 内核测试 ①（快照深比较） |
| 2 | engine-core 红线（零 NestJS / 零网络 / 零 prompt / 零 env） | ✅ boundary 12 条 AST 断言全绿 |
| 3 | 审议失败 / 超时 / 格式非法 / 过期 / 临床标记 → 回退规则 delta | ✅ 四层兜底各有测试 |
| 4 | 主流程绝不因审议而炸 | ✅ 内核 ④（端口抛错 → 整轮正常落库） |
| 5 | 建议**不得绕过 delta cap** | ✅ 内核 ⑥（999 → 被同一把尺子砍回） |
| 6 | 日志**不含**心理内容 / 对话原文 / prompt 全文 | ✅ 日志只出 sessionId / 轮次 / 维度名 / 状态 |
| 7 | 未自动 commit / 未打 tag / 未 push | ✅ 只给 commit message 草稿 |
| 8 | 未跑前端命令（flutter / dart / pub / build_runner） | ✅ |
| 9 | 未碰 `admin-dashboard/` 与 Flutter 客户端 | ✅ |
| 10 | 测试侧只改断言（不弱化 / 不 skip / 不删用例） | ✅ WP65–68 的断言是**收紧**，未删任何用例 |
| 11 | 数字可复跑 | ✅ 每条数字都对应一条命令（见 §四） |
