# WP41 交付记录 — 表达风格渲染接入（话量基线 / 叙事风格 / 语态倾向）

> 状态: ✅ 已交付
> 任务单: [`wp41-expression-style-rendering-2026-11-04.md`](wp41-expression-style-rendering-2026-11-04.md)
> 日期: 2026-11-04
> 红线: ✅ **engine-core 只改 2 个文件**（任务单 §5.1 预批准清单，**一字不多**）—— `git diff --stat HEAD -- src/engine-core` = 2 files
> 边界断言: ✅ `boundary.spec.ts` 11 条全绿（barrel 公开出口面**一字未动** —— 见 §2.2）

---

## 1. 实际改了哪些文件

### 1.1 内核：2 改（任务单 §5.1 预批准清单内，一字不多）

| 文件 | 改了什么 |
|---|---|
| `src/engine-core/domain/character-profile.ts` | ① 新增两个**命名**类型 `CharacterNarrativeStyle` / `CharacterExpressionTone`（联合类型，与 `AttachmentStyle` 同范式）；② `CharacterProfile` **顶层**加 `speechVolumeBaseline?` / `narrativeStyle?` / `expressionTone?` 三个可选字段；③ 文件头加 WP41 段 |
| `src/engine-core/domain/rendering/render-types.ts` | ① 从 `../character-profile.js` import 那两个类型（内核内部引用，**不走 barrel**）；② `RenderSpec` 加同名的三个可选字段；③ 文件头加 WP41 段 |

**没动**：内核 barrel（`index.ts`）—— 公开出口面一字未改，边界断言 ⑥ 的双向白名单原样通过。

### 1.2 适配层：7 改（任务单 §5.2 列了 5 个 → **多改 2 个**，见 §2.1）

| 文件 | 改了什么 |
|---|---|
| `src/engine-adapters/wiring/character/character-profile.entity.ts` | ① 两个类型改为**从内核契约派生**（`NonNullable<CharacterProfile['narrativeStyle']>`）—— 内核是规范、本文件是镜像；② 三列的注释从"纯预留"改成真实状态（注释过期 = 给下一个人的假话）；③ 文件头加 WP41 段。**列定义 / DEFAULT 一字未改**（不加 migration） |
| `src/engine-adapters/wiring/character/builtin-character-registry.ts` | ① `BuiltinCharacterSeed` 加三个可选字段；② `buildCharacterProfile()` **条件展开**传给内核；③ 文件头加 WP41 段 |
| `src/engine-adapters/wiring/character/db-character-profile.resolver.ts` | ① `toCharacterSeed()` 读三列，**直接传**（不做条件展开 —— 列是 NOT NULL DEFAULT）；② 文件头加 WP41 段 |
| `src/engine-adapters/rendering/spec-assembler.ts` | ① `SpecAssemblyInput` 加三个可选字段（类型从内核契约派生）；② `buildRenderSpec()` 条件展开进 `RenderSpec`；③ 文件头加 WP41 段 |
| `src/engine-adapters/rendering/turn-render-orchestrator.ts` | ① `TurnSessionContext` 加三个可选字段；② `assemble()` 从会话归属读出来传进规格；③ `resolveTurnVerbosity()` 加**话量基线修正**（判据未改）；④ `buildVisitorSystemPrompt()` 渲染「你说话一贯的样子」那一块（条件渲染）；⑤ 新增两张穷尽 Record 文案表；⑥ 文件头加 WP41 段 |
| `src/engine-adapters/wiring/engine-turn.service.ts` | `open()` 的 options 加三个可选字段 → **条件登记**进 `TurnSessionContext`（归属登记只在这一处发生） |
| `src/engine-adapters/wiring/engine-stream-backend.adapter.ts` | `openKernelSession()` 从**已解析的角色基线**取三字段，传进 `engine.open()` 的 options（没角色 = 中性基线 = 不带） |

### 1.3 测试：1 新增 + 2 修改

| 文件 | 改了什么 |
|---|---|
| `test/engine-adapters/wp41-expression-style-rendering.spec.ts` | **新增**（17 例）：① 内核契约（可选 / 条件展开）② 数据通路（DB 行 → 种子 → 角色基线 → 规格 → prompt 端到端）③ 话量基线修正（6 例）④ 叙事风格三档 + 语态倾向四档各一行 ⑤ 零回归（双向断言） |
| `test/engine-adapters/wp10a-character-expression-fields.spec.ts` | **倒转**用例 ⑬（WP10A 的"不消费"红线解除 → 断言方向反转），describe 标题与块首注释同步改成真实状态；用例 ⑭（前端 DTO 不暴露）**保持原样** |
| `test/engine-adapters/wp9b-db-character-resolver.spec.ts` | "等价种子"补上三个表达风格字段（它必须**镜像 DB 行**的全部字段 —— 见 §2.9） |

### 1.4 文档

| 文件 | 改了什么 |
|---|---|
| `docs/worklog/pending/wp41-expression-style-rendering-2026-11-04.md` | 状态行改 `✅ 已交付` + 指向交付记录；追加「§9 交付后补记」偏差表 → 移入 `completed/phase2/` |
| `docs/worklog/pending/phase2-wp-list-2026-11-03.md` | WP41 行 ✅ + 交付记录链接；统计进度 17/36 → 18/36 |
| `docs/worklog/README.md` | Phase2 已开工列表 +WP41；进度回写 18/36；目录结构说明 +WP41 |

---

## 2. 关键设计决策（与任务单有出入的地方 + 为什么）

### 2.1 决策：适配层改了 **7 个**文件，任务单列了 5 个 —— **偏差**

| 多改的文件 | 为什么必须改 |
|---|---|
| `character-profile.entity.ts` | **类型的归属问题**：这两个联合类型原本定义在**适配层**的实体文件里，而内核契约（`CharacterProfile` / `RenderSpec`）现在也要用它们。不改就有**两份联合类型声明** —— 内核加一档而适配层没加时，DB 行装得进去、内核却接不住，而且**没有任何报错**（这是仓库"反双胞胎"纪律最忌讳的那种分叉）。改成**从内核契约派生**（`NonNullable<CharacterProfile['narrativeStyle']>`）后两者永远同步，**而且不需要动内核 barrel**（见 §2.2）。 |
| `engine-turn.service.ts` | 归属登记**只在这一处发生**（`open()` → `registry.register(...)`）。任务单 §5.2 第 5 条说的"openSession 时把表达风格登记进 `TurnSessionContext`"，落点就是这里 —— 它是唯一同时拿到 handleId 与业务归属的地方。门面（`engine-stream-backend.adapter.ts`）只负责把角色基线的三字段**传进** `open()` 的 options。 |

### 2.2 决策：两个类型**不进内核 barrel**，适配层用**派生** —— 偏差（与 WP59 同一套做法）

按仓库惯例（`DeltaCapConfig` / `AllianceConfig` / `PersonalityTraits` 都是从 barrel 导出的），这两个类型**应该**进 `src/engine-core/index.ts`。但本单不能这么做：

- 边界断言 ⑥：barrel 的公开出口面是**双向精确白名单** —— 加一个导出就要同步改断言 ⑥ 的 `expectedPublic`，那是**第三个内核文件**（`index.ts`）+ 第四个文件（断言本身）；
- 任务单 §6.2 的闸门原文：「`git diff --stat HEAD -- src/engine-core` → **2 个文件**」。

动第三个内核文件超出预批准范围（AGENTS.md §5.1）。所以选**派生**：内核 `character-profile.ts` 是规范定义，适配层实体文件用 `NonNullable<CharacterProfile['narrativeStyle']>` 镜像它 —— TypeScript 结构性兼容保证两边是同一份联合类型，**调用点仍被编译期校验**（内核加一档而适配层没跟上时，穷尽 Record 立刻编译报错）。

> 代价（留档）：内核那两个类型**外部 import 不到**。将来若要对外公开，走"加 barrel 导出 + 同步断言 ⑥ 白名单"的独立 WP（与 WP36 / WP42 加端口类型的做法一致）。

### 2.3 决策：三个字段住 `CharacterProfile` **顶层**，不进 `baseline` —— 偏差（任务单未指定）

`baseline` 装的是"**开场时的数值状态**"（trust / 阻抗 / 情绪 / 移情 / safety / bond）；表达风格是"**这个人一贯的样子**" —— 与 `attachmentStyle` / `personalityTraits` 同性质，所以住顶层。`RenderSpec` 侧同理（顶层三个字段）。

### 2.4 决策：话量基线修正**只动"话量阻抗"这一个量**，信任与策略不参与 —— 偏差（任务单表述含糊）

任务单 §3.2 ① 只说"影响 `resolveTurnVerbosity()` 的判定"，没说影响哪一部分。本单的落地口径：

```
修正量 = (基线 - 0.5) × 0.5
有效阻抗 = spec.resistance.verbal - 修正量
```

- **判据一个字没改**：0.55 / 0.3 / `trust <= 0.3` / `trust >= 0.55` / 四个探索策略 —— 原样保留（`resolveTurnVerbosity` 里只把 `spec.resistance.verbal` 换成本地的"有效阻抗"）；
- **信任与策略不参与**：它们说的是"**这一刻愿不愿意说**"，话量基线说的是"**平时声音多大**" —— 两者无关（一个天生话多的人，不想说时也不出声）。让基线去抵消"不想说"，那是错的。

### 2.5 决策：修正权重取 **0.5**，理由是"权重 1 会**删掉**一档"

修正量加在阻抗上，等于**整条档位阶梯平移**（"短"的门槛 0.55 + 修正量，"长"的门槛 0.3 + 修正量）。

- 权重 0.5 → 极端基线（0 / 1）把阶梯平移 0.25 = **恰好一个档位间距**，三档仍然都够得着（"短"门槛最高 0.80 / "长"门槛最低 0.05）；
- 权重 1 → 天生极话多的角色"短"的门槛涨到 **1.05**（**永远够不着** = 直接删掉一档），天生极话少的角色"长"的门槛掉到 **-0.2**（同样够不着）—— 那就不是"修正"而是"改判据"了。

基线 **0.5 = 中位 = 修正量 0** → 没有基线与基线取 0.5 行为**逐字一致**（用例钉死）。

⚠️ 权重与中位点是**工程种子值，非临床标定** —— 待真实对练校准（任务单 §7 第 3、4 条）。

### 2.6 决策：话量基线**不单独渲染一行** —— 偏差（任务单 §6.1 说"消费这三个字段"）

基线的效果**完全**由话量档位承载（话量那一行本来就是"这轮该说几句"）。再渲染一行"你天生话多话少"是**重复指令**（还会和话量那一行打架）。所以基线是**被消费**的，消费方式是**改档位**而不是**加一行**；叙事风格与语态倾向才是各渲染一行。

### 2.7 决策：叙事 / 语态**单独成块**（「你说话一贯的样子」），不塞进"内在状态"块 —— 偏差（任务单未指定）

- 内在状态块讲的是"**此刻**的状态"（这一轮的阻抗 / 情绪 / 同盟）；
- 表达风格讲的是"**一贯**的样子" —— 这个人的说话方式本来就这样，不因为这一轮怎么了。

两块混在一起，模型分不清"我现在不想说"与"我一向话少" —— 前者该随阻抗变，后者恒定。所以单独一块，块头自带"绝对不要说出口"的约束。

### 2.8 决策：**两个内置种子本期不表态**（不给这三字段）—— 偏差（任务单 §5.3「不改 seed 数据」的延伸）

内置种子是**纯内存部署 / 测试**路径。本期是"数据通路打通"，不改既有角色的行为 —— 内置角色不表态 = 内置路径 prompt 与 WP35 **逐字一致**（零回归）。DB 角色走 DB 列（NOT NULL DEFAULT → 恒有值），**那条路径本期真正生效**（生产默认走 db 数据源，见 WP51 的留档）。

> 留档：若将来纯内存部署也要表达风格，给两个内置种子补值即可（映射通路已通，无需改代码）。

### 2.9 决策：**倒转** WP10A 的红线用例 ⑬，并补齐 wp9b 的"等价种子" —— 偏差（既有测试改动，逐条说明）

| 改的用例 | 原来守什么 | 现在为什么必须改 |
|---|---|---|
| wp10a ⑬「resolver 映射的输出里不含这三列（字段没进内核）」 | WP10A 的"纯预留"红线：这三列当时**零消费** | WP41 的**全部意义**就是消费它们 → 红线解除，断言**方向反转**为"resolver 的输出里**有**这三列"。改的是断言方向，不是删断言（DB 列是 NOT NULL DEFAULT → 恒有值 → 直接传） |
| wp9b「DB 路径与内置种子路径产出逐字一致」 | "映射公式只有一份"：同一角色换数据源味道不变 | 行里多了三列，"等价的内置种子"就必须**镜像**这三字段 —— 否则两条数据源产出不一致，**这条用例守护的东西反而没了**。补齐后护栏的**意图不变、强度不变**（仍然是逐字相等） |

另：wp10a ⑭（前端 DTO 不暴露这三列）**保持原样** —— 本期不暴露给前端，仍成立。

### 2.10 决策：调试端点 `/engine/debug/open` **不携带**表达风格 —— 留档（本期不改）

`engine-wiring.controller.ts` 的 `sanitizeCharacterProfile()` 是**最小白名单**（只透传 coreBeliefs / forbiddenBehaviors / sensitiveTopics / attachmentStyle）—— `personalityTraits`（WP49）与 `baseline.safety/bond`（WP51）**同样不走这条路径**，本单保持同一口径，不额外扩白名单。

### 2.11 ⚠️ 决策留档：**生产 DB 角色每轮会多两行**，用的是未标定的默认档

三列是 NOT NULL DEFAULT → 生产 DB 角色**每一轮**都带着它们：

- **话量基线默认 0.5 = 中位 = 修正量 0** → 话量判定**不受影响** ✓（这一条是设计使然：默认档必须无副作用）；
- **叙事 / 语态两行每轮都渲染**，用的是默认档 `'mixed'` / `'restrained'` —— 也就是**当前所有 DB 角色都是"克制内敛 + 叙事兼有"**，直到有人去标定这三列。

这是"数据通路打通"的既定代价（任务单 §7 第 3 条：表达风格的临床校准是后续工作）。**标定前的生产影响：每轮 prompt 多 2 行（约 40 字）**，语气被压向"克制"。

> 建议（不属于本期范围）：标定时给 DB 四行种子逐个表态（`character_profiles` 三列 + `character-profile.seed.ts`），并把 `'restrained'` 默认档是否该改成"未表态"作为产品决策拍板（当前 DEFAULT 语义 = "这一列没人有意见"，与 WP10A 种子"不表态就不写"的纪律一致）。

---

## 3. 闸门数字

| 闸门 | 结果 |
|---|---|
| `npx eslint "src/**/*.ts" "test/**/*.ts" "bin/**/*.ts"` | **0 error**（exit 0） |
| `npx tsc -p tsconfig.build.json --noEmit` | **0 error**（exit 0） |
| `npx vitest run --exclude '**/e2e/**/*.ts'` | **99 个测试文件 / 1602 例全绿**（WP35 基线 98 文件 / 1585 例 + 本轮新增 **1 文件 / 17 例**，**零回归**：1585 + 17 = 1602 ✓） |
| `npx vitest run test/engine-adapters/wp41-expression-style-rendering.spec.ts` | **17 例全绿**（本轮新增） |
| `npx vitest run test/engine-adapters/wp9b-db-character-resolver.spec.ts` | **25 例全绿**（既有断言一条没删，只补了等价种子的三个字段） |
| `npx vitest run test/engine-adapters/wp10a-character-expression-fields.spec.ts` | **14 例全绿**（⑬ 断言方向反转，⑭ 原样） |
| `npx vitest run test/engine-core/boundary.spec.ts` | **12 例全绿**（11 条不变量 + 1 条扫描自检；barrel 白名单**一字未动**） |
| `git diff --stat HEAD -- src/engine-core` | **恰好 2 个文件**（`character-profile.ts` + `render-types.ts`），纯类型扩展 ✓ |

**回归确认**：

- **内核边界零破坏** —— 只加字段与类型，零 `process.env` / 零 `globalThis` / 零 NestJS / 零 typeorm；barrel 公开出口面**一字未动**（断言 ⑥ 双向白名单原样通过）；适配层**零**深路径 import 内核内部模块（断言 ⑪）；
- **话量判定口径零回归** —— 0.55 / 0.3 / 信任 / 策略四条判据**一个字没改**；没有基线（或基线取中位 0.5）时判定与 WP35 **逐字一致**（用例钉死）；
- **prompt 零回归** —— 没登记表达风格 → 「你说话一贯的样子」整块不出现 → prompt 与 WP35 **逐字相同**（双向断言：扣掉那一块等于缺省版）；
- **既有零回归断言未被削弱** —— WP35 的 WP50 用例（同盟三维 2→3 行）、WP56 用例（召回为空逐字不变）、WP9-C 用例（轮次权重 / 风险护栏）全部原样通过；
- **既有护栏只改了方向、没改强度** —— wp9b 的"两条数据源逐字一致"仍然逐字相等（§2.9）。

---

## 4. 本期**没做**的（明确留给后续，别当漏做）

1. **表达风格 × 情绪组合矩阵**（任务单 §7 第 1 条）—— 本期各自独立影响。
2. **表达风格 × 同盟三维组合**（任务单 §7 第 2 条）—— 同上。
3. **表达风格的临床校准**（任务单 §7 第 3 条）—— 本期是工程种子值，内测后校准；**当前生产 DB 角色跑的是未标定的默认档**（见 §2.11）。
4. **话量基线的精细刻度**（任务单 §7 第 4 条）—— 本期只是粗略修正（阶梯平移），不做精确数值映射。
5. **纯内存路径的表达风格**（§2.8）—— 内置种子本期不表态；要接只需补两个种子的值。
6. **调试端点 `/engine/debug/open` 携带表达风格**（§2.10）—— 与 personalityTraits / baseline 同口径，本期不动。
7. **前端 DTO 暴露表达风格** —— 本期不暴露（wp10a ⑭ 仍绿）；速查卡要不要显示"这个人天生话多话少"是产品/前端的决定。

---

_创建：2026-11-04_
_深度通知：`CharacterProfile` / `RenderSpec` / `CharacterNarrativeStyle` / `CharacterExpressionTone` / `BdiSnapshot.safety` / `BdiSnapshot.bond` / `DEFAULT_SAFETY` / `DEFAULT_BOND` / `toCharacterSeed` / `buildCharacterProfile` / `BuiltinCharacterSeed` / `SpecAssemblyInput` / `buildRenderSpec` / `TurnSessionContext` / `resolveTurnVerbosity` / `buildVisitorSystemPrompt` / `EngineTurnService.open` / `EngineSessionRegistry.register` / `openKernelSession` —— 逐条 grep 核实_
