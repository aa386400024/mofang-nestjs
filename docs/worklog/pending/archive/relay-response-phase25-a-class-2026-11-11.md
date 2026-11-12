# Phase2.5 A 类 7 张任务单 · 批量执行回执

> 日期：2026-11-11
> 执行方：MiniMax Code（后端仓库 `mofang-nestjs`，分支 `integrate`）
> 索引：`docs/worklog/pending/phase2.5-a-class-task-sheets-index-2026-11-11.md`
> 说明：7 张单按索引 §二 顺序逐单执行，**单与单之间改动隔离**；本文件只汇总结论 / 闸门真实数字 / 遗留项，不贴 diff 全文。

---

## 一、总览

| #   | 任务单               | 类别                       | 结论一句话                                                                                        | 交付记录                                                                                                                    |
| --- | -------------------- | -------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | AUDIT-D1（A1+A2+A3） | 只读审计                   | 审议链路**有活缺口**（落库指纹对审议模式说谎），`prompt_version` 与 `gate_decisions` 均为预期行为 | [audit-d1-deliberation-fingerprint](completed/phase2.5/audit-d1-deliberation-fingerprint-2026-11-11.md)                     |
| 2   | REVIEW-3（A9）       | 契约复核                   | 23 个字段组里 21 组一致；**修 2 项类型缺口**，另 1 项登记契约待修订                               | [review3-wpn-contract-alignment](completed/phase2.5/review3-wpn-contract-alignment-2026-11-11.md)                           |
| 3   | DOC-2（A7+A8）       | 评估备忘                   | I-18 **必须等判定器升级**，I-19 **有条件可行**且以 I-18 为前置                                    | [doc2-neutral-split-timing-weight-assessment](completed/phase2.5/doc2-neutral-split-timing-weight-assessment-2026-11-11.md) |
| 4   | RESID-1（A4）        | 后端小修                   | 2 个 TS2459 清零，接口字段与判定逻辑逐字未动                                                      | [resid1-stagnation-state-exports](completed/phase2.5/resid1-stagnation-state-exports-2026-11-11.md)                         |
| 5   | I-12（A5）           | 实现类                     | 会话级门槛注入缝打通，**数值全冻结、零行为变化**                                                  | [i12-per-session-threshold-plumbing](completed/phase2.5/i12-per-session-threshold-plumbing-2026-11-11.md)                   |
| 6   | I-20（A6）           | 实现类（**内核例外批准**） | valence/arousal 角色级系数端口补齐，**种子全 1.0、零行为变化**                                    | [i20-valence-arousal-role-coefficients](completed/phase2.5/i20-valence-arousal-role-coefficients-2026-11-11.md)             |
| 7   | P1e-3（A10）         | prompt 迁移                | 厂商标记清零 + 停顿 / 情绪纪律；离线三形态对比**新形态零降级**；在线切换待拍板                    | [p1e3-visitor-semantic-tag-migration](completed/phase2.5/p1e3-visitor-semantic-tag-migration-2026-11-11.md)                 |

**7 单任务单状态**：全部已移到 `docs/worklog/completed/phase2.5/`，状态行改 `✅ 已交付（2026-11-11）` 并链接交付记录。

---

## 二、逐单结论

### 1 · AUDIT-D1（A1+A2+A3，审议链路只读审计）

**A1（考核场景审议公平）= 有活缺口 → 登记 G-1（P0）**

- `scenarioType` 只存在于 auto-practice 业务层，`ScenarioRouteConfig.scenarioRoutes` **零消费方**（全仓仅 `deliberation-mode.config.ts:83` / `:163` 两处命中）；
- 运行时 `resolveSessionEffectiveMode(modeConfig, sessionId)`（`:188-191`）只看会话白名单，钩子 `llm-deliberation-hook.ts:196` / `:226` 同理 → `ENGINE_DELIBERATION_ENABLED=true` + `EFFECTIVE_MODE=llm_active` 时，标记为 exam 的场次**会真跑 LLM 审议**，而落库指纹却硬写 `deliberation_mode='rule_only'`（`inference-fingerprint.service.ts:149`）→ **记录说谎**；
- 当前未爆只因 `scenarioType='exam'` **零调用方**（全仓 17 处命中全是类型定义 / 透传 / 缺省 `'full_simulation'`）。

**引擎会话构造通道共 10 条**（进审议链 5 条 / 不进 5 条）已逐一核实：

- 进：voice `voice.service.ts:1351`；auto-practice `practice-runner.service.ts:663` → `debug-turn-engine.adapter.ts:32` → `debug-session.service.ts:456`；admin-debug 新建 `:456` / 恢复 `:688`；`engine-wiring.controller.ts:133`；
- 不进：drills / training-exercise / counselor-exam / long-term-case / crisis-practice（`src/counselor/**` 对 `EngineTurnService` / `TurnRenderOrchestrator` / `createEngineSessionPort` grep **零命中**）；
- 已排除易误判项：`counselor/providers/vpt-session-bridge.service.ts` 是落库桥，不是引擎句柄构造。

**A2（`prompt_version` 填充率）= 历史旧行默认 NULL，非缺陷**：迁移 `1714900000043` 与 runner 写入（`practice-runner.service.ts:731`）**同一提交 `5a3d1b0`** 落地；`resolvePromptVersion`（`prompt-fingerprint.ts:177-181`）回落 `'unknown'`，**不存在 undefined / NULL 落库分支**；批次行从场次行派生。边角路径登记 **G-2**（开引擎失败的 `status='failed'` 场次行 `prompt_version` 恒 NULL）。

**A3（`gate_decisions` 0 行）= 预期行为**，但登记留痕盲区 **G-3**：`engine.module.ts:410` 闸门恒挂 → `turn-render-orchestrator.ts:820-830` → `:843-854` `runGatedDeliberation` 的 `if(shadow)` / `if(effect)` 两道门 → `engine.module.ts:429` / `:431` 条件装配 → `deliberation-mode.config.ts:160` `effectiveMode: enabled ? mode : 'rule_only'` → `evaluateGate` **从不被调** → trace / MySQL 都不写。MySQL 落库口确实带上了（`deliberation-gate.module.ts:49` / `:58`；`trace.ts:137` / `:205-209`）。旁证：`eval/eval.runner.ts:298` 直接调纯函数 `evaluateGate`，不写 trace。

### 2 · REVIEW-3（A9，WP-N 前后端契约类型对齐）

契约 7 端点 × 前端 `types.ts` / `client.ts` 逐条对照：**21 / 23 字段组完全一致**；已排除一处假漂移（后端 `ANNOTATION_LABEL.Affective = 'affective'`（`:28-30`）vs 内核策略名映射键 `affective_exploration`（`:77`））。

- **C-1 已修**：`AnnotationConsistency.scope` 由可选改**必填** —— 后端 `quality-annotation.view.ts:166` 恒返回；此前「可选 + 视图层 `?? true` 兜底」会把「scope 缺失」悄悄当成「可比」。
- **C-2 不改前端**（登记契约待修订 **F-3**）：契约 §2.4「全部可空」与 §2.2 行视图（crisisPeakLevel / needsReview / durationMs 可空=否）自相矛盾；后端 DTO 三项均 `@IsOptional()`；前端类型**更严**（不可能产生非法请求），实际用法是全量保存 —— 改可选反而会打开语义未定义的「不传」路径，且三字段「不传」语义不一致（`needsReview` 不传 = **重置 false**，另两项 = 保留旧值）。
- **C-3 已修**：`incomparableReasons` / `warnings` 由 `string[]` 收窄为新增字面量联合 `ComparabilityReason`（4 值）/ `ComparabilityWarning`（2 值），与后端 `COMPARABILITY_REASON` / `COMPARABILITY_WARNING` 严格 1:1（判定器只 push 这 4+2 个码，`quality-annotation-batch.ts:171-177`）。**未动** `AnnotationBatchListResponse.warnings`（码带动态后缀 `INVALID_BATCHES_HIDDEN:<n>`）。

改动文件：`admin-dashboard/src/api/types.ts`（**唯一**）；后端 `src/` 零改动；`client.ts` 与全部 Vue 视图零改动。

### 3 · DOC-2（A7+A8，neutral 拆分 + 时序权重）

- **§A · I-18 事件级拆分 = 必须等判定器升级**：规则轨**结构性做不到** —— 分类器 `rule-based-classifier.ts:15` 只看咨询师本轮文本 + `ClassifyContext.sensitiveTopics`；无跨轮状态、无来访者话语、词表 9 规则 67 词条全是咨询师侧、无「在场标记」。**模式先验方案只消一半失真、不建议单独实施**。
- **§B · I-19 时序权重 = 有条件可行**，硬前置 5 条：① 不新增内核公开导出 / 文件；② 权重走注入端口；③ **须先落地 I-18 的 `cold_absent` 事件**；④ 权重配置须进 WP-K 配置指纹 `stateTransition` 段；⑤ 先定 cap 与权重的裁决顺序。三候选形态（轮次衰减 / 近期加权 / 事件时序窗口）比较完成 —— **三者都表达不了「缺席」** → **I-18 是 I-19 的前置**。
- **本批最重要的结构性发现（影响所有实现类任务）**：`test/engine-core/boundary.spec.ts` 断言⑥（`index.ts` 公开面**双向**白名单）与断言⑦（内核文件清单**反向**检查）意味着 —— **新增内核公开导出名 / 新增内核 `.ts` 文件 → 断言变红 → 必须改 `boundary.spec.ts` → 本批禁止**。可行路径只有「扩已导出类型的字段」或「模块私有函数」。I-12 因此把 `resolveSessionAllianceConfig` 做成**模块级导出但不进 barrel**。
- 另登记 **G-4**：词表重叠 —— `empathy` 的 `'你觉得'` 是 `open_probe` 的 `'你觉得呢'` 的子串 → 一句「你觉得呢」同时命中，单轮 trust 合计 +0.15；与 cold 场小幅正向的关联**明确标注为未证实假设**。

### 4 · RESID-1（A4，runner 状态接口 export）

`src/auto-practice/practice-runner.service.ts` 两行：`interface CrisisWindowState`（:165）→ `export interface`；`interface StagnationState`（:1070）→ `export interface`。**接口字段与判定逻辑逐字不变，运行时零行为变化**。测试：`test/auto-practice/practice-runner.spec.ts` 扩 import + 尾部新增 `describe('RESID-1 · runner 状态接口类型导出')` 2 例。

**命令偏差（需记录）**：任务单 §5.2 的脚本侧 tsc 命令在 TypeScript 6.0 下**直接失败** —— `error TS5112: tsconfig.json is present but will not be loaded if files are specified on commandline. Use '--ignoreConfig'`；已补 `--ignoreConfig`，其余 flag 逐字不变。

### 5 · I-12（A5，per-session 门槛注入缝）

**审计结论**：实例级单例堵在 `InMemoryEngineSession` 的**构造注入**层（`this.allianceConfig`），与 handle 无关；本单落点是 **per-handle**（开场解析一次固定在该句柄上，**不引入逐轮可变** → 不违反 `in-memory-engine-session.ts:224-226` 注释的顾虑）。

改动 9 个文件：

- 内核 3：`cognition/alliance-config.ts`（新增**模块级导出** `resolveSessionAllianceConfig(base?, override?)`，不进 barrel；无覆盖 → 原样返回 base 同一引用；覆盖优先 → 缺项回落单例 → 非法值回落种子，复用 `resolveAllianceThresholds`）、`domain/engine-session.types.ts`（`OpenEngineSessionInput.allianceThresholds?`，**内联结构类型**，刻意不 import cognition —— 全仓不存在 `domain/` → `cognition/` 依赖方向）、`in-memory/in-memory-engine-session.ts`（`EngineSessionRuntime.allianceConfig` + openSession 解析一次 + 3 处消费点改读）；
- 适配层 4：新增 `wiring/alliance-threshold-resolver.ts`（`SessionAllianceThresholdResolver` + `NO_SESSION_ALLIANCE_THRESHOLD_OVERRIDE`）、`engine.tokens.ts`（`ALLIANCE_THRESHOLD_RESOLVER` symbol）、`engine-turn.service.ts`（`@Optional() @Inject(...)` + `resolveThresholdOverride()`，无覆盖时**原样传 input 同一引用**，失败按无覆盖）、`engine.module.ts`（缺省 provider）；
- 测试 2：`test/engine-core/i12-session-alliance-config.spec.ts`（11 例）、`test/engine-adapters/i12-session-threshold-plumbing.spec.ts`（5 例）。

**踩坑与处置**：`pnpm exec eslint --fix` 把 `engine.module.ts` 的 import 段重排，**凭空产生 9 条 `import/order` warning**（用 `git stash` 对照实验确认 HEAD 版该文件 0 warning）→ 按 HEAD 原序逐字恢复 + 两处新 import 精准插入 → 该文件 `warningCount: 0`，diff 收敛到 9 行纯新增。已登记流程经验 L-4：**本批后续单改 import 段时不跑 `--fix`**。

另修一处残留占位符：`engine-turn.service.ts:227` 的 `${P}resolveSessionAllianceConfig${P}` → `resolveSessionAllianceConfig`（全 src 仅此一处）。

### 6 · I-20（A6，valence/arousal 角色级系数端口 —— 本批唯一内核例外批准项）

**内核改动（1 文件）** `src/engine-core/cognition/personality-modulator.ts`：文件头追加 I-20 段；`AttachmentModulation` 加两个**必填**字段 `valenceScale` / `arousalScale`；种子表四种依恋类型两列**全 1**；`NEUTRAL_ATTACHMENT` 两值 1；`resolveAttachment` 两行走既有 `sanitizeGainScale(provided.X, seed.X)`；算子加两行 —— `valence: delta.valence > 0 ? delta.valence * attachment.valenceScale : delta.valence` / `arousal: delta.arousal > 0 ? delta.arousal * attachment.arousalScale : delta.arousal`。

**适配层（1 文件）** `src/engine-adapters/wiring/personality-modulator.config.ts`：`resolveAttachment` 补 `valenceScale: fallback.valenceScale` / `arousalScale: fallback.arousalScale`（**不接 env 键**，任务单 §2 明确不在本单；种子透传，不是第二套真相源）。

**连带面 19 处**（公开必填接口扩列的下游影响，全部**只补字段不改语义**）：wp34 spec（7 构造 + 4 `toEqual`）、wp53 spec（6 构造）、wp49 spec（4 构造）、wp34-config spec（2 `toEqual`）、适配层 config 1 处。

**自写用例错误 2 处已修**：① 首跑 `wp34 spec:95` 与 `wp34-config spec:68` 精确断言失败（对象多两键）→ 补期望值；② 新 spec「系数 0 是合法值」用例断言 `arousal.toBe(0)` 失败（实得 −0.02）—— **是用例写错不是实现错**（EMPATHY 的 arousal 是负向，按「只调正向」不该被乘 0）→ 改为用 EMPATHY（valence 正 / arousal 负）与 JUDGMENT（valence 负 / arousal 正）两事件分向断言。

**为什么用必填字段而非可选字段**：可选可省 19 处连带改动，但会让「端口形状完整」不再是编译期事实；仓库既有纪律（`DELTA_DIMENSIONS` 编译期断言「名单少一维 = 静默失效」）要求结构性缺口在编译期暴露。代价就是这 19 处只补字段的连带改动。

### 7 · P1e-3（A10，visitor prompt 语义标记迁移 + 离线灰度）

**改动 3 个文件**：`src/agent/visitor/visitor.prompts.ts`（+54 / −13：`DIFFICULTY_TAG_FREQ` 三档按 snippet §二逐字替换 + 新增 `PAUSE_TAG_RULES` / `EMOTION_TAG_RULES` + 渲染顺序 `tagFreq → pause → emotion → hard rules` + 文件头与历史注释改写，**源码注释里不再出现厂商标记字面量**）、`test/agent/visitor-prompt-semantic-tags.spec.ts`（新增 12 例，断言对象是**渲染出的 prompt 字符串**）、`scripts/ops/semantic-tag-migration/compare-parse-degradation.ts`（新增，离线三形态对比脚本，**只出码与计数**）。

**解析器 / TTS 适配器 / 落库口径 / DB / migration / engine-core / 前端 / `boundary.spec.ts` 全部未动**。

**离线对比（真实跑出来的数字）** —— 语料：`data/debug-sessions/` 真实离线逐字稿 **76 份 / 802 来访者轮**（其中 19 份 / 208 轮由 `_batches/*.json` 批次索引登记为离线批次场次），复用**生产解析器** `parseSemanticTags`：

| 指标                 | 形态 A · 实测旧形态<br>（真实旧 prompt 输出，零加工） | 形态 B · 旧形态模板<br>（句首厂商标记）                                                    | 形态 C · 新形态模板<br>（语义标记 + 句中停顿 + 句末情绪） |
| -------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| L0 / L1 / L2         | 802 / 0 / 0                                           | 0 / 574 (71.6%) / 228 (28.4%)                                                              | 802 / 0 / 0                                               |
| **降级率 (L1+L2)**   | **0.0%**                                              | **100.0%（802 轮）**                                                                       | **0.0%**                                                  |
| `[pause]` 命中       | 0 轮 (0.0%)                                           | 0 轮 (0.0%)                                                                                | **802 轮 (100.0%)**                                       |
| 情绪标记命中         | 0 轮 (0.0%)                                           | 0 轮 (0.0%)                                                                                | **802 轮 (100.0%)**                                       |
| 厂商标记 转换 / 丢弃 | 0 / 0                                                 | 573 / 229                                                                                  | 0 / 0                                                     |
| 诊断码               | （无）                                                | `VENDOR_FORMAT_CONVERTED=573` · `VENDOR_MARKER_DROPPED=229` · `ILLEGAL_RATIO_EXCEEDED=228` | （无）                                                    |

**三条判定**：① 解析链路无损 —— 旧形态降级 802 轮 vs 新形态 0 轮 → **PASS**；② 能力增量 —— 新形态停顿 / 情绪命中率均 100% → **PASS**；③ **实测旧 prompt 带标记率 0 / 802** → 这次迁移是「**从 0 到 1**」而不是「换壳」。

**关键发现**：旧 prompt 教的 5 个 L1 词里有 2 个（`(sniffs)` / `(humming)`）语义层表达不了 → 被丢弃**且其字符计入非法比例** → 短回复触发 `ILLEGAL_RATIO_EXCEEDED` → **整轮 Level 2、语义字段作废**（形态 B 的 28.4%）。新形态的标记全是语义层原生支持的值，解析零降级。

**阻塞与后续**：真实 LLM 批次跑不了 —— 本地 **MySQL(3306) / Redis(6379) 均未启动**（`Test-NetConnection` 均 False），`POST /admin/api/auto-practice/batch` 需要完整服务栈。交付记录 §5.5 给了完整执行步骤（起依赖 → `pnpm migration:run` → `pnpm start:dev` → 跑批次 → 三条 SQL 看 `visitor_semantic_level` 分布 / `pauses` 命中率 / `emotion` 命中率 → grep 逐字稿确认厂商标记 0 命中）。**在线切换决策留待用户复核离线指标后拍板**，本单未做在线放量。

---

## 三、闸门真实数字（逐单 + 收尾全量）

### 3.1 逐单闸门

| 单       | 类型 (tsc build)                  | Lint                                     | 测试                                                                                                      | engine-core diff                                               | 任务特有闸门                                                                                                                                                                   |
| -------- | --------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AUDIT-D1 | exit 0 / **0 error**              | exit 0 / 0 error / **2 warning**（既有） | exit 0 / **181 文件 / 2947 例**（2943 passed + 4 skipped，0 failed，101.63s）                             | **空**                                                         | `git status --short src/` 空                                                                                                                                                   |
| REVIEW-3 | exit 0 / 0 error                  | exit 0 / 0 error / 2 warning             | exit 0 / 181 文件 / 2947 例                                                                               | 空                                                             | 前端 `type-check` **改动前后均 51 错误 / 13 文件**（`api/types.ts` 0 错；`client.ts` 2 错为既有 `:237` / `:258` Object.entries cast）；`build-only` exit 0（✓ built in 5.37s） |
| DOC-2    | exit 0 / 0 error                  | exit 0 / 0 error / 2 warning             | exit 0 / 181 文件 / 2947 例                                                                               | 空                                                             | `git status --short src/` 空                                                                                                                                                   |
| RESID-1  | exit 0 / 0 error                  | exit 0 / 0 error / 2 warning             | exit 0 / 181 文件 / **2949 例**（2945 passed + 4 skipped，87.37s）                                        | 空                                                             | 脚本侧 tsc **TS2459 2 → 0**，错误总数 **114 → 112**；定向 vitest 1 文件 / 13 例全绿                                                                                            |
| I-12     | exit 0 / 0 error                  | exit 0 / 0 error / 2 warning             | exit 0 / **183 文件**（182 passed + 1 skipped）/ **2965 例**（2961 passed + 4 skipped，71.48s）           | **3 files +80 −4**（I-12 自身，批准项）                        | 定向 vitest 3 文件 / **28 例**全绿（boundary 12 + I-12 16）；门槛数值 grep `0.6｜0.4｜0.3｜0.35｜0.25` **零命中**（数值冻结）                                                  |
| I-20     | exit 0 / 0 error                  | exit 0 / 0 error / 2 warning             | exit 0 / **184 文件**（183 passed + 1 skipped）/ **2979 例**（2975 passed + 4 skipped，119.41s）          | **4 files +139 −10**（I-20 占 1 文件 65 行，另 3 文件属 I-12） | 定向 vitest 6 文件 / **96 例**全绿（boundary 12 绿）；种子核对：新系数字面量**全为 1**，既有四列数值零改动                                                                     |
| P1e-3    | exit 0 / 0 error（含 `scripts/`） | exit 0 / 0 error / **2 warning**（既有） | exit 0 / **185 文件**（184 passed + 1 skipped）/ **2991 例**（2987 passed + 4 skipped，0 failed，74.38s） | **本单 0 文件**                                                | 厂商标记 grep **0 命中**（文件级 + 渲染级）；离线对比脚本 exit 0，三形态数字见 §二.7                                                                                           |

> 说明：lint 的 2 条 warning 全程位于 `src/auto-practice/metrics/batch-metrics.service.ts:23` / `:25`（import/order，**既有债**，按约束只登记不清理）。

### 3.2 收尾全量闸门（7 单全部落地后，2026-11-11 最终一次）

| 闸门        | 命令                                            | exit  | 结果                                                                                                    |
| ----------- | ----------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------- |
| 类型        | `pnpm exec tsc -p tsconfig.build.json --noEmit` | **0** | **0 error**                                                                                             |
| Lint        | `pnpm lint`                                     | **0** | **0 error / 2 warning**（既有）                                                                         |
| 测试        | `pnpm test`                                     | **0** | **185 文件**（184 passed + 1 skipped）/ **2991 例**（2987 passed + 4 skipped），**0 failed**，75.12s    |
| engine-core | `git diff --stat HEAD -- src/engine-core`       | —     | 4 files / +139 / −10 —— **全部属 I-12 与 I-20 两单**；其余 5 单 **0 命中**，`boundary.spec.ts` **未改** |

**用例数对账**：181 文件 / 2947 例（起点）→ RESID-1 +2 → I-12 +16（+1 文件）→ I-20 +12（+1 文件）→ P1e-3 +12（+1 文件）= **185 文件 / 2991 例**，增量与各单新增用例数**逐项吻合**，无既有用例被动。

---

## 四、遗留项汇总（只登记，不在本批修）

| 编号     | 来源        | 等级   | 内容                                                                                                                                                                       | 建议处置                                                                 |
| -------- | ----------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| G-1      | AUDIT-D1 A1 | **P0** | `scenarioType='exam'` 与 `ScenarioRouteConfig.scenarioRoutes` **零消费方** → 标记为 exam 的场次在 llm_active 下会真跑 LLM 审议，而落库指纹硬写 `rule_only`（**记录说谎**） | 下批：要么让 scenarioRoutes 真正生效，要么把指纹口径改成「实际审议模式」 |
| G-2      | AUDIT-D1 A2 | P2     | 开引擎失败的 `status='failed'` 场次行 `prompt_version` 恒 NULL                                                                                                             | 下批补回落 `'unknown'`                                                   |
| G-3      | AUDIT-D1 A3 | P2     | `rule_only` 路径**无 skip 留痕** —— `gate_decisions` 表在 rule_only 下永远 0 行，无法区分「没走审议」与「走了但没记录」                                                    | 下批：在 skip 分支补一条 trace                                           |
| G-4      | DOC-2       | P2     | 词表重叠：`empathy` 的 `'你觉得'` 是 `open_probe` 的 `'你觉得呢'` 的子串 → 一句「你觉得呢」同时命中，单轮 trust 合计 +0.15                                                 | **与 cold 场小幅正向的关联为未证实假设**，需数据验证再动词表             |
| F-3      | REVIEW-3    | P2     | 契约 §2.4「全部可空」与 §2.2 行视图自相矛盾；后端 DTO 三项 `@IsOptional()`，且三字段「不传」语义不一致（`needsReview` 不传 = 重置 false）                                  | 下批修订契约文档 + 明确三字段「不传」语义                                |
| I-12 L-3 | I-12        | P2     | `applySessionDecay` 调用点（`in-memory-engine-session.ts:589`）**未传** `allianceThresholds`                                                                               | 接真实覆盖来源时一并补                                                   |
| I-20 L-1 | I-20        | P1     | 临床倍率**未填**（本次种子全 1.0 = 零行为变化）                                                                                                                            | 等标定批次给临床倍率                                                     |
| I-20 L-2 | I-20        | P2     | env 键**未扩**（本单明确不接 env）                                                                                                                                         | 与 L-1 一并做                                                            |
| I-20 L-3 | I-20        | P2     | `positive` / `negative` / `dependency` 三维**未扩**（与 valence/arousal 不同源，顺手扩等于发明没依据的口径）                                                               | 如需扩展要另立口径                                                       |
| I-20 L-4 | I-20        | P2     | 前端 `ParamCalibrator.vue` 自带本地 4 字段副本**未同步**新系数                                                                                                             | 下批前端同步                                                             |
| I-20 L-5 | I-20        | 流程   | 公开必填接口扩列会**反复打破下游精确断言**（本次 19 处连带）                                                                                                               | 后续扩列优先考虑「可选 + 编译期断言」以外的形状，或预留连带改动预算      |
| L-P1e-1  | P1e-3       | P2     | `disgusted` / `surprised` 官方白名单内但**语义层不表达** → 被丢弃 + 记 warning（prompt 仍按 7 值教）                                                                       | 下批扩语义层情绪枚举，或收窄 prompt 白名单                               |
| L-P1e-2  | P1e-3       | —      | `neutral` 非法、`fluent` / `whisper` 为 speech-2.6 专属                                                                                                                    | 已在 prompt 纪律里排除，无需处置                                         |
| L-P1e-3  | P1e-3       | P2     | 三形态对比用 `[emotion:sad]` 模板，**未覆盖** `disgusted` / `surprised` 的丢弃告警路径                                                                                     | 真批次监控时留意 `TAG_UNKNOWN` 类诊断                                    |
| 环境阻塞 | P1e-3       | —      | 本地 **MySQL(3306) / Redis(6379) 未启动** → 真实 LLM 离线批次跑不了                                                                                                        | 用户按交付记录 §5.5 执行后回填三个数字                                   |
| 既有债   | 前端        | —      | `admin-dashboard` `type-check` **51 错误 / 13 文件**（改动前后一致，本批未引入也未清理）                                                                                   | 单独排期                                                                 |

---

## 五、提交分组与 commit message 草稿（**不自动 commit / push**）

7 单建议**各自独立 commit**，草稿在各单交付记录 §八 / §六：

```
feat(i12): 打通会话级同盟门槛注入缝（数值冻结，零行为变化）
feat(i20): 补 valence/arousal 角色级调节系数端口（种子全 1.0，零行为变化）
feat(p1e): visitor prompt 迁移语义标记（厂商标记清零 + 停顿/情绪纪律，离线三形态对比零降级）
```

其余 4 单为文档 / 前端类型 / 只读审计类，按各单交付记录里的文件清单单独成组。**由用户手动提交。**

---

## 六、流程经验（留给下一批）

- **L-4（eslint --fix 会重排 import 段并制造新告警）**：I-12 实测在「往已有 import 段中间插 import」场景下凭空产生 9 条 `import/order` warning（HEAD 版该文件 0 warning，`git stash` 对照实验确认）。**本批后续单改 import 段时不跑 `--fix`**；可靠解法是「按 HEAD 原序逐字恢复 + 精准插入」。
- **TS 6.0 命令行给文件时必须加 `--ignoreConfig`**（否则 TS5112）。
- **`import type` 被编译期擦除** → 路径写错时 vitest 不报错、tsc build 闸门（排除 `test/**`）也不报错；**类型 import 的路径要用根 tsconfig 过滤复核**（本单 P1e-3 就踩到）。
- **内核公开面是本批实现类任务的硬约束**：新增导出名 / 新增内核文件都会让 `boundary.spec.ts` 变红，而本批禁止改该文件 → 内核改动只能「扩已导出类型的字段」或「模块私有函数 / 模块级导出但不进 barrel」。
- **逐字稿在文件里不在 DB 里**（`data/debug-sessions/*.json`）—— 离线分析类任务可以直接用真实语料，不必依赖 DB。
