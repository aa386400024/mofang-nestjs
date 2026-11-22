# WP64 交付记录 — LLM 审议层 PoC（影子模式）

> 状态: ✅ 已交付
> 任务单: [`wp64-llm-deliberation-poc-shadow-2026-11-05.md`](wp64-llm-deliberation-poc-shadow-2026-11-05.md)
> 日期: 2026-11-05
> 红线: ✅ **未改 engine-core** —— `git diff --stat HEAD -- src/engine-core` **为空**（任务单 §6.2 明确要求）
> 边界断言: ✅ `boundary.spec.ts` 全绿（11 条不变量 + 1 条扫描自检）
> 北极星: [`../../../architecture/hybrid-bdi-agent-blueprint-v1.0.md`](../../../architecture/hybrid-bdi-agent-blueprint-v1.0.md) §2.2 审议引擎层

---

## 1. 实际改了哪些文件

### 1.1 适配层：1 增 6 改（任务单 §5.2 列了 3 个 —— 实际多出 4 个，原因见 §2.1 / §2.6 / §2.7）

| 文件 | 改了什么 |
|---|---|
| `src/engine-adapters/deliberation/llm-deliberation.service.ts` | **新增**：`LlmDeliberationService`（影子模式审议服务）+ `DeliberationShadowInput` / `DeliberationShadowPort`（窄端口）/ `DeliberationTraceRecord` / `ValidatedDeliberation` + `buildDeliberationTraceKey` / `computeRuleDelta` / `computeDeliberationDeltaDiff` / `validateDeliberationOutput`（最简校验）+ 4 个 env 键的解析 |
| `src/counselor/providers/llm-json.client.ts` | **改**：`CounselorLlmJsonRequest` 加两个**可选**字段 `model`（per-request 模型覆盖）/ `temperature`（per-request 温度）；`resolveModel(override?)` 按"per-request > env > 默认"解析；温度**省略即不下发**（老调用方逐字不变） |
| `src/engine-adapters/rendering/turn-render-orchestrator.ts` | **改**：`TurnRenderOrchestratorDeps` 加 `deliberation?: DeliberationShadowPort`；`TurnSessionContext` 加 `userId?` / `characterBrief?`；新增 `lastSnapshots`（每句柄上一轮结束时的快照）；`turn()` 与 `turnStream()` 各加一处 **fire-and-forget** 旁路调用；`forgetSession()` 一并清快照 |
| `src/engine-adapters/wiring/engine-turn.service.ts` | **改**：`open()` 的 options 加 `userId?` / `characterBrief?`，登记进会话归属（条件展开，缺省 = 不带） |
| `src/engine-adapters/wiring/engine-stream-backend.adapter.ts` | **改**：`openKernelSession()` 把 `opts.userId` 与角色底色简述带进开场 options；新增模块级 `buildCharacterBrief(profile)`（依恋风格 + 大五人格 → 一行中文简述） |
| `src/engine-adapters/wiring/engine.providers.ts` | **改**：`EngineOrchestratorDeps` 加 `deliberation?: DeliberationShadowPort`；`createEngineOrchestrator` 透传给门面 |
| `src/engine-adapters/wiring/engine.module.ts` | **改**：`imports` 加 `AgentLlmModule`（只拿 `LlmService`）；`providers` 加 `CounselorLlmJsonClient` + `LlmDeliberationService`；`TurnRenderOrchestrator` 的 `useFactory` 注入审议端口 |

### 1.2 配置：2 改

| 文件 | 改了什么 |
|---|---|
| `.env.example` | 新增 4 个键 + 说明块（`ENGINE_DELIBERATION_ENABLED` / `MODEL` / `TIMEOUT_MS` / `TEMPERATURE`） |
| `typings/global.d.ts` | 新增 4 条 `ProcessEnv` 声明（逐个字面量读，env 覆盖断言扫得到） |

### 1.3 测试：1 增

| 文件 | 改了什么 |
|---|---|
| `test/engine-adapters/wp64-deliberation-shadow.spec.ts` | **新增 33 例**：开关（关 / 缺省关 / true·1·on）/ 正常路径（调 LLM + 写 trace + 请求体按 WP63 三零件组装 + 长度上限 + env 数值下发 + 非法值回退）/ 失败路径（llm_error / json_parse_failed / 超时 / client 抛异常 / Redis 写失败 / 日志不含原文）/ delta 差异计算（逐维 + 全量 11 维 + 快照差 + 标签去重）/ trace 结构与键设计（撞键防护 + TTL + 字段完整 + 不存对话原文）/ 硬安全维度（拒掉但留证据 + 顶层形状校验 + 越界条目）/ 旁路接线（首轮跳过 + 不 await + 缺端口 + 缺 userId + 端口抛异常 + 起始快照口径） |

### 1.4 文档

| 文件 | 改了什么 |
|---|---|
| `docs/worklog/pending/wp64-llm-deliberation-poc-shadow-2026-11-05.md` | 状态行改 `✅ 已交付` + 指向交付记录；追加「§10 交付后补记」偏差表 → 移入 `completed/phase2/` |
| `docs/worklog/pending/phase2-wp-list-2026-11-03.md` | WP64 行 ✅ + 落地口径 + 交付记录链接；统计进度 20/41 → 21/41 |
| `docs/worklog/pending/phase2-overview-2026-11-03.md` | PoC 组表格 P1-14 行标记 `WP64 ✅ 2026-11-05` + 一句话落地口径 |
| `docs/worklog/README.md` | Phase2 已开工列表 +WP64；进度回写 21/41；目录结构说明 +WP64 |

### 1.5 **零改动**（逐条核实过）

- `src/engine-core/**` —— **一行未动**（`git diff --stat HEAD -- src/engine-core` = 空）
- `src/engine-core/index.ts` 的公开面 —— **零新增导出**（`boundary.spec.ts` 断言⑥的白名单一个字没动）
- 既有单测 —— **一行未动**（`test/engine-adapters/` 下 34 个既有 spec 文件全未改）
- 无 migration / 无 entity / 无新表 / 无新列
- `admin-dashboard/` —— **零改动**（前端另一个 AI 的活，本单不碰）

---

## 2. 关键设计决策（与任务单有出入的地方 + 为什么）

> 任务单 §5.2 说"适配层改动（3 个文件）"。实际改了 9 个 —— 下面逐条说明**为什么必须多改**。
> 任务单与代码不符的地方按 `team/conventions.md` §2.5 处理：**先 grep 核实 → 找企业级最佳方案 → 在交付记录里写明偏差**。

### 2.1 决策 D1：旁路调用点接在**编排门面**，不是任务单说的 `src/counselor/`

任务单 §3.3 原文：

> **具体位置**：`src/counselor/` 下调 `engineSession.turn()` 的服务（自由练习引擎 / 全真执业对练）——grep 一下 `engineSession.turn(` 或 `engineSessionPort.turn(` 就能找到所有调用点

**grep 核实结果：任务单的这条描述不成立。**

| 位置 | 实际内容 |
|---|---|
| `src/engine-adapters/rendering/turn-render-orchestrator.ts:395` | `this.deps.session.turn(handleId, input)`（聚合路径）—— **全仓唯一的内核 turn 调用点** |
| `src/engine-adapters/rendering/turn-render-orchestrator.ts:457` | `this.deps.session.turn(handleId, input)`（流式路径） |
| `src/counselor/**` | **零**处调用内核会话端口 —— counselor 域用的是 `CounselorLlmJsonClient` 与 practice 引擎，与内核 turn 管道无关 |

**为什么必须接在编排门面**（不只是"任务单写错了"）：

1. **只有门面同时握有三样东西** —— 本轮咨询师的话（`input.userText`）、本轮来访的**渲染回应**（`rendered.text`）、本轮前后的 BDI 快照（`output.snapshot`）。审议 prompt 需要这三样才能问出"这一轮来访的内心状态该怎么变"；
2. 内核端口拿不到"来访的渲染回应" —— 那是**渲染产物**，内核只出决策、话是适配层说的（内核 `reply` 恒为 `''`）；
3. 门面是**唯一**在 `session.turn()` 之后还能拿到"本轮开始前状态"的地方（见 D3）。

**改动**：任务单 §5.2 的 3 个文件 → 实际 9 个（新增 4 个既有文件的改动，全部是为了把这条旁路接起来）。

### 2.2 决策 D2：规则算子的 delta 用**快照差**反推，**不是**内核的 cappedTotal

任务单 §3.1 的 `DeliberationShadowInput.ruleDelta` 写的是「规则算子算出的最终 delta（capped 后的，用来对比）」。

**问题**：适配层拿不到这个值。内核 `turn()` 里的 `cappedTotal` 是**内部局部变量**，`EngineTurnOutput` 的出口只有「本轮**结束后**的快照」：

```ts
// src/engine-core/in-memory/in-memory-engine-session.ts:386
const cappedTotal = capTurnDelta(totalDelta, this.capConfig);
```

内核零改动是本期红线，**不可能**加一个出口字段把 `cappedTotal` 透出来（cap 报告 `TurnDeltaCapReport` 也只带**被砍的**维度，且内核不外露）。

**方案**：适配层用 `computeRuleDelta(base, next)` = 本轮前后快照的逐维差。

| | 口径 |
|---|---|
| **优点** | 与"状态实际怎么动了"**完全一致** —— 这正是审议 delta 该对齐的基准（审议建议的是"这一轮来访的内心变化量"） |
| **代价** | 快照落盘时 clamp 到 `[0,1]` / 情绪区间 —— 贴着边界的那一轮，快照差会**小于** capped delta（差值 = 被 clamp 掉的部分） |
| **影响评估** | 绝大多数轮次不在边界（trust/safety/bond 从 0.5 起、每轮 ±0.0x），对 PoC 指标"差异均值 < 0.01"的影响可忽略 |

**落地**：`computeRuleDelta` 是**导出纯函数**（可单测），口径写在函数注释里，看数据的人一眼知道 `ruleDelta` 是"实际状态变化"而不是"内核内部量"。

### 2.3 决策 D3：起始快照由**适配层自己记**；代价是**每场会话的第一轮跳过**

审议 prompt 要的是"本轮**开始时**的状态"（§2.2）。内核不给，适配层就自己记一份：

- 门面新增 `lastSnapshots: Map<handleId, BdiSnapshot>`，每轮结束时存一次"本轮结束后的快照"；
- 下一轮开始时，它**就是**本轮的起始快照 —— 同一场会话内，内核 `loadState()` 的"本场已有状态"分支先命中（**不再衰减**），两者**逐字相等**。

**代价（明写出来，别藏）**：

| 场景 | 行为 | 原因 |
|---|---|---|
| 每场会话的**第一轮** | **跳过**影子审议 | 还没有"本轮开始前"的快照 |
| **跨会话接续**（resume）的第一轮 | **跳过** | 同上；而且内核那一步先做了自然衰减（WP36），适配层手上没有衰减后的状态，硬凑会算错 |
| 第 2 轮起 | 正常跑 | 快照口径逐字准确 |

**为什么不用"读 BDI 状态仓储"补第一轮**：那要多一次 Redis 往返 + 与内核的载入构成竞态（内核 `loadState` 也在读），而且仓储里存的是**未衰减**的快照，接续场景照样对不上。为了 5% 的数据量引入竞态不值得。

**落地**：跳过时**静默**（不是错误），首轮少一条 trace，PoC 数据量按"每场少一轮"折算即可。

### 2.4 决策 D4：`maxCompletionTokens` 从 **512 提到 2048**（任务单给的 512 会让影子模式白跑）

任务单 §3.1 写 `maxCompletionTokens: 512`（注释："审议输出大概 200-300 token，留足余量"）。

**问题**：MiniMax-M3.1-Flash 是**推理模型**，**thinking token 计入生成长度上限**（仓库硬约束 8）。"正文 200-300 token" ≠ "总预算 512" —— 思考先吃预算。仓库渲染侧的既有做法明写着这件事：

```
// src/engine-adapters/rendering/turn-render-orchestrator.ts (DEFAULT_TURN_TOKEN_BUDGET 注释)
// 160 的预算里思考先吃 94, 留给口语的只剩几十个 token
// 1500 的分法: 思考 ~700-1000, 输出 ~500-800
```

给 512 的后果是：思考吃掉一两百 token 后正文被截断 → JSON 半截 → 连续 `json_not_found` / `json_parse_failed` → **影子模式每一轮都失败，数据一条都收不到**，而失败原因还藏在 trace 里容易被误读成"模型不行"。

**方案**：给 `DELIBERATION_MAX_COMPLETION_TOKENS = 2048`（思考 + 正文都留足）。上限只是**上限**，LLM 不凑满预算、只对实际输出付费（仓库渲染侧同一口径）。

### 2.5 决策 D5：`ENGINE_DELIBERATION_MODEL` / `TEMPERATURE` 要**真的生效**，就得给 `CounselorLlmJsonClient` 加两个可选字段

任务单 §3.4 列了 4 个 env 键。grep 核实后，前两个在现有 client 上**无处可传**：

| env 键 | 现状 | 问题 |
|---|---|---|
| `ENGINE_DELIBERATION_MODEL` | client 的模型**只**从 env `MINIMAX_COUNSELOR_LLM_MODEL` 解析（`resolveModel()` 无参） | 配了审议模型也不生效 → **骗人的配置项**（env 覆盖断言会放行，但运维改了没用，排查成本极高） |
| `ENGINE_DELIBERATION_TEMPERATURE` | client **根本不传** temperature（`LlmService` 用自己的默认 0.7） | 同上 |

**三条路**：

1. ❌ 不加 env 键 —— 违反任务单 §6.1「四个 env 键都进了 `.env.example` 和 `typings/global.d.ts`」；
2. ❌ 读出来不用 —— 那就是"骗人的配置项"，比没有更糟；
3. ✅ **给 client 加两个可选字段**（本单采用）。

**为什么这样安全**：

- 两个字段都是**可选**，省略即走既有路径 → 既有 6 个调用方（督导 / 知情同意 / 练习评估 / 人设生成 / 抽取 / 轻提示）**行为逐字不变**；
- `model` 覆盖的底层能力本来就有（`LlmService.streamChat` 支持 `opts.model` per-call 覆盖，见 `llm.types.ts:50` 的注释），client 只是没暴露；
- 温度**省略即不下发**（不传 = 上游用 0.7），不是传 0.3；
- ⚠️ M3.1-Flash **忽略** temperature / top_p（硬约束 8）→ 这个键只对**换掉的模型**生效，`.env.example` 里写明了。

### 2.6 决策 D6：`deltaDiff` 用**全量 11 维**，不是任务单示例里的"只列模型提到的 3 维"

任务单 §3.2 的 JSON 示例里 `deltaDiff` 只有 3 个键（trust / safety / valence）—— 那是**只写模型提到的那几维**。

**问题**：PoC 的验收指标是「软状态维度差异**均值** < 0.01」。均值的**分母**必须是确定的维度集。只算模型提到的维度，分母就变成"模型想说几维" —— 模型说得越少，均值反而越高（分母变小），统计口径被模型牵着走。

**方案**：

| 字段 | 形态 | 理由 |
|---|---|---|
| `deliberationDelta` | **稀疏**（只含模型明确提到的维度） | 与任务单示例一致；"模型没提到"本身就是信息 |
| `deltaDiff` | **全量 11 维**（模型没提到的按 0 算） | 统计口径固定，跨轮 / 跨会话可加 |

顺带把"规则动了、审议没提"这一维显式暴露出来（`deltaDiff[dim] = 0 - ruleDelta[dim]`）—— 那正是"规则算子覆盖了、LLM 没看见"的证据。

### 2.7 决策 D7：`trace` 记录加三个字段（`tenantId` / `entries` / `rejectedEntries`）

| 字段 | 为什么加 |
|---|---|
| `tenantId` | key 里有租户，**值里也存一份** —— 与 WP32 的 `RedisBdiStateRepository` 同一纪律（归属对不上 = 撞键或数据被改写，要能一眼看出来） |
| `entries` | 逐条 delta 明细（维度 + 幅度 + 标签 + 理由）。扁平 `reason` 是多条用 `；` 拼的**摘要**；人工复核"差异 Top10 场景"要的是**逐维对应**的关系 |
| `rejectedEntries` | 被校验层丢掉的**原始**条目。**最关键的一条**：模型偶尔会硬塞硬安全维度（prompt 明令不许，但模型未必听话）—— 那些条目必须**留证据**，否则 PoC 的"高安全维度零误触发"这条验收**无从查证**（静默丢掉 = 把"模型试图越界"藏起来） |

扁平字段（`reason` / `confidence` / `summary` / `operatorTags`）**全部按任务单 §3.2 的语义保留**，新字段是**追加**，不是替换。

### 2.8 决策 D8：审议模式固定 `freeform`，`exam` 留给 MCQ 频道接进引擎管道之后

任务单 §3.1 的 `mode` 决定用哪套 prompt 模板。grep 核实：`DeliberationMode` 在**全仓**只有 `deliberation-types.ts` / `deliberation-prompt.ts` 用到，**没有任何业务代码**给它赋值 —— 引擎 turn 管道 today 只服务**语音对练**（自由练习 / 全真执业），两者都是**零压域**（AGENTS.md §5.3：分数只允许出现在 MCQ 备考频道）；MCQ 备考频道走 `training-exercises` 链路，**不经过** `session.turn()`。

**为什么此刻不能猜**：用考核措辞去审自由练习的对话，会把"判定标准更严"的偏置带进对比数据，PoC 的差异统计立刻失真。将来 MCQ 频道接进引擎管道时，改成"按会话归属分发"即可（两套模板 WP63 已备好）。

**落地**：门面用**具名常量** `DELIBERATION_SHADOW_MODE = 'freeform'`，并把"为什么现在只能是 freeform"写在常量注释里 —— 下一个人要改时能看到理由。

### 2.9 决策 D9：引擎装配层**不 import `CounselorModule`**

`CounselorLlmJsonClient` 在 `counselor` 域，但引擎装配层要拿到它。两条路：

| | 后果 |
|---|---|
| ❌ `imports: [CounselorModule]` | 把 counselor 域的 **24 个 TypeORM entity + 一堆控制器**整包拖进引擎装配层 → 引擎装配层从此认识 ORM，**违反 WP8-A §8-9 的"零 ORM / 零 SDK 包名"护栏**（`test/engine-adapters/wp8-wiring.spec.ts` 按包名判定） |
| ✅ `imports: [AgentLlmModule]`（agent 侧 LlmModule）+ 自己注册一份 `CounselorLlmJsonClient` | client 是**无状态**的（依赖只有 `LlmService` + `ConfigService`），注册一份不会产生第二份真相；agent 侧 LlmModule 只提供传输层，**不带任何业务实体** |

**顺带解决一个命名坑**：仓库有**两个** `LlmModule`（`src/llm/llm.module.js` 路由层 / `src/agent/llm/llm.module.js` 传输层），本单用别名 `AgentLlmModule` 区分，注释里写明"审议走 counselor 域的唯一结构化出口，所以要的是传输层那个"。

### 2.10 决策 D10：`ENGINE_DELIBERATION_ENABLED` 缺省 = **关**（与任务单一致），但 `.env.example` 里写**显式** `false`

任务单 §3.4 明确"默认 `false`"。代码按缺省关实现（不配 = 一次 LLM 都不发 = 零成本零行为变化）。

`.env.example` 里写显式 `false`（而不是留空）—— 与 `ENGINE_DEBUG_TRACE_ENABLED=false` 同款：这是一个**开关**，运维要能一眼看见并直接改。留空会让"这个开关在哪"变成一次搜索。

### 2.11 决策 D11：配置数值**自己解析**，不用 `config.get<number>()`

任务单 §3.1 写 `configService.get<number>('ENGINE_DELIBERATION_TIMEOUT_MS') ?? 3000`。两个问题：

1. **ConfigService 不做类型转换** —— 拿到的是**字符串** `'3000'`（仓库 WP9-B 已踩过：字符串一路传到 `AbortSignal.timeout()` 会抛 `The "delay" argument must be of type number`）；
2. `?? 3000` 对**空串**永远不触发（空串不是 nullish）—— 而 `.env.example` 的键是留空的。

**方案**：逐个键**自己解析 + 非法值回退默认**（超时 3000 / 温度 0.3），非法值**不抛错**（旋钮填错不该让服务起不来）。四个键都是**逐个字面量**读 —— env 覆盖断言（AST 抽取）扫得到，漏写一个键会立刻变红。

### 2.12 决策 D12：影子审议的失败**只记 trace，不改任何状态**

审议失败（LLM 报错 / JSON 不合法 / 超时 / Redis 写不进去）时：写一条 `ok=false + errorCode` 的 trace，**不动 BDI 快照、不影响回复、不影响渲染**。Redis 写失败也只打日志 —— 观察面写不进去**不是**会话失败（与仓库既有降级口径一致：记忆写失败 / 逐字稿写失败都不阻断会话）。

**日志纪律**：审议日志**只出 id / 计数 / 错误码**，**绝不打印 reason / summary / 对话原文**（心理内容禁止进普通日志 —— 隐私红线 AGENTS.md §5.4）。trace 里**不存** `counselorText` / `visitorText`（只存模型产出的判断）。两条都有单测守着。

---

## 3. 验收对照（任务单 §6）

### 3.1 功能验收（§6.1）

| 条目 | 结果 | 证据 |
|---|---|---|
| `LlmDeliberationService` 实现了 `runShadowMode` | ✅ | `src/engine-adapters/deliberation/llm-deliberation.service.ts` |
| env `ENGINE_DELIBERATION_ENABLED=false` 时直接 return，不调 LLM | ✅ | 用例 ①（3 例） |
| env 开启时正常调 LLM，结果写 Redis trace 表 | ✅ | 用例 ②（6 例） |
| trace 数据结构完整（耗时 / token / ruleDelta / deliberationDelta / deltaDiff / operatorTags / reason / confidence） | ✅ | 用例 ⑤「trace 字段完整」 |
| 失败时（LLM 报错 / JSON 解析失败 / 超时）也写 trace（ok=false + errorCode） | ✅ | 用例 ③（5 例） |
| 所有异常都 catch 住，不抛到主流程 | ✅ | 用例 ③「client 抛异常」「Redis 写失败」+ 用例 ⑦「端口抛异常」 |
| 四个 env 键都进了 `.env.example` 和 `typings/global.d.ts` | ✅ | env 覆盖断言（`wp25-env-example-coverage.spec.ts` ①/② 双向） |

### 3.2 闸门验收（§6.2）

| 闸门 | 结果 |
|---|---|
| `npx eslint "src/**/*.ts" "test/**/*.ts"` | **0 error**（exit 0） |
| `npx tsc -p tsconfig.build.json --noEmit` | **0 error**（exit 0） |
| `npx vitest run --exclude '**/e2e/**/*.ts'` | **102 文件 / 1697 例全绿**（WP63 基线 101 文件 / 1664 例 → 本轮 **+1 文件 / +33 例**，既有 1664 例**零回归**） |
| `git diff --stat HEAD -- src/engine-core` | **空** |

> ℹ️ 闸门命令用仓库 `package.json` 的 `test` 脚本口径（**排除 e2e**）：e2e 需要真 DB / 真 Redis，本机没有；`npx vitest run` 不带 `--exclude` 会把 e2e 一起拉进来，报的是 DI 装配失败（与本单无关）。
> ℹ️ 另：`test/counselor/wp21-report-stream.spec.ts` 在**含 e2e 的重载跑**下曾超时一次（`status: timeout`）—— 那是它自己的轮询超时用例在高压下的抖动（单独跑 15/15 全绿），与本单改动无关（本单不碰 counselor 报告流）。

### 3.3 测试用例要求（§6.3）

| 要求 | 覆盖用例 |
|---|---|
| ① env 开关关闭时，runShadowMode 直接 return，不调 LLM | 用例 ①（3 例） |
| ② env 开关开启时，正常调 LLM，trace 数据写入 Redis | 用例 ②（6 例） |
| ③ LLM 返回格式不合法时，trace 表记 ok=false + errorCode | 用例 ⑥「顶层形状不对 → 整份判不合法」+ 用例 ③ |
| ④ LLM 超时时，trace 表记 ok=false + errorCode | 用例 ③「超时（上游报超时错）」 |
| ⑤ delta 差异计算正确（逐维度对比 ruleDelta 和 deliberationDelta） | 用例 ④（4 例） |
| ⑥ 所有异常都被 catch，不抛到调用方 | 用例 ③（3 例）+ 用例 ⑦（2 例） |

---

## 4. 留给后续 WP 的接口（本单刻意没做）

| # | 事项 | 归属 |
|---|---|---|
| 1 | 格式校验重试（不合法 → 重试一次） | WP66 |
| 2 | 三级降级（超时跳过 / 连续失败切回规则 / 降级标记） | WP67 |
| 3 | per-session 串行队列（同一 sessionId 的审议排队） | WP65 |
| 4 | 约束校验层（审议 delta 过 delta cap / 临床合理性） | 本单 §8 第 4 条 |
| 5 | 审议结果接进状态（影子 → 灰度） | Phase3A |
| 6 | DB 兜底持久化（trace 现在只落 Redis） | 后续 |
| 7 | Admin Dashboard trace 查看页 | 前端 |
| 8 | `exam` 模式接线（MCQ 频道进引擎管道后按归属分发） | Phase3A |
| 9 | 每场会话**第一轮**的影子审议（需要内核暴露起始快照或状态仓储读侧） | 随内核接口演进 |

---

## 5. 运维须知（跑 PoC 前必读）

1. **默认关** —— 不配 `ENGINE_DELIBERATION_ENABLED=true` 就**一次 LLM 都不发**，零成本零行为变化；
2. **每轮多烧一次 LLM** —— 影子模式是**每轮**旁路发一次请求，跑 100 场对话前先算一下账单；
3. **不 await** —— 主流程响应时间不受审议影响；但审议请求本身占着上游并发；
4. **trace 落在 Redis** —— key `deliberation_trace:{租户长度}:{租户}:{会话长度}:{会话}:{轮次}`，TTL 30 天；扫 key：`redis-cli --scan --pattern '*:deliberation_trace:*'`；
5. **每场第一轮没有 trace** —— 起始快照还没被记下来（见 §2.3），统计时按"每场少一轮"折算；
6. **trace 里的 `visitorText` 概念不存在** —— 记录里存的是模型产出的判断，**不存对话原文**；
7. **失败也是数据** —— `ok=false + errorCode` 的记录同样是 PoC 的输入（"审议成功率 > 95%"这条指标就是数它们）。

---

_创建：2026-11-05_
_深度核实：`CounselorLlmJsonClient.requestJson()` / `InMemoryEngineSession.turn()` / `TurnRenderOrchestrator.turn()` / `TurnRenderOrchestrator.turnStream()` / `RedisService.set()` / `EngineTurnService.open()` / `EngineStreamBackend.openSession()` —— 全部 grep 核实_
