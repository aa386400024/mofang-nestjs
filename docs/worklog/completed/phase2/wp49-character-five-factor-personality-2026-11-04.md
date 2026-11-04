# WP49 任务单 — 角色大五人格字段落地

> **状态**：✅ 已交付（2026-11-04）→ 交付记录：[`engine-wp49-character-five-factor-personality-implementation-2026-11-04.md`](engine-wp49-character-five-factor-personality-implementation-2026-11-04.md)
> **路径**：`docs/worklog/completed/phase2/wp49-character-five-factor-personality-2026-11-04.md`
> **优先级**：🟢 P2
> **引擎内核**：❌ 不改 engine-core（内核的 `PersonalityTraits` 类型已存在，只是适配层没传数据）—— 交付态 `git diff --stat HEAD -- src/engine-core` **为空**
> **前置依赖**：WP34（人格调节算子）
> **北极星**：[`../../../architecture/engine-endstate-blueprint-v1.0.md`](../../../architecture/engine-endstate-blueprint-v1.0.md) §② BDI 信念层

---

## 1. 任务概述

### 1.1 一句话目标

WP34 已交付人格调节算子（依恋系数 + 宜人性调节），但**大五人格没有数据源** —— 内核的 `PersonalityTraits` 类型已定义（OCEAN 五维），但适配层从来没传过数据，所以宜人性调节在生产上是休眠的（`resolveAgreeablenessTrustScale()` 读 `input.traits?.agreeableness`，但 `traits` 永远是 `undefined`）。

本期把大五人格字段落地：给内置种子加种子值、给 DB 加列、给 resolver 加读取，让宜人性调节算子真正"活"过来。

### 1.2 为什么现在做

- WP34 做了算子但没数据 = **空转** —— 这是 engine-core 的补完项
- 内测时如果发现"宜人性调节没效果"，查了半天发现是没传数据 —— 这个坑现在就填
- 大五人格是心理咨询的标准模型，后面 Admin Dashboard 要展示角色画像，结构化的大五人格数值是基础

---

## 2. 现状盘查结论（已 grep 全 engine-core + engine-adapters 核实）

### 2.1 内核的 `PersonalityTraits` 已定义

```ts
// character-profile.ts:43-53
export interface PersonalityTraits {
  readonly openness?: number;
  readonly conscientiousness?: number;
  readonly extraversion?: number;
  readonly agreeableness?: number;
  readonly neuroticism?: number;
}
```

**问题**：五个字段都是可选的，**但从来没人传过数据**。

### 2.2 WP34 的宜人性调节算子

```ts
// personality-modulator.ts:249-261
function resolveAgreeablenessTrustScale(
  input: PersonalityModulatorInput,
  config: PersonalityModulatorConfig,
): number {
  const value = input.traits?.agreeableness;
  // ...
}
```

**问题**：读 `input.traits?.agreeableness`，但 `traits` 永远是 `undefined` —— 算子在生产上是休眠的。

### 2.3 `BuiltinCharacterSeed` 没有 `personalityTraits` 字段

```ts
// builtin-character-registry.ts:73-116
export interface BuiltinCharacterSeed {
  readonly key: string;
  readonly displayName: string;
  readonly attachmentStyle: AttachmentStyle;
  readonly coreBeliefs: readonly CoreBelief[];
  readonly underlyingDesires: readonly UnderlyingDesireSeed[];
  readonly forbiddenBehaviors: readonly string[];
  readonly sensitiveTopics: readonly string[];
  readonly baseline: { ... };
  // ❌ 没有 personalityTraits
}
```

**问题**：内置种子没传大五人格数值。

### 2.4 `buildCharacterProfile()` 没传 `personalityTraits`

```ts
// builtin-character-registry.ts:249-270
export function buildCharacterProfile(seed: BuiltinCharacterSeed, preset?: CharacterPresetInput): CharacterProfile {
  return {
    coreBeliefs: ...,
    attachmentStyle: seed.attachmentStyle,
    underlyingDesires: ...,
    baseline: { ... },
    forbiddenBehaviors: [...],
    sensitiveTopics: [...],
    // ❌ 没传 personalityTraits
  };
}
```

**问题**：构造 `CharacterProfile` 时没传 `personalityTraits`。

### 2.5 DB 的 `character_profiles` 表没有 `personality_traits` 列

```ts
// character-profile.entity.ts:153-154
@Column({ type: 'json', name: 'five_ps' })
fivePs!: CharacterFivePs;
```

**问题**：DB 里只有 `five_ps`（临床 5Ps，是人读材料），没有大五人格数值列。

### 2.6 `db-character-profile.resolver.ts` 的 `toCharacterSeed()` 没读 `personality_traits`

```ts
// db-character-profile.resolver.ts:52-80
export function toCharacterSeed(row: CharacterProfileEntity): BuiltinCharacterSeed {
  return {
    key: row.templateId,
    displayName: row.displayName,
    attachmentStyle: row.attachmentStyle,
    coreBeliefs: ...,
    underlyingDesires: ...,
    forbiddenBehaviors: [...],
    sensitiveTopics: [...],
    baseline: { ... },
    // ❌ 没读 personality_traits
  };
}
```

**问题**：DB resolver 没读大五人格数值。

---

## 3. 本期做什么

### 3.1 给 `BuiltinCharacterSeed` 加 `personalityTraits?` 字段

```ts
// builtin-character-registry.ts
export interface BuiltinCharacterSeed {
  // ... 既有字段不变 ...

  /**
   * 大五人格 (OCEAN) —— WP49.
   *
   * 缺省 = 不传 = 内核用中性值 (0.5) —— 回退口径住在内核, 本层不兜底.
   * 与 baseline.safety / baseline.bond 同口径: 条件展开 = "种子没说"与"种子说了 0.5"能被区分开.
   */
  readonly personalityTraits?: PersonalityTraits;
}
```

### 3.2 给两个内置种子加大五人格种子值

**回避型 L1**（`BUILTIN_AVOIDANT_L1`）：
```ts
personalityTraits: {
  openness: 0.4,        // 偏封闭
  conscientiousness: 0.6, // 偏尽责
  extraversion: 0.25,  // 偏内向
  agreeableness: 0.45,  // 偏低宜人性
  neuroticism: 0.65,   // 偏高神经质
},
```

**焦虑型低 mood L1**（`BUILTIN_ANXIOUS_LOW_MOOD_L1`）：
```ts
personalityTraits: {
  openness: 0.5,        // 中性
  conscientiousness: 0.55, // 略尽责
  extraversion: 0.35,  // 偏内向
  agreeableness: 0.6,  // 偏高宜人性
  neuroticism: 0.7,    // 高神经质
},
```

**口径说明**：
- 数值是**工程种子值，非临床标定** —— 内测后按真实对练校准
- 与依恋风格一致：回避型 = 低宜人性 + 高神经质 + 低外向；焦虑型 = 高宜人性 + 高神经质

### 3.3 `buildCharacterProfile()` 传 `personalityTraits`

```ts
// builtin-character-registry.ts
export function buildCharacterProfile(seed: BuiltinCharacterSeed, preset?: CharacterPresetInput): CharacterProfile {
  return {
    // ... 既有字段不变 ...

    // WP49: 大五人格 —— 种子给了就传, 没给就不出现 (键都不存在).
    //   与 baseline.safety / baseline.bond 同口径: 条件展开, 不在此处兜默认值.
    ...(seed.personalityTraits === undefined ? {} : { personalityTraits: seed.personalityTraits }),
  };
}
```

### 3.4 DB 加 `personality_traits` 列

手写 migration：
- 表：`character_profiles`
- 列：`personality_traits` JSON NULL
- 默认值：NULL（角色没给大五人格时 = 内核用中性值 0.5）

### 3.5 `db-character-profile.resolver.ts` 的 `toCharacterSeed()` 读 `personality_traits`

```ts
// db-character-profile.resolver.ts
export function toCharacterSeed(row: CharacterProfileEntity): BuiltinCharacterSeed {
  return {
    // ... 既有字段不变 ...

    // WP49: 大五人格 —— DB 列是 NULL 时不传 (内核用中性值).
    ...(row.personalityTraits === null || row.personalityTraits === undefined
      ? {}
      : { personalityTraits: row.personalityTraits }),
  };
}
```

---

## 4. 边界问题补充

### 4.1 ⚠️ 为什么不改内核？

**因为内核的 `PersonalityTraits` 类型已经存在了。**

- 内核的 `CharacterProfile` 已经有 `personalityTraits?: PersonalityTraits` 字段
- WP34 的宜人性调节算子已经读 `input.traits?.agreeableness`
- 只是适配层从来没传过数据
- 本期只改适配层，把数据喂进去，内核一行不动

### 4.2 ⚠️ 为什么条件展开，不兜默认值？

**与 baseline.safety / baseline.bond 同口径。**

- 条件展开 = "种子没说"与"种子说了 0.5"能被区分开
- 适配层兜默认值 = 两个真相源（适配层一份 + 内核 bootstrap 一份）
- 回退口径住在内核 bootstrap（`?? 0.5`），本层不兜底

### 4.3 ⚠️ DB 列为什么是 NULL，不是 DEFAULT？

**因为大五人格是可选的。**

- 有些角色可能不需要大五人格（比如简单的 mock 角色）
- NULL = 没给 = 内核用中性值（0.5）
- 与 `baseline_safety` / `baseline_bond` 同口径（它们是 NOT NULL DEFAULT 0.5 / 0，但那是因为同盟三维是必填的；大五人格是可选的）

### 4.4 ⚠️ 为什么本期不做"依恋类型 → 基线阻抗的缺省映射"？

**因为那是另一个问题，范围不一样。**

- WP49 的描述里提到"依恋类型 → 基线阻抗的缺省映射缺统一规则"
- 但本期主要是**大五人格字段落地**（宜人性调节算子空转的问题）
- 依恋类型 → 基线阻抗的缺省映射是一个"优化项"（现在两个内置种子各自给了自己的阻抗基线，DB 角色没给时用 DEFAULT_RESISTANCE）
- 这个留到后面，避免范围膨胀

---

## 5. 边界约束

### 5.1 适配层改动（5 个文件）

1. `src/engine-adapters/wiring/character/builtin-character-registry.ts` —— `BuiltinCharacterSeed` 加 `personalityTraits?` + 两个内置种子加种子值 + `buildCharacterProfile()` 传 `personalityTraits`
2. `src/engine-adapters/wiring/character/character-profile.entity.ts` —— 加 `personalityTraits` 字段
3. `src/engine-adapters/wiring/character/db-character-profile.resolver.ts` —— `toCharacterSeed()` 读 `personality_traits`
4. 手写 migration —— `character_profiles` 表加 `personality_traits` 列
5. 测试文件 —— 补用例

### 5.2 不碰的地方

- ❌ 不改 `PersonalityTraits` 类型（内核已有）
- ❌ 不改 WP34 的宜人性调节算子（算子已就位，只是没数据）
- ❌ 不改 `five_ps`（临床 5Ps 是人读材料，与大五人格不是一回事）
- ❌ 不改 engine-core 任何文件
- ❌ 不改 `.env` / 配置文件
- ❌ 不做"依恋类型 → 基线阻抗的缺省映射"（留到后面）

---

## 6. 验收标准

### 6.1 功能验收

- [ ] `BuiltinCharacterSeed` 有 `personalityTraits?` 字段
- [ ] 两个内置种子有大五人格种子值
- [ ] `buildCharacterProfile()` 传 `personalityTraits`
- [ ] DB 的 `character_profiles` 表有 `personality_traits` 列
- [ ] `db-character-profile.resolver.ts` 的 `toCharacterSeed()` 读 `personality_traits`
- [ ] 宜人性调节算子不再休眠（`input.traits?.agreeableness` 有值了）

### 6.2 闸门验收

- [ ] `npx eslint "src/**/*.ts" "test/**/*.ts"` → 0 error
- [ ] `npx tsc -p tsconfig.build.json --noEmit` → 0 error
- [ ] `npx vitest run` → 全绿（零回归）
- [ ] `git diff --stat HEAD -- src/engine-core` → **空**（本期不改内核）

### 6.3 测试用例要求

至少补充：
1. 内置种子有大五人格数值（`buildCharacterProfile()` 返回的 `personalityTraits` 有值）
2. DB resolver 读 `personality_traits`（有值时传，NULL 时不传）
3. 没传 `personalityTraits` 时内核用中性值（零回归）

---

## 7. 本期没做的（明确留给后续）

1. **依恋类型 → 基线阻抗的缺省映射** —— 本期不做，留到后面
2. **其余四大大五特质的调节算子**（openness / conscientiousness / extraversion / neuroticism）—— 本期只落地宜人性（WP34 已做），其余四期留到后面
3. **Admin Dashboard 展示大五人格雷达图** —— 那是前端的事
4. **大五人格数值的临床校准** —— 本期是工程种子值，内测后按真实对练校准

---

## 8. 转述给后端的话术

> WP49：角色大五人格字段落地。
>
> 开工前先读 `docs/README.md` 和 `docs/worklog/README.md` 入口，确认红线和交付格式。
>
> 任务单在 `docs/worklog/pending/wp49-character-five-factor-personality-2026-11-04.md`。
>
> **不改 engine-core**，只改适配层：
> - `builtin-character-registry.ts` —— `BuiltinCharacterSeed` 加 `personalityTraits?` + 两个内置种子加种子值 + `buildCharacterProfile()` 传 `personalityTraits`
> - `character-profile.entity.ts` —— 加 `personalityTraits` 字段
> - `db-character-profile.resolver.ts` —— `toCharacterSeed()` 读 `personality_traits`
> - 手写 migration —— `character_profiles` 表加 `personality_traits` 列
>
> 关键口径：
> - 内核的 `PersonalityTraits` 类型已存在，只是适配层没传数据
> - 条件展开，不兜默认值（与 baseline.safety / baseline.bond 同口径）
> - DB 列是 NULL，不是 DEFAULT（大五人格是可选的）
> - 数值是工程种子值，非临床标定
> - 本期只落地宜人性（WP34 已做），其余四大特质留到后面
>
> 任务单里所有函数名 / 类型名 / 文件路径都是 grep 核实过的，不是凭印象写的。
>
> 交付按 `team/conventions.md` §二的格式写交付记录：改了哪些文件、关键设计决策（跟任务单有出入要说明）、闸门数字。

---

## 9. 交付后补记（2026-11-04）

> 完整交付记录见 [`engine-wp49-character-five-factor-personality-implementation-2026-11-04.md`](engine-wp49-character-five-factor-personality-implementation-2026-11-04.md)。本节只记**与任务单原文有出入**的地方 + 一条必须留档的行为事实。

### 9.1 偏差表

| # | 任务单原文 | 实际落地 | 为什么 |
|---|---|---|---|
| 1 | §3.3 `buildCharacterProfile()` 只做条件展开、原样传 `seed.personalityTraits` | 条件展开 **+ 逐维归一**（`normalizePersonalityTraits`）：已给的维度夹到 [0,1]，没给的维度保持"没说"（键不存在），非有限数按"没说"处理 | 内核宜人性规则 `value < highThreshold → 不放大` **不 clamp**，而 DB 列是自由 JSON —— 手滑写进 `1.5` 会**误判**成"高宜人性"白拿 ×1.1，且**不报错**。归一与该文件既有实践（`trust` / `resistance` / `emotion` / `safety` / `bond` 全过 `clamp01`）一致 |
| 2 | §3.5 草图用 `row.personalityTraits === null \|\| row.personalityTraits === undefined` | 改成 `row.personalityTraits == null` | `sonarjs/different-types-comparison`：entity 类型是 `PersonalityTraits \| null`，与 `undefined` 严格比较被判"恒为 false"（error）。`== null` 同时兜住 null 与 undefined（后者是"字段压根没被选中"），语义等价且仓库已有同款写法（`life-map.service.ts:377`） |
| 3 | §5.1 列了 5 个文件 | 实际 **5 改 1 新增**（多改了 `src/migration/index.ts` 与 `bin/ormconfig.ts` 的**双登记**，少改 `character-profile.seed.ts`） | 双登记是硬约束 #1（漏登记 = migration 永不执行），任务单 §8 话术里已写明；seed 脚本**不动**是 §5.2 的"不碰"精神 —— 新列不参与 seed → 4 个 DB 角色保持 NULL = 内核中性值 |
| 4 | §6.3 要求 3 条用例 | 扩到 **21 例** | 照 WP51 模板补齐：entity ↔ migration 对着比 / 幂等 / 自愈 / 回滚 / 双登记 / 归一边界 / 「没说 vs 说了 0.5」可区分 |

### 9.2 ⚠️ 必须留档的行为事实：算子**通路已通，但当前种子值不触发**

任务单 §3.2 逐字给的宜人性值（回避型 **0.45** / 焦虑型 **0.6**）**都低于** WP34 的内核默认阈值 `highThreshold: 0.7`（`personality-modulator.ts:160`），而内核规则是 `value < threshold → return 1`（不放大）。

- §6.1「算子不再休眠」的验收口径（原文：`input.traits?.agreeableness` **有值了**）—— **已满足**；
- 但默认配置下，共情回合的 trust ×1.1 增益**暂时不会触发**。

**处置**：不擅自改种子值、不擅自改内核阈值（阈值属待校准的临床数字，且改它要动 engine-core）；改为在测试里**注入阈值**（`highThreshold: 0.4`）验证通路真的活了，并把「默认阈值下当前不触发」写成**显式断言**（用例 ⑨）—— 日后校准把种子值抬到阈值之上时，这条用例会变红，那是**故意的**：增益开始生效属于行为变化，必须被显式看见。

### 9.3 部署顺序

**先** `pnpm migration:run`（加一列，存量行自动 NULL，行为逐字不变）；不需要重跑 seed。反了会报 `Unknown column 'personality_traits'`（entity 加了列 → resolver 的 `SELECT` 带上它 → migration 没跑就查）。

### 9.4 闸门数字

eslint **0 error** / tsc（`tsconfig.build.json`）**0 error** / vitest **98 文件 / 1570 例全绿**（基线 97 / 1549 + 本轮 1 文件 / 21 例）/ `git diff --stat HEAD -- src/engine-core` **为空**。

---

_创建：2026-11-04_
_深度通知：`PersonalityTraits` / `CharacterProfile.personalityTraits` / `resolveAgreeablenessTrustScale` / `BuiltinCharacterSeed` / `buildCharacterProfile` / `db-character-profile.resolver.ts` / `character-profile.entity.ts` / `five_ps`（临床 5Ps）—— 全部 grep 核实_
