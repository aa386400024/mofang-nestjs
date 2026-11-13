# D-7 开工单 · 模型轨分类器 `llm_active` 生效轨接线（D-2 收尾 · C6 adapter 装配层）

> 状态：✅ **已完成**（2026-11-13，MiniMax Code；交付记录：[`phase2.5-d7-classifier-llm-active-wiring-implementation-2026-11-13.md`](./phase2.5-d7-classifier-llm-active-wiring-implementation-2026-11-13.md)）
> 仓库：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`，基线 HEAD `7ad1644`（本地 = 远端；工作区除 `data/quality/*.diff` 未跟踪诊断产物与 `docs/worklog/archive/` 回执外干净，core diff 为空）。
> 事实源：结构债草案 `docs/worklog/pending/phase2.5-engine-core-structural-debt-assessment-2026-11-12.md`（§37 C6 装配与配置、§6 第 4 步、§9.3 D-2 表行 :303）；台账 `docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md`（§7.4 D-1 第二段、§7.5 D-2、I-10 / I-18）；D-2 交付记录 `docs/worklog/completed/phase2.5/phase2.5-d2-event-kind-split-implementation-2026-11-12.md`（L-5 生效轨接线、L-8 语义遗留）；D-1 第二段交付记录 `docs/worklog/completed/phase2.5/phase2.5-d1-model-classifier-implementation-2026-11-12.md`。
> 任务性质：**adapter 装配层**单（结构债类别 C6）。D-1 第二段落地模型轨分类器三态实现与影子观测，D-2 落地两类新 kind 进 core 联合与表行；两单都刻意把 `llm_active` 生效轨留空——装配层只在 shadow 挂分类器端口。本单把这条预留通路接上：全局 `llm_active` 时，模型轨分类器作为内核会话分类器端口与门面跨轮上下文端口装配到位，名单内场次的模型轨事件正式进 core events 与 delta 路径；其余模式行为逐字不变。
> 改动范围：`src/engine-adapters/wiring/engine.module.ts` 1 个既有文件（两处装配条件 + 两处挂点注释 + 一处启动日志文案）、`.env.example` 1 处注释、分类器文件头/分支注释同步、既有分类器 spec 增补；**core 纯层零改动**；不碰前端、不接 DB migration、不新增 env 键、不调阈值 / 幅度 / 熔断参数、不跑批次、不调真模型做离线批量。

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `README.md` → `docs/README.md` → `docs/team/conventions.md`（§1.1 分层、§二 交付格式）→ `AGENTS.md`（§5.1 隐私、§2.1 engine-core 红线）。
2. 本开工单全文；D-1 第二段、D-2 两份交付记录（改动面、中间态形态、遗留清单 L-5 / L-8）。
3. 现状实现锚点（§2 表）；既有 spec `test/engine-adapters/model-event-classifier.spec.ts`（三态解析 / 回落 / 熔断 / 跨轮 / shadow 零回归 / 观测白名单 / 内核契约路径）。
4. 结构债草案 §9.3 D-2 表行备注（「分类器接线只剩 `llm_active` 生效轨，独立成单」）；台账 §7.4 / §7.5 两节。

---

## 1. 背景与已决项

### 1.1 背景

模型轨事件分类器（`ModelEventClassifier`）三态实现已在 D-1 第二段交付：`rule_only` 返回规则事件、`shadow` 跑模型轨写旁路观测并返回规则事件、`llm_active` 分支代码已在 `classifyAsync` 内写好（返回模型 coreKinds 事件）。core 契约侧 `EventClassifier.classifyAsync?` 可选成员与 `ClassifyContext.sessionId?` 也已就位，内核会话在分类器提供异步成员时 await 它。

**唯一缺口在装配层**：`engine.module.ts` 只在 `effectiveMode() === 'shadow'` 时把分类器挂进内核会话端口（`:436`）与门面上下文端口（`:499`）；全局 `llm_active` 时工厂只打一条「未接线、按 rule_only 运行」的 warn（`:373-377`）。于是 `llm_active` 分支在生产链路上走不到，模型轨结果始终只进旁路观测。本单补的就是这处装配接线，不新写分类判定逻辑。

### 1.2 已拍板（不再复议；用户 2026-11-13 确认）

| #     | 议题                      | 拍板结论                                                                                                                                                          | 依据                                                      |
| ----- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1.2.1 | 装配层工厂级 spec         | **不补** `engine.module.ts` 工厂挂点断言；挂点条件由分类器层 spec 增补 + 既有集成 spec 守护。与 D-1 / D-2 既有测试风格一致（仓库无装配工厂 spec 范式）            | 用户拍板；理由写进交付记录                                |
| 1.2.2 | `llm_active` 场次观测口径 | **保留全量对照观测**（与 shadow 同口径写 `ruleKinds` / `modelKinds` / `agreement` 等）；灰度对比需要 agreement 基线；不新增观测字段、不改观测白名单               | 用户拍板；D-1 §4.4 观测字段表延续                         |
| 1.2.3 | L-8 语义遗留              | `hasNonNeutralEvent`（zero_motion 空转判定）在生效轨下把两类新 kind 判为非 neutral 的影响，**本单只接线、不复议语义**；留标定批次反向取证，交付记录遗留项显式登记 | D-2 交付记录 L-8；台账 I-22                               |
| 1.2.4 | 种子幅度隔离              | 两类新 kind 的 `DELTA_TABLE` 行种子仍为 `ZERO`；本单不写临床方向 / 幅度 / 斜率，不新增 env 覆写通道                                                               | D-2 §1.2.4 延续；标定批次单                               |
| 1.2.5 | 两套开关隔离              | cognition 模型轨分类器三态与 deliberation 审议门三态是**两套独立开关**；本单只动分类器挂点，审议门挂点条件一字不动                                                | D-1 第二段配置头注释 :5-10；`deliberation-mode.config.ts` |

### 1.3 工程纪律（D-1 已证，逐条延续）

- 回落必须**逐字等价于规则轨**：分类器内部持有规则轨共享单例，任何失败路径返回规则轨 `classify` 结果；内核不感知回落；回落代码只有一处。
- 跨轮状态分桶键用业务 `sessionId`，禁用 `handleId`（运行时维度，会话恢复后会变）。
- 模型轨每条事件 `strength` 恒 1；置信度只进观测，不参与 delta 缩放。
- 事件分类只消费咨询师本轮文本（+ 上一轮来访话语，由门面上下文端口写入），不从来访输出反推。

## 2. 已核现状锚点（2026-11-13 只读复核；行号以代码为准，先 grep 符号名定位）

| 位置                                                                                         | 现状                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine-adapters/cognition/model-classifier-mode.config.ts:32-35`                        | `ModelClassifierEffectiveMode = 'shadow' \| 'rule_only' \| 'llm_active'`；白名单 `MODEL_CLASSIFIER_EFFECTIVE_MODES`                                                                                                                                                                                                                            |
| 同文件 :127-135                                                                              | `resolveModelClassifierModeConfig(config)`：总开关 `ENGINE_MODEL_CLASSIFIER_ENABLED` 关 → 一律 `rule_only`；读模式 / 灰度名单 / 超时                                                                                                                                                                                                           |
| 同文件 :155-167                                                                              | `resolveModelClassifierSessionMode(modeConfig, sessionId, scenarioType)` 逐场判定链：0. `exam` 或 `undefined` → `rule_only`（红线优先于一切）；1. 全局 `rule_only` → `rule_only`；2. 全局 `shadow` → `shadow`；3. 全局 `llm_active` → 名单内 `llm_active`、名单外 `rule_only`；名单空集 = 全量                                                 |
| `src/engine-adapters/cognition/model-event-classifier.ts:326`                                | `ModelEventClassifier implements EventClassifier, ModelClassifierContextPort`；构造注入 llm 端口 / modeConfig / observer / resolver / modelId（:351-370）                                                                                                                                                                                      |
| 同文件 :380-382                                                                              | `effectiveMode()` 暴露全局模式（装配层据此决定注不挂端口；读分类器内部同一份 modeConfig，不另读 env）                                                                                                                                                                                                                                          |
| 同文件 :394-396                                                                              | `classify` 同步形态 = 规则轨（模型轨无同步形态；内核在有 `classifyAsync` 时不走此分支）                                                                                                                                                                                                                                                        |
| 同文件 :408-431                                                                              | `classifyAsync`：先取规则事件；sessionId 空 / 归属查不到 → 规则事件；逐场 `rule_only` → 规则事件；否则跑模型轨、推进状态、写观测；`:424-428` `llm_active` + `outcome.labels` → 返回 `coreKinds.map(kind => ({ kind, matchedTerms: [], strength: 1 }))`；其余（含 shadow、回落）→ 规则事件                                                      |
| 同文件 :439-454                                                                              | `recordVisitorTurn` / `forgetSession` 上下文端口；`:461-463` `bucketCount()` 观测 / 测试用                                                                                                                                                                                                                                                     |
| `src/engine-core/domain/events/session-event.ts:57-61`                                       | `ClassifyContext { sensitiveTopics?, sessionId? }`；`:74-85` `EventClassifier { classify; classifyAsync? }`（可选异步成员）                                                                                                                                                                                                                    |
| `src/engine-core/in-memory/in-memory-engine-session.ts:419-426`                              | `classifyContext = { sensitiveTopics, sessionId }`；分类器有 `classifyAsync` → await，否则同步 `classify`（两条分支互斥）                                                                                                                                                                                                                      |
| `src/engine-adapters/wiring/engine.module.ts:357-383`                                        | 分类器 provider 单例工厂：解析 modeConfig、启动日志喊模式名 + 名单规模；`:373-377` 全局 `llm_active` 打「未接线」warn；`:380` `new ModelEventClassifier(...)`                                                                                                                                                                                  |
| 同文件 :432                                                                                  | **审议门** `deliberationHook` 挂点条件（`modeConfig.effectiveMode === 'llm_active'`，deliberation 配置）——**本单不动**                                                                                                                                                                                                                         |
| 同文件 :436                                                                                  | 内核会话 `classifier` 挂点：`...(modelClassifier.effectiveMode() === 'shadow' ? { classifier: modelClassifier } : {})`                                                                                                                                                                                                                         |
| 同文件 :499                                                                                  | 门面 `modelClassifierContext` 挂点：`...(modelClassifier.effectiveMode() === 'shadow' ? { modelClassifierContext: modelClassifier } : {})`                                                                                                                                                                                                     |
| `src/engine-adapters/wiring/engine.providers.ts:240-248`                                     | `EngineSessionTuningDeps.classifier?: EventClassifier`（缺省 = 内核默认规则轨，逐字零回归）                                                                                                                                                                                                                                                    |
| `src/engine-adapters/rendering/turn-render-orchestrator.ts:456`                              | `modelClassifierContext?: ModelClassifierContextPort`；`:782-788` `prepareModelClassifierContext`（判空，`recordVisitorTurn`）；`:795-801` `clearModelClassifierContext`（`forgetSession`）；`:625` 决策前调 prepare、`:771` 关闭时调 clear                                                                                                    |
| `src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.service.ts:69` / `.port.ts:52` | 模型轨事件 `matchedTerms` 为空数组是既有口径（模型轨不产词表命中，审计不造词）；空数组安全                                                                                                                                                                                                                                                     |
| `.env.example:503-518`                                                                       | 四键已登记：`ENGINE_MODEL_CLASSIFIER_ENABLED=false`、`ENGINE_MODEL_CLASSIFIER_EFFECTIVE_MODE=rule_only`、`ENGINE_MODEL_CLASSIFIER_GRAYSCALE_SESSIONS=`、`ENGINE_MODEL_CLASSIFIER_TIMEOUT_MS=3000`；`:511` 注释仍写「llm_active 本单未接线（留 D-2）」                                                                                          |
| 既有 spec                                                                                    | `test/engine-adapters/model-event-classifier.spec.ts`：配置三态 / 名单 / exam 红线（:219-285）、回落（:287-390）、熔断（:392-449）、跨轮（:451-559）、shadow 零回归（:561-608）、观测白名单（:610-701）、内核契约路径（:703-758）；`test/engine-adapters/d2-event-kind-split.spec.ts`：两类新 kind 联合 / 种子 ZERO / 审计明细 / shadow 中间态 |

## 3. 范围

### 3.1 在范围内

**A. 装配接线（`src/engine-adapters/wiring/engine.module.ts`）**

1. **内核会话分类器挂点（:436）**：条件从「仅 shadow」放开为「shadow 或 llm_active」：
   ```ts
   ...(modelClassifier.effectiveMode() === 'shadow' || modelClassifier.effectiveMode() === 'llm_active'
     ? { classifier: modelClassifier }
     : {}),
   ```
   逐场生效判定仍在分类器内部 `resolveModelClassifierSessionMode`；装配期挂端口 ≠ 全场生效（见 §4.1）。
2. **门面跨轮上下文挂点（:499）**：同条件放开到 `llm_active`——生效轨场次需要 `recordVisitorTurn` 写入上一轮来访话语；不挂则该增量恒空。
3. **挂点上方注释同步**：`:433-435`（classifier 挂点）与 `:497-498`（context 挂点）现有「只在影子模式挂 / llm_active 通路未接线」注释更新为现状口径：shadow 与 llm_active 两态挂端口，rule_only 不挂；逐场生效判定在分类器内部。注释不得再写「未接线 / 留 D-2 / 走不到」。
4. **启动日志 / warn（:368-377）**：
   - 既有模式名 + 名单规模日志行保留（隐私红线：只出模式名与名单规模，不含会话 id / 心理内容）。
   - `:373-377` 全局 `llm_active` 分支的「未接线、按 rule_only 运行」warn 文案更新为现状口径：生效轨已装配；提示全局 `llm_active` 下名单内场次每轮关键路径一次 LLM 往返；不得再写「未接线 / 走不到」。
   - `rule_only`、`shadow` 分支日志语义不变。

**B. 注释与配置文案同步**

5. `.env.example:511`：`llm_active` 注释从「模型轨结果进 delta —— 本单未接线（留 D-2），配了也按 rule_only 跑」更新为「模型轨结果进 delta；仅灰度名单内场次生效（名单空 = 全量），exam 场景恒规则轨」。**键名、缺省值、其余三行注释不动**；不新增 env 键。
6. `src/engine-adapters/cognition/model-event-classifier.ts`：
   - 文件头 :16-18「首版形态 = 中间态 / llm_active 预留（D-2 才接线，装配本单不注入）」与 :426 分支注释「首版装配不注入 llm_active」同步更新为现状口径（通路已由 D-7 装配接线）；
   - **`classifyAsync` 三态分支逻辑、回落路径、熔断 / 低置信 / 归属缺失处理逐字不改**；若复核发现 :424-428 产出形状与 core `SessionEvent` 契约有出入，按 §4.2 修正并在交付记录偏差节写明，否则只动注释。

**C. 测试（既有 spec 增补）**

7. `test/engine-adapters/model-event-classifier.spec.ts` 增补（沿用既有 helper 与桩风格；不新增装配工厂 spec，见 §1.2.1）：
   - **llm_active + 有效标签**：全局 `llm_active`、名单内、full_simulation 场景、模型返回高置信合法标签 → `classifyAsync` 返回事件 kind 集合 == 模型 `coreKinds`（顺序无关集合语义）；每条事件 `matchedTerms === []`、`strength === 1`；模型结果替换规则事件进 core events。
   - **llm_active + 回落**：模型失败路径（熔断 open / 校验失败 / 低置信，择既有 helper 可复现的一条；若覆盖多条更好）→ 返回规则轨等价事件（与 `rule.classify` 逐字一致），不把残缺模型事件带进结果。
   - **llm_active 全局 + 名单外场次**：逐场判定回落 `rule_only` 路径，返回规则事件；零模型轨副作用（跨轮状态不按模型标签推进；可结合既有归属桩断言）。
   - 既有 shadow 组「core 事件与 BDI 逐字不变」断言、rule_only 零 LLM 断言、配置解析组、观测白名单组**保留不改语义**。
8. `test/engine-adapters/d2-event-kind-split.spec.ts`：现有 shadow 中间态快照断言保留；如既有断言显式引用「llm_active 未接线」措辞，同步为现状口径，不改断言数值。

### 3.2 明确不在范围内

- **core 纯层零改动**：`git diff --stat HEAD -- src/engine-core` 必须为空；不新增 core 文件、不新增具名导出（不触发 `boundary.spec.ts` 断言⑥⑦）；不改 `EventClassifier` / `ClassifyContext` / `SessionEvent` 任何契约字段。
- 不改配置解析 `model-classifier-mode.config.ts`（三态 / 名单 / exam 红线 / 超时 / 总开关逻辑已完整）；不改标签映射 `model-event-mapping.ts`；不改观测带 `model-classifier-observation.ts`。
- 不碰 deliberation 审议门：`deliberation-mode.config.ts`、`LlmDeliberationHook`、`:432/:489/:491` 审议挂点条件一字不动；两套开关不互换条件。
- 不扩规则轨词表（`event-lexicon.ts`）；不调熔断阈值（3 次 / 60s）、低置信阈值（0.6）、超时（3000ms）任何参数；两类新 kind 种子仍 `ZERO`，不写临床幅度 / 方向 / 斜率，不开 env 覆写通道。
- 不改审计落库结构与实体；不接 DB migration；不跑批次；不调真模型做离线批量；不做吞吐 / 429 / 成本实测（留灰度批次评估）。
- 不碰前端 `src/admin-dashboard`；不清理既有根 `tsconfig` 类型债（D1-7，401 条 / 87 文件，单独排期）；不复议 D-4 cold 先验（DOC-2 不建议单独实施）；不做 D-3 剩余形态斜率。
- 不顺手归档 pending 目录历史预研回执（`*-research-minimax-*` / `*-research-result-*`）；该事后治理另单处理。
- 发现任务单与代码冲突时，写进交付记录风险 / 偏差节，不静默改写；不自动 commit / push。

## 4. 契约与行为口径

### 4.1 装配语义：挂端口 ≠ 全场生效

- 装配期工厂拿不到「当前是哪场会话」，挂端口是**部署形态**决定（与 cap / 人格 / 同盟 / 审议钩子同款构造注入范式）；逐场模式由分类器内部 `resolveModelClassifierSessionMode` 判定，判定链是唯一真相源（配置层与分类器共用同一份 modeConfig）。
- 三态在生效链路里的行为：

| 全局模式            | 装配挂点                      | 名单内场次                                                           | 名单外场次                   | exam / 场景查不到        |
| ------------------- | ----------------------------- | -------------------------------------------------------------------- | ---------------------------- | ------------------------ |
| `rule_only`（缺省） | 不挂 classifier、不挂 context | 规则事件                                                             | 规则事件                     | 规则事件（红线）         |
| `shadow`            | 挂 classifier + context       | 模型轨跑观测，**返回规则事件**（core / BDI 逐字不变）                | 同左                         | 规则事件（红线，零 LLM） |
| `llm_active`        | 挂 classifier + context       | 模型轨有效标签 → **模型事件进 core events / delta**；回落 → 规则事件 | 规则事件（逐场 `rule_only`） | 规则事件（红线，零 LLM） |

- 缺省零回归：不配任何 env → 总开关关 → `effectiveMode = rule_only` → 两个端口都不挂 → 内核走默认规则轨，决策链里根本没有模型轨这一步（不是「结果一样」，是「没走那条路」）。

### 4.2 模型轨事件形状（进 core 的事件）

```ts
// model-event-classifier.ts :424-428（既有实现，本单复核不改逻辑）
return outcome.labels.coreKinds.map((kind) => ({
  kind, // CounselorEventKind 联合成员（13 类之一）
  matchedTerms: [], // 模型轨不产词表命中；空数组 = 没有词表证据，不是漏填
  strength: 1, // 模型轨事件强度恒 1；置信度只进观测，不缩放 delta
}));
```

- `coreKinds` 元素集合由 `mapModelLabels` 校验 / 映射产出（未知标签丢弃、去重保序、全丢 → null 回落）；本单不动映射表。
- 审计侧按既有口径消费空 `matchedTerms`（§2 审计行），不造词；本单不改审计服务。

### 4.3 观测口径（`llm_active` 场次与 shadow 同口径）

- `observeRound` 不分模式全量写对照观测；字段白名单沿用 D-1：`tenantId / sessionId / turnIndex / ruleKinds / modelKinds / agreement / confidence / fallbackReason / latencyBucket / modelId / promptVersion / strength / degraded`。
- 观测仍禁入：咨询师原话、`matchedTerms` 明细、解释文本、`kernelState`、展示名。
- 本单不新增观测字段、不改 trace key 口径；`agreement` 集合语义（顺序无关）不变。

### 4.4 回落与跨轮状态纪律

- 回落路径（任一即触发）：LLM 错误 / 熔断 open / 输出校验失败 / 低置信 / 归属查不到 / `sessionId` 为空 / 超时 → 返回规则轨等价事件；低置信不计熔断（既有口径）。
- 回落轮也推进跨轮状态（按规则轨结果推进，回落是一次有效判定，计数不断链）；该语义 D-1 已定，本单不改。
- `forgetSession` 主清理路径挂门面关闭时点；TTL 兜底 2h 既有；不新增清理通道。

## 5. 风险点登记（本单相关）

| #   | 风险                                                                                                                            | 本单处置                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | 装配误挂：`rule_only` 全局下挂了 classifier 端口，每轮白走分类器构造与跨轮分桶                                                  | 挂点条件严格 `shadow \|\| llm_active`；`rule_only` 三元不出现端口；§3.1-7 名单外用例 + 既有集成守护；启动日志喊出实际模式                                |
| T2  | 两套开关混淆：把 deliberation 的 `llm_active` 条件套到分类器挂点（或反之），审议与模型轨互相串台                                | 分类器挂点只读 `modelClassifier.effectiveMode()`；审议挂点只读 deliberation `modeConfig`；代码注释写明两套独立；交付记录 diff 逐行核对 `:432` 审议行未动 |
| T3  | 逐场生效误判：挂端口后误以为名单外场次也跑模型轨进 delta                                                                        | 逐场判定在分类器内部；名单外 → `rule_only` 返回规则事件；spec §3.1-7 第三例覆盖；归属缺失 / sessionId 空回落规则轨                                       |
| T4  | exam 红线被名单穿透：考核场次被误加进灰度名单                                                                                   | 判定链第 0 条 `exam / undefined → rule_only`，优先于全局与名单；配置层既有 spec 守护（:263-270）；本单不动判定链                                         |
| T5  | 回落路径把模型失败带进 delta：超时 / 熔断 / 低置信产出残缺事件污染状态                                                          | `labels === null` 一律返回规则事件；spec §3.1-7 第二例覆盖；熔断 / 置信 / 超时参数不调                                                                   |
| T6  | 生效轨下观测口径漂移：`llm_active` 场次缺观测字段或改白名单                                                                     | `observeRound` 不分模式全写；观测白名单 spec 既有守护；本单不增字段                                                                                      |
| T7  | 中间态遗留误读：接线后两类新 kind 种子仍 `ZERO`，模型判 `holding_present / cold_absent` 那轮 delta 仍为零，被误判为「接线无效」 | 交付记录显式写明：本单接的是**通路**，幅度改善待标定批次赋表行增量；附种子 ZERO 与零 delta 的既有证据（D-2 spec ②）                                      |
| T8  | 性能 / 成本：生效轨每轮关键路径一次 LLM 往返，灰度期 429 / 延迟风险                                                             | 三道闸（总开关 + 模式 + 名单）；缺省 `rule_only`；熔断 / 超时既有；成本与 429 实测留灰度批次评估，本单不调参数                                           |

## 6. 闸门（执行方跑，填真实数字；pnpm，禁裸 npx）

跑前：PATH 补 `D:\Apps\Git\cmd`（避免 vitest 调 git ENOENT 假失败）；确认无 `nest start --watch` / `vite dev` 常驻；记录机器状态（CPU / 内存 / Node 版本 / 常驻进程 / 盘读延迟）。

基线参照（2026-11-13，HEAD `7ad1644`，C5-1 交付实测；开工前主控须复跑确认，不沿用历史墙钟数字）：类型债 401 条 / 87 文件；`boundary.spec.ts` 12 例绿；定向 `test/quality test/engine-core test/engine-adapters` 121 文件 / 2187 例；全量 193 文件 / 3231 例（3227 passed + 4 skipped 回执口径；本机复跑 3226 + 4 + 1 负载 flake，单文件复跑全绿）；lint 0 error / 0 warning。

| 闸门            | 命令                                                                      | 判据                                                                                                   |
| --------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 类型（build）   | `pnpm exec tsc -p tsconfig.build.json --noEmit`                           | 0 error                                                                                                |
| 类型（含 spec） | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`   | 本单相关文件 0 error（既有类型债另计，不新增）                                                         |
| Lint            | `pnpm lint`                                                               | 0 error，记 warning 数                                                                                 |
| 边界护栏        | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                  | 12 例全绿；本单不改该文件                                                                              |
| 定向测试        | `pnpm exec vitest run test/quality test/engine-core test/engine-adapters` | 全绿；用例数 ≥ 基线，零丢失 / 零改写（本单新增 spec 用例单列计数）                                     |
| 全量            | `pnpm test`                                                               | 全绿，记总数 / passed / skipped / failed / 墙钟 + 机器状态；失败先单文件复跑区分确定性缺陷与负载 flake |
| core 变更面     | `git diff --stat HEAD -- src/engine-core`                                 | **为空**；无新增 core 文件 / 具名导出                                                                  |
| adapter 变更面  | `git diff --stat HEAD -- src/engine-adapters`                             | 只含 §3.1 A / B / C 清单内文件（`engine.module.ts`、`model-event-classifier.ts` 注释、两个既有 spec）  |
| 配置变更面      | `git diff --stat HEAD -- .env.example`                                    | 仅 :511 注释行；键名 / 缺省值 / 行数不变                                                               |
| 前端变更面      | `git diff --stat HEAD -- src/admin-dashboard`                             | 为空                                                                                                   |
| 隐私自检        | 新增 / 改动 spec 与日志人工过一遍                                         | 无原话、无 prompt 全文、无 `kernelState`、无展示名；启动日志无会话 id                                  |

## 7. 交付记录与回写

### 7.1 交付记录路径

`docs/worklog/completed/phase2.5/phase2.5-d7-classifier-llm-active-wiring-implementation-2026-11-13.md`，含：一句话总结；实际方案 vs 任务单偏差（conventions §2.5）；改动文件清单（adapter / 配置 / 测试分组）；闸门表（命令 / exit code / 真实数字 / 机器状态）；§5 风险逐条处置确认；三态装配行为矩阵证据（§4.1）；观测口径与隐私自检结论；遗留项清单（§7.3）。

### 7.2 交付回写清单

- [x] 交付记录写到 §7.1 路径；本任务单移入 `completed/phase2.5/`，状态行改完成标记并链接交付记录
- [x] 台账 §7.5 D-2 节备注更新：`llm_active` 生效轨已接线（D-7）；L-5 状态回填；L-8 仍挂标定批次取证
- [x] 结构债草案 §9.3 D-2 表行备注同步（「分类器接线只剩 `llm_active`」→ 已由 D-7 接线）；§6 第 4 步进度列更新
- [x] D-2 交付记录 L-5 / L-8 遗留项在台账 / 草案的对应状态回填（历史交付记录只读不改）
- [x] 活清单 `phase2.5-wp-list-2026-11-08.md` 与 `phase2.5-README.md` 登记本单
- [x] `git diff --stat HEAD -- src/engine-core`、`src/engine-adapters`、`.env.example`、`src/admin-dashboard` 实测记录进交付记录
- [x] 提交分组隔离：本单文件不混入并行产物；给一行 commit message 草稿，不自行 commit / push

### 7.3 遗留登记（本单不闭合，显式留痕）

| #   | 遗留项                                                                                                                      | 去向                          |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| L-1 | 两类新 kind 临床 delta 方向 / 幅度 / 权重斜率；`holding_present` 是否进 `POSITIVE_EVENTS`；缺席连续轮数阈值；低置信临床口径 | 标定批次单                    |
| L-2 | L-8：`hasNonNeutralEvent` / zero_motion 空转判定在生效轨下把两类新 kind 判为非 neutral 的语义影响                           | 标定批次反向取证（台账 I-22） |
| L-3 | 生效轨每轮 LLM 往返的成本 / 429 / 吞吐 / 延迟实测与灰度规模评估                                                             | 灰度批次评估                  |
| L-4 | 规则轨词表是否补「在场标记」条目（D-2 L-6）                                                                                 | 标定批次 / 独立单             |
| L-5 | 前端看板新 kind 展示映射（D-2 L-7；`batchRegressionMeta.ts` 仍 11 类）                                                      | 前端单                        |
| L-6 | 既有根 `tsconfig` 类型债（D1-7，401 条 / 87 文件）                                                                          | 单独排期                      |
| L-7 | pending 目录历史预研回执归档（`*-research-minimax-*` / `*-research-result-*`）                                              | 事后文档治理单                |

## 附录 · 边界与顺序

- 本单是 D-2 收尾（L-5），不改写 D-1 / D-2 已交付的分类判定、映射、观测与审计口径；D-3 时序权重剩余形态斜率、D-4 cold 先验、D-5/G-4 词表子串重叠均不在本单。
- 顺序关系：D-1（分类器实现 + 影子观测）→ D-2（事件拆分 + 种子 ZERO）→ **D-7（生效轨装配，本单）** → 标定批次（幅度 / 阈值 / 倍率 / 语义取证）。
- 既有类型债、并行进程产物与本单改动分开记录；交付时 `git status --short` 逐条比对清单，未跟踪诊断产物（`data/quality/*.diff`、archive 回执）不入库。
