# WP24 · 单场成本日志（closeSession 结构化输出）· 交付记录

> **日期**：2026-10-30
> **仓库**：`E:\Work\Project\backend\mofang-nestjs`
> **任务单**：[engine-wp24-session-cost-log-backend-2026-10-30.md](engine-wp24-session-cost-log-backend-2026-10-30.md)
> **性质**：低成本护栏，内测期防烧 LLM 额度

---

## 0. 一句话

`EngineStreamBackend.closeSession()` 收尾时打一条 `session_cost_summary` 结构化日志，含本场总 token 与预估费用；定价走 env 可配；**成本口径（`costBasis`）随输入侧用量是否可得如实切换，不拿 0 冒充不可得**。

**闸门**：`tsc -p tsconfig.build.json --noEmit` **0 错** / eslint **0 error 0 warning** / jest **1 新套件 18 例全绿** + engine-adapters+engine-core+voice **29 套件 601 例全绿** / 全量 **58 套件 925 例中 923 例通过**（1 套件 2 例失败 = `test/counselor/drill-judge.spec.ts` **既有债**，与本单无关 —— 失败内容是 counselor 侧否定守卫判定与评判式回应的措辞，与引擎侧无交集）/ `git diff --stat -- src/engine-core` = **1 个文件**（见 §3）。

---

## 1. 任务单有一个前提错误，本单必须先解决它

任务单 §2.2 要求打 `totalPromptTokens` 与 `model`，§2.3 的成本公式是：

```
estimatedCostCny = (totalPromptTokens / 1000) * 0.0015 + (totalCompletionTokens / 1000) * 0.0045
```

**这两个字段在动手前没有任何数据源**，不是"忘了实现"，是链路上根本没有：

| 字段 | 任务单说从哪取 | 代码实际 |
|---|---|---|
| `totalPromptTokens` | 「累加本场所有轮次的 `usage.promptTokens`」 | 内核 `RenderResult.usage` **只有** `completionTokens` + `totalTokens`（`src/engine-core/domain/rendering/render-types.ts`）；上游 `ChatCompletionResponse.usage.promptTokens` **有**，但被适配层显式丢弃 |
| `model` | 「从 RenderPort 的 usage 里取」 | `usage` 里**没有**模型名。真模型名在 `params.model`（`llm-render.adapter.ts` 的 `callOnce`），**不透出**；`providerHint` 只是候选 id（AIProviderId，如 `minimax`），不是模型名 |

更关键的是**上游流式路径根本没有 prompt/completion 拆分**：

- `ChatCompletionChunk`（`src/llm/common/interfaces/chat-provider.interface.ts`）只有 `delta` / `tokenCount`（累计） / `isFinal` / `finishReason` / `model` / `reasoningTokens` —— **没有 promptTokens / completionTokens**
- `llm-render.adapter.ts` 的流式收尾因此只能把累计 `tokenCount` 同时当作 `completionTokens` 与 `totalTokens`（注释原话：「同源取末条, 不编造」）
- 而 **voice 端到端走的是流式**（`turn-render-orchestrator.ts` 的 `turnStream`），聚合路径（`render()`）只有 WP8-A 调试端点在用

**结论**：在**不改 `src/llm` provider 内部**（WP6 明写的红线）的前提下，生产主路径的输入侧用量**不可得**。

---

## 2. 本单怎么解决的

### 2.1 用户拍板的方向

两处需要决策的地方都问过用户并得到明确选择：

| 决策点 | 选择 |
|---|---|
| 字段拿不到怎么办 | **内核加可选 `promptTokens?` / `model?`，适配层透传**（不碰 `src/llm`，不破 WP6 红线） |
| 成本口径怎么算 | **只算输出侧 + 显式标注 `costBasis: "output_only"`**（不假装算全了） |

### 2.2 落法

**① 内核契约扩两个可选字段**（`src/engine-core/domain/rendering/render-types.ts`）

- `RenderResult.usage.promptTokens?` —— **跨厂商通用口径**（prompt / completion / total 是所有 OpenAI 兼容厂商都有的公共 token 计数），缺省即"上游没报"
- `RenderResult.model?` —— 与既有的 `providerHint` **同性质**（"这次实际用了谁"的观测透传，内核不据此决策）

**② 适配层透传**（`llm-render.adapter.ts` / `streaming-render.port.ts` / `turn-render-orchestrator.ts`）

- 聚合路径：上游 `usage.promptTokens` 此前被丢弃，现在如实带出；`model` 取 `params.model`
- 流式路径：`model` 取 `params.model`（**有**）；`promptTokens` **缺省**（上游没有拆分，不编造）
- 顺带修正：`done` chunk 的 `promptTokens` 此前是**硬编码 0**，现在接上真实值（流式路径仍为 0，因为上游没给）

**③ 新增纯函数成本模块**（`src/engine-adapters/observability/session-cost.ts`，**新目录**）

纯函数 + 纯数据，零 @nestjs / 零 typeorm / 零 IO / **不 import Logger**：

- `accumulateSessionUsage(totals, delta)` —— 累加一轮用量
- `estimateSessionCost(totals, pricing)` —— 折算费用 + **口径**
- `buildSessionCostSummary({ sessionId, totals, pricing, enginePath })` —— 构造成本汇总
- `resolveSessionCostPricing(raw)` —— 从 env 原始值解析单价（非法值回退，不抛）
- `DEFAULT_SESSION_COST_PRICING` —— 默认单价（元 / 千 token）

**为什么单独成文件**（而不是塞进 adapter）：成本口径是**要被人引用、要能单测断言**的东西；且"成本口径"与"成本日志"是两件事 —— 前者是算，后者是打。

**④ 引擎后端累加 + 收尾打点**（`engine-stream-backend.adapter.ts`）

- 新增 `private readonly sessionUsage = new Map<string, SessionUsageTotals>()`（语音会话 id → 本场累计）
- `openSession` **重置**（重连不能把上一场的花费算进这一场）
- `buildStream` 收尾处累加本轮用量（累加的是渲染结果里**真实带回来**的用量 —— 成本必须等于"真的花了多少"，不是"我们以为花了多少"）
- `closeSession` 打 `session_cost_summary` 一行 JSON

**⑤ 定价走 env**（`.env.example` + `engine.module.ts`）

- `LLM_PRICE_INPUT_PER_1K` / `LLM_PRICE_OUTPUT_PER_1K`（元 / 千 token）
- 装配层读 env → `resolveSessionCostPricing` → 注入后端；非法值回退默认，**不抛**（填错 env 不该让服务起不来）

---

## 3. 与既有护栏的交互（**本单改了 WP6 的一条锁，必须显式登记**）

### 3.1 改了 WP6 的「渲染结果字段集合固定」零回归锁

`test/engine-adapters/wp6-llm-render.spec.ts` 的用例 ⑪ 断言渲染结果的字段集合固定：

```
顶层: ['fallbackUsed','providerHint','taskKind','text','usage']        → 改为含 'model'
usage: ['completionTokens','totalTokens']                              → 改为含 'promptTokens'
```

**为什么这次该改**：护栏的**意图**是"上游 response 的私有字段不许漏进内核结果"，新增的两个字段都没破坏这个意图：

- `promptTokens` 是**跨厂商通用**的 token 计数，与"哪个厂商"无关（缺省即"上游没报"，不编造）
- `model` 与**既有**的 `providerHint` 同性质 —— 都是"这次实际用了谁"的观测透传，内核不据此做任何决策（选谁仍是适配层的运行时策略）

真正被这条锁拦住的"厂商私有"是上游 response 里的额外字段（各家自定义的细节 / 安全 verdict 私有字段）—— **那些仍然一个都没进来**。

> ⚠️ 顺带更正本单前一处判断：内核文件头「反双胞胎」原话是「**规格里**不含模型名」与「RenderResult 只暴露 usage / fallbackUsed / providerHint」，后者在本单前已经与代码不符（`providerHint` 早就在里面）。本次已同步更新内核注释，不留新的文档-代码不一致。

### 3.2 放宽了 WP10 的源码切片窗口

`test/engine-adapters/wp10-trajectory-injection.spec.ts` 用**固定 900 字符**窗口切 `engine.module.ts` 源码找 `TRAJECTORY_SCRIPT_RESOLVER`（该 token 在 `inject` 数组里）。本单给 `EngineStreamBackend` 的 `useFactory` 加了成本单价装配（多几行），把断言目标挤出了窗口 —— **窗口 900 → 1600**，**断言的内容一个字没改**。

### 3.3 破了内核「零改动」惯例（**唯一一处内核改动**）

`git diff --stat -- src/engine-core` = **1 个文件**（`render-types.ts`，+38/-1）。

- 母版 §0 原则「内核保持零 `@nestjs/`、零网络、零 prompt」**仍然守住** —— 加的是两个**纯数据可选字段**，无框架依赖、无网络、无 prompt
- `test/engine-core/boundary.spec.ts` 的 9 条 AST 级断言**全部照常通过**（它们锁的是零框架依赖 / 目录结构 / 导出面，**不锁** `RenderResult` 的字段形状）
- 但与 WP6–WP12 连续多个 WP 的「engine-core 零改动」**惯例**不同 —— 这是**用户明确拍板**的方向（内核加可选字段），不是顺手扩的

### 3.4 改了 `EngineStreamBackend` 的构造参数位次

新增第 7 位 `costPricing`（`@Optional()`）。因为第 6 位 `traceRecorder` 至今无装配入口（恒 `undefined`），工厂那边必须给第 6 位**显式占一个 `undefined`** —— 这与 WP12 之前「traceRecorder 不占位」的做法相反，原因是位置参数不能跳着传。已在工厂与 adapter 的注释里写明。

---

## 4. 成本口径（`costBasis`）—— 这条是本单最要紧的设计

| 口径 | 何时 | 含义 |
|---|---|---|
| `full` | 输入侧用量**可得**（聚合路径 / 上游报了 promptTokens） | 输入 + 输出两侧都计了，是全场成本 |
| `output_only` | 输入侧**不可得**（流式路径的常态） | **只含输出侧** —— 是全场成本的**下界** |

**为什么不拿 0 冒充输入侧**：输入侧不可得与"输入侧确实没花钱"是两件完全不同的事。这条日志的用途恰恰是"防烧额度"，一个**系统性偏低**的成本数字等于没有数字。所以口径必须**写在数据里**（`costBasis` 字段），而不是只靠"看文档的人记得"。

**为什么不倒推输入侧**（`totalTokens - completionTokens`）：

1. 流式路径上游给的是**累计** `tokenCount`，`total` 与 `completion` 本就是同一个数，倒推恒等于 0 —— 那不是"输入侧为零"，是"输入侧不可得"
2. 聚合路径下 `total` 还含思考 token，倒推会把思考量算进输入侧

仓库既有纪律是"不编造"（`llm-render.adapter.ts` 流式路径同样只映射拿得到的字段），这里守住同一条。

---

## 5. 改动面清单

### 5.1 新增（2）

| 文件 | 作用 |
|---|---|
| `src/engine-adapters/observability/session-cost.ts` | 成本口径纯函数模块（累加 / 折算 / 构造汇总 / env 解析），零 IO 零 Logger |
| `test/engine-adapters/wp24-session-cost-log.spec.ts` | WP24 新增套件（**18 例**） |

### 5.2 修改（10）

| 文件 | 改了什么 |
|---|---|
| `src/engine-core/domain/rendering/render-types.ts` | `RenderResult.usage` 加 `promptTokens?`；`RenderResult` 加 `model?`；同步更新文件头反双胞胎注释 |
| `src/engine-adapters/rendering/llm-render.adapter.ts` | 聚合路径透传 `promptTokens` + `model`；流式路径带 `model`（`promptTokens` 不编造）；`streamViaAggregate` 同步透传 |
| `src/engine-adapters/rendering/streaming-render.port.ts` | `StreamRenderOutcome.usage` 加 `promptTokens?`；加 `model?` |
| `src/engine-adapters/rendering/turn-render-orchestrator.ts` | `TurnRenderResult.render` / `NormalizedRender` 加两个可选字段 + 聚合/流式两处组装透传 |
| `src/engine-adapters/wiring/engine-stream-backend.adapter.ts` | per-session 累加器；`openSession` 重置；`buildStream` 收尾累加；`closeSession` 打 `session_cost_summary`；构造加第 7 位 `costPricing`；`done` chunk 的 `promptTokens` 由硬编码 0 改为接真实值 |
| `src/engine-adapters/wiring/engine.providers.ts` | `EngineStreamBackendDeps` 加 `pricing?`；工厂传参（第 6 位显式占位 `undefined`） |
| `src/engine-adapters/wiring/engine.module.ts` | 装配时读 env → `resolveSessionCostPricing` → 注入 |
| `.env.example` | `LLM_PRICE_INPUT_PER_1K` / `LLM_PRICE_OUTPUT_PER_1K`（含口径说明） |
| `test/engine-adapters/wp6-llm-render.spec.ts` | 护栏字段集合锁更新（§3.1）+ 用例 ① 的 usage 断言 |
| `test/engine-adapters/wp10-trajectory-injection.spec.ts` | 源码切片窗口 900 → 1600（§3.2） |

### 5.3 文档（4）

`docs/progress/engine-wp24-session-cost-log-backend-2026-10-30.md`（任务单：状态改「已交付」+ 追加交付摘要） / `docs/progress/engine-wp24-session-cost-log-backend-2026-10-30-implementation-2026-10-30.md`（本记录） / `docs/README.md`（索引行，任务单与交付记录**成对出现**） / `docs/progress/phase1-integration-backlog-2026-10-28.md`（§0.3 登记表补 WP24 行）。

---

## 6. 闸门复跑

```text
npx tsc -p tsconfig.build.json --noEmit                    → 0 错
npm run lint                                                → exit 0 (0 error 0 warning)
npx jest test/engine-adapters/wp24-session-cost-log.spec.ts → 18/18 通过
npx jest test/engine-adapters test/engine-core test/voice  → 29 套件 / 601 例全绿
npm test (全量)                                             → 58 套件 / 925 例: 923 通过
                                                            1 套件 2 例失败 (drill-judge.spec.ts 既有债)
git diff --stat -- src/engine-core                          → 1 file changed (render-types.ts, +38/-1)
```

> ⚠️ `git diff --stat HEAD -- src/engine-core` 这条命令**只看工作区**，commit 掉之后恒为空 —— 复核内核改动面请用 `git show --stat <commit> -- src/engine-core`。

**既有债确认**：`drill-judge.spec.ts` 的 2 例失败内容是 counselor 侧"否定守卫判定"与"评判式回应措辞"，与引擎成本日志无交集；与 WP11 / WP12 交付记录里记的是同一笔债。

---

## 7. 已知边界

1. **生产主路径（voice WS / 流式）的 `totalPromptTokens` 恒为 0，`costBasis` 恒为 `output_only`** —— 根因是上游流式只给累计 `tokenCount`。要拿到真值必须改 `src/llm` provider 层（读上游流式 usage），而那破 WP6 明写的「不改 `src/llm` provider 内部」红线，且依赖上游端点是否回传 usage —— **本单没做，也不该在这一单做**。
2. **聚合路径（WP8-A 调试端点）能报 `costBasis: "full"`** —— 上游聚合响应有完整拆分。
3. **默认单价是工程默认值**，不是与厂商合同核对过的报价；真正计费以厂商账单为准。上生产前应对一遍当期报价。
4. **`model` 在降级轮次缺省**（降级时没有"实际用的模型"这回事），日志里是 `null`。
5. **`enginePath` 是日志里的常量 `'bdi'`** —— 本单只在**新引擎路径**打这条日志。WP17 已降级并入 WP13，`enginePath` 作为**留痕字段**是 WP13 的活；本单不新增字段到 trace / 报告。
6. **不做**：成本看板（admin-dashboard 的成本看板是 mock，等 WP20 切真接口）、告警（日预算超限归 WP22）、按用户汇总（Phase2）、改 WP19 的留痕链（那是另一个坑）。

---

## 8. commit 文案

```text
feat(engine): WP24 单场成本日志 (closeSession 打 session_cost_summary, 本场总 token + 预估费用, 定价走 env 可配, 成本口径随输入侧可得性如实切换 output_only/full)
```
