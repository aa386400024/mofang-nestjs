# D-1 预研结论 · 模型轨事件分类器（只读调查，零代码改动）

> 状态：**【预研结论】**（2026-11-12）。执行方：MiniMax Code。本单**零代码改动**：未改 `src/**`、未改 `test/**`、未改 `boundary.spec.ts`、未接 env、未跑批次、未调真 LLM。
> 仓库：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`
> 事实源：`docs/worklog/pending/phase2.5-d1-model-event-classifier-research-minimax-2026-11-12.md`（D-1 预研任务单，R1–R8）
> 口径声明：本结论只出**码、计数、比率、布尔、机制描述**；不复制任何心理对话原文；不写两类事件的 delta 方向 / 数值 / 权重斜率 / 缺席轮数阈值（全部留 D-2 标定）。

---

## 1. 总结论

**有条件可行。** 条件是 **D-1 取证与模型轨实现必须拆成两段**：先做**只读取证单**（钉死规则轨真实漏判率，零 core 改动、零 LLM 调用），复核通过后再派**模型轨实现单**。

三条支撑结论：

1. **规则轨的三点结构性不可达全部复核成立**（R1），且 DOC-2 的描述**偏保守**：不是「分类器被有意排除来访话语」，而是**访客文本根本不进内核** —— 内核 `workingWindow` 只累积咨询师文本，访客回复在 `engine.turn` 返回之后才生成。所以「给模型轨补来访上下文」这件事，**内核层拿不到，必须由 adapter 提供**。
2. **逐轮样本完全可抽取**（R2）：本地 96 份逐字稿、1112 轮，`messages[]`（咨询师 + 来访者原文 + 轮次号）与 `traces[].eventTags`（规则轨逐轮判定）**已经在盘**，**不需要重跑分类器、不需要跑批次**。仓库已有现成的隐私安全抽取范式（`batch-metrics.service.ts` 的 `projectTraces`）。
3. **模型轨落地不需要碰 core**（R5 / R6）：`EventClassifier` 是 core 已导出的**端口**，内核会话已有 `classifier?` 注入缝（`in-memory-engine-session.ts:192`），只是装配层一直没传。**装配层补一行 + adapter 新增一个实现文件 = 零 core 改动、断言⑥⑦ 不变绿**。

**同时有一条硬约束必须写进结论**：**「neutral 误吞上界 = 89.39%」**（实测 1112 轮里 994 轮被判 neutral）。这个数字意味着规则轨的正向事件率被系统性压到 **9.89%**（标签实例 110 / 1112）。它同时解释了 I-01 / I-02 / I-18，也说明 **D-1 取证单的样本规模不能按「30 轮」拍脑袋定**（见 R4 的置信度复算）。

**阻断项**：无。但**必须先拍板 5 项**（见 §6），其中第 1 项（是否拆两段）决定后续一切。

---

## 2. 改动面清单

> 「D-1」= 取证单（零 core 改动）；「D-2」= 事件拆分单（改 core 联合与 delta 表，本单**只列不实施**）；「模型轨实现单」= 若主控选 D-1 一体化，则与取证同单落地。

| #   | 文件                                                                                 | 改动内容                                                                                   | 归属层        | 依据      | 归属单                                |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------- | --------- | ------------------------------------- |
| 1   | `scripts/ops/quality/<新脚本>.ts`                                                    | 逐轮抽取 + 规则轨判定投影 + 计数/比率表（只出码与比率）                                    | 脚本层        | R2 / R4   | **D-1**                               |
| 2   | `data/quality/<新文件>.csv`（或 `.jsonl`）                                           | 逐轮人工标注落点（场次 id / 轮次号 / 标签），**不入 DB**                                   | 数据层        | R2 / R8-4 | **D-1**                               |
| 3   | `src/engine-adapters/cognition/model-event-classifier.ts`（**新文件**）              | 模型轨 `EventClassifier` 实现；内部走 `CounselorLlmJsonClient.requestJson`；失败回落规则轨 | adapter 层    | R5        | 模型轨实现单                          |
| 4   | `src/engine-adapters/wiring/engine.providers.ts:244-250`                             | `createEngineSessionPort` 增一个可选 `classifier` 依赖并透传（缺省 = 不传 = 现状逐字不变） | adapter 层    | R5        | 模型轨实现单                          |
| 5   | `src/engine-adapters/wiring/engine.module.ts:354-365`                                | provider 侧按开关装规则轨 / 模型轨（灰度开关，**缺省规则轨**）                             | adapter 层    | R5 / R8-5 | 模型轨实现单                          |
| 6   | `src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.service.ts:87,162-163` | 第二处分类点必须**同源**（不能各跑各的分类器）                                             | adapter 层    | R1 / R8-2 | 模型轨实现单                          |
| 7   | `src/engine-adapters/deliberation/deliberation-input.ts:73,163`                      | 第三处（兜底分类）同样必须同源                                                             | adapter 层    | R1 / R8-2 | 模型轨实现单                          |
| 8   | `src/engine-core/domain/events/session-event.ts:13-24`                               | `CounselorEventKind` 联合加 2 个成员                                                       | **core 纯层** | R6        | **D-2**（需例外批准）                 |
| 9   | `src/engine-core/cognition/state-transition.ts`（DELTA_TABLE）                       | 2 行新事件 delta（方向与数值 **D-2 标定**）                                                | **core 纯层** | R6        | **D-2**（需例外批准）                 |
| 10  | `src/auto-practice/metrics/metric-dictionary.ts:66-79,84`                            | `TRACKED_EVENTS` 11 → 13 种；`POSITIVE_EVENTS` 口径同步                                    | 业务层        | R6 / R7   | **D-2**                               |
| 11  | `src/engine-core/domain/events/session-event.ts:36-38`                               | `ClassifyContext` 扩可选字段（来访上一轮 / 缺席轮数）—— **仅当主控选 L2 路径**             | **core 纯层** | R5 / R6   | 模型轨实现单（需例外批准 + D-6 评估） |
| 12  | `src/engine-core/domain/engine-session.types.ts:120-127`                             | `EngineTurnInput` 扩可选字段（承载 11 的数据）—— **仅当主控选 L2 路径**                    | **core 纯层** | R5 / R6   | 模型轨实现单（需例外批准 + D-6 评估） |
| 13  | `src/engine-core/in-memory/in-memory-engine-session.ts:400-402`                      | 把 11/12 的新上下文透传给 `classifier.classify`                                            | **core 纯层** | R5        | 模型轨实现单（需例外批准）            |

**断言影响（读源码判定，非推论）**：

- ①~⑤：扫 `src/engine-core` 全部文件的 AST（纯度）；**模型轨实现放 adapter → 不受影响**。
- ⑥（`boundary.spec.ts:220`）：比 `index.ts` 的**导出名**双向白名单（`expectedPublic` 从 `:249` 起；事件四名在 `:288-291`，`RuleBasedClassifier` 在 `:293`）。**扩 `CounselorEventKind` 的联合成员不新增导出名 → 绿**；新增具名类型别名并导出 → **红**。
- ⑦（`:454`）：core 文件清单双向（`missing` `:504-505` + `extra` `:518-519`）。**新增 core `.ts` 文件 → 红**；只扩已导出类型的字段 → **绿**。

---

## 3. R1–R8 逐项答复

### R1 规则轨不可达三点复核

**结论：三点全部成立；DOC-2 的表述偏保守（实际更严格）。**

**① 分类器只看咨询师本轮文本 —— 成立，且比 DOC-2 说的更强**

```ts
// src/engine-core/cognition/rule-based-classifier.ts:10
classify(text: string, context?: ClassifyContext): readonly SessionEvent[] {

// src/engine-core/domain/events/session-event.ts:4（文件头注释）
//   边界: 纯 TS. 事件分类只消费咨询师本轮文本, 不从来访输出反推 (避免循环论证).

// src/engine-core/domain/events/session-event.ts:36-38
export interface ClassifyContext {
  readonly sensitiveTopics?: readonly string[];
}

// src/engine-core/in-memory/in-memory-engine-session.ts:400-402（唯一生产调用点）
const events = this.classifier.classify(userText, {
  sensitiveTopics: runtime.characterProfile?.sensitiveTopics,
});
```

**新增证据（DOC-2 与任务单都没写到）**：访客文本**不是「被排除」，是「根本不进内核」** ——

- `EngineTurnInput` 只有 `userText`（咨询师本轮 ASR final）+ `traceId` + `signal`，**没有来访话语字段**（`engine-session.types.ts:120-127`）；
- 内核唯一的历史文本缓冲 `workingWindow` 只累积 `userText`：`in-memory-engine-session.ts:474-475` `trimWorkingWindow([...runtime.workingWindow, userText], ...)`；
- 访客回复在 `engine.turn` **返回之后**才生成：`practice-runner.service.ts:503` `await this.engine.turn(debugSessionId, counselorReply.text)` → `debug-turn-engine.adapter.ts:48` `runTurn(debugSessionId, counselorText)` 返回 `{ reply, trace }`。

> 推论：**「给模型轨补来访上一轮话语」不能靠扩 `ClassifyContext` 单独完成** —— 还得有人把数据送进内核（见 R5 的 L1 / L2 两条路）。这是本单最重要的新增结论。

**② 无跨轮状态 —— 成立**

- `RuleBasedClassifier`（`rule-based-classifier.ts:9`）**无任何实例字段**，`classify` 是纯函数（`:11-29` 全部依赖入参）；
- 调用方**持有轮次序列**：`runtime.turnIndex`（`in-memory-engine-session.ts:363`）、`runtime.workingWindow`（`:364`，只存文本不存事件标签）；
- **内核有「加私有状态」的合法位置**：`EngineSessionRuntime`（`in-memory-engine-session.ts:140`）是模块私有接口，加字段不导出 → 断言⑥⑦ 不受影响（DOC-2 A.4 的「内部运行时字段 ✅ 推荐路径」）；
- **⚠️ 新增工程发现（必须写进实施单）**：分类器实例由 `in-memory-engine-session.ts:325` `this.classifier = options.classifier ?? new RuleBasedClassifier()` **构造注入**，而 provider 是**模块级单例**（`engine.module.ts:354-365` 装配 `ENGINE_SESSION_PORT`）—— 若模型轨分类器**带状态**（记上一轮访客文本 / 连续缺席计数），**必须按 sessionId 分桶**，否则多会话并发会互相串状态。

**③ 词表无在场标记 —— 成立**

`event-lexicon.ts:22-59` 实测 **9 条规则 / 67 个词条**：5 正向（empathy 9 / acceptance 7 / normalization 7 / open_probe 8 / affirmation 7 = 38）+ 4 负向（judgment 7 / preaching 8 / minimizing 7 / boundary_cross 7 = 29）。逐条核实：**无一条是「在场标记」类**（既无承接语，也无结构性过渡语）。

**D-5 / G-4 子串重叠：成立，本单只登记**

```ts
// src/engine-core/domain/events/event-lexicon.ts:25（empathy）
terms: ['听起来你', '你觉得', '这种感受', ...]
// src/engine-core/domain/events/event-lexicon.ts:37（open_probe）
terms: ['能多说一点', '当时发生了什么', '你怎么看', '能详细说说', '再讲讲', '你觉得呢', ...]
```

子串包含匹配下 `'你觉得'` ⊂ `'你觉得呢'`。**实测在 1112 轮里命中 1 轮**（组合 `empathy+open_probe`，占 0.09%，见 §4）—— 登记为 D-5 / G-4，本单不修。

**R1 额外发现：分类器有 3 个调用点，只有一个是「生产真相」**

| #   | 位置                                                                                                             | 性质                                              | 风险                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------- |
| 1   | `in-memory-engine-session.ts:400`                                                                                | **生产真相**（内核出 `events`，delta 按它算）     | —                                                                     |
| 2   | `turn-delta-audit.service.ts:87` `new RuleBasedClassifier()` + `:162` `this.classifier.classify(input.userText)` | 审计服务**自己再跑一遍**，`:163` 再与内核事件合并 | **反双胞胎**：模型轨上线后这里仍是规则轨 → 审计标签与内核标签会不一致 |
| 3   | `deliberation-input.ts:73` `fallbackClassifier` + `:163` 兜底路径                                                | 审议侧兜底（内核没给 events 时）                  | 同上（注释已声明「适配层不另起一套预判」，但兜底事实上是第二套）      |

> 结论：**模型轨上线必须一次性收敛 3 处**，否则会出现「同一句话两套标签」—— `deliberation-input.ts:148-149` 的注释已经把这句话写死了（"同一句话两套标签 = 影子期的对比数据全废"）。

---

### R2 逐轮样本数据可抽取性

**结论：完全可抽取，且不需要跑批次、不需要重跑分类器。**

**落点（三个，逐层说明）**

| 层        | 位置                                                         | 内容                                                                                                                                                | 有无对话原文                            |
| --------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 文件      | `data/debug-sessions/{debugSessionId}.json`                  | `messages[]` = 咨询师 + 来访者逐轮原文 + 轮次号；`traces[]` = 逐轮内核快照 / delta / **事件标签**                                                   | **有**（双方原文）                      |
| DB 场次级 | `ap_practice_sessions`（`practice-session.entity.ts:84-91`） | `debug_session_id` / `character_slug` / `counselor_mode_id` / `turn_count` / 降级与成本列                                                           | **无**（`:14-15` 明写「不存对话原文」） |
| DB 轮次级 | `ap_practice_turns`（`practice-turn.entity.ts:44-113`）      | **只存来访者那半边**：`visitor_display_text` / `visitor_tts_text` / `visitor_semantic_json` / `visitor_semantic_level` / `visitor_semantic_version` | **有（仅来访者）**                      |

**关键不对称（任务单 §1.2 未点明）**：**DB 里没有咨询师逐轮文本**。`ap_practice_turns` 的 `visitor_` 前缀是**明写的反双胞胎纪律**（`practice-turn.entity.ts:26`）。咨询师那半边**只在 JSON 文件里**。因此抽取脚本的输入源只能是 JSON 文件（不能只查 DB）。

**JSON 的实际形状（实测键名，非推论）**

```
TOPKEYS: id,title,titleSource,characterSlug,characterLabel,createdAt,updatedAt,status,turnCount,messages,traces,kernelState,scenarioType
messages[]  (count=24)  ITEMKEYS: role,text,turnIndex,ts      ← role ∈ {counselor, visitor}
traces[]    (count=12)  ITEMKEYS: turnIndex,characterSlug,bdiSnapshot,delta,deltaDetail,intention,eventTags,eventTagLabels,renderSpec,llmUsage,crisis,degraded,deliberationTrace,ts
```

对应类型定义：`debug-session-store.ts:64-73`（`DebugSessionMessage`：`role` / `text` / `turnIndex` / `ts`）、`:78-119`（`DebugSessionRecord`）。`eventTags` = 事件 kind 字符串数组（如 `['neutral']`），`eventTagLabels` = 同序中文标签（如 `['中性表达']`）。

**⚠️ `eventTags` 是规则轨判定的逐轮落盘结果** → **取证不需要重跑分类器，也不存在「重跑口径漂移」的风险**。来源：`debug-session.service.ts:546` `const eventTags = result.events ?? []`（内核出参）。

**⚠️ `traces[].renderSpec` 含 prompt 全文**（`debug-session.service.ts:532` 明确带 `includePromptFull: true`）→ 抽取脚本**必须白名单取字段**，禁止整包透传。

**现有隐私安全抽取范式（直接抄）**

```ts
// src/auto-practice/metrics/batch-metrics.service.ts:109-125
function projectTraces(fileContent: string): TraceInput[] {
  ...
  // Phase3 P0: 台词判读在**本层**(IO 层)完成, 只把纯数值投影进 TraceInput.
  const visitorDisfluency = collectVisitorDisfluency(parsed);
```

`batch-metrics.compute.ts:204` 的注释就是范式说明：数据来源 = 逐字稿合规投影里的 `traces[].eventTags`（**只有事件标签, 不含对话原文**）。

**本地可用样本量（实测，只出计数）**

| 项                                  | 数字                                                |
| ----------------------------------- | --------------------------------------------------- |
| `data/debug-sessions/*.json` 文件数 | **96**（96/96 均含 traces）                         |
| 轮数（traces 数）                   | **1112**                                            |
| 咨询师消息数 / 来访者消息数         | **1112 / 1112**                                     |
| 事件标签实例总数                    | **1121**（单标签轮 1103 / 多标签轮 9 / 零标签轮 0） |

**30 场 / 30 轮口径可行性**

- **30 场**：✅ 可行，且**不必先跑新批次** —— 96 场现成，且含 `expert` / `cold` 双模式（`ap_practice_sessions.counselor_mode_id`）。
- **30 轮**：⚠️ **技术上可行，统计上无意义**（见 R4 的置信度复算）。

**`anchor-sample-30.csv` 能否复用为人工标注锚点 —— 不能（三条理由）**

1. **它是自动值，不是人工标注**：`quality-annotation.entity.ts:11-14` 明写 —— CSV 里的后三列（`first_exploration_turn` / `dominant_label` / `crisis_peak_level`）是审计脚本产出的**自动值**，不是人工标注，导入它们 = 破坏双盲；seed **只导身份三列**。
2. **零区分度**：实测 30 行 `dominant_label` **全部 = `neutral`**（30/30），`turns` 合计 338 → 8 个角色分布（`vpt_general_secure_l1` 6 / `vpt_depression_avoidant_l1` 7 / `vpt_social_anxious_l1` 5 / `vpt_trauma_disorganized_l1` 5 / `vpt_grief_avoidance_l1` 2 / `vpt_self_worth_intellectualization_l1` 2 / `vpt_intimate_avoidance_l1` 2 / `vpt_workplace_intellectualization_l1` 1）。它表达的是**全场的主导标签**，不是「这一轮是不是在场」。
3. **粒度不对**：场次级 → 无法做逐轮 precision / recall。

> 结论：**逐轮标注必须另建**。载体建议见 §6 待拍板项 4（现有标注台是**场次级**，唯一键 `debug_session_id`（`quality-annotation.entity.ts:33`），**装不下逐轮标注**）。

**隐私红线：抽取脚本字段过滤清单**

| 允许（可入文档 / 日志 / 报告）                                                                                                                                                              | 禁止（绝对不进）                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `debug_session_id`、`turnIndex`、`role`、`character_slug`、`counselor_mode_id`、`eventTags` / `eventTagLabels`、归一化字符数（如「咨询师本轮 ≤ 10 字」）、布尔标记（`degraded` / `crisis`） | **任何 `text` 原文**、`messages[].text`、`traces[].renderSpec`（含 prompt 全文）、`kernelState`、`title` / `characterLabel`（展示名） |

---

### R3 两类事件的临床标注口径（可操作定义）

**⚠️ 本节只定义「怎么分类」，不定义 delta 方向 / 数值 / 缺席轮数阈值**（全部留 D-2 标定）。

**`holding_present`（有效中性 / 稳定在场）**

- **判据**：① 本轮**没有**命中现有 5 类正向词事件；② 但**给出了一次可辨识的承接**（复述来访者刚说的某个点 / 明确下一步 / 稳定回应情绪）；③ 语气与在场一致（非敷衍）。
- **与 5 类正向事件的边界**：命中了 `empathy` / `acceptance` / `normalization` / `open_probe` / `affirmation` 任一 → **归该类，不归 `holding_present`**（避免一语双记）。`holding_present` 是「没命中但在场」的那一类。
- **构造样例（虚构，非真实逐字稿）**：
  - A（结构化过渡）：「我们先停在这里，等你想清楚再往下说。」
  - B（稳定回应）：「你刚才说的那件事，我听明白了。」
  - C（承接 + 留白）：「还有别的想说的吗？没有的话我们就聊下一段。」

**`cold_absent`（冷漠缺席）**

- **判据**：① 本轮**没有**命中任何现有词事件；② **没有给出可辨识的承接**（纯封闭回应 / 单字 / 纯应答 / 与来访者刚说的内容无关联）；③ 在**连续多轮**中反复如此（连续性是本类的必要属性，单轮不作数 —— 具体轮数阈值留 D-2 / 标定）。
- **与 4 类负向事件的边界**：`judgment` / `preaching` / `minimizing` / `boundary_cross` 是「**说了负向的话**」，`cold_absent` 是「**持续没给到在场回应**」。二者**不等同**：一句负向话本身就是负向事件（哪怕同时缺席）；`cold_absent` 不要求说出任何负向内容。
- **构造样例（虚构，非真实逐字稿）**：
  - A（单字封闭）：「嗯。」
  - B（封闭应答）：「行吧。」
  - C（纯流程推进、无承接）：「下一个。」

**歧义样例处理规则**

| 情形                           | 规则                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------- |
| 短句但确有承接                 | 归 `holding_present` —— **短不是缺席的判据**，承接才是                            |
| 短句且无承接                   | 候选 `cold_absent`；**需看连续性**，单轮不下结论                                  |
| 同时命中正向词事件与「像缺席」 | 归**已命中的正向类**（词事件优先），不双记                                        |
| 咨询师侧**降级兜底轮**         | **剔除，不标注**（见下）                                                          |
| 咨询师本轮为空                 | 内核直接抛 `INVALID_INPUT`（`in-memory-engine-session.ts:387-389`），不会进分类器 |

**⚠️ 必须剔除的混淆源：降级兜底轮**

上游 429 / 超时 / 空回复时，咨询师侧走固定兜底话术（`practice-session.entity.ts:320-323` 登记的固定模板 `FALLBACK_REPLY`）。这类轮次：

- 规则轨必然判 `neutral`（兜底句不命中 9 条规则）；
- 人眼极可能判成「在场」（它是一句应答）；
- **它不是咨询师的行为**，是系统故障。

> 标注与统计**必须先按 `traces[].degraded` / `ap_practice_sessions.counselor_degraded_turns` 过滤降级轮**，否则测的是故障兜底，不是咨询师在场。

**`neutral` 在两类拆分后是保留还是收敛（选项与取舍，本项不拍板）**

| 选项                                    | 做法                           | 取舍                                                                                                                                |
| --------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| A. 保留 `neutral` 作第三类              | 拆分后仍是三分类               | 兼容现有事件分布口径；但 `neutral` 仍是「垃圾桶」，新 kind 的 delta 若留 0 就等于没拆                                               |
| B. `neutral` 收敛为「两类都不是」       | 只在两类都不成立时才落 neutral | 语义干净；但**规则轨永远给不出两类**（R1 ①②③）→ 收敛后规则轨产出全塌成两类，等于规则轨退役                                          |
| C. `neutral` 保留但降级为「未分类」标记 | 语义上不再是事件，只是占位     | 影响最小；但要同步改 `metric-dictionary.ts` 的 `TRACKED_EVENTS` 与 `hasNonNeutralEvent`（`batch-metrics.compute.ts:208-214`）的语义 |

> 取舍要点：**A 与 C 都要求 `neutral` 仍是一个合法 kind**（→ D-2 改 core 联合）；**B 意味着规则轨不能作为生产轨**（→ 模型轨必须先到位，灰度期无规则轨兜底）。这直接决定 §6 第 5 项。

---

### R4 漏判 / 误判率口径与样本规模

**结论：口径可以定，但「30 轮」这个样本规模在统计上不成立；且逐类别比例在现有语料上不可估。**

**① 实测基线（本地 96 场 / 1112 轮，只出计数与比率）**

| 事件标签             | 标签实例数 | 占 1112 轮 |
| -------------------- | ---------- | ---------- |
| `neutral`            | **994**    | **89.39%** |
| `empathy`            | 92         | 8.27%      |
| `acceptance`         | 14         | 1.26%      |
| `sensitive_touch`    | 6          | 0.54%      |
| `minimizing`         | 5          | 0.45%      |
| `preaching`          | 4          | 0.36%      |
| `judgment`           | 2          | 0.18%      |
| `normalization`      | 2          | 0.18%      |
| `open_probe`         | 2          | 0.18%      |
| `affirmation`        | 0          | 0%         |
| `boundary_cross`     | 0          | 0%         |
| **正向标签实例合计** | **110**    | **9.89%**  |
| **负向标签实例合计** | **11**     | **0.99%**  |

> **`neutral` 误吞上界 = 89.39%**（每一条 neutral 轮次都可能是漏判）。这是本次预研最硬的一个数字，也是「为什么必须上模型轨」的量化依据。

**多标签轮分布（9 轮 / 1112）**：`empathy+minimizing` 3、`empathy+preaching` 2、`empathy+sensitive_touch` 2、`acceptance+empathy` 1、**`empathy+open_probe` 1**（← G-4 子串重叠的现场证据，0.09%）。

**② 口径定义（建议）**

- **分析单元 = 轮**（不是事件）：delta 按轮聚合（`state-transition.ts:386-400`），轮是最小可比单元；一轮可命中多个标签。
- **对照双方**：规则轨判定（`traces[].eventTags`，引擎当时判的，**不是重跑**） vs 人工标注（逐轮）。
- **逐类指标**：`precision = 规则轨判为 K 且人工也判 K 的轮数 / 规则轨判为 K 的轮数`；`recall = 两者都为 K 的轮数 / 人工判为 K 的轮数`。多标签时按「每轮每类」展开，不做轮级互斥分配。
- **`neutral` 误吞率（头号指标，单独报，不混进 precision/recall）**：
  - `漏正向` = 人工判 `holding_present` 而规则轨判 `neutral` 的轮数 / 人工判 `holding_present` 的轮数；
  - `漏负向` = 人工判 `cold_absent` 而规则轨判 `neutral` 的轮数 / 人工判 `cold_absent` 的轮数；
  - **两者必须分开统计**：前者是「该给的增益没给」，后者是「该记的代价没记」—— 临床含义相反，合并成一个数会掩盖方向。
- **分母必须先剔除降级轮**（R3 的兜底轮污染）。

**③ 样本规模评估（标准公式复算，非实测）**

| 目标                            | n       | 95% CI 半宽 / 上界                                                               | 判定                            |
| ------------------------------- | ------- | -------------------------------------------------------------------------------- | ------------------------------- |
| 估 `neutral` 比例（p=0.894）    | 30 轮   | **±11.0pp**                                                                      | ❌ **不可用**（比样本本身还宽） |
| 估 `neutral` 比例（全量）       | 1112 轮 | **±1.81pp**                                                                      | ✅ 可用                         |
| 估 `acceptance` 比例（p=1.26%） | 30 轮   | 期望命中 **0.38 条**；Wilson 95% 上界 ≈ **11.4%**（0 命中）/ **16.7%**（1 命中） | ❌ **不可估**                   |
| 估 `acceptance` 比例（全量）    | 1112 轮 | 期望 14 条；Wilson 95% 半宽 ≈ ±1.0pp                                             | ✅ 勉强可用                     |
| 估 `cold_absent` 比例           | 30 轮   | 期望命中 ≈ 0（该类当前**根本产不出来**）                                         | ❌ **恒为 0**，规则轨无该类可测 |

> **结论**：**逐类别比例在现有语料上不可估**（稀有类 + 规则轨根本不产 `cold_absent`）。正确做法：**① 对人工标注样本做穷举点估计（per-kind precision / recall + 精确区间）；② 总体「neutral 误吞上界」用计数比表达**（如「人工标注的 30 轮里 27 轮被规则轨判为 neutral」）。

**④ 最小补样建议**

- **优先 cold 模式**：cold 的设计意图就是测缺席，其轮次是 `holding_present` / `cold_absent` 的富集区；抽样按 `counselor_mode_id` 分层，**cold 场优先**。
- **优先中后段轮次**：缺席是**连续性**属性，只有中后段才可能出现连续多轮缺席；首轮必然是建立契约的一轮。
- **不必先跑新批次**：本地 96 场已含双模式，直接分层抽样即可；**只有当 cold 场轮数不足以凑够样本时才补跑**（补跑属批次动作，不在本预研范围）。
- **降级轮不计入样本**（且要单独报降级率，否则样本量会被悄悄稀释）。

**⑤ 离线对比脚本（位置与形态）**

- **位置**：`scripts/ops/quality/`（既有 6 个脚本：`visitor-quality-lexicon.ts` / `visitor-quality-audit.ts` / `seed-verbal-voice.ts` / `phase25-verify-17-22-2026-11-12.ts` / `enqueue-r3-intake-16.ts` / `enqueue-p4-batch.ts`）。
- **输入**：`data/debug-sessions/*.json`（**白名单取字段**）+ 逐轮人工标注文件。
- **输出**：**只有计数与比率表**（按模式 / 角色 / 轮次段分层），**零原文**；风格与 `batch-metrics.compute.ts` 一致（`event.<kind>.count` / `event.<kind>.rate`）。

---

### R5 模型轨分类器落地形态与复用点

**结论：归属 adapter 层，可零 core 改动接入；有现成范式。但存在一个硬约束 —— 现有 `EventClassifier` 是同步接口，模型轨必须异步。**

**① 归属层与注入缝（core 侧已有缝，装配层一直没插）**

- `EventClassifier`（`session-event.ts:45-47`）是 core 已导出的**端口**（`engine-core/index.ts:50` `export type { ClassifyContext, CounselorEventKind, EventClassifier, SessionEvent }`）。
- 模型轨实现必须放 `src/engine-adapters/`（有 IO）—— `conventions.md` §1.1 明令 LLM 调用禁止进 engine-core。
- **注入缝已存在**：`InMemoryEngineSessionOptions.classifier?`（`in-memory-engine-session.ts:191-192`，注释「事件分类器 (可注入替换规则轨; 默认 RuleBasedClassifier)」）+ `:325` `this.classifier = options.classifier ?? new RuleBasedClassifier()`。
- **装配层当前没插**：grep `classifier` 在 `engine.module.ts` **0 命中**；`engine.providers.ts:244-250` 的 `new InMemoryEngineSession({ ... })` 里**没有** classifier 键 → **接入点 = `engine.providers.ts` 加一个可选依赖 + `engine.module.ts:354-365` 的 provider 侧按开关装**（缺省不传 = 行为逐字不变）。

**② LLM 复用（结构化输出只有一条链，且 engine-adapters 已有先例）**

- 唯一通道：`CounselorLlmJsonClient.requestJson`（`llm-json.client.ts:129`）。请求形状 = `systemPrompt` + `schemaDescription`（client 在 `:134` 把它拼到 system 尾部）+ `userPrompt`；返回 `{ ok, data, rawText, errorCode, errorMessage, usage }`，**不抛异常**（`:126-127`）。
- **engine-adapters 已有先例**：`llm-deliberation.service.ts:202` `import { CounselorLlmJsonClient } from '../../counselor/providers/llm-json.client.js'`；`:43-48` 明写三条反双胞胎纪律（不自己拼 schemaDescription / 不自己解析 JSON / 不自己写 LLM 请求）。→ **模型轨分类器照抄这个形状即可，不引第二套 client**。
- **最贴近的先例**：`turn-analysis.service.ts:116-132` —— 一次 LLM 出三段，输入含 `counselorText` + `visitorText` + `recentTurns`（`:99-112` 从 transcript 里取「来访这一轮之前的最后一句咨询师发言」+ 最近 4 轮），失败不抛（`:134-138` 只 warn + 记 errorCode）。**这就是 D-1 模型轨分类器的模板**：输入形状几乎一致。

**③ 分类器输入可得性**

| 需要的输入           | 在哪一层可得                                                                         | 证据                                  |
| -------------------- | ------------------------------------------------------------------------------------ | ------------------------------------- |
| 咨询师本轮文本       | ✅ 内核 `userText` 直接有                                                            | `engine-session.types.ts:121-122`     |
| 来访者上一轮话语     | ❌ 不在内核；✅ 在 adapter（runner / debug-session 手里有上一轮 visitor reply）      | R1 ①                                  |
| 最近 N 轮上下文      | ⚠️ 内核只有 `workingWindow`（纯文本，可拿）                                          | `in-memory-engine-session.ts:474-475` |
| 连续缺席轮数         | ⚠️ 内核有 `turnIndex` + `workingWindow`，但**没有事件标签** → 算不出「连续 neutral」 | `:363-364`                            |
| `strength`（置信度） | ✅ 字段已预留                                                                        | `session-event.ts:31-32`              |

**④ ⚠️ 硬约束：同步接口 vs 异步 LLM（本单新发现，比「访客上下文拿不到」更硬）**

```ts
// src/engine-core/domain/events/session-event.ts:45-47
export interface EventClassifier {
  classify(text: string, context?: ClassifyContext): readonly SessionEvent[];
}

// src/engine-core/in-memory/in-memory-engine-session.ts:400-402 → 下一行 :406 立刻用它
const events = this.classifier.classify(userText, { sensitiveTopics: ... });
```

`classify` 是**同步**的，而模型轨必须 await 一次 LLM。三条出路：

| 路径          | 做法                                                                           | 代价                                                                    |
| ------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| **E（建议）** | 在 `EventClassifier` 上加**可选**异步方法，内核有则 await、无则走同步 classify | 改 1 个 core 文件（已导出接口扩可选成员 → 断言⑥⑦ **绿**），但需例外批准 |
| A             | 把接口签名改成 `Promise<...>`                                                  | **破坏性**：所有实现 + 3 个调用点全改，core 改动面最大                  |
| D             | 模型轨不进内核，只在 adapter 侧影子跑                                          | 零 core 改动，但**产不出驱动 delta 的两类事件** → D-2 前提不成立        |

（C 方案「adapter 预分类后注入内核」需要内核改为接受外部事件，比 A 还重，且制造双源。）

**⑤ 两条上下文供给路径**

- **L1（零 core 改动）**：模型轨分类器实现放 adapter，**自己持有按 sessionId 分桶的上下文**（上一轮访客文本 / 连续 neutral 计数），由调用方在 `engine.turn` 之前写入。代价：写上下文与内核调用必须严格配对（并发 / 中断轮 / 绕过 `engine-turn.service` 的调用路径都可能写脏状态）；且要求**所有 `engine.turn` 调用点都经过同一门面**（开工单须逐点核：`practice-runner.service.ts:503` / `debug-session.service.ts:532` / voice 侧）。
- **L2（扩 core 可选字段）**：`EngineTurnInput` 加可选字段 → `in-memory-engine-session.ts:400-402` 透传 → `ClassifyContext` 加可选字段。代价：改 3 个 core 文件（需例外批准），且「连续缺席轮数」仍要在某处维护（core `EngineSessionRuntime` 私有字段，或 adapter 侧算好直接传）。

**⑥ 回退路径**

- 模型轨 LLM 失败 / 超时 / schema 校验失败 → **回落规则轨**（`RuleBasedClassifier`），且回落结果必须**逐字等价于规则轨**（否则同一句话两套 delta）。
- 错误码词表（`llm-deliberation.service.ts:438-441` 登记的 client 真实错误码）：`json_not_found` / `json_parse_failed` / `schema_validation_failed` + 上游透传（`http_401` / `http_429` / `http_500` / `no_body` / `parse_error` / `fetch_error`）。
- 观测口径：**只出 errorCode + 计数**，不出原文（隐私红线）。

---

### R6 接口形状与边界断言影响（读 boundary 源码判定，非推论）

**结论：D-1 取证阶段零 core 改动 → 断言⑥⑦ 完全不受影响；D-2 扩 core 联合仍**不触发**断言⑥；只有「新增具名导出 / 新增 core 文件」才触发 → 属 D-6 授权范围。**

**断言源码事实**

- 断言⑥（`boundary.spec.ts:220-452`）：用 AST 读 `index.ts` 的**导出声明**（`:229-238` 收集 `element.name.text`），再与 `expectedPublic`（清单从 `:249` 起）双向比对（`:451` 多导出检查）。事件相关四个名字在 `:288-291`（`ClassifyContext` / `CounselorEventKind` / `EventClassifier` / `SessionEvent`），`:293` `RuleBasedClassifier`（WP58 例外公开面）。
- 断言⑦（`:454-520`）：core 文件清单双向 —— `missing`（`:504-505`）+ `extra`（`:518-519`，错误信息明写「新增内核文件必须同步登记到本清单」）。清单含 `domain/events/session-event.ts`（`:467`）、`domain/events/event-lexicon.ts`（`:468`）、`cognition/rule-based-classifier.ts`（`:477`）。

**逐项判定**

| 想做的事                                          | 断言⑥  | 断言⑦  | 依据                                      |
| ------------------------------------------------- | ------ | ------ | ----------------------------------------- |
| 模型轨实现放 `src/engine-adapters/` 新文件        | 绿     | 绿     | 断言只扫 KERNEL_ROOT（`src/engine-core`） |
| 扩 `CounselorEventKind` 联合加 2 个成员（D-2）    | 绿     | 绿     | 断言⑥ 比的是**导出名**，不是类型成员      |
| 扩 `ClassifyContext` 加可选字段（L2）             | 绿     | 绿     | 已导出类型的字段扩展                      |
| 扩 `EventClassifier` 加**可选**异步方法（E 路径） | 绿     | 绿     | 同上（方法签名变更需特别评审）            |
| 新增具名类型别名并从 barrel 导出                  | **红** | 绿     | `:451` 多导出检查                         |
| 新增 core `.ts` 文件                              | 绿     | **红** | `:518-519` extra 检查                     |
| 改 `boundary.spec.ts` 本身                        | —      | —      | **本批禁止**；确需时走 D-6 授权           |

**D-1 阶段允许触碰 / 禁止触碰**

- **允许**：`scripts/ops/quality/**`、`data/quality/**`、`docs/**`、`test/**`（**新增** spec，不改 `boundary.spec.ts`）；若主控选一体化，另加 `src/engine-adapters/**`。
- **禁止**：`src/engine-core/**`（除非开工单例外批准）、`test/engine-core/boundary.spec.ts`、env / `.env.example` / migration / DB / 前端。
- **与 D-2 的切分点再确认**：**新 kind 进 core 联合 = D-2**；D-1 只负责「拿到数据 + 钉死漏判率」，**不得**把新 kind 塞进 core。

---

### R7 既有基线与测试策略

**基线（本次实测，只读）**

- `pnpm exec vitest run test/engine-core` → exit 0，**22 文件 / 446 例全绿**，Duration 4.21s。
- core spec 文件 **22** 个。
- 事件相关 spec **6** 个：`wp60-delta-table-config` / `boundary` / `wp5-rendering` / `wp3-trajectory` / `wp4-safety` / `wp26-delta-cap-injection`。
- **⚠️ 规则轨分类器没有专属 spec**：`classify` 的直接断言只出现在 `test/engine-adapters/wp58-turn-delta-audit.spec.ts:170-171`；core 侧只有 `wp1-bdi.spec.ts:41`（'neutral 文本不改变状态, 首轮即为中性默认基线'）间接覆盖。
  → **D-1 / D-2 开工单必须自带「规则轨基线快照」用例**（DOC-2 §4.2 回归风险已点名「须先建旧分类器逐字快照基线」）：固定语料 → 逐字事件序列，作为改动后的零回归锚。

**`strength = 1` 假设的锁定面（只评估影响面，不改断言）**

- **构造件**（14 处用 `strength: 1` 造事件，非断言）：`i20-valence-arousal-role-coefficients` / `wp3-trajectory` / `wp15-delta-cap` / `wp60-delta-table-config` / `wp57-belief-layer` / `wp53-personality-alliance-extension` / `wp42-alliance-three-dimensions` / `wp34-personality-modulator` / `wp49-character-five-factor-personality` 等。
- **真正的断言只有 1 处**：`test/engine-adapters/wp58-turn-delta-audit.spec.ts:171` `expect(row.eventDetails[0]?.strength).toBe(1)` —— 规则轨审计路径，规则轨恒 1 成立。
- **⚠️ 关键机制**：`strength` **直接乘进每一个 delta 维度**：

```ts
// src/engine-core/cognition/state-transition.ts:389-400
const strength = clamp01(event.strength);
sum.trust += delta.trust * strength;
sum.safety += delta.safety * strength;
... // 共 12 个维度逐一相乘
```

→ **模型轨返回非 1 的 strength 会按比例缩放本轮 delta**，即**行为改变，不是影子**。
→ 因此模型轨**第一版必须返回 strength = 1**（或先做只观测不写状态的影子轨），否则第一次灰度就会改数值。
→ 这也回答了 R5 的「strength 作为置信度」可行性：**字段可用，但第一版不能用**。

**模型轨离线测试策略**

- mock `CounselorLlmJsonClient.requestJson`（返回 `{ ok: true, data: fixture }`），不打真模型、不依赖网络。
- fixture 组织：按 kind × 边界（命中正向 / 命中负向 / neutral→holding_present / neutral→cold_absent / 多标签 / 低置信）建最小集；**fixture 只放构造样例**（R3 的 A/B/C），不得放真实逐字稿（隐私 + 双盲）。
- 跨轮状态测试点：连续 neutral 计数递增 / 断连后重置 / **多会话隔离**（sessionId 分桶不串）。
- 回退路径测试点：每个错误码各一条（`json_not_found` / `json_parse_failed` / `schema_validation_failed` / `http_429` / 超时）→ 断言**逐字回落规则轨**且只出 errorCode 不出原文。
- 同源收敛测试点：注入模型轨后，审计层（`turn-delta-audit`）与审议层（`deliberation-input`）拿到的标签必须与内核一致（R1 的 3 个调用点）。

---

### R8 风险与待主控拍板项

**风险表**

| #   | 角度           | 风险                                                        | 影响                                                                        | 缓解 / 备注                                                                           |
| --- | -------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A   | 类型契约       | **同步 `EventClassifier` 与异步 LLM 调用形状冲突**          | 模型轨无法直接实现该接口；轻则 core 接口签名破坏性变更，重则 D-2 前提不成立 | 三条出路见 R5 ④；建议 E 路径（扩可选异步方法，断言⑥⑦ 绿）+ 例外批准                   |
| B   | 工程纪律       | **反双胞胎**：分类器有 3 个调用点（内核 / 审计 / 审议兜底） | 模型轨上线后出现两套标签，影子对比数据全废                                  | 实施单必须一次性收敛 3 处；审计层改为复用内核事件而非自己分类                         |
| C   | 工程纪律       | **带状态分类器 + 模块级单例 provider**                      | 多会话并发串状态（跨场泄露心理内容）                                        | 按 sessionId 分桶，或改成无状态设计（上下文全部走入参）                               |
| D   | 临床语义       | `neutral` 拆分口径未定（保留 / 收敛 / 降级为未分类）        | 影响 D-2 的 delta 表形状与指标字典                                          | §6 第 2 项拍板；本单只列取舍                                                          |
| E   | 临床语义       | `holding_present` / `cold_absent` 的连续性阈值未定          | 单轮无法判定缺席 → 人工标注一致性差                                         | 阈值留 D-2 标定；标注阶段先只标单轮可判项 + 连续段另标                                |
| F   | 测试覆盖       | 规则轨分类器无专属 spec                                     | 改分类器没有回归锚                                                          | D-1 取证单先固化「规则轨逐字基线快照」spec                                            |
| G   | 测试覆盖       | `strength` 参与 delta 缩放（`state-transition.ts:389-400`） | 模型轨返回非 1 会静默改数值                                                 | 第一版强制 strength = 1；或先做只观测不写状态的影子轨                                 |
| H   | LLM 成本与 429 | 模型轨 = **每轮一次** LLM 请求（1112 轮 ≈ 1112 次）         | 成本与限流压力远高于现有每场/每报告类调用                                   | 必带灰度开关 + 回落；吞吐与 429 率需实测（属批次动作，另案）                          |
| I   | 隐私           | 模型轨会把**心理对话原文**送进 LLM                          | 既有先例（`turn-analysis`）已这么做，但事件分类是**每轮都送**               | 送前最小化（只送本轮咨询师文本 + 必要上下文）；日志只出码；抽样数据不入版本库         |
| J   | 证据有效性     | `eventTags` 是**当时**引擎判的；引擎改过则口径漂移          | 用旧批次数据评估新口径                                                      | 取证只针对**规则轨**（口径未变则安全）；用 `engine_version` / `prompt_version` 列核对 |
| K   | 抽样           | 降级轮混入样本                                              | 测的是故障兜底而非咨询师行为                                                | 统计前先按 `degraded` 过滤，并单独报降级率                                            |

---

## 4. 取证口径表

| 项                       | 口径                                                                                                                                                                                                                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **抽样维度**             | 主维度：`counselor_mode_id`（`expert` / `cold`，**cold 优先**）→ `character_slug`（8 角色）→ **轮次段**（首轮 / 中段 / 尾段；缺席连续性只在尾段可见）。次维度：`degraded`（先剔除）。                                                                                                              |
| **样本来源**             | `data/debug-sessions/*.json`（实测 96 份 / 1112 轮，含 `messages[]` 双方原文 + `traces[].eventTags` 规则轨判定）；场次元数据在 `ap_practice_sessions`（`counselor_mode_id` / `character_slug` / `turn_count` / `counselor_degraded_turns`）。**不跑批次、不调 LLM 即可取证**。                     |
| **分析单元**             | 轮（`turnIndex`）。一轮可命中多标签；不做轮级互斥分配。                                                                                                                                                                                                                                            |
| **对照双方**             | 规则轨：`traces[].eventTags`（引擎当时判的，**不重跑**）；人工：逐轮标注文件。                                                                                                                                                                                                                     |
| **指标定义**             | `precision_k` / `recall_k`（按 kind 展开）；`neutral` 误吞率**分两向**：`漏正向`（holding_present 被吞）、`漏负向`（cold_absent 被吞）；`neutral` 误吞**上界** = neutral 轮数 / 总轮数（实测 89.39%）。                                                                                            |
| **样本规模**             | 「30 轮」在统计上不可用（见 R4 ③）。建议按模式分层 + 富集 cold 场 + 尾段优先；**先剔除降级轮**；若最终样本仍不足，结论用「计数比 + 精确区间」表达，不用点估计。                                                                                                                                    |
| **字段过滤清单（隐私）** | **允许**：`debug_session_id`、`turnIndex`、`role`、`character_slug`、`counselor_mode_id`、`eventTags` / `eventTagLabels`、归一化字符数、布尔（`degraded` / `crisis`）。**禁止**：`messages[].text`、`traces[].renderSpec`（含 prompt 全文）、`kernelState`、`title` / `characterLabel`（展示名）。 |
| **标注载体建议**         | 离线文件（`data/quality/` 下 CSV / JSONL），**不入 DB**（现有标注台 `quality_annotation` 是**场次级**，唯一键 `debug_session_id`，装不下逐轮；改表 = 改 migration + 双盲纪律冲突）。                                                                                                               |

---

## 5. 风险表

> 与 §3 的 R8 风险表同源，此处按「影响面 → 缓解 → 归属单」重排，便于排期。风险项 A–K 的完整论证见 R8。

| 风险                      | 影响面                   | 缓解                                         | 归属单       |
| ------------------------- | ------------------------ | -------------------------------------------- | ------------ |
| **A 同步/异步形状冲突**   | 模型轨接口落地           | 拍板 E / A / D 三条路径之一（§6 第 1、3 项） | 模型轨实现单 |
| **B 三处分类点不同源**    | 审计 / 审议标签漂移      | 实施单一次性收敛 3 处                        | 模型轨实现单 |
| **C 带状态分类器串场**    | 跨场泄露                 | 按 sessionId 分桶或改无状态                  | 模型轨实现单 |
| **D/E 口径未定**          | D-2 delta 表与标注一致性 | §6 第 2 项 + D-2 标定                        | D-2          |
| **F 无回归锚**            | 改分类器无护栏           | D-1 先固化规则轨基线快照 spec                | **D-1**      |
| **G strength 缩放 delta** | 首次灰度即改数值         | 第一版 strength 恒 1                         | 模型轨实现单 |
| **H 成本与 429**          | 每轮一次 LLM             | 灰度开关 + 回落 + 限流                       | 模型轨实现单 |
| **I 原文送 LLM**          | 隐私                     | 最小化 + 只出码                              | 模型轨实现单 |
| **J 口径漂移**            | 证据有效性               | 用 `engine_version` / `prompt_version` 核对  | **D-1**      |
| **K 降级轮污染**          | 统计失真                 | 统计前过滤 + 单独报降级率                    | **D-1**      |

---

## 6. 待拍板项（5 项，本单不替用户决定）

**① D-1 是否拆两段**

- 选项 1：**先只读取证单**（钉漏判率，零 core 改动、零 LLM），复核通过后再派模型轨实现单。
- 选项 2：取证 + 模型轨实现一体单。
- **取舍**：选项 2 更快拿到模型轨，但**接口同步/异步形状问题（风险 A）未解**，且取证结论未复核就改装配层 → 出错成本高；选项 1 多一个来回，但取证结论本身就是 D-2 的前置（草案 §6 顺序：D-1 → D-2 → D-3 不可反）。

**② 两类新 kind 在 D-1 阶段的类型形态**

- 选项 1：adapter 层自定义扩展类型（不改 core 联合），D-2 再收编进 core。
- 选项 2：等 D-2 改 core 联合，D-1 不产出类型。
- **取舍**：选项 1 允许模型轨先跑通并出对照数据；代价是「临时类型」与「最终类型」两份形态（**反双胞胎风险**：临时类型若被下游消费，D-2 改联合时要同步改消费方）。选项 2 类型干净，但模型轨在 D-1 阶段无处安放结果。

**③ 跨轮缺席判据所需上下文是否要求扩 core `ClassifyContext`**

- 选项 1（L1）：不扩 core，adapter 侧按 sessionId 维护上下文，分类器自持。
- 选项 2（L2）：扩 `EngineTurnInput` + `ClassifyContext` 可选字段（3 个 core 文件，需例外批准 + D-6 评估）。
- **取舍**：L1 零 core 改动，但要求「所有 `engine.turn` 调用点都经过同一 adapter 门面」（需逐点核）；L2 干净但要动 core，**且同步/异步问题依然要解**（风险 A 与本项独立，需一并拍板）。

**④ 逐轮人工标注由谁完成**

- 选项 1：主 AI 离线对照（用既有逐字稿 + 构造规则）。
- 选项 2：走标注台 —— **但现有标注台是场次级**（唯一键 `debug_session_id`），**装不下逐轮** → 需扩表或另建逐轮表（改 DB / migration）。
- 选项 3：大炮本人标注（最准，成本最高）。
- **取舍 + 前置**：实测 `neutral` 率 89.39%，**逐轮抽 30 条在统计上不可用**（R4 ③）→ 任一选项都要重新定样本规模（建议按模式分层 + 富集 cold 尾段），并**先剔除降级轮**。**建议载体是离线文件（`data/quality/`），不入 DB**（避开迁移与双盲纪律冲突）。

**⑤ 模型轨与规则轨并存期的默认轨与灰度口径**

- 选项 1：默认规则轨，模型轨仅影子（只观测、不写状态、不影响 delta）→ 零行为风险，但**D-2 的前提（能产出驱动 delta 的两类事件）不成立**。
- 选项 2：按会话名单灰度（沿用仓库既有 modeConfig 范式，`engine.module.ts:318-332` 的启动期求值 + 名单做法）。
- 选项 3：默认模型轨、失败回落规则轨。
- **取舍**：选项 3 一旦模型轨质量不足会直接改数值（受风险 G 影响）；选项 2 与仓库既有灰度机制同构，代价是需要名单与观测口径。

---

## 7. 建议开工步骤

**若主控选「拆两段」（建议）**

**第 1 步 · 取证单（零 core 改动、零 LLM、零批次）**

1. 新建 `scripts/ops/quality/<脚本>.ts`：白名单投影 96 份逐字稿 → 逐轮 CSV（`debug_session_id, counselor_mode_id, character_slug, turn_index, character_len_bucket, event_tags, degraded`），**只出计数与比率**。
2. 新建规则轨**基线快照 spec**：固定语料 → 逐字事件序列，锁住旧口径（补上 F 风险缺口）。
3. 建逐轮标注文件（载体见 §6 第 4 项）+ 抽样表（模式分层 + cold 尾段优先 + 剔除降级轮）。
4. 产出漏判率报告：`neutral` 误吞率（分漏正向 / 漏负向）+ per-kind precision/recall + 精确区间。
5. 跑 §8 闸门 → 写交付记录 → 回写台账 I-01 / I-02 / I-18 与结构债草案 §4.2。

**第 2 步 · 模型轨实现单（复核通过后派）**

6. **先定接口形状**（§6 第 1 / 3 项 + 风险 A），再写代码。
7. 收敛 3 个分类调用点（风险 B）。
8. 影子轨 + 灰度开关 + 回落 + 观测（只出码）。

**若主控选「一体」**：把第 1 步的 1~5 作为**同一单的前置子步骤**，但**第 6 步的接口形状必须在写代码前定**，否则必然返工。

**应补 spec 用例清单（若一体化）**

- 模型轨 fixture 分类：命中正向 / 命中负向 / neutral→holding_present / neutral→cold_absent / 多标签 / 低置信。
- 回退：每个错误码一条 → 断言**逐字回落规则轨**且只出 errorCode 不出原文。
- 跨轮：连续计数递增 / 断连重置 / **多会话隔离**。
- 同源收敛：审计层与审议层标签 == 内核标签。
- `strength` 恒 1（第一版）。
- 零回归：旧规则轨 spec 全绿 + boundary 12 绿 + `git diff --stat HEAD -- src/engine-core` 符合例外批准范围。

---

## 8. 闸门建议

| #   | 闸门            | 命令                                                                    | 判据                                                                                                                                                               |
| --- | --------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 类型（src）     | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | 0 error                                                                                                                                                            |
| 2   | 类型（含 spec） | `pnpm exec tsc -p tsconfig.json --noEmit --types 'node,vitest/globals'` | **本单相关文件 0 error**（既有债另计；⚠️ 不带 `--types` 的原建议命令在本仓必然 exit 2 —— 根 tsconfig 的 `types:['node']` 无 vitest globals，见 S-1 交付记录 §2.4） |
| 3   | Lint            | `pnpm lint`                                                             | 0 error                                                                                                                                                            |
| 4   | 定向测试        | `pnpm exec vitest run test/engine-core test/engine-adapters`            | 全绿；**用例数 = 基线 + 新增，零丢失**（本次实测基线：core **22 文件 / 446 例**；core+adapters 基线见 S-1 交付记录）                                               |
| 5   | 边界            | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | 12 例全绿                                                                                                                                                          |
| 6   | 全量            | `pnpm test`                                                             | 全绿                                                                                                                                                               |
| 7   | core 变更面     | `git diff --stat HEAD -- src/engine-core`                               | **取证单必须为空**；模型轨实现单若走 L2 / E 路径则逐文件列出并附例外批准                                                                                           |
| 8   | 隐私自检        | 抽取脚本与报告人工过一遍                                                | **无任何原文、无 prompt 全文、无展示名**；只有码 / 计数 / 比率                                                                                                     |

**机器状态（本次预研实测环境，开工单须带同类信息）**：Windows 11 Home China 10.0.26300 64-bit；Intel Core i7-8550U @ 1.80GHz；15.9 GB RAM；Node v26.13.0；PowerShell 5.1.26100.9818；pnpm。**无 nest / vite 常驻进程**（进程扫描仅命中本次 vitest 自身，非常驻服务）。

**墙钟参考**：core 定向 vitest Duration 4.21s；全量 `pnpm test` 约 93~96s（以实测为准；闸门表应记**墙钟**而非 Duration，并注明是否有长驻进程与盘读取延迟）。

---

## 附录 · 本单用到的只读取证命令（可复现）

```powershell
# 规则轨 / 事件类型 / 词表
rg -n 'classify|RuleBasedClassifier|EventClassifier' src test

# 调用链与跨轮状态
rg -n 'workingWindow|turnIndex|classifier' src/engine-core/in-memory/in-memory-engine-session.ts

# 边界断言
rg -n 'expectedPublic|extra|missing|ClassifyContext|CounselorEventKind' test/engine-core/boundary.spec.ts

# 逐字稿落点与 DB 字段
rg -n 'ap_practice_turns|visitor_display_text|debug-sessions' src/auto-practice src/admin-debug

# core 测试基线（只读）
pnpm exec vitest run test/engine-core

# 逐轮事件标签分布（只出计数）
Get-ChildItem data/debug-sessions -Filter *.json | ForEach-Object { (Get-Content $_.FullName -Raw | ConvertFrom-Json).traces } | ...
```

> ⚠️ 上述统计脚本**只允许输出计数与比率**；任何形态都不得打印 `messages[].text`、`renderSpec`、`kernelState`（隐私红线 AGENTS.md §5.4）。

---

**结论一句话**：**D-1 有条件可行** —— 规则轨三点不可达全部成立且比预想更严格；逐轮样本已在盘（96 场 / 1112 轮，`neutral` 误吞上界 **89.39%**）；模型轨可零 core 改动接入（`EventClassifier` 是已导出的端口，注入缝已存在），**但必须先解决「同步接口 vs 异步 LLM」的形状冲突（风险 A），且取证与实现建议拆两段**。
