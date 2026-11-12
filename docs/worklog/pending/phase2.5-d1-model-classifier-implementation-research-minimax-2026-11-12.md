# D-1 第二段预研 · 模型轨事件分类器实现路径（MiniMax Code 只读调查 · 零代码改动）

> 状态：**【预研任务单】**（2026-11-12）。执行方：MiniMax Code。本单是**只读代码与类型调查**：不改任何 `src/` / `test/` 文件，不改 `boundary.spec.ts`，不接 env，不跑批次，不调真 LLM；输出模型轨分类器落地的接口草案、改动面、调用点收敛表、灰度映射与风险，供主 AI 复核、主控拍板后再派开工单。
> 仓库：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`，基线 HEAD `7b80615`。
> 事实源：
>
> - 第一段预研结论 `docs/worklog/pending/phase2.5-d1-model-event-classifier-research-result-2026-11-12.md`（R1–R8、风险 A–K、5 项待拍板，已验收；本单引用其结论，**不重做取证**）
> - 第一段交付记录 `docs/worklog/completed/phase2.5/phase2.5-d1-event-classifier-evidence-implementation-2026-11-12.md`
> - 台账 `docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md` §7.1（60 条标注对照结果）、I-01 / I-02 / I-18
> - 结构债草案 `docs/worklog/pending/phase2.5-engine-core-structural-debt-assessment-2026-11-12.md` §4.2（S-2 / D-1 / D-2）、§6（顺序）、§9.3（D 编号表）
> - 规则轨基线快照 spec `test/quality/d1-event-classifier-evidence.spec.ts`（39 例，第一段已入库）
>   任务性质：只读静态调查（grep + 读码 + 类型契约核对 + 装配链盘点）。
>   改动范围：**无**。仅写一份回复结论 md（路径见 §4）。

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `docs/team/conventions.md` §1.1（纯层 / 禁层边界）、§二（交付格式）；`AGENTS.md` §2（协作边界）、§5.1（engine-core 纯层红线）。
2. 第一段预研结论全文：重点 §1 总结论、§2 改动面清单、§3 R5（落地形态与复用点）、R6（接口形状与边界断言）、R7（测试策略）、R8（风险表）、§5 风险表、§6 待拍板项、§7 建议开工步骤、§8 闸门建议。
3. 结构债草案 §4.2（D-1 / D-2 边界）、§6 第 4–5 步（D-1 → D-2 → D-3 顺序不可反）、§9.3 D 编号表。
4. 本预研任务单。

---

## 1. 背景与已核实事实（不要推翻，只复核证据）

### 1.1 第一段已闭环、本单不再重复的结论

- 规则轨三点结构性不可达已取证成立：分类器只看咨询师本轮文本、看不到来访上一轮话语；`classify` 无跨轮状态；词表无在场 / 缺席条目（第一段 R1）。
- 逐轮样本已在盘：96 场 / 1112 轮，`neutral` 误吞上界 89.39%；60 条分层标注对照：`holding_present` 56 轮全部被规则轨吞入 `neutral`（漏正向率 1.0000，Wilson 95% [0.9358, 1.0000]）；本样本 `cold_absent` 0 轮，缺席漏判率不可估计（台账 §7.1）。
- 模型轨可挂在 core 已导出的 `EventClassifier` 端口上，会话已有 `classifier?` 注入缝；模型轨实现必须落 adapter（有 IO / LLM），不进 engine-core（第一段 R5 / R6）。
- 待深化的硬约束（第一段只列了选项，未落到签名与改动面，是本单主要调查对象）：
  - **风险 A**：`EventClassifier.classify` 是同步接口，模型轨必须 await 一次 LLM；三路径 E / A（第一段 R5 ④）+ 一条旁路预跑路径 D，本单要逐条落到签名草案与改动文件。
  - **上下文 L1 / L2**：来访上一轮话语、连续缺席轮数由谁持有（adapter 自持分桶 vs 扩 core 输入类型），本单要核门面收敛性与状态生命周期。
  - **结果类型形态**：D-2 才扩 core `CounselorEventKind` 联合；影子期模型轨的两类新标签在类型上如何安放，本单要列方案与反双胞胎面。
  - **灰度轨**：模型轨与规则轨并存期的默认轨、观测口径与开关形态，本单要对照仓库既有 R9 审议灰度范式给出映射。

### 1.2 已核实代码锚点（预研须逐处复核文件:行；行号漂移时以符号名为准）

1. `src/engine-core/domain/events/session-event.ts`
   - `EventClassifier` 接口（约 :45–46）：`classify(text: string, context?: ClassifyContext): readonly SessionEvent[]`，**同步**；`SessionEvent{kind, matchedTerms, strength}`；`ClassifyContext{sensitiveTopics?}`；`CounselorEventKind` 联合（11 类 + `neutral`，不含 `holding_present` / `cold_absent`）。
2. `src/engine-core/cognition/rule-based-classifier.ts`
   - `RuleBasedClassifier implements EventClassifier`（约 :9–10）；未命中归 `neutral`；`strength` 恒 `1`。
3. `src/engine-core/in-memory/in-memory-engine-session.ts`
   - `classifier?: EventClassifier` 可选注入（约 :192）；私有字段（约 :300）；缺省 `new RuleBasedClassifier()`（约 :325）；热路径调用点（约 :400）`this.classifier.classify(userText, {...})`。
4. 三处分类调用点（风险 B：必须同源）：
   - 内核热路径：上一条 `in-memory-engine-session.ts:400`。
   - 审计旁路：`src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.service.ts`（约 :87 私有 `new RuleBasedClassifier()`；约 :162 `classify(input.userText)`）。
   - 审议兜底：`src/engine-adapters/deliberation/deliberation-input.ts`（约 :73 `fallbackClassifier`；约 :163 `kernelEvents` 为空时回落 `fallbackClassifier.classify(counselorText)`）。
5. 会话创建 / 注入缝：`src/engine-adapters/wiring/engine.providers.ts`（约 :244–250 `createEngineSessionPort`，`new InMemoryEngineSession({...})`）。
6. turn 调用门面（S2 收敛性核实对象）：
   - `src/engine-adapters/wiring/engine-turn.service.ts:396` `orchestrator.turn(handleId, input)`
   - `src/engine-adapters/rendering/turn-render-orchestrator.ts:603`、`:678` `this.deps.session.turn(handleId, input)`
   - `src/engine-adapters/wiring/engine-wiring.controller.ts:157` `this.engine.turn(...)`
   - `src/auto-practice/practice-runner.service.ts:503` `this.engine.turn(debugSessionId, counselorReply.text)`
   - 探测器共享会话：`src/engine-adapters/wiring/risk/student-risk-gate.ts`（`createEngineSessionPort` 只造一个 `InMemoryEngineSession`）。
7. 既有灰度范式（S6 复用参照）：`src/engine-adapters/deliberation/deliberation-mode.config.ts`（三态 `shadow | rule_only | llm_active`；白名单 `ENGINE_DELIBERATION_GRAYSCALE_SESSIONS`；`resolveDeliberationEffectiveMode` / `resolveSessionEffectiveMode`）；条件装配 `src/engine-adapters/wiring/engine.module.ts`（约 :393、:444、:446，按模式挂 `deliberationHook` / `deliberation`）。
8. 结构化输出唯一链：`src/counselor/providers/llm-json.client.ts` `CounselorLlmJsonClient.requestJson<T>`；不另起 LLM 通道。
9. 边界断言：`test/engine-core/boundary.spec.ts` 断言⑥（barrel 导出白名单双向比对）、断言⑦（core 文件清单反向检查）；断言①–⑤扫 `src/engine-core` AST 纯度。

### 1.3 范围切分（本单 / D-2 / D-3 的边界，预研须守住）

- **D-1 第二段（本单预研对象）**：模型轨分类器的接口形状、上下文供给、结果类型形态、三处同源、LLM 复用与回落、灰度与观测、跨轮状态归属、测试策略与改动面清单。**只读调查，不写实现代码**。
- **D-2（后续单，不在本单实施）**：正式新增 `holding_present` / `cold_absent` 两个 `CounselorEventKind`、`DELTA_TABLE` 行、分类器接线；两类事件的 delta 方向与数值、缺席连续轮数阈值，留 D-2 + 标定批次，本预研不定任何临床数值。
- **D-3（更后，依赖 D-2）**：时序权重端口，本单不涉及。
- 方案 1（cold 模式先验，D-4）DOC-2 结论为不建议单独实施；本单不复议其去留，仅在风险表记录其与模型轨路径的关系。

---

## 2. 预研调查项（逐项给结论 + 代码证据：文件、行号、片段）

### S1 接口形状落地草案（承接风险 A；第一段只列选项，本单落到签名与改动面）

读 `session-event.ts` 的 `EventClassifier`、`ClassifyContext`、`SessionEvent`，以及 `in-memory-engine-session.ts` turn() 内约 :400 调用点的完整上下文（入参、返回事件如何进入 `EngineTurnOutput.events`、之后被谁消费）。对以下每条路径给出：接口签名草案、需改动的文件清单（core / adapter 分开列）、三处调用点各自如何适配、同步 `classify` 与异步方法的回落顺序、断言⑥⑦是否绿、是否需要主控例外批准。

- **路径 E（第一段建议项）**：在 `EventClassifier` 上加**可选**异步成员（如 `classifyAsync?`）；内核检测存在则 await，否则走同步 `classify`。评估：可选成员对既有 `RuleBasedClassifier` 与现有 core spec 的零回归影响；方法签名变更在断言⑥白名单下的判定。
- **路径 A**：接口签名整体改为 `Promise<...>`。列出破坏性面：所有实现 + 三处调用点 + 内核出参异步化的改动文件；与 E 路径的 core 改动量对比。
- **路径 D（旁路预跑，第一段未展开）**：模型轨不在 `EventClassifier` 同步接口内实现，而由 adapter 在 turn 前后异步预跑、结果进旁路观测；内核热路径仍只跑同步规则轨。评估该路径是否满足"模型轨具备产出两类事件能力"这一 D-1 前提，以及它与 S6 影子轨的关系。

只给签名草案与工程理由陈述；最终选哪条路径归主控拍板（§4 待拍板项 1）。

### S2 上下文供给落地可行性（L1 / L2）

- **门面收敛性**：按 §1.2-6 清单逐处核实，每个 turn / 会话创建点是否经过同一 adapter 门面；哪些路径绕过门面直造会话或共享会话（探测器 `student-risk-gate`）。列出"上下文必须写入"与"会话结束清理"各自的可挂载位置。
- **L1（零 core 改动）**：模型轨实现放 adapter，自己持有按 sessionId 分桶的上下文（上一轮访客文本、连续 neutral / 缺席计数）。回答：状态在何处建、何处更新、何处销毁；并发同会话、中断轮、错误回退、会话超时后是否残留；如何隔离避免跨场泄露（风险 C）。
- **L2（扩 core 输入类型）**：若扩 `ClassifyContext` 与 / 或 `EngineTurnInput` 可选字段，列出需改的 core 文件、每个字段的流向（调用门面 → 内核 → 分类器）；断言⑥⑦判定；是否属 D-6（白名单扩展授权）待拍板范围；与 S1 路径是否叠加改动。
- **可得性**：来访上一轮话语在各门面是否可得，给出字段名与透传链；拿不到的路径显式列出，不假设可得。

### S3 模型轨结果类型形态（core 联合未扩前提下）

- 核实 `SessionEvent.kind` 类型与 `events` 出参链路：`in-memory-engine-session.ts` 出参 → `debug-session.service.ts` 的 `eventTags`、审计服务标签统计、`deliberation-input.ts` 标签映射，以及报告 / 考核对事件标签的消费。列出所有直接消费 `kind` 联合字面量的位置。
- 对以下方案给改动面与取舍：
  - **a · adapter 临时类型 + 旁路**：adapter 定义模型轨结果类型（含两类新标签），结果只走旁路观测，不进 core `events`；core 联合保持原样。
  - **b · 映射回现有 kind + 旁路标签**：模型轨判定在 core 事件上仍映射到现有 11 类 / `neutral`，`holding_present` / `cold_absent` 只记进旁路记录。
  - **c · 等待 D-2**：先扩 core 联合再上模型轨（本单不实施，仅评估对 D-1 节奏的影响）。
- **反双胞胎面**：临时类型若被下游消费，D-2 改联合时需同步改哪些消费方；列出清单。本项不拍板形态（§4 待拍板项 3）。

### S4 三处分类点同源收敛（承接风险 B）

逐点列表（表格：调用点 | 文件:行 | 输入来源 | 分类器实例来源 | 同步 / 异步 | 结果用途）：内核热路径、审计旁路、审议兜底。回答：

- 模型轨接入后，三处如何保证同一判定口径（共享同一实现 / 同一配置 / 同一 fixture 基线），避免各跑各的分类器导致标签漂移。
- 审计服务与审议兜底本就是旁路 / 兜底路径：它们是否必须跑模型轨，还是保持规则轨即可；若跑，异步模型轨在这两处旁路场景下如何取值（等待 / 同步回落规则轨 / 影子旁路）。
- 三处各自对 S1 所选路径的适配约束。

### S5 LLM 轨道复用与失败回落

- `CounselorLlmJsonClient` 在 adapter 的注入方式（构造器注入 / 模块 provider / 端口）；挑 1–2 个最贴近的既有 `requestJson` 调用范式（如 turn-analysis、supervision、practice-evaluator），摘录其 prompt 组织、`schemaDescription`、手写 `validate`、错误 `errorCode` 处理方式作为参照。
- 分类 prompt 的输入字段清单与输出 schema 草案；kind 枚举在 S3 方案下如何限定（现有 11 + `neutral`；两类新标签按所选方案 a / b 表达）；手写校验点（未知 kind、空数组、多标签、低置信）。
- 失败 / 超时 / 非法 schema / 熔断时回落规则轨的判定顺序与观测码（只出码、不出原文）；可复用的既有重试 / 熔断范式位置（参照 WP66 格式校验重试、WP67 会话级熔断器）。
- 登记每轮一次 LLM 请求的成本与 429 压力面；不做吞吐实测（属批次动作，另案）。

### S6 灰度开关与影子观测

- 对照 `deliberation-mode.config.ts` 的三态 + 会话白名单 + `resolveSessionEffectiveMode` 范式，给出模型轨分类器的：模式枚举（`shadow` / `rule_only` / `llm_active` 或其等价映射）、env 键命名建议（含缺省值）、白名单解析范式、条件注入位置（`engine.providers.ts` / `engine.module.ts`）。
- **影子期口径**：模型轨结果不写 BDI 状态、不改 delta；观测写哪（Redis trace 或进程内旁路，参照审议影子 trace 范式）；观测字段清单（sessionId、turnIndex、ruleKind、modelKind、confidence、fallbackReason、耗时桶等），明确不含对话原文。
- 缺省 = 规则轨（不配 env 时与改造前逐字一致，零回归）；`strength` 第一版恒 `1`（承接第一段 R7 结论：先不做模型轨加权，避免首次灰度即改数值）。
- 评估模型轨首版是"只观测不落 delta"还是"带 delta 接入"；取舍列入待拍板项（§4 第 5 项），本单不替主控决定。

### S7 跨轮缺席状态与连续性判据的状态归属

- `cold_absent` 的连续性判定需要哪些跨轮状态（连续中性 / 缺席轮数窗口、重置条件：命中任一正向或负向事件、来访回应、会话边界）；这些状态在 L1 分桶与 L2 输入下分别如何存放、由谁更新。
- 明确边界：本单只调查**状态结构与归属**，不标定缺席连续轮数阈值、不定任何 delta 方向或数值（留 D-2 + 标定批次）；台账 §4 P1 所列候选系数（如 ±0.002）仅为历史候选，本单不沿用、不确认。

### S8 测试策略与基线复用

- 复用第一段 39 例规则轨基线快照 spec（`test/quality/d1-event-classifier-evidence.spec.ts`）作为零回归锚；说明模型轨测试如何 mock `requestJson`（注入点、不打真模型、不依赖网络）。
- fixture 组织：命中正向 / 命中负向 / `neutral → holding_present` / `neutral → cold_absent` / 多标签 / 低置信 / 回落；fixture 只放构造样例，不得放真实逐字稿（隐私 + 双盲）。
- 必须覆盖的测试点：跨轮状态推进与重置、三处同源、影子结果不写状态、失败回落规则轨、灰度缺省零回归。
- 只读复核现有 core / adapter 测试用例数与文件数基线（命令走 pnpm，禁裸 `npx`；数字由只读命令取得）；评估 `strength = 1` 假设在既有 spec 里的锁定面，模型轨返回非 1 强度时哪些既有断言需评估（只评估影响面，不改断言）。

### S9 改动面清单与 D-1 / D-2 边界

汇总表：文件 | 改动内容 | 归属层（core 纯层 / adapter / 业务层 / 测试）| 依据（S 编号 + 行号）| 是否属 D-1 实现范围。并明确：

- 哪些改动在 D-1 第二段实现范围内，哪些必须留 D-2（扩 `CounselorEventKind` 联合、`DELTA_TABLE` 行、事件拆分接线、delta 方向与数值）、哪些属 D-3。
- 若走 L2 或 E 路径，需主控例外批准的 core 文件逐项列出，并对照断言⑥⑦说明绿 / 红判定依据。

---

## 3. 明确禁止（违反即打回）

- 不改 `src/engine-core/**`、`src/engine-adapters/**`、`src/**` 任何源码；不改 `test/**`；不改 `boundary.spec.ts`。
- 不接 env、不改 `.env.example`、不改 module 装配 / migration / DB。
- 不跑全量批次、不调真 LLM；类型 / lint / 测试闸门本预研不需要跑（如确需静态类型核对，只用 `pnpm exec tsc` 只读检查，禁止裸 `npx`；后端命令一律走 pnpm）。
- 不碰前端目录（`admin-dashboard/`、Flutter）；不自动 commit / push。
- 不写两类事件的 delta 方向 / 大小、权重斜率、缺席轮数阈值等临床数值（留 D-2 / 标定批次）。
- 不复制心理对话原文进入结论文档；不重做第一段已闭环的取证统计（引用台账 §7.1 与第一段结论即可）。
- 发现 §1 事实与代码冲突时，写进风险项供主控判断，不静默改写。

---

## 4. 输出要求

把完整预研结论写入：

`E:\Work\Project\backend\mofang-nestjs\docs\worklog\pending\phase2.5-d1-model-classifier-implementation-research-result-2026-11-12.md`

结构：

1. **总结论**：可行 / 有条件可行（列条件）/ 不可行（列阻断原因）。
2. **改动面清单**：文件 | 改动内容 | 归属层 | 依据（S 编号 + 行号）；标注哪些属 D-1、哪些必须留 D-2 / D-3。
3. **S1–S9 逐项答复**：每项给结论 + 代码证据（文件 :行号 + 片段）；签名 / 类型草案单列小节。
4. **接口与类型草案**：S1 各路径签名、S3 各方案类型形状、S6 模式与观测字段表。
5. **门面与调用点收敛表**：§1.2-6 各点的上下文可得性、同步 / 异步、模型轨接入方式。
6. **风险表**：风险 | 影响 | 缓解 / 备注 | 归属单；与第一段风险 A–K 的对应关系逐条标注（新增 / 延续 / 已消解）。
7. **待拍板项**（逐项列选项与取舍，不给默认实现结论）：
   1. 接口路径 E / A / D（S1）。
   2. 上下文供给 L1 / L2（S2）。
   3. 结果类型形态 a / b / c（S3）。
   4. 灰度轨选择：影子观测 / 白名单 / 全量（S6）。
   5. 模型轨首版是否只观测不落 delta（S6）。
8. **建议开工步骤**：顺序化最小实施路径 + 应补 spec 用例清单（供主控拍板后写开工单）。
9. **闸门建议**：开工单收尾应跑的命令与判据（沿用仓库 pnpm 规范；全量测试墙钟需带机器状态：是否有长驻进程、盘读取延迟）。

写完在对话里说一句"已写入文件"即可，不贴全文。结论只出码、计数与机制描述，不复制心理对话原文。
