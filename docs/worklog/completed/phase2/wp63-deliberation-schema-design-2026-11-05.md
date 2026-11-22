# WP63 任务单 — 审议输出 Schema 与可解释性设计

> **状态**：✅ 已交付（2026-11-05）→ [`engine-wp63-deliberation-schema-design-implementation-2026-11-05.md`](engine-wp63-deliberation-schema-design-implementation-2026-11-05.md)
> **路径**：`docs/worklog/completed/phase2/wp63-deliberation-schema-design-2026-11-05.md`
> **优先级**：🟡 P1
> **引擎内核**：✅ 零改动（只做适配层的类型 + schema + prompt 模板，不动内核一行）
> **前置依赖**：无（WP64 的前置，PoC 组第一个 WP）
> **北极星**：[`../../architecture/hybrid-bdi-agent-blueprint-v1.0.md`](../../architecture/hybrid-bdi-agent-blueprint-v1.0.md) §2.2 审议引擎层

---

## 1. 任务概述

### 1.1 一句话目标

为混合式 BDI 审议层设计**输出 JSON Schema** + **operatorTags 枚举** + **审议 prompt 模板**，让 LLM 能输出结构化的 delta 建议，并且每一条 delta 都有可解释的理由。

### 1.2 为什么现在做

- WP64（LLM 审议层 PoC 影子模式）的前置——没有 schema 就不知道让 LLM 输出什么
- 影子模式要对比"规则算子 delta"和"LLM 审议 delta"，两边必须同口径才能对比
- 可解释性是医疗产品的红线——你不能告诉督导"LLM 觉得 trust 涨了 0.1"，你得说"因为咨询师说了共情的话，所以 trust 涨了 0.1"

### 1.3 本期不做什么

- ❌ 不写 LLM 调用逻辑（那是 WP64 的事）
- ❌ 不写格式校验和重试（那是 WP66 的事）
- ❌ 不改 engine-core 任何文件
- ❌ 不做生产切换（影子模式是 WP64 的事）

---

## 2. 现状盘查结论（已 grep 全渲染层核实）

### 2.1 内核 DeltaVector 结构（11 个维度）

```ts
// src/engine-core/cognition/state-transition.ts:150
export interface DeltaVector {
  readonly trust: number;      // 信任增量
  readonly safety: number;     // 安全感增量
  readonly bond: number;        // 纽带感增量
  readonly valence: number;    // 情绪效价增量 [-1, 1]
  readonly arousal: number;    // 情绪唤醒增量 [0, 1]
  readonly verbal: number;     // 话量阻抗增量
  readonly depth: number;      // 内容深度阻抗增量
  readonly style: number;      // 表达风格阻抗增量
  readonly positive: number;   // 正移情增量
  readonly negative: number;   // 负移情增量
  readonly dependency: number; // 依赖移情增量
}
```

**口径**：全部是增量（delta），不是绝对值。clamp 在 `applyDeltaVector` 里做，审议层只管输出增量。

### 2.2 现有事件类型（CounselorEventKind）

```ts
// src/engine-core/domain/events/session-event.ts
// 正向：empathy / acceptance / normalization / open_probe / affirmation
// 负向：judgment / preaching / minimizing / boundary_cross
// 中性：neutral
```

**这些就是 operatorTags 的种子**——LLM 审议时也要给每条 delta 打标签，标签枚举要和现有事件类型对齐，这样才能对比。

### 2.3 现有 LLM 结构化输出客户端

```ts
// src/counselor/providers/llm-json.client.ts
export interface CounselorLlmJsonRequest<T> {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly schemaDescription: string;  // 拼到 system prompt 尾部
  readonly validate: (raw: unknown) => T | null;
  readonly maxCompletionTokens: number;
  readonly timeoutMs: number;
  readonly tenantId: string;
  readonly userId: string;
}
```

**WP64 会复用这个客户端**，所以本期设计的 schema 要能塞进 `schemaDescription`，validate 函数要能塞进 `validate` 参数。

---

## 3. 本期做什么

### 3.1 新增审议输出类型（适配层）

新增 `src/engine-adapters/deliberation/deliberation-types.ts`，定义：

```ts
/**
 * 审议输出的一条 delta 建议.
 *
 * 为什么是"建议"不是"直接写入":
 *   影子模式阶段，LLM 输出只是旁路观察，不生效.
 *   将来切灰度后，也要过约束校验层（delta cap / 临床合理性）才落快照.
 */
export interface DeliberationDeltaEntry {
  /** 维度名（与内核 DeltaVector 的键一一对应）. */
  readonly dimension: DeliberationDim;
  /** 增量值（建议值，过约束校验层后才生效）. */
  readonly delta: number;
  /**
   * 操作标签 —— 可解释性核心字段.
   *
   * 为什么要 operatorTags:
   *   规则算子的 delta 来自固定的事件类型（empathy → trust +0.1）.
   *   LLM 审议的 delta 如果只是一个数，你不知道它为什么涨了/跌了.
   *   operatorTags 让 LLM 自己说"我为什么觉得 trust 涨了"——
   *   是因为共情？还是因为接纳？还是因为开放式提问？
   *
   * 枚举要和现有 CounselorEventKind 对齐，这样才能对比：
   *   规则算子打了 empathy 标签，delta=+0.10；
   *   LLM 审议也打了 empathy 标签，但 delta=+0.15 ——
   *   差异一目了然，而且能人工复核"0.15 是不是合理".
   */
  readonly operatorTags: readonly DeliberationOperatorTag[];
  /** 理由（一句话，中文，≤50 字）. */
  readonly reason: string;
}

/**
 * 审议完整输出.
 *
 * 为什么不直接输出 DeltaVector:
 *   DeltaVector 是 11 个字段全有的（即使增量为 0）.
 *   审议输出应该是"有变化才写"——没变化的维度不出现，减少 token.
 *   而且每条 delta 要带 operatorTags 和 reason，DeltaVector 没有这些字段.
 */
export interface DeliberationOutput {
  /** 本轮审议的 delta 建议列表（只有有变化的维度）. */
  readonly deltas: readonly DeliberationDeltaEntry[];
  /** 整体判断（来访当前状态的一句话总结，≤80 字）. */
  readonly summary: string;
  /**
   * 置信度 [0, 1].
   *
   * 为什么要置信度:
   *   LLM 自己也知道"这个我拿不准".
   *   影子模式对比时，低置信度的 delta 差异可以重点看——
   *   到底是 LLM 拿不准，还是规则算子漏了.
   */
  readonly confidence: number;
}
```

### 3.2 定义 DeliberationDim 和 DeliberationOperatorTag 枚举

```ts
/**
 * 审议维度（与内核 DeltaVector 的 11 个键一一对应）.
 *
 * 为什么单独列一个 type 而不是直接用 keyof DeltaVector:
 *   将来硬安全维度（自杀倾向 / 危机等级）不进审议，
 *   用单独的枚举可以显式排除，避免 LLM 输出不该它管的维度.
 */
export const DELIBERATION_DIMS = [
  'trust',
  'safety',
  'bond',
  'valence',
  'arousal',
  'verbal',
  'depth',
  'style',
  'positive',
  'negative',
  'dependency',
] as const;

export type DeliberationDim = (typeof DELIBERATION_DIMS)[number];

/**
 * 审议操作标签（可解释性核心）.
 *
 * 种子枚举与现有 CounselorEventKind 对齐（规则算子用的那套），
 * 再加几个"LLM 能看到但规则算子看不到"的标签：
 *   - micro_expression —— 微表情 / 语气变化（规则算子靠关键词匹配，看不到这个）
 *   - implicit_resistance —— 隐性阻抗（话里没说但感觉在躲）
 *   - rapport_shift —— 关系氛围微妙变化
 *
 * 为什么加这几个:
 *   规则算子的局限性就是"靠关键词匹配"，
 *   LLM 的优势就是"能理解语境和隐含意思".
 *   operatorTags 把这个优势显式化——
 *   影子模式对比时，打了这几个标签的 delta 就是"规则算子覆盖不了、需要 LLM"的证据.
 */
export const DELIBERATION_OPERATOR_TAGS = [
  // —— 与现有事件类型对齐（规则算子也打这些标签）——
  'empathy',           // 共情回应
  'acceptance',        // 接纳 / 不评判
  'normalization',     // 正常化 / 普遍化
  'open_probe',        // 开放式提问
  'affirmation',       // 肯定 / 鼓励
  'judgment',          // 评判 / 指责
  'preaching',         // 说教 / 给建议
  'minimizing',        // 淡化 / 轻描淡写
  'boundary_cross',    // 边界侵犯
  // —— LLM 独有的标签（规则算子看不到这些）——
  'micro_expression', // 微表情 / 语气变化（隐含情绪）
  'implicit_resistance', // 隐性阻抗（话里没明说但感觉在躲）
  'rapport_shift',     // 关系氛围微妙变化（信任/安全感的细微升降）
] as const;

export type DeliberationOperatorTag = (typeof DELIBERATION_OPERATOR_TAGS)[number];
```

### 3.3 审议 prompt 模板

新增 `src/engine-adapters/deliberation/deliberation-prompt.ts`，导出两个函数：

```ts
/**
 * 考核模式系统 prompt.
 *
 * 什么是考核模式:
 *   咨询师在备考频道，有评分对错。
 *   这种模式下，LLM 审议要严格——
 *   因为将来考核评分要参考审议结果，不能太宽松。
 */
export function buildDeliberationSystemPrompt(mode: 'exam' | 'freeform'): string;

/**
 * 用户 prompt —— 把当前状态 + 咨询师的话 + 来访的反应，
 * 组装成 LLM 能理解的输入.
 */
export function buildDeliberationUserPrompt(input: {
  /** 当前 BDI 状态快照（JSON 字符串，LLM 能读）. */
  readonly currentSnapshotJson: string;
  /** 本轮咨询师说的话. */
  readonly counselorText: string;
  /** 本轮来访的反应（渲染出来的文本）. */
  readonly visitorText: string;
  /** 角色种子信息（依恋类型 / 大五人格 简述）. */
  readonly characterBrief: string;
  /** 会话轮次. */
  readonly turnIndex: number;
}): string;
```

**系统 prompt 设计要点**（写在文件里，不是任务单里展开）：

1. **角色定位**：你是一个心理咨询督导，正在观察一场咨询对练。
2. **任务**：根据咨询师的回应和来访的反应，判断来访的内心状态应该怎么变化。
3. **输出契约**：严格输出 JSON，格式见 schemaDescription。
4. **约束**：
   - 只输出软状态维度（trust/safety/bond/valence/arousal/resistance/transference）
   - **不要**输出硬安全维度（自杀倾向 / 自伤风险 / 危机等级）——那些由规则引擎负责
   - 增量值范围：每个维度的 delta 绝对值不超过 0.2（单轮上限，和 cap 对齐）
   - 没变化的维度不要写
   - 每条 delta 都要打 operatorTags 和理由

5. **考核模式 vs 自由模式**：
   - 考核模式：更严格，边界侵犯 / 评判这类负向标签要打准，delta 幅度要保守
   - 自由模式：更灵活，可以捕捉更细微的变化（micro_expression / implicit_resistance）

### 3.4 schemaDescription（拼到 system prompt 尾部）

写一个函数，把 JSON schema 用自然语言描述出来，拼到 system prompt 尾部。

**为什么用自然语言描述而不是直接放 JSON Schema**:
- MiniMax 这类模型对自然语言 schema 描述的理解比 JSON Schema 更好
- 和现有 `CounselorLlmJsonClient` 的用法一致（schemaDescription 就是干这个的）

---

## 4. 边界问题补充

### 4.1 ⚠️ 为什么不改内核？

**因为本期只定义"输入输出契约"，不接进管道。**

- 内核的 `DeltaVector` 已经定义好了，本期只是在适配层定义"LLM 输出长什么样"
- 影子模式怎么接进会话管道，那是 WP64 的事
- 约束校验层怎么过 delta，那是后面 WP 的事

### 4.2 ⚠️ 为什么不直接复用 DeltaVector？

**因为 DeltaVector 是"全量"的，审议输出是"增量"的。**

- DeltaVector 有 11 个字段，每个字段都必须有值（即使是 0）
- 审议输出应该是"有变化才写"——没变化的维度不出现，减少 token 消耗
- 而且每条 delta 要带 operatorTags 和 reason，DeltaVector 没有这些字段

**但两边必须同口径**：DeliberationDim 的枚举值和 DeltaVector 的键名逐字一致。这样将来 LLM 输出的 delta 能直接转成 DeltaVector 喂给 `applyDeltaVector`。

### 4.3 ⚠️ 为什么 operatorTags 要加 LLM 独有的标签？

**因为这就是 LLM 的价值所在。**

- 规则算子靠关键词匹配："听起来你" → empathy
- LLM 能理解语境：咨询师说的话表面是开放式提问，但语气很敷衍 → 其实没帮助，甚至有点伤害
- operatorTags 把这个差异显式化——影子模式跑完，统计一下打了 `micro_expression` / `implicit_resistance` 的 delta 有多少，就是"规则算子覆盖不了的场景有多少"

---

## 5. 边界约束

### 5.1 内核改动

**零改动。** 本期只在适配层新增类型 + schema + prompt 模板。

### 5.2 适配层改动（2 个文件）

1. `src/engine-adapters/deliberation/deliberation-types.ts` —— **新增** 审议输出类型 + 枚举
2. `src/engine-adapters/deliberation/deliberation-prompt.ts` —— **新增** prompt 模板函数

### 5.3 测试文件

1. `test/engine-adapters/wp63-deliberation-schema.spec.ts` —— **新增** 类型校验测试

### 5.4 不碰的地方

- ❌ 不改内核任何文件
- ❌ 不写 LLM 调用逻辑（WP64 的事）
- ❌ 不写格式校验和重试（WP66 的事）
- ❌ 不改 `.env.example`（本期没有配置项）
- ❌ 不改 `typings/global.d.ts`（本期没有 env 键）

---

## 6. 验收标准

### 6.1 功能验收

- [ ] `DeliberationOutput` 类型定义完整（deltas / summary / confidence）
- [ ] `DeliberationDim` 枚举 11 个值，与 `DeltaVector` 的键逐字一致
- [ ] `DeliberationOperatorTag` 枚举：9 个与现有事件类型对齐 + 3 个 LLM 独有标签
- [ ] `buildDeliberationSystemPrompt` 支持 exam / freeform 两种模式
- [ ] `buildDeliberationUserPrompt` 能把快照 + 咨询师的话 + 来访的反应组装成 prompt
- [ ] 生成的 schemaDescription 能拼到 system prompt 尾部

### 6.2 闸门验收

- [ ] `npx eslint "src/**/*.ts" "test/**/*.ts"` → 0 error
- [ ] `npx tsc -p tsconfig.build.json --noEmit` → 0 error
- [ ] `npx vitest run` → 全绿（零回归）
- [ ] `git diff --stat HEAD -- src/engine-core` → **空**（本期不改内核）

### 6.3 测试用例要求

至少补充：
1. `DeliberationDim` 枚举值数量正确（11 个）
2. `DeliberationOperatorTag` 枚举值数量正确（12 个）
3. 两个枚举值之间的一致性检查（DeliberationDim 的键名和 DeltaVector 的键名逐字一致）
4. system prompt 两种模式的差异（exam 模式有"严格"相关的措辞，freeform 有"灵活"相关的措辞）
5. user prompt 组装正确（快照 JSON / 咨询师的话 / 来访的反应都在里面）

---

## 7. 本期没做的（明确留给后续）

1. **LLM 调用逻辑** —— WP64 的事
2. **格式校验和重试** —— WP66 的事
3. **约束校验层接入** —— 审议输出过 delta cap / 临床合理性校验
4. **生产切换** —— 影子模式验证完才谈

---

## 8. 转述给后端的话术

> WP63：审议输出 Schema 与可解释性设计。
>
> 开工前先读 `docs/README.md` 和 `docs/worklog/README.md` 入口，确认红线和交付格式。
>
> 任务单在 `docs/worklog/pending/wp63-deliberation-schema-design-2026-11-05.md`。
>
> **内核零改动** —— 本期只在适配层新增两个文件：
> - `deliberation-types.ts` —— 审议输出类型 + 枚举
> - `deliberation-prompt.ts` —— prompt 模板函数
>
> 关键口径：
> - `DeliberationDim` 11 个值，和内核 `DeltaVector` 的键逐字一致（grep 核实过）
> - `DeliberationOperatorTag` 12 个：9 个和现有事件类型对齐 + 3 个 LLM 独有标签
> - 本期只定义"输入输出契约"，不接进管道（影子模式是 WP64 的事）
> - 硬安全维度（自杀倾向 / 危机等级）不进审议输出，只走规则
>
> 任务单里所有函数名 / 类型名 / 文件路径都是 grep 核实过的，不是凭印象写的。
>
> 交付按 `team/conventions.md` §二的格式写交付记录：改了哪些文件、关键设计决策（跟任务单有出入要说明）、闸门数字。

---

## 9. 交付后补记（2026-11-05）

> 交付记录：[`engine-wp63-deliberation-schema-design-implementation-2026-11-05.md`](engine-wp63-deliberation-schema-design-implementation-2026-11-05.md)
> 下表逐条登记**与任务单原文的偏差**，每条都能自圆其说。

| # | 任务单原文 | 实际落地 | 为什么 |
|---|---|---|---|
| 1 | §3.2 / §6.3.2「9 个与现有事件类型对齐 + 3 个 LLM 独有标签」= **12 个** | 对齐组 **10 个**（补回 `sensitive_touch`）+ LLM 独有 3 个 = **13 个** | grep 核实：内核 `DELTA_TABLE` 里 `sensitive_touch` 是**有真实非零 delta** 的算子（arousal +0.15 / safety -0.01 / verbal +0.05 / depth +0.05 / style +0.06 / valence -0.05 / negative +0.04），任务单那 9 个**漏了它**。漏掉的后果有两条：① 影子模式对比时规则侧能打、审议侧不能打 → 那类 delta **永远匹配不上**；② LLM 明明看到"咨询师把话题引到了创伤"却被迫乱打别的标签 → **恰好掐掉 LLM 最该贡献的信号**。它也不是硬安全维度（触碰议题的 delta 是 arousal/safety 的软变化，走普通 cap 档位），所以 §4.3「硬安全不进审议」不适用于它。反过来 `neutral` **不进**标签枚举 —— 它在 `DELTA_TABLE` 里就是 `ZERO`，是"没命中任何规则"的占位，不会成为任何一条 delta 的成因。详见交付记录 §2.1 |
| 2 | §3.2 一个扁平数组（12 个值） | 拆成 `DELIBERATION_RULE_ALIGNED_TAGS`(10) + `DELIBERATION_LLM_ONLY_TAGS`(3)，全集由**拼接**得出 | 影子模式的核心用法是**对比**；"只有 LLM 打了的标签占多少" = "规则算子覆盖不了的场景有多少" = 审议层价值的**证据**。这个统计要能一眼算出来，两组就得是**两个可分别引用的常量**；混在一个数组里，统计代码就得硬编码一张"哪些是 LLM 独有"的表 —— 又一份会漂移的真相源。全集用拼接而非再写一遍，保证清单只有一份 |
| 3 | §3.2 / §6.3.3「逐字一致」 | 额外加 `as const satisfies readonly (keyof DeltaVector)[]` 与 `as const satisfies readonly CounselorEventKind[]` **编译期**约束 | `satisfies` 让"写错一个键名"（如 `emotionValence`）**编译期就红**，不用等运行时才发现模型吐了非法维度。仓库既有同款治本（`DELTA_TABLE` 的 `Record<CounselorEventKind, DeltaVector>`：两边多一个少一个，类型检查当场报错）。⚠️ `satisfies` 只保证**子集**方向，「内核加维度时审议要不要跟」由**单测**守（反向）—— 两条方向分开守，合成一条就会漏掉一半 |
| 4 | §3.4「把 schema 拼到 system prompt 尾部」 | **不提供**"合并版"函数；只出三个零件（system / user / schemaDescription），拼装由 `CounselorLlmJsonClient` 独家负责（它已在 `llm-json.client.ts:115` 拼了） | 再造一个合并版 = 两种拼法并存，WP64 一不留神就把 schema 拼两遍（模型收到两遍未必出错，但那是**两份 prompt 真相**）。测试用"两个零件拼起来自洽"验证 §6.1 的验收项，不新增第三个函数 |
| 5 | §3.4「把 JSON schema 用自然语言描述出来」 | 枚举清单**从常量生成**（连数量都是 `.length` 算出来的），不手写 | 手写一份 = 两份真相 —— 内核加了维度而 prompt 没跟上，模型就会输出非法维度，而这种错误在影子模式里**不会立刻炸**（只是让 LLM 少判一个维度）。生成 = 不可能漂移 |
| 6 | §3.3 约束清单（未提"不许产分数"） | 硬约束里显式加第 7 条「不要输出分数、评级或对错判断」 | 零压红线（AGENTS.md §5.3）：分数只允许出现在 MCQ 备考频道。`DeliberationOutput` 的形状在**两种模式下完全相同**（只有措辞严格度不同），所以"不许产分数"是**契约级**约束，不是某模式的特例 —— 必须落在两种模式共用的公共段里 |
| 7 | §3.3「增量值范围：每个维度的 delta 绝对值不超过 0.2（单轮上限，和 cap 对齐）」 | 保留 0.2，但在代码注释与交付记录里**如实写明**它是粗口径 | 内核 `DEFAULT_DELTA_CAP_CONFIG` 是**逐维且上下向不对称**的：trust/safety/bond/valence 上 +0.20 下 -0.30；arousal 与阻抗三维 ±0.20；**移情三维 ±0.15**。所以"0.2 和 cap 对齐"是简化（移情三维其实是 0.15）。审议层只产**建议**，clamp 是**下游约束校验层**（北极星 §2.3）的职责 —— 但绝不能让 prompt 假装自己精确。详见交付记录 §2.8 |
| 8 | §3.3 用户 prompt 入参（未说空值怎么办） | 空发言/空快照写**占位明文**（「（本轮来访者没有回复）」等），不留空串 | 留空 = 模型看到一段没有回答的提问，很可能**脑补**一个回答（然后把脑补内容写进 delta 的理由里）。显式写明"没有"是事实，模型不会替它编 —— 与仓库既有 `formatRollingSummaryInput` 同款治本，不另创一套 |
| 9 | §3.3 签名 `mode: 'exam' \| 'freeform'`（内联字面量） | 抽成 `DeliberationMode` 放在 `deliberation-types.ts` | 模式是**契约的一部分**（不是 prompt 的实现细节），WP64 的 service 也要按它分支 —— 抽出来两边共用一份 |
| 10 | §2.3 提北极星 §2.2 的输出示例（`deltas` 是**对象 map**，理由/标签在**顶层**，字段名 `emotionValence` / `resistance`） | 输出形状跟**任务单**（`deltas` 是**数组**，每条自带 dimension/delta/operatorTags/reason；维度名逐字对齐内核键） | ① 对象 map 挂不住"每条 delta 各自的理由"（11 维共用一个顶层 reason = 没解释），而"可解释性"正是本单的目的；② 北极星示例的维度名与内核 `DeltaVector` 对不上（内核没有 `resistance` 这个键），任务单的逐字对齐才是对的 —— 否则将来 LLM 输出的 delta 没法直接喂 `applyDeltaVector` |
| 11 | §5.2 适配层 2 个文件 / §5.3 测试 1 个文件 | **完全照办**（文件数与路径逐字一致：`deliberation-types.ts` / `deliberation-prompt.ts` / `test/engine-adapters/wp63-deliberation-schema.spec.ts`） | 本单是**纯新增**：3 个新文件，**0 个既有文件被修改**（`git status` 里本单条目全是 `??`）—— 这是本单最强的零回归论据 |
| 12 | §6.3 用例清单（5 条） | **全部实现**，另加 **25 例**（`neutral` 不进标签 / `sensitive_touch` 在标签里 / 两种模式都禁硬安全维度 / 两种模式都禁产分数 / 空发言占位 / schema 枚举清单与常量一致 / 输出契约形状） | 用例总数：wp63 spec 新增 **30 例**；全量 100 文件 1634 例 → **101 文件 1664 例** |
| 13 | 任务单未提"审议 trace 日志格式" | **未做**（backlog 母版 WP63 行提到过） | `deliberation_trace` 表结构在 **WP64** 的范围内；本单只定义"理由长什么样"，不建表不改日志格式 |

**闸门**：eslint 0 error / 0 warning / tsc 0 error / vitest **101 文件 1664 例全绿**（既有 100 文件 1634 例零回归 + 本轮新增 1 文件 30 例）/ `git diff --stat HEAD -- src/engine-core` = **空**（内核零改动）/ `boundary.spec.ts` 12 例全绿。

---

_创建：2026-11-05_
_深度通知：`DeltaVector`（11 个维度）/ `CounselorEventKind`（事件类型）/ `CounselorLlmJsonClient`（结构化输出客户端）—— 全部 grep 核实_
