# WP50 任务单 — 渲染层接入同盟三维

> **状态**：✅ 已交付（2026-11-04）→ [`engine-wp50-render-spec-alliance-three-dimensions-implementation-2026-11-04.md`](engine-wp50-render-spec-alliance-three-dimensions-implementation-2026-11-04.md)
> **路径**：`docs/worklog/pending/wp50-render-spec-alliance-three-dimensions-2026-11-04.md`
> **优先级**：🟡 P1
> **引擎内核**：✅ 预批准改 engine-core（RenderSpec 契约扩展，与 WP42 同文件同范式）
> **前置依赖**：WP42（咨询同盟三维 trust/safety/bond）
> **北极星**：[`../../architecture/engine-endstate-blueprint-v1.0.md`](../../architecture/engine-endstate-blueprint-v1.0.md) §② BDI 推理层

---

## 1. 任务概述

### 1.1 一句话目标

WP42 已交付 trust / safety / bond 独立建模，但**渲染层（RenderSpec + prompt 组装）仍只看 trust** —— safety 低时 AI 措辞应该更谨慎、更简短，但现在没接。本期把 safety / bond 接入 RenderSpec，让渲染层能根据三维状态调整措辞策略。

### 1.2 为什么现在做

- WP42 交付记录自己登记了缺口：「渲染层仍只看 trust，safety / bond 没接」
- 现在内测时会出现：safety 0.2（来访不敢说真话），但 AI 还在往深了问，效果不对
- 这是 WP42 的补完项，做完之后同盟三维才真正端到端生效

---

## 2. 现状盘查结论（已 grep 全 engine-core 核实）

### 2.1 BdiSnapshot 同盟三维现状

```ts
// bdi-snapshot.ts:99-103
readonly trust: number;   // 来访相信咨询师是专业的、不会评判自己
readonly safety: number;  // 来访在这段关系里感到安全，可以敞开心扉
readonly bond: number;   // 来访与咨询师有情感连接，不是冷冰冰的问诊
```

**问题**：三维都有，但渲染层只用了 trust。

### 2.2 RenderSpec 现状

```ts
// render-types.ts:84-85
/** 关系信任 [0,1]. */
readonly trust: number;
```

**问题**：只有 trust 一个字段，没有 safety 和 bond。

### 2.3 spec-assembler 现状

```ts
// spec-assembler.ts:94
trust: input.output.snapshot.trust,
```

**问题**：只传了 trust，没传 safety 和 bond。

### 2.4 prompt 组装现状

```ts
// turn-render-orchestrator.ts:946
`- 信任：${formatNumber(spec.trust)}（越低越戒备、越不愿多说）`,
```

**问题**：只提了信任，没提 safety 和 bond。

### 2.5 boundary.spec.ts 白名单现状

- `RenderSpec` 已在白名单（第 372 行）
- `domain/rendering/render-types.ts` 已在白名单（第 452 行）

**接口内部加可选字段不需要新增白名单条目**。

### 2.6 扩展模式先例

`AdaptiveRenderSpec` 已经扩展过两次（riskSignal / characterLabel），都是加**可选字段**——既有单测 / 既有调用方一行不用改。本期沿用同一范式。

---

## 3. 本期做什么

### 3.1 RenderSpec 加两个可选字段

```ts
// render-types.ts
export interface RenderSpec {
  // ... 其他字段不变 ...

  /** 关系信任 [0,1]. */
  readonly trust: number;

  /**
   * 关系安全感 [0,1] (WP42).
   *
   * 来访在这段关系里感到安全, 可以敞开心扉.
   * 缺省 = 不提供 (行为与 WP5 逐字一致).
   */
  readonly safety?: number;

  /**
   * 关系联结 [0,1] (WP42).
   *
   * 来访与咨询师有情感连接, 不是冷冰冰的问诊.
   * 缺省 = 不提供 (行为与 WP5 逐字一致).
   */
  readonly bond?: number;
}
```

**为什么是可选不是必填**：
- 缺省 = 不传 = 行为与现在逐字一致
- 现有的测试 / 调用方不用改
- 零回归

### 3.2 spec-assembler 接上

```ts
// spec-assembler.ts:88-114
return {
  taskKind: input.taskKind ?? 'chat',
  intention,
  emotion: input.output.snapshot.emotion,
  resistance: input.output.snapshot.resistance,
  transference: input.output.snapshot.transference,
  trust: input.output.snapshot.trust,
  // 新增：
  safety: input.output.snapshot.safety,
  bond: input.output.snapshot.bond,
  coreBeliefs: input.output.snapshot.coreBeliefs,
  // ... 其他字段不变 ...
};
```

### 3.3 prompt 组装接上

```ts
// turn-render-orchestrator.ts:936-947
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

  // 新增：safety 和 bond 只在提供时才显示（零回归）
  if (spec.safety !== undefined) {
    lines.push(`- 安全感：${formatNumber(spec.safety)}（越低越不敢说真话、越试探性）`);
  }
  if (spec.bond !== undefined) {
    lines.push(`- 联结感：${formatNumber(spec.bond)}（越低越疏离、越像问诊）`);
  }

  // ... 后续不变 ...
}
```

**口径说明**：
- safety / bond 只在提供时才加进 prompt（可选字段）
- 缺省 = 不显示 = prompt 逐字不变
- 文案是**工程种子值，非临床标定**——内测后按真实对练校准

---

## 4. 边界问题补充

### 4.1 ⚠️ 为什么加进内核 RenderSpec 而不是 AdaptiveRenderSpec？

**因为 safety 和 bond 是 BDI 状态的一部分，是内核决策的产物，不是适配层的路由输入。**

- trust 已经在内核 RenderSpec 里了，为什么 safety 和 bond 就不能？
- 把它们放在 AdaptiveRenderSpec 里，等于让适配层去读 snapshot，破坏了"组装是纯函数"的分层
- 正确的做法是：和 trust 放在一起，都在内核 RenderSpec 里

### 4.2 ⚠️ 为什么是可选字段而不是必填？

**零回归。**

- 改成必填，所有调用方都要改，测试也要改
- 改成可选，现有调用方一行不用改，只是 safety / bond 缺省 = 不传
- 和 sessionSummary / trajectoryNote 同一范式

### 4.3 ⚠️ prompt 里的文案是谁写的？

**本期写，但标「工程种子值，非临床标定」。**

- "安全感：越低越不敢说真话、越试探性"
- "联结感：越低越疏离、越像问诊"

这些是工程种子值，内测后按真实对练校准。

### 4.4 ⚠️ 要不要根据 safety / bond 调整轮次长短（verbosity）？

**本期不做。**

- 本期只是把 safety / bond 加进 prompt，让模型知道有这两个状态
- 要不要根据 safety 低就说更短，是下一步的事
- 先把数据接进去，内测后看效果再调

---

## 5. 边界约束

### 5.1 engine-core 预批准例外（1 个文件）

1. `src/engine-core/domain/rendering/render-types.ts` —— RenderSpec 加 safety / bond 两个可选字段

必须通过 `boundary.spec.ts` 的断言：零 @nestjs / 零网络 / 零 env / 零 prompt。

> 注：`boundary.spec.ts` 白名单已有 `RenderSpec` / `domain/rendering/render-types.ts` 两个条目，接口内部加可选字段不需要新增白名单条目。

### 5.2 适配层改动（2 个文件）

1. `src/engine-adapters/rendering/spec-assembler.ts` —— 把 snapshot.safety / snapshot.bond 传进 RenderSpec
2. `src/engine-adapters/rendering/turn-render-orchestrator.ts` —— prompt 组装加 safety / bond 两行

### 5.3 不碰的地方

- ❌ 不改 BdiSnapshot 的结构（已经是三维了）
- ❌ 不改 RenderResult（结果结构不变）
- ❌ 不改 render-risk.ts（风险信号扩展不变）
- ❌ 不改轮次长短（verbosity）的判定逻辑（本期只加数据，不调策略）
- ❌ 不改 .env / 配置文件（不需要新 env）

---

## 6. 验收标准

### 6.1 功能验收

- [ ] RenderSpec 加了 safety / bond 两个可选字段
- [ ] spec-assembler 把 snapshot.safety / snapshot.bond 传进去了
- [ ] prompt 组装在提供 safety / bond 时会显示对应行
- [ ] 缺省 = 不提供 = prompt 逐字不变（零回归）

### 6.2 闸门验收

- [ ] `npx eslint "src/**/*.ts" "test/**/*.ts"` → 0 error
- [ ] `npx tsc -p tsconfig.build.json --noEmit` → 0 error
- [ ] `npx vitest run` → 全绿（零回归）
- [ ] `git diff --stat HEAD -- src/engine-core` → 只有 1 个文件（render-types.ts）

### 6.3 内核测试用例要求

扩展文件：`test/engine-core/wp5-rendering.spec.ts`

至少补充：
1. RenderSpec 提供 safety / bond 时，对象里有这两个字段
2. RenderSpec 不提供 safety / bond 时，对象里没有这两个键（零回归）

适配层测试要求：
扩展文件：`test/engine-adapters/wp7-turn-render.spec.ts`

至少补充：
1. spec-assembler 把 snapshot.safety / snapshot.bond 传进 RenderSpec
2. prompt 组装在提供 safety / bond 时会显示对应行
3. prompt 组装在不提供 safety / bond 时，逐字不变（零回归）

---

## 7. 本期没做的（明确留给后续）

1. **根据 safety / bond 调整轮次长短（verbosity）** —— 本期只加数据，不调策略。内测后看效果再调
2. **根据 safety / bond 调整措辞风格（比如 safety 低就更温和）** —— 同上，先接数据，再调策略
3. **角色种子 safety / bond 基线** —— 那是 WP51 的事
4. **渲染层接入风险信号的措辞调整** —— 那是 WP9-C 已做的事

---

## 8. 转述给后端的话术

> WP50：渲染层接入同盟三维。
>
> 开工前先读 `docs/README.md` 和 `docs/worklog/README.md` 入口，确认红线和交付格式。
>
> 任务单在 `docs/worklog/pending/wp50-render-spec-alliance-three-dimensions-2026-11-04.md`。
>
> 预批准改 engine-core，只改 1 个内核文件：
> - `domain/rendering/render-types.ts` —— RenderSpec 加 safety / bond 两个可选字段
>
> 适配层改 2 个文件：
> - `spec-assembler.ts` —— 把 snapshot.safety / snapshot.bond 传进 RenderSpec
> - `turn-render-orchestrator.ts` —— prompt 组装加 safety / bond 两行
>
> 关键口径：
> - safety / bond 是**可选**字段，缺省 = 不传 = 行为与现在逐字一致
> - 只在提供时才加进 prompt，缺省 = 不显示 = prompt 逐字不变
> - prompt 文案是工程种子值，非临床标定
>
> 任务单里所有函数名 / 类型名 / 文件路径都是 grep 核实过的，不是凭印象写的。
>
> 如果真要改 engine-core 的其他地方，先和我确认，不要自己拍板。
>
> 交付按 `team/conventions.md` §二的格式写交付记录：改了哪些文件、关键设计决策（跟任务单有出入要说明）、闸门数字。

---

_创建：2026-11-04_
_深度通知：`RenderSpec` 接口 / `spec-assembler` 组装点 / `buildVisitorSystemPrompt` prompt 组装 / boundary.spec.ts 白名单，全部 grep 核实_

---

## 9. 交付后补记（2026-11-04）

按 `team/conventions.md` §2.5 记录**任务单与实际交付的偏差**，详细论证见交付记录。

| # | 任务单写的 | 实际交付 | 理由 |
|---|---|---|---|
| 1 | §5.1 + §5.2 共 3 个文件（1 内核 + 2 适配层） | **完全一致**（零意外） | grep 核实 `src/` 内 **`buildRenderSpec` 是唯一的 `RenderSpec` 生产者** —— `trust:` 在 `src/` 命中 4 处，另外两处（`voice/voice.types.ts` 的 `VoiceCatchUpBdiSnapshot`、`admin-debug/trace-recorder.service.ts` 的 `TurnTrace.bdiSnapshot`）是**别的契约形状**，与 `RenderSpec` 无关。所以本单改动面就是这 3 个文件 |
| 2 | §3.1 / §3.2 两个**可选**字段 + 组装器直接传 | **一致** | 但要把「零回归」的两层口径分清：**契约层可选**（别的生产者可以不带）→ **组装层无条件**（`BdiSnapshot` 三维必填，生产一定带）→ **渲染层条件**（没值就不渲染那一行）。任务单 §6.1 那句「缺省 = prompt 逐字不变」说的是**渲染层**，不是说生产 prompt 不变 —— 生产上 prompt **每轮多两行**，这正是本单的目的 |
| 3 | §3.2 组装器直接传 | **直接传，不做条件展开** | `BdiSnapshot` 的三维自 WP42 起**必填**（`bootstrap.ts` 恒给 0.3 / 0.5 / 0），「缺省」在数据源上不可能发生。若写成条件展开，生产上这两个字段会长期缺席 → **这个 WP 等于没做**；而且会误导后来人以为「生产上可能不带」。与 `sessionSummary` / `trajectoryNote` 那类**真的可能没有**的字段不是一类事 |
| 4 | §4.1 进内核 `RenderSpec` 不进适配层 | **一致**（并补记核实结论） | 同盟三维是内核决策产物，与 `trust` 同性质；放 `AdaptiveRenderSpec` 等于让适配层自己读 snapshot，破坏「组装是纯函数」的分层 |
| 5 | §3.3 prompt 文案 | **逐字用任务单原文**，一个字不改 | 并在代码注释与文件头标「⚠️ 工程种子值，非临床标定」。本单**不发明**新文案，也不改既有三行的措辞 |
| 6 | §4.3 只加数据不调策略 | **一致**，但补了一条**可回归断言** | `resolveTurnVerbosity` 一字未改。用例钉死：safety 0.05 / bond 0 时，prompt 里「这一轮怎么说」那一段与基线**逐字相同**，而状态行确实传进去了（`- 安全感：0.05` 在）—— 否则三个月后有人顺手把 safety 加进 verbosity 判定，没人看得出来 |
| 7 | 任务单未提硬规则文案 | **一个字不改** | 硬规则第 3 条写的是「上面那些状态词（策略／情绪／阻抗／信念**等**）一个字都不要说出来」—— **「等」字已经兜住**新词。而改硬规则文案会让「没带同盟三维」的会话 prompt 也变，直接违反零回归底线 |
| 8 | §6.3 内核测试 2 条 | **扩到 3 条** | 补：「既有字段集合逐字不变」（11 个键排序后逐字比对）—— 加**可选**字段不该动到任何一个既有键 |
| 9 | §6.3 适配层测试 3 条 | **扩到 5 条** | 补：**safety / bond 低不改变轮次长短**（只加数据不调策略）/ **不带这两字段的普通 `RenderSpec` 仍是合法的 `AdaptiveRenderSpec`**（编译期保证别的生产者不必补） |
| 10 | §6.1「缺省 = prompt 逐字不变」 | **用双向断言钉死** | 只断言「没有『安全感』三个字」太弱 —— 万一顺手改了别处措辞也照样绿。双向：缺省版不含这两行 + 有这两行的版本**减去它们 == 缺省版** + 行数恰好差 2 |
| 11 | §6.3 内核测试「对象里没有这两个键」 | **用 `'safety' in spec` 断言**，不用 `toBeUndefined()` | `toBeUndefined()` **分不出**「没传」与「传了 undefined」—— 而这两者对渲染层不是一回事（「没传」= 不该显示这一行；「传了 undefined」= 是个 bug）。`in` 把口径钉在**键是否存在**上，与适配层 `!== undefined` 判断对齐 |
| 12 | §2.5 boundary 白名单行号 372 / 452 | **完全一致**（逐行核实） | 白名单早已有这两个条目 → 接口内部加可选字段不需要新增 → `boundary.spec.ts` **12 例零改动**通过 |

> 本期**没做**的（根据 safety / bond 调 verbosity / 调措辞风格 / 角色种子 safety-bond 基线 / 风险信号措辞调整）已在交付记录 §4 逐条留档。
>
> ⚠️ 提醒：生产 prompt **每轮会多两行**（`- 安全感：…` / `- 联结感：…`），token 增量很小，换来的是模型能看到三维状态。要看到**措辞**上的差别，得等内测 + 后续 WP 调策略（§7 第 1、2 条）。
