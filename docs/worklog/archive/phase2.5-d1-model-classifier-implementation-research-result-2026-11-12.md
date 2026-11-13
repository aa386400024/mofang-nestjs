# D-1 第二段预研 · 模型轨事件分类器实现路径（只读调查 · 零代码改动）

> 状态：**【预研结论】**（2026-11-12）。执行方：MiniMax Code。本单**零代码改动**：未改 `src/**`、未改 `test/**`、未改 `boundary.spec.ts`、未接 env、未跑批次、未调真 LLM。
> 仓库：`E:/Work/Project/backend/mofang-nestjs`，分支 `integrate`，基线 HEAD `7b80615`
> 事实源：第一段预研结论 `docs/worklog/pending/phase2.5-d1-model-event-classifier-research-result-2026-11-12.md`（R1–R8 / 风险 A–K / 5 项待拍板）；第一段交付记录 `docs/worklog/completed/phase2.5/phase2.5-d1-event-classifier-evidence-implementation-2026-11-12.md`；台账 `docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md` §7.1（60 条标注对照）+ I-01 / I-02 / I-18；结构债草案 `docs/worklog/pending/phase2.5-engine-core-structural-debt-assessment-2026-11-12.md` §4.2 / §6 / §9.3
> 口径声明：只出**码、计数、布尔、机制描述**；不复制任何心理对话原文；不写两类事件的 delta 方向 / 数值 / 权重斜率 / 缺席轮数阈值（全部留 D-2 + 标定批次）。本单**不重做**第一段取证统计。

---

## 1. 总结论

**有条件可行**，但**第一段的落地结论需要一处重要修正**：第一段 R5 ④ 写「模型轨落地不需要碰 core（`EventClassifier` 是 core 已导出的端口，注入缝已存在，装配层补一行 + adapter 新增一个实现文件 = 零 core 改动、断言⑥⑦ 不变绿）」。

**这条结论只对「影子观测」成立，对「模型轨真正驱动 delta」（D-2 的前提）不成立**。理由两条：

1. 模型轨要影响第 N 轮的 delta，其分类结果必须**在第 N 轮状态落库之前**产生。内核的唯一落库入口是 `InMemoryEngineSession.turn()`，分类发生在该函数内（`src/engine-core/in-memory/in-memory-engine-session.ts:400-402`）→ **必须**有一条「内核等一次异步分类」的通路。
2. 仓库**已经**对同族问题做过一次明确裁决，方向与「内核 await LLM」相反 —— `src/engine-core/runtime/deliberation-hook.port.ts` 文件头：

```text
//   ⚠️ **同步端口, 不是 async** (这是本文件最重要的设计决策):
//     审议要调 LLM (网络往返, 秒级). 若端口是 async, 内核 `turn()` 就必须 await
//     一个外部调用 —— 语音对练每轮多等一个 LLM 往返, 实时对话直接崩.
//     所以: **审议在适配层异步跑, 结果缓存起来; 内核这边同步地问一句"有没有现成的
//     建议"**. 内核只读缓存, 不等网络. 代价是建议**滞后一轮**.
```

> **审议与事件分类的差别是决定性的**：审议是「对已算出的 delta 做修正」，**滞后一轮可接受**；事件分类是「delta 的输入」，滞后一轮等于把第 N 轮的贡献记到第 N+1 轮 —— **语义错位，不可接受**。所以审议那条「异步跑 + 同步读缓存」的路**不能照搬**。

**因此本单的可行条件是 4 条**：

| #   | 条件                                                                                                                                           | 依据        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| C1  | 接受「模型轨生效时每轮关键路径多一次 LLM 往返」，**并用灰度把生效范围限定在非实时路径**（批次 / 自动对练）                                     | §3 S1 / S6  |
| C2  | 走路径 E（`EventClassifier` 加**可选**异步成员），内核改动**须主控例外批准**（2 个 core 文件）                                                 | §3 S1 / S9  |
| C3  | **审计服务必须改为只吃内核事件**（停止自行 `new RuleBasedClassifier()` 重分类），否则模型轨上线后审计 `rawDelta` 与内核实际 delta 对不上且多计 | §3 S4（F3） |
| C4  | 两类新 kind 的 core 联合扩展**必须留 D-2**，且 D-2 的改动面是 **4 个文件**（不是第一段估的 1 个）                                              | §3 S3（F2） |

### 1.1 本单新增的 5 条发现（第一段未覆盖，均有代码证据）

| #      | 发现                                                                                                                                                                                                                                                                    | 影响                                                                                                                              |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **F1** | **同步/异步冲突的真实成本是「延迟」不是「类型」** —— 内核 `turn()` 本身是 `async`（`in-memory-engine-session.ts:377`），加可选异步成员在类型上零阻力；真正的代价是每轮关键路径多一次 LLM 往返，而 **voice 流式、debug 面板、自动对练三条路径全部走同一个 `turnStream`** | 路径 E 的判定要从「接口形状」改写为「延迟预算 + 灰度范围」                                                                        |
| **F2** | **扩 `CounselorEventKind` 联合是 TypeScript 编译级破坏，不只是 boundary 断言问题** —— `state-transition.ts:197` 与 `admin-debug/event-tag-labels.ts:35` 都是**穷尽 `Record<CounselorEventKind, ...>`**，联合加 2 个成员 → 这两处**立即编译报错**                        | 第一段 R6 只判了断言⑥⑦「绿」，漏判 TS 编译面；D-2 改动面从 1 个 core 文件放大到 4 个（2 core + 2 业务层）                         |
| **F3** | **审计服务是三处分类点里唯一的「真漂移源」** —— 它用**自己的** `new RuleBasedClassifier()` 重分类，再与内核事件取**并集**（`turn-delta-audit.service.ts:74-79` `:87` `:162-164`），该并集的前提是「本地规则轨与内核**逐字同源**」（注释明写）                           | 模型轨上线后并集 = 两套标签的并集 → 审计 `rawDelta` 与内核实际 delta **对不上且多计**。三处收敛从「风格问题」升级为「正确性问题」 |
| **F4** | **门面收敛性比第一段预估更好** —— core `session.turn` 全仓**只有 2 个**调用点，都在 `turn-render-orchestrator.ts:603`（聚合）与 `:678`（流式）；门面 `EngineTurnService.turn/turnStream` 是**唯一**内核入口（HTTP / voice WS / debug 面板 / 自动对练全部经它）          | L1 的「上下文写入点」与「清理点」**各只有一个**，不必逐路径配对                                                                   |
| **F5** | **「上一轮来访话语」在分类调用点可得** —— 编排器自己持有 per-handle 历史，含来访半边（`settleTurn` `:1244-1249`），且在 `session.turn` 调用时历史已含第 1..N-1 轮                                                                                                       | L1 拿到来访上下文**不必**扩 core 输入类型；只有「连续缺席计数」才需额外状态                                                       |

### 1.2 与第一段结论的关系

- **成立并沿用**：规则轨三点不可达（R1）、逐轮样本已在盘（R2）、`neutral` 误吞上界 89.39%、模型轨实现必须落 adapter（R5 ①）、断言⑥⑦判定口径（R6）、`strength` 参与 delta 缩放故第一版恒 1（R7 / 风险 G）、结构化输出只有一条链（R5 ②）。
- **需修正**：R5 ① 的「零 core 改动」只覆盖影子态，生效态必须动 core；R6 的「扩联合 → 断言绿」需补一句 **TS 编译面会红**（F2）。
- **需深化**：风险 B 从「标签漂移」升级为「审计 delta 失真」（F3）；风险 A 从「类型冲突」升级为「延迟预算」（F1）；上下文供给细化为「来访话语**已有**可得点，缺席计数才需新状态」（F5）。

---

## 2. 改动面清单

> 归属层：**core 纯层** / **adapter** / **业务层** / **测试层**。D-1 第二段 = 模型轨实现单；D-2 = 事件拆分单；D-3 = 时序权重单（不涉及）。

| #   | 文件                                                                                                   | 改动内容                                                                                                       | 归属层        | 依据         | 归属单                                          |
| --- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------- | ------------ | ----------------------------------------------- |
| 1   | `src/engine-core/domain/events/session-event.ts`                                                       | `EventClassifier` 加**可选**异步成员 `classifyAsync?`（路径 E）；`ClassifyContext` 扩可选 `sessionId?`（L1-a） | **core 纯层** | S1 / S2      | **D-1 第二段**（需例外批准）                    |
| 2   | `src/engine-core/in-memory/in-memory-engine-session.ts`                                                | 分类调用点（`:400-402`）改为「有 `classifyAsync` 则 await，否则走同步 `classify`」；`:401` 多传 `sessionId`    | **core 纯层** | S1 / S2      | **D-1 第二段**（需例外批准）                    |
| 3   | `src/engine-core/domain/engine-session.types.ts`                                                       | `EngineTurnInput` 扩可选字段（承载 L2 上下文，**仅 L2**）                                                      | **core 纯层** | S2 L2        | **D-1 第二段**（需例外批准）                    |
| 4   | `src/engine-adapters/cognition/model-event-classifier.ts`（**新文件**）                                | 模型轨实现：`requestJson` + 手写校验 + 失败回落规则轨；按 `sessionId` 分桶持有跨轮上下文（L1）                 | adapter       | S1 / S5 / S7 | **D-1 第二段**                                  |
| 5   | `src/engine-adapters/cognition/model-classifier-mode.config.ts`（**新文件**）                          | 灰度模式配置（三态 + 会话白名单 + 超时），照 `deliberation-mode.config.ts` 范式                                | adapter       | S6           | **D-1 第二段**                                  |
| 6   | `src/engine-adapters/wiring/engine.providers.ts`（`:244-250`）                                         | `createEngineSessionPort` 增**可选** `classifier` 依赖并透传（缺省不传 = 现状逐字不变）                        | adapter       | S1 / S9      | **D-1 第二段**                                  |
| 7   | `src/engine-adapters/wiring/engine.module.ts`（`:354-365`）                                            | 按灰度模式决定「不传 classifier」/「传模型轨」；模型轨实现的 provider 装配                                     | adapter       | S6           | **D-1 第二段**                                  |
| 8   | `src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.service.ts`（`:87` `:162-164` `:74-79`） | **停止自行分类**，改为只吃内核事件；`mergeKernelOnlyEvents` 的并集语义需重新定义                               | adapter       | S4 / F3      | **D-1 第二段**（与 #4 **同一单**，不可拆）      |
| 9   | `src/engine-adapters/deliberation/deliberation-input.ts`（`:73` `:137` `:163`）                        | 兜底分类器改为与内核同源；`toOperatorTag` 标签白名单容纳新 kind                                                | adapter       | S4           | 兜底改造 = **D-1 第二段**；标签白名单 = **D-2** |
| 10  | `src/engine-adapters/wiring/engine-turn.service.ts`（`:396` `:419` `auditTurn` `:475`）                | 门面层的上下文写入 / 清理挂载点（L1）；审计调用改传内核事件                                                    | adapter       | S2 L1 / S4   | **D-1 第二段**                                  |
| 11  | `src/engine-adapters/rendering/turn-render-orchestrator.ts`（`:603` `:678` `:737` `:1244-1249`）       | 「上一轮来访话语」取用点（已有历史，无需新结构）；`forgetSession` 处挂上下文清理                               | adapter       | S2 L1 / F5   | **D-1 第二段**                                  |
| 12  | `src/engine-core/domain/events/session-event.ts`（`:13-24`）                                           | `CounselorEventKind` 加 `holding_present` / `cold_absent`                                                      | **core 纯层** | S3 / F2      | **D-2**（需例外批准）                           |
| 13  | `src/engine-core/cognition/state-transition.ts`（`:197` `DELTA_TABLE`）                                | 新 kind 的 delta 行（**方向与数值留 D-2 标定**）                                                               | **core 纯层** | S3 / F2      | **D-2**（需例外批准）                           |
| 14  | `src/admin-debug/event-tag-labels.ts`（`:35`）                                                         | 新 kind 的中文标签（穷尽 `Record`，不加就编译不过）                                                            | 业务层        | S3 / F2      | **D-2**                                         |
| 15  | `src/auto-practice/metrics/metric-dictionary.ts`（`:66-79`）                                           | 事件种类表 11 → 13；`POSITIVE_EVENTS` 口径同步（**是否含 `holding_present` 属临床口径，留 D-2**）              | 业务层        | S3           | **D-2**                                         |
| 16  | `src/engine-adapters/deliberation/deliberation-types.ts`（`:113-115`）                                 | `DELIBERATION_RULE_ALIGNED_TAGS` 增新 kind（否则 `toOperatorTag` 静默丢弃）                                    | adapter       | S3 / S4      | **D-2**                                         |
| 17  | `test/quality/d1-event-classifier-evidence.spec.ts`（**已存在**，39 例）                               | **复用**为规则轨零回归锚                                                                                       | 测试层        | S8           | **D-1 第二段**（复用，不改）                    |
| 18  | `test/engine-adapters/model-event-classifier.spec.ts`（**新文件**）                                    | 模型轨 fixture / 回落 / 跨轮 / 同源 / 影子不写状态 / 灰度缺省零回归                                            | 测试层        | S8           | **D-1 第二段**                                  |
| 19  | `test/engine-adapters/wp58-turn-delta-audit.spec.ts`（`:170-171`）                                     | `matchedTerms` 与 `strength` 两条断言的来源改变，需评估（**只评估，本单不改**）                                | 测试层        | S8           | **D-1 第二段**（评估后决定）                    |

**明确留 D-2 / D-3 的**：`CounselorEventKind` 联合扩展（#12）、`DELTA_TABLE` 两行（#13）、事件标签映射（#14）、指标字典（#15）、审议标签白名单（#16）、两类事件的 delta 方向与数值、缺席连续轮数阈值、模型轨结果如何进 `aggregateTurnDelta` —— 全部属 **D-2**；时序权重端口属 **D-3**。

---

## 3. S1–S9 逐项答复

### S1 · 接口形状落地草案（承接风险 A）

**结论**：三条路径技术上都可行；**路径 E 是唯一能同时满足「模型轨驱动当轮 delta」与「不改 core 接口语义」的路径**，但真实成本是**每轮关键路径的 LLM 延迟**（F1），不是类型改造量。路径 A 破坏面更大且不额外解决延迟。路径 D **单独使用不满足 D-1 前提**，但它是 S6 影子轨的实现形态。最终选哪条归主控（待拍板项 1）。

#### S1-0 现状事实（读源码）

```ts
// src/engine-core/domain/events/session-event.ts:45-47
export interface EventClassifier {
  classify(text: string, context?: ClassifyContext): readonly SessionEvent[];
}

// src/engine-core/in-memory/in-memory-engine-session.ts:377 —— turn 本身就是 async
async turn(handleId: string, input: EngineTurnInput): Promise<EngineTurnOutput> {

// src/engine-core/in-memory/in-memory-engine-session.ts:400-402 —— 唯一生产分类点
const events = this.classifier.classify(userText, {
  sensitiveTopics: runtime.characterProfile?.sensitiveTopics,
});
```

**关键事实：内核 `turn()` 已是 `async`**，且 `classify` 的返回值在同一函数内立即被消费（`:405` `personalityInput(runtime, events)` → `:409` `aggregateTurnDelta(events, ...)` → `:413` `transitionState(base.snapshot, events, ...)`）。所以「等一次异步分类」在**控制流上**没有障碍 —— 障碍只在**延迟**上（F1）。

#### S1-E · 路径 E（可选异步成员）

| 维度                            | 评估                                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 对 `RuleBasedClassifier` 的影响 | **零** —— 不实现可选成员即可；内核检测存在性再决定是否 await                                                                                                       |
| 对现有 core spec 的影响         | **零回归** —— 缺省路径下 `classifyAsync` 不存在，走原同步分支，逐字不变                                                                                            |
| 断言⑥                           | **绿** —— `EventClassifier` 已在 `expectedPublic`（`boundary.spec.ts:288-291`），改的是**已导出类型的方法签名**，不新增导出名                                      |
| 断言⑦                           | **绿** —— 不新增 core `.ts` 文件；`session-event.ts` 已在清单（`:467`）                                                                                            |
| 断言①–⑤ / ⑩                     | **绿** —— 新成员只是接口声明，无 `@nestjs/` / 网络 / prompt / `process.env`                                                                                        |
| core 改动量                     | `session-event.ts`（接口）+ `in-memory-engine-session.ts`（调用点 + 透传 sessionId）= **2 个 core 文件**                                                           |
| 是否需例外批准                  | **是** —— 改 `src/engine-core/**` 须按 conventions §1.1 走例外批准                                                                                                 |
| **真实成本（F1）**              | **每轮关键路径多一次 LLM 往返**。分类结果不进 `events`，第 5 步（落库）就不会发生。voice 流式、debug 面板、自动对练**全部走同一个 `turnStream`**                   |
| 延迟规避                        | 灰度把生效范围限定在非实时路径。**注意**：debug 面板路径走 `turnStream`（`debug-session.service.ts:531`），故划线应按「是否走 `turnStream`」，不是「是否 UI 实时」 |

#### S1-A · 路径 A（接口整体改 `Promise`）

| 维度        | 评估                                                                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 破坏面      | `EventClassifier` 的**全部实现**（`RuleBasedClassifier`）+ **全部调用点**（core `:400`、审计 `:162`、审议兜底 `:163`）                                               |
| core 改动量 | **≥ 3 个 core 文件**（`session-event.ts` + `rule-based-classifier.ts` 实现签名 + `in-memory-engine-session.ts` 调用点）                                              |
| 断言⑥⑦      | **绿**（不新增导出名 / 不新增文件）                                                                                                                                  |
| 额外收益    | **无** —— 延迟问题与 E 完全相同（都必须在内核 await）                                                                                                                |
| 额外代价    | 规则轨从「纯同步纯函数」变成「必须返回 Promise」→ core 纯函数测试写法全改，第一段 39 例基线快照（`test/quality/d1-event-classifier-evidence.spec.ts:436-497`）也全改 |
| 结论        | **同等延迟收益、更大改动面、更差零回归** → 有路径 E 时无理由选 A                                                                                                     |

#### S1-D · 路径 D（旁路预跑，内核热路径仍只跑规则轨）

| 维度                                   | 评估                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 是否满足「模型轨具备产出两类事件能力」 | **单独：不满足** —— 结果不进 `events` → 不进 `aggregateTurnDelta` → **产不出驱动 delta 的两类事件**。但**能力**（能判定、能产出两类标签、能观测对比）**满足**                                                                                                                                                                       |
| 与 S6 影子轨的关系                     | **路径 D 就是影子轨**。仓库已有同构实现：`DeliberationProcessor`（`deliberation.processor.ts:303`）把「每轮一次 LLM」做成「入队 + Worker 异步跑」，门面 `runShadowMode()` 入队即返回（`:361-366`）                                                                                                                                  |
| 单独走 D 的收益                        | 零 core 改动、零关键路径延迟，可拿到「规则轨 vs 模型轨」逐轮对照数据（正是 D-1 想要的对比证据）。**但 D-2 前提不成立** → 事件拆分单无法开工                                                                                                                                                                                         |
| E + D 组合                             | 仓库审议路径**刻意互斥挂载**（`engine.module.ts`）：`...(modeConfig.effectiveMode === 'shadow' ? { deliberation } : {})` 与 `...(modeConfig.effectiveMode === 'llm_active' ? { deliberationHook } : {})`，注释明写两条理由：「同一轮跑两次 LLM = 双份成本」+「两条路径写**同一个 trace key** → 互相覆盖, 灰度期的对比数据会丢一半」 |
| 结论                                   | **D 是 S6 影子轨的实现形态，不是 S1 接口路径的替代品**。建议拍板时把「S1 路径」与「S6 影子轨」分开拍                                                                                                                                                                                                                                |

#### S1-1 三处调用点对路径 E 的适配约束

| 调用点                                            | 适配约束                                                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| core 热路径 `in-memory-engine-session.ts:400-402` | 唯一需要 await 的地方。**三处里只有这一处必须等**                                                                         |
| 审计旁路 `turn-delta-audit.service.ts:162`        | `record()` 是 **fire-and-forget**（`void this.persist(input).catch(...)`），本身不在关键路径 → 可 await 也可不等（见 S4） |
| 审议兜底 `deliberation-input.ts:163`              | `extractCounselorEvents` 是**同步纯函数**（`:157-175`）→ 若在此跑模型轨需改 async，牵动审议链（**建议不改**，见 S4-4）    |

#### S1-2 回落顺序

```text
内核分类调用点
  ├─ classifier.classifyAsync 存在？
  │    ├─ 是 → await 它（模型轨实现内部自行回落规则轨，内核不感知）
  │    │      ├─ 成功 → 用模型轨事件
  │    │      └─ 失败/超时/非法 → 模型轨内部返回规则轨事件 + 记 errorCode
  │    └─ 否 → 同步 classify()（规则轨，逐字现状）
  └─ 规则轨永远可得（RuleBasedClassifier 无状态、无 IO）→ 回落不需要兜底逻辑
```

**回落必须逐字等价于规则轨**（第一段 R5 ⑥ 原话），否则同一句话两套 delta。最稳做法：**模型轨实现内部持有规则轨实例**，失败时直接返回 `ruleTracker.classify(text, context)` 的结果 —— 回落代码只有一处，不会漂。

#### S1-3 同步与异步的先后

**不能先跑同步再跑异步** —— 那等于每轮两次词表扫描 + 一次 LLM，白烧 CPU 且两条结果并存易漂。**推荐顺序**：先判 `classifyAsync` 是否存在，存在就只走异步（由实现内部决定是否回落），不存在才走同步。**这要求模型轨实现的 `classifyAsync` 内部持有规则轨回落，而不是内核来回落。**

---

### S2 · 上下文供给落地可行性（L1 / L2）

**结论**：**L1 可行且比 L2 划算**。(a) 门面收敛得比预估好（F4）；(b)「上一轮来访话语」在分类调用点**已经可得**（F5）；(c) 真正缺的只有「连续缺席计数」，它**可完全由模型轨实现按 sessionId 分桶自持**；(d) L2 要动 3 个 core 文件且与路径 E **叠加**，例外批准面积翻倍。**但 L1 有硬前提**：分类调用点当前**拿不到 sessionId**（见 S2-L1-4）。

#### S2-1 门面收敛性逐点核实

| 入口           | 文件:行                                                                                                                                                         | 经统一门面？                                                                                                                                                                           | 最终落到                                                                  | 「上一轮来访话语」                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------- |
| HTTP 接线接口  | `src/engine-adapters/wiring/engine-wiring.controller.ts:157`                                                                                                    | ✅ `EngineTurnService`                                                                                                                                                                 | `orchestrator.turn` → `session.turn`（`turn-render-orchestrator.ts:603`） | 编排器历史内有                               |
| voice 流式     | `src/engine-adapters/wiring/engine-stream-backend.adapter.ts:1090` `.turnStream(...)`                                                                           | ✅ `EngineTurnService`                                                                                                                                                                 | `orchestrator.turnStream` → `session.turn`（`:678`）                      | 同上                                         |
| debug 面板     | `src/admin-debug/debug-session.service.ts:531` `this.engine.turnStream(state.handleId, { userText: text }, { onDelta: () => {} }, { includePromptFull: true })` | ✅ `EngineTurnService`                                                                                                                                                                 | 同上（**走流式**）                                                        | 同上                                         |
| 自动对练       | `src/auto-practice/practice-runner.service.ts:503` `this.engine.turn(debugSessionId, counselorReply.text)`                                                      | ✅ `TurnEnginePort` → `DebugTurnEngineAdapter.turn`（`src/auto-practice/adapters/debug-turn-engine.adapter.ts:51-59`）→ `DebugSessionService.runTurn` → `EngineTurnService.turnStream` | 同上                                                                      | 另：runner 的 `history` 末条即上一轮来访回复 |
| 探测器共享会话 | `src/engine-adapters/wiring/risk/student-risk-gate.ts`                                                                                                          | ⚠️ **共享同一个 `InMemoryEngineSession` 实例**（文件头明写「`createEngineSessionPort` 只造**一个** `InMemoryEngineSession` —— 探测器是**进程级共享**的」）                             | 同上                                                                      | 同上                                         |

**结论**：core `session.turn` 全仓**只有 2 个**调用点，都在同一个门面（`TurnRenderOrchestrator`）内，其上是唯一的 `EngineTurnService`。**没有绕过门面的第二条路径。**

#### S2-L1 · L1（adapter 自持上下文）

| 问题               | 结论                                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 状态在何处建       | 模型轨实现内 `Map<sessionId, ClassifierContext>`。**但分类调用点不传 sessionId** → 必须补通道（S2-L1-4）                                                                                                                                                                                                                                                      |
| 状态在何处更新     | 模型轨实现内部，在每次 `classifyAsync` 末尾更新（连续计数、来访话语）。**更新者 = 判定者**，单一真相源                                                                                                                                                                                                                                                        |
| 状态在何处销毁     | 三个候选：① 模型轨实现按 sessionId 过期（TTL）；② 门面在会话关闭时显式清理 —— `EngineTurnService.forgetSession`（`engine-turn.service.ts:450` → `orchestrator.forgetSession`，`turn-render-orchestrator.ts:737`，注释明写「生命周期: 与 `histories` 同生命周期 (会话关闭时由 `forgetSession` 一起清)」）；③ 编排器 `settleTurn`（`:1244-1249`）每轮成功后推进 |
| 并发同会话         | 必须按 sessionId 分桶；同会话并发 turn 需串行。仓库有现成范式：`deliberation.processor.ts:415-425` 的 **per-session mutex**（Redis SETNX）。**事件分类侧若走同步 await，core `turn()` 内天然串行** → 并发风险低于审议                                                                                                                                         |
| 中断轮             | core 在 `input.signal?.aborted` 时抛 `ABORTED`（`in-memory-engine-session.ts:381-383`），**分类还没发生**（分类在 `:400`）→ 中断轮不产生分类副作用，**模型轨状态不应推进**。若 await 中被 abort，实现需吞掉取消并**不更新状态**                                                                                                                               |
| 错误回退           | 回落规则轨时**是否推进跨轮状态**？必须选一并写死。**推荐：按规则轨结果推进**（回落也是一次有效判定），否则一次 LLM 失败会让连续计数断链                                                                                                                                                                                                                       |
| 会话超时后残留     | `Map` 会泄漏。必须挂 TTL 或挂 `forgetSession`。**推荐挂 `forgetSession`**（钩子已存在）                                                                                                                                                                                                                                                                       |
| 跨场泄露（风险 C） | 分桶键必须是**业务 sessionId**（`runtime.sessionId`）而非 `handleId`（运行时维度，会话恢复后变化 → 跨轮状态会丢）                                                                                                                                                                                                                                             |

#### S2-L1-4 ⚠️ L1 的真实缺口：sessionId 通道

分类调用点（`in-memory-engine-session.ts:400-402`）能拿到的只有 `userText` 与 `runtime.characterProfile?.sensitiveTopics`。**没有 sessionId**（`runtime` 里有，但分类点没传）。三种做法：

| 做法                                               | 改动                                                                    | 评价                                                                                                     |
| -------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **L1-a · 扩 `ClassifyContext` 加可选 `sessionId`** | 改 **1 个 core 文件**（`session-event.ts`），调用点 `:401` 多传一个字段 | ✅ **推荐**。与路径 E 的 core 改动**落在同一文件** → E + L1-a 的 core 改动面 = **2 个文件**（不是 3 个） |
| **L1-b · 复用 `ClassifyContext` 已有通道捎带**     | 0 core 改动                                                             | ❌ 反模式：`sensitiveTopics` 是「敏感议题词表」，塞 sessionId 属语义挪用，未来必被误读                   |
| **L1-c · 改用 handleId 分桶**                      | 0 core 改动                                                             | ❌ 不可行：分类点拿不到 handleId；且 handleId 是运行时维度，恢复后会话后变化 → 跨轮状态丢失              |

**结论**：L1 的「零 core 改动」**不严格成立** —— 至少需要 L1-a 扩 `ClassifyContext` 一个可选字段（1 个 core 文件）。

#### S2-L2 · L2（扩 core 输入类型）

| 字段             | 流向                                                                                     | 需改 core 文件                                                                 | 断言⑥⑦                         |
| ---------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------ |
| 来访者上一轮话语 | 门面 → `EngineTurnInput` 新字段 → `session.turn` → `ClassifyContext` 新字段 → `classify` | `engine-session.types.ts` + `session-event.ts` + `in-memory-engine-session.ts` | ⑥ 绿（已导出类型扩字段）；⑦ 绿 |
| 连续缺席轮数     | 同上                                                                                     | 同上，或只改 2 个                                                              | 同上                           |

**内核自算缺席计数不可行**：内核 `workingWindow` 只累积**咨询师文本**（`in-memory-engine-session.ts:474-475`），**不存事件标签** → 算不出「连续几轮 neutral」。若要在内核算，得给 `EngineSessionRuntime` 加事件标签历史（core 私有字段 → 断言⑥⑦ 绿），但**这就把模型轨的判定结果变成了内核状态**，与「内核不依赖 adapter 的异步结果」矛盾。

**结论**：L2 干净但 **3 个 core 文件**，且与路径 E **叠加** → 例外批准面积 3 文件。除非主控有强烈的「上下文必须显式流经内核」偏好，否则 L2 的增量收益（一个 sessionId + 一个访客话语字段）不足以抵消它。

#### S2-可得性 · 「来访上一轮话语」取用点

| 路径                         | 可得性          | 取用点（已有结构）                                                                                                                                                                                                                                 |
| ---------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 编排器（全部路径的公共上游） | ✅ **可得**     | per-handle `history`（`historyOf(handleId)` `:1404` / `setHistory` `:1409`），内容由 `settleTurn` 追加（`:1244-1249`：咨询师一条 + **来访一条**）。在 `session.turn` 调用点（`:603` / `:678`）时历史已含第 1..N-1 轮 → **来访侧第 N-1 轮文本可取** |
| 自动对练 runner              | ✅ 可得（多余） | `practice-runner.service.ts` 的 `history` 在 `engine.turn` 调用时（`:503`）末条即上一轮来访回复                                                                                                                                                    |
| debug 面板                   | ✅ 可得         | `debug-session.service.ts:917` 追加 visitor 消息                                                                                                                                                                                                   |
| voice 流式                   | ✅ 可得         | 同编排器历史                                                                                                                                                                                                                                       |
| 探测器共享会话               | ✅ 可得         | 同上                                                                                                                                                                                                                                               |

**结论**：**L1 不需要 L2 的「扩 `EngineTurnInput`」也能拿到来访上一轮话语**；L1 缺的只是 sessionId 通道（L1-a，1 个 core 文件）。

---

### S3 · 模型轨结果类型形态（core 联合未扩前提下）

**结论**：**方案 b（映射回现有 kind + 旁路标签）最稳、方案 a（adapter 临时类型）次之、方案 c（等 D-2）会阻塞 D-2 前提**。三者的差别本质是「**临时类型放在哪**」：b 把临时形态限制在「映射规则表」一处，a 的临时形态是一整个 kind 联合。

#### S3-1 直接消费 `CounselorEventKind` 联合字面量的全部位置

| 位置                                                                            | 形式                                                                                | 联合扩 2 个成员的后果                                                                                       |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `src/engine-core/cognition/state-transition.ts:197`                             | `const DELTA_TABLE: Readonly<Record<CounselorEventKind, DeltaVector>>`              | 🔴 **编译报错**（穷尽 `Record` 缺键）                                                                       |
| `src/admin-debug/event-tag-labels.ts:35`                                        | `export const COUNSELOR_EVENT_LABELS: Readonly<Record<CounselorEventKind, string>>` | 🔴 **编译报错**；注释已写「键集合与内核 CounselorEventKind **严格一致** (11 类); 少一个就是面板上少一盏灯」 |
| `src/engine-adapters/deliberation/deliberation-types.ts:113-115`                | `] as const satisfies readonly CounselorEventKind[]`（10 值，少 `neutral`）         | 🟡 编译通过，但新 kind 不在白名单 → `toOperatorTag` 返回 `null` → 审议输入里**静默丢弃**                    |
| `src/engine-adapters/deliberation/deliberation-input.ts:137-145`                | `toOperatorTag(kind): DeliberationOperatorTag                                       | null`                                                                                                       | 🟡 同上               |
| `src/auto-practice/metrics/metric-dictionary.ts:66-79`                          | `TRACKED_EVENTS`（11 类）                                                           | 🟡 编译通过，但指标字典**不统计**新 kind → 批次看板口径缺失                                                 |
| `src/engine-adapters/deliberation-gate/deliberation-gate.types.ts:136`          | `type GateEventTag = DeliberationOperatorTag                                        | CounselorEventKind`                                                                                         | 🟢 联合变宽，编译通过 |
| `src/engine-adapters/wiring/trajectory/ethical-scripts.ts:72` `:80` `:90`       | 三个字面子集常量                                                                    | 🟢 编译通过；新 kind **不触发**轨迹幕（语义上可能正确 —— 在场/缺席不该触发伦理脚本）                        |
| `src/engine-core/domain/trajectory/script.ts:69`                                | `readonly onEvents?: readonly CounselorEventKind[]`                                 | 🟢                                                                                                          |
| `src/engine-core/cognition/delta-table-config.ts:109` / `alliance-config.ts:52` | `Partial<Record<CounselorEventKind, ...>>`                                          | 🟢（`Partial`）                                                                                             |
| `src/counselor/evaluation/evaluation-engine.ts:252`                             | `counts['boundary_cross'] ?? 0`                                                     | 🟢                                                                                                          |
| `src/engine-adapters/deliberation-gate/deliberation-gate.evaluator.ts:54`       | `GATE_KEY_EVENT_TAGS` 字面数组                                                      | 🟢                                                                                                          |

#### S3-2 反双胞胎清单（D-2 改联合时必须同步改的消费方）

**必须同步改（否则编译不过）**：(1) `state-transition.ts` 的 `DELTA_TABLE`（补两行；**数值留 D-2 标定**）；(2) `event-tag-labels.ts` 的 `COUNSELOR_EVENT_LABELS`（补两个中文标签）。

**编译过但语义缺失（必须显式决定，否则静默丢数据）**：(3) `deliberation-types.ts` 的 `DELIBERATION_RULE_ALIGNED_TAGS`（不补 → 审议输入丢事件）；(4) `metric-dictionary.ts` 的 `TRACKED_EVENTS`（不补 → 批次指标不含新 kind；`POSITIVE_EVENTS` 是否含 `holding_present` 属**临床口径**，留 D-2）。

**下游若消费了「临时类型」（方案 a）还要额外同步**：见 S3-3 方案 a 的反双胞胎面。

#### S3-3 三个方案的改动面与取舍

| 方案                               | 形状                                                                                                     | 改动面                          | 取舍                                                                                                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **a · adapter 临时类型 + 旁路**    | adapter 定义 `ModelEventKind = CounselorEventKind                                                        | 'holding_present'               | 'cold_absent'`（**adapter 本地**）；结果只走旁路观测，**不进 core `events`**                                                                                               | 1 个 adapter 新文件（类型）+ 1 个观测载体 | ✅ 允许模型轨先跑通并出对照数据；❌ 临时类型与最终类型两份形态。**缓解**：临时类型只许出现在「模型轨实现 + 影子观测落库」两处，D-2 只需迁这两个消费点 |
| **b · 映射回现有 kind + 旁路标签** | 模型轨判定在 core 事件上仍映射到现有 11 类 / `neutral`；`holding_present` / `cold_absent` 只记进旁路记录 | 同 a + 「映射规则表」（新文件） | ✅ core 侧零类型变化、D-2 只需换实现；❌ 映射是**有损压缩**，D-2 想接 delta 时必须重做映射。❗ 但 b 是**唯一能让 D-2 不返工**的方案：映射规则表从一开始就按 D-2 最终形状写 |
| **c · 等待 D-2**                   | 先扩 core 联合再上模型轨                                                                                 | 全部推到 D-2                    | ✅ 类型最干净；❌ D-2 前提在 D-2 之前不成立 → 事件拆分单会带着两张空表落地                                                                                                 |

---

### S4 · 三处分类点同源收敛（承接风险 B）

**结论**：三处的**同源程度并不相同** —— 审议侧**已经是「内核优先 + 规则轨兜底」**（主路同源），内核热路径是**权威真相**，**审计侧是唯一的真漂移源**。模型轨接入后要收敛的**实际是审计侧一处**（C3 / F3），不是三处。这是对第一段「实施单必须一次性收敛 3 处」的**收窄修正**。

#### S4-1 三处分类点逐点表

| 调用点         | 文件:行                                                                               | 输入来源                                                                  | 分类器实例来源                                                              | 同步 / 异步                                                        | 结果用途                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| **内核热路径** | `src/engine-core/in-memory/in-memory-engine-session.ts:400-402`                       | `userText`（咨询师本轮文本）+ `runtime.characterProfile?.sensitiveTopics` | 注入的 `this.classifier`（缺省 `new RuleBasedClassifier()`，:325）          | 同步 `classify`（若加 `classifyAsync` 则 await）                   | 进 `events` → `personalityInput`(:405) → `aggregateTurnDelta`(:409) → `transitionState`(:413) → `EngineTurnOutput.events`(:495) |
| **审计旁路**   | `src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.service.ts:87` / `:162` | `input.userText`（**无 sensitiveTopics**）                                | **自己的** `private readonly classifier = new RuleBasedClassifier()`（:87） | 同步 `classify`(:162)                                              | 与内核事件取**并集**（`mergeKernelOnlyEvents` :74-79）→ `aggregateTurnDelta` → 落库 `rawDelta`                                  |
| **审议兜底**   | `src/engine-adapters/deliberation/deliberation-input.ts:73` / `:163`                  | `counselorText`（**仅兜底路径用**）                                       | 模块级 `const fallbackClassifier = new RuleBasedClassifier()`（:73）        | 同步 `classify`(:163)（`extractCounselorEvents` 是**同步纯函数**） | → `toOperatorTag`(:137-145) → 审议输入的 operatorTags                                                                           |

#### S4-2 ⚠️ 关键修正：审议侧**已经**是内核优先（不是并列的第三个漂移源）

```ts
// src/engine-adapters/deliberation/deliberation-input.ts
const source: readonly CounselorEventKind[] =
  kernelEvents && kernelEvents.length > 0 ? kernelEvents : fallbackClassifier.classify(counselorText).map((event) => event.kind);
```

该函数自己的注释原文：

> 主路: 内核分类器的产物 (`EngineTurnOutput.events`) —— **内核的单一真相**.
> 适配层不另起一套预判: 同一句话两套标签 = 影子期的对比数据全废 (双方 delta 对不上, 谁也说不清谁错).
> 兜底: 内核没给 events 时 (老版本 / 测试 mock), 用**内核同一个**规则分类器现算一遍.

→ **与第一段预研的偏差**：第一段把三处并列成「都要收敛」。实测：**审议侧主路已经同源**，规则轨只在「内核没给 events」时兜底触发。因此风险 B 的收敛面 = **审计侧一处**（+ 审议兜底需保证「同实现同配置」）。

#### S4-3 审计侧为什么是**真漂移源**（F3 的代码证据）

审计的并集语义（`turn-delta-audit.service.ts:74-79`）：

```ts
const missing = kernelEventKinds.filter((kind) => kind !== 'neutral' && !events.some((event) => event.kind === kind));
if (missing.length === 0) return events;
return [...events, ...missing.map((kind) => ({ kind, matchedTerms: [], strength: 1 }))];
```

审计服务**自己写的注释**点明了这个并集的前提：

> ⚠️ 只有 sensitive_touch 会这样: 静态词典事件本地分类与内核**逐字同源**
> (同一个分类器 + 同一段文本), 不会漂移.

→ 模型轨上线后这条前提**直接失效**：本地分类 = 规则轨，模型轨 = 另一套判定 → 并集 = 规则轨 ∪ 模型轨 → 审计 `rawDelta` **既不等于内核实际施加的 delta，又比内核多算一截**。这不是「标签漂移」（风格问题），是**审计数据失真**（正确性问题）。→ 必须改为**只吃内核事件**（条件 C3）。

#### S4-4 模型轨接入后，三处各自的同源保证方式

| 调用点     | 同源保证方式                                                                                                                       | 是否跑模型轨                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 内核热路径 | **唯一权威**。注入的 classifier 即模型轨实现                                                                                       | ✅ 是                                                       |
| 审计旁路   | **改为只吃内核事件**（`kernelEventKinds` 直接作为事件源）；`mergeKernelOnlyEvents` 语义收窄为「内核事件 ∪ 审计侧补充（当前为空）」 | ❌ 否（审计**不自己**跑模型轨）                             |
| 审议兜底   | 保持内核优先；兜底分类器保证「与内核**同一个实现 + 同一份 fixture 基线**」                                                         | ❌ 否（跑模型轨会把同步的审议链异步化，牵动审议闸门与熔断） |

#### S4-5 三处对 S1 各路径的适配约束

| 调用点     | 路径 E                                                                                                                                         | 路径 A   | 路径 D（影子） |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------- |
| 内核热路径 | **唯一 await 点**                                                                                                                              | 改 await | 不变（仍同步） |
| 审计旁路   | `record()` 是 **fire-and-forget**（`void this.persist(input).catch(...)`）→ 审计**不 await** 模型轨，只读内核**已定**的事件 → 天然满足「同源」 | 同       | 同             |
| 审议兜底   | `extractCounselorEvents` 是同步纯函数 → 跑模型轨需改 async，牵动审议链 → **建议不改**                                                          | 同       | 同             |

#### S4-6 审计侧改动的代价（开工单必须**显式**拍板，不是实现细节）

现有断言（`test/engine-adapters/wp58-turn-delta-audit.spec.ts:170-171`）：

```ts
expect(row.eventDetails[0]?.matchedTerms).toContain('听起来你');
expect(row.eventDetails[0]?.strength).toBe(1);
```

审计改为「只吃内核事件」后，`matchedTerms` 的来源从「本地分类器重新匹配」变成「内核事件的 matchedTerms」：

- 若内核事件**携带** matchedTerms → 断言仍绿（内核规则轨与审计同源，命中词一致）。
- 若内核事件**不携带**（模型轨实现第一版不产出 matchedTerms —— 它不是词表命中）→ `matchedTerms` 为空 → **该断言红**。

→ 所以「审计只吃内核事件」有一条前置条件：**内核事件必须能携带 matchedTerms**，否则要么改断言、要么审计侧补一层映射。**这是开工单的拍板项。**

---

### S5 · LLM 轨道复用与失败回落

#### S5-1 注入方式

`CounselorLlmJsonClient` 是 `@Injectable()`，构造器注入 `LlmService` + `ConfigService`（`src/counselor/providers/llm-json.client.ts:120-124`）。模型轨实现放 adapter，**构造器注入 `CounselorLlmJsonClient` 即可** —— 不另起 LLM 通道（第一段 R5 ②「结构化输出只有一条链」沿用）。

#### S5-2 最贴近的既有 `requestJson` 范式：`turn-analysis.service.ts`（**每轮粒度**先例）

`src/counselor/providers/turn-analysis.service.ts:116-132`：

```ts
const profile = COUNSELOR_LLM_PROFILES.liveTurnAnalysis;
const result = await this.llmJson.requestJson<LiveTurnAnalysis>({
  systemPrompt: TURN_ANALYZER_SYSTEM_PROMPT,
  userPrompt: buildTurnAnalysisUserPrompt({ turnIndex, counselorText, visitorText: visitorTurn.text, recentTurns, tier }),
  schemaDescription: TURN_ANALYZER_SCHEMA_DESCRIPTION,
  validate: validateLiveTurnAnalysis,
  maxCompletionTokens: profile.maxCompletionTokens,
  reasoningEffort: profile.reasoningEffort,
  timeoutMs: profile.timeoutMs,
  tenantId: ctx.tenantId,
  userId,
});
if (!result.ok || result.data === null) {
  this.logger.warn('[turn_analysis_failed] session=' + sessionId + ' turn=' + turnIndex + ' code=' + (result.errorCode ?? 'unknown'));
  return { hintPublished: false, markPublished: false, disclosureAdded: 0 };
}
```

**可复用的四点纪律**：

1. **失败不抛** —— `result.ok === false` → 打 warn（**只出 errorCode，不出原文**）→ 返回中性结果。
2. **手写 validate** —— `validateLiveTurnAnalysis`（`src/counselor/providers/session-core.types.ts:387-403`）是**独立纯函数**校验器 → 模型轨同理要一个 `validateModelEventClassification` 纯函数（可单测、不引 IO）。
3. **超时来自 profile** —— `COUNSELOR_LLM_PROFILES.liveTurnAnalysis.timeoutMs` → 模型轨的 timeout 也走 profile 口径，不散落成第二个 env。
4. **输入最小化** —— `buildTurnAnalysisUserPrompt` 只放必要字段 → 对应风险 I 的最小化面。

#### S5-3 `requestJson` 的返回形状（唯一结构化出口，不抛）

`CounselorLlmJsonResult<T>`（`llm-json.client.ts:87-98`）：`{ ok, data, rawText, errorCode, errorMessage, usage }` —— **错误当数据，不 throw**。

#### S5-4 分类 prompt 的输入字段清单（草案）

最小化原则（风险 I）：**只送本轮咨询师文本 + 判定必需上下文**。

| 字段                  | 内容                          | 是否含心理原文 | 必要性                                                         |
| --------------------- | ----------------------------- | -------------- | -------------------------------------------------------------- |
| `counselorText`       | 本轮咨询师发言                | ✅ 含          | 必需（**这就是被判定对象**）                                   |
| `previousVisitorText` | 上一轮来访话语                | ✅ 含          | **模型轨的核心增量** —— 规则轨看不到它，这正是需要模型轨的理由 |
| `neutralStreak`       | 连续 neutral 轮数（分桶自持） | ❌ 计数        | 连续性判据必需                                                 |
| `sensitiveTopics`     | 角色敏感议题词表              | ❌ 词表        | 保持与内核规则轨同口径                                         |
| `turnIndex`           | 轮次号                        | ❌             | 观测字段用                                                     |

→ **风险 I 的结论：延续且加重一档**。模型轨比审议**更需要**原文（判定对象就是咨询师话语），但比审议**要得更少**（审议要整段 transcript + 最近 4 轮）。缓解只能是「最小化 + 只出码 + 不入观测表」。

#### S5-5 输出 schema 草案

kind 枚举怎么限**取决于 S3 方案**（§7 待拍板项 3）。两种口径：

- **方案 a（临时类型）**：枚举 = 现有 11 + `neutral` + `holding_present` + `cold_absent` = **13**
- **方案 b（映射回现有 kind）**：枚举 = 现有 11 + `neutral` = **12**；两类新标签**只出现在旁路字段**，不进 core `events`

共同字段：`kinds`（数组）、`confidence`（0–1）、`reasonCode`（**只出码，不出解释文本** —— 避免「解释」变成新的心理内容落库面）。

#### S5-6 手写校验点

| 校验点                     | 处置                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| **未知 kind**              | 丢弃该 kind；非空才继续；仍为空 → 回落规则轨 + `schema_validation_failed`                |
| **空数组**                 | 回落规则轨 + `schema_validation_failed`（空判定 = 无意义输出）                           |
| **多标签**                 | **合法** —— 规则轨本身支持一轮多标签（d1 spec 既有 `empathy` + `open_probe` 双标签用例） |
| **低置信**                 | 低于阈值 → **回落规则轨** + 记 `low_confidence`（不写进 events）                         |
| **confidence 越界 / 非数** | 回落 + `schema_validation_failed`                                                        |

#### S5-7 失败 / 超时 / 非法 schema / 熔断 → 回落规则轨的判定顺序

```text
模型轨 classifyAsync(text, context)
  1. 开关关 / 熔断开 / 场景红线(exam) → 直接返回规则轨结果  (零 LLM)
  2. requestJson(...) → result.ok === false ?
       ├─ 是 → 记 errorCode → 返回规则轨结果
       └─ 否 → validate() 不通过 → 回落规则轨结果
  3. confidence < 阈值 → 回落规则轨结果 (记 low_confidence)
  4. 以上都不成立 → 返回模型轨事件
```

**回落必须逐字等价于规则轨**（第一段 R5 ⑥ 原话）→ 实现上 = **模型轨实现内部持有规则轨实例**，失败时直接返回 `this.rule.classify(text, context)`。回落代码**只有一处**，不会漂。

#### S5-8 可复用的既有重试 / 熔断范式

| 范式              | 位置                                                                                                                                                                                            | 模型轨复用方式                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 重试码表          | `DELIBERATION_RETRYABLE_ERROR_CODES`（`llm-deliberation.service.ts:440-460`）：`json_not_found` / `json_parse_failed` / `schema_validation_failed` / `parse_error` / `http_429` + `http_5` 前缀 | **沿用同一份码表语义**；建议**复制一份同款常量**而非跨模块 import，避免 adapter↔adapter 耦合      |
| 熔断器            | `DeliberationProcessor`（`deliberation.processor.ts:139-185`）：threshold / cooldown / half-open / `circuit_open` errorCode                                                                     | 模型轨自持一个**会话级**熔断器；**熔断时零 LLM，直接回落规则轨**                                  |
| per-session mutex | `deliberation.processor.ts:415-425`（Redis SETNX）                                                                                                                                              | 分类侧**不需要** —— 内核 `turn()` 同步 await **天然串行**（同会话并发 turn 排队）                 |
| jobId 幂等        | `deliberation.processor.ts:428-434` `buildDeliberationJobId`                                                                                                                                    | 只在走**影子 BullMQ** 时需要                                                                      |
| 重试次数          | `attempts: this.resolveMaxRetries() + 1`（WP66 口径，默认 1 → 总共跑 2 次）                                                                                                                     | 同款                                                                                              |
| 风险闸门          | `isDeliberationRiskAcceptable`（高风险轮次不跑 LLM）                                                                                                                                            | 模型轨**可类比**：危机轮次不必跑分类（判定意义低、成本高）。**是否设闸门属实现细节，取舍见 §7-5** |

#### S5-9 ⚠️ 任务单与代码的一处事实冲突（按任务单 §3 要求**显式登记，不静默改写**）

任务单 §2-S5 把 `timeout` 列为回落错误码之一，但仓库既有码表的注释明确写：

> ⚠️ 这份清单按**真实错误码词表**列, 不是按任务单的示意表:
> `CounselorLlmJsonClient` 实际能吐出的码只有这些:
> · client 自身: `json_not_found` / `json_parse_failed` / `schema_validation_failed`
> · 上游 chunk 透传: `http_401` / `http_429` / `http_500`… / `no_body` / `parse_error` / `fetch_error`
> 任务单表里的 `timeout` **根本不存在** (超时落到 catch-all 的 `fetch_error`)

→ **模型轨的观测码表不得自造 `timeout`**；超时统一归 `fetch_error`。若模型轨自包一层 `model_classifier_timeout`，**必须显式声明它与既有码表的映射关系**，否则统计侧会看到两个语义重叠的码。

#### S5-10 成本与 429 压力面（登记，**不做吞吐实测**）

- 模型轨 = **每轮一次** LLM 请求。第一段实测样本 = 96 场 / 1112 轮 → 全量跑 ≈ **1112 次** LLM 调用。
- 对比：审议是「每轮每场入队，但受风险闸门 + 熔断 + mutex 压制」；模型轨若走**生效轨 = 每轮必发、无闸门**。
- 429 是现实约束：既有码表把 `http_429` 列为**可重试**，说明上游配额确实会被打满。
- **本单不做吞吐实测**（属批次动作，另案）。登记：生效轨全量 ≈ 1112 次 / 样本规模，成本量级比现有「每场类」调用高 **1–2 个数量级**。

---

### S6 · 灰度开关与影子观测

#### S6-1 模式枚举与审议范式的映射（三态语义可直接照搬）

| 审议模式     | 模型轨对应   | 语义                                      | 是否影响 delta |
| ------------ | ------------ | ----------------------------------------- | -------------- |
| `shadow`     | `shadow`     | 跑模型轨，结果**只写观测**，不进 `events` | ❌             |
| `rule_only`  | `rule_only`  | 只跑规则轨，**一次 LLM 都不发**           | ❌             |
| `llm_active` | `llm_active` | 模型轨结果进 `events` → 影响 delta        | ✅             |

唯一差别：`llm_active` 在模型轨侧 = 「模型轨结果**替换**规则轨结果」；在审议侧 = 「审议建议**修正**规则 delta」。

#### S6-2 env 键命名建议（照抄审议的键位结构）

| 用途     | 建议键                                       | 缺省        | 依据                                                                                      |
| -------- | -------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| 总开关   | `ENGINE_MODEL_CLASSIFIER_ENABLED`            | 关          | 照 `ENGINE_DELIBERATION_ENABLED`                                                          |
| 生效模式 | `ENGINE_MODEL_CLASSIFIER_EFFECTIVE_MODE`     | `rule_only` | 照 `ENGINE_DELIBERATION_EFFECTIVE_MODE`（**缺省不同**，见下）                             |
| 灰度名单 | `ENGINE_MODEL_CLASSIFIER_GRAYSCALE_SESSIONS` | 空 = 全量   | 照 `ENGINE_DELIBERATION_GRAYSCALE_SESSIONS`                                               |
| 超时     | `ENGINE_MODEL_CLASSIFIER_TIMEOUT_MS`         | 3000        | 照 `ENGINE_DELIBERATION_TIMEOUT_MS`（`DEFAULT_DELIBERATION_EFFECTIVE_TIMEOUT_MS = 3000`） |
| 模型     | 走 `COUNSELOR_LLM_PROFILES` 口径             | —           | **建议不另设 env**（少一个开关 = 少一类歧义）                                             |

**缺省必须是 `rule_only`（硬要求）**：不配任何 env = 改造前**逐字一致**，零回归。审议的缺省是 `shadow`，因为**审议在生产里本来就跑影子**；模型轨是**新能力**，生产现状 = 规则轨 → 缺省必须是 `rule_only`。

**非法值回落方向与审议相反（显式偏差，待拍板）**：

- 审议：`resolveDeliberationEffectiveMode` 非法 → `shadow`（注释原话：「`shadow` 是**最保守**的方向…回退到 shadow = 退回当前生产现状, 零回归」）。
- 模型轨：非法 → **`rule_only`**（**「现状」不同**：模型轨的现状是 `rule_only`，回落到现状才零回归）。
- 两者**理由一致**（**回落到现状**），只是「现状」不同。→ 列入 §7 待拍板项 4 的选项说明。

#### S6-3 判定链（照抄 `resolveSessionEffectiveMode` 的顺序）

```text
resolveModelClassifierSessionMode(config, sessionId, scenarioType):
  0. scenarioType === 'exam' → 'rule_only'      // 考核红线，优先于一切
  1. 总开关关 / 模式 === 'rule_only' → 'rule_only'
  2. 模式 === 'shadow' → 'shadow'
  3. 模式 === 'llm_active' → 名单内 'llm_active'，名单外 'rule_only'（名单为空 = 全量）
```

**考核场景红线必须照抄**：审议的理由是「考核要锁版本、锁温度、逐字复现；LLM 做不到逐字复现」，且「`exam` 是**红线**: 不接受任何配置覆盖, 也不接受名单覆盖」。**模型轨理由完全相同**（模型输出不可复现）→ 考核场景**永远不跑模型轨**，写死在类型里，不靠配置自觉。

#### S6-4 条件注入位置

| 位置                                                | 改法                                                                                                                              | 依据                                                                            |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `engine.module.ts:318-332`                          | 新增 `ENGINE_MODEL_CLASSIFIER_MODE_CONFIG` provider（**启动期求值一次** + 启动日志**只出模式名与名单规模**）                      | 照 `ENGINE_DELIBERATION_MODE_CONFIG`                                            |
| `engine.module.ts:354-365`（`ENGINE_SESSION_PORT`） | 模式非 `rule_only` 时注入 classifier；**`rule_only` 时连 classifier 都不注入** → 内核走缺省 `new RuleBasedClassifier()`，逐字现状 | 照 `...(modeConfig.effectiveMode === 'llm_active' ? { deliberationHook } : {})` |
| `engine.providers.ts:244-250`                       | `createEngineSessionPort` 增**可选** `classifier` 透传                                                                            | 照 `capConfig` 等端口注入纪律                                                   |

**关键纪律**（审议注释原话）：「不注入 = 内核决策链里根本没有审议这一步 (逐字零回归, 不是『结果一样』)」。模型轨同款：`rule_only` 模式下**内核连可选成员都不存在**。

#### S6-5 影子期口径

| 项              | 结论                                                                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 是否写 BDI 状态 | ❌ **不写**。影子结果只进观测载体，不进 `events`                                                                                                                                                      |
| 是否改 delta    | ❌ **不改**                                                                                                                                                                                           |
| 观测写哪        | **Redis trace**（审议影子同款：`DeliberationProcessor` 写 Redis trace 表）。备选「进程内旁路」只在本进程可读、**多实例部署即丢** → 建议 Redis                                                         |
| trace key       | **必须与审议错开** —— 审议的 key 是 tenant+session+turn，模型轨要用**独立 key 前缀**，否则两边互相覆盖（审议注释明写这个坑：「两条路径写**同一个 trace key** → 互相覆盖, 灰度期的对比数据会丢一半」） |
| 写入时机        | 影子轨在 turn **之后**旁路跑（入队 → BullMQ worker 异步）→ **零关键路径延迟**                                                                                                                         |

#### S6-6 观测字段清单（**不含对话原文**）

| 字段             | 类型     | 说明                                                              |
| ---------------- | -------- | ----------------------------------------------------------------- |
| `tenantId`       | string   | 租户                                                              |
| `sessionId`      | string   | 业务会话 id                                                       |
| `turnIndex`      | number   | 轮次                                                              |
| `ruleKinds`      | string[] | 规则轨判出的 kind（数组）                                         |
| `modelKinds`     | string[] | 模型轨判出的 kind（数组）                                         |
| `agreement`      | boolean  | 两轨是否一致（**核心对照指标**）                                  |
| `confidence`     | number   | 模型置信度（0–1）                                                 |
| `fallbackReason` | string   | null                                                              | 回落原因码（`circuit_open` / `json_parse_failed` / `schema_validation_failed` / `low_confidence` / `fetch_error` / `http_429` …） |
| `latencyBucket`  | string   | 耗时桶（如 `lt_500ms` / `lt_1500ms` / `lt_3000ms` / `gt_3000ms`） |
| `modelId`        | string   | 用的模型                                                          |
| `promptVersion`  | string   | prompt 版本                                                       |
| `strength`       | number   | **恒 1**（第一版，见 S6-7）                                       |

**禁入观测**：咨询师原文、来访原文、**命中词原文（`matchedTerms`）**、解释性文本、kernelState、展示名（`title` / `characterLabel`）。

理由：`matchedTerms` 是词表命中词，可能命中**角色敏感议题词表**（`sensitive_touch` 的命中词就来自那里）→ 属心理内容衍生 → 不入观测表。

#### S6-7 `strength` 第一版恒 1

沿用第一段 R7 / 风险 G：`strength` 参与 12 维 delta 缩放（`state-transition.ts:389-400`）→ 模型轨返回非 1 会**静默改数值**。**第一版强制 `strength = 1`**，置信度只进观测，不进 delta。

---

#### S6-8 首版「只观测不落 delta」vs「带 delta 接入」

这是 §7 待拍板项 5（**本单不替主控决定**）。三条形态的事实依据：

| 形态                                                        | 收益                                               | 代价                                                                                  |
| ----------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **只观测**（影子）                                          | 零行为风险、零关键路径延迟                         | **D-2 前提不成立**（产不出驱动 delta 的两类事件）→ 事件拆分单无法开工                 |
| **带 delta**（生效）                                        | 前提成立                                           | 触发：延迟（F1）、成本（H）、审计口径（F3）、`strength`（G）、考核可复现（exam 红线） |
| **中间态**（产出两类新标签 → 只进**旁路记录**，不进 delta） | 既验证「模型轨能否判出两类事件」，又**不改 delta** | 需 S3 方案 a/b 的「旁路标签」设计配合；delta 通路留 D-2                               |

→ 三者取舍见 §7-5。

---

### S7 · 跨轮缺席状态与连续性判据的状态归属

**结论**：跨轮状态**必须由模型轨实现自持（按业务 sessionId 分桶）**，不放内核、不放门面。连续性判据所需的状态是**可枚举的计数与标记**，**不含任何 delta 数值**。

#### S7-1 连续性判定所需的状态（**结构**，不含阈值）

| 状态                    | 含义                             | 何时 +1                           | 何时重置                                               |
| ----------------------- | -------------------------------- | --------------------------------- | ------------------------------------------------------ |
| `consecutiveNeutral`    | 连续「未命中任何行为事件」的轮数 | 本轮规则轨 + 模型轨都判 `neutral` | 命中任一正向或负向事件                                 |
| `consecutiveColdAbsent` | 连续「在场缺席」的轮数           | 本轮判为 `cold_absent`            | 判为 `holding_present` / 命中任一事件 / 来访有实质回应 |
| `lastVisitorResponded`  | 上一轮来访是否实质回应           | —                                 | 每轮刷新                                               |
| `lastEventKind`         | 上一轮命中的 kind（重置判据）    | —                                 | 每轮刷新                                               |

⚠️ **本单不标定阈值**：连续多少轮算「缺席」属**临床口径**（第一段风险 E）→ 留 D-2 + 标定批次。台账 §4 P1 列出的候选系数（如 ±0.002）**仅为历史候选，本单不沿用、不确认**。

#### S7-2 L1 分桶 vs L2 输入下的存放与更新者

| 方案                   | 存放位置                                                        | 更新者                                        | 销毁                                                                                                                                              |
| ---------------------- | --------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **L1**（adapter 自持） | 模型轨实现内 `Map<sessionId, ClassifierState>`                  | **模型轨实现**（判定者 = 更新者，单一真相源） | 挂 `forgetSession`（`engine-turn.service.ts:450` → `orchestrator.forgetSession` :737，注释明写「生命周期: 与 `histories` 同生命周期」）+ TTL 兜底 |
| **L2**（扩 core 输入） | 由**门面**填充 → `EngineTurnInput` → `ClassifyContext` → 分类器 | **门面**                                      | 门面（与 `histories` 同生命周期）                                                                                                                 |

**L1 更优**：**更新者 = 判定者** → 不可能出现「状态在一处、判定在另一处」的两份真相。L2 要在门面维护同一套计数 → 门面变成**第二个判定者**。

#### S7-3 中断轮 / 失败回退 / 并发 / 跨场的状态语义

| 场景                                                                | 语义                                           | 依据                                                                                                                                     |
| ------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **中断轮**（`input.signal?.aborted` → core 抛 `ABORTED`，:381-383） | **不推进状态**                                 | 中断在 :381-383，分类在 :400 —— core 在分类**之前**就抛了 → 根本没分类 → 无副作用。若 await 期间被 abort，实现需吞掉取消且**不更新状态** |
| **失败回落规则轨**                                                  | **按规则轨结果推进**                           | 回落也是一次有效判定；否则一次 LLM 失败会让连续计数**断链**（计数器被 LLM 故障污染）                                                     |
| **同会话并发 turn**                                                 | 内核 `turn()` 同步 await → **天然串行**        | 不需要 Redis mutex（对照：审议需要 mutex 是因为它是异步旁路）                                                                            |
| **跨场泄露**（风险 C）                                              | 分桶键 = **业务 sessionId**，**不是 handleId** | handleId 是运行时维度（会话恢复后变化）→ 跨轮状态会丢，且不同场次可能撞桶                                                                |

#### S7-4 内核 `workingWindow` 不参与

`in-memory-engine-session.ts:474-475`：工作窗口**只累积咨询师文本**，**不存事件标签** → 内核**算不出**「连续几轮 neutral」。若要在内核算，得给 `EngineSessionRuntime` 加事件标签历史（core 私有字段）→ 但**这就把模型轨的判定结果变成了内核状态**，与「内核不依赖 adapter 的异步结果」直接矛盾。→ **排除**。

#### S7-5 状态归属结论

**跨轮状态归模型轨实现（adapter）自持，按业务 sessionId 分桶；销毁挂 `forgetSession`；内核 `workingWindow` 不参与；阈值与 delta 数值全部留 D-2。**

---

### S8 · 测试策略与基线复用

#### S8-1 基线复用：规则轨 39 例快照 = 零回归锚

`test/quality/d1-event-classifier-evidence.spec.ts` 的 describe ⑨「规则轨基线快照 (预研风险 F: 此前无专属 spec)」把固定构造语料 → **逐字事件序列**锁死（覆盖 `empathy` / `acceptance` / `normalization` / `open_probe` / `affirmation` / `judgment` / `preaching` / `minimizing` / `boundary_cross` / `sensitive_touch` / `neutral`，含一条**多标签**用例与一条**上下文词表**用例）。

→ **模型轨实现不得改这份 spec**，且必须保证：**模型轨未注入时，这 39 例逐字不变**。

#### S8-2 模型轨测试怎么 mock `requestJson`（不打真模型、不依赖网络）

`CounselorLlmJsonClient` 是 `@Injectable()`（构造器注入 LlmService + ConfigService）→ 测试里**注入一个 stub client**（实现同接口，`requestJson` 返回预置的 `CounselorLlmJsonResult`），**不打网络**。

仓库既有范式：`test/engine-adapters/wp58-turn-delta-audit.spec.ts` 用 `repoStub()` + `makeService(ON, repo)` **手工造依赖，不启 Nest 容器** → 模型轨 spec 照此。

#### S8-3 fixture 组织（只放**构造样例**，不放真实逐字稿）

| fixture 组                  | 构造意图                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------- |
| 正向命中                    | 构造文本命中 empathy 等                                                               |
| 负向命中                    | 构造文本命中 judgment / preaching                                                     |
| `neutral → holding_present` | 规则轨判 `neutral` + 模型轨判 `holding_present`（**跨轮**：连续 N 轮 neutral 后触发） |
| `neutral → cold_absent`     | 同上，cold 方向                                                                       |
| 多标签                      | 一轮多 kind（对照规则轨既有 `empathy` + `open_probe` 用例）                           |
| 低置信                      | 模型轨返回 confidence 低于阈值                                                        |
| 回落                        | 每个错误码各一条                                                                      |

**隐私 + 双盲纪律：fixture 只放人工构造的样例，不得放真实逐轮稿。**

#### S8-4 必须覆盖的测试点

| 测试点             | 断言要点                                                                     |
| ------------------ | ---------------------------------------------------------------------------- |
| 跨轮状态推进与重置 | 连续计数递增；命中事件后重置；**多会话隔离**（两个 sessionId 互不影响）      |
| 三处同源           | 审计层与审议层拿到的标签 **== 内核标签**（第一段 R7 同源收敛测试点）         |
| 影子结果不写状态   | 影子模式下 `EngineTurnOutput.events` 与改造前**逐字一致**；BDI 状态逐字一致  |
| 失败回落规则轨     | 每个错误码一条 → 断言**逐字回落规则轨**且**只出 errorCode 不出原文**         |
| 灰度缺省零回归     | 不配 env → 内核走缺省 `RuleBasedClassifier` → 39 例快照全绿 + boundary 12 绿 |
| 中断轮不推进状态   | abort → 状态分桶**无变化**                                                   |
| 考核红线           | `scenarioType = 'exam'` → **不发 LLM**（可断言 `requestJson` 未被调用）      |
| `strength` 恒 1    | 模型轨返回的每条事件 `strength === 1`                                        |

#### S8-5 只读复核的测试基线（**实测数字**）

命令（只读、非 watch、无写盘）：

```bash
pnpm exec vitest run test/engine-core test/engine-adapters test/quality
```

结果（2026-11-12 实测，本机）：**exit 0 · 99 文件 / 1779 例通过 · Duration 40.61s**。

⚠️ **命令边界说明**：`AGENTS.md` §2.3 规定「后端 `eslint` / `tsc` / `vitest` 由大炮在终端执行」。本单为满足 S8「只读复核现有用例数与文件数基线」跑了一次**只读** vitest。**正式开工单的闸门仍由大炮在终端执行。**

#### S8-6 `strength = 1` 假设在既有 spec 里的锁定面（只评估，**不改断言**）

| 位置                                                              | 锁定内容                                                                                                                                         | 模型轨返回非 1 时                                                                                        |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `test/quality/d1-event-classifier-evidence.spec.ts`（describe ⑨） | 39 例 fixture 的 expected 里 `strength: 1` 逐条出现（约 30 处构造件）+ 末尾 1 条**显式断言**「strength 恒为 1 (模型轨加权的前置假设, 快照锁住)」 | **红** —— 但只要模型轨**不污染规则轨路径**，这些断言**不受影响**（fixture 走的是 `RuleBasedClassifier`） |
| `test/engine-adapters/wp58-turn-delta-audit.spec.ts:171`          | `expect(row.eventDetails[0]?.strength).toBe(1)`                                                                                                  | 若审计改为吃内核事件、而内核事件来自模型轨 → **红**；模型轨恒 1 → 绿                                     |

→ **第一版 `strength` 恒 1 → 两处都不需要改**。这是「恒 1」除风险 G 之外的**第二条独立理由**（spec 锁定面）。

#### S8-7 `wp58` 的 `matchedTerms` 断言影响面（只评估）

| 位置                                                 | 断言                                                              | 审计改为「只吃内核事件」后                                                                                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `wp58-turn-delta-audit.spec.ts:170`                  | `expect(row.eventDetails[0]?.matchedTerms).toContain('听起来你')` | **取决于内核事件是否携带 matchedTerms**（见 S4-6）→ **开工单必须显式拍板**                                                                      |
| `wp58-turn-delta-audit.spec.ts:171`                  | `expect(row.eventDetails[0]?.strength).toBe(1)`                   | 模型轨恒 1 → 绿                                                                                                                                 |
| `wp58-turn-delta-audit.spec.ts` 的 rawDelta 逐字用例 | 「原始 delta 与内核系数表逐字一致 (11 维全落)」                   | 若审计口径改为「只吃内核事件」→ 仍应逐字一致（前提：内核事件与本地分类同源）；**建议在开工单里加一条「审计 rawDelta == 内核实际 delta」的断言** |

---

### S9 · 改动面清单与 D-1 / D-2 边界

#### S9-1 完整改动面清单

见 **§2**（19 行表：文件 | 改动内容 | 归属层 | 依据 | 归属单）。本节只做**边界归类**与**例外批准范围**。

#### S9-2 需主控例外批准的 core 文件（若走 **E + L1-a**）

| #   | core 文件                                                     | 改什么                                                                                   | 断言⑥                                                 | 断言⑦                          |
| --- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------ |
| 1   | `src/engine-core/domain/events/session-event.ts`              | `EventClassifier` 加**可选** `classifyAsync?`；`ClassifyContext` 加**可选** `sessionId?` | 🟢 **绿**（不新增导出名，改的是**已导出类型**的成员） | 🟢 **绿**（文件已在清单 :467） |
| 2   | `src/engine-core/in-memory/in-memory-engine-session.ts`       | 分类调用点 (:400-402) 改「有 `classifyAsync` 则 await」+ 透传 `sessionId`                | 🟢 **绿**（无新导出）                                 | 🟢 **绿**（文件已在清单 :494） |
| —   | （**仅 L2**）`src/engine-core/domain/engine-session.types.ts` | `EngineTurnInput` 加可选字段                                                             | 🟢 绿                                                 | 🟢 绿（文件已在清单 :456）     |

**绿的理由（逐条对照断言）**：

- **断言⑥**（barrel 导出白名单双向比对）：只加**成员**、不加**导出名** → 白名单不变 → 绿。若新增 core 文件并 export → **红**。
- **断言⑦**（core 文件清单反向检查）：**不新增 core 文件** → 绿。
- **断言①–⑤**（AST 纯度）：新成员只是接口声明 + 调用点控制流 → 无 `@nestjs/` / 网络 / prompt / 模型名 / `process.env` / `globalThis` → 绿。

#### S9-3 D-1 第二段 / D-2 / D-3 归属

| 归属单         | 内容                                                                                                                                                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-1 第二段** | 模型轨实现文件、灰度配置、装配透传、**审计改只吃内核事件**、审议兜底同源、跨轮状态、观测载体、模型轨 spec                                                                                                                                             |
| **D-2**        | `CounselorEventKind` 联合扩 2 类、`DELTA_TABLE` 两行（**方向与数值留标定**）、`COUNSELOR_EVENT_LABELS` 两项、`TRACKED_EVENTS` / `POSITIVE_EVENTS` 口径、`DELIBERATION_RULE_ALIGNED_TAGS`、模型轨结果如何进 `aggregateTurnDelta`、**缺席连续轮数阈值** |
| **D-3**        | 时序权重端口（本单不涉及）                                                                                                                                                                                                                            |

#### S9-4 ⚠️ 必须提前告知主控的**改动面放大**（F2）

第一段估 D-2 改 **1 个** core 文件（扩联合）。**实测：扩联合会立即打红 TS 编译面**：

| 位置                                                | 形式                                                                                | 后果                                                                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/engine-core/cognition/state-transition.ts:197` | `const DELTA_TABLE: Readonly<Record<CounselorEventKind, DeltaVector>>`              | 🔴 **编译报错**（穷尽 Record 缺键）                                                                             |
| `src/admin-debug/event-tag-labels.ts:35`            | `export const COUNSELOR_EVENT_LABELS: Readonly<Record<CounselorEventKind, string>>` | 🔴 **编译报错**（注释已写「键集合与内核 `CounselorEventKind` **严格一致** (11 类); 少一个就是面板上少一盏灯」） |

→ **D-2 实际改动面 = 4 个文件**（2 core + 2 业务层），不是 1 个。第一段 R6 只判了「断言⑥⑦ 绿」，**漏判 TS 编译面**。这条不改第一段的结论，但**必须在 D-2 开工单里显式列出**，否则实现阶段会以为「加两行就行」。

#### S9-5 与 §1.3 范围切分的一致性核对

| 第一段切分                                                                                                              | 本单结论                                                     | 是否一致                           |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------- |
| D-1 第二段 = 模型轨实现（接口 / 上下文 / 类型形态 / 三处同源 / LLM 复用与回落 / 灰度与观测 / 跨轮状态 / 测试 / 改动面） | 全部覆盖于 S1–S9 + §4–§9                                     | ✅                                 |
| D-2 = 扩联合 + `DELTA_TABLE` 行 + 分类器接线 + **delta 方向与数值**                                                     | 本单**不写任何 delta 方向 / 数值 / 权重斜率 / 阈值**         | ✅ 一致（F2 只报改动面，不报数值） |
| D-3 = 时序权重端口                                                                                                      | 本单不涉及                                                   | ✅                                 |
| 方案 1（cold 模式先验，D-4）DOC-2 结论为不建议单独实施                                                                  | 本单**不复议**其去留，只在 §6 风险表记录其与模型轨路径的关系 | ✅                                 |

---

## 4. 接口与类型草案

### 4.1 S1 三路径签名草案

#### 路径 E（可选异步成员）

```ts
// src/engine-core/domain/events/session-event.ts
export interface EventClassifier {
  /** 同步分类 —— 规则轨 (纯函数, 无状态, 无 IO). */
  classify(text: string, context?: ClassifyContext): readonly SessionEvent[];

  /**
   * 可选异步分类 —— 模型轨.
   *   存在则内核 await 它; 不存在走 classify.
   *   ⚠️ 回落由**实现内部**负责 (失败时返回规则轨结果), 内核不感知.
   */
  classifyAsync?(text: string, context?: ClassifyContext): Promise<readonly SessionEvent[]>;
}

export interface ClassifyContext {
  readonly sensitiveTopics?: readonly string[];
  /** L1-a: 业务会话 id —— 跨轮状态分桶键. */
  readonly sessionId?: string;
}
```

内核调用点（`src/engine-core/in-memory/in-memory-engine-session.ts:400-402`）：

```ts
const context: ClassifyContext = {
  sensitiveTopics: runtime.characterProfile?.sensitiveTopics,
  sessionId: runtime.sessionId, // ← L1-a 新增
};
const events = this.classifier.classifyAsync
  ? await this.classifier.classifyAsync(userText, context)
  : this.classifier.classify(userText, context);
```

**core 改动 = 2 个文件**（`session-event.ts` + `in-memory-engine-session.ts`）。

#### 路径 A（接口整体改 Promise）

```ts
export interface EventClassifier {
  classify(text: string, context?: ClassifyContext): Promise<readonly SessionEvent[]>;
}
```

**破坏面**：`RuleBasedClassifier` 实现签名 + **三个调用点**（core :400、审计 :162、审议兜底 :163）+ core 纯函数测试写法全改 → **≥ 3 个 core 文件**，且**不额外解决延迟问题**。

#### 路径 D（旁路预跑，core 签名不变）

```ts
// src/engine-adapters/cognition/model-classifier-shadow.port.ts  (新文件 · adapter 层)
export interface ModelClassifierShadowPort {
  /** 旁路预跑 —— 结果只进观测, 不进 core events. */
  runShadowMode(input: ModelClassifierShadowInput): Promise<void>;
}
```

**core 零改动**；装配在门面（`turn-render-orchestrator`）每轮渲染后旁路调一次 —— 参照 `DeliberationShadowPort` / `DeliberationProcessor` 的 `runShadowMode` 形态。**但单独走 D 不满足 D-2 前提**（见 S1-D）。

### 4.2 S3 三方案类型形状

#### 方案 a · adapter 临时类型 + 旁路

```ts
// src/engine-adapters/cognition/model-event-classifier.ts  (adapter 本地类型)
export type ModelEventKind = CounselorEventKind | 'holding_present' | 'cold_absent';

export interface ModelSessionEvent {
  readonly kind: ModelEventKind;
  readonly matchedTerms: readonly string[]; // 模型轨无词表 → 恒空
  readonly strength: number; // 第一版恒 1
  readonly confidence: number;
}
```

**反双胞胎约束**：临时类型**只许出现在两处** —— 「模型轨实现」+「影子观测落库」。D-2 只需迁这两个消费点。

#### 方案 b · 映射回现有 kind + 旁路标签

```ts
// src/engine-adapters/cognition/model-event-mapping.ts  (新文件 · 映射规则表)
export type CoreEventKind = CounselorEventKind; // 11 + neutral, core 侧零变化
export type ModelSideLabel = 'holding_present' | 'cold_absent';

export interface ModelClassification {
  readonly coreKinds: readonly CoreEventKind[]; // 映射回现有 kind
  readonly sideLabels: readonly ModelSideLabel[]; // 只进旁路记录
  readonly confidence: number;
}
```

**关键**：映射规则表从一开始就**按 D-2 最终形状写** → D-2 不返工。

#### 方案 c · 等待 D-2

core 联合 + `DELTA_TABLE` + `COUNSELOR_EVENT_LABELS` **一并**在 D-2 做；D-1 第二段**不产出任何新类型** → 事件拆分单会带着两张空表落地。

### 4.3 S6 模式与观测字段表

**模式枚举**（三态，语义照搬审议）：

```ts
export type ModelClassifierEffectiveMode = 'shadow' | 'rule_only' | 'llm_active';
export const MODEL_CLASSIFIER_EFFECTIVE_MODES: readonly ModelClassifierEffectiveMode[] = ['shadow', 'rule_only', 'llm_active'];
```

| 模式         | 模型轨是否发 LLM | 结果是否进 `events` | 是否影响 delta | 对应审议模式 |
| ------------ | ---------------- | ------------------- | -------------- | ------------ |
| `rule_only`  | ❌ 一次都不发    | ❌                  | ❌             | `rule_only`  |
| `shadow`     | ✅ 发            | ❌ 只进观测         | ❌             | `shadow`     |
| `llm_active` | ✅ 发            | ✅                  | ✅             | `llm_active` |

**env 键**（照抄审议键位结构）：

| 键                                           | 缺省                        | 备注                                                          |
| -------------------------------------------- | --------------------------- | ------------------------------------------------------------- |
| `ENGINE_MODEL_CLASSIFIER_ENABLED`            | 关                          | 总开关先于模式                                                |
| `ENGINE_MODEL_CLASSIFIER_EFFECTIVE_MODE`     | `rule_only`                 | 非法值回落 `rule_only`（**与审议回落方向相反**，理由见 S6-2） |
| `ENGINE_MODEL_CLASSIFIER_GRAYSCALE_SESSIONS` | 空 = 全量                   | 逗号分隔                                                      |
| `ENGINE_MODEL_CLASSIFIER_TIMEOUT_MS`         | 3000                        | 照 `DEFAULT_DELIBERATION_EFFECTIVE_TIMEOUT_MS`                |
| 模型                                         | 走 `COUNSELOR_LLM_PROFILES` | 不另设 env                                                    |

**观测字段表**（写 Redis trace，**禁含原文 / 禁含 matchedTerms**）：

| 字段             | 类型     | 必填 | 说明                                 |
| ---------------- | -------- | ---- | ------------------------------------ |
| `tenantId`       | string   | ✅   | 租户                                 |
| `sessionId`      | string   | ✅   | 业务会话 id                          |
| `turnIndex`      | number   | ✅   | 轮次                                 |
| `ruleKinds`      | string[] | ✅   | 规则轨 kind                          |
| `modelKinds`     | string[] | ✅   | 模型轨 kind                          |
| `agreement`      | boolean  | ✅   | 两轨是否一致（**核心对照指标**）     |
| `confidence`     | number   | ✅   | 0–1                                  |
| `fallbackReason` | string   | null | ✅                                   | 回落原因码 |
| `latencyBucket`  | string   | ✅   | 耗时桶                               |
| `modelId`        | string   | ✅   | 模型标识                             |
| `promptVersion`  | string   | ✅   | prompt 版本（对应风险 J 的口径核对） |
| `strength`       | number   | ✅   | 恒 1                                 |

**禁入字段**：咨询师原文、来访原文、`matchedTerms`、解释性文本、kernelState、展示名。

---

## 5. 门面与调用点收敛表

| 入口           | 文件:行                                                                                                             | 经统一门面？                                                                                                                                               | 落到 core 的路径                                                          | 同步 / 异步   | 「上一轮来访话语」可得性                                                   | 模型轨接入方式                                 | 状态清理点                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| HTTP 接线接口  | `src/engine-adapters/wiring/engine-wiring.controller.ts:157`                                                        | ✅ `EngineTurnService`                                                                                                                                     | `orchestrator.turn` → `session.turn`（`turn-render-orchestrator.ts:603`） | 聚合（await） | ✅ 编排器 per-handle `history`（含来访半边，`settleTurn` :1244-1249 追加） | 由内核 `session.turn` 统一走 → **无旁路**      | `forgetSession`（`engine-turn.service.ts:450` → `orchestrator.forgetSession` :737） |
| voice 流式     | `src/engine-adapters/wiring/engine-stream-backend.adapter.ts:1090`（`.turnStream(...)`）                            | ✅ `EngineTurnService`                                                                                                                                     | `orchestrator.turnStream` → `session.turn`（:678）                        | **流式**      | ✅ 同上                                                                    | 同上（**走 `turnStream` → 延迟规避按此划线**） | 同上                                                                                |
| debug 面板     | `src/admin-debug/debug-session.service.ts:531`（`this.engine.turnStream(state.handleId, { userText: text }, ...)`） | ✅ `EngineTurnService`                                                                                                                                     | 同上（**走流式**）                                                        | 流式          | ✅ 同上                                                                    | 同上                                           | 同上                                                                                |
| 自动对练       | `src/auto-practice/practice-runner.service.ts:503`（`this.engine.turn(debugSessionId, counselorReply.text)`）       | ✅ `TurnEnginePort` → `DebugTurnEngineAdapter` → `DebugSessionService.runTurn`                                                                             | 同上                                                                      | 流式          | ✅ 编排器历史 + runner 自己的 `history` 末条                               | 同上                                           | 同上                                                                                |
| 探测器共享会话 | `src/engine-adapters/wiring/risk/student-risk-gate.ts`                                                              | ⚠️ **共享同一个 `InMemoryEngineSession` 实例**（文件头明写「`createEngineSessionPort` 只造**一个** `InMemoryEngineSession` —— 探测器是**进程级共享**的」） | 同上                                                                      | 同上          | ✅ 同上                                                                    | 同上                                           | 同上（**共享实例 ⇒ 清理点必须挂 `forgetSession`，不能靠实例析构**）                 |

**收敛性小结**：

- core `session.turn` 全仓**只有 2 个调用点**（`turn-render-orchestrator.ts:603` / `:678`），其上是**唯一**门面 `EngineTurnService` → **没有绕过门面的第二条路径**。
- ⇒ 「上下文写入点」与「清理点」**各只有一个**，不必逐路径配对（F4）。
- ⇒ 跨轮状态销毁**统一挂 `forgetSession`**。
- ⚠️ **延迟规避的划线**：voice 流式、debug 面板、自动对练**三条路径全部走同一个 `turnStream`** → 判「是否实时」应按**是否走 `turnStream`**，不是按 UI 形态（F1）。

---

## 6. 风险表

> 与第一段风险 **A–K** 逐条标注关系（**新增 / 延续 / 已消解**）。第一段 R8 表：`docs/worklog/pending/phase2.5-d1-model-event-classifier-research-result-2026-11-12.md`。

### 6.1 第一段 A–K 的关系标注

| #     | 风险                                           | 与第一段的关系         | 本轮的结论变化                                                                                                                                                  |
| ----- | ---------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | 同步 `EventClassifier` 与异步 LLM 调用形状冲突 | 🔵 **延续且加重**      | 从「类型冲突」重定义为「**延迟预算**」：路径 E 在**类型上零阻力**（内核 `turn()` 本就 async），真实成本是**每轮关键路径多一次 LLM 往返**（F1）                  |
| **B** | 反双胞胎：三处分类调用点                       | 🟡 **部分消解 + 升级** | 审议侧**已经**内核优先（S4-2）→ 收敛面从 3 处**收窄到审计侧 1 处**；但审计侧从「标签漂移」**升级**为「**审计 delta 失真**」（F3）                               |
| **C** | 带状态分类器 + 模块级单例 → 跨场泄露           | 🔵 **延续**            | 缓解方案已定（按**业务 sessionId** 分桶，禁用 handleId）；但 L1 的「零 core 改动」**不成立** —— 至少需 L1-a 扩 `ClassifyContext` 一个可选字段（1 个 core 文件） |
| **D** | `neutral` 拆分口径未定                         | 🔵 **延续**            | 仍留 D-2（本单不拍板）                                                                                                                                          |
| **E** | 两类新 kind 的连续性阈值未定                   | 🔵 **延续**            | 阈值仍留 D-2 + 标定；本单只定**状态结构与归属**（S7），**不标定任何阈值**                                                                                       |
| **F** | 规则轨分类器无专属 spec                        | 🟢 **已消解**          | 39 例基线快照已入库（`test/quality/d1-event-classifier-evidence.spec.ts` describe ⑨），可直接作零回归锚                                                         |
| **G** | `strength` 参与 delta 缩放                     | 🔵 **延续**            | 第一版恒 1；**新增第二条理由**：既有 spec 的 `strength: 1` 锁定面（S8-6）                                                                                       |
| **H** | LLM 成本与 429（每轮一次）                     | 🔵 **延续且加重**      | 生效轨 = **每轮必发、无闸门**（审议有风险闸门 + 熔断 + mutex 压制）；≈ 1112 次 / 样本规模，量级高 1–2 个数量级                                                  |
| **I** | 原文送 LLM                                     | 🔵 **延续且加重**      | 模型轨**必须**送咨询师原文（判定对象），比审议**更重**；但比审议**要得少**（不需整段 transcript）。缓解仅「最小化 + 只出码 + 不入观测表」                       |
| **J** | `eventTags` 口径漂移                           | 🔵 **延续**            | 模型轨需额外把 `promptVersion` / `modelId` 写进 trace，才能做版本口径核对（S6-6）                                                                               |
| **K** | 降级轮混入样本                                 | 🔵 **延续**            | 沿用第一段过滤口径（统计前先剔降级轮）；模型轨观测同样需要标 `degraded` 才可沿用该口径                                                                          |

### 6.2 本轮新增风险

| #     | 风险                                                                                                                 | 影响                                                           | 缓解 / 备注                                                                                                                                      | 归属单     |
| ----- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| **L** | **延迟预算**：路径 E 让每轮关键路径多一次 LLM 往返，而 voice 流式 / debug 面板 / 自动对练**全部走同一 `turnStream`** | 实时对练体验塌陷；用户侧感知为「卡」                           | 灰度把生效范围限定在**非 `turnStream`** 路径；模型轨自带 `timeoutMs`；**失效即回落规则轨**                                                       | D-1 第二段 |
| **M** | **TS 编译面破坏**：扩 `CounselorEventKind` 联合会让两处穷尽 `Record` 立即编译报错                                    | D-2 实现阶段返工                                               | D-2 改动面从 1 个文件放大到 **4 个**（`state-transition.ts:197` + `event-tag-labels.ts:35` + 2 个 core）→ 必须在 D-2 开工单显式列出（F2 / S9-4） | **D-2**    |
| **N** | **审计 delta 失真**：审计并集 = 规则轨 ∪ 模型轨                                                                      | 审计 `rawDelta` 与内核实际 delta 对不上且多计 → 观测结论不可用 | 审计**停止自行分类**，只吃内核事件（C3）；代价是 `matchedTerms` 可能变空 → `wp58` :170 断言需拍板（S4-6）                                        | D-1 第二段 |
| **O** | **跨轮状态残留**：`Map` 分桶无清理                                                                                   | 内存泄漏 + 跨场残留心理上下文                                  | 销毁挂 `forgetSession`（与 `histories` 同生命周期）+ TTL 兜底；分桶键用业务 sessionId（S7-2 / S7-3）                                             | D-1 第二段 |
| **P** | **考核可复现红线**：模型输出不可复现                                                                                 | 考核数据集不可逐字复现 → 与蓝图 §7 红线 4 冲突                 | `exam` 场景**恒 `rule_only`**，写死在类型里、不接受配置或名单覆盖（S6-3）                                                                        | D-1 第二段 |
| **Q** | **观测字段泄露**：`matchedTerms` / 解释文本入 trace                                                                  | 心理内容衍生泄露，触碰 AGENTS.md §5.1 隐私红线                 | 观测字段清单**禁含**原文 / `matchedTerms` / 解释文本；`reasonCode` 只出码（S5-5 / S6-6）                                                         | D-1 第二段 |
| **R** | **任务单事实冲突**：任务单把 `timeout` 列为回落错误码                                                                | 实现若照抄 → 观测码表出现语义重叠的两个码                      | 仓库既有码表明确：`timeout` **根本不存在**，超时落 `fetch_error`；模型轨**不得自造 `timeout`**（S5-9）                                           | D-1 第二段 |

### 6.3 方案 1（cold 模式先验 · D-4）与模型轨路径的关系

DOC-2 结论为**不建议单独实施**，本单**不复议**。仅登记关系：模型轨路径（路径 E）能判出 `cold_absent` **不需要** cold 模式先验 —— 因为模型轨**本来就看得到来访上一轮话语**（S2-可得性）。→ 若 D-1 第二段落地，方案 1 的必要性进一步下降；**但 D-2 的 delta 数值仍需独立标定**，不能从模型轨的存在推出数值。

---

## 7. 待拍板项（5 项）

> 本单**只列选项与取舍**，**不替主控决定默认实现**。

### 7.1 接口路径（承接 S1）

| 选项                           | core 改动                | 能否驱动当轮 delta               | 延迟                        | 零回归                                                                         |
| ------------------------------ | ------------------------ | -------------------------------- | --------------------------- | ------------------------------------------------------------------------------ |
| **E**（可选 `classifyAsync?`） | 2 个文件（需例外批准）   | ✅ 能                            | 每轮关键路径 +1 次 LLM 往返 | ✅ 缺省路径逐字不变                                                            |
| **A**（接口整体改 Promise）    | ≥ 3 个文件（需例外批准） | ✅ 能                            | 同 E                        | ⚠️ 规则轨从同步纯函数变 Promise → core 纯函数测试写法全改，39 例基线快照需改写 |
| **D**（旁路预跑）              | 0 个文件                 | ❌ **不能**（结果不进 `events`） | 零                          | ✅                                                                             |

**取舍要点**：E 与 A 的**延迟完全相同**，A 额外付出「规则轨失去同步纯函数性质」的代价 → 有 E 时无理由选 A。D 是 **S6 影子轨的实现形态**，不是 S1 的替代品 —— **建议把「S1 路径」与「S6 影子轨」分开拍**。另注：E 与 D **可并存**（模型轨生效轨 + 影子轨并存时的双跑问题，见审议的互斥挂载教训）。

### 7.2 上下文供给（承接 S2）

| 选项                                                       | core 改动                                       | 上下文来源                                            | 主要代价                                                                     |
| ---------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| **L1-a**（adapter 自持 + 扩 `ClassifyContext.sessionId?`） | **1 个** core 文件（与 E 同一文件 → 合计 2 个） | 模型轨实现内 `Map<sessionId, state>`，更新者 = 判定者 | 需扩 1 个 core 可选字段（需例外批准）                                        |
| **L1-b**（复用 `sensitiveTopics` 通道捎带）                | 0                                               | 同上                                                  | ❌ **反模式**：语义挪用，未来必被误读                                        |
| **L1-c**（改用 handleId 分桶）                             | 0                                               | 同上                                                  | ❌ **不可行**：分类点拿不到 handleId；handleId 会话恢复后变化 → 跨轮状态丢失 |
| **L2**（扩 `EngineTurnInput` + `ClassifyContext`）         | **3 个** core 文件（与 E **叠加** → 合计 5 个） | 门面填充                                              | 例外批准面积翻倍；门面成为**第二个判定者**（状态两份真相）                   |

**取舍要点**：L2 的增量收益（一个 sessionId + 一个访客话语字段）**不足以抵消** 3 个 core 文件 + 例外批准面积 + 两份真相风险。「上一轮来访话语」在编排器历史里**已经可得**（F5），L1 不需要为它扩 core。→ 除非主控有强烈的「上下文必须显式流经内核」偏好。

### 7.3 结果类型形态（承接 S3）

| 选项                                | core 联合 | D-2 是否返工                             | 改动面                  | 取舍                                                                 |
| ----------------------------------- | --------- | ---------------------------------------- | ----------------------- | -------------------------------------------------------------------- |
| **a**（adapter 临时类型 + 旁路）    | 不变      | ⚠️ 需迁 2 个消费点                       | 1 类型文件 + 1 观测载体 | 允许模型轨先跑通出对照数据；临时类型与最终类型两份形态               |
| **b**（映射回现有 kind + 旁路标签） | 不变      | ✅ **不返工**（映射表按 D-2 最终形状写） | 同 a + 映射规则表       | core 侧零类型变化；映射是**有损压缩**，D-2 接 delta 时必须重做映射   |
| **c**（等待 D-2）                   | D-2 才扩  | —                                        | 全部推到 D-2            | 类型最干净；**D-2 前提在 D-2 之前不成立** → 事件拆分单带两张空表落地 |

**取舍要点**：三者差别本质是「**临时类型放在哪**」。b 把临时形态限制在「映射规则表」一处，是**唯一能让 D-2 不返工**的方案；a 次之；c 会阻塞 D-2 前提。

### 7.4 灰度轨与缺省 / 回落方向（承接 S6）

| 选项                              | 缺省         | 非法值回落   | 特征                                                                                    |
| --------------------------------- | ------------ | ------------ | --------------------------------------------------------------------------------------- |
| **照抄审议**（含回落方向）        | `shadow`     | `shadow`     | 与审议完全同构；但缺省 `shadow` 意味着**默认就烧 LLM**，且**不配 env ≠ 改造前逐字一致** |
| **只照抄结构、回落方向相反**      | `rule_only`  | `rule_only`  | **不配 env = 零回归**（模型轨的现状就是规则轨）；`shadow` 仍需**显式配置**才进入        |
| **全量优先**（缺省 `llm_active`） | `llm_active` | `llm_active` | ❌ 与「首次灰度不改行为」相悖，风险 G / H / L 同时暴露                                  |

**取舍要点**：回落理由**两边一致**（**回落到现状 = 零回归**），只是「现状」不同 —— 审议的现状是 `shadow`、模型轨的现状是 `rule_only`。另：**`exam` 场景恒 `rule_only`** 这一条**建议无条件照抄**（P 风险），不属可选项。

### 7.5 模型轨首版是否只观测不落 delta（承接 S6）

| 选项                                        | D-2 前提                      | 行为风险                         | 延迟 / 成本                 |
| ------------------------------------------- | ----------------------------- | -------------------------------- | --------------------------- |
| **只观测**（影子）                          | ❌ 不成立                     | 零                               | 零关键路径延迟              |
| **中间态**（产出两类新标签 → 只进旁路记录） | ⚠️ 部分（能判出但没进 delta） | 低                               | 影子轨可零延迟              |
| **带 delta 接入**（生效）                   | ✅ 成立                       | 高（同时触发 G / N / P / H / L） | 每轮关键路径 +1 次 LLM 往返 |

**取舍要点**：若 D-2 的开工时点不紧，「只观测」最稳；若 D-2 紧接着要开，「中间态」能既验证模型轨的判出能力又不改 delta。**「带 delta」必然要求先解决 N（审计口径）与 L（延迟划线）**。

---

## 8. 建议开工步骤

> 顺序化最小实施路径（供主控拍板后写开工单）。**不替主控决定 7.1–7.5 的选项。**

### 8.1 实施顺序（建议 6 步，每步一个可验证闸门）

| 步    | 内容                                                                                                                                                                               | 出口判据                                                                        |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **1** | **拍板 §7 的 5 项**，把结论写进开工单（**写代码前必须定**，否则必然返工 —— 第一段 §7「先定接口形状，再写代码」同款纪律）                                                           | 5 项全部有明确结论 + 例外批准范围（core 文件清单）已写明                        |
| **2** | **扩 core 契约**（路径 E + L1-a）：`session-event.ts`（可选 `classifyAsync?` + `ClassifyContext.sessionId?`）+ `in-memory-engine-session.ts`（调用点 await 分支 + 透传 sessionId） | `boundary.spec.ts` 12 例全绿；39 例规则轨快照**逐字不变**                       |
| **3** | **模型轨实现**（adapter 新文件）：`requestJson` + 手写 `validate` + **内部持有规则轨实例**做回落 + 按 sessionId 分桶的跨轮状态                                                     | 新 spec 全绿（回落逐字等价规则轨）；**不接 env**、**不装配** → 对现有行为零影响 |
| **4** | **灰度配置 + 条件装配**（新文件 + `engine.module.ts` + `engine.providers.ts`）：三态 + 名单 + 超时 + `exam` 红线；`rule_only` 时**不注入 classifier**                              | **不配 env** → 全量测试逐字不变；启动日志只出模式名与名单规模                   |
| **5** | **收敛审计侧**（`turn-delta-audit.service.ts`）：停止自行分类 → 只吃内核事件                                                                                                       | `wp58` 断言**按 7.x 拍板结果**处理；新增「审计 rawDelta == 内核实际 delta」断言 |
| **6** | **观测 + 影子轨**：Redis trace（独立 key 前缀）+ 字段白名单                                                                                                                        | 隐私自检：trace 样本**无原文 / 无 matchedTerms / 无解释文本**                   |

### 8.2 应补 spec 用例清单（供开工单直接抄）

| 组         | 用例                                                                                                                                            | 断言要点                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **零回归** | 既有 39 例规则轨快照                                                                                                                            | **逐字不变**（复用 `d1-event-classifier-evidence.spec.ts`，**不改**）                           |
|            | `boundary.spec.ts` 12 例                                                                                                                        | 全绿                                                                                            |
|            | 缺省灰度下的 core / adapter 全量                                                                                                                | 用例数 **≥ 99 文件 / 1779 例**，零丢失 / 零改写                                                 |
| **回落**   | 每个错误码一条（`json_not_found` / `json_parse_failed` / `schema_validation_failed` / `parse_error` / `http_429` / `http_5xx` / `fetch_error`） | 断言**逐字回落规则轨** + **只出 errorCode 不出原文**（**注意：`timeout` 不是既有码**，见 S5-9） |
|            | 熔断打开                                                                                                                                        | 断言 **`requestJson` 未被调用** + 结果 == 规则轨                                                |
|            | 低置信                                                                                                                                          | 回落规则轨 + 记 `low_confidence`                                                                |
|            | 未知 kind / 空数组                                                                                                                              | 回落 + `schema_validation_failed`                                                               |
| **跨轮**   | 连续计数递增 / 命中事件后重置 / 中断轮不推进 / **多会话隔离**                                                                                   | 状态分桶行为逐条断言                                                                            |
|            | `forgetSession` 后                                                                                                                              | 分桶被清（**不留残留**）                                                                        |
| **同源**   | 审计层标签 == 内核标签；审议层标签 == 内核标签                                                                                                  | 三处逐字一致                                                                                    |
|            | 审计 `rawDelta`                                                                                                                                 | == 内核实际 delta（新增断言）                                                                   |
| **影子**   | 影子模式下 `events` 与 BDI 状态                                                                                                                 | 与改造前**逐字一致**                                                                            |
|            | 影子 trace 字段                                                                                                                                 | 字段白名单齐全 + **不含**原文 / `matchedTerms`                                                  |
| **红线**   | `scenarioType = 'exam'`                                                                                                                         | `requestJson` **未被调用**                                                                      |
|            | `strength`                                                                                                                                      | 模型轨每条事件 `strength === 1`                                                                 |
| **多标签** | 一轮多 kind                                                                                                                                     | 合法透传（对照规则轨既有双标签用例）                                                            |

### 8.3 本轮预研**没有**解决、必须留给后续单的事项

| 事项                                                       | 归属                   |
| ---------------------------------------------------------- | ---------------------- |
| 两类事件的 **delta 方向 / 大小 / 权重斜率**                | D-2 + 标定批次         |
| **缺席连续轮数阈值**                                       | D-2 + 标定批次         |
| 模型轨结果如何进 `aggregateTurnDelta`                      | D-2                    |
| `POSITIVE_EVENTS` 是否含 `holding_present`（**临床口径**） | D-2                    |
| 时序权重端口                                               | D-3                    |
| cold 模式先验（方案 1 / D-4）去留                          | DOC-2 结论，本单不复议 |

---

## 9. 闸门建议

> 后端命令**一律走 pnpm，禁裸 npx**（`AGENTS.md` §2.3）。闸门**由大炮在终端执行**。

### 9.1 命令与判据

| #   | 命令                                                                      | 判据                                                                                                                                  |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `pnpm exec tsc -p tsconfig.build.json --noEmit`                           | **0 error**                                                                                                                           |
| 2   | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`   | **0 error**（CLI 覆盖 `types`，不带 `--types` 会 exit 2）                                                                             |
| 3   | `pnpm lint`                                                               | **0 error**，记 **warning 数**                                                                                                        |
| 4   | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                  | **12 例全绿**                                                                                                                         |
| 5   | `pnpm exec vitest run test/quality test/engine-core test/engine-adapters` | 全绿；**用例数 ≥ 99 文件 / 1779 例**，零丢失 / 零改写                                                                                 |
| 6   | `pnpm test`                                                               | 全量全绿，记 **总数 / skipped / failed / 墙钟**                                                                                       |
| 7   | `git diff --stat HEAD -- src/engine-core`                                 | **不为空**（本单会改 1–2 个 core 文件）→ 必须**逐项对得上例外批准清单**（§9.2）；**多出任何一行即打回**                               |
| 8   | `git diff --stat HEAD -- src/engine-adapters`                             | 只含 §2 表中标为「D-1 第二段」的行                                                                                                    |
| 9   | `git diff --stat HEAD -- src/admin-dashboard`                             | **为空**（前端不碰）                                                                                                                  |
| 10  | 隐私自检                                                                  | 新增文件 / spec / trace 样本**无对话原文、无 prompt 全文、无 `matchedTerms`、无 kernelState、无展示名**（`title` / `characterLabel`） |

### 9.2 变更面判据（本单特有）

| 路径                  | 判据                                                                                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine-core`     | 若走 **E + L1-a** → 应**恰好 2 个文件**：`src/engine-core/domain/events/session-event.ts` + `src/engine-core/in-memory/in-memory-engine-session.ts`。**出现第 3 个 core 文件**（如 `engine-session.types.ts`）⇒ 说明 L2 被混入 → 打回 |
| `src/engine-core`     | **不得新增 core 文件**（会打红断言⑦）；**不得新增导出名**（会打红断言⑥）                                                                                                                                                              |
| `src/engine-adapters` | `turn-delta-audit.service.ts` 的改动**必须与模型轨实现同一单**（不可拆 —— 拆开会导致并集语义与模型轨不匹配的中间态入库）                                                                                                              |
| 全仓                  | `git status --short` 只应出现 `docs/worklog/` 下的文档 + 上述清单内的源文件                                                                                                                                                           |

### 9.3 机器状态与墙钟口径

**本轮实测基线**（2026-11-12，仓库 `E:\Work\Project\backend\mofang-nestjs`，HEAD `7b80615`）：

| 项                                                                        | 值                                                  |
| ------------------------------------------------------------------------- | --------------------------------------------------- |
| CPU 核数                                                                  | **8**                                               |
| 内存                                                                      | **15.9 GB** 总 / **5.6 GB** 空闲                    |
| 常驻 `node` 进程                                                          | **2 个**（WS 99.5 MB + 34.1 MB；**无 watch 常驻**） |
| `pnpm exec vitest run test/engine-core test/engine-adapters test/quality` | **exit 0 · 99 文件 / 1779 例 · Duration 40.61s**    |

**墙钟判据**：全量 `pnpm test` 的墙钟应与上表同量级（40–90 s 量级）。**若显著变慢**，先排查：① 是否有 `vitest --watch` / dev server 常驻；② 是否新引入了**每轮**的同步 IO / DB 查询（模型轨每轮一次 LLM 会显著拉长 `turn()`，但**影子轨不进入 core 热路径**）；③ 是否忘了给 `ClassifyContext.sessionId` 分桶导致 `Map` 无限增长。

### 9.4 本单的只读复核记录（零改动自证）

| 项                                            | 结果                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `git diff --stat HEAD -- src/engine-core`     | **空**（exit 0）                                                                                                   |
| `git diff --stat HEAD -- src/engine-adapters` | **空**（exit 0）                                                                                                   |
| `git status --short`                          | 仅 2 个 **未跟踪**的 `docs/worklog/pending/` 文档（本任务的开工单与本结论文档）；**无任何 `src/` 或 `test/` 变更** |

→ 本单**零代码改动**：未改 `src/**`、未改 `test/**`、未改 `boundary.spec.ts`、未接 env、未改 `.env.example`、未改 module 装配 / migration / DB、未跑批次、未调真 LLM、未碰前端、未 commit / push。
