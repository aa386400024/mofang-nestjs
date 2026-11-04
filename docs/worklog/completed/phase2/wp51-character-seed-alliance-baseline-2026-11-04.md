# WP51 任务单 — 角色种子同盟三维基线

> **状态**：✅ 已交付（2026-11-04）→ [`engine-wp51-character-seed-alliance-baseline-implementation-2026-11-04.md`](engine-wp51-character-seed-alliance-baseline-implementation-2026-11-04.md)
> **路径**：`docs/worklog/pending/wp51-character-seed-alliance-baseline-2026-11-04.md`
> **优先级**：🟡 P1
> **引擎内核**：✅ 预批准改 engine-core（CharacterProfile 契约扩展，与 WP42 同文件同范式）
> **前置依赖**：WP42（咨询同盟三维 trust/safety/bond）、WP53（人格调节算子扩展到 safety/bond）
> **北极星**：[`../../architecture/engine-endstate-blueprint-v1.0.md`](../../architecture/engine-endstate-blueprint-v1.0.md) §② BDI 推理层

---

## 1. 任务概述

### 1.1 一句话目标

WP42 已交付 trust / safety / bond 独立建模，但**所有角色开场都是 safety=0.5 / bond=0** —— 回避型和安全型开场安全感一样，人格差异没落地。本期给角色种子加 safety / bond 基线，按依恋风格分化（回避型 safety 低、安全型 safety 中高）。

### 1.2 为什么现在做

- WP42 交付记录自己登记了缺口：「安全/纽带感本期不接角色种子」
- 现在内测时会出现：回避型角色（本该对关系很戒备）开场 safety=0.5，和安全型角色一样 —— 人格差异只体现在 trust 和阻抗上，safety 是平的
- WP53 已经把人格调节算子扩展到 safety / bond 了，但**基线是平的**，调节再准也差不了多少 —— 就像在平地上调坡度，起点都在同一高度
- 这是 WP42 + WP53 的补完项，做完之后同盟三维才真正端到端生效

---

## 2. 现状盘查结论（已 grep 全 engine-core + engine-adapters 核实）

### 2.1 BdiSnapshot 同盟三维现状

```ts
// bdi-snapshot.ts:99-103
readonly trust: number;   // 来访相信咨询师是专业的、不会评判自己
readonly safety: number;  // 来访在这段关系里感到安全，可以敞开心扉
readonly bond: number;   // 来访与咨询师有情感连接，不是冷冰冰的问诊
```

**问题**：三维都有，但 safety / bond 的初始值是硬编码的。

### 2.2 bootstrap 初始化现状

```ts
// bootstrap.ts:105-110
trust: clamp01(profile?.baseline?.trust ?? DEFAULT_TRUST),
// WP42: 安全感 / 纽带感本期**不接角色种子** (任务单 §3.1 只给了固定初值) ——
//   角色种子里没有这两项, 硬造一个"依恋型起始安全感更高"就是发明临床数字.
//   需要按角色分化时, 走 AllianceConfig 端口或后续 WP 扩展角色基线.
safety: clamp01(DEFAULT_SAFETY),   // DEFAULT_SAFETY = 0.5
bond: clamp01(DEFAULT_BOND),       // DEFAULT_BOND = 0
```

**问题**：trust 是从 `profile.baseline.trust` 读的，但 safety / bond 是硬编码的默认值。

### 2.3 CharacterProfile.baseline 现状

```ts
// character-profile.ts:52-57
readonly baseline?: {
  readonly trust?: number;
  readonly resistance?: Partial<BdiResistance>;
  readonly emotion?: Partial<EmotionState>;
  readonly transference?: Partial<TransferenceState>;
};
```

**问题**：baseline 只有 trust / resistance / emotion / transference，没有 safety / bond。

### 2.4 BuiltinCharacterSeed.baseline 现状

```ts
// builtin-character-registry.ts:68-82
readonly baseline: {
  readonly trust: number;
  readonly resistance: { verbal: number; depth: number; style: number; };
  readonly emotion: { valence: number; arousal: number; };
};
```

**问题**：内置角色种子的 baseline 也没有 safety / bond。

### 2.5 内置角色种子现状

```ts
// builtin-character-registry.ts:91-108 (回避型 L1)
export const BUILTIN_AVOIDANT_L1: BuiltinCharacterSeed = {
  key: 'builtin_avoidant_l1',
  displayName: '回避依恋 · L1',
  attachmentStyle: 'avoidant',
  // ...
  baseline: {
    trust: 0.2,
    resistance: { verbal: 0.62, depth: 0.68, style: 0.6 },
    emotion: { valence: -0.55, arousal: 0.18 },
  },
};
```

**问题**：回避型角色 trust=0.2（低），阻抗高，情绪压抑 —— 但 safety 还是 0.5（和安全型一样）。

### 2.6 CharacterProfileEntity 现状

```ts
// character-profile.entity.ts:140-161
@Column({ type: 'float', name: 'baseline_trust', default: 0.3 })
baselineTrust!: number;

@Column({ type: 'float', name: 'baseline_resistance_verbal', default: 0.5 })
baselineResistanceVerbal!: number;
// ... resistance depth / style / emotion valence / arousal 同理
```

**问题**：DB 表有 baseline_trust / baseline_resistance_* / baseline_emotion_*，没有 baseline_safety / baseline_bond。

### 2.7 db-character-profile.resolver.ts 现状

```ts
// db-character-profile.resolver.ts:62-73
baseline: {
  trust: row.baselineTrust,
  resistance: {
    verbal: row.baselineResistanceVerbal,
    depth: row.baselineResistanceDepth,
    style: row.baselineResistanceStyle,
  },
  emotion: {
    valence: row.baselineEmotionValence,
    arousal: row.baselineEmotionArousal,
  },
},
```

**问题**：resolver 从 DB 行转种子形状时，也没有传 safety / bond。

### 2.8 boundary.spec.ts 白名单现状

- `CharacterProfile` 已在白名单
- `domain/character-profile.ts` 已在白名单

**接口内部加可选字段不需要新增白名单条目**。

---

## 3. 本期做什么

### 3.1 内核 CharacterProfile.baseline 加两个可选字段

```ts
// character-profile.ts
export interface CharacterProfile {
  // ... 其他字段不变 ...
  readonly baseline?: {
    readonly trust?: number;
    readonly resistance?: Partial<BdiResistance>;
    readonly emotion?: Partial<EmotionState>;
    readonly transference?: Partial<TransferenceState>;

    /**
     * 关系安全感基线 [0,1] (WP51).
     *
     * 来访在这段关系里感到安全, 可以敞开心扉.
     * 缺省 = 不传 = 用 DEFAULT_SAFETY (0.5).
     */
    readonly safety?: number;

    /**
     * 关系联结基线 [0,1] (WP51).
     *
     * 来访与咨询师有情感连接, 不是冷冰冰的问诊.
     * 缺省 = 不传 = 用 DEFAULT_BOND (0).
     */
    readonly bond?: number;
  };
}
```

**为什么是可选不是必填**：
- 缺省 = 不传 = 用默认值 = 行为与现在逐字一致
- 现有的测试 / 调用方不用改
- 零回归

### 3.2 bootstrap.ts 改成从 baseline 读

```ts
// bootstrap.ts:105-110
trust: clamp01(profile?.baseline?.trust ?? DEFAULT_TRUST),
// WP51: 安全感 / 纽带感从角色基线读, 缺省用默认值 (零回归).
//   角色种子给了就用角色的, 没给就用 DEFAULT_SAFETY / DEFAULT_BOND.
safety: clamp01(profile?.baseline?.safety ?? DEFAULT_SAFETY),
bond: clamp01(profile?.baseline?.bond ?? DEFAULT_BOND),
```

**口径说明**：
- 角色种子给了 safety / bond 就用角色的
- 没给就用默认值（0.5 / 0）= 行为与现在逐字一致
- 零回归

### 3.3 适配层 BuiltinCharacterSeed.baseline 加两个可选字段

```ts
// builtin-character-registry.ts
export interface BuiltinCharacterSeed {
  // ... 其他字段不变 ...
  readonly baseline: {
    readonly trust: number;
    readonly resistance: { verbal: number; depth: number; style: number; };
    readonly emotion: { valence: number; arousal: number; };

    /** 关系安全感基线 [0,1] (WP51). */
    readonly safety?: number;

    /** 关系联结基线 [0,1] (WP51). */
    readonly bond?: number;
  };
}
```

### 3.4 适配层 buildCharacterProfile 接上

```ts
// builtin-character-registry.ts:208-224
export function buildCharacterProfile(seed: BuiltinCharacterSeed, preset?: CharacterPresetInput): CharacterProfile {
  return {
    // ... 其他字段不变 ...
    baseline: {
      trust: clamp01(seed.baseline.trust),
      resistance: buildResistance(seed, preset),
      emotion: buildEmotion(seed, preset),
      transference: { positive: 0, negative: 0, dependency: 0 },
      // 新增：safety / bond 从种子读
      ...(seed.baseline.safety !== undefined ? { safety: clamp01(seed.baseline.safety) } : {}),
      ...(seed.baseline.bond !== undefined ? { bond: clamp01(seed.baseline.bond) } : {}),
    },
    // ... 其他字段不变 ...
  };
}
```

### 3.5 内置角色种子加 safety / bond 值

**口径**：数值是**工程种子值，非临床标定** —— 内测后按真实对练校准。

按依恋风格分化：

| 依恋风格 | safety 基线 | bond 基线 | 理由 |
|---|---|---|---|
| secure（安全型） | 0.6 | 0.2 | 对关系有基本信任，能敞开心扉，有一定联结感 |
| anxious（焦虑型） | 0.4 | 0.5 | 怕被抛弃，安全感中等偏低，但渴望联结（bond 高） |
| avoidant（回避型） | 0.25 | 0.05 | 对关系很戒备，安全感低，联结感几乎没有 |
| disorganized（混乱型） | 0.3 | 0.1 | 既渴望又害怕，安全感低，联结感弱 |

**内置角色种子**：

```ts
// builtin-avoidant-l1 (回避型 L1)
baseline: {
  trust: 0.2,
  resistance: { verbal: 0.62, depth: 0.68, style: 0.6 },
  emotion: { valence: -0.55, arousal: 0.18 },
  safety: 0.25,   // 新增
  bond: 0.05,    // 新增
},

// builtin-anxious-l1 (焦虑型 L1)
baseline: {
  trust: 0.28,
  resistance: { verbal: 0.42, depth: 0.5, style: 0.38 },
  emotion: { valence: -0.45, arousal: 0.62 },
  safety: 0.4,    // 新增
  bond: 0.5,      // 新增
},
```

> 注：如果只有 2 个内置种子（回避型 + 焦虑型），就只改这两个。如果还有安全型 / 混乱型的，也一起加。

### 3.6 DB Entity 加两个字段

```ts
// character-profile.entity.ts
@Column({ type: 'float', name: 'baseline_safety', default: 0.5 })
baselineSafety!: number;

@Column({ type: 'float', name: 'baseline_bond', default: 0 })
baselineBond!: number;
```

**默认值**：
- `baseline_safety` 默认 0.5（与 `DEFAULT_SAFETY` 一致）
- `baseline_bond` 默认 0（与 `DEFAULT_BOND` 一致）
- 老数据不用改，默认值就是现在的行为

### 3.7 db-character-profile.resolver.ts 接上

```ts
// db-character-profile.resolver.ts:62-73
baseline: {
  trust: row.baselineTrust,
  resistance: {
    verbal: row.baselineResistanceVerbal,
    depth: row.baselineResistanceDepth,
    style: row.baselineResistanceStyle,
  },
  emotion: {
    valence: row.baselineEmotionValence,
    arousal: row.baselineEmotionArousal,
  },
  // 新增：safety / bond 从 DB 行读
  safety: row.baselineSafety,
  bond: row.baselineBond,
},
```

---

## 4. 边界问题补充

### 4.1 ⚠️ 为什么加进内核 CharacterProfile 而不是 PersonalityModulator？

**因为 safety / bond 基线是角色的固有属性，不是动态调节。**

- trust 已经在 `CharacterProfile.baseline` 里了，为什么 safety / bond 就不能？
- `PersonalityModulator` 调的是**增量**（delta 乘系数），不是基线 —— 基线是"这个人开场时是什么状态"，调节是"这个人对事件的反应幅度"
- 正确的做法是：和 trust 放在一起，都在 `baseline` 里

### 4.2 ⚠️ 为什么是可选字段而不是必填？

**零回归。**

- 改成必填，所有调用方都要改，测试也要改
- 改成可选，现有调用方一行不用改，只是 safety / bond 缺省 = 不传 = 用默认值
- 和 trust / resistance / emotion 同一范式（都是可选的 Partial）

### 4.3 ⚠️ 数值是谁定的？

**本期写，但标「工程种子值，非临床标定」。**

- 回避型 safety=0.25 / bond=0.05
- 焦虑型 safety=0.4 / bond=0.5
- 安全型 safety=0.6 / bond=0.2

这些是工程种子值，内测后按真实对练校准。不发明临床数字。

### 4.4 ⚠️ 要不要按依恋风格自动推导？

**本期不做自动推导，让角色种子自己填。**

- 如果自动推导（`attachmentStyle === 'avoidant' → safety = 0.25`），那等于在代码里硬编码了一张映射表
- 而实际上，同样是回避型，不同角色的 safety 基线可以不一样（比如一个"创伤后回避"和一个"天生疏离"，safety 起点应该不同）
- 让角色种子自己填，更灵活，也更符合"角色是独立个体"的设定
- 自动推导可以作为后续优化，本期先让种子能填

### 4.5 ⚠️ DB 要不要 migration？

**要，但很简单。**

- `baseline_safety` 加列，默认 0.5
- `baseline_bond` 加列，默认 0
- 老数据不用改，默认值就是现在的行为
- 手写 migration，`migration:generate` 扫不到 counselor entity

---

## 5. 边界约束

### 5.1 engine-core 预批准例外（1 个文件）

1. `src/engine-core/domain/character-profile.ts` —— `baseline` 加 `safety?` / `bond?` 两个可选字段

必须通过 `boundary.spec.ts` 的断言：零 @nestjs / 零网络 / 零 env / 零 prompt。

> 注：`boundary.spec.ts` 白名单已有 `CharacterProfile` / `domain/character-profile.ts` 两个条目，接口内部加可选字段不需要新增白名单条目。

2. `src/engine-core/domain/bootstrap.ts` —— safety / bond 改成从 `profile?.baseline?.safety ?? DEFAULT_SAFETY` 读

### 5.2 适配层改动（6 个文件 + 1 个 migration）

1. `src/engine-adapters/wiring/character/builtin-character-registry.ts` —— `BuiltinCharacterSeed.baseline` 加 `safety?` / `bond?` + `buildCharacterProfile` 接上 + 内置角色种子加值
2. `src/engine-adapters/wiring/character/character-profile.entity.ts` —— 加 `baselineSafety` / `baselineBond` 两个列
3. `src/engine-adapters/wiring/character/db-character-profile.resolver.ts` —— `toCharacterSeed` 传 safety / bond
4. `src/engine-adapters/wiring/character/character-profile.dto.ts` —— DTO 加 `baselineSafety` / `baselineBond` 字段（创建 + 更新两个 DTO）
5. `src/engine-adapters/wiring/character/character-profile.admin.service.ts` —— admin service 读写 `baselineSafety` / `baselineBond`（create / update / get 三处）
6. `src/engine-adapters/wiring/character/character-profile.seed.ts` —— seed 数据同步加 `baselineSafety` / `baselineBond`
7. `src/migration/` —— 手写 migration，加两列（`baseline_safety` 默认 0.5 / `baseline_bond` 默认 0）

### 5.3 不碰的地方

- ❌ 不改 BdiSnapshot 的结构（已经是三维了）
- ❌ 不改 `AllianceConfig`（那是事件级 delta 覆写，不是基线）
- ❌ 不改 `PersonalityModulator`（那是调节增量的，不是基线）
- ❌ 不改 `state-transition.ts`（状态迁移逻辑不变）
- ❌ 不改 `.env` / 配置文件（不需要新 env）

---

## 6. 验收标准

### 6.1 功能验收

- [ ] `CharacterProfile.baseline` 加了 `safety?` / `bond?` 两个可选字段
- [ ] `bootstrap.ts` 改成从 `profile?.baseline?.safety ?? DEFAULT_SAFETY` 读
- [ ] `BuiltinCharacterSeed.baseline` 加了 `safety?` / `bond?` 两个可选字段
- [ ] `buildCharacterProfile` 把 `seed.baseline.safety` / `seed.baseline.bond` 传进去了
- [ ] 内置角色种子（回避型 / 焦虑型）加了 safety / bond 值
- [ ] `CharacterProfileEntity` 加了 `baselineSafety` / `baselineBond` 两个列
- [ ] `db-character-profile.resolver.ts` 的 `toCharacterSeed` 传了 safety / bond

### 6.2 闸门验收

- [ ] `npx eslint "src/**/*.ts" "test/**/*.ts"` → 0 error
- [ ] `npx tsc -p tsconfig.build.json --noEmit` → 0 error
- [ ] `npx vitest run` → 全绿（零回归）
- [ ] `git diff --stat HEAD -- src/engine-core` → 只有 2 个文件（character-profile.ts + bootstrap.ts）

### 6.3 内核测试用例要求

扩展文件：`test/engine-core/wp42-alliance.spec.ts` 或新建 `test/engine-core/wp51-character-seed-alliance-baseline.spec.ts`

至少补充：
1. `CharacterProfile.baseline` 提供 safety / bond 时，bootstrap 用角色的值
2. `CharacterProfile.baseline` 不提供 safety / bond 时，bootstrap 用默认值（零回归）
3. 既有字段集合逐字不变（加可选字段不该动到任何一个既有键）

适配层测试要求：
扩展文件：`test/engine-adapters/wp9a-builtin-character.spec.ts` 或新建 `test/engine-adapters/wp51-character-seed-alliance-baseline.spec.ts`

至少补充：
1. `buildCharacterProfile` 把 `seed.baseline.safety` / `seed.baseline.bond` 传进 `CharacterProfile.baseline`
2. 内置角色种子（回避型 / 焦虑型）的 baseline 里有 safety / bond 值
3. `db-character-profile.resolver.ts` 的 `toCharacterSeed` 传了 safety / bond
4. 不带 safety / bond 的种子仍是合法的 `BuiltinCharacterSeed`（编译期保证别的生产者不必补）

---

## 7. 本期没做的（明确留给后续）

1. **按依恋风格自动推导 safety / bond 基线** —— 本期让角色种子自己填，自动推导可以作为后续优化
2. **Admin Dashboard 编辑角色时加 safety / bond 输入框** —— 那是前端的事，本期只做后端
3. **DB 里老角色数据补 safety / bond 值** —— 本期只加列，默认值就是现在的行为；老角色要不要补值，后续运营再定
4. **safety / bond 基线的临床校准** —— 本期是工程种子值，内测后按真实对练校准

---

## 8. 转述给后端的话术

> WP51：角色种子同盟三维基线。
>
> 开工前先读 `docs/README.md` 和 `docs/worklog/README.md` 入口，确认红线和交付格式。
>
> 任务单在 `docs/worklog/pending/wp51-character-seed-alliance-baseline-2026-11-04.md`。
>
> 预批准改 engine-core，只改 2 个内核文件：
> - `domain/character-profile.ts` —— `baseline` 加 `safety?` / `bond?` 两个可选字段
> - `domain/bootstrap.ts` —— safety / bond 改成从 `profile?.baseline?.safety ?? DEFAULT_SAFETY` 读
>
> 适配层改 4 个文件：
> - `builtin-character-registry.ts` —— `BuiltinCharacterSeed.baseline` 加 `safety?` / `bond?` + `buildCharacterProfile` 接上 + 内置角色种子加值
> - `character-profile.entity.ts` —— 加 `baselineSafety` / `baselineBond` 两个列
> - `db-character-profile.resolver.ts` —— `toCharacterSeed` 传 safety / bond
> - 手写 migration，加两列
>
> 关键口径：
> - safety / bond 是**可选**字段，缺省 = 不传 = 用默认值（0.5 / 0）= 行为与现在逐字一致
> - 角色种子给了就用角色的，没给就用默认值
> - 数值是**工程种子值，非临床标定** —— 内测后按真实对练校准
> - 回避型 safety 低（0.25）、bond 低（0.05）；焦虑型 safety 中（0.4）、bond 高（0.5）
>
> 任务单里所有函数名 / 类型名 / 文件路径都是 grep 核实过的，不是凭印象写的。
>
> 如果真要改 engine-core 的其他地方，先和我确认，不要自己拍板。
>
> 交付按 `team/conventions.md` §二的格式写交付记录：改了哪些文件、关键设计决策（跟任务单有出入要说明）、闸门数字。

---

_创建：2026-11-04_
_深度通知：`CharacterProfile.baseline` / `bootstrap.ts` 初始化 / `BuiltinCharacterSeed.baseline` / `buildCharacterProfile` / `CharacterProfileEntity` / `db-character-profile.resolver.ts` / boundary.spec.ts 白名单，全部 grep 核实_

---

## 9. 交付后补记（2026-11-04）

按 `team/conventions.md` §2.5 记录**任务单与实际交付的偏差**，详细论证见交付记录。

| # | 任务单写的 | 实际交付 | 理由 |
|---|---|---|---|
| 1 | §5.1 + §5.2 共 8 个文件（2 内核 + 6 适配层）+ 1 migration | **完全一致**（零意外） | 内核只动 `character-profile.ts` + `bootstrap.ts`；适配层 6 个文件全接上；migration 手写 + `src/migration/index.ts` + `bin/ormconfig.ts` **双登记** |
| 2 | §7 第 3 条「DB 里老角色数据补 safety / bond 值本期不做」 vs §5.2 第 6 条「seed 数据同步加 baselineSafety / baselineBond」 | **按 §5.2 执行：DB 侧 4 个角色本期表态** | 核实到硬事实：`character-pool.module.ts` 的 `readCharacterSource()` **缺省是 `db`**（builtin 只是回退/测试档）→ 生产角色走 DB 路径。若 DB 侧不表态，库里全是 DEFAULT 0.5/0 → **生产上本 WP 等于空转**，内测仍看到「回避型和安全型安全感一样」。§7 的「不做」解释为**不写一次性回填脚本** —— 补值靠既有幂等 upsert 自然完成（重跑 seed → hasDrift 命中 → UPDATE） |
| 3 | §3.5 只给了 2 个内置种子的值 | **4 个 DB 角色也给了** | 数值**抄 WP9-A 同风格内置种子的档位**（anxious 0.4/0.5、avoidant 0.25/0.05）—— 与本文件既有的 trust/阻抗/情绪口径完全一致（「抄 WP9-A 两个内置种子的档位」），不是逐角色另拍。⚠️ 工程种子值，非临床标定 |
| 4 | §3.1 / §3.2 基础字段可选 + 从 baseline 读 | **一致** | 回退口径**只留内核一处**（`?? DEFAULT_SAFETY`）。适配层用**条件展开**不兜默认值：`DEFAULT_SAFETY` 没从内核 barrel 导出，深路径 import 会把内核公开出口变成可有可无（WP9-A 文件头纪律）；且适配层再兜一份 = 两个真相源。条件展开还让「种子没说」与「种子说了 0」能区分开 |
| 5 | 任务单未提 `0` 的语义 | **单独钉住** | 回退用 `??`（只兜 null/undefined），所以 **0 是有效值**：角色明确给 0 不会被吞成 0.5 —— 语义反了就变成「完全不敢敞开心扉」=「安全感中等」。用例专门断言 |
| 6 | §3.7 resolver 传 safety / bond | **一致**（DB 侧**无条件**传） | DB 两列是 `NOT NULL DEFAULT`，「没值」在数据源上不可能发生 → 与 `trust` 同款直接传。**内存种子侧**才条件展开（种子可能真没给）—— 两侧口径不同是有意的 |
| 7 | §5.2 第 4 条「DTO 加两个字段」 | **做成**可选**（`@IsOptional()`） | 关键口径就是「可选字段，缺省 = 不传 = 用默认值」。做成必填会让既有 admin API 调用方全部编译不过 = 契约回归。`UpdateCharacterProfileDto` 由 `PartialType` 自动继承可选；admin service 的 create 用条件展开（没给 → 整列不出现 → DB DEFAULT）、update 用 `if (!== undefined)`（缺省 = 不改）—— 与 WP10A 表达风格三列同一口径 |
| 8 | §6.3 内核测试 3 条 | **扩到 12 例** | 补：两角色真的分得开 / 只给一半 / 三种缺省形态（无 profile、空 baseline、只给 trust）/ clamp 越界 / 非有限值落点 / **0 是有效值** / 快照字段集合逐字不变（给与不给完全一样） |
| 9 | §6.3 适配层测试 4 条 | **扩到 20 例** | 补：**全链测到内核快照**（内置种子 → profile → 快照；DB 行 → toCharacterSeed → profile → 快照 —— 单测"传了值"不够，中间隔着两段，断在任一段生产上就是"配了没生效"）/ entity 列定义 / **migration DDL 与 entity default 对着比** / 幂等 / 自愈 / down / **双登记** / resolver 唯一映射入口 / 临场 preset 不覆盖基线 |
| 10 | 任务单未提 `hasDrift` | **拆出 `hasOptionalColumnDrift` helper** | 加两个 `if` 后复杂度 **24 > 20**（eslint 上限）直接红。选「抽 helper」而不是 `eslint-disable` 抑制：抑制只是掐掉信号；抽 helper 后「可选列只在表态时才算漂移」这条口径**集中在一处**，将来加第 6 个可选列不用动主体。复杂度 24 → **14** / helper **11**，**行为零变化**（与 WP52 的 `orZero` 同一教训） |
| 11 | §4.5「要 migration」 | **一致** | 手写 DDL（`migration:generate` 扫不到本仓实体）+ INFORMATION_SCHEMA 逐列幂等守卫（缺才加）+ down 净删（缺列不炸）+ **双登记**（真注册点是 `bin/ormconfig.ts` 的 `migrations[]` 数组，漏登记会静默不建表） |
| 12 | §2.8 boundary 白名单 | **完全一致**（逐行核实） | `CharacterProfile`（第 282 行）/ `domain/character-profile.ts`（第 443 行）早已在列 → 接口内部加可选字段不需要新增 → `boundary.spec.ts` **12 例零改动**通过 |

> 本期**没做**的（按依恋风格自动推导 / Admin Dashboard 前端输入框 / 一次性回填脚本 / 临床校准）已在交付记录 §4 逐条留档。
>
> ⚠️ **部署顺序**：`pnpm migration:run`（加两列）**先**，再 `npm run seed:character-profiles`（补 4 个角色的值）。顺序反了 → `Unknown column 'baseline_safety'`。不跑 seed 也不炸，只是回到 0.5 / 0（效果没生效）。
