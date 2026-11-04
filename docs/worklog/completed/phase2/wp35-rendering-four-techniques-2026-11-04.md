# WP35 任务单 — 渲染四手法（阻抗-表达映射细化 + 情绪粒度 + 轻量随机）

> **状态**：✅ 已交付（2026-11-04）→ 交付记录：[`engine-wp35-rendering-four-techniques-implementation-2026-11-04.md`](engine-wp35-rendering-four-techniques-implementation-2026-11-04.md)
> **路径**：`docs/worklog/completed/phase2/wp35-rendering-four-techniques-2026-11-04.md`
> **优先级**：🟡 P1
> **引擎内核**：❌ 不改 engine-core（只改适配层渲染 prompt）—— **实改 0 个内核文件，`git diff --stat HEAD -- src/engine-core` 为空**
> **前置依赖**：WP50（同盟三维进渲染）
> **北极星**：[`../../architecture/engine-endstate-blueprint-v1.0.md`](../../architecture/engine-endstate-blueprint-v1.0.md) §④ 渲染层

---

## 1. 任务概述

### 1.1 一句话目标

现在的渲染 prompt 已经有了"话量"三档（短/中/长），但**语气、情绪表现、随机性**三个维度还是粗的 —— 阻抗高时模型只是"话说得短"，但语气还是一样；情绪只是一个标签 + 数值，模型不知道"这轮该怎么表现情绪"；每轮话术固定，模型容易说得千篇一律。

本期把渲染从"话量三档"升级到"四手法"：
1. **阻抗-表达映射细化** —— 除了话量，加上"语气疏离度"维度
2. **情绪粒度细化** —— 除了标签 + 数值，加上"这轮该怎么表现情绪"的指令
3. **表达层轻量随机** —— 加一点随机性，避免每轮都一样
4. **口语化/非语言** —— 补一点非语言表达（叹气、停顿、犹豫）

### 1.2 为什么现在做

- 内测时发现模型说话"太规整" —— 每轮都是差不多的句式、差不多的长度、差不多的语气
- 阻抗高时模型只是"话说得短"，但语气还是一样 —— 没有"疏离感"
- 情绪只是一个标签，模型不知道"这轮该怎么表现" —— 比如"焦虑"时是该语速快、还是该犹豫、还是该反复确认？
- 这是渲染层从"能用"到"专业"的关键一步

---

## 2. 现状盘查结论（已 grep 全渲染层核实）

### 2.1 现在的话量三档

```ts
// turn-render-orchestrator.ts:902-914
function resolveTurnVerbosity(spec: AdaptiveRenderSpec): TurnVerbosity {
  const verbal = spec.resistance.verbal;
  const strategy = spec.intention.strategy;
  if (verbal >= 0.55 || spec.trust <= 0.3 || strategy === 'resistance') return 'short';
  if (verbal <= 0.3 && spec.trust >= 0.55 &&
      (strategy === 'cognitive_exploration' || strategy === 'affective_exploration' ||
       strategy === 'insight' || strategy === 'recounting')) {
    return 'long';
  }
  return 'medium';
}
```

**问题**：只有"话量"一个维度，没有"语气"维度。

### 2.2 现在的话量话术

```ts
// turn-render-orchestrator.ts:919-923
const VERBOSITY_INSTRUCTION: Readonly<Record<TurnVerbosity, string>> = {
  short: '这轮你不太想多说：回答要短、要躲闪，可以用「嗯」「还好吧」「不知道」这类短回应。',
  medium: '这轮你按平时的样子说话，不刻意多讲，也不刻意收着。',
  long: '这轮你愿意多说一点：可以多解释几句，把你的想法讲清楚一些。',
};
```

**问题**：只有话量，没有语气、没有情绪表现、没有随机性。

### 2.3 现在的情绪渲染

```ts
// turn-render-orchestrator.ts:964
`- 情绪：${EMOTION_LABEL[spec.emotion.label]}（效价 ${formatNumber(spec.emotion.valence)}，唤醒 ${formatNumber(spec.emotion.arousal)}）`,
```

**问题**：只有标签 + 数值，没有"这轮该怎么表现情绪"的指令。模型知道"我现在是焦虑"，但不知道"焦虑时该怎么说话"。

### 2.4 现在的 prompt 结构

```ts
// turn-render-orchestrator.ts:957-1060
function buildVisitorSystemPrompt(spec: AdaptiveRenderSpec): string {
  const lines: string[] = [
    '你正在扮演一位来访者...',
    '说话方式：用中文口语，短句...',
    '',
    '你此刻的内在状态（只用来约束你的语气与节奏，绝对不要说出口）：',
    `- 行为策略：...`,
    `- 情绪：...`,
    `- 阻抗：...`,
    `- 移情：...`,
    `- 信任：...`,
    // + safety / bond / sessionSummary / recall / coreBeliefs / forbiddenBehaviors / trajectoryNote
    '',
    '这一轮怎么说：',
    VERBOSITY_INSTRUCTION[resolveTurnVerbosity(spec)],
    '说完一两句就停下来...',
    // + risk guardrail
    '',
    '硬规则：...',
  ];
  return lines.join('\n');
}
```

**问题**：prompt 结构清晰，但"这一轮怎么说"只有话量三档，不够细。

---

## 3. 本期做什么

### 3.1 手法一：阻抗-表达映射细化（加"语气疏离度"维度）

现在只有话量（短/中/长），加上语气疏离度（疏离/中性/亲近）：

```ts
// 新增：语气疏离度三档
type TurnWarmth = 'distant' | 'neutral' | 'warm';

function resolveTurnWarmth(spec: AdaptiveRenderSpec): TurnWarmth {
  // 阻抗风格高 + 信任低 + safety 低 → 疏离
  if (spec.resistance.style >= 0.55 || spec.trust <= 0.3 || (spec.safety !== undefined && spec.safety <= 0.3)) {
    return 'distant';
  }
  // 信任高 + safety 高 + bond 高 → 亲近
  if (spec.trust >= 0.6 && (spec.safety === undefined || spec.safety >= 0.6) && (spec.bond === undefined || spec.bond >= 0.3)) {
    return 'warm';
  }
  return 'neutral';
}

const WARMTH_INSTRUCTION: Readonly<Record<TurnWarmth, string>> = {
  distant: '语气有点疏离：像在应付、像隔着一层，不太愿意真正投入。',
  neutral: '语气按平时的样子，不刻意亲近也不刻意疏远。',
  warm: '语气放松一点：愿意多说几句，也愿意流露一点真实感受。',
};
```

**口径说明**：
- 疏离度三档：distant / neutral / warm
- 判定口径：阻抗风格 + 信任 + safety + bond
- 文案是**工程种子值，非临床标定**

### 3.2 手法二：情绪粒度细化（加"这轮该怎么表现情绪"）

现在只有标签 + 数值，加上"情绪表现方式"指令：

```ts
// 新增：情绪表现方式映射
//   实际情绪标签 (EMOTION_LABEL, turn-render-orchestrator.ts:846-857):
//   neutral / sad / anxious / angry / hurt / guarded / relieved / hopeful / ashamed / empty
function resolveEmotionExpression(spec: AdaptiveRenderSpec): string {
  const { label, arousal } = spec.emotion;
  // 按情绪标签 + arousal 数值给具体的表现方式
  switch (label) {
    case 'anxious':
      return arousal > 0.6
        ? '这轮你有点焦虑：语速偏快、容易犹豫、可能反复确认对方的意思。'
        : '这轮你有点不安：话里带着不确定，可能会停顿一下再说。';
    case 'sad':
      return '这轮你情绪低落：语速偏慢、声音轻，可能会叹气或停顿。';
    case 'angry':
      return arousal > 0.6
        ? '这轮你有点恼火：语气冲一点、话短，可能会有点不耐烦。'
        : '这轮你有点不爽：语气有点硬，不太想多解释。';
    case 'hurt':
      return '这轮你有点受伤：话里带着委屈，可能会停顿一下、声音轻一点。';
    case 'guarded':
      return '这轮你有点戒备：话里带着试探，不太愿意说真话。';
    case 'hopeful':
      return '这轮你有点期待：语气放松一点，愿意多说几句。';
    case 'relieved':
      return '这轮你松了口气：语气放松、语速正常。';
    case 'neutral':
    default:
      return ''; // 中性不给额外指令
  }
}
```

**口径说明**：
- 按情绪标签 + arousal 数值给具体的表现方式
- 中性情绪不给额外指令（零回归）
- 文案是**工程种子值，非临床标定**

### 3.3 手法三：表达层轻量随机

现在每轮话术固定，加一点随机性：

```ts
// 新增：轻量随机（在 short/medium/long 基础上微调）
function resolveVerbosityWithRandomness(spec: AdaptiveRenderSpec): string {
  const base = VERBOSITY_INSTRUCTION[resolveTurnVerbosity(spec)];
  // 20% 概率加一句"可以停顿一下再说"
  // 20% 概率加一句"可以用短回应"
  // （具体随机逻辑在 prompt 层做，不在内核做）
  return base;
}
```

**等等，这个要想清楚** —— 随机性放在哪一层？

**结论**：不放在适配层做随机（适配层是纯函数，每次结果一样）。而是在 prompt 里告诉模型"你可以有一点变化"：

```ts
// 在"这一轮怎么说"后面加一句：
'你可以有一点变化：不是每轮都用一样的句式，可以有时候停顿一下、有时候用短回应、有时候多说一点。';
```

这样模型自己会有随机性，不用适配层做随机。

### 3.4 手法四：口语化/非语言（补一点）

现在已经有"用中文口语，短句"，补一点非语言：

```ts
// 在"说话方式"那行后面补：
'可以有一点非语言的表达：比如停顿、叹气、犹豫，但不要写括号里的动作描写。';
```

---

## 4. 边界问题补充

### 4.1 ⚠️ 为什么不改内核？

**因为渲染是适配层的事。**

- 内核的 `RenderSpec` 已经包含了所有需要的数据（阻抗、信任、safety、bond、情绪...）
- 适配层负责把这些数据翻译成"模型该怎么说话"的 prompt
- 本期只改 `buildVisitorSystemPrompt()` 的文案，内核一行不动

### 4.2 ⚠️ 为什么条件渲染，不是无条件加？

**零回归底线。**

- 如果没有 safety / bond（旧的调用方），就不渲染那一行 → prompt 逐字不变
- 如果情绪是 neutral，就不给额外的情绪表现指令 → prompt 逐字不变
- 这和 WP50 的条件展开是同一范式

### 4.3 ⚠️ 本期不做什么？

1. **不改 `resolveTurnVerbosity()` 的判定逻辑** —— 只是加了一个 `resolveTurnWarmth()`，话量三档的判定口径一个字没改
2. **不改 EMOTION_LABEL 映射** —— 只是在它后面加了"情绪表现方式"
3. **不做"叙事风格"** —— WP41 才做表达风格（话量基线/叙事风格/语态倾向），本期不碰
4. **不做"表达层轻量随机"的适配层随机** —— 只在 prompt 里告诉模型"你可以有一点变化"

---

## 5. 边界约束

### 5.1 适配层改动（1 个文件）

1. `src/engine-adapters/rendering/turn-render-orchestrator.ts` —— `buildVisitorSystemPrompt()` 加三行（语气疏离度 + 情绪表现 + 随机提示）

### 5.2 不碰的地方

- ❌ 不改 `resolveTurnVerbosity()` 的判定逻辑
- ❌ 不改 `EMOTION_LABEL` 映射
- ❌ 不改 `RenderSpec` 类型
- ❌ 不改 engine-core 任何文件
- ❌ 不改 `.env` / 配置文件
- ❌ 不做"叙事风格"（WP41 才做）

---

## 6. 验收标准

### 6.1 功能验收

- [ ] prompt 里多了一行"语气疏离度"（distant / neutral / warm 三档）
- [ ] prompt 里多了一行"情绪表现方式"（按情绪标签 + arousal 给具体表现）
- [ ] prompt 里多了一行"你可以有一点变化"（轻量随机提示）
- [ ] prompt 里的"说话方式"补了一点非语言表达
- [ ] 零回归：没有 safety / bond 时 prompt 逐字不变；情绪是 neutral 时不给额外指令

### 6.2 闸门验收

- [ ] `npx eslint "src/**/*.ts" "test/**/*.ts"` → 0 error
- [ ] `npx tsc -p tsconfig.build.json --noEmit` → 0 error
- [ ] `npx vitest run` → 全绿（零回归）
- [ ] `git diff --stat HEAD -- src/engine-core` → **空**（本期不改内核）

### 6.3 测试用例要求

至少补充：
1. 语气疏离度三档判定（distant / neutral / warm）
2. 情绪表现方式映射（anxiety / sadness / anger / joy / neutral）
3. 零回归：没有 safety / bond 时 prompt 逐字不变
4. 零回归：情绪是 neutral 时不给额外指令

---

## 7. 本期没做的（明确留给后续）

1. **叙事风格**（WP41 才做）—— 话量基线/叙事风格/语态倾向
2. **表达层真正的适配层随机** —— 本期只在 prompt 里提示模型"你可以有一点变化"
3. **情绪粒度的临床校准** —— 本期是工程种子值，内测后按真实对练校准
4. **语气疏离度的临床校准** —— 同上

---

## 8. 转述给后端的话术

> WP35：渲染四手法（阻抗-表达映射细化 + 情绪粒度 + 轻量随机）。
>
> 开工前先读 `docs/README.md` 和 `docs/worklog/README.md` 入口，确认红线和交付格式。
>
> 任务单在 `docs/worklog/pending/wp35-rendering-four-techniques-2026-11-04.md`。
>
> **不改 engine-core**，只改适配层 1 个文件：
> - `turn-render-orchestrator.ts` —— `buildVisitorSystemPrompt()` 加三行（语气疏离度 + 情绪表现 + 随机提示）
>
> 关键口径：
> - 不改 `resolveTurnVerbosity()` 的判定逻辑（话量三档一个字没改）
> - 条件渲染：没有 safety / bond 时不渲染那一行（零回归）
> - 情绪是 neutral 时不给额外指令（零回归）
> - 文案是工程种子值，非临床标定
> - 本期只做"渲染层增强"，不做"叙事风格"（WP41 才做）
>
> 任务单里所有函数名 / 类型名 / 文件路径都是 grep 核实过的，不是凭印象写的。
>
> 交付按 `team/conventions.md` §二的格式写交付记录：改了哪些文件、关键设计决策（跟任务单有出入要说明）、闸门数字。

---

_创建：2026-11-04_
_深度通知：`resolveTurnVerbosity` / `VERBOSITY_INSTRUCTION` / `buildVisitorSystemPrompt` / `EMOTION_LABEL` / `STRATEGY_LABEL` / `AdaptiveRenderSpec` / `spec-assembler.ts` —— 全部 grep 核实_

---

## 9. 交付后补记（2026-11-04）

交付记录：[`engine-wp35-rendering-four-techniques-implementation-2026-11-04.md`](engine-wp35-rendering-four-techniques-implementation-2026-11-04.md)

下面这张表登记**与任务单原文的偏差**，每条都有理由。

| # | 任务单原文 | 实际落地 | 为什么 |
|---|---|---|---|
| 1 | §4.2「没有 safety / bond 时 prompt 逐字不变」 | 落地成**逐行**口径：依赖同盟维度的那一行（语气疏离度）缺省时不渲染；情绪表现那行在中性时不渲染；「你可以有一点变化」与非语言那两行**无条件**加 | 任务单**自相矛盾**：§6.1 要求无条件加「你可以有一点变化」+「说话方式补非语言」，那两条一落地，整段 prompt 就不可能"逐字不变"。所以逐字不变只能按**行**执行 —— 依赖可选数据的那两行缺省时不出现 |
| 2 | §3.1 `WARMTH_INSTRUCTION.warm` = 「语气放松一点：愿意多说几句，也愿意流露一点真实感受」 | 改为「语气放松一点：没那么防备，愿意流露一点真实感受」；`hopeful` 的「愿意多说几句」改为「话里带点盼头」 | 「愿意多说几句」是**话量**暗示，会与话量那一行**打架**（阻抗高但信任/安全感/联结感都高时两行给相反指令）。话量归话量、语气归语气 —— 两个维度必须正交 |
| 3 | §3.2 `resolveEmotionExpression` 只 switch 了 8 个标签，`ashamed` / `empty` 落到 `default` | 补齐 `ashamed` / `empty` 两段文案，**10 个实际标签全覆盖** | 任务单自己的注释列的是 10 个标签，草图的 switch 漏了两个 —— 漏的那两个会**静默落到 default 分支**，等于新情绪永远没有表现方式。按用户口径「情绪标签用实际的 10 个」补齐 |
| 4 | §3.2 用 `switch (label)` | 改用**穷尽 Record** `EMOTION_EXPRESSION: Record<EmotionLabel, { base; high? }>` | 与同文件 `STRATEGY_LABEL` / `EMOTION_LABEL` 同一范式：内核新增情绪标签时 TS 直接报错逼着补文案；且 11 个 case 的 switch 会顶到 sonarjs cognitive-complexity 25 的上限 |
| 5 | §5.1「适配层改动（1 个文件）」 | 适配层**确实只改 1 个文件**；另改 **1 个测试文件**（`wp7-turn-render.spec.ts`） | 任务单 §6.3 明确要求补测试用例，测试文件不在"适配层改动"口径里 |
| 6 | 未提 | **连带更新**了 WP50 那条零回归断言：「恰好只多两行」→「恰好只多三行」（多出来的是语气疏离度那一行） | 语气疏离度**也由同盟三维驱动**（缺省不渲染），所以同盟维度带来的 prompt 差异从 2 行变 3 行。这是**口径的自然延伸，不是放宽**：扣掉那三行后仍要求与缺省版**逐字相同** |
| 7 | 未提 | 测试辅助 `verbosityLine()` 从「找第一个以'这轮你'开头的行」改成「块头下一行」 | 情绪表现那行也是「这轮你有点X：…」，按前缀找会认错行（现在还排在话量后面是**碰巧**，不是结构）。改成按位置取，认的是模板的结构不变量 |
| 8 | §3.4「在'说话方式'那行后面补」 | 照做，作为**独立一行**加在「说话方式」之后 | 不改既有「说话方式」那一行的原文（零回归：既有那行逐字不动），只往后加一行 |

**闸门**：eslint 0 error / tsc 0 error / vitest **98 文件 1585 例全绿**（基线 98 文件 1570 例 + 本轮新增 **15 例**，**零回归**：1570 + 15 = 1585 ✓）/ `git diff --stat HEAD -- src/engine-core` = **空**。

