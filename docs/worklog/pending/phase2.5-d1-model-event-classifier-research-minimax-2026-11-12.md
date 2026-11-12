# D-1 预研 · 模型轨事件分类器（MiniMax Code 只读调查 · 零代码改动）

> 状态：**【预研任务单】**（2026-11-12）。执行方：MiniMax Code。本单是**只读代码与数据调查**：不改任何 `src/` / `test/` 文件，不改 `boundary.spec.ts`，不接 env，不跑批次，不调 LLM；输出可行性结论、样本取证口径与完整改动面，供主 AI 复核后再决定是否派开工单。
> 仓库：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`
> 事实源：`docs/worklog/pending/phase2.5-engine-core-structural-debt-assessment-2026-11-12.md` §4.2 / §6 第 3 步 / §9.3 D-1；可行性母版 `docs/worklog/completed/phase2.5/doc2-neutral-split-timing-weight-assessment-2026-11-11.md`（DOC-2）；台账 `docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md` I-01 / I-02 / I-18
> 任务性质：只读静态调查（grep + 读码 + 类型契约核对 + 离线数据位置盘点）
> 改动范围：**无**。仅写一份回复结论 md（路径见 §4）。

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `docs/team/conventions.md` §1.1（纯层 / 禁层边界）、§二（交付格式）
2. 结构债评估草案 §4.2（S-2 / D-1 / D-2 定位与边界）、§6（顺序）、§9.3（D 编号表）
3. DOC-2 备忘 A 节（I-18 现状论证、方案 1 / 方案 2、三点结构性不可达、A.4 白名单约束）
4. 本预研任务单

---

## 1. 背景与已核实事实（不要推翻，只复核证据）

### 1.1 问题定位

I-01（事件判定纯关键词子串匹配）、I-02（词表覆盖窄）、I-18（`neutral` 把"有效中性"与"冷漠缺席"合并）是**共同根因**：规则词轨结构性区分不了两类中性，模型轨待建。D-1 是该共同根因的第一步：先离线抽样钉死规则轨真实漏判 / 误判率，并把"模型轨分类器能产出 `holding_present` / `cold_absent`"的落地形态调查清楚。

顺序硬约束（草案 §6）：D-1 → D-2（事件级拆分，依赖 D-1）→ D-3（时序权重，依赖 D-2 的 `cold_absent` 先落地），顺序不可反。

### 1.2 已核实代码锚点（预研须逐处复核文件:行，行号漂移时以符号名为准）

1. `src/engine-core/cognition/rule-based-classifier.ts`
   - `:9` `RuleBasedClassifier implements EventClassifier`；`:10` `classify(text, context?)`；`:18-29` 词表循环；`:32-37` sensitive_touch 走上下文词表；`:39-41` 未命中归 `neutral`；`strength` 恒 `1`。
2. `src/engine-core/domain/events/session-event.ts`
   - `:13` `CounselorEventKind` 联合（empathy / acceptance / normalization / open_probe / affirmation / judgment / preaching / minimizing / boundary_cross / sensitive_touch / `neutral`）；`:27` `SessionEvent{kind, matchedTerms, strength}`；`:36` `ClassifyContext{sensitiveTopics?}`；`:45` `EventClassifier` 接口。
3. `src/engine-core/domain/events/event-lexicon.ts`
   - `:22` `EVENT_LEXICON`：5 正向 + 4 负向规则；子串包含匹配 + 可选正则；**无在场 / 缺席类条目**。
4. 结构化输出唯一链：`src/counselor/providers/llm-json.client.ts`
   - `:115` `CounselorLlmJsonClient`；`:129` `requestJson<T>(input)`；手写 `schemaDescription` + `validate`，统一错误码；既有调用点 11 处（visitor-pool-admin / visitor-persona / turn-analysis / supervision / practice-evaluator ×4 / informed-consent / llm-deliberation / drill-evaluator）。
5. 现有离线样本：`data/quality/anchor-sample-30.csv`（30 场 + 表头），列为 `debug_session_id, character_slug, attachment_style, turns, first_exploration_turn, dominant_label, crisis_peak_level`；**场次级标注，不含逐轮咨询师 / 来访发言文本**。

### 1.3 范围切分（D-1 与 D-2 的边界，预研须守住）

- **D-1（本单预研对象）**：调查规则轨漏判口径、样本可抽取性、模型轨分类器落地形态与接口 / 边界影响。不写实现代码，不新增事件 kind 到 core 类型联合。
- **D-2（后续单，不在本单实施）**：正式新增 `holding_present` / `cold_absent` 两个 `CounselorEventKind`、`DELTA_TABLE` 行、分类器接线；新事件的 delta 方向与数值留 D-2 标定，本预研不定任何临床数值。
- 方案 1（cold 模式先验）DOC-2 结论为**不建议单独实施**，本单不复议其去留，仅在 R8 记录其与模型轨路径的关系。

---

## 2. 预研调查项（逐项给结论 + 代码证据：文件、行号、片段）

### R1 规则轨不可达三点复核（对照 DOC-2 A.2，逐条取证）

DOC-2 列规则轨三点结构性不可达：① 分类器只看咨询师本轮文本、看不到来访上一轮话语；② `classify` 无跨轮状态，记不了连续缺席轮数；③ 词表无"在场标记"类条目。

逐项读源码确认现状证据：

- `classify` 的实际入参与调用链：grep `EventClassifier`、`RuleBasedClassifier`、`.classify(`，定位 turn 管线调用点（文件:行），确认传入了哪些上下文；来访话语是否在同一层可获得、是否被有意排除（`session-event.ts:4` 注释"不从来访输出反推，避免循环论证"）。
- 跨轮状态：分类器实例是否被跨轮复用、有无任何字段 / 闭包记忆连续轮次；调用方是否持有轮次序列。
- 词表：确认 `EVENT_LEXICON` 无在场 / 缺席标记条目；记录 D-5（`'你觉得'` ⊂ `'你觉得呢'` 子串重叠）现状证据，仅登记不在本单修。

### R2 逐轮样本数据可抽取性（取证前提）

- 定位批次快照 / 逐字稿落库位置：grep `practice-session`、`practice-turns` 实体与 service；列出与"逐轮咨询师发言文本、来访发言文本、事件标签、轮次号、角色、模式"相关的字段名与可离线抽取路径（DB 表 / data 文件 / 既有 audit 脚本，如 `scripts/ops/quality/` 下既有脚本）。
- 回答：30 轮（草案口径）或 30 场分层抽样在现有数据上是否可行；抽样维度建议（角色 × 咨询师模式 expert/cold × 轮次段）；哪些字段只有场次级、拿不到逐轮文本。
- 现有 `anchor-sample-30.csv` 的 `dominant_label` 口径能否复用为人工标注锚点，还是需另建逐轮标注。
- 隐私红线复核：离线分析与预研文档只允许出现 id、计数、比率、布尔、归一化字符数；心理对话原文不得进入文档 / 日志。列出抽取脚本应遵守的字段过滤清单。

### R3 两类事件的临床标注口径（可操作定义）

给出供人工标注使用的可操作判据（不写临床 delta 数值）：

- `holding_present`（有效中性 / 稳定在场）：结构化过渡、稳定回应、不属现有 5 类正向词事件但仍为在场；与 `empathy / acceptance / normalization / open_probe / affirmation` 的边界。
- `cold_absent`（冷漠缺席）：敷衍、无回应、语气平、持续缺席；与现有负向词事件 `judgment / preaching / minimizing / boundary_cross` 的边界（负向词事件是"说了负向话"，`cold_absent` 是"持续没给到在场回应"，二者不等同）。
- 歧义样例处理规则；`neutral` 在两类拆分后是保留为第三类还是收敛（与 D-2 方案选择相关，本项只列选项与取舍，不拍板）。
- 标注一致性：两类判据在 1-2 个构造样例上的判定演示（样例可用中性化短句，不复制真实对话原文）。

### R4 漏判 / 误判率口径与样本规模

- 对照口径：规则轨判定 vs 人工标注；按轮计还是按事件计；precision / recall / neutral 误吞比例的定义方式。
- `neutral` 被两类吞掉的比例如何计算；规则轨把 `cold_absent` 误判为 `neutral`（漏负向）与把 `holding_present` 误判为 `neutral`（漏正向）是否分开统计。
- 样本规模评估：草案"30 轮"口径下各事件类别的预期样本量与统计置信度限制；若现有批次逐轮文本不足以支撑，给出最小补样建议（哪几类角色 / 模式优先）。
- 离线对比脚本应放置位置（`scripts/ops/quality/` 既有范式）与输入输出形态（只出计数 / 比率表，不出原文）。

### R5 模型轨分类器落地形态与复用点

- 归属层：同 `EventClassifier` 接口的模型轨实现应落在 `engine-adapters/` 或业务 / 判定器层，不进 `engine-core` 纯层；grep 现有 adapter 里分类器装配位置与端口注入范式。
- LLM 复用：对照 `turn-analysis.service.ts`、`supervision.service.ts` 等既有 `requestJson` 调用范式（prompt 组织、schemaDescription、validate 手写校验、失败 errorCode 回退），给出模型轨分类器可复用的模式；结构化输出只走 `CounselorLlmJsonClient`，不另起 LLM 通道。
- 分类器输入：除咨询师本轮文本外，是否需要来访上一轮话语、连续缺席轮数；这些输入在 turn 管线哪一层可得；`strength` 字段（`session-event.ts:31`，规则轨恒 1，预留模型轨加权）作为模型轨置信度的可行性。
- 回退路径：模型轨 LLM 失败 / 超时 / schema 校验失败时，是否回落规则轨；回落判定与日志观测口径（只出码不出原文）。

### R6 接口形状与边界断言影响（对照 boundary 源码，不靠推论）

读 `test/engine-core/boundary.spec.ts` 断言⑥（barrel 导出白名单双向比对）与断言⑦（core 文件清单反向检查）源码，回答：

- D-1 阶段模型轨结果类型（含两类新 kind 的表达）放在 adapter / 业务层，是否**不需要**改 `engine-core` 的 `CounselorEventKind` 联合；core 接口形状保持不变时，断言⑥⑦是否不受影响。
- 若模型轨确需扩 `ClassifyContext`（带来访上一轮话语、缺席轮数），扩"已导出接口的可选字段"与"新增导出名 / 新增 `.ts` 文件"分别是否触发断言变红；白名单清单在 boundary 文件哪一段；这是否属于 D-6（白名单扩展授权）待拍板范围。
- 明确列出 D-1 实现时**允许触碰的层**与**禁止触碰的 core 文件**；与 D-2 开工单的切分点再次确认。

### R7 既有基线与测试策略

- 列出现有 core spec 清单与 `EventClassifier` / 事件判定相关用例（文件 + 用例名）；记录当前 core 测试用例数与 core 文件数基线（供开工单零回归对比，数字由只读命令取得，禁裸 `npx`，走 pnpm）。
- 模型轨分类器离线测试策略：mock `requestJson` 返回 fixture、不打真模型、不依赖网络；两类事件的 fixture 样例组织；跨轮状态 / 回退路径的测试点。
- 现有 `strength = 1` 假设在 spec 里有无被全形状断言锁定；模型轨返回非 1 强度时哪些既有断言需要评估（本项只评估影响面，不改断言）。

### R8 风险与待主控拍板项

分角度列风险：类型契约、工程纪律（依赖方向 / 反双胞胎）、临床语义、测试覆盖、LLM 成本与 429、隐私。

列出必须由主控拍板、本预研不替用户决定的项，至少覆盖：

1. D-1 是否拆两段：先离线取证单（钉漏判率，不含实现），模型轨实现待复核后另派开工单；还是取证 + 实现一体。
2. 两类新 kind 在 D-1 阶段的类型形态（adapter 层扩展类型 vs 等待 D-2 改 core 联合）。
3. 跨轮缺席判据所需上下文是否要求扩 core `ClassifyContext`；若要求，是否走 D-6 白名单授权流程。
4. 30 轮人工标注由谁完成（主 AI 离线对照 / 标注台锚点 / 用户本人）。
5. 模型轨与规则轨并存期的默认轨选择与灰度口径。

---

## 3. 明确禁止（违反即打回）

- 不改 `src/engine-core/**`、`src/engine-adapters/**`、`src/**` 任何源码；不改 `test/**`；不改 `boundary.spec.ts`。
- 不接 env、不改 `.env.example`、不改 module 装配 / migration / DB。
- 不跑全量批次、不调真 LLM；类型 / lint / 测试闸门本预研不需要跑（如确需静态类型核对，只用 `pnpm exec tsc` 只读检查，禁止裸 `npx`；后端命令一律走 pnpm）。
- 不碰前端目录；不自动 commit / push。
- 不写两类事件的 delta 方向 / 大小、权重斜率、缺席轮数阈值等临床数值（留 D-2 / 标定批次）。
- 不复制心理对话原文进入结论文档；发现 §1 事实与代码冲突时，写进 R8 风险项供主控判断，不静默改写。

---

## 4. 输出要求

把完整预研结论写入：

`E:\Work\Project\backend\mofang-nestjs\docs\worklog\pending\phase2.5-d1-model-event-classifier-research-result-2026-11-12.md`

结构：

1. **总结论**：可行 / 有条件可行（列条件）/ 不可行（列阻断原因）。
2. **改动面清单**：文件 | 改动内容 | 归属层（core 纯层 / adapter / 业务层 / 测试）| 依据（R 编号 + 行号）；标注哪些属 D-1、哪些必须留 D-2。
3. **R1–R8 逐项答复**：每项给结论 + 代码证据（文件 :行号 + 片段）。
4. **取证口径表**：抽样维度、样本来源、指标定义、字段过滤清单（隐私）。
5. **风险表**：风险 | 影响 | 缓解 / 备注。
6. **待拍板项**：逐项列选项与取舍，不给默认实现结论。
7. **建议开工步骤**：顺序化最小实施路径 + 应补 spec 用例清单（若主控选择取证 + 实现一体）。
8. **闸门建议**：开工单收尾应跑的命令与判据（沿用仓库 pnpm 规范；全量测试墙钟需带机器状态：是否有长驻进程、盘读取延迟）。

写完在对话里说一句"已写入文件"即可，不贴全文。结论只出码、计数与机制描述，不复制心理对话原文。
