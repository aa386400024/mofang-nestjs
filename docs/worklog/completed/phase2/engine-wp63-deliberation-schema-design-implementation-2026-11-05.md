# WP63 交付记录 — 审议输出 Schema 与可解释性设计

> 状态: ✅ 已交付
> 任务单: [`wp63-deliberation-schema-design-2026-11-05.md`](wp63-deliberation-schema-design-2026-11-05.md)
> 日期: 2026-11-05
> 红线: ✅ **未改 engine-core** —— `git diff --stat HEAD -- src/engine-core` **为空**（任务单 §6.2 明确要求）
> 边界断言: ✅ `boundary.spec.ts` 12 例全绿（11 条不变量 + 1 条扫描自检）
> 北极星: [`../../../architecture/hybrid-bdi-agent-blueprint-v1.0.md`](../../../architecture/hybrid-bdi-agent-blueprint-v1.0.md) §2.2 审议引擎层

---

## 1. 实际改了哪些文件

### 1.1 适配层：2 增（与任务单 §5.2 清单**完全一致**，一个不多一个不少）

| 文件 | 改了什么 |
|---|---|
| `src/engine-adapters/deliberation/deliberation-types.ts` | **新增**：`DELIBERATION_DIMS`(11) + `DeliberationDim` / `DELIBERATION_RULE_ALIGNED_TAGS`(10) + `DELIBERATION_LLM_ONLY_TAGS`(3) + `DELIBERATION_OPERATOR_TAGS`(13) + `DeliberationOperatorTag` / `DeliberationMode` / `DELIBERATION_MAX_ABS_DELTA` / `DELIBERATION_REASON_MAX_CHARS` / `DELIBERATION_SUMMARY_MAX_CHARS` / `DeliberationDeltaEntry` / `DeliberationOutput` |
| `src/engine-adapters/deliberation/deliberation-prompt.ts` | **新增**：`buildDeliberationSystemPrompt(mode)` / `buildDeliberationUserPrompt(input)` / `buildDeliberationSchemaDescription()` |

### 1.2 测试：1 增

| 文件 | 改了什么 |
|---|---|
| `test/engine-adapters/wp63-deliberation-schema.spec.ts` | **新增 30 例**：维度集合与内核 `DeltaVector` 逐字一致 / 标签分组与内核 `CounselorEventKind` 一致 / 两种模式的措辞差异 / prompt 组装 / 空发言占位 / schema 描述与常量一致 / 输出契约形状 |

### 1.3 文档

| 文件 | 改了什么 |
|---|---|
| `docs/worklog/pending/wp63-deliberation-schema-design-2026-11-05.md` | 状态行改 `✅ 已交付` + 指向交付记录；追加「§9 交付后补记」偏差表 → 移入 `completed/phase2/` |
| `docs/worklog/pending/phase2-wp-list-2026-11-03.md` | WP63 行 ✅ + 交付记录链接；统计进度 19/41 → 20/41 |
| `docs/worklog/pending/phase2-overview-2026-11-03.md` | PoC 组表格 P1-13 行标记 `WP63 ✅ 2026-11-05` + 一句话落地口径（该表无独立进度行） |
| `docs/worklog/README.md` | Phase2 已开工列表 +WP63；进度回写 20/41；目录结构说明 +WP63 |

### 1.4 **零改动**（逐条核实过）

- `src/engine-core/**` —— **一行未动**（`git diff --stat HEAD -- src/engine-core` = 空）
- **既有源文件一行未动** —— 本单是**纯新增**：3 个新文件，0 个既有文件被修改
  （`git status` 里本单相关条目全是 `??` 新增，没有一条 `M`）—— 这是本单最强的零回归论据
- `.env.example` / `typings/global.d.ts` —— **一行未动**（本期无配置项，任务单 §5.4 明确）
- 无 migration / 无 entity / 无 provider 注册 / **无管道接线**（任务单 §1.3：本期只定义契约）
- `CounselorLlmJsonClient` —— **一行未动**（本单只出 prompt 零件，不碰调用链）

---

## 2. 关键设计决策（与任务单有出入的地方 + 为什么）

### 2.1 决策：`operatorTags` 从任务单的 **12 个改成 13 个** —— 补回 `sensitive_touch`（**最重要的偏差**）

任务单 §3.2 列了「9 个与现有事件类型对齐 + 3 个 LLM 独有标签」= 12 个。**grep 核实后发现那 9 个漏了一个**：

| 内核 `CounselorEventKind` | `DELTA_TABLE` 里的 delta | 是否进标签枚举 |
|---|---|---|
| empathy / acceptance / normalization / open_probe / affirmation | 真实非零 | ✅ 5 个 |
| judgment / preaching / minimizing / boundary_cross | 真实非零 | ✅ 4 个 |
| **`sensitive_touch`** | **真实非零**（arousal +0.15 / safety -0.01 / verbal +0.05 / depth +0.05 / style +0.06 / valence -0.05 / negative +0.04） | ✅ **补上** |
| `neutral` | **全零**（`DELTA_TABLE` 里就是 `ZERO`） | ❌ 不进 |

**为什么必须补 `sensitive_touch`**：

1. **影子模式对比会永远匹配不上** —— 规则算子能打 `sensitive_touch` 标签、审议侧不能打，那一类 delta 在对比表里**根本对不齐**，而它恰恰是最有临床信息的一类（话题本身的紧绷感）；
2. **掐掉了 LLM 最该贡献的信号** —— LLM 能读懂"咨询师把话题引到了创伤"，规则算子只能靠词表撞；不让它打这个标签，它就只能乱打 `neutral`（不在枚举里）或硬塞一个别的标签；
3. **它不是"硬安全维度"** —— 触碰敏感议题的 delta 是 arousal/safety 的**软**变化（WP26 的 cap 体系里它有普通的一维档位），跟"自杀倾向 / 危机等级"（只走规则）完全不是一回事。任务单 §4.3 的"硬安全不进审议"这条**不适用于它**。

**为什么 `neutral` 不进**：它在 `DELTA_TABLE` 里是全零 delta，是"没命中任何规则"的占位，**不会**成为任何一条 delta 的成因。把它塞进标签枚举 = 让模型给一条 delta 打"我什么也没匹配到"的标签 = 纯噪声。

**结论**：对齐组 = 内核 11 个事件类型**去掉 `neutral`** = **10 个**；全集 = 10 + 3 = **13 个**。

> ⚠️ 这是对任务单 §6.3.2「枚举值数量正确（12 个）」的**明确偏差**，已登记在任务单 §9 偏差表第 1 条。

### 2.2 决策：标签枚举**拆成两组单列**，全集由两组拼出（任务单是扁平数组）

任务单 §3.2 给的是一个扁平数组（12 个值）。本单拆成：

- `DELIBERATION_RULE_ALIGNED_TAGS`（10 个，规则算子也会打）；
- `DELIBERATION_LLM_ONLY_TAGS`（3 个，只有 LLM 能打）；
- `DELIBERATION_OPERATOR_TAGS = [...前者, ...后者]`（13 个，全集）。

**为什么拆**：影子模式的核心用法是**对比**，而"只有 LLM 打了的标签占多少" = "规则算子覆盖不了的场景有多少" = **审议层存在的价值证据**（任务单 §4.3 的原话）。这个统计要能一眼算出来，两组就得是**两个可分别引用的常量**；混在一个数组里，统计代码就得硬编码一张"哪些是 LLM 独有"的表 —— 那又是一份会漂移的真相源。

全集用**拼接**而不是**再写一遍**，保证"清单只有一份"。

### 2.3 决策：维度与标签各加一道 **`satisfies` 编译期约束**（任务单只要求"逐字一致"）

```ts
export const DELIBERATION_DIMS = [...] as const satisfies readonly (keyof DeltaVector)[];
export const DELIBERATION_RULE_ALIGNED_TAGS = [...] as const satisfies readonly CounselorEventKind[];
```

**为什么加**：`satisfies` 让"写错一个键名"（比如把 `valence` 写成 `emotionValence`、或凭空造一个标签）**编译期就红**，不用等运行时才发现模型吐了非法维度。这是仓库既有治本（`DELTA_TABLE` 的 `Record<CounselorEventKind, DeltaVector>` 就是同款：两边多一个少一个，类型检查当场报错）。

**但 `satisfies` 只保证"子集"方向**（每个审议维度都是内核的键），**不保证"不多不少"**（内核加了维度，审议要不要跟？）。所以**反向由单测守**：单测用一份 `satisfies DeltaVector` 的字面量取 `Object.keys()` 与 `DELIBERATION_DIMS` 比对 —— 两条方向分开守，合成一条就会漏掉一半。

> ℹ️ 注：闸门里的 `tsc -p tsconfig.build.json` **排除** `test/`（见 `tsconfig.build.json` 的 `exclude`），所以测试文件里的那份 `satisfies` 由 IDE / `tsc -p tsconfig.json` 兜底，**不在闸门内**；闸门内的真保证是**运行时**的键集合比对。两条都在。

### 2.4 决策：**不提供**"合并版 system prompt"函数（任务单 §3.4 说"拼到 system prompt 尾部"）

`CounselorLlmJsonClient` 已经把 `schemaDescription` 拼到 system prompt 尾部（`src/counselor/providers/llm-json.client.ts:115`）：

```ts
content: `${input.systemPrompt}\n\n${input.schemaDescription}\n\n只输出一个 JSON 对象, …`,
```

所以本单只出**三个零件**（system / user / schemaDescription），拼装由 client **独家**负责。再造一个"合并版" = 两种拼法并存，WP64 一不留神就把 schema 拼两遍（模型收到两遍 schema 未必出错，但那是**两份 prompt 真相**）。测试用"两个零件拼起来自洽"来验证 §6.1 的验收项，不新增第三个函数。

### 2.5 决策：schema 描述里的枚举清单**从常量生成**，不手写

`dimension` 与 `operatorTags` 的合法取值清单直接由 `DELIBERATION_DIMS` / `DELIBERATION_RULE_ALIGNED_TAGS` / `DELIBERATION_LLM_ONLY_TAGS` 生成（连数量也是 `.length` 算出来的）。

**为什么不手写**：手写一份 = 两份真相 —— 内核加了维度而 prompt 没跟上，模型就会输出非法维度，而这种错误在影子模式里**不会立刻炸**（它只是让 LLM 少判一个维度）。生成 = 不可能漂移。

### 2.6 决策：硬约束里显式写"**不要输出分数 / 评级 / 对错**"（任务单未提）

零压红线（`AGENTS.md` §5.3）：自由练习**无分数 / 无对错 / 无评级**，分数只允许出现在 MCQ 备考频道。

本单把它落成 prompt 里的一条硬约束（两种模式都落）：

> `7. 不要输出分数、评级或对错判断——你的产物只有 delta 建议、标签和理由。`

**为什么两种模式都要写**：`DeliberationOutput` 的形状在两种模式下**完全相同**（只有 prompt 的措辞严格度不同），所以"不许产出分数"是**契约级**的约束，不是某个模式的特例。任务单 §3.3 只在考核模式段里提了"更严格"，没把"不产分数"写成硬约束 —— 本单补上（这是红线的直接落点）。

### 2.7 决策：空发言写**占位说明**，不留空串

`buildDeliberationUserPrompt` 对空的 `counselorText` / `visitorText` / `characterBrief` / `currentSnapshotJson` 写「（本轮咨询师没有发言）」这类明文，而不是留空。

**为什么**：留空 = 模型看到一段没有回答的提问，很可能**脑补**一个回答（然后把脑补的内容写进 delta 的理由里）。显式写明"没有"是事实，模型不会替它编。这与仓库既有的 `formatRollingSummaryInput`（滚动摘要那侧）**同款治本**，不另创一套。

### 2.8 决策：delta 幅度上限用**粗口径 0.2**，不在 prompt 里假装逐维精确（任务单说"和 cap 对齐"）

内核 `DEFAULT_DELTA_CAP_CONFIG` 是**逐维、且上下向不对称**的：

| 维度组 | 上向 | 下向 |
|---|---|---|
| trust / safety / bond / valence | +0.20 | -0.30（损失厌恶） |
| arousal + 阻抗三维（verbal / depth / style） | +0.20 | -0.20 |
| 移情三维（positive / negative / dependency） | +0.15 | **-0.15** |

任务单 §3.3 的「不超过 0.2（单轮上限，和 cap 对齐）」是**简化**：移情三维的精确上限其实是 **0.15**。

本单的处理：prompt 里写 `0.2`（= 上向 cap 的统一档，作为一个粗口径），**并在交付记录与代码注释里如实写明**"移情三维精确上限是 0.15，超出部分由下游约束校验层 clamp"。理由：

- 审议层只产出**建议**，它连内核的 cap 端口都不碰，更别说改状态 —— clamp 是**下游约束校验层**（北极星 §2.3）的职责；
- 把逐维 cap 塞进 prompt（11 维 × 上下向 = 22 个数）会让模型多一层"查表"负担，而它本来就只是"建议幅度"的粗 guidance；
- **但绝不能让 prompt 假装自己精确** —— 注释里写清楚，别让下一个人以为"过了 0.2 就一定合法"。

### 2.9 决策：输出形状跟**任务单**，不跟北极星示例（两者不一致）

北极星 §2.2 的示例输出是：

```json
{ "deltas": { "trust": 0.018, "safety": 0.005, … }, "reason": "…", "operatorTags": ["empathy_partial", …], "intentionShift": null }
```

任务单 §3.1 的是：

```json
{ "deltas": [ { "dimension": "trust", "delta": 0.08, "operatorTags": ["empathy"], "reason": "…" } ], "summary": "…", "confidence": 0.62 }
```

**跟任务单**，两个理由：

1. **对象 map 挂不住"每条 delta 各自的理由"** —— 北极星那版只有一个顶层 `reason` + 一组顶层 `operatorTags`，11 个维度共用一个理由。而"可解释性"正是本单的目的（任务单 §1.2：「你得说"因为咨询师说了共情的话，所以 trust 涨了 0.1"」）—— 共用一个理由等于没解释。数组形态让**每条 delta 自带标签与理由**；
2. **北极星示例的维度名与内核对不上** —— 它写的是 `emotionValence` / `resistance`，而内核 `DeltaVector` 的键是 `valence` / `verbal` / `depth` / `style`（没有 `resistance` 这个键）。任务单的 `DeliberationDim` **逐字对齐内核键**才是对的 —— 否则将来 LLM 输出的 delta 没法直接喂 `applyDeltaVector`。

（`intentionShift` 字段不在本单范围：它是 WP68「意图锁定机制」的产物，且内核当前的 `Intention` 是每轮派生输出、不是状态字段 —— 任务单没列，本单不加。）

### 2.10 决策：**零管道代码**（任务单 §1.3）

本单没有注册任何 provider / module / token，没有接进会话管线，没有 LLM 调用。审议服务本身是 WP64 的 `engine-adapters/deliberation/llm-deliberation.service.ts`（与本单两个文件同目录）。

### 2.11 决策：`DeliberationMode` 放**类型文件**而不是 prompt 文件

任务单 §3.3 的签名写的是 `mode: 'exam' | 'freeform'`（内联字面量）。本单抽成 `DeliberationMode` 放在 `deliberation-types.ts`：模式是**契约的一部分**（不是 prompt 的实现细节），WP64 的 service 也要按它分支，抽出来两边共用一份。

---

## 3. 闸门数字

| 闸门 | 结果 |
|---|---|
| `npx eslint "src/**/*.ts" "test/**/*.ts" "bin/**/*.ts"` | **0 error / 0 warning**（exit 0） |
| `npx tsc -p tsconfig.build.json --noEmit` | **0 error**（exit 0） |
| `npx vitest run --exclude '**/e2e/**/*.ts'` | **101 个测试文件 / 1664 例全绿**（exit 0） |
| `npx vitest run test/engine-adapters/wp63-deliberation-schema.spec.ts` | **30 例全绿**（本轮新增） |
| `npx vitest run test/engine-core/boundary.spec.ts` | **12 例全绿**（11 条不变量 + 1 条扫描自检） |
| `git diff --stat HEAD -- src/engine-core` | **空** —— 本期**未改内核** ✓ |

**回归确认**：

- **既有源文件零改动** —— 本单是纯新增（3 个新文件），`git status` 里本单条目**全是 `??`**，没有一条 `M`。不存在"改了既有代码再靠测试兜住"的情况；
- **内核零回归** —— `src/engine-core/**` 一行未动；边界断言 ①②③④⑤⑥⑦⑧⑨⑩⑪ 全绿（零 `@nestjs` / 零 typeorm / 零 process.env / 零 globalThis / barrel 公开出口面未动 / 适配层零深路径 import 内核内部模块）；**新目录 `src/engine-adapters/deliberation/` 不在内核树内**，内核边界断言完全不受影响；
- **全量零回归** —— WP32 交付时是 100 文件 / 1634 例，本轮 **101 / 1664**（+1 文件 +30 例 = 本轮新增的那一个文件）✅；
- **既有断言零改动** —— 既有测试文件**一条没改**，只新增 1 个文件 30 例。

> ℹ️ **额外体检（非闸门）**：`npx tsc -p tsconfig.json --noEmit`（含 `test/`）会报 ~120 个**既存**测试文件的 `describe/it/expect` 未定义错误（基础 tsconfig 的 `types` 里没有 vitest globals）—— 那是**仓库既有状态**，与本单无关；本单的两个源文件与测试文件在该次全量类型检查里**零错误**。

---

## 4. 本期**没做**的（明确留给后续，别当漏做）

1. **LLM 调用逻辑** —— WP64（影子模式 PoC）。
2. **格式校验与重试** —— WP66（任务单 §1.3 明确）。
3. **约束校验层接入** —— 审议输出过 delta cap / 临床合理性校验（北极星 §2.3）。
4. **生产切换** —— 影子模式验证完才谈。
5. **意图锁定 / `intentionShift`** —— WP68；且内核当前 `Intention` 是每轮派生输出、不是状态字段，本单不引入（见 §2.9）。
6. **审议 trace 日志格式** —— backlog 母版里 WP63 那一行还提到「理由字段进 trace 日志格式」，但**trace 表结构属于 WP64**（`deliberation_trace` 表在 WP64 的范围内），本单只定义"理由长什么样"，不建表不改格式。
7. ⚠️ **prompt 的实际效果没有真 LLM 验证**（**本单已知的验证缺口**）—— 本单只验"prompt 里**有**该有的约束"（硬约束、维度清单、标签清单、两种模式的措辞差异、空发言占位），**不验模型真的照做**。真模型跑一轮、统计"模型输出非法维度的比例 / 是否遵守幅度上限 / 是否真带标签与理由"，是 WP64 的活。**这条不装作已覆盖。**

---

_创建：2026-11-05_
_深度通知：`DeltaVector` 11 个键与 `CAP_DIMS` 的顺序（src/engine-core/cognition/state-transition.ts）/ `DEFAULT_DELTA_CAP_CONFIG` 的三档不对称 cap / `DELTA_TABLE` 里 `sensitive_touch` 的非零 delta 与 `neutral` 的 ZERO / `CounselorEventKind` 11 个值 / `CounselorLlmJsonRequest` 的 `schemaDescription` 与 `validate` 两个口子 + client 在 llm-json.client.ts:115 的拼装口径 / `engine-core/index.ts` 的公开出口面（BdiStateRepository 与 CounselorEventKind / DeltaVector 均已导出，适配层零深路径 import）/ 北极星 hybrid-bdi-agent-blueprint-v1.0.md §2.2 的审议层输入输出与目录约定 / `formatRollingSummaryInput` 的"空发言写占位"既有治本 / AGENTS.md §5.3 零压红线 / `tsconfig.build.json` 排除 test/ 的事实 —— 逐条 grep 核实_
