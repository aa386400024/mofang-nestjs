# D-1 第二段 · 模型轨事件分类器实现 · 交付记录

> 2026-11-12 · 执行方：MiniMax Code · 分支 `integrate` · 基线 HEAD `7b80615`
> 任务单：[`phase2.5-d1-model-classifier-implementation-task-2026-11-12.md`](phase2.5-d1-model-classifier-implementation-task-2026-11-12.md)（已归档至本目录，状态行已改为 ✅）
> 事实源：[预研结论](../pending/phase2.5-d1-model-classifier-implementation-research-result-2026-11-12.md)（S1–S9 / F1–F5 / 风险 A–R，已验收通过）
> 前序：[D-1 第一段取证交付记录](phase2.5-d1-event-classifier-evidence-implementation-2026-11-12.md)

---

## 1. 一句话总结

模型轨事件分类器以**中间态**落地：core 只加两个**可选**契约（`EventClassifier.classifyAsync?` / `ClassifyContext.sessionId?`），adapter 新增 `src/engine-adapters/cognition/` 四个文件实现「三态模式 + 标签映射 + 跨轮状态 + 旁路观测」；**缺省零回归**（不配 env = 规则轨逐字等价），**本单不接 `llm_active` 装配**（留 D-2），**审计层停止自行分类**（C3），**9 项闸门全绿**。

---

## 2. 实际方案 vs 任务单（偏差登记）

### 2.1 结构性偏差

| #   | 任务单口径                                                                  | 实际落地                                                                                                                                                            | 理由                                                                                                                                                                                                                                                                                                                   |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | 审计改为只吃内核事件（C3），`matchedTerms` 可能变空，`wp58` :170 断言需拍板 | **审计事件改由内核事件构造，`matchedTerms` 恒 `[]`**                                                                                                                | `EngineTurnOutput.events` **只带 kind、不带 matchedTerms**（`src/engine-core/domain/engine-session.types.ts:215` + `src/engine-core/in-memory/in-memory-engine-session.ts:495`）。core 扩第 3 个文件被禁止 → 在现有 core 出参下这是**必然结果**，不是实现选择。恢复 `matchedTerms` 需扩内核出参，属 **D-2 或另开例外** |
| D-2 | 任务单 §3.1-13 授权「按拍板结果保留/调整」既有断言                          | `strength` 断言**逐字保留不变**；`matchedTerms` 断言改 `toEqual([])` 并写明语义；**新增**「审计事件集合 == 内核事件集合」断言                                       | 按授权执行。审计层不再自行重分类（C3），若保留本地规则轨重分类会给模型轨判出的事件硬安词表证据（事实性造假）                                                                                                                                                                                                           |
| D-3 | 审计端口输入形状未在 §3.1 清单内                                            | `turn-delta-audit.port.ts` **新增改动**（删 `userText`）                                                                                                            | C3 的输入形状必然变更。副作用是**心理内容不再流进审计层**（隐私面收窄），代价是 `wp58` 门面向断言同步调整                                                                                                                                                                                                              |
| D-4 | adapter 清单含 2 个新文件（§4.2 另列 `model-event-mapping.ts`）             | adapter **新增 3 个文件**（`model-event-classifier.ts` / `model-classifier-mode.config.ts` / `model-event-mapping.ts`）+ **新增 `model-classifier-observation.ts`** | §4.4 要求观测字段承载（白名单 + Redis trace + 延迟分桶），该职责若塞进 `model-event-classifier.ts` 会让单文件职责过载。登记为超出 §3.1 清单的偏差                                                                                                                                                                      |
| D-5 | 任务单写「CounselorEventKind 11 类 + neutral」                              | 实为 **11 类总 = 10 行为 + neutral**                                                                                                                                | 任务单内部数字口径偏差，按代码真值（`CORE_EVENT_KINDS` 穷尽 `Record<CounselorEventKind, true>`，11 项）登记                                                                                                                                                                                                            |
| D-6 | 装配改动面未含 `engine.tokens.ts`                                           | **用类 token（`ModelEventClassifier`）而非新增 Symbol token**                                                                                                       | `engine.tokens.ts` 不在 §3.1 清单内；类 token 走 Nest provider 注入，判定逻辑仍只有一份（`classifier.effectiveMode()` 读同一份 modeConfig）                                                                                                                                                                            |

### 2.2 工程取舍偏差

| #   | 项                                         | 实际取值                                                                                                   | 理由                                                                                                               |
| --- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| E-1 | 低置信阈值                                 | **代码常量 `0.6`**，不设 env                                                                               | 避免在未标定前多开一个 env 键（env 键越多运维面越大）。**临床口径与缺席轮数阈值全部留 D-2**                        |
| E-2 | 场景查不到（`scenarioType === undefined`） | **保守 `rule_only`**                                                                                       | 考核红线优先：无法证明不是考核场，就不烧 LLM。判定链见 §6.2                                                        |
| E-3 | LLM profile                                | **复用 `liveTurnAnalysis`** 的 maxCompletionTokens / reasoningEffort，timeout 用 env 的 `3000`             | 未新增 `COUNSELOR_LLM_PROFILES` 条目，避免在 profile 面再开一个口子；本单是分类任务不是生成长任务                  |
| E-4 | 模型轨重试                                 | **不重试**（每轮一次调用）                                                                                 | 与成本口径「生效轨每轮必发」一致；重试会放大 R-8（成本与 429）风险                                                 |
| E-5 | 模型轨 prompt 送什么                       | 仅：本轮咨询师文本 + 上一轮来访话语 + 连续计数 + 敏感议题词表 + 轮次                                       | 风险 I 的最小化缓解。**不含** transcript、**不含**解释文本                                                         |
| E-6 | 错误码口径                                 | 只用仓库既有码表；`http_5xx` 家族归一为 `http_5xx`；`timeout` 防御性归 `fetch_error`                       | 风险 R：仓库既有码表**没有** `timeout`（超时落 `fetch_error`），**绝不出现 `model_classifier_timeout` 之类自造码** |
| E-7 | 规则轨共用                                 | 适配层**共享规则轨单例 `SHARED_RULE_TRACK`**（落在 `model-event-classifier.ts`），审议兜底与模型轨回落共用 | `RuleBasedClassifier` 无状态纯函数，共享与各建输出逐字相同；回落代码**只有一处**（满足「回落逐字等价规则轨」）     |
| E-8 | 跨轮状态清理                               | `forgetSession` + **TTL 2h 兜底**                                                                          | 风险 O：`Map` 分桶必须有清理路径，两条保险                                                                         |

### 2.3 依赖方向登记

- `src/engine-adapters/deliberation/deliberation-input.ts` 现在**运行时**依赖 `../cognition/model-event-classifier.js`（取 `SHARED_RULE_TRACK`）。
- 反向只有 **type-only import**（`DeliberationScenarioType`），**无运行时环**。
- 已知代价：`deliberation-input` → `cognition/model-event-classifier` 是新增的一条运行时边。若后续 D-2 需要把 `SHARED_RULE_TRACK` 提到独立文件，只需移动常量、不改调用点。

---

## 3. 改动文件清单

### 3.1 core 纯层（例外批准，恰好 2 个文件）

| 文件                                                    | 改动                                                                                                  | 行数（`git diff --stat`） |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------- |
| `src/engine-core/domain/events/session-event.ts`        | `EventClassifier` 加**可选**成员 `classifyAsync?`；`ClassifyContext` 加**可选**字段 `sessionId?`      | +27 / −1                  |
| `src/engine-core/in-memory/in-memory-engine-session.ts` | 分类点改为「有 `classifyAsync` 则 await，否则走同步 `classify`」；透传 `sessionId: runtime.sessionId` | +15 / −2                  |

> 合计 **2 文件 / +38 / −4**。**不新增 core 文件、不新增导出名、不改 `CounselorEventKind` 联合**；`test/engine-core/boundary.spec.ts` **未改**。

### 3.2 adapter 新增（`src/engine-adapters/cognition/`，4 个文件）

| 文件                              | 职责                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model-event-mapping.ts`          | 穷尽 `Record<CounselorEventKind, true>` 导出 `CORE_EVENT_KINDS`（11 = 10 行为 + neutral）、`MODEL_SIDE_LABELS`、`MODEL_LABEL_MAPPING`（core kind 原样映射；两个旁路标签只进 sideLabels、**不映射 core kind**）；`mapModelLabels()`（未知标签丢弃 / 去重保序 / 全丢 → null）；`validateModelClassification()`（形状校验）                                                                                                                                                                                       |
| `model-classifier-mode.config.ts` | 三态 `shadow \| rule_only \| llm_active`、会话名单、超时（缺省 3000）、布尔开关；`resolveModelClassifierEffectiveMode` 非法 → `rule_only`；`resolveModelClassifierSessionMode` 判定链（exam 或场景查不到 → `rule_only` → rule_only → shadow → llm_active，名单内/名单外，**空名单 = 全量**）。4 个 env 键以**字面量**读取（不走动态前缀）                                                                                                                                                                      |
| `model-classifier-observation.ts` | `ModelClassifierObservation` **字段白名单**、`ModelClassifierObserver` 窄端口、`RedisModelClassifierObserver`（key 前缀 `model_classifier_trace`，长度前缀复合键，TTL 30 天）、`resolveLatencyBucket()`                                                                                                                                                                                                                                                                                                        |
| `model-event-classifier.ts`       | `ModelEventClassifier implements EventClassifier, ModelClassifierContextPort`；同步 `classify` = 规则轨、`classifyAsync` = 模型轨；内部持 `SHARED_RULE_TRACK`；熔断三态（阈值 3 / 冷却 60s，失败计数，**low_confidence 不计入熔断**）；`normalizeModelClassifierFallbackCode`；`computeModelClassifierAgreement`（集合语义）；跨轮状态 Map（`turnIndex` / `consecutiveNeutral` / `consecutiveColdAbsent` / 熔断计数）+ TTL 2h 兜底 + `forgetSession`；`effectiveMode()`；`recordVisitorTurn` / `forgetSession` |

### 3.3 adapter 改动（7 个文件）

| 文件                                                                      | 改动                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine-adapters/wiring/engine.providers.ts`                          | `EngineSessionTuningDeps` 加 `classifier?: EventClassifier`；抽出 `resolveEngineSessionTuningOptions()`（顺带把 complexity 从 21 降到 ≤20）                                                                                                 |
| `src/engine-adapters/wiring/engine.module.ts`                             | 新增 `ModelEventClassifier` provider（启动期求值模式，日志**只出模式名与名单规模**；配 `llm_active` 打 warn「本单未接线」）；内核会话端口**仅 shadow 模式**注入 `classifier`；编排门面**仅 shadow 模式**注入 `modelClassifierContext`       |
| `src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.service.ts` | **C3**：删除本地 `RuleBasedClassifier`；`mergeKernelOnlyEvents` 改为 `kernelEventsToSessionEvents(kernelEventKinds)`（**strength 恒 1**、matchedTerms 空）                                                                                  |
| `src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.port.ts`    | 端口去掉 `userText`（审计层不再需要原文）                                                                                                                                                                                                   |
| `src/engine-adapters/deliberation/deliberation-input.ts`                  | 兜底分类器改用 `SHARED_RULE_TRACK`                                                                                                                                                                                                          |
| `src/engine-adapters/wiring/engine-turn.service.ts`                       | `auditTurn(handleId, result)` 不再传 `userText`                                                                                                                                                                                             |
| `src/engine-adapters/rendering/turn-render-orchestrator.ts`               | 新增可选依赖 `modelClassifierContext`；`turn()` / `turnStream()` 在 `session.turn` 前调 `prepareModelClassifierContext(handleId)`（写上一轮来访话语）；`forgetSession` 调 `clearModelClassifierContext(handleId)`；新增 `lastVisitorText()` |

### 3.4 测试与配置

| 文件                                                  | 状态             | 内容                                                                                                                                                                                          |
| ----------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/engine-adapters/model-event-classifier.spec.ts` | **新增**         | **59 例**：灰度配置 / 回落各错误码 / 低置信 / 熔断 / 跨轮递增重置隔离清空 / 影子零回归 / 考核红线 / 观测隐私白名单 / 映射表 / 内核路径 E 契约与中断不推进                                     |
| `test/engine-adapters/wp58-turn-delta-audit.spec.ts`  | **改动**         | 删 8 处 `userText`；matchedTerms 断言改 `toEqual([])` 并加注释；门面向断言去 userText；**新增**「审计事件集合 == 内核事件集合」断言                                                           |
| `.env.example`                                        | **改动**（CRLF） | 新增一节「模型轨事件分类器 (D-1 第二段 · 灰度开关)」，登记 4 个 env 键（`ENGINE_MODEL_CLASSIFIER_ENABLED=false` / `_EFFECTIVE_MODE=rule_only` / `_GRAYSCALE_SESSIONS=` / `_TIMEOUT_MS=3000`） |

---

## 4. §7 闸门实测

> 命令均为 `pnpm exec ...`（**未用裸 npx**）；工作目录 `E:\Work\Project\backend\mofang-nestjs`；PowerShell 5.1。

| 闸门  | 命令                                                                      | exit code | 真实结果                                                                                                                                                                                                                                                      |
| ----- | ------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GATE1 | `pnpm exec tsc -p tsconfig.build.json --noEmit`                           | **0**     | 0 错                                                                                                                                                                                                                                                          |
| GATE2 | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`   | **2**     | `TOTAL_ERRORS=396` / `AFFECTED_FILES=86`，与既有基线（D1-7 记的 86 文件 396 条）**逐一致**；**本单相关文件 0 error**。其中 2 条 `phase25-wp-a-deliberation-input-minimization.spec.ts` 为**既有债**（调用 `resolveDeliberationRiskLevel` 少传参），非本单引入 |
| GATE3 | `pnpm lint`                                                               | **0**     | **0 error / 0 warning**                                                                                                                                                                                                                                       |
| GATE4 | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                  | **0**     | **12 例全绿**（断言⑥⑦ 未动仍绿）                                                                                                                                                                                                                              |
| GATE5 | `pnpm exec vitest run test/quality test/engine-core test/engine-adapters` | **0**     | **100 文件 / 1839 例全绿**（基线 99 文件 / 1779 例 → +1 文件 / +60 例）                                                                                                                                                                                       |
| GATE6 | `pnpm test`                                                               | **0**     | **190 passed + 1 skipped（191 文件）/ 3171 passed + 4 skipped（3175 例）**，Duration **73.08s**，墙钟 74.75s                                                                                                                                                  |
| GATE7 | `git diff --stat HEAD -- src/engine-core`                                 | **0**     | 恰好 **2 个文件**（+38 / −4），与例外批准表逐条对应                                                                                                                                                                                                           |
| GATE8 | `git diff --stat HEAD -- src/engine-adapters`                             | **0**     | **7 个已改文件**（+207 / −52）+ **新目录 `src/engine-adapters/cognition/`（4 个新文件）**                                                                                                                                                                     |
| GATE9 | `git diff --stat HEAD -- src/admin-dashboard`                             | **0**     | **空**（未碰前端）                                                                                                                                                                                                                                            |

### 4.1 机器状态（实测）

| 项       | 值                                                |
| -------- | ------------------------------------------------- |
| Node     | **v26.13.0**                                      |
| pnpm     | **9.15.0**                                        |
| CPU 核数 | 8                                                 |
| 内存     | 15.9 GB 总 / 5.8 GB 空闲                          |
| 常驻进程 | 2 个 node（78.9 MB / 34.1 MB），**无 watch 模式** |
| OS       | Windows 11 10.0.26300 / PowerShell 5.1            |

> **口径提示**：台账 `phase2.5-p1d-known-issues-2026-11-11.md` §7.3 记「D-1 交付记录 §6 机器状态栏所写 Node v26.13.0 系误报；本机实测 v22.23.2」，并规定**历史交付记录不回改，以该节为准**。本单**本会话实测仍为 v26.13.0**，与该节所记不一致 —— 两个数字都是各自会话 `node -v` 的实测值，本单**以本会话实测为准**记录，不回改历史交付记录，也不改 §7.3。若后续以同一台机器复核出现第三个值，以 `node -v` 当场实测为准。

---

## 5. §6 风险逐条处置确认

> 风险编号沿用预研结论 §6.1（第一段 A–K 关系标注）与 §6.2（本轮新增）。任务单点名要求的 **L / R / N / O / P / Q / B / C / G / H / I / J** 逐条落表；**M**（TS 编译面破坏）属 D-2，本单未触发，一并登记。

| 风险  | 内容                                              | 本单处置                                                                                                                                                                         | 证据                                                                                                                                            |
| ----- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **L** | 延迟预算：路径 E 让每轮关键路径多一次 LLM 往返    | **本单只启用 `rule_only` + `shadow`**；`shadow` 下 `classifyAsync` **返回规则轨结果**（不发 LLM），模型轨结果只进旁路观测。`llm_active` 分支仅在 core 接口层预留，**装配不注入** | `engine.module.ts`（仅 shadow 模式注入 `classifier` / `modelClassifierContext`）；`model-event-classifier.ts` 熔断三态 + `timeoutMs` 回落规则轨 |
| **R** | 任务单事实冲突：`timeout` 不是仓库既有错误码      | **不造码**：`normalizeModelClassifierFallbackCode` 把 `http_5xx` 家族归一为 `http_5xx`；`timeout` 防御性归 `fetch_error`；其余原样                                               | `model-event-classifier.ts`；测试「回落各错误码」用例                                                                                           |
| **N** | 审计 delta 失真（并集 = 规则轨 ∪ 模型轨）         | **C3 已执行**：审计**停止自行分类**，只吃内核事件；`matchedTerms` 归零（见 §2.1 D-1/D-2）                                                                                        | `turn-delta-audit.service.ts`；wp58 新增「审计事件集合 == 内核事件集合」断言                                                                    |
| **O** | 跨轮状态残留（`Map` 分桶无清理）                  | 两条保险：`forgetSession`（与 `histories` 同生命周期，由编排器 `forgetSession` 触发）+ **TTL 2h 兜底**                                                                           | `model-event-classifier.ts`；测试「跨轮…清空」用例                                                                                              |
| **P** | 考核可复现红线（模型输出不可复现）                | **`exam` 恒 `rule_only`**，写死在判定函数第一条，**不接受任何配置或名单覆盖**；场景查不到也按 `rule_only` 保守处理                                                               | `model-classifier-mode.config.ts` `resolveModelClassifierSessionMode`；测试「考核红线」用例                                                     |
| **Q** | 观测字段泄露（`matchedTerms` / 解释文本入 trace） | 观测**字段白名单**（见 §7），**不含**原文 / `matchedTerms` / 解释文本 / `kernelState` / 展示名；`fallbackReason` 只出码                                                          | `model-classifier-observation.ts`；测试「观测隐私白名单」用例                                                                                   |
| **B** | 反双胞胎：三处分类调用点 → 审计侧是唯一漂移源     | 审议侧兜底改用**共享规则轨单例 `SHARED_RULE_TRACK`**（与内核同源）；审计侧按 N 条收敛                                                                                            | `deliberation-input.ts` + `model-event-classifier.ts`                                                                                           |
| **C** | 带状态分类器 + 模块级单例 → 跨场泄露              | 分桶键用**业务 `sessionId`**（**禁用 `handleId`**），由 core 经 `ClassifyContext.sessionId?` 透传；core 缺省不出该字段 → 回落模块级单例（与现状逐字一致）                        | `in-memory-engine-session.ts`；`model-event-classifier.ts`；测试「…隔离」用例                                                                   |
| **G** | `strength` 参与 delta 缩放                        | **恒 1**：模型轨不产出置信度强度；置信度**只进观测**（`confidence` 字段），不参与任何 delta                                                                                      | `model-event-classifier.ts`；审计侧 `kernelEventsToSessionEvents` 恒 strength=1                                                                 |
| **H** | LLM 成本与 429（每轮一次）                        | 本单**不启用模型轨**（不发 LLM）→ 成本为 0；实现上预留熔断三态（阈值 3 / 冷却 60s）+ `timeoutMs`；**不重试**                                                                     | `model-event-classifier.ts`；`model-classifier-mode.config.ts`                                                                                  |
| **I** | 原文送 LLM                                        | prompt **最小化**：只送本轮咨询师文本 + 上一轮来访话语 + 连续计数 + 敏感议题词表 + 轮次；**不送 transcript、不送解释文本**；观测不落原文                                         | `model-event-classifier.ts`；§7 自检                                                                                                            |
| **J** | `eventTags` 口径漂移                              | 观测里带 `promptVersion` + `modelId`，可做版本口径核对；**core `events` 的口径本单一字未动**（模型轨结果不进 core events）                                                       | `model-classifier-observation.ts` 字段表                                                                                                        |
| **M** | TS 编译面破坏（扩 `CounselorEventKind` 联合）     | **本单未触发**：未扩联合 → `state-transition.ts` / `event-tag-labels.ts` 两处穷尽 `Record` 无需改；D-2 的改动面仍按预研结论记 **4 个文件**                                       | GATE2 通过；`CounselorEventKind` 未动                                                                                                           |

---

## 6. 三态装配与缺省零回归证据

### 6.1 三态行为

| 模式                | 内核 `classify` | 内核 `classifyAsync`         | 是否发 LLM | 是否进观测             | 是否改 core events / delta       |
| ------------------- | --------------- | ---------------------------- | ---------- | ---------------------- | -------------------------------- |
| `rule_only`（缺省） | 规则轨          | 规则轨（同步路径直接命中）   | 否         | 否                     | 否（逐字等同改造前）             |
| `shadow`            | 规则轨          | **返回规则轨结果**（中间态） | 否（本单） | 是（模型结果只进旁路） | **否**                           |
| `llm_active`        | 规则轨          | 模型轨                       | 是（预留） | 是                     | 否（**本单装配不接线**，留 D-2） |

> `shadow` 下 `classifyAsync` 返回规则轨结果是**有意的中间态**：core events 与 BDI delta **逐字不变**，模型结果只进旁路观测。这样 D-2 打开生效轨时不需要再动 core 契约。

### 6.2 会话模式判定链（唯一一份）

```text
1. 场景 = exam  或  场景查不到(undefined)  ->  rule_only   (考核红线, 优先于一切全局/名单判定)
2. 全局模式 = rule_only                      ->  rule_only   (运维说全关就全关)
3. 全局模式 = shadow                         ->  shadow
4. 全局模式 = llm_active                     ->  名单内 = llm_active, 名单外 = rule_only
                                                  (名单为空 = 全量)
```

> 装配与运行时读**同一份** `modeConfig`（`classifier.effectiveMode()`），判定只有一份实现，无第二套真相源。

### 6.3 缺省零回归证据

| 证据             | 数字                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| GATE5 定向全绿   | 100 文件 / 1839 例（基线 99 / 1779）                                                                        |
| GATE6 全量全绿   | 3171 passed + 4 skipped（3175 例，191 文件），**0 failed**                                                  |
| core 零新增      | 不新增文件、不新增导出名、不改联合 → GATE4 boundary 12 例绿                                                 |
| 规则轨逐字等价   | 模型轨回落代码**只有一处**，共用 `SHARED_RULE_TRACK`；`rule_only` 模式下内核走原同步分支                    |
| 既有规则轨基线锚 | 复用 `test/quality/d1-event-classifier-evidence.spec.ts`（39 例，逐字锁定旧分类器口径），本单**未改该文件** |

---

## 7. 观测字段与隐私自检

### 7.1 观测字段白名单（`ModelClassifierObservation`）

| 字段             | 类型                | 说明                                                         |
| ---------------- | ------------------- | ------------------------------------------------------------ |
| `tenantId`       | `string`            | 租户隔离键                                                   |
| `sessionId`      | `string`            | **业务** sessionId（非 handleId）                            |
| `turnIndex`      | `number`            | 轮次序号                                                     |
| `ruleKinds`      | `readonly string[]` | 规则轨判出的 kind 列表                                       |
| `modelKinds`     | `readonly string[]` | 模型轨判出的 kind 列表（旁路标签也进这里，不映射 core kind） |
| `agreement`      | `boolean`           | 规则轨与模型轨**集合语义**是否一致                           |
| `confidence`     | `number`            | 模型置信度，**只进观测**，不参与 delta                       |
| `fallbackReason` | `string \| null`    | 回落码，**只出码**不出解释文本                               |
| `latencyBucket`  | `string`            | 延迟分桶（`resolveLatencyBucket`）                           |
| `modelId`        | `string`            | 模型标识（口径核对用）                                       |
| `promptVersion`  | `string`            | prompt 版本（口径核对用）                                    |
| `strength`       | `number`            | **恒 1**                                                     |
| `degraded`       | `boolean`           | 降级标记（沿用第一段「统计前先剔降级轮」口径，风险 K）       |

### 7.2 隐私自检结论

| 检查项                           | 结论                                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| 咨询师 / 来访原文                | **不含**（只入 prompt，不入观测）                                                         |
| `matchedTerms`                   | **不含**（词表命中证据不进 trace）                                                        |
| 解释文本                         | **不含**（`fallbackReason` 只出码）                                                       |
| `kernelState`                    | **不含**                                                                                  |
| 展示名（title / characterLabel） | **不含**                                                                                  |
| 观测落库位置                     | Redis（key 前缀 `model_classifier_trace`，长度前缀复合键，**TTL 30 天**），**不进 MySQL** |
| 审计层心理内容                   | **本单收窄**：审计端口删 `userText`，原文不再流入审计层                                   |
| 普通日志 / crash report          | 启动期日志**只出模式名与名单规模**，不出任何会话内容                                      |

---

## 8. 遗留项

| #   | 遗留                                                                                            | 归属                                             |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| R-1 | **`llm_active` 未接线**：core 接口层已预留（`classifyAsync`），但装配**不注入**模型轨到生效路径 | **D-2**（需主控拍板后单独开工单）                |
| R-2 | **审计 `matchedTerms` 归零**：恢复需扩内核出参（第 3 个 core 文件）                             | **D-2 或另开例外**                               |
| R-3 | 两类新 kind（`holding_present` / `cold_absent`）**未进 core 联合**，故不进 delta                | **D-2**（改动面 4 个文件，含 2 处穷尽 `Record`） |
| R-4 | 缺席连续轮数阈值、delta 方向与数值、低置信临床口径                                              | **D-2 + 标定批次**                               |
| R-5 | 时序 / 节奏权重端口                                                                             | **D-3**（本单不涉及）                            |
| R-6 | 模式先验（cold 退路 D-4）                                                                       | 不复议（DOC-2 结论：不建议单独实施）             |
| R-7 | `deliberation-input.ts` → `cognition/model-event-classifier.ts` 新增运行时依赖边                | 可演进（非债）                                   |
| R-8 | 低置信阈值 `0.6` 与模型轨 prompt 模板版本需标定                                                 | **D-2**                                          |

---

## 9. 提交分组与 commit message

### 9.1 提交分组隔离

本单文件**不与并行产物混入**。建议单独成一个提交（或「core 例外 + adapter + 测试 + 文档」四段分开提交），提交前确认：

- `git status --short` 中**只有**本单的 12 个改动/新增路径 + 本单文档；
- `docs/worklog/pending/` 下另有 2 个**本任务开始前既有**的未跟踪文档（`...-research-result-...` / `...-research-minimax-...`）与 `...-task-...`，本单归档后 task 单也进 `completed/phase2.5/`；三者归属关系见 §9.3；
- `src/engine-core` 的 diff **恰好 2 个文件**，与例外批准表逐条对应。

### 9.2 commit message 草稿

```text
feat(wp-d1-2): 模型轨事件分类器中间态落地（core 两个可选契约 + adapter 三态模式 + 旁路观测）
```

> 备选（更短）：`feat(wp-d1-2): D-1 第二段 · 模型轨事件分类器中间态（shadow/rule_only，llm_active 不接线）`
>
> **不自动 commit / 不 push**（红线），请手动提交。

### 9.3 本单文档产出

| 文档                   | 去向                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 本交付记录             | `docs/worklog/completed/phase2.5/phase2.5-d1-model-classifier-implementation-2026-11-12.md`                                    |
| 任务单                 | `docs/worklog/completed/phase2.5/phase2.5-d1-model-classifier-implementation-task-2026-11-12.md`（状态行改 ✅ 并链本交付记录） |
| 预研结论（只读事实源） | 留在 `docs/worklog/pending/`（本单未改）                                                                                       |
| 台账回写               | `docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md`（I-01 / I-02 / I-18 + §7.4）                                    |
| 结构债回写             | `docs/worklog/pending/phase2.5-engine-core-structural-debt-assessment-2026-11-12.md`（§3 总表 + §4.2）                         |
| 活清单回写             | `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`（§四 独立单表）                                                          |
| 总览回写               | `docs/worklog/pending/phase2.5-README.md`（§3 当前有什么活）                                                                   |

---

> 交付记录写完时间：2026-11-12。工作区**未 commit / 未 push**。
