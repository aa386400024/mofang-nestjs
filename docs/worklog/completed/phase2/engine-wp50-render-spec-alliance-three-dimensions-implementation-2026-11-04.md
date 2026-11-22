# WP50 交付记录 — 渲染层接入同盟三维（safety / bond）

> 状态: ✅ 已交付
> 任务单: [`wp50-render-spec-alliance-three-dimensions-2026-11-04.md`](wp50-render-spec-alliance-three-dimensions-2026-11-04.md)
> 日期: 2026-11-04
> 红线: ⚠️ **engine-core 已改（预批准例外）** —— `git diff --stat HEAD -- src/engine-core` 含 **1 个文件**（`domain/rendering/render-types.ts`），**无其他文件**

---

## 1. 实际改了哪些文件

### 1.1 内核（`src/engine-core/**`）：1 改（无新增文件）

| 文件 | 改了什么 |
|---|---|
| `src/engine-core/domain/rendering/render-types.ts` | ① `RenderSpec` 加 `safety?: number` / `bond?: number` 两个**可选**字段（各带口径注释：缺省 = 不提供 = 渲染行为与 WP5 逐字一致）；② 文件头加 WP50 段（为什么进内核契约而不是适配层 / 为什么是可选） |

### 1.2 适配层：2 改

| 文件 | 改了什么 |
|---|---|
| `src/engine-adapters/rendering/spec-assembler.ts` | ① `buildRenderSpec` 的返回值加 `safety: input.output.snapshot.safety` / `bond: input.output.snapshot.bond`（与 `trust` 并排）；② 文件头加 WP50 段（为什么**直接传**而不做条件展开） |
| `src/engine-adapters/rendering/turn-render-orchestrator.ts` | ① `buildVisitorSystemPrompt` 在"内在状态"块里加两行**条件**渲染 —— `spec.safety !== undefined` → `- 安全感：…`；`spec.bond !== undefined` → `- 联结感：…`；② 文件头加 WP50 段（只加数据不调策略 / 文案是工程种子值） |

### 1.3 测试：2 改

| 文件 | 改了什么 |
|---|---|
| `test/engine-core/wp5-rendering.spec.ts` | **扩展**：新增「WP50 · 渲染规格接入同盟三维 (safety / bond)」describe 块 **3 例**（提供时有键 / 不提供时**没键** / 既有字段集合逐字不变）；文件头加 WP50 段（为什么用 `'safety' in spec` 断言） |
| `test/engine-adapters/wp7-turn-render.spec.ts` | **扩展**：新增「⑨ WP50 · 渲染层接入同盟三维 (safety / bond)」describe 块 **5 例**（组装器传值 / prompt 显示两行 / prompt 缺省逐字不变 / **不改变**轮次长短 / 不带这两字段的普通 RenderSpec 仍合法）；新增两个助手 `withoutAllianceDimensions` / `verbosityLine`；import 补 `AdaptiveRenderSpec`；文件头加 WP50 段（双向断言的口径） |

### 1.4 文档

| 文件 | 改了什么 |
|---|---|
| `docs/worklog/pending/wp50-render-spec-alliance-three-dimensions-2026-11-04.md` | 状态行改 `✅ 已交付` + 指向交付记录；追加「§9 交付后补记」偏差表 → 移入 `completed/phase2/` |
| `docs/worklog/pending/phase2-wp-list-2026-11-03.md` | WP50 行 ✅ + 交付记录链接；统计进度 10/35 → 11/35；engine-core 例外表 +WP50 行 |
| `docs/worklog/README.md` | Phase2 已开工列表 +WP50；进度回写 11/35；目录结构说明 +WP50 |

---

## 2. 关键设计决策（与任务单有出入的地方 + 为什么）

### 2.1 ⚠️ 最要紧的一条：「零回归」有**两层**，本单只保证其中一层 —— 而生产上 prompt **一定会变**

任务单 §6.1 写「缺省 = 不提供 = prompt 逐字不变（零回归）」。这句话**对 prompt 组装器成立**，但很容易被误读成「生产 prompt 不变」。实际是两件事：

| 层 | 口径 | 本单交付 |
|---|---|---|
| **契约层**（内核 `RenderSpec`） | 两个字段**可选** —— 别的生产者可以不带 | ✅ 已是可选 |
| **组装层**（适配层 `buildRenderSpec`） | **无条件**把 `snapshot.safety` / `snapshot.bond` 传进去 | ✅ 无条件传 |
| **渲染层**（prompt 组装器） | 字段**没有**就不渲染那一行 | ✅ 条件追加 |

**为什么组装层必须无条件传**：`BdiSnapshot` 的 `trust` / `safety` / `bond` 自 WP42 起就是**必填**字段（`bootstrap.ts` 恒给默认值 0.3 / 0.5 / 0），「缺省」在数据源上**不可能发生**。若这里也写成条件展开，生产上 `safety` / `bond` 会长期缺席 —— **这个 WP 就等于没做**。

**所以两条口径都对，但说的是不同的事**：契约层可选（别人不必补）+ 组装层无条件（生产一定带）+ 渲染层条件（没值不渲染）。

**生产影响**：prompt 每轮**多两行**（两条短行，token 增量很小），换来的是模型能看到三维状态 —— 这正是本单的目的（「让渲染层能根据三维状态调整措辞策略」）。任务单 §6.1 那句「零回归」的准确表述应当是「**字段缺省时**渲染行为逐字不变」。

### 2.2 决策：`spec-assembler` 直接传，**不**做条件展开

与既有的 `sessionSummary` / `trajectoryNote` 对比：那两个字段用 `...(input.sessionSummary ? { sessionSummary: ... } : {})` 条件展开，是因为它们**真的可能没有**（工作窗口还没溢出 / 轨迹还没产出）。

`safety` / `bond` 不是这一类 —— 快照里恒有值。写成条件展开会有两个坏处：

- **把简单事写复杂**（多一层无意义的判断）；
- **误导后来人**：让人以为「生产上这两个字段可能不带」，将来有人照着这个误解去掉组装层的赋值，这条 WP 就静默失效了。

### 2.3 决策：两个可选字段进**内核 `RenderSpec`**，不进适配层 `AdaptiveRenderSpec`（任务单 §4.1，照做并补记核实结论）

同盟三维是**内核决策的产物** —— 内核算出状态，渲染层据此调整措辞。放进 `AdaptiveRenderSpec` 等于让适配层自己去读 snapshot，破坏「组装是纯函数」的分层（`spec-assembler.ts` 文件头的分层论证）。

**核实过的事实**：`buildRenderSpec` 是 `src/` 里**唯一**的 `RenderSpec` 生产者。grep `trust:` 在 `src/` 命中 4 处，另外两处（`voice/voice.types.ts` 的 `VoiceCatchUpBdiSnapshot`、`admin-debug/trace-recorder.service.ts` 的 `TurnTrace.bdiSnapshot`）是**别的契约形状**，与 `RenderSpec` 无关 —— 所以本单的改动面确实是任务单列的 3 个文件，没有遗漏的第二个生产者。

### 2.4 决策：prompt 文案**逐字用任务单给的原文**，一个字不改

```
- 安全感：0.20（越低越不敢说真话、越试探性）
- 联结感：0.40（越低越疏离、越像问诊）
```

并在代码注释与文件头标「⚠️ 文案是**工程种子值，非临床标定** —— 待真实对练校准」。本单**不发明**新文案，也不改既有三行的措辞。

### 2.5 决策：两行放在「内在状态」块里、紧跟信任行；**硬规则文案一个字不改**

- 块头已经写着「只用来约束你的语气与节奏，绝对不要说出口」—— 安全感 / 联结感属于同一类内容，放进去就自动受同一约束。
- 硬规则第 3 条写的是「上面那些状态词（策略／情绪／阻抗／信念等）一个字都不要说出来」—— **「等」字已经兜住**新词，不需要加词。而**改硬规则文案会让「没有摘要、没带同盟三维」的会话 prompt 也变**，直接违反零回归底线（同 WP37 摘要那段的同一理由）。

### 2.6 决策：**不动 `resolveTurnVerbosity`**（任务单 §4.4 / §5.3，照做 + 用例钉死）

轮次长短（verbosity）的判定口径一个字没改 —— 仍只看 `resistance.verbal` / `trust` / `intention.strategy`。

**「只加数据不调策略」必须有可回归的断言**，否则三个月后有人顺手把 `safety` 加进 verbosity 判定，没人看得出来。本单为此加了一条用例：safety 0.05 / bond 0 时，prompt 里「这一轮怎么说」那一段与基线**逐字相同**，而状态行确实传进去了（`- 安全感：0.05` 在）。

### 2.7 决策：内核测试用 `'safety' in spec` 断言，而不是 `expect(spec.safety).toBeUndefined()`

`toBeUndefined()` **分不出**「没传」与「传了 `undefined`」—— 而这两者对渲染层不是一回事：「没传」= 渲染层不该显示这一行；「传了 undefined」= 是个 bug（值丢了）。

`in` 把口径钉在**键是否存在**上，与适配层的 `!== undefined` 判断对齐。内核那 3 例因此断言的是**键**，不是值。

### 2.8 决策：适配层的「逐字不变」用**双向**断言（减去那两行 == 缺省版）

只断言「prompt 里没有『安全感』三个字」太弱 —— 万一实现顺手改了别处的措辞，它照样绿。

所以双向：

1. 缺省版 prompt **不含**这两行；
2. 有这两行的版本**减去它们**后与缺省版**逐字相同**；
3. 行数恰好**差 2**。

第 2 条证明「新 prompt = 旧 prompt + 恰好那两行，别处一个字没动」；第 3 条防止「减掉两行还多出别的东西」这类半吊子实现。

### 2.9 决策：用**解构省略**构造「不带这两字段」的规格，而不是 `delete`

`delete` 在类型上仍是「键存在、值为 undefined」；解构后的 rest **类型上就没有**这两个键，与「键不存在」这件事一致，也与 §2.7 的口径对齐。

### 2.10 boundary 白名单**无需新增条目**

`RenderSpec`（第 372 行）与 `domain/rendering/render-types.ts`（第 452 行）**早已在列**，行号与任务单 §2.5 记的**完全一致** —— 接口内部加可选字段不需要新增白名单条目。`boundary.spec.ts` **12 例零改动**通过。

---

## 3. 闸门数字

| 闸门 | 结果 |
|---|---|
| `npx eslint "src/**/*.ts" "test/**/*.ts" "bin/**/*.ts"` | **0 error**（exit 0） |
| `npx tsc -p tsconfig.build.json --noEmit` | **0 error**（exit 0） |
| `npx vitest run --exclude '**/e2e/**/*.ts'` | **95 个测试文件 / 1488 例全绿**（WP54 基线 95 文件 / 1480 例 + 本轮新增 **8 例**，**零回归**：1480 + 8 = 1488 ✓） |
| `npx vitest run test/engine-core/wp5-rendering.spec.ts` + `test/engine-adapters/wp7-turn-render.spec.ts` | **47 例全绿**（本轮新增 **8 例**：内核 3 + 适配层 5） |
| `npx vitest run test/engine-core/boundary.spec.ts` | **12 例全绿**（边界断言全过：零 @nestjs / 零网络 / 零 env / 零 prompt） |
| `git diff --stat HEAD -- src/engine-core` | **1 个文件**（`domain/rendering/render-types.ts`）—— **正是任务单 §6.2 要求的范围，无其他** |

**回归确认**：

- **内核 `RenderSpec` 不带这两个字段时，既有字段集合逐字不变**（11 个键，排序后逐字比对）；
- **不带这两个字段的普通 `RenderSpec` 仍是合法的 `AdaptiveRenderSpec`** —— 别的生产者不必补（编译期保证）；
- **prompt 缺这两行时逐字不变**，且「有这两行的版本减去它们 == 缺省版」，行数恰好差 2；
- **safety / bond 低不改变轮次长短**（verbosity 判定口径一个字没改）；
- **情绪 / 阻抗 / 移情 / 信任 / 信念 / 禁止行为** 等既有状态行逐字未动；
- WP5 既有 **24 例**与 WP7 既有 **15 例**内核 / 适配层用例**全部保留**（只加组，未改任何既有断言）：本轮 wp5 24 → 27、wp7 15 → 20，合计 39 → 47。
- `boundary.spec.ts` 白名单**无需新增条目**（行号 372 / 452 与任务单 §2.5 逐行一致）。

---

## 4. 本期**没做**的（明确留给后续，别当漏做）

1. **根据 safety / bond 调整轮次长短（verbosity）**（任务单 §4.4 / §7 第 1 条）—— 本期只加数据，不调策略。用例已把这条钉成可回归断言。
2. **根据 safety / bond 调整措辞风格**（任务单 §7 第 2 条）—— 同上，先接数据，再调策略。
3. **角色种子 safety / bond 基线**（任务单 §7 第 3 条）—— 那是 WP51 的事。
4. **渲染层接入风险信号的措辞调整**（任务单 §7 第 4 条）—— WP9-C 已做，本单不碰。

---

_创建：2026-11-04_
_深度通知：任务单 §2.1（BdiSnapshot 同盟三维）/ §2.2（RenderSpec 现状）/ §2.3（spec-assembler 组装点）/ §2.4（prompt 组装点）/ §2.5（boundary 白名单行号）/ §2.6（扩展模式先例）/ §3.1–§3.3（本期做什么）/ §4.1–§4.4（边界问题补充）/ §5.1–§5.3（边界约束）/ §6.1–§6.3（验收与用例要求）逐条核实 + 真实代码 grep（`src/` 内 RenderSpec 生产者唯一性 / `trust:` 命中项甄别 / `bootstrap.ts` 三维默认值 / `formatNumber` 实现 / `resolveTurnVerbosity` 判定口径）_
