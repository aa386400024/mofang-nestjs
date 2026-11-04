# WP49 交付记录 — 角色大五人格字段落地

> 状态: ✅ 已交付
> 任务单: [`wp49-character-five-factor-personality-2026-11-04.md`](wp49-character-five-factor-personality-2026-11-04.md)
> 日期: 2026-11-04
> 红线: ✅ **engine-core 零改动** —— `git diff --stat HEAD -- src/engine-core` **为空**

---

## 1. 实际改了哪些文件

### 1.1 内核（`src/engine-core/**`）：**0 改**

本期内核一行没动 —— 内核的 `PersonalityTraits` 类型（`domain/character-profile.ts:43`）与 `CharacterProfile.personalityTraits?`（第 69 行）**早已存在**，`src/engine-core/index.ts:37` 也早已导出该类型。本期只做一件事：**把数据喂进去**。

### 1.2 适配层：3 改 + 1 新增（migration）

| 文件 | 改了什么 |
|---|---|
| `src/engine-adapters/wiring/character/builtin-character-registry.ts` | ① `BuiltinCharacterSeed` 加 `readonly personalityTraits?: PersonalityTraits`（紧跟 `attachmentStyle` —— 二者是内核人格调节算子的**两个输入源**）；② 两个内置种子加 OCEAN 五维种子值（回避型 0.4/0.6/0.25/0.45/0.65、焦虑型 0.5/0.55/0.35/0.6/0.7，**逐字照搬任务单 §3.2**）；③ `buildCharacterProfile` 用**条件展开**把种子值传进 `CharacterProfile.personalityTraits`；④ 新增 `normalizePersonalityTraits` / `normalizeTrait` 两个 helper（**逐维归一**，见 §2.2）；⑤ 文件头加 WP49 段（为什么条件传 / 为什么逐维归一） |
| `src/engine-adapters/wiring/character/character-profile.entity.ts` | ① 加 `personalityTraits` 列（`@Column({ type: 'json', name: 'personality_traits', nullable: true })`，属性类型 `PersonalityTraits \| null`）；② import 加 `PersonalityTraits` 类型；③ 文件头加 WP49 段（为什么 JSON NULL / 为什么放 `five_ps` 旁边） |
| `src/engine-adapters/wiring/character/db-character-profile.resolver.ts` | ① `toCharacterSeed` 加**条件展开**读 `personality_traits`（`== null` → 不传；否则传）；② 文件头加 WP49 段（为什么与 safety / bond 的口径相反） |
| `src/migration/1714900000028-AddCharacterProfilePersonalityTraits.ts` | **新增**：手写 DDL 加一列（`personality_traits JSON NULL AFTER five_ps`，**无 DEFAULT**）；幂等守卫（INFORMATION_SCHEMA 判断，缺才加）+ 自愈 + down 净删 |

### 1.3 登记（硬约束 #1：真注册点是 `bin/ormconfig.ts`）

| 文件 | 改了什么 |
|---|---|
| `src/migration/index.ts` | 导出 `AddCharacterProfilePersonalityTraits1714900000028` + 说明注释 |
| `bin/ormconfig.ts` | import + `migrations[]` 数组**都**登记（只 import 不列 = 同样不执行） |

### 1.4 测试：1 新增

| 文件 | 改了什么 |
|---|---|
| `test/engine-adapters/wp49-character-five-factor-personality.spec.ts` | **新建** **21 例**：内置种子 → profile / 两种子分得开 / 种子没说 vs 说了 0.5 / 宜人性算子**真的活了**（注入阈值验证 ×1.1）/ 默认阈值下当前不触发（留档断言）/ DB 有值传 / DB NULL 不传 / DB 全链 / 越界夹取 / 脏值按"没说"处理 / entity 列定义 / **migration DDL 与 entity 对着比** / 幂等 / down / **双登记** |

### 1.5 文档

| 文件 | 改了什么 |
|---|---|
| `docs/worklog/pending/wp49-character-five-factor-personality-2026-11-04.md` | 状态行改 `✅ 已交付` + 指向交付记录；追加「§9 交付后补记」偏差表 → 移入 `completed/phase2/` |
| `docs/worklog/pending/phase2-wp-list-2026-11-03.md` | WP49 行 ✅ + 交付记录链接；统计进度 15/36 → 16/36 |
| `docs/worklog/README.md` | Phase2 已开工列表 +WP49；进度回写 16/36；目录结构说明 +WP49 |

---

## 2. 关键设计决策（与任务单有出入的地方 + 为什么）

### 2.1 ⚠️ 最要紧的一条：**算子通路已通，但任务单指定的种子值当前不触发 ×1.1**

任务单 §3.2 逐字指定的两个种子宜人性值是 **回避型 0.45 / 焦虑型 0.6**，而 WP34 的内核默认配置是：

```ts
// src/engine-core/cognition/personality-modulator.ts:160
agreeableness: { trustScale: 1.1, highThreshold: 0.7 },
```

内核规则是 `if (value < threshold) return 1;`（第 259 行）—— **两个种子值都低于 0.7**，所以在默认配置下，共情回合的 trust ×1.1 增益**暂时不会触发**。

**这不影响任务单 §6.1「算子不再休眠」的验收口径**：那一条的原文是「`input.traits?.agreeableness` **有值了**」—— 本期确实有值了（此前永远是 `undefined`）。「值有了」与「值刚好落在阈值之上」是两件事，前者是**本期要解决的**，后者是**临床校准问题**。

**处置（不擅自改数、不擅自改阈值）**：

- **不**把种子值调高到 0.7 以上 —— 任务单 §3.2 逐字给定的数字，改了就是擅自发明临床结论；
- **不**把 WP34 的 `highThreshold` 调低 —— 阈值属内核常量，改它要动 engine-core（本单红线），且它同样是待校准的临床数字；
- **在测试里把这件事钉成显式断言**（用例 ⑨）：两个内置种子的宜人性当前都低于默认阈值 → 增益暂不触发。**若日后校准把种子值抬到阈值之上，这条用例会变红 —— 那是故意的**：增益开始生效属于**行为变化**，必须被显式看见，不能悄悄发生；
- **验证"通路真的活了"的方式是注入阈值**（用例 ⑦）：WP34 的设计是「系数走端口注入」，测试注入 `highThreshold: 0.4` → 回避型的 0.45 过线 → trust 增益 ×1.1 实测生效。这样**把"通路问题"与"校准问题"彻底分开**：通路的正确性不依赖种子值落在阈值的哪一侧。

### 2.2 偏差（任务单 §3.3 草图之外）：映射层**逐维归一**

任务单 §3.3 的草图是「`personalityTraits` 原样传」。本单**多了一步归一**，理由是核实到的硬事实：

- 内核的宜人性规则 `value < highThreshold → 不放大` **不 clamp**；
- 大五人格的 DB 列是**自由 JSON**（`type: 'json'`，没有 DB 级取值约束），运营手写 `1.5` / `-0.2` 完全可能；
- 于是 `agreeableness: 1.5` 会**误判**成"高宜人性"，白拿 ×1.1 的 trust 增益 —— 而这个错误**没有任何报错**。

所以 `buildCharacterProfile` 里加了 `normalizePersonalityTraits`：把每个**已给**的维度夹到 [0,1]。这与该文件既有的「所有进内核的数值都归一」实践一致（`trust` / `resistance` / `emotion` / `safety` / `bond` 全都过 `clamp01` / `clampValence`）。

**两条边界写死在实现里**：

1. **只归一"已给"的维度** —— 没给的维度保持"没说"（键不存在），不补 0.5。补了就抹掉了"这个角色没说宜人性"与"这个角色宜人性正好是 0.5"的区别；
2. **非有限数（脏值）按"没说"处理**，不是按 `clamp01` 的 NaN → 0 —— `clamp01` 的 NaN → 0 是"数值兜底"口径，而这里的 NaN 来自 DB 脏数据，把"数据坏了"翻译成"这个维度极端低"是**发明**了一个临床结论。内核自己的口径是 `!Number.isFinite(value) → 不调节`，本层跟它一致。

### 2.3 决策：DB 列是 **JSON NULL**，不是 NOT NULL DEFAULT（与 WP51 两列口径相反）

大五人格是**可选**的 —— "没表态"与"正好是 0.5"是两个不同的事实。若给一个 DB DEFAULT，"没说"与"0.5"就在数据源上被抹平了，适配层的条件展开也就失去了意义。另：MySQL 的 JSON 列本来就不该挂 DEFAULT —— 默认值写进 DDL 就是第二份真相源（内核已经有一份：特质缺省 = 不做特质调节）。

**存量行的行为**：WP9-B seed 灌进来的 4 个 `vpt_*` 行，加列后仍是 **NULL** —— 也就是"没表态" → 内核不做特质调节 → **老角色加列后的行为与加列前逐字一致**（零回归）。本期**不**给这 4 个 DB 角色灌大五人格：任务单 §5.2 明确大五人格是可选的，4 个 DB 角色本期不表态。

### 2.4 决策：「条件展开 vs 直接传」的分界线 = **"没值"在数据源上是否可能发生**

同一个 `toCharacterSeed` 函数里，两种写法并存，**这不是不一致，是有意的**：

| 字段 | DB 列 | 写法 | 为什么 |
|---|---|---|---|
| `baseline.safety` / `bond` | `NOT NULL DEFAULT` | **直接传** | "没值"在数据源上不可能发生 |
| `personalityTraits` | `JSON NULL` | **条件展开** | NULL 就是真的"没说" |

### 2.5 决策：DTO / admin service / seed 脚本**一律不动**

- **DTO 不动**（任务单 §5.2 未列）—— WP51 加 DTO 是因为 safety/bond 要运营可改；WP49 的 Admin 雷达图明确留到后面（任务单 §7 第 3 条）；
- **admin service 不动** —— 它的更新路径是 `if (input.x !== undefined) row.x = ...`，**不传就整列不碰**，新列不会被洗掉；新建路径用条件展开，没给 → 整列不出现 → 走 DB 的 NULL；
- **seed 脚本不动**（任务单 §5.1 未列）—— `toEntityPayload` 用条件展开、`hasOptionalColumnDrift` 只对"种子给了值"的列判漂移 → 新列不参与 seed，DB 角色保持 NULL。

### 2.6 决策：migration 列位置 `AFTER five_ps`

`five_ps` 是**临床 5Ps**（易感 / 维持 / 诱发 / 保护 / 持续因素），是给人读的长材料；`personality_traits` 是**大五人格数值**，是给内核算子吃的。两者**不是一回事**（内核 `PersonalityTraits` 的注释里专门警告过），但它们是"角色画像"里最容易被混淆的两个东西 —— **并排放，让"这是两列"一眼可见**，而不是塞进 `baseline_*` 那一组里让人以为它是同盟三维的近亲。

### 2.7 决策：边界白名单**无需新增条目**

`PersonalityTraits` **早已在列**（`src/engine-core/index.ts:37` 导出；`boundary.spec.ts` 断言 ⑥ 的白名单第 406 行已有 `'PersonalityTraits'`）。适配层从**公开 barrel** import 类型，不触发断言 ⑪（不得深路径 import 内核内部模块）。`boundary.spec.ts` **零改动**通过。

### 2.8 部署顺序（写在这里，别在部署时踩）

1. **先** `pnpm migration:run` —— 加一列（存量行自动是 NULL，行为与加列前逐字一致）；
2. 不需要 seed 重跑（本期 DB 侧不表态大五人格）。

⚠️ **顺序反了会报错**：entity 加了列 → resolver 的 `SELECT` 就带上这一列 → migration 没跑就查 → `Unknown column 'personality_traits'`。这是加列类迁移的固有代价，与仓库既有 ALTER 迁移（0019 / 0022 / 0024 / 0027）同款。

---

## 3. 闸门数字

| 闸门 | 结果 |
|---|---|
| `npx eslint "src/**/*.ts" "test/**/*.ts" "bin/**/*.ts"` | **0 error**（exit 0） |
| `npx tsc -p tsconfig.build.json --noEmit` | **0 error**（exit 0） |
| `npx vitest run --exclude '**/e2e/**/*.ts'` | **98 个测试文件 / 1570 例全绿**（WP61 基线 97 文件 / 1549 例 + 本轮新增 **1 文件 / 21 例**，**零回归**：1549 + 21 = 1570 ✓） |
| `npx vitest run`（WP49 + WP9A + WP9B×2 + WP10A + WP51 六个角色相关文件） | **6 文件 / 109 例全绿** |
| `git diff --stat HEAD -- src/engine-core` | **空** —— 本期内核零改动 |

**回归确认**：

- **不提供大五人格** → `profile.personalityTraits` **键不存在**（`'personalityTraits' in profile === false`），内核走"不做特质调节"，delta 逐字不变；
- **种子明确给了 0.5** → 键存在且值为 0.5（与"没说"**能被区分开**）；
- **只给一维** → 其余四维保持"没说"（不补默认值）；
- **越界值** → 夹回 [0,1]（1.5 → 1，-0.2 → 0）；
- **脏值（NaN / Infinity）** → 按"没说"处理（不误触阈值判断，不变成"极端低"）；
- **DB 列 NULL** → `toCharacterSeed` 不传 → profile 键不存在；
- **DB 有值** → 原样进种子 → 全链到内核算子（用例 ⑫ 实测 ×1.1 生效）；
- **临场 preset 不覆盖人格底色**（人格是"角色本来是什么样"，不是旋钮）；
- **resolver 仍是唯一映射入口** → 不在 resolver 里另写一份公式；
- **既有测试** → WP9-A / WP9-B×2 / WP10A / WP34 / WP51 全部保留（只新增文件，**未改任何既有断言**）；
- **边界断言** → `boundary.spec.ts` 12 例零改动通过（`PersonalityTraits` 早已在白名单）。

---

## 4. 本期**没做**的（明确留给后续，别当漏做）

1. **大五人格数值的临床校准** —— 本期是工程种子值，内测后按真实对练校准；**当前两个内置种子的宜人性都低于 WP34 默认阈值 0.7 → 共情回合的 ×1.1 增益暂不触发**（见 §2.1）；
2. **其余四大大五特质的调节算子**（openness / conscientiousness / extraversion / neuroticism）—— 本期只落地宜人性（WP34 已做算子），其余留到后面；
3. **Admin Dashboard 展示大五人格雷达图** —— 那是前端的事；本期 DTO / admin service 一律不动；
4. **DB 侧 4 个角色表态大五人格** —— 本期列是 NULL（= 没表态 = 内核中性），后续运营标定时再灌；
5. **「依恋类型 → 基线阻抗的缺省映射」** —— 任务单 §4.4 明确留到后面（本期不碰，避免范围膨胀）。

---

_创建：2026-11-04_
_深度通知：任务单 §2.1–§2.6（现状盘查）/ §3.1–§3.5（本期做什么）/ §4.1–§4.4（边界问题补充）/ §5.1–§5.2（边界约束）/ §6.1–§6.3（验收与用例要求）逐条核实 + 真实代码 grep（内核 `PersonalityTraits` 定义与 barrel 导出 / `resolveAgreeablenessTrustScale` 的阈值规则与默认配置 / `InMemoryEngineSession.personalityInput` 的 traits 组装 / `builtin-character-registry` 的 `clamp01` 既有实践 / entity 与 resolver 现状 / WP51 migration 守卫范式与双登记点 / admin service 与 seed 脚本的"undefined = 不碰该列"语义）_
