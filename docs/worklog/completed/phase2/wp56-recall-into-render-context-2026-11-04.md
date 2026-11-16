# WP56 任务单 — 长期记忆召回进渲染上下文

> **状态**：✅ 已交付（2026-11-04）→ [`engine-wp56-recall-into-render-context-implementation-2026-11-04.md`](engine-wp56-recall-into-render-context-implementation-2026-11-04.md)
> **路径**：`docs/worklog/pending/wp56-recall-into-render-context-2026-11-04.md`
> **优先级**：🟡 P1
> **引擎内核**：❌ 不改 engine-core（只改适配层渲染）
> **前置依赖**：WP2（三级记忆系统）、WP37（滚动摘要进渲染）
> **北极星**：[`../../architecture/engine-endstate-blueprint-v1.0.md`](../../architecture/engine-endstate-blueprint-v1.0.md) §③ 记忆系统层

---

## 1. 任务概述

### 1.1 一句话目标

WP2 已交付三级记忆系统（会话级 / 短期 / 长期），但**长期记忆召回的结果从来没进过 prompt** —— `RenderSpec.recall` 字段早就有了，`spec-assembler` 也传了，但 `buildVisitorSystemPrompt` 根本不消费它。本期把 recall 接进 prompt，让模型能看到长期记忆召回的内容。

### 1.2 为什么现在做

- WP2 交付记录自己登记了缺口：「recall 装的是长期记忆召回，本期不渲染进 prompt」
- 现在内测时会出现：跨会话接续时，上一场聊过的"我小时候被父母抛弃"这条长期记忆，模型**完全不知道** —— 它只能靠 `sessionSummary`（WP37 的滚动摘要）知道大概，看不到具体的记忆条目
- 三级记忆里"长时召回"这一环在语言生成侧是断的 —— 召回了但模型看不到 = 白召回
- 这是 WP2 + WP37 的补完项，做完之后三级记忆才真正端到端生效

---

## 2. 现状盘查结论（已 grep 全 engine-core + engine-adapters 核实）

### 2.1 RenderSpec.recall 现状

```ts
// render-types.ts:125
readonly recall: readonly MemoryHit[];
```

**注释里写着**：
```ts
// 为什么走独立字段而不是塞进 recall:
//   recall 装的是长期记忆召回 (WP2 的 openingContext), 本期不渲染进 prompt;
//   把滚动摘要混进去, "recall 要不要渲染" 就变成"只渲染其中一部分" ——
```

**问题**：字段早就有了，但注释明确说"本期不渲染进 prompt"。

### 2.2 spec-assembler 现状

```ts
// spec-assembler.ts:114
recall: input.output.openingContext ?? [],
```

**问题**：已经传了 recall，从 `openingContext` 来。

### 2.3 buildVisitorSystemPrompt 现状

```ts
// turn-render-orchestrator.ts:942-1010
function buildVisitorSystemPrompt(spec: AdaptiveRenderSpec): string {
  const lines: string[] = [
    '你正在扮演一位来访者，正在和一位咨询师对话。你不是咨询师，也不是助手。',
    '说话方式：用中文口语，短句，像真实的人聊天；可以只说半句、可以停顿。不要写旁白、动作描写、括号补充或列表，不要解释自己。',
    '',
    '你此刻的内在状态（只用来约束你的语气与节奏，绝对不要说出口）：',
    `- 行为策略：${STRATEGY_LABEL[spec.intention.strategy]}`,
    `- 情绪：${EMOTION_LABEL[spec.emotion.label]}（效价 ${formatNumber(spec.emotion.valence)}，唤醒 ${formatNumber(spec.emotion.arousal)}）`,
    `- 阻抗：话量 ${formatNumber(spec.resistance.verbal)}／深度 ${formatNumber(spec.resistance.depth)}／风格 ${formatNumber(spec.resistance.style)}（越高越回避、话越短、语气越疏离）`,
    `- 移情：正向 ${formatNumber(spec.transference.positive)}／负向 ${formatNumber(spec.transference.negative)}／依赖 ${formatNumber(spec.transference.dependency)}`,
    `- 信任：${formatNumber(spec.trust)}（越低越戒备、越不愿多说）`,
  ];

  // safety / bond 条件追加（WP50）
  if (spec.safety !== undefined) lines.push(`- 安全感：…`);
  if (spec.bond !== undefined) lines.push(`- 联结感：…`);

  // sessionSummary 条件追加（WP37）
  if (spec.sessionSummary) lines.push(`- 此前我们聊过（背景，不要说出口）：${spec.sessionSummary}`);

  // coreBeliefs 条件追加
  if (spec.coreBeliefs?.length) lines.push(`- 你心里坚信、不会动摇的东西：…`);

  // forbiddenBehaviors 条件追加
  if (spec.forbiddenBehaviors?.length) lines.push(`- 你绝不会做的事（绝不能出现）：…`);

  // trajectoryNote 条件追加
  if (spec.trajectoryNote) lines.push(`- 你此刻正经历的事：…`);

  // ... 后续硬规则 ...
}
```

**问题**：没有 recall 的渲染。

### 2.4 MemoryHit 结构

```ts
// memory.store.ts:182-187
export interface MemoryHit {
  /** 命中的记忆条目. */
  readonly entry: MemoryEntry;
  /** 相关度 [0,1]. */
  readonly score: number;
}
```

### 2.5 MemoryEntry 关键字段

```ts
// memory.store.ts:85-132
export interface MemoryEntry {
  readonly content: string;        // 记忆正文
  readonly importance: number;    // 重要度 [0,1]
  readonly occurredAt: number;     // 事件发生时刻 (ms timestamp)
  readonly tier: MemoryTier;        // 记忆分层 (LONG_TERM 等)
  // ... 其他字段 ...
}
```

### 2.6 recall 数据来源

```ts
// in-memory-engine-session.ts:762-779
private async collectOpeningContext(runtime: EngineSessionRuntime, query: string): Promise<readonly MemoryHit[]> {
  if (!runtime.resumeFromSessionId) return [];   // 只在跨会话接续时召回
  if (runtime.turnIndex !== 1) return [];       // 只在第一轮召回
  try {
    return await this.memories.recall({
      tenantId: runtime.tenantId,
      sessionId: runtime.sessionId,
      visitorId: runtime.visitorId,
      scope: 'visitor',
      query,
      tiers: [MemoryTier.LONG_TERM],
      minImportance: OPENING_CONTEXT_MIN_IMPORTANCE,
      limit: OPENING_CONTEXT_LIMIT,
    });
  } catch {
    return [];
  }
}
```

**关键事实**：
- recall **只在跨会话接续的第一轮**产生（`resumeFromSessionId` + `turnIndex === 1`）
- 召回的是 `LONG_TERM` 层级的记忆
- 有最小重要度阈值和数量限制（`OPENING_CONTEXT_MIN_IMPORTANCE` / `OPENING_CONTEXT_LIMIT`）
- 失败时吞掉异常，返回空数组（不影响主流程）

### 2.7 boundary.spec.ts 白名单现状

- `RenderSpec` 已在白名单（第 372 行）
- `domain/rendering/render-types.ts` 已在白名单（第 452 行）
- `MemoryHit` 已在白名单（第 297 行）
- `domain/ports/memory.store.ts` 已在白名单（第 448 行）

**本期不改内核，只改适配层渲染，不需要碰白名单。**

---

## 3. 本期做什么

### 3.1 buildVisitorSystemPrompt 加 recall 条件渲染

```ts
// turn-render-orchestrator.ts:942-1010
function buildVisitorSystemPrompt(spec: AdaptiveRenderSpec): string {
  const lines: string[] = [
    // ... 既有 lines 不变 ...
  ];

  // ... 既有条件追加（safety / bond / sessionSummary / coreBeliefs / forbiddenBehaviors / trajectoryNote）不变 ...

  // 新增：长期记忆召回条件渲染
  if (spec.recall && spec.recall.length > 0) {
    const memories = spec.recall
      .slice(0, 3)  // 只取 Top3，避免 prompt 过长
      .map(hit => `- ${hit.entry.content}`)
      .join('\n');
    lines.push(`- 你还记得这些事（背景，不要说出口）：\n${memories}`);
  }

  // ... 后续硬规则不变 ...
}
```

**口径说明**：
- recall 为空数组时，不渲染那一行（零回归）
- 只取 Top3（避免 prompt 过长，召回可能有 5-10 条）
- 文案是**工程种子值，非临床标定** —— 内测后按真实对练校准

### 3.2 为什么放在"内在状态"块里

和 `sessionSummary` 同一位置（"此前我们聊过"后面），因为它们都是**背景信息**：
- `sessionSummary` 是**本场会话**的滚动摘要
- `recall` 是**跨会话**的长期记忆召回

放在"内在状态"块里，自动受"绝对不要说出口"的约束 —— 模型知道这些是背景，不会直接念出来。

---

## 4. 边界问题补充

### 4.1 ⚠️ 为什么不改内核？

**因为 recall 字段早就有了，spec-assembler 也传了，只是渲染层没消费。**

- 内核 `RenderSpec.recall` 字段早就存在（WP2 就加了）
- 适配层 `spec-assembler` 早就传了（`recall: input.output.openingContext ?? []`）
- 只是 `buildVisitorSystemPrompt` 没消费它

所以本期**只改适配层渲染**，不碰 engine-core。

### 4.2 ⚠️ 为什么是条件渲染而不是必渲染？

**零回归。**

- recall 只在跨会话接续的第一轮才有值（平时是空数组）
- 如果必渲染，每次都要加"你还记得这些事：无"这种废话行
- 条件渲染：有值才显示，没值就不显示 = 行为与现在逐字一致

### 4.3 ⚠️ 为什么只取 Top3？

**避免 prompt 过长。**

- 召回可能有 5-10 条记忆（`OPENING_CONTEXT_LIMIT` 设的是多少，待核实）
- 如果全部渲染，prompt 会很长，token 增量大
- Top3 够模型理解"来访者是谁、有什么核心议题"了，不需要全部塞进去

### 4.4 ⚠️ 文案是谁写的？

**本期写，但标「工程种子值，非临床标定」。**

```
- 你还记得这些事（背景，不要说出口）：
  - 我小时候被父母抛弃过
  - 我不太相信别人会真的关心我
```

这些是工程种子值，内测后按真实对练校准。

### 4.5 ⚠️ recall 和 sessionSummary 有什么区别？

| | sessionSummary（WP37） | recall（WP56） |
|---|---|---|
| 范围 | **本场会话**的滚动摘要 | **跨会话**的长期记忆召回 |
| 产生时机 | 工作窗口溢出时攒批异步压摘要 | 跨会话接续的第一轮召回 |
| 形式 | 一段 ≤120 字的流水摘要 | 多条独立的记忆条目 |
| 作用 | "刚才我们聊了什么" | "你是谁、你有什么核心议题" |

两者互补：sessionSummary 是短期记忆的压缩，recall 是长期记忆的召回。

---

## 5. 边界约束

### 5.1 适配层改动（1 个文件）

1. `src/engine-adapters/rendering/turn-render-orchestrator.ts` —— `buildVisitorSystemPrompt` 加 recall 条件渲染

### 5.2 不碰的地方

- ❌ 不改 `RenderSpec`（recall 字段早就有了）
- ❌ 不改 `spec-assembler`（早就传了 recall）
- ❌ 不改 `collectOpeningContext`（召回逻辑不变）
- ❌ 不改 `MemoryStore` 端口（召回策略不变）
- ❌ 不改 `.env` / 配置文件（不需要新 env）
- ❌ 不改 engine-core 任何文件

---

## 6. 验收标准

### 6.1 功能验收

- [ ] `buildVisitorSystemPrompt` 在 `recall.length > 0` 时会显示"你还记得这些事"那一段
- [ ] `recall` 为空数组时，prompt 逐字不变（零回归）
- [ ] 只取 Top3（避免 prompt 过长）
- [ ] recall 内容放在"内在状态"块里，受"绝对不要说出口"约束

### 6.2 闸门验收

- [ ] `npx eslint "src/**/*.ts" "test/**/*.ts"` → 0 error
- [ ] `npx tsc -p tsconfig.build.json --noEmit` → 0 error
- [ ] `npx vitest run` → 全绿（零回归）
- [ ] `git diff --stat HEAD -- src/engine-core` → **空**（本期不改内核）

### 6.3 适配层测试用例要求

扩展文件：`test/engine-adapters/wp7-turn-render.spec.ts`

至少补充：
1. `recall` 有内容时，prompt 里会显示"你还记得这些事"那一段
2. `recall` 为空数组时，prompt 逐字不变（零回归）
3. `recall` 有 5 条时，只渲染 Top3（不全部塞进去）
4. recall 内容放在"内在状态"块里（在硬规则之前）

---

## 7. 本期没做的（明确留给后续）

1. **召回策略优化（Top-N 截断 / 过期过滤 / 冲突消解）** —— 本期只是"把 recall 接进 prompt"，召回本身的策略还很原始。那是 WP59 的事
2. **按重要度排序渲染** —— 本期只取 Top3，不做按重要度排序（召回结果本来就是按 score 排的）
3. **Admin Dashboard 展示召回内容** —— 那是前端的事，本期只做后端
4. **recall 的临床校准** —— 本期是工程种子值，内测后按真实对练校准

---

## 8. 转述给后端的话术

> WP56：长期记忆召回进渲染上下文。
>
> 开工前先读 `docs/README.md` 和 `docs/worklog/README.md` 入口，确认红线和交付格式。
>
> 任务单在 `docs/worklog/pending/wp56-recall-into-render-context-2026-11-04.md`。
>
> **不改 engine-core**，只改适配层 1 个文件：
> - `turn-render-orchestrator.ts` —— `buildVisitorSystemPrompt` 加 recall 条件渲染
>
> 关键口径：
> - recall 字段早就有了，spec-assembler 也传了，只是渲染层没消费
> - 条件渲染：`recall.length > 0` 才显示那一段，空数组 = 不显示 = 行为与现在逐字一致
> - 只取 Top3（避免 prompt 过长）
> - 文案是工程种子值，非临床标定
> - 放在"内在状态"块里（和 sessionSummary 同位置），受"绝对不要说出口"约束
>
> 任务单里所有函数名 / 类型名 / 文件路径都是 grep 核实过的，不是凭印象写的。
>
> 交付按 `team/conventions.md` §二的格式写交付记录：改了哪些文件、关键设计决策（跟任务单有出入要说明）、闸门数字。

---

_创建：2026-11-04_
_深度通知：`RenderSpec.recall` / `spec-assembler` 传值 / `buildVisitorSystemPrompt` 结构 / `MemoryHit` / `MemoryEntry` / `collectOpeningContext` / boundary.spec.ts 白名单，全部 grep 核实_

---

## 9. 交付后补记（2026-11-04）

按 `team/conventions.md` §2.5 记录**任务单与实际交付的偏差**，详细论证见交付记录。

| # | 任务单写的 | 实际交付 | 理由 |
|---|---|---|---|
| 1 | §5.1 改 1 个适配层文件 | **完全一致** | 只动 `turn-render-orchestrator.ts`。`git diff --stat HEAD -- src/engine-core` **为空** —— 任务单 §6.2 的验收项。内核一行不动（`RenderSpec.recall` 早就存在、`spec-assembler` 早就传了，缺的只是消费端） |
| 2 | §3.1 草图写 `if (spec.recall && spec.recall.length > 0)` | **只写 `spec.recall.length > 0`** | `recall` 是**必填**字段（`readonly recall: readonly MemoryHit[]`，不是 `?`），`spec.recall &&` 永远为真 —— 写它等于暗示"这个字段可能不存在"，与类型契约矛盾（§2.1 自己标注了这点） |
| 3 | §3.1 草图把 recall 放在**块末尾**（所有条件追加之后） vs §3.2 正文「和 `sessionSummary` 同一位置」 | **按 §3.2 + 转述口径：紧跟 sessionSummary 之后** | 任务单内部这两处不一致。sessionSummary 与 recall 是一对**背景**（本场滚动摘要「刚才聊了什么」／跨会话长期召回「你是谁、有什么核心议题」），挨着放两块背景连成一段；§3.1 的位置会把两块背景拆开，中间隔着"你心里坚信的东西""你绝不会做的事"。两处都在"内在状态"块内、都在硬规则之前，§6.3 第 4 条都满足 |
| 4 | §3.1 草图产出**扁平** `- 记忆1` vs §4.4 文案示例是 **2 空格缩进** | **按 §4.4：缩进** | prompt 里"内在状态"块每项都是 `- xxx` **平级**形态。召回条目若也扁平，就与"行为策略／情绪／阻抗／信任"这些**状态指标**平级 —— 但召回条目是**内容**不是指标，语义不对。缩进让子项明确隶属于标题 |
| 5 | §4.3 猜召回「5-10 条」 | **实为 5 条** | 核实内核 `OPENING_CONTEXT_LIMIT = 5`（`in-memory-engine-session.ts`）。渲染上限收成命名常量 `RECALL_PROMPT_LIMIT = 3`（与召回策略解耦，WP59 改召回上限时只改这一处） |
| 6 | 任务单未提 | **记忆正文不做换行归一**（刻意的） | 数据源是**单条会话文本**（内核 `rememberTurn` 存 `userText`），实测无换行；过早加归一会引入"渲染层偷偷改内容"的语义。**留档**：若将来来源支持多行正文，与 WP59 一并处理（渲染归一 + 召回侧截断，别只改一处） |
| 7 | 任务单未展开 | **「不要说出口」的语义与 WP37 同款** | 指「别把这段清单背出来」，**不是**「不许谈这些话题」—— 否则召回又白召回（模型既看不到也用不上）。sessionSummary（WP37）早就在同一块、同一句式，它装的是"刚才聊了什么"，来访者当然要接着聊。**不改硬规则文案**（改它会让所有轮次 prompt 都变，违反零回归底线） |
| 8 | §6.3 适配层测试 4 条 | **扩到 6 例** | 补：记忆正文**原样渲染**（不改写/不截断）/ 召回内容**只在系统消息**、不掺进历史消息。零回归那条用**双向断言**：缺省版不含这一段 + 有召回版减去这一段 == 缺省版 |
| 9 | §2.7 boundary 白名单 | **不需要碰** | 本期不改内核，`RenderSpec` / `MemoryHit` 等条目早已在列 |

> 本期**没做**的（召回策略优化 / 按重要度排序渲染 / Admin Dashboard 展示 / 临床校准 / 记忆正文换行归一）已在交付记录 §4 逐条留档。
>
> ⚠️ **生效条件**：recall 只在**跨会话接续的首论**有值（内核口径：`resumeFromSessionId` 存在 + `turnIndex === 1`）。其余所有轮次 prompt 逐字不变 —— 这既是零回归的来源，也是本 WP 的预期效果。
