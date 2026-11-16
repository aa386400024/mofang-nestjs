# WP61 任务单 — 会话摘要层次化（核心议题 / 关键事件 / 情绪转折点）

> **状态**：✅ 已交付（2026-11-04）→ 交付记录：[`engine-wp61-session-summary-hierarchical-implementation-2026-11-04.md`](engine-wp61-session-summary-hierarchical-implementation-2026-11-04.md)
> **路径**：`docs/worklog/completed/phase2/wp61-session-summary-hierarchical-2026-11-04.md`
> **优先级**：🟡 P1
> **引擎内核**：❌ 不改 engine-core（只改适配层生成器 + 服务 + 渲染）—— **实改 0 个内核文件，`git diff --stat HEAD -- src/engine-core` 为空**
> **前置依赖**：WP37（滚动摘要）、WP55（两侧纪要）
> **北极星**：[`../../architecture/engine-endstate-blueprint-v1.0.md`](../../architecture/engine-endstate-blueprint-v1.0.md) §③ 记忆系统层

---

## 1. 任务概述

### 1.1 一句话目标

WP37/WP55 已交付滚动摘要，但摘要仍是**一段 ≤120 字的流水文字** —— "刚才我们聊了什么"是一坨压缩文字，模型读起来费劲，后续 Admin Dashboard 也没法展示。本期把摘要改成**三层结构**（核心议题 / 关键事件 / 情绪转折点），让摘要从"流水账"变成"结构化纪要"。

### 1.2 为什么现在做

- 现在内测时，模型看到的摘要是一坨 120 字的流水文字 —— "你小时候被父母抛弃过，你不太相信别人，最近工作压力大..."，模型要自己从里面提炼重点
- 终局蓝图 §③ 记忆系统层要的是**三层结构**，不是一坨文字 —— 这是记忆系统从"能用"到"专业"的关键一步
- Admin Dashboard 后面要展示摘要，结构化的摘要才能分组展示（核心议题 / 关键事件 / 情绪转折点三栏）
- 这是 WP37/WP55 的补完项，做完之后记忆系统的"摘要"这一环才真正专业

---

## 2. 现状盘查结论（已 grep 全 engine-core + engine-adapters 核实）

### 2.1 滚动摘要生成器现状

```ts
// rolling-summary.generator.ts:72-80
export interface RollingSummaryGenerator {
  generate(input: RollingSummaryInput): Promise<string>;
}
```

**问题**：返回**字符串**（一段 ≤120 字的流水摘要）。

### 2.2 滚动摘要 prompt 现状

```ts
// rolling-summary.generator.ts:93-104
const ROLLING_SUMMARY_SYSTEM_PROMPT = [
  '你是一名咨询训练场景的会话纪要助手。下面给你的是一段**咨询师与来访者的对话记录**（问答交替）。',
  '请把它压缩成一段「此前我们聊过什么」的滚动摘要，供来访者角色在后续对话里保持话题连续。',
  '',
  '要求：',
  '1. 只写已经出现过的内容：谈到的议题、情绪线索、关系进展。不要编造对话里没有提到的经历、感受或承诺。',
  '2. 如果给了上一版摘要，输出必须是把新内容并进去之后的**完整版**摘要，不要只写新增部分。',
  '3. 不超过 120 字。不要写具体话术，不要做临床诊断。',
  '',
  '只输出一个 JSON 对象，不要输出任何解释或代码块围栏：',
  '{"summary": "…"}',
].join('\n');
```

**问题**：要求输出一段 120 字的流水摘要。

### 2.3 滚动摘要存储现状

```ts
// rolling-session-summary.service.ts:176
summary?: string;
```

**问题**：`SessionRollingState.summary` 是**字符串**。

### 2.4 滚动摘要渲染现状

```ts
// turn-render-orchestrator.ts:996-997
if (spec.sessionSummary) {
  lines.push(`- 此前我们聊过（背景，不要说出口）：${spec.sessionSummary}`);
}
```

**问题**：渲染成**一行**文本。

### 2.5 最终摘要（WP12）现状

```ts
// session-closeout.service.ts:67-72
export interface SessionSummary {
  readonly content: string;
  readonly topicKey?: string;
}
```

**问题**：最终摘要也是一段字符串（≤200 字）。

**本期不改最终摘要** —— 那是会话结束后才生成的，不影响对练体验，留到后面再说。

### 2.6 boundary.spec.ts 白名单现状

- `RenderSpec.sessionSummary` 是可选字段（`?: string`），已经在白名单里
- 本期不改 RenderSpec 类型，只改摘要内容的"形状"（从一行流水变成三行结构）
- 不需要碰白名单

---

## 3. 本期做什么

### 3.1 生成器 prompt 改成三层结构

```ts
// rolling-summary.generator.ts:93-104
const ROLLING_SUMMARY_SYSTEM_PROMPT = [
  '你是一名咨询训练场景的会话纪要助手。下面给你的是一段**咨询师与来访者的对话记录**（问答交替）。',
  '请把它压缩成一份结构化的滚动纪要，供来访者角色在后续对话里保持话题连续。',
  '',
  '要求：',
  '1. 只写已经出现过的内容：不要编造对话里没有提到的经历、感受或承诺。',
  '2. 如果给了上一版纪要，输出必须是把新内容并进去之后的**完整版**，不要只写新增部分。',
  '3. 分三段输出，每段不超过 60 字，总长度不超过 180 字：',
  '   - 核心议题：来访者最关心的 1-2 个核心话题',
  '   - 关键事件：对话中发生的 1-2 个重要事件',
  '   - 情绪转折点：情绪或关系发生明显变化的节点',
  '',
  '只输出一个 JSON 对象，不要输出任何解释或代码块围栏：',
  '{"coreTopics": "…", "keyEvents": "…", "emotionalTurningPoints": "…"}',
].join('\n');
```

**口径说明**：
- 三段结构：核心议题 / 关键事件 / 情绪转折点
- 每段不超过 60 字，总长度不超过 180 字（比原来的 120 字略长，但结构化后信息密度更高）
- 文案是**工程种子值，非临床标定** —— 内测后按真实对练校准

### 3.2 生成器返回类型 + 入参类型都改成结构化对象

```ts
// rolling-summary.generator.ts
export interface RollingSummaryResult {
  /** 核心议题（1-2 个）. */
  readonly coreTopics: string;
  /** 关键事件（1-2 个）. */
  readonly keyEvents: string;
  /** 情绪转折点（1-2 个）. */
  readonly emotionalTurningPoints: string;
}

export interface RollingSummaryInput {
  /** 上一版滚动纪要（首次生成时缺省）. */
  readonly previousSummary?: RollingSummaryResult;
  /** 本批新增的对话轮次（按时间正序）. */
  readonly rounds: readonly RollingSummaryRound[];
}

export interface RollingSummaryGenerator {
  generate(input: RollingSummaryInput): Promise<RollingSummaryResult>;
}
```

**为什么 `previousSummary` 也要改成结构化对象？**
- 滚动摘要的逻辑是：每来一批新内容，就把它并进上一版摘要，产出一版覆盖全部已聊内容的新摘要
- 如果上一版摘要是字符串、新内容是结构化的，模型没法"把新内容并进结构化纪要"
- 三段结构的合并是**逐段合并**（核心议题并进核心议题、关键事件并进关键事件...），不是把一坨文字塞进另一坨文字

### 3.3 服务层存储结构化对象，渲染时转成多行文本

```ts
// rolling-session-summary.service.ts
interface SessionRollingState {
  // ... 既有字段不变 ...

  /** 当前滚动纪要（结构化）. */
  summary?: RollingSummaryResult;
}
```

渲染时（传给渲染层之前）转成多行文本：
```ts
function formatSummaryForPrompt(summary: RollingSummaryResult): string {
  return [
    `核心议题：${summary.coreTopics}`,
    `关键事件：${summary.keyEvents}`,
    `情绪转折点：${summary.emotionalTurningPoints}`,
  ].join('\n');
}
```

**为什么不改 RenderSpec.sessionSummary 的类型？**
- 因为 `RenderSpec.sessionSummary` 是**字符串**（可选），改类型要动内核
- 本期只改适配层，渲染层拿到的还是一段字符串（只是这段字符串是三行的结构化文本）
- 零回归：渲染层一行不用改，只是摘要内容从一行变成三行

### 3.4 记忆存储（MemoryEntry.content）存什么？

**存渲染后的多行文本**（而不是 JSON）。

理由：
- MemoryEntry.content 本来就是给 prompt 用的文本
- 召回时（WP56）直接拼进 prompt，不用再解析 JSON
- 后面 Admin Dashboard 要展示结构化摘要时，可以从 JSON 解析（但本期不做，留档）

---

## 4. 边界问题补充

### 4.1 ⚠️ 为什么不改内核？

**因为摘要的"形状"（一行流水 vs 三行结构）是适配层的事，不是内核的事。**

- 内核的 `RenderSpec.sessionSummary` 只是一个可选字符串字段
- 字符串的内容是一行还是三行，内核不关心
- 本期只改适配层的生成器 prompt + 服务层存储 + 渲染格式，内核一行不动

### 4.2 ⚠️ 为什么不改 RenderSpec.sessionSummary 的类型？

**零回归。**

- 现在是 `sessionSummary?: string`，改成 `sessionSummary?: RollingSummaryResult` 要动内核
- 本期只改适配层，渲染层拿到的还是一段字符串（只是三行的）
- 后面如果 Admin Dashboard 要展示结构化摘要，再开一个 WP 改类型（那时候需要内核配合）

### 4.3 ⚠️ 为什么本期不改最终摘要（WP12）？

**因为最终摘要不影响对练体验。**

- 滚动摘要是每轮都进 prompt 的，体感提升最明显
- 最终摘要是会话结束后才生成的，不影响对练体验
- 本期只改滚动摘要，最终摘要留到后面再说（避免范围膨胀）

### 4.4 ⚠️ 记忆存储为什么存渲染后的文本，不存 JSON？

**因为 MemoryEntry.content 是给 prompt 用的。**

- 召回时（WP56）直接拼进 prompt，不用再解析 JSON
- 后面 Admin Dashboard 要展示结构化摘要时，可以从另一个字段存 JSON（或者从 content 里解析）—— 那是后面的事

### 4.5 ⚠️ 三段结构的价值是什么？

| | 原来（一行流水） | 现在（三层结构） |
|---|---|---|
| 模型理解 | 要自己从 120 字里提炼重点 | 三段结构清晰，一眼看到核心议题 |
| Admin Dashboard 展示 | 一坨文字，没法分组 | 三栏展示（核心议题 / 关键事件 / 情绪转折点） |
| 后续分析 | 不好做（一坨文字） | 好做（结构化字段） |

---

## 5. 边界约束

### 5.1 适配层改动（3 个文件）

1. `src/engine-adapters/persistence/rolling-summary.generator.ts` —— prompt 改成三层结构 + 返回类型改成 `RollingSummaryResult`
2. `src/engine-adapters/persistence/rolling-session-summary.service.ts` —— `SessionRollingState.summary` 改成结构化对象 + 渲染时转多行文本
3. `test/engine-adapters/wp37-rolling-session-summary.spec.ts` + `wp55-rolling-summary-both-sides.spec.ts` —— 测试用例更新

### 5.2 不碰的地方

- ❌ 不改 `RenderSpec.sessionSummary` 类型（还是 string）
- ❌ 不改 `turn-render-orchestrator.ts` 的渲染逻辑（还是一行 push，只是内容是三行的）
- ❌ 不改最终摘要（WP12 的 `SessionSummary`）
- ❌ 不改 `MemoryEntry` 结构（content 还是 string）
- ❌ 不改 engine-core 任何文件
- ❌ 不改 `.env` / 配置文件

---

## 6. 验收标准

### 6.1 功能验收

- [ ] 生成器 prompt 要求输出三层结构（核心议题 / 关键事件 / 情绪转折点）
- [ ] 生成器返回结构化对象 `RollingSummaryResult`
- [ ] 服务层存储结构化对象，渲染时转成多行文本
- [ ] prompt 里的摘要是三行（核心议题：... / 关键事件：... / 情绪转折点：...）
- [ ] 零回归：没有摘要时 prompt 逐字不变

### 6.2 闸门验收

- [ ] `npx eslint "src/**/*.ts" "test/**/*.ts"` → 0 error
- [ ] `npx tsc -p tsconfig.build.json --noEmit` → 0 error
- [ ] `npx vitest run` → 全绿（零回归）
- [ ] `git diff --stat HEAD -- src/engine-core` → **空**（本期不改内核）

### 6.3 测试用例要求

扩展文件：
- `test/engine-adapters/wp37-rolling-session-summary.spec.ts`
- `test/engine-adapters/wp55-rolling-summary-both-sides.spec.ts`

至少补充：
1. 生成器返回结构化对象（三段都有）
2. 服务层存储结构化对象，渲染时转成多行文本
3. 空摘要时 prompt 逐字不变（零回归）
4. 模型偶尔不按 JSON 回时的退化口径（复用 `parseSummaryResponse`）

---

## 7. 本期没做的（明确留给后续）

1. **最终摘要（WP12）同步分层** —— 本期只改滚动摘要，最终摘要留到后面
2. **Admin Dashboard 展示结构化摘要** —— 那是前端的事，本期只做后端
3. **MemoryEntry 存 JSON 结构化摘要** —— 本期存渲染后的文本，后面再补 JSON 存储
4. **三段结构的临床校准** —— 本期是工程种子值，内测后按真实对练校准
5. **RenderSpec.sessionSummary 类型改成结构化** —— 本期不改（零回归），后面 Admin Dashboard 需要时再改

---

## 8. 转述给后端的话术

> WP61：会话摘要层次化（核心议题 / 关键事件 / 情绪转折点）。
>
> 开工前先读 `docs/README.md` 和 `docs/worklog/README.md` 入口，确认红线和交付格式。
>
> 任务单在 `docs/worklog/pending/wp61-session-summary-hierarchical-2026-11-04.md`。
>
> **不改 engine-core**，只改适配层 2 个文件：
> - `rolling-summary.generator.ts` —— prompt 改成三层结构 + 返回类型改成 `RollingSummaryResult`
> - `rolling-session-summary.service.ts` —— 存储结构化对象 + 渲染时转多行文本
>
> 关键口径：
> - 不改 RenderSpec.sessionSummary 类型（还是 string）—— 零回归，渲染层一行不用改
> - 记忆存储存渲染后的多行文本（不是 JSON）—— 召回时直接拼进 prompt
> - 本期只改滚动摘要，最终摘要（WP12）留到后面
> - 三段结构：核心议题 / 关键事件 / 情绪转折点，每段不超过 60 字，总长度不超过 180 字
> - 文案是工程种子值，非临床标定
>
> 任务单里所有函数名 / 类型名 / 文件路径都是 grep 核实过的，不是凭印象写的。
>
> 交付按 `team/conventions.md` §二的格式写交付记录：改了哪些文件、关键设计决策（跟任务单有出入要说明）、闸门数字。

---

## 9. 交付后补记（2026-11-04）

> 交付记录：[`engine-wp61-session-summary-hierarchical-implementation-2026-11-04.md`](engine-wp61-session-summary-hierarchical-implementation-2026-11-04.md)
> 下面这张表登记**与任务单原文的偏差**，每条都有理由。

| # | 任务单原文 | 实际落地 | 为什么 |
|---|---|---|---|
| 1 | §5.1「适配层改动（2 个文件）」 | 改了 **3 个**源文件（多 `session-summary.generator.ts`，**纯增**：导出 `parseJsonObject` / `readJsonString` 两个共享解析原语） | 三段 JSON 用现有的 `parseSummaryResponse` **取不到**（它只认 `summary` / `topicKey`）。而 `rolling-summary.generator.ts` 的文件头明写「**不自己写 JSON 解析** —— 复用 `parseSummaryResponse`」。另写一份 = 仓库明令禁止的**双胞胎解析器**。该文件本来就是滚动生成器**已经在 import** 的共享模块，把原语放那里是最小改动（也没另造新模块）。`parseSummaryResponse` 自己改用原语，**行为逐字不变**（WP12 的 40 例全绿即证据） |
| 2 | §3.3 渲染函数放 `rolling-session-summary.service.ts` | 放在 `rolling-summary.generator.ts`（紧挨着 `RollingSummaryResult`） | 同一份渲染要用在**两处**：① 提示词里的「上一版摘要」（生成器自己拼）② `latestSummary()` 对外吐（服务层用）。放服务文件 → **service ↔ generator 循环依赖**。放生成器 → 只有单向依赖，且"形状 + 它的渲染"在一处 |
| 3 | §3.1 提示词草图 | **保留**了 WP37 的「不要写具体话术，不要做临床诊断」，并单列为第 4 条 | 草图把这条护栏**漏掉了**。改写成三段**不能**顺手丢掉"只描述观察、不做诊断"的底线 —— 与分段方式无关。用例钉死（读源文件断言该句仍在） |
| 4 | §3.1 提示词草图 | **新增**一条：「某一段确实没有内容时给空字符串，不要编内容填满它」 | 三段结构带来**新风险**：模型为了填满三段而**编内容**（硬凑一个"情绪转折点"）—— 那正是第 1 条禁止的事。堵在提示词层，不靠解析层兜 |
| 5 | §3.1 提示词草图 | 新增 `parseRollingSummaryResponse()`：三段解析 + **三档退化**（部分段空 → 缺段留空 / 三段全空 → 接住旧单段格式 / 不是 JSON → 整段当核心议题） | §6.3 第 4 条要求"复用 `parseSummaryResponse`"的退化口径。**不是 JSON** 那一档直接复用它的输出（剥围栏 + 整段当文本）。"三段全空"**不算退化** —— 它走服务层的"摘要为空 → 本批留待下次"（WP37 既有语义） |
| 6 | §3.3 只给了渲染草图 | 空段落渲染成「（无）」，**三行永远都在** | 留空 → 模型当成"格式坏了"；省略整行 → prompt 形状随内容变化；「（无）」是**事实**，与同族提示词已有的「（本轮来访者无回复）」同一套写法 |
| 7 | §3.4 记忆存渲染后的多行文本 | 照做 | 召回时直接拼进 prompt，不用再解析 JSON。代价（JSON 存储）留到后面 |
| 8 | 未提"空"的判定口径 | 新增 `isEmptyRollingSummary()`（生成器与服务共用一处） | 结构化之后"空"必须落在**结构上**（三段都没内容），不能落在渲染后的文本上 —— 渲染文本永远有「（无）」，永远不为空 |
| 9 | §3.2 入参 `previousSummary` 改成结构化对象 | 照做，且提示词里的「上一版摘要」用**同一份三段渲染** | 模型要"逐段并"，就得先看到**逐段**的上一版（给它一坨文字，它无从逐段并） |
| 10 | 未提 | 「[上一版摘要]」标签**不动**；token 上限 400 **不动** | 标签之下内容已从一段文字变三行结构，改标签只会在既有用例里制造无谓 diff。三段 ≤180 字 ≈ 270 token，已核实 400 **够用** —— 改上限就是让本就高频的摘要调用多吃额度 |
| 11 | §5.1 测试文件更新 | wp37 spec **+11 例**、wp55 spec **+2 例**；既有断言从"摘要是一段字符串"改成"摘要 = 渲染后的三行文本"（**精确相等**，不放宽成 `toContain`） | 既有用例一条没删，只是断言口径跟着端口的返回形态走 |

**闸门**：eslint 0 error / tsc 0 error / vitest **97 文件 1549 例全绿**（基线 1536 + 新增 13）/ `git diff --stat HEAD -- src/engine-core` = **空** / `boundary.spec.ts` 11 条全绿。

---

_创建：2026-11-04_
_深度通知：`RollingSummaryGenerator` / `RollingSummaryInput` / `SessionRollingState.summary` / `RenderSpec.sessionSummary` / `SessionSummary`（WP12）/ boundary.spec.ts 白名单，全部 grep 核实_
