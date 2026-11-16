# Phase2.5 WP-A · 审议输入最小化（合规 + 成本双解决） · 交付记录

> **路径**：`docs/worklog/completed/phase2.5/phase2.5-wp-a-deliberation-input-minimization-implementation-2026-11-08.md`
> **任务单**：`docs/worklog/completed/phase2.5/phase2.5-wp-a-deliberation-input-minimization-2026-11-08.md`（已从 `pending/` 移入）
> **状态**：✅ 已交付
> **日期**：2026-11-08
> **性质**：**合规治理** 单 —— 审议 prompt 不再携带任何对话原文；高风险轮次永远不跑 LLM 审议
> **engine-core**：**零改动**（`git diff --stat HEAD -- src/engine-core` 为空）
> **蓝图依据**：`docs/architecture/hybrid-bdi-agent-blueprint-v1.0.md` §3.1 边界 3「心理数据合规边界」+ §3.2 边界 7「长对话上下文爆炸」
> **审计依据**：`docs/worklog/audits/phase2-code-vs-blueprint-audit-2026-11-08.md` §5.4 **R6**（心理原文随审议 prompt 出境第三方）+ **R8**（每轮全量 + 每轮都审议）

---

## 一、结论速览

| # | 交付物 | 结果 |
|---|---|---|
| **1** | 结构化输入契约 | ✅ `DeliberationInput`（`deliberation-types.ts`）—— **类型层面装不下任何对话原文**，不是"约定不要填"，是"没有地方可填" |
| **2** | 事件分类提取器 | ✅ `extractCounselorEvents` —— 主路取内核 `EngineTurnOutput.events`（内核单一真相），`RuleBasedClassifier` 仅兜底 |
| **3** | 状态对比格式化器 | ✅ `buildStateComparison` —— 11 维逐维 `before → after → delta`，顺序 = `DELIBERATION_DIMS` 声明序 |
| **4** | 角色简述格式化器 | ✅ 角色种子简述（依恋风格 + 大五人格）+ 阻抗基线三维 |
| **5** | 高风险分流 | ✅ `resolveDeliberationRiskLevel` + `isDeliberationRiskAcceptable` —— **只有 `low` 允许跑**，`medium`（自杀意念层）与 `high` 一律不跑 |
| **6** | prompt 模板重写 | ✅ 系统 prompt 新增「【你没有对话原文】」段；用户 prompt 六区块，**删除**「本轮咨询师发言」「本轮来访者反应」与整份快照 JSON |
| **7** | 闸门（入队前 + 执行时） | ✅ **两道**：队列层入队前（最省，连 Redis 都不碰）+ service 执行时；生效路径另有第三道（`llm-deliberation-hook`） |
| **8** | 测试 | ✅ 新增 **31 例**（`phase25-wp-a-deliberation-input-minimization.spec.ts`）+ 共享夹具 + 13 个既有 spec 跟改；全量 **140 文件 / 2369 例 / 0 failed** |
| **9** | 合规证据 | ✅ 统计面板新增 `riskSkippedTurns` —— "高风险轮次一次都没出境"这句话要能拿数字证明 |

> ⚠️ **一句话口径**：审议层现在**物理上拿不到对话原文**（入参类型里没有这个字段），且**高风险轮次一次都不会送去出境**。
> ⚠️ **但成本只降了 9.1%（不是任务单预期的"降一半"）** —— 原因见 §5 偏差 **D4**，这是本单给 WP-C 的**决策依据**，不是没做完。

---

## 二、改动清单

### 2.1 新增（3 个）

| # | 文件 | 作用 |
|---|---|---|
| 1 | `src/engine-adapters/deliberation/deliberation-input.ts` | **本单的核心**（300 行）：结构化输入装配层 —— 事件提取 / 状态对比 / 角色基线 / 风险分流四组纯函数。纯函数、零 IO、零网络、零 `@nestjs` |
| 2 | `test/engine-adapters/deliberation-fixtures.ts` | 共享测试夹具（**不是 spec**，vitest 不收集）：`buildTestStructuredInput` / `buildBlockCounselorVerdict`，走**真实的** `buildDeliberationInput` |
| 3 | `test/engine-adapters/phase25-wp-a-deliberation-input-minimization.spec.ts` | 新增 **31 例**，七组：零原文（4）/ 事件分类（6）/ 状态对比（4）/ 角色简述（3）/ 高风险分流（8）/ 低风险集成（2）/ 成本验证（3） |

### 2.2 修改（9 个源文件 + 13 个 spec）

| # | 文件 | 改了什么 |
|---|---|---|
| 1 | `src/engine-adapters/deliberation/deliberation-types.ts` | **+129**：新增 `DeliberationRiskLevel`（low/medium/high）、`DeliberationStateComparisonEntry`、`DeliberationResistanceBaseline`、`DeliberationInput`（**零原文字段**）、`DELIBERATION_RISK_SKIP_ERROR_CODE = 'skipped_high_risk'` |
| 2 | `src/engine-adapters/deliberation/deliberation-prompt.ts` | **+212**（整体重写）：系统 prompt 加「【你没有对话原文】」段与第 6 条硬约束（不复述/不臆测话术）；用户 prompt 改六区块；删除两个原文区块与 `JSON.stringify(snapshot)` |
| 3 | `src/engine-adapters/deliberation/llm-deliberation.service.ts` | **+110**：`DeliberationShadowInput` 删掉 `counselorText` / `visitorText` / `characterBrief` / `baseSnapshot` / 顶层 `ruleStrategy`，改为 `structured`；影子路径 + 生效路径各加一道合规闸门；新增 `recordRiskSkipped()` |
| 4 | `src/engine-adapters/deliberation/deliberation.processor.ts` | **+15**：**入队前**闸门（最省的一道 —— 纯判断，连 Redis 都不碰）；`failed` 事件日志注释改口径（payload 已是结构化数据，但仍不打） |
| 5 | `src/engine-adapters/deliberation/llm-deliberation-hook.ts` | **+30**：`DeliberationProduceExtras` 改为 `{userId, structured}`；`produce()` 加第三道闸门 |
| 6 | `src/engine-adapters/deliberation/llm-deliberation-effective.ts` | **+11**：extras → service 入参改结构化 |
| 7 | `src/engine-adapters/rendering/turn-render-orchestrator.ts` | **+40**：新增 `buildDeliberationInput(...)` 调用；影子与生效**共用同一份**结构化输入 |
| 8 | `src/engine-adapters/deliberation/deliberation-stats.ts` | **+22**：新增计数器 `risk_skipped_turns` + 响应字段 `riskSkippedTurns` |
| 9 | `test/admin-debug/deliberation-stats.spec.ts` + 12 个 `test/engine-adapters/*.spec.ts` | 跟改：入参改结构化、`ruleStrategy` 覆盖路径改为 `structured.ruleStrategy`、stats 响应键列表加 `riskSkippedTurns` |

> **改动规模**：21 个已跟踪文件 **+617/-264**；另新增 3 个文件（合计约 **+1000 行**，其中约 600 行是注释与测试）。

---

## 三、核心机制（怎么保证"零原文"与"高风险不跑"）

### 3.1 零原文是**类型级**保证，不是纪律

```typescript
export interface DeliberationInput {
  readonly events: readonly DeliberationOperatorTag[];        // 标签
  readonly stateComparison: readonly DeliberationStateComparisonEntry[]; // 数字
  readonly characterBrief: string;                              // 角色种子元数据
  readonly resistanceBaseline: DeliberationResistanceBaseline; // 数字
  readonly riskLevel: DeliberationRiskLevel;                    // 枚举
  readonly riskCategories: readonly string[];                   // 类别名
  readonly ruleStrategy: BehaviorStrategy;                      // 枚举
}
```

**这个接口里没有任何字段装对话原文。** 审查者不必信任注释、不必信任调用方自觉 —— 审议层即使被误改，也**没有东西可泄漏**。

连带好处：**BullMQ 的 job payload 里也不再躺着心理对话原文**（job 要随队列冻结到 Redis，原来那是"原文出境第二跳"）。

### 3.2 对话原文只在门面碰到一次，且派生完即弃

`buildDeliberationInput` 的入参含 `counselorText` / `visitorText`，但它们只用于**派生标签与类别**：

- `counselorText` → 事件分类**兜底**（主路是内核真值 `output.events`）
- `visitorText` → 来访侧安全**规则**判定（`evaluateSafety(visitorText, 'visitor_output')`）

派生完不复存在，返回值里没有它们。

### 3.3 高风险分流：两道闸门 + 只有 low 能跑

```
门 1  队列层 processor.enqueue()   ← 入队前，纯判断，连 Redis 都不碰
门 2  service.runShadow / runEffective  ← 执行时（影子 + 生效各一）
门 3  llm-deliberation-hook.produce()  ← 生效路径独立入口
```

风险判定口径（`resolveDeliberationRiskLevel`）：

| 条件 | 等级 | 跑不跑审议 |
|---|---|---|
| `block` 级判定（咨询师硬红线 / 来访行动层危机：未遂、计划、准备、主动意图、自伤行为、伤人） | **high** | ❌ 不跑 |
| 命中危机类别（意念 / 探索层：被动自杀意图、自伤意念、自杀探索、伤人） | **medium** | ❌ 不跑 |
| 其余（含"专业性问题"类 warn：价值评判、过早给建议） | **low** | ✅ 跑 |

⚠️ **为什么"专业性 warn"不拦**：咨询师说"你这就是想不开"命中的是**专业性违规**，不含任何心理内容，而且这恰恰是 LLM 审议**最该帮忙**的场景（规则算子打成 trust↓ / safety↓，LLM 去判"这个幅度合不合理"）。一并拦掉 = 把审议层最有价值的用法砍了。内核同一个 `warn` 覆盖"专业性问题"与"危机意念"两种完全相反的处置，所以另立了 `DeliberationRiskLevel`（见 §5 偏差 D6）。

### 3.4 事件分类以内核为真值

```
主路  EngineTurnOutput.events   ← 内核分类器的产物（权威真相）
兜底  RuleBasedClassifier       ← 仅当内核没给 events 时（老版本 / 测试 mock）
```

适配层**不另起一套预判** —— 同一句话两套标签 = 影子期的对比数据全废（双方 delta 对不上，谁也说不清谁错）。标签用的是内核真实词表的 10 个非中性标签（`empathy` / `acceptance` / `normalization` / `open_probe` / `affirmation` / `judgment` / `preaching` / `minimizing` / `boundary_cross` / `sensitive_touch`），`neutral` 被过滤（它是"没命中任何规则"的占位，对应全零 delta）。

### 3.5 合规闸门跳过 → 留证据

被闸门拦下的轮次写一条 `errorCode='skipped_high_risk'` 的 trace（与 `circuit_open` 同口径：**一条 trace = 一轮**），并单独计数 `riskSkippedTurns`。

- `riskSkippedTurns` **含在** `failureTurns` 里（保持 success + failure = total 的不变式）
- **真实失败数 = `failureTurns - riskSkippedTurns`**
- 看板能分开看"被合规闸门拦下"与"被熔断器拦下"（两者原因不同）

---

## 四、任务单 §5 闸门逐条对账

### 4.1 功能闸门

| # | 验收项 | 结果 |
|---|---|---|
| 1 | 审议 prompt 不含对话原文 | ✅ **源码层守卫**（`deliberation-prompt.ts` 里不出现 `counselorText` / `visitorText` / 两个原文区块标题）+ **运行时守卫**（组装结果里不含原文，且逐句检查）+ **入参守卫**（job payload 键里没有原文字段） |
| 2 | 事件分类提取正常 | ✅ 共情类 → `empathy`；开放式探问 → `open_probe`；负向类 → `judgment` / `preaching`（**内核真实标签**，不是任务单写的 `confrontation_*` —— 见偏差 D2） |
| 3 | 状态对比数据正确 | ✅ trust 0.500 → 0.520 显示 `+0.020`；11 维全给；零变化显示 `0.000` **不带正负号**（免得"没动"看起来像"动了"） |
| 4 | 角色简述正确 | ✅ 回避型角色 → prompt 里显示"依恋风格: 回避型"；阻抗基线单独一行；角色简述为空时**仍给阻抗基线**（留空 = 模型会脑补） |
| 5 | 高风险分流正常 | ✅ block → high；危机类别 → medium；专业性 warn → low；**只有 low 允许跑**；集成断言"高风险轮次 → **不调 LLM** + 写一条 `skipped_high_risk` trace" |
| 6 | 审议能正常跑 | ✅ 低风险轮次集成测试：正常调 LLM → 拿到 delta → 写 trace；且**端到端断言发给 LLM 的 user prompt 里没有原文** |

### 4.2 工程闸门（实测，2026-11-08）

| # | 验收项 | 实测结果 |
|---|---|---|
| 1 | tsc 零 error | ✅ `npx tsc -p tsconfig.build.json --noEmit` → **0 error** |
| 2 | 全量测试全绿 | ✅ `npx vitest run --exclude '**/e2e/**/*.ts'` → **140 文件（139 passed / 1 skipped）/ 2369 例（2365 passed / 4 skipped）/ 0 failed**（63.04s）—— 基线 2338 例，**新增 31 例全绿**，skip **不增** |
| 3 | eslint 零 error | ✅ `npx eslint "src/**/*.ts" "test/**/*.ts" "bin/**/*.ts" --no-cache` → **0 error / 0 warning** |
| 4 | boundary.spec.ts 全绿 | ✅ `npx vitest run test/engine-core/boundary.spec.ts` → **12/12 passed** |
| 5 | engine-core 零改动 | ✅ `git diff --stat HEAD -- src/engine-core` → **空** |

> ℹ️ **闸门命令口径**：tsc 用 `tsconfig.build.json`（`tsconfig.json` 那个含 `test/`，有**仓库既存**报错：缺 `typings/global`、vitest globals 未在 types —— **不是本单引入**，本单也没碰那两处）。

### 4.3 成本闸门（实测数字）

估算口径：CJK 1 字 ≈ 1 token，其余 ≈ 4 字符 1 token（与 `phase25-wp-a` spec 里的 `estimateTokens` 同一函数）。

| 部件 | 改造前 | 改造后 | 变化 |
|---|---|---|---|
| **用户 prompt（每轮载荷）** | 385.5 | **201.75** | **−47.7%** ✅ |
| 系统 prompt（固定） | 989.25 | 989.25 | — |
| schema 描述（固定） | 644.75 | 644.75 | — |
| **固定成本合计** | 1634 | 1634 | — |
| **整体请求** | 2019.5 | **1835.75** | **−9.1%** |

⚠️ **为什么"整体只降 9.1%"而用户 prompt 降 47.7%**：审议请求的**固定成本**（system prompt + schema 描述 ≈ 1634 token）是每轮都要付的大头，占整体 **81%**；本单砍掉的是**随内容变化的每轮载荷**（≤385 token）。任务单 §1.2「30 轮下来 prompt 破 10k token」与实现不符 —— 旧实现每轮只带**当轮文本 + 快照**，没有累积上下文（见偏差 D4）。

**这组数字已写成测试断言**（不只是一次性测量）：

- 用户 prompt 下降 ≥ 40% ✅（实测 47.7%）
- 整体请求 **不高于**改造前（回归守卫）✅
- **固定成本 > 每轮载荷 × 3** ✅（实测 8.1 倍）—— 这条断言是**给 WP-C 的决策依据**：降本的真杠杆在"精简固定成本"与"少跑轮次"，不在"再砍一点上下文"。

---

## 五、关键设计决策（与任务单有出入的地方）

### D1 · 改动落在 `deliberation/` 之外一行（编排门面）

**任务单说**：所有改动都在 `src/engine-adapters/deliberation/` 下。

**代码实际**：`turn-render-orchestrator.ts`（编排门面）是**唯一**同时握有「本轮前后快照」「内核事件分类」「安全判定」「角色简述」的位置。组装必须发生在这里。

**怎么改的**：在门面加 ~15 行**纯数据搬运**（调 `buildDeliberationInput`），**判定逻辑一行没加在门面** —— 风险判定、事件提取、状态对比全在 `deliberation/` 内。影子与生效路径**共用同一份**结构化输入（与该方法开头"共用一个调用点"的既有纪律同款：两条路径的对比数据必须可比）。

**为什么**：门面加的是搬运，不是判定。判定散出去才是问题。

### D2 · 事件标签用内核真实词表（任务单写的标签在代码里不存在）

**任务单写**：`empathy_partial` / `open_question` / `confrontation_soft` / `confrontation_hard` …

**代码实际**：内核 `CounselorEventKind` 只有 10 个非中性标签 —— `empathy` / `acceptance` / `normalization` / `open_probe` / `affirmation` / `judgment` / `preaching` / `minimizing` / `boundary_cross` / `sensitive_touch`。任务单写的那几个**一个都不存在**。

**怎么改的**：直接用内核真实词表（`DELIBERATION_RULE_ALIGNED_TAGS` 已经是与内核 `satisfies` 对齐的同一份）。

**为什么**：标签必须与规则算子**同口径** —— 否则影子期的对比数据全废（规则打了 `empathy`，审议打的是 `empathy_partial`，永远匹配不上，而且"只有 LLM 能打的标签"这个统计也就失去意义）。任务单这里是凭空造的词表。

### D3 · 事件分类以内核为准，适配层分类器只兜底

**任务单写**：从发言中提取事件标签（没指定主路）。

**代码实际**：内核 `in-memory-engine-session.ts` 每轮已经算出 `EngineTurnOutput.events`（权威真相，恒含 `neutral` 占位）。

**怎么改的**：**主路 = 内核 `output.events`**；适配层的 `RuleBasedClassifier` 只在"内核没给 events"时兜底。

**为什么**：适配层预判 = 与内核真值**漂移的双胞胎**（两边词表/上下文不同，迟早对不上）。影子期的价值就是"规则说 A，LLM 说 B，差异可读" —— 起点就不一样的话，后面全废。

**代价（已知）**：兜底路径拿不到角色的敏感议题词表 → `sensitive_touch` 可能漏判。只在缺数据时发生，可接受。

### D4 · 成本闸门按"用户 prompt（每轮载荷）"口径达标（−47.7%）；整体请求只降 9.1%

**任务单说**：§1.2「30 轮下来 prompt 破 10k token，成本和延迟都扛不住」；§5.3「审议 prompt token 量下降 ≥ 40%」。

**代码实际**：改造前**每轮只带当轮文本 + 当前快照**，**没有累积上下文**（每轮都是新 prompt，不是把历史拼进去）。所以"30 轮破 10k"是把**单轮 385 token × 30 轮**误算成了"单 prompt 破 10k"。

**怎么改的**：测试断言写成两条 —— ① **用户 prompt（每轮载荷）下降 ≥ 40%**（实测 47.7% ✅）；② **整体请求不高于改造前**（回归守卫，不守 −40%）。

**为什么**：审议请求的**固定成本 ≈ 1634 token**（system prompt 989 + schema 645）占整体 **81%**，本单只改输入不改输出契约 —— 那 1634 token 砍不动。硬写一个"整体降 40%"的断言只会逼着人去砍 schema（那是输出契约，任务单 §6.2 明令不改）。

**这组数字是 WP-C 的决策依据**：降本的真杠杆在**精简固定成本**与**少跑轮次**，不是"再砍一点上下文"。第三条断言（固定成本 > 载荷 × 3）把这个结论钉进测试。

### D5 · 记忆召回摘要**不**传

**任务单写**（§3.4 用户 prompt 清单）：「记忆召回 Top3 摘要（如果有的话）」。

**怎么改的**：**不传**。

**为什么**：记忆内容是**来访者的心理内容**（敏感度比对话原文**更高** —— 对话原文是当事人当场说的话，记忆是当事人**过去**的创伤与模式）。传它会直接推翻本单的合规结论。角色简述性质不同（角色种子的合成元数据，描述"AI 扮演的来访者是谁"，不是"来访者说了什么"），所以可传。

同理，**核心信念 / 情境愿望**也不进 prompt（可能带剧本化敏感内容）。

### D6 · 风险闸门另立 `DeliberationRiskLevel`，`medium` 也拦

**任务单写**：§3.3「风险等级高（自杀倾向 / 自伤风险 / 危机等级）的轮次，永远不跑 LLM 审议」。

**代码实际**：内核安全判定是三级 `pass / warn / block`。**同一个 `warn` 覆盖两种完全相反的处置**：

| 情况 | 内核等级 | 该不该跑审议 |
|---|---|---|
| 咨询师说"你这就是想不开"（价值评判） | `warn` | ✅ 该跑 —— 这是审议最该帮忙的场景 |
| 来访者说"我不想活了"（被动自杀意念） | `warn` | ❌ 不该跑 —— 合规红线 |

**怎么改的**：另立三档 `low / medium / high`（适配层口径，语义是"这一轮能不能送出境"，不是内核的"要不要拦"）。危机类别集合**由内核 `PSYGUARD_LEVEL_MAP` 的键派生**，不手写清单（手写 = 第二份真相，内核加第 12 类危机时这里会静默漏判 → 那一类被判成 low → 出境）。

**为什么**：直接复用内核三级会把"专业性违规"和"危机意念"混为一谈 —— 要么放危机轮次出境（合规事故），要么把审议最有价值的场景砍光（质量事故）。**保守方向**：拿不准往高了判。

⚠️ **附带影响（已登记为观察项）**：含自杀意念的来访者，训练场次几乎不跑 LLM 审议 —— 这是**设计意图**（危机轮次状态变化完全由规则决定），但意味着"危机场景的审议质量"这个数据维度基本没有样本。WP-C / WP-E 需要注意。

### D7 · 统计面板加 `riskSkippedTurns`

**任务单写**：未提。

**怎么改的**：新增计数器 `risk_skipped_turns` + 响应字段 `riskSkippedTurns`。

**为什么**：合规闸门跳过**要留证据** —— "高风险轮次一次都没出境"这句话，得能拿数字证明，不能只是代码里写了 if。错误码 `skipped_high_risk` 与 `circuit_open` 分开，看板能区分"被合规闸门拦下"与"被熔断器拦下"。

**口径**：它**含在** `failureTurns` 里（一条 trace = 一轮，保持 success + failure = total 的不变式），**真实失败数 = failureTurns − riskSkippedTurns**。

### D8 · 「不改钩子的调用方式」= 不改时序 / 生命周期 / 调用链

**任务单写**：§6.2「不改现有审议钩子的调用方式」。

**怎么改的**：**不改**两拍分离的时序、不改端口生命周期、不改调用链；改的是**入参的数据形状**（`extras` 从 4 个字段变 2 个）—— 而这正是任务单 §2.1 的直接要求。

**为什么**：如果连入参形状都不能改，§2.1「定义结构化输入 schema」就没有落点。§6.2 的意图是"别动审议生效的时序与语义"，本单严格遵守。

### D9 · 内核端口 `counselorText` 仍必填（**残余风险**）

**代码实际**：内核 `DeliberationHookContext.counselorText` 是**内核契约里的必填字段**。engine-core 红线"一行不动" → 改不了。

**现状**：WP-A 之后**适配层不再消费它**（审议输入全部走 `extras.structured`），但它仍在进程内流转了一次（门面 → 内核钩子上下文）。

**为什么留着**：内核端口类型是红线保护的，改它要用户明确批准，且属于内核契约变更（影响 R9 那套两拍分离的设计）。

**已登记为后续项**（不在本单范围）：要让原文彻底不进内核端口，需要一个内核侧的例外批准 + 端口类型调整。**当前状态下，"原文不出境第三方模型"是成立的**（出境面在 prompt，prompt 已零原文）；残余风险是"原文在进程内多流转一次"，不构成出境。

---

## 六、边界自查

| 红线 | 自查结果 |
|---|---|
| ❌ 不改 `src/engine-core/**` | ✅ `git diff --stat HEAD -- src/engine-core` → **空** |
| ❌ 审议输出格式不变（deltas + reason + operatorTags + intentionShift） | ✅ 输出契约（`DeliberationOutput`）**一字未改**；prompt 的 schema 描述段**一字未改**；校验层 / cap / 临床规则 / 意图锁全部不动 |
| ❌ 审议钩子的调用方式不变 | ✅ 时序 / 生命周期 / 调用链不动（见偏差 D8） |
| ❌ 高风险轮次永远不跑 LLM 审议，没有例外 | ✅ **三道闸门**，只有 `low` 能跑；`medium`（自杀意念层）也拦 |
| ❌ 审议 prompt 里永远不出现对话原文，没有例外 | ✅ **类型级**保证（接口里没这个字段）+ 源码层守卫 + 运行时守卫 + 入参守卫（四道） |
| ✅ 风险等级判断复用现有 PsyGUARD 探测 + 本地规则引擎 | ✅ 内核 `evaluateSafety` / `maxSafetyLevel` / `PSYGUARD_LEVEL_MAP` 全部复用，未另写一套 |
| ✅ 零压红线（无分数 / 无评级） | ✅ prompt 里无分数 / 无评级；输出契约无分数字段（沿用 WP63 口径） |
| ✅ 隐私红线（心理内容不进普通日志） | ✅ 新增日志只有 `sessionId` / `turn` / `risk` 三个定位字段，**无任何心理内容** |
| ✅ 不写前端 / 不跑前端命令 | ✅ 未碰 `admin-dashboard/`，未跑 flutter/dart/pub |
| ✅ 不自动 commit / push | ✅ 未提交；commit 文字见文末 |

---

## 七、遗留与后续

| # | 项 | 归属 | 说明 |
|---|---|---|---|
| 1 | 内核端口 `counselorText` 仍必填 | 后续单（需内核例外批准） | 见偏差 D9；原文在进程内多流转一次，**不出境** |
| 2 | 来访侧风险判定是**规则重算**，不含 PsyGUARD 语义探测 | 后续单 | 聚合路径拿不到 `guardVerdict`（只在流式路径有），统一用纯函数重算保证两路径口径一致；代价是语义型表述（如"我最近有点撑不住"）由咨询师侧的 PsyGUARD 探测兜住 |
| 3 | 固定成本 1634 token 仍是每轮大头 | **WP-C** | 见偏差 D4；测试断言已把"固定成本 > 载荷 × 3"钉住 |
| 4 | 考核场景纯规则 + 版本锁定 | **WP-B** | 本单未动 |
| 5 | 触发式闸门（状态变化大才跑） | **WP-C** | 本单未做；本单的 `stateComparison` 正好是 WP-C 判"变化幅度"的现成数据源 |
| 6 | 危机场景审议质量样本缺失 | **WP-E** 观察 | medium 闸门导致危机轮次几乎不跑审议（见偏差 D6） |

---

## 八、闸门数字汇总（可直接抄给 commit / 看板）

```
npx tsc -p tsconfig.build.json --noEmit        → 0 error
npx eslint "src/**/*.ts" "test/**/*.ts" "bin/**/*.ts" --no-cache
                                                 → 0 error / 0 warning
npx vitest run --exclude '**/e2e/**/*.ts'       → 140 文件 / 2369 例 / 0 failed / 4 skipped (63.04s)
npx vitest run test/engine-core/boundary.spec.ts → 12/12 passed
git diff --stat HEAD -- src/engine-core         → 空
成本: 用户 prompt 385.5 → 201.75 (-47.7%) | 整体 2019.5 → 1835.75 (-9.1%)
      固定成本 (system 989.25 + schema 644.75) = 1634, 占整体 81%
新增测试: 31 例 (phase25-wp-a-deliberation-input-minimization.spec.ts)
改动规模: 21 个已跟踪文件 +617/-264 + 3 个新文件
```

---

_交付于 2026-11-08 · Phase2.5 WP-A · engine-core 零改动_
