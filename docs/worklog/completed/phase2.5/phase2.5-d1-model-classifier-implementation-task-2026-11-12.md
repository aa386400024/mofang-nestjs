# D-1 第二段开工单 · 模型轨事件分类器实现（规则轨对照观测 · 中间态）

> 状态：✅ **已交付**（2026-11-12，MiniMax Code）→ [交付记录](phase2.5-d1-model-classifier-implementation-2026-11-12.md)（本单已归档至 `docs/worklog/completed/phase2.5/`）
> 仓库：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`，基线 HEAD `7b80615`。
> 事实源：第二段预研结论 `docs/worklog/pending/phase2.5-d1-model-classifier-implementation-research-result-2026-11-12.md`（S1–S9 / F1–F5 / 风险 L–R，已验收通过）；第一段取证交付记录 `docs/worklog/completed/phase2.5/phase2.5-d1-event-classifier-evidence-implementation-2026-11-12.md`；台账 `docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md`；结构债草案 `docs/worklog/pending/phase2.5-engine-core-structural-debt-assessment-2026-11-12.md`。
> 任务性质：模型轨分类器实现单。首版为**中间态**——模型轨可判出两类新标签，但只进旁路观测记录，不进 core `events`、不改 BDI delta。
> 改动范围：core 纯层 2 个文件（例外批准，见下）、adapter 7 个文件（含 2 个新文件）、测试 3 个文件；不碰前端、不接 DB migration、不跑批次、不调真模型做离线批量。

## 例外批准声明

本单**有限授权**改动 `src/engine-core/**`，且仅限以下 2 个文件、以下改动内容：

| #   | core 文件                                               | 允许的改动                                                                                           | 不允许                                                          |
| --- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1   | `src/engine-core/domain/events/session-event.ts`        | `EventClassifier` 接口加**可选**成员 `classifyAsync?`；`ClassifyContext` 加**可选**字段 `sessionId?` | 不新增导出名；不新增 `.ts` 文件；不改 `CounselorEventKind` 联合 |
| 2   | `src/engine-core/in-memory/in-memory-engine-session.ts` | 分类调用点改为「存在 `classifyAsync` 则 await，否则走同步 `classify`」；上下文多透传 `sessionId`     | 不新增导出；不改状态迁移、cap、人格调节任何逻辑                 |

其余 core 文件**一律不动**。`test/engine-core/boundary.spec.ts` 不许改；不新增 core 文件与具名导出（断言⑥⑦ 须保持绿）。除上表外，任何 `src/engine-core/**` 改动在交付时打回。

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `README.md` → `docs/README.md` → `docs/team/conventions.md`（§1.1 分层、§二 交付格式）→ `AGENTS.md`（§5.1 隐私）。
2. 第二段预研结论全文：§1 总结论与 F1–F5、§2 改动面 19 行清单、§3 S1–S9、§4 接口与类型草案、§5 门面收敛表、§6 风险表、§7 待拍板取舍、§8 步骤与 spec 清单、§9 闸门。
3. 本开工单。

---

## 1. 背景与已决项

### 1.1 背景

第一段离线取证钉死：规则词轨对 `holding_present`（稳定在场）漏正向率 1.0000（56 轮全部被吞入 `neutral`），`neutral` 误吞上界 89.39%。本单在 adapter 层落地一条与规则轨同接口的模型轨分类器，产出两轨逐轮对照观测，为 D-2 事件拆分提供判出能力证据。预研总结论为**有条件可行**，四条条件：

- **C1**：模型轨生效时每轮关键路径多一次 LLM 往返，灰度必须把生效范围限定在非实时路径。
- **C2**：走路径 E（`EventClassifier` 加可选异步成员），上表 2 个 core 文件经例外批准。
- **C3**：审计服务必须改为只吃内核事件、停止自行 `new RuleBasedClassifier()` 重分类；该改动与模型轨实现**同一单**，不可拆。
- **C4**：两类新 kind 的 core 联合扩展留 D-2；D-2 改动面为 4 个文件（非第一段估的 1 个），本单不做。

### 1.2 已拍板（不再复议）

| 议题           | 拍板结论                                                                                                                                                              | 依据                        |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 7.1 接口路径   | **路径 E**：`EventClassifier` 加可选 `classifyAsync?`；core 2 文件；缺省路径逐字不变。不选整体 Promise（A），不走旁路预跑作为生效通路（D）                            | 预研 §7.1 / S1-E            |
| 7.2 上下文供给 | **L1-a**：模型轨实现内 `Map<sessionId, state>` 自持跨轮状态；`ClassifyContext` 加可选 `sessionId?`。更新者 = 判定者，单一真相源                                       | 预研 §7.2 / S2-L1 / S2-L1-4 |
| 7.3 结果类型   | **方案 b**：模型轨判定映射回现有 core kind；`holding_present` / `cold_absent` 只进旁路标签。映射规则表从一开始按 D-2 最终形状写，使 D-2 类型层不返工                  | 预研 §7.3 / S3-3            |
| 7.4 灰度缺省   | **只照抄审议结构，回落方向相反**：缺省 `rule_only`，非法值回落 `rule_only`；不配 env = 改造前逐字一致。`exam` 场景恒 `rule_only`，写死在类型里，不接受配置或名单覆盖  | 预研 §7.4 / S6-2 / S6-3     |
| 7.5 首版形态   | **中间态**：两类新标签只进旁路记录，不进 core `events`、不改 delta。本单只启用 `rule_only` 与 `shadow`；`llm_active` 通路在 core 接口层预留，装配本单不接线（留 D-2） | 预研 §7.5 / S6-8            |

### 1.3 四条工程纪律（结论 §1 与 §6 已证）

- 回落必须**逐字等价于规则轨**；模型轨实现内部持有规则轨实例，失败时直接返回规则轨 `classify` 结果。内核不感知回落；回落代码只有一处。
- 不能先跑同步再跑异步（每轮两次词表扫描 + 一次 LLM，白烧 CPU 且两条结果并存易漂）。存在 `classifyAsync` 就只走异步，由实现内部决定是否回落。
- 跨轮状态分桶键用**业务 `sessionId`**，禁用 `handleId`（运行时维度，会话恢复后会变，会丢跨轮状态）。
- 模型轨每条事件 `strength` **恒 1**；置信度只进观测，不参与 delta 缩放。

## 2. 已核现状锚点（行号以代码为准，先 grep 符号名定位）

| 位置                                                                                       | 现状                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine-core/domain/events/session-event.ts:13-47`                                     | `CounselorEventKind` 11 类 + `neutral`；`SessionEvent{kind, matchedTerms, strength}`；`ClassifyContext{sensitiveTopics?}`；`EventClassifier` 仅同步 `classify`            |
| `src/engine-core/in-memory/in-memory-engine-session.ts:140-142`                            | `EngineSessionRuntime{handleId, sessionId, ...}`；`sessionId` 在 runtime 上可取                                                                                           |
| 同文件 `:374`                                                                              | `async turn(handleId, input): Promise<EngineTurnOutput>`，内核 turn 本就是异步                                                                                            |
| 同文件 `:400-402`                                                                          | 分类调用点：`this.classifier.classify(userText, { sensitiveTopics: runtime.characterProfile?.sensitiveTopics })`                                                          |
| `src/engine-core/cognition/rule-based-classifier.ts:9-10`                                  | `RuleBasedClassifier implements EventClassifier`，无状态纯函数，`strength` 恒 1                                                                                           |
| `src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.service.ts:74-79`            | `mergeKernelOnlyEvents`：本地分类事件与内核 `kernelEventKinds` 取并集                                                                                                     |
| 同文件 `:87`                                                                               | 审计服务自建 `private readonly classifier = new RuleBasedClassifier()`                                                                                                    |
| 同文件 `:162-164`                                                                          | `persist` 内本地 `classify` → 并集 → `aggregateTurnDelta(merged, ...)` 得 `rawDelta`                                                                                      |
| `src/engine-adapters/wiring/engine.providers.ts:244-250`                                   | `createEngineSessionPort` 既有端口注入范式（cap / alliance / deltaTable 同款）                                                                                            |
| `src/engine-adapters/wiring/engine.module.ts:354-365`                                      | `ENGINE_SESSION_PORT` 装配；审议按模式条件挂载的互斥范式参照同文件审议段                                                                                                  |
| `src/engine-adapters/deliberation/deliberation-input.ts:73 / :137 / :163`                  | 兜底分类器与 `toOperatorTag`；同步纯函数 `extractCounselorEvents`                                                                                                         |
| `src/engine-adapters/wiring/engine-turn.service.ts:396 / :419 / :450 / :475`               | 门面 `orchestrator.turn` / `turnStream`；`forgetSession`；审计调用点                                                                                                      |
| `src/engine-adapters/rendering/turn-render-orchestrator.ts:603 / :678 / :737 / :1244-1249` | core `session.turn` 仅这两处调用；`forgetSession` 清理点；`settleTurn` 历史含 visitor 半边                                                                                |
| 灰度范式                                                                                   | `src/engine-adapters/deliberation/deliberation-mode.config.ts`（三态 + 名单 + `resolveSessionEffectiveMode`）；`deliberation.processor.ts:303 / :361-366`（影子入队范式） |
| LLM 唯一链                                                                                 | `src/counselor/providers/llm-json.client.ts` `CounselorLlmJsonClient.requestJson<T>`；每轮粒度范式 `src/engine-adapters/.../turn-analysis.service.ts`                     |
| 测试基线                                                                                   | `test/quality/d1-event-classifier-evidence.spec.ts` 39 例规则轨快照（复用不改）；`test/engine-core/boundary.spec.ts` 12 例                                                |

## 3. 范围

### 3.1 在范围内

**A. core 契约（例外批准 2 文件，见声明表）**

1. `session-event.ts`：按 §4.1 加 `classifyAsync?` 与 `ClassifyContext.sessionId?`。
2. `in-memory-engine-session.ts`：分类调用点按 §4.1 改 await 分支，上下文透传 `sessionId: runtime.sessionId`。

**B. adapter 模型轨实现（新文件）**

3. `src/engine-adapters/cognition/model-event-classifier.ts`：
   - 实现 `EventClassifier`（提供同步 `classify` 满足接口契约；模型能力走 `classifyAsync`）。
   - 内部注入 `CounselorLlmJsonClient`（经端口 / provider，不直接 new 网络客户端）；手写 schema 校验；失败 / 超时 / 非法 schema / 熔断 / 低置信 → 回落内部规则轨实例。
   - 按 `sessionId` 分桶持有跨轮状态（连续缺席计数、上一轮来访话语取用）；状态更新只在本实现内完成。
   - 输出按 §4.2 方案 b：`coreKinds`（映射回现有 kind）+ `sideLabels`（`holding_present` / `cold_absent`，仅旁路）+ `confidence`。
4. `src/engine-adapters/cognition/model-classifier-mode.config.ts`：三态枚举 + 会话白名单 + 超时 + 模式解析链，照 `deliberation-mode.config.ts` 结构；非法值回落 `rule_only`。

**C. adapter 装配与透传**

5. `src/engine-adapters/wiring/engine.providers.ts:244-250`：`createEngineSessionPort` 增**可选** `classifier` 依赖并透传；不传 = 现状逐字不变。
6. `src/engine-adapters/wiring/engine.module.ts:354-365`：按模式决定是否注入 classifier；`rule_only` 时连 classifier 都不注入（内核走缺省规则轨）。新增模式 config provider，启动期求值一次，启动日志只出模式名与名单规模。
7. `src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.service.ts`（C3，与本单不可拆）：
   - 停止自行 `new RuleBasedClassifier()` 重分类；改为只消费内核传入的事件与 `kernelEventKinds`。
   - `mergeKernelOnlyEvents` 的并集语义在新口径下重新定义（无本地分类结果可并时，不产生第二套标签）。
   - 审计 `rawDelta` 与内核实际 delta 对齐；新增「审计事件集合 == 内核事件集合」断言。
8. `src/engine-adapters/deliberation/deliberation-input.ts:73 / :137 / :163`：兜底分类器改为与内核同源（复用同一规则轨实例 / 同一端口，不各写一套）。**标签白名单容纳新 kind 属 D-2**，本单不动。
9. `src/engine-adapters/wiring/engine-turn.service.ts`：门面层模型轨上下文写入 / 清理挂载点（L1-a）；审计调用改传内核事件。
10. `src/engine-adapters/rendering/turn-render-orchestrator.ts`：上一轮来访话语从编排器既有历史取用（不新增历史结构）；`forgetSession` 处挂模型轨跨轮状态清理。

**D. 测试**

11. `test/quality/d1-event-classifier-evidence.spec.ts`：**复用不改**，作为规则轨零回归锚。
12. `test/engine-adapters/model-event-classifier.spec.ts`（新）：fixture 构造样例（不放真实逐字稿）；各错误码回落逐字等价规则轨；熔断打开时 `requestJson` 未被调用；跨轮计数递增 / 命中重置 / 中断轮不推进 / 多会话隔离；`forgetSession` 后分桶清空；影子模式下 core `events` 与 BDI 状态逐字不变；缺省灰度下全量零回归；`exam` 场景 `requestJson` 未被调用；模型轨每条事件 `strength === 1`。
13. `test/engine-adapters/wp58-turn-delta-audit.spec.ts:170-171`：`matchedTerms` 与 `strength` 两条断言在审计口径改变后的处理——先评估影响面，按拍板结果保留 / 调整，并在交付记录写明；本单不擅自删改既有断言语义。

### 3.2 明确不在范围内

- 不扩 `CounselorEventKind` 联合；不加 `DELTA_TABLE` 行；不加 `COUNSELOR_EVENT_LABELS` 项；不动指标字典 `TRACKED_EVENTS` / `POSITIVE_EVENTS`；不动审议 `DELIBERATION_RULE_ALIGNED_TAGS`。以上全部属 **D-2**。
- 不实现 `llm_active` 的事件接入（模型轨结果不替换规则轨、不进 delta）；两类事件的 delta 方向 / 大小 / 权重斜率、缺席连续轮数阈值、模型轨结果如何进 `aggregateTurnDelta`、`POSITIVE_EVENTS` 是否含 `holding_present`，全部留 D-2 + 标定批次。
- 不接 DB migration / 新表；不跑批次；不调真模型做离线批量；不做吞吐 / 429 实测（登记量级即可）。
- 不改前端 `src/admin-dashboard`；不新增 core 文件或具名导出；不改 `boundary.spec.ts`。
- 不复议第一段已结论项；发现任务单与代码冲突时，写进交付记录风险节，不静默改写。
- 不自动 commit / push。

## 4. 契约与类型形状

### 4.1 路径 E（core，例外批准）

```ts
// src/engine-core/domain/events/session-event.ts
export interface EventClassifier {
  /** 同步分类 —— 规则轨（纯函数，无状态，无 IO）。 */
  classify(text: string, context?: ClassifyContext): readonly SessionEvent[];

  /**
   * 可选异步分类 —— 模型轨。存在则内核 await 它；不存在走 classify。
   * 回落由实现内部负责（失败时返回规则轨结果），内核不感知。
   */
  classifyAsync?(text: string, context?: ClassifyContext): Promise<readonly SessionEvent[]>;
}

export interface ClassifyContext {
  readonly sensitiveTopics?: readonly string[];
  /** L1-a：业务会话 id —— 跨轮状态分桶键。 */
  readonly sessionId?: string;
}
```

内核调用点（`in-memory-engine-session.ts:400-402`）：

```ts
const context: ClassifyContext = {
  sensitiveTopics: runtime.characterProfile?.sensitiveTopics,
  sessionId: runtime.sessionId,
};
const events = this.classifier.classifyAsync
  ? await this.classifier.classifyAsync(userText, context)
  : this.classifier.classify(userText, context);
```

### 4.2 方案 b（adapter 本地类型 + 映射规则表）

```ts
// src/engine-adapters/cognition/model-event-mapping.ts（新文件）
export type CoreEventKind = CounselorEventKind; // 11 + neutral，core 侧零变化
export type ModelSideLabel = 'holding_present' | 'cold_absent';

export interface ModelClassification {
  readonly coreKinds: readonly CoreEventKind[]; // 映射回现有 kind
  readonly sideLabels: readonly ModelSideLabel[]; // 只进旁路记录
  readonly confidence: number;
}
```

映射规则表从一开始按 D-2 最终形状编写；映射是有损压缩，D-2 接 delta 时映射表本身重做（类型层不返工）。adapter 本地类型只许出现在「模型轨实现」与「旁路观测落库」两处。

### 4.3 模式枚举与 env 键

```ts
export type ModelClassifierEffectiveMode = 'shadow' | 'rule_only' | 'llm_active';
```

| env 键                                       | 缺省                        | 说明                                                        |
| -------------------------------------------- | --------------------------- | ----------------------------------------------------------- |
| `ENGINE_MODEL_CLASSIFIER_ENABLED`            | 关                          | 总开关，先于模式判定                                        |
| `ENGINE_MODEL_CLASSIFIER_EFFECTIVE_MODE`     | `rule_only`                 | 非法值回落 `rule_only`（与审议回落方向相反；现状 = 规则轨） |
| `ENGINE_MODEL_CLASSIFIER_GRAYSCALE_SESSIONS` | 空 = 全量                   | 逗号分隔会话白名单                                          |
| `ENGINE_MODEL_CLASSIFIER_TIMEOUT_MS`         | 3000                        | 照审议 `DEFAULT_DELIBERATION_EFFECTIVE_TIMEOUT_MS`          |
| 模型选择                                     | 走 `COUNSELOR_LLM_PROFILES` | 不另设模型 env                                              |

新增 env 键**必须同步登记 `.env.example`**（env 覆盖度契约规格）。判定链：

```text
resolveModelClassifierSessionMode(config, sessionId, scenarioType):
  0. scenarioType === 'exam' → 'rule_only'        // 考核红线，优先于一切配置与名单
  1. 总开关关 / 模式 === 'rule_only' → 'rule_only'
  2. 模式 === 'shadow' → 'shadow'
  3. 模式 === 'llm_active' → 名单内 'llm_active'，名单外 'rule_only'（名单为空 = 全量）
```

### 4.4 观测字段（Redis trace，独立 key 前缀，与审议 trace 错开）

| 字段             | 类型           | 说明                                                           |
| ---------------- | -------------- | -------------------------------------------------------------- |
| `tenantId`       | string         | 租户                                                           |
| `sessionId`      | string         | 业务会话 id                                                    |
| `turnIndex`      | number         | 轮次                                                           |
| `ruleKinds`      | string[]       | 规则轨判出 kind                                                |
| `modelKinds`     | string[]       | 模型轨判出 kind                                                |
| `agreement`      | boolean        | 两轨是否一致（核心对照指标）                                   |
| `confidence`     | number         | 模型置信度 0–1                                                 |
| `fallbackReason` | string \| null | 回落原因码                                                     |
| `latencyBucket`  | string         | 耗时桶（`lt_500ms` / `lt_1500ms` / `lt_3000ms` / `gt_3000ms`） |
| `modelId`        | string         | 模型标识                                                       |
| `promptVersion`  | string         | prompt 版本（版本口径核对用）                                  |
| `strength`       | number         | 恒 1                                                           |

**禁入观测**：咨询师 / 来访原文、`matchedTerms`、解释性文本、`kernelState`、展示名（`title` / `characterLabel`）。`matchedTerms` 属心理内容衍生，不入观测表。

### 4.5 回落错误码（真实码表，禁止自造）

可用码：`json_not_found` / `json_parse_failed` / `schema_validation_failed` / `http_401` / `http_429` / `http_5xx` / `no_body` / `parse_error` / `fetch_error`；另加熔断 `circuit_open`、低置信 `low_confidence`。**`timeout` 在既有码表中不存在**——超时统一落 `fetch_error`，不得自造 `model_classifier_timeout` 之类语义重叠码（预研 S5-9 / 风险 R）。

## 5. 跨轮状态归属与并发、中断、回落纪律

- **状态存放**：模型轨实现内 `Map<sessionId, ClassifierContextState>`；更新者 = 判定者。
- **状态清理**：统一挂 `forgetSession`（与编排器 `histories` 同生命周期）；另加 TTL 兜底防 `Map` 泄漏。探测器共享同一 `InMemoryEngineSession` 实例，不能靠实例析构清理。
- **并发**：按 `sessionId` 分桶；同会话并发 turn 串行。core `turn()` 内天然串行，并发风险低于审议。
- **中断轮**：`input.signal?.aborted` 在分类前抛出，分类副作用不应发生；若 await 中被取消，实现须吞掉取消且**不推进**跨轮状态。
- **错误回落与状态推进**：回落规则轨时，按规则轨结果推进跨轮状态（回落也是一次有效判定）；此选择须在实现注释与 spec 中写死。
- **降级轮**：观测记录须标注 `degraded`，以便统计沿用第一段剔除降级轮的口径（风险 K）。

## 6. 风险点登记（本单相关）

| #                 | 风险                                                                                 | 本单处置                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| L 延迟预算        | 模型轨在关键路径多一次 LLM 往返；voice 流式 / debug 面板 / 自动对练同走 `turnStream` | 灰度把生效范围限定在非 `turnStream` 路径；`timeoutMs` 兜底；失效即回落规则轨。影子对照观测不写 BDI 状态、不改 delta |
| N 审计 delta 失真 | 审计并集 = 规则轨 ∪ 模型轨 → `rawDelta` 与内核 delta 对不上且多计                    | C3：审计停止自行分类，只吃内核事件；与模型轨同单交付。`wp58` :170 断言按 §3.1-13 评估处理                           |
| O 跨轮状态残留    | `Map` 分桶无清理 → 内存泄漏 + 跨场残留心理上下文                                     | 挂 `forgetSession` + TTL；分桶键用业务 `sessionId`                                                                  |
| P 考核可复现      | 模型输出不可复现，考核数据集无法逐字复现                                             | `exam` 恒 `rule_only`，写死类型，不接受配置 / 名单覆盖                                                              |
| Q 观测字段泄露    | `matchedTerms` / 解释文本入 trace → 触碰隐私红线                                     | 观测字段白名单（§4.4）；`reasonCode` 只出码；交付前隐私自检                                                         |
| R 错误码口径      | 自造 `timeout` 与既有码表语义重叠                                                    | §4.5 码表；超时归 `fetch_error`                                                                                     |
| B 三处同源        | 审议侧已内核优先；漂移面收窄到审计侧                                                 | 审计侧按 C3 收敛；审议兜底复用同源规则轨                                                                            |
| C 跨场泄露        | 带状态分类器 + 模块级单例                                                            | 业务 `sessionId` 分桶；禁用 `handleId`                                                                              |
| G strength 缩放   | `strength` 参与 12 维 delta 缩放                                                     | 首版恒 1；置信度只进观测                                                                                            |
| H 成本与 429      | 生效轨每轮必发、无闸门；样本规模约 1112 次调用，量级高 1–2 个数量级                  | 本单不接 `llm_active`；成本量级登记交付记录，不做吞吐实测                                                           |
| I 原文送 LLM      | 模型轨须送咨询师本轮文本（判定对象）                                                 | 输入最小化；只出码；不入观测表；不送整段 transcript                                                                 |
| J 口径漂移        | `eventTags` 版本不可追溯                                                             | trace 写 `modelId` + `promptVersion`                                                                                |

## 7. 闸门（执行方跑，填真实数字；pnpm，禁裸 npx）

跑前：PATH 补 `D:\Apps\Git\cmd`（避免 vitest 调 git ENOENT 假失败）；确认无 `nest start --watch` / `vite dev` 常驻；记录机器状态（CPU / 内存 / Node 版本 / 常驻进程 / 盘读延迟）。

基线（2026-11-12，HEAD `7b80615`）：8 核 / 15.9 GB 内存（5.6 GB 空闲）/ 2 个 node 常驻、无 watch；`test/engine-core test/engine-adapters test/quality` = 99 文件 / 1779 例 / 40.61s。

| 闸门            | 命令                                                                      | 判据                                                                     |
| --------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 类型（build）   | `pnpm exec tsc -p tsconfig.build.json --noEmit`                           | 0 error                                                                  |
| 类型（含 spec） | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`   | 本单相关文件 0 error（既有债另计）                                       |
| Lint            | `pnpm lint`                                                               | 0 error，记 warning 数                                                   |
| 边界护栏        | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                  | 12 例全绿；本单不改该文件                                                |
| 定向测试        | `pnpm exec vitest run test/quality test/engine-core test/engine-adapters` | 全绿；用例数 ≥ 99 文件 / 1779 例，零丢失 / 零改写                        |
| 全量            | `pnpm test`                                                               | 全绿，记总数 / skipped / failed / 墙钟 + 机器状态                        |
| core 变更面     | `git diff --stat HEAD -- src/engine-core`                                 | 恰好 §例外声明表 2 个文件；多出任何一行即打回；无新增 core 文件 / 导出名 |
| adapter 变更面  | `git diff --stat HEAD -- src/engine-adapters`                             | 只含 §3.1 B / C 清单内文件                                               |
| 前端变更面      | `git diff --stat HEAD -- src/admin-dashboard`                             | 为空                                                                     |
| 隐私自检        | 新增文件 / spec / trace 样本人工过一遍                                    | 无原文、无 prompt 全文、无 `matchedTerms`、无 `kernelState`、无展示名    |

## 8. 交付记录与回写

### 8.1 交付记录路径

`docs/worklog/completed/phase2.5/phase2.5-d1-model-classifier-implementation-YYYY-MM-DD.md`，含：一句话总结；实际方案 vs 任务单偏差（conventions §2.5）；改动文件清单（core / adapter / 测试分组）；闸门表（命令 / exit code / 真实数字 / 机器状态）；§6 风险逐条处置确认；三态装配与缺省零回归证据；观测字段与隐私自检结论；遗留项。

### 8.2 交付回写清单

- [x] 交付记录写到 §8.1 路径 → `completed/phase2.5/phase2.5-d1-model-classifier-implementation-2026-11-12.md`
- [x] 本任务单移入 `completed/phase2.5/`，状态行改完成标记并链接交付记录
- [x] 台账对应 I 项备注：模型轨对照观测已落地（附 agreement / 回落统计口径）；D-2 待派
- [x] 结构债草案 §3 总表 D-1 现状列、§4.2 进度同步
- [x] 活清单 `phase2.5-wp-list-2026-11-08.md` 与 `phase2.5-README.md` 登记
- [x] `git diff --stat HEAD -- src/engine-core` 与 `src/engine-adapters` 实测记录进交付记录
- [x] 提交分组隔离：本单文件不混入并行产物；给一行 commit message 草稿，不自行 commit / push

## 附录 · D-1 / D-2 / D-3 边界与遗留

- 顺序不可反：D-1 模型轨对照观测 → D-2 事件拆分（扩联合 + `DELTA_TABLE` 两行 + 标签 + 指标字典 + 审议白名单 + delta 接入）→ D-3 时序权重。
- 本单遗留到 D-2：两类事件 delta 方向 / 大小 / 权重斜率；缺席连续轮数阈值；模型轨结果进 `aggregateTurnDelta` 的方式；`POSITIVE_EVENTS` 是否含 `holding_present`（临床口径）；`llm_active` 事件接入。
- 本单遗留到 D-3：时序权重端口。
- D-4 cold 模式先验：DOC-2 结论为不建议单独实施，本单不复议；模型轨可见来访上一轮话语，不依赖 cold 先验。
- 既有根 `tsconfig` 类型债（D1-7，86 文件 396 条）不在本单清理，单独排期。
