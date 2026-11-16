# WP41 任务单 — 表达风格渲染接入（话量基线 / 叙事风格 / 语态倾向）

> **状态**：✅ 已交付（2026-11-04）→ 交付记录：[`engine-wp41-expression-style-rendering-implementation-2026-11-04.md`](engine-wp41-expression-style-rendering-implementation-2026-11-04.md)
> **路径**：`docs/worklog/completed/phase2/wp41-expression-style-rendering-2026-11-04.md`
> **优先级**：🟡 P1
> **引擎内核**：✅ 预批准改 engine-core（`character-profile.ts` + `render-types.ts`）—— **实改 2 个内核文件，与预批准一致**
> **前置依赖**：WP35（渲染四手法）
> **北极星**：[`../../architecture/engine-endstate-blueprint-v1.0.md`](../../architecture/engine-endstate-blueprint-v1.0.md) §④ 渲染层

---

## 1. 任务概述

### 1.1 一句话目标

WP10A 在 DB `character_profiles` 表里加了 3 列**纯预留**字段（话量基线 / 叙事风格 / 语态倾向），但从 DB 到渲染 prompt 这条路是**断的** —— 内核 `CharacterProfile` 里没有，spec-assembler 没接，渲染层没消费。

本期把这 3 个字段从 DB 一路接到渲染 prompt，让角色的"天生说话风格"真正影响模型输出。

### 1.2 为什么现在做

- WP35 刚做完渲染四手法（话量三档 + 语气疏离度 + 情绪表现 + 轻量随机）
- 现在的话量判定是"这一轮阻抗多高"，但没有"这个人天生话多话少"
- 两个角色阻抗一样，但一个天生话多、一个天生话少，模型应该说不一样多的话
- 这是渲染层从"策略驱动"到"人格驱动"的最后一块拼图

---

## 2. 现状盘查结论（已 grep 全渲染层核实）

### 2.1 DB 层：WP10A 已经加了 3 列

```ts
// character-profile.entity.ts:242, 250, 258
speechVolumeBaseline!: number;       // 话量基线 [0,1]
narrativeStyle!: CharacterNarrativeStyle;  // 'structured' | 'disorganized' | 'mixed'
expressionTone!: CharacterExpressionTone;    // 'restrained' | 'emotional' | 'intellectualizing' | 'passive_aggressive'
```

**种子数据也有了**（`character-profile.seed.ts`）。

### 2.2 内核层：完全没有

grep `src/engine-core/` 搜 `speechVolumeBaseline` / `narrativeStyle` / `expressionTone` —— **0 命中**。

- `CharacterProfile` 里没有这 3 个字段
- `RenderSpec` 里也没有

### 2.3 适配层：断在 spec-assembler

- `SpecAssemblyInput` 里有 `attachmentStyle?`（第 61 行），但没有表达风格
- `buildRenderSpec()` 只传 `attachmentStyle`（第 112 行），不传表达风格
- `buildVisitorSystemPrompt()` 里也没有消费表达风格

### 2.4 渲染层：话量判定只有"阻抗驱动"

```ts
// turn-render-orchestrator.ts:914-921
function resolveTurnVerbosity(spec: AdaptiveRenderSpec): TurnVerbosity {
  const verbal = spec.resistance.verbal;
  const strategy = spec.intention.strategy;
  if (verbal >= 0.55 || spec.trust <= 0.3 || strategy === 'resistance') return 'short';
  if (verbal <= 0.3 && spec.trust >= 0.55 && ...) return 'long';
  return 'medium';
}
```

**问题**：只看"这一轮阻抗多高"，不看"这个人天生话多话少"。

---

## 3. 本期做什么

### 3.1 数据通路：DB → 内核 → 渲染 prompt

```
DB entity (3 列)
  → adapter 解析 (buildCharacterProfile)
  → 内核 CharacterProfile (加 3 个可选字段)
  → openSession 注入
  → 门面读角色基线 → SpecAssemblyInput (加 3 个可选字段)
  → spec-assembler 传进 RenderSpec (加 3 个可选字段)
  → buildVisitorSystemPrompt 消费
```

### 3.2 三个字段怎么影响渲染

**① 话量基线 `speechVolumeBaseline` [0,1]**

影响 `resolveTurnVerbosity()` 的判定：
- 基线 0.8（天生话多）→ 阻抗 0.5 时，话量还是偏多（不会直接判 short）
- 基线 0.3（天生话少）→ 阻抗 0.2 时，话量还是偏少（不会直接判 long）

**口径**：话量基线是"天生性格"，阻抗是"这一轮状态"，两者叠加。

**② 叙事风格 `narrativeStyle`**

影响 prompt 的叙事方式：
- `structured`：说话有条理，有开头有结尾
- `disorganized`：说话东一句西一句，跳来跳去
- `mixed`：混合

**③ 语态倾向 `expressionTone`**

影响 prompt 的语气：
- `restrained`：克制，情绪不外露
- `emotional`：情绪外露，容易激动
- `intellectualizing`：理智化，用思考代替感受
- `passive_aggressive`：被动攻击，阴阳怪气

---

## 4. 边界问题补充

### 4.1 ⚠️ 为什么要改内核 `CharacterProfile`？

**因为表达风格是角色固有属性。**

- `attachmentStyle` 在内核 `CharacterProfile` 里（第 67 行）
- `personalityTraits` 也在内核里（第 69 行）
- 表达风格是同一类东西（"这个人天生什么样"），所以也应该在内核里

### 4.2 ⚠️ 为什么要改内核 `RenderSpec`？

**因为渲染层消费的是 `RenderSpec`。**

- 渲染层是纯函数，根据 `RenderSpec` 生成 prompt
- 表达风格要影响渲染，就得进 `RenderSpec`
- 与 WP50 的同盟三维进 `RenderSpec` 同一范式

### 4.3 ⚠️ 本期不做什么？

1. **不改 `resolveTurnVerbosity()` 的判定逻辑** —— 只是加一个"基线修正"，话量三档的判定口径保留
2. **不改 DB schema** —— WP10A 已经加了 3 列，本期不动
3. **不做"表达风格 × 情绪"的组合矩阵** —— 本期各自独立影响，不做交叉
4. **不做"表达风格 × 同盟三维"的组合** —— 同上

---

## 5. 边界约束

### 5.1 内核改动（2 个文件，预批准）

1. `src/engine-core/domain/character-profile.ts` —— `CharacterProfile` 加 3 个可选字段
2. `src/engine-core/domain/rendering/render-types.ts` —— `RenderSpec` 加 3 个可选字段

### 5.2 适配层改动（5 个文件）

1. `src/engine-adapters/wiring/character/db-character-profile.resolver.ts` —— `toCharacterSeed()` 从 DB entity 读表达风格 3 列，条件展开给 `BuiltinCharacterSeed`
2. `src/engine-adapters/wiring/character/builtin-character-registry.ts` —— `BuiltinCharacterSeed` 加 3 个可选字段 + `buildCharacterProfile()` 从 seed 读表达风格，条件展开给内核 `CharacterProfile`
3. `src/engine-adapters/rendering/spec-assembler.ts` —— `SpecAssemblyInput` 加 3 个可选字段 + `buildRenderSpec()` 传进 `RenderSpec`
4. `src/engine-adapters/rendering/turn-render-orchestrator.ts` —— `TurnSessionContext` 加 3 个可选字段 + `assemble()` 从 context 读出来传进 input + `buildVisitorSystemPrompt()` 消费表达风格
5. 门面（`engine-stream-backend.adapter.ts` 或装配层）—— openSession 时把角色基线里的表达风格登记进 `TurnSessionContext`

### 5.3 不碰的地方

- ❌ 不改 DB schema（WP10A 已加列）
- ❌ 不改 seed 数据（WP10A 已加）
- ❌ 不改 `resolveTurnVerbosity()` 的核心判定逻辑
- ❌ 不做"表达风格 × 情绪"的组合矩阵
- ❌ 不做"表达风格 × 同盟三维"的组合

---

## 6. 验收标准

### 6.1 功能验收

- [ ] 内核 `CharacterProfile` 有 `speechVolumeBaseline?` / `narrativeStyle?` / `expressionTone?` 三个可选字段
- [ ] 内核 `RenderSpec` 有同样三个可选字段
- [ ] spec-assembler 把这三个字段从 input 传进 spec
- [ ] 渲染层 `buildVisitorSystemPrompt` 消费这三个字段，影响 prompt
- [ ] 零回归：没有表达风格时，prompt 逐字不变

### 6.2 闸门验收

- [ ] `npx eslint "src/**/*.ts" "test/**/*.ts"` → 0 error
- [ ] `npx tsc -p tsconfig.build.json --noEmit` → 0 error
- [ ] `npx vitest run` → 全绿（零回归）
- [ ] `git diff --stat HEAD -- src/engine-core` → 2 个文件（预批准范围内）

### 6.3 测试用例要求

至少补充：
1. 话量基线修正：基线 0.8 + 阻抗 0.5 → 不会判 short
2. 叙事风格：structured / disorganized / mixed 各渲染一行
3. 语态倾向：4 种类型各渲染一行
4. 零回归：没有表达风格时 prompt 逐字不变

---

## 7. 本期没做的（明确留给后续）

1. **表达风格 × 情绪组合矩阵** —— 本期各自独立影响
2. **表达风格 × 同盟三维组合** —— 同上
3. **表达风格的临床校准** —— 本期是工程种子值，内测后校准
4. **话量基线的精细刻度** —— 本期只是粗略修正，不做精确的数值映射

---

## 8. 转述给后端的话术

> WP41：表达风格渲染接入（话量基线 / 叙事风格 / 语态倾向）。
>
> 开工前先读 `docs/README.md` 和 `docs/worklog/README.md` 入口，确认红线和交付格式。
>
> 任务单在 `docs/worklog/pending/wp41-expression-style-rendering-2026-11-04.md`。
>
> **改 engine-core 2 个文件**（预批准）：
> - `character-profile.ts` —— `CharacterProfile` 加 3 个可选字段
> - `render-types.ts` —— `RenderSpec` 加 3 个可选字段
>
> **适配层 5 个文件**：
> - `db-character-profile.resolver.ts` —— 从 DB entity 读表达风格 → seed
> - `builtin-character-registry.ts` —— `BuiltinCharacterSeed` 加 3 字段 + `buildCharacterProfile` 接上
> - `spec-assembler.ts` —— `SpecAssemblyInput` 加 3 字段 + 传进 `RenderSpec`
> - `turn-render-orchestrator.ts` —— `TurnSessionContext` 加 3 字段 + `assemble()` 接线 + 渲染消费
> - 门面装配层 —— openSession 时把表达风格登记进 `TurnSessionContext`
>
> 关键口径：
> - 不改 `resolveTurnVerbosity()` 的核心判定逻辑，只是加基线修正
> - 条件渲染：没有表达风格时不渲染那一行（零回归）
> - 文案是工程种子值，非临床标定
> - 本期只做"数据通路打通"，不做精细的组合矩阵
>
> 任务单里所有函数名 / 类型名 / 文件路径都是 grep 核实过的，不是凭印象写的。
>
> 交付按 `team/conventions.md` §二的格式写交付记录：改了哪些文件、关键设计决策（跟任务单有出入要说明）、闸门数字。

---

_创建：2026-11-04_
_深度通知：`speechVolumeBaseline` / `narrativeStyle` / `expressionTone` / `CharacterNarrativeStyle` / `CharacterExpressionTone` / `CharacterProfile` / `RenderSpec` / `SpecAssemblyInput` / `buildRenderSpec` / `buildVisitorSystemPrompt` / `resolveTurnVerbosity` —— 全部 grep 核实_

---

## 9. 交付后补记（2026-11-04）

交付记录：[`engine-wp41-expression-style-rendering-implementation-2026-11-04.md`](engine-wp41-expression-style-rendering-implementation-2026-11-04.md)

下面这张表登记**与任务单原文的偏差**，每条都有理由。

| # | 任务单原文 | 实际落地 | 为什么 |
|---|---|---|---|
| 1 | §5.2「适配层改动（5 个文件）」 | 适配层改了 **7 个**文件（多 `character-profile.entity.ts` + `engine-turn.service.ts`） | ① 实体文件里的两个联合类型必须**改成从内核契约派生** —— 否则内核与适配层各有一份声明，内核加一档而适配层没加时 DB 行装得进去、内核接不住，且**没有任何报错**；② 归属登记**只发生在 `EngineTurnService.open()`**（`registry.register`），门面只负责把三字段传进 options —— 任务单 §5.2 第 5 条说的"登记进 `TurnSessionContext`"落点就在这一层 |
| 2 | 未提内核类型归属 | 两个类型**不进内核 barrel**，适配层用 `NonNullable<CharacterProfile['narrativeStyle']>` **派生** | 边界断言 ⑥ 的 barrel 出口面是**双向精确白名单**，加导出要动**第三个内核文件** + 断言本身；任务单 §6.2 的闸门原文是「engine-core → **2 个文件**」。与 WP59（`RecallPolicyOptions`）同一套做法 |
| 3 | 未指定字段放哪 | 三个字段住 `CharacterProfile` **顶层**，不进 `baseline` | `baseline` 是"开场时的数值状态"（trust / 阻抗 / 情绪 / 移情 / safety / bond）；表达风格是"**这个人一贯的样子**"，与 `attachmentStyle` / `personalityTraits` 同性质 |
| 4 | §3.2 ①「影响 `resolveTurnVerbosity()` 的判定」 | 只让**话量阻抗**这一个量参与修正（修正量 = (基线 - 0.5) × 0.5，阶梯平移）；**信任与策略不参与** | 信任低 / 策略是回避说的是"**这一刻愿不愿意说**"，话量基线说的是"**平时声音多大**" —— 无关。让基线去抵消"不想说"是错的。判据（0.55 / 0.3 / 信任 / 策略）**一个字没改** |
| 5 | 未提权重 | 权重取 **0.5** | 权重 1 时：天生极话多 → "短"的门槛涨到 1.05（**永远够不着** = 删掉一档）；天生极话少 → "长"的门槛掉到 -0.2（同样够不着）。0.5 让极端基线把阶梯平移**恰好一个档位间距**，三档都还够得着 |
| 6 | §6.1「消费这三个字段」 | 话量基线**不单独渲染一行**（只改档位）；叙事 / 语态各渲染一行 | 基线的效果完全由话量档位承载，再加一行"你天生话多"是**重复指令**，还会和话量那一行打架 |
| 7 | 未指定渲染位置 | 叙事 / 语态**单独成块**（「你说话一贯的样子」），不塞进"内在状态"块 | 内在状态块讲"**此刻**"，表达风格讲"**一贯**"。混在一起模型分不清"我现在不想说"与"我一向话少" —— 前者随阻抗变，后者恒定 |
| 8 | §5.3「不改 seed 数据」 | 两个**内置种子**也不表态（不给这三字段） | 内置种子是纯内存部署 / 测试路径；本期是"数据通路打通"，不改既有角色行为 = 内置路径 prompt 与 WP35 逐字一致（零回归）。DB 角色走 DB 列（恒有值），那条路径本期真正生效 |
| 9 | 未提既有测试 | **倒转** wp10a 用例 ⑬（WP10A 的"不消费"红线解除 → 断言方向反转）+ **补齐** wp9b 的"等价种子"三字段 | ① WP41 的全部意义就是消费这三列，红线解除，断言方向反转（不是删断言）；② "等价种子"必须**镜像 DB 行**的全部字段，否则两条数据源产出不一致 —— 那条用例守护的"换数据源味道不变"反而没了，补齐后**意图与强度都不变** |
| 10 | 未提 | ⚠️ **生产 DB 角色每轮多 2 行**，用的是未标定的默认档 | 三列是 NOT NULL DEFAULT → 生产每轮都带着。话量基线默认 0.5 = 中位 = **修正量 0**（话量判定不受影响 ✓，这是设计使然）；但叙事 / 语态两行每轮都渲染，当前所有 DB 角色都是"克制内敛 + 叙事兼有"，直到有人标定。这是"数据通路打通"的既定代价（§7 第 3 条），标定建议见交付记录 §2.11 |

**闸门**：eslint 0 error / tsc 0 error / vitest **99 文件 1602 例全绿**（基线 98 文件 1585 例 + 新增 **1 文件 / 17 例**，**零回归**：1585 + 17 = 1602 ✓）/ `boundary.spec.ts` 12 例全绿 / `git diff --stat HEAD -- src/engine-core` = **恰好 2 个文件**（预批准范围内）。

