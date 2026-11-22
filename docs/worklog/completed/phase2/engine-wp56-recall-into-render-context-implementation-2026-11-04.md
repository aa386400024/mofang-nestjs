# WP56 交付记录 — 长期记忆召回进渲染上下文

> 状态: ✅ 已交付
> 任务单: [`wp56-recall-into-render-context-2026-11-04.md`](wp56-recall-into-render-context-2026-11-04.md)
> 日期: 2026-11-04
> 红线: ✅ **未改 engine-core** —— `git diff --stat HEAD -- src/engine-core` **为空**（任务单 §6.2 明确要求）

---

## 1. 实际改了哪些文件

### 1.1 适配层：1 改（无新增文件）

| 文件 | 改了什么 |
|---|---|
| `src/engine-adapters/rendering/turn-render-orchestrator.ts` | ① 新增常量 `RECALL_PROMPT_LIMIT = 3`（渲染进 prompt 的召回条数上限）；② `buildVisitorSystemPrompt` 在 sessionSummary 之后加 **recall 条件渲染**（`spec.recall.length > 0` 时推入「- 你还记得这些事（背景，不要说出口）：」+ 缩进子项，取 Top3）；③ 文件头加 WP56 段（为什么条件渲染 / 为什么只取 Top3 / 为什么放在 sessionSummary 之后） |

### 1.2 测试：1 改

| 文件 | 改了什么 |
|---|---|
| `test/engine-adapters/wp7-turn-render.spec.ts` | **扩展**：新增「⑩ WP56 · 长期记忆召回进渲染上下文」describe 块 **6 例**（有内容时显示 / 空数组逐字不变 / 5 条只渲染 Top3 / 位置在内在状态块内 / 正文原样渲染 / 只在系统消息不掺历史）；文件头补 WP56 段 |

### 1.3 文档

| 文件 | 改了什么 |
|---|---|
| `docs/worklog/pending/wp56-recall-into-render-context-2026-11-04.md` | 状态行改 `✅ 已交付` + 指向交付记录；追加「§9 交付后补记」偏差表 → 移入 `completed/phase2/` |
| `docs/worklog/pending/phase2-wp-list-2026-11-03.md` | WP56 行 ✅ + 交付记录链接；统计进度 12/35 → 13/35 |
| `docs/worklog/README.md` | Phase2 已开工列表 +WP56；进度回写 13/35；目录结构说明 +WP56 |

### 1.4 内核

**零改动。** `git diff --stat HEAD -- src/engine-core` 为空 —— 任务单 §6.2 的验收项。

---

## 2. 关键设计决策（与任务单有出入的地方 + 为什么）

### 2.1 决策：条件渲染用 `spec.recall.length > 0`（**不**写 `spec.recall &&`）

任务单 §3.1 的代码草图写的是：

```ts
if (spec.recall && spec.recall.length > 0) {
```

本单只保留 `spec.recall.length > 0`。理由：`RenderSpec.recall` 是**必填**字段（`readonly recall: readonly MemoryHit[]`，不是 `?`），所以 `spec.recall &&` 是**永远为真**的冗余判断 —— 写它等于暗示「这个字段可能不存在」，与类型契约矛盾。任务单 §2.1 自己也标注了这一点。

用户的转述口径同样是「recall 是必填字段，条件渲染用 `spec.recall.length > 0`」。

### 2.2 决策：放在 **sessionSummary 之后**，而不是 §3.1 草图的位置（块末尾）

任务单内部这两处不一致：

- §3.1 的代码草图把 recall 块放在**所有**条件追加之后（coreBeliefs / forbiddenBehaviors / trajectoryNote 之后），即"内在状态"块的**末尾**；
- §3.2 的正文写「和 `sessionSummary` **同一位置**（"此前我们聊过"后面）」。

**本单按 §3.2 + 用户转述口径（"sessionSummary 后面"）执行** —— recall 块紧跟在 sessionSummary 行之后。

理由不只是"照口径"：sessionSummary 与 recall 是一对**背景**（前者 = 本场滚动摘要「刚才我们聊了什么」，后者 = 跨会话长期召回「你是谁、你有什么核心议题」），**挨着放**两块背景连成一段，模型读起来才是一句完整的"背景"。而 §3.1 草图的位置会把两块背景拆开，中间隔着"你心里坚信的东西""你绝不会做的事"。

两处都在"内在状态"块内、都在硬规则之前 —— 任务单 §6.3 第 4 条的验收都满足。

### 2.3 决策：子项用 **2 空格缩进**（§4.4 的文案示例），不是 §3.1 草图的扁平 `- 记忆1`

任务单 §4.4 展示的文案是：

```
- 你还记得这些事（背景，不要说出口）：
  - 我小时候被父母抛弃过
  - 我不太相信别人会真的关心我
```

而 §3.1 草图的 `.map(hit => `- ${hit.entry.content}`)` 产出的是**扁平**的 `- 我小时候被父母抛弃过`。

**本单按 §4.4 执行（缩进）**。理由：prompt 里"内在状态"块的每一项都是 `- xxx` 的**平级**形态（行为策略／情绪／阻抗／信任…）。若召回条目也用扁平 `-`，它就与这些**状态指标**行平级 —— 但召回条目是**内容**，不是指标，语义不对。缩进让子项在结构上明确隶属于标题，模型不会把"我小时候被父母抛弃过"当成一项状态指标。

用例 ③（恰好 3 个子项）与 ④（位置在块内）把这条结构钉死。

### 2.4 决策：只取 **Top3**，条数收成常量 `RECALL_PROMPT_LIMIT = 3`

核实到内核召回上限是 **5 条**（`OPENING_CONTEXT_LIMIT = 5`，`in-memory-engine-session.ts`），任务单 §4.3 猜的「5-10 条」偏保守，实际就是 5。

条数收成命名常量而不是裸 `3`：这个数字是「prompt 长度预算」的一部分，与召回策略解耦 —— 将来召回上限变了（WP59 可能放宽到 10），改这一处即可。

### 2.5 决策：**不**对记忆正文做换行归一（刻意的）

记忆正文若含 `\n`，子项的 `- ` 前缀就断了（第二行没有前缀），prompt 结构会散。

本单**刻意不做**归一，理由：数据源是**单条会话文本**（内核 `rememberTurn` 存的是 `userText`，即咨询师这一轮的原话），实测不含换行；且过早加归一会引入"渲染层偷偷改内容"的语义 —— 记忆正文原样进 prompt 才是可核查的。

**留档**：若将来记忆来源支持多行正文（例如摘要条目、批量导入的档案），需在 WP59 召回策略轮**一并**处理（渲染归一 + 召回侧截断，两处一起定，别只改一处）。

### 2.6 决策：「不要说出口」的语义与 WP37 的 sessionSummary **完全同款**

召回块被放在"你此刻的内在状态（……绝对不要说出口）"块内，标题也写了「（背景，不要说出口）」。

这里有一个需要说清的语义：这里的"不要说出口"指的是「**别把这段清单背出来**」，不是「不许谈这些话题」。理由：

- sessionSummary（WP37）早就在同一块里、同一句式 —— 它装的是"刚才我们聊了什么"，而来访者**当然要接着聊刚才的话题**；
- 若把"不要说出口"理解成"不许提及"，那长期记忆召回又变成白召回 —— 模型既看不到、也用不上。

本单沿用 WP37 的既有口径，不新增约束、不改硬规则文案（硬规则第 3 条的"状态词（策略／情绪／阻抗／信念等）"说的是**状态指标**，召回条目是内容，不在其列）。

### 2.7 决策：**不改硬规则文案**（与 WP37 同一理由）

改硬规则会让**所有**轮次的 prompt 都变（包括没有任何召回的普通会话）—— 那就破坏了"没有召回时行为不变"这条零回归底线。本单只在有召回时多推一段，别处一个字不动。

### 2.8 决策：**不改内核、不改 spec-assembler、不改召回逻辑**（任务单 §4.1 / §5.2，照做）

核实过这条链本来就是通的，缺的只是消费端：

```
内核 collectOpeningContext (WP2)  →  EngineTurnOutput.openingContext
  →  spec-assembler: recall: input.output.openingContext ?? []   (早就传了)
  →  buildVisitorSystemPrompt                                        ← 本期补上这一段
```

所以本期**只改适配层渲染**，内核一行不动（`git diff --stat HEAD -- src/engine-core` 为空）。

### 2.9 生产生效条件（写清楚，别误判"改了没生效"）

recall **不是每轮都有**。内核 `collectOpeningContext` 的口径是：

- `runtime.resumeFromSessionId` 存在（**跨会话接续**）；
- 且 `runtime.turnIndex === 1`（**接续后的首论**）；
- 召回 scope=visitor、tiers=[LONG_TERM]、minImportance=0.5、limit=5；
- 异常被吞掉 → 返回空数组（不影响主流程）。

所以：**只有「跨会话接续的第一轮」会多出这一段**，其余所有轮次（普通会话、接续后的第 2 轮起）prompt 逐字不变。这既是零回归的来源，也是本 WP 的预期效果。

---

## 3. 闸门数字

| 闸门 | 结果 |
|---|---|
| `npx eslint "src/**/*.ts" "test/**/*.ts" "bin/**/*.ts"` | **0 error**（exit 0） |
| `npx tsc -p tsconfig.build.json --noEmit` | **0 error**（exit 0） |
| `npx vitest run --exclude '**/e2e/**/*.ts'` | **97 个测试文件 / 1526 例全绿**（WP51 基线 97 文件 / 1520 例 + 本轮新增 **6 例**，**零回归**：1520 + 6 = 1526 ✓） |
| `npx vitest run test/engine-adapters/wp7-turn-render.spec.ts` | **26 例全绿**（原 20 例 + 本轮新增 **6 例**） |
| `git diff --stat HEAD -- src/engine-core` | **空** —— 本期**未改内核** ✓ |

**回归确认**：

- **recall 为空数组** → prompt 逐字不变（双向断言：缺省版不含这一段，且有召回版减去这一段 == 缺省版）；
- **recall 有 5 条** → 只渲染 Top3，第 4、5 条不出现，子项数恰好 3；
- **位置** → 在"你此刻的内在状态"之后、"硬规则："之前；
- **正文原样** → 不改写、不截断；
- **只在系统消息** → 历史消息里不掺召回内容；
- 其余 prompt 段落（行为策略／情绪／阻抗／移情／信任／安全感／联结感／摘要／信念／禁止行为／轨迹／话量权重／安全护栏／硬规则）**逐字未动**；
- WP7 既有 **20 例**用例全部保留（只加组，未改任何既有断言）。

---

## 4. 本期**没做**的（明确留给后续，别当漏做）

1. **召回策略优化（Top-N 截断 / 过期过滤 / 冲突消解）**（任务单 §7 第 1 条）—— 本期只把 recall 接进 prompt，召回本身的策略仍很原始，归 WP59。
2. **按重要度排序渲染**（任务单 §7 第 2 条）—— 本期只取 Top3，不排序（召回结果本来就按 score 排好序）。
3. **Admin Dashboard 展示召回内容**（任务单 §7 第 3 条）—— 那是前端的事，本期只做后端。
4. **recall 的临床校准**（任务单 §7 第 4 条）—— 文案是工程种子值，内测后按真实对练校准。
5. **记忆正文的换行归一**（见 §2.5）—— 数据源当前无换行；若来源支持多行正文，与 WP59 一并处理。

---

_创建：2026-11-04_
_深度通知：任务单 §2.1（`RenderSpec.recall` 现状）/ §2.2（spec-assembler 传值）/ §2.3（`buildVisitorSystemPrompt` 结构）/ §2.4（`MemoryHit`）/ §2.5（`MemoryEntry`）/ §2.6（`collectOpeningContext` 口径）/ §2.7（boundary 白名单）/ §3.1–§3.2（本期做什么）/ §4.1–§4.5（边界问题补充）/ §5.1–§5.2（边界约束）/ §6.1–§6.3（验收与用例要求）逐条核实 + 真实代码 grep（`OPENING_CONTEXT_LIMIT` 实为 5 / `openingContext` 只在 resume 首论产生 / `rememberTurn` 记忆正文来源 / `EngineTurnOutput.openingContext` 类型）_
