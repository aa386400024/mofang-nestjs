# WP51 交付记录 — 角色种子同盟三维基线

> 状态: ✅ 已交付
> 任务单: [`wp51-character-seed-alliance-baseline-2026-11-04.md`](wp51-character-seed-alliance-baseline-2026-11-04.md)
> 日期: 2026-11-04
> 红线: ⚠️ **engine-core 已改（预批准例外）** —— `git diff --stat HEAD -- src/engine-core` 含 **2 个文件**（`domain/character-profile.ts` + `domain/bootstrap.ts`），**无其他文件**

---

## 1. 实际改了哪些文件

### 1.1 内核（`src/engine-core/**`）：2 改（无新增文件）

| 文件 | 改了什么 |
|---|---|
| `src/engine-core/domain/character-profile.ts` | ① `CharacterProfile.baseline` 加 `safety?: number` / `bond?: number` 两个**可选**字段（各带口径注释：缺省 = 不传 = 内核默认值）；② 文件头加 WP51 段（为什么进 `baseline` 而不是 PersonalityModulator / 为什么是可选） |
| `src/engine-core/domain/bootstrap.ts` | ① `buildInitialSnapshot` 的 `safety` / `bond` 从 `clamp01(DEFAULT_*)` 改成 `clamp01(profile?.baseline?.safety ?? DEFAULT_SAFETY)` / `clamp01(profile?.baseline?.bond ?? DEFAULT_BOND)`；② WP42 那段「本期不接角色种子」的注释改成 WP51「已接入」；③ 文件头加 WP51 段（回退口径只留内核这一处） |

### 1.2 适配层：6 改 + 1 新增（migration）

| 文件 | 改了什么 |
|---|---|
| `src/engine-adapters/wiring/character/builtin-character-registry.ts` | ① `BuiltinCharacterSeed.baseline` 加 `safety?` / `bond?`；② `buildCharacterProfile` 用**条件展开**把种子值传进 `CharacterProfile.baseline`；③ 两个内置种子加值（回避型 0.25/0.05、焦虑型 0.4/0.5）；④ 文件头加 WP51 段 |
| `src/engine-adapters/wiring/character/character-profile.entity.ts` | ① 加 `baselineSafety` / `baselineBond` 两列（`float`，default 0.5 / 0）；② 文件头加 WP51 段（为什么这两列不是「纯预留」） |
| `src/engine-adapters/wiring/character/db-character-profile.resolver.ts` | `toCharacterSeed` 的 baseline 加 `safety: row.baselineSafety` / `bond: row.baselineBond` |
| `src/engine-adapters/wiring/character/character-profile.dto.ts` | ① `CreateCharacterProfileDto` 加 `baselineSafety?` / `baselineBond?`（`@IsOptional()` + `@Min(0)` + `@Max(1)`）；② `CharacterProfileAdminDto`（出参）加 `baselineSafety!` / `baselineBond!`；③ `UpdateCharacterProfileDto` 由 `PartialType` 自动继承可选 |
| `src/engine-adapters/wiring/character/character-profile.admin.service.ts` | ① `create` 用**条件展开**写入两列（没给 → 整列不出现 → 走 DB DEFAULT）；② `update` 两行 `if (!== undefined)`（缺省 = 不改）；③ `toAdminDto` 出参带上两列 |
| `src/engine-adapters/wiring/character/character-profile.seed.ts` | ① `CharacterProfileSeedSpec` / `CharacterProfileSeed` 加 `safety?` / `bond?`；② 4 个 DB 角色按 attachmentStyle **表态**（焦虑型 0.4/0.5、回避型 0.25/0.05）；③ `buildCharacterProfileSeeds` 条件展开；④ `toEntityPayload` 条件展开 + 返回类型加两列；⑤ `hasDrift` 拆出 `hasOptionalColumnDrift` helper（见 §2.7）；⑥ `validateSeedRanges` 加两列区间校验；⑦ 文件头加 WP51 段 |
| `src/migration/1714900000027-AddCharacterProfileAllianceBaseline.ts` | **新增**：手写 DDL 加两列（`baseline_safety FLOAT NOT NULL DEFAULT 0.5` / `baseline_bond FLOAT NOT NULL DEFAULT 0`）；幂等守卫（INFORMATION_SCHEMA 逐列判断，缺才加）+ 自愈 + down 净删 |

### 1.3 登记（硬约束 #1：真注册点是 `bin/ormconfig.ts`）

| 文件 | 改了什么 |
|---|---|
| `src/migration/index.ts` | 导出 `AddCharacterProfileAllianceBaseline1714900000027` + 说明注释 |
| `bin/ormconfig.ts` | import + `migrations[]` 数组**都**登记（只 import 不列 = 同样不执行） |

### 1.4 测试：2 新增

| 文件 | 改了什么 |
|---|---|
| `test/engine-core/wp51-character-seed-alliance-baseline.spec.ts` | **新建** **12 例**：角色给了就用角色的 / 两角色真的分得开 / 只给一半 / 没给走默认值（三种缺省形态）/ clamp 越界 / 非有限值落点 / **0 是有效值** / 既有维度不变 / 快照字段集合逐字不变 |
| `test/engine-adapters/wp51-character-seed-alliance-baseline.spec.ts` | **新建** **20 例**：内置种子 → profile → **内核快照**全链 / DB 行 → `toCharacterSeed` → profile → 快照全链 / resolver 唯一映射入口 / 种子表态口径 / entity 列定义 / **migration DDL 与 entity 对着比** / 幂等 / 自愈 / down / **双登记** |

### 1.5 文档

| 文件 | 改了什么 |
|---|---|
| `docs/worklog/pending/wp51-character-seed-alliance-baseline-2026-11-04.md` | 状态行改 `✅ 已交付` + 指向交付记录；追加「§9 交付后补记」偏差表 → 移入 `completed/phase2/` |
| `docs/worklog/pending/phase2-wp-list-2026-11-03.md` | WP51 行 ✅ + 交付记录链接；统计进度 11/35 → 12/35；engine-core 例外表 +WP51 行 |
| `docs/worklog/README.md` | Phase2 已开工列表 +WP51；进度回写 12/35；目录结构说明 +WP51 |

---

## 2. 关键设计决策（与任务单有出入的地方 + 为什么）

### 2.1 ⚠️ 最要紧的一条：DB 侧 4 个角色**本期必须表态** —— 否则生产上这个 WP 等于没做

任务单内部有两处表面冲突：

- §7 第 3 条：「**DB 里老角色数据补 safety / bond 值** —— 本期只加列，默认值就是现在的行为；老角色要不要补值，后续运营再定」；
- §5.2 第 6 条：「`character-profile.seed.ts` —— seed 数据同步加 `baselineSafety` / `baselineBond`」。

**本单按 §5.2 + §1.2 执行：DB 侧的 4 个角色本期表态。** 理由是核实到的一个硬事实：

```
character-pool.module.ts → readCharacterSource():
  缺省 = 'db'   ← 生产默认数据源
  'builtin'      ← 只是回退 / 测试档
```

也就是说 —— **生产上角色走的是 DB 路径**。若 DB 侧不表态，库里 4 个角色全是 `DEFAULT 0.5 / 0`：

- 内测看到的仍然是「回避型和安全型安全感一样」—— 正是 §1.2 要解决的问题**原封不动**；
- WP53 已经把人格调节算子扩到 safety / bond，但基线还是平的，调节再准也差不了多少；
- 换句话说，本单在生产上是**空转**。

**对 §7 第 3 条的解释**（写清楚，别在 review 时当成违规）：§7 说的「不做」指的是**不写一次性回填脚本**（那属于独立的运维动作）。补值靠本文件**既有的幂等 upsert** 自然完成 —— 重跑 `npm run seed:character-profiles` → `hasDrift` 命中 → UPDATE 两列。迁移只管 schema，数值归 seed（与 WP10A / 全仓库内容治理同范式）。

### 2.2 决策：数值口径**抄 WP9-A 同风格内置种子的档位**，不是逐角色另拍

本文件既有的口径白纸黑字：「基线数值口径: **抄 WP9-A 两个内置种子的档位** (anxious / avoidant 各一档) —— 这是**工程种子值, 不是临床标定**」。

4 个 DB 角色正好是 2 焦虑（晚晴 / 小满）+ 2 回避（亦舟 / 念安），与两个内置种子一一对应档位，所以 safety / bond 也抄同一档：

| 依恋风格 | safety | bond | 内置种子档位来源 |
|---|---|---|---|
| anxious（晚晴 / 小满） | 0.4 | 0.5 | `BUILTIN_ANXIOUS_LOW_MOOD_L1` |
| avoidant（亦舟 / 念安） | 0.25 | 0.05 | `BUILTIN_AVOIDANT_L1` |

⚠️ 全部是**工程种子值，非临床标定** —— 内测后按真实对练校准。

**为什么不按 attachmentStyle 自动推导**（任务单 §4.4，照做）：自动推导 = 在代码里硬编码一张映射表；而同样是回避型，不同角色的 safety 起点可以不一样（「创伤后回避」vs「天生疏离」）。让种子自己填，更符合「角色是独立个体」的设定。

### 2.3 决策：回退口径**只留内核一处**，适配层用**条件展开**（不兜默认值）

内核 `buildInitialSnapshot` 是唯一回退口径：

```ts
safety: clamp01(profile?.baseline?.safety ?? DEFAULT_SAFETY),
bond: clamp01(profile?.baseline?.bond ?? DEFAULT_BOND),
```

适配层 `buildCharacterProfile` 用条件展开：

```ts
...(seed.baseline.safety === undefined ? {} : { safety: clamp01(seed.baseline.safety) }),
...(seed.baseline.bond === undefined ? {} : { bond: clamp01(seed.baseline.bond) }),
```

**为什么不写成 `safety: clamp01(seed.baseline.safety ?? DEFAULT_SAFETY)`**：

1. `DEFAULT_SAFETY` / `DEFAULT_BOND` **没有从内核 barrel 导出**（barrel 只导出了 `CharacterProfile` 等类型）—— 深路径 import 一个「没导出」的常量会把内核的公开出口变成可有可无，这正是 WP9-A 文件头白纸黑字写明的纪律；
2. 内核兜一份、适配层再兜一份 = **两个真相源**，改一处漏一处（反双胞胎纪律）；
3. 条件展开还让「种子没说」与「种子说了 0」**能被区分开** —— 后者是真的 0（完全不敢敞开心扉），前者才走默认。

### 2.4 决策：`0` 是**有效值**，不是「没给」

回退用 `??`（只兜 null/undefined），所以角色明确给 0 不会被吞成 0.5。

这条值得单独钉，因为它一旦搞错**语义完全反了**：「完全不敢敞开心扉」会被变成「安全感中等」。用例专门断言 `buildInitialSnapshot(profile({ safety: 0 })).safety === 0` 且 `!== DEFAULT_SAFETY`。

### 2.5 决策：DB 侧 `toCharacterSeed` **无条件**传，内存种子侧**条件**展开

两侧口径不同，是**有意的**：

- **DB 侧**：两列是 `NOT NULL DEFAULT`，「没值」在数据源上不可能发生 → 直接传（与 `trust` 同款）；
- **内存种子侧**：种子可能真的没给 → 条件展开。

### 2.6 决策：DTO 两个字段做成**可选**，admin service 用「不出现」语义

- `CreateCharacterProfileDto.baselineSafety?` / `baselineBond?` 带 `@IsOptional()` —— 任务单关键口径就是「可选字段，缺省 = 不传 = 用默认值」。若做成必填，既有 admin API 调用方全部编译不过 = **契约回归**；
- `UpdateCharacterProfileDto extends PartialType(CreateCharacterProfileDto)` → 自动继承可选；
- `create` 用条件展开（没给 → 整列不出现 → INSERT 走 DB DEFAULT）；
- `update` 用 `if (!== undefined)`（缺省 = **不改**，不把运营标定好的值冲回默认）。

这套「undefined = 不出现」的口径与 WP10A 的表达风格三列**完全一致**，不是新发明。

### 2.7 决策：`hasDrift` 拆出 `hasOptionalColumnDrift` helper —— eslint 复杂度上限逼出来的，但顺带收紧了口径

加两个 `if` 之后 `hasDrift` 复杂度 **24 > 20**（上限），eslint 直接红。

**为什么选「抽 helper」而不是 `eslint-disable-next-line complexity`**（与 WP52 的 `orZero` 同一教训）：

- 抑制 lint 只是把信号掐掉，函数仍然是「18 条必填列 + 5 条可选列」混在一起的一长串；
- 抽 helper 后，「**可选列只在种子表态时才算漂移**」这条判定口径**集中在** `hasOptionalColumnDrift` 一处 —— 将来加第 6 个可选列不用再动主体，也不会出现「改了一处漏了另一处」；
- 复杂度：`hasDrift` 24 → **14**，`hasOptionalColumnDrift` → **11**（两个都远低于上限）。

**行为零变化**：条件与顺序逐条照搬，漂移判定口径一个字没改。

### 2.8 决策：DB 默认值与**内核常量对齐**

`baseline_safety` DEFAULT 0.5 = 内核 `DEFAULT_SAFETY`；`baseline_bond` DEFAULT 0 = 内核 `DEFAULT_BOND`。

理由：DB 默认值与内核默认值必须是**同一个口径** —— 否则会出现「库里是 0.5、内核兜底是 0.3」这种静默分裂，且两边都不报错。

（与既有的 `baseline_trust` default 0.3 = `DEFAULT_TRUST` 同一套路。）

### 2.9 决策：migration 照 WP10A `AddCharacterProfileExpressionFields` 同款守卫，并**双登记**

- 手写 DDL（仓库 60+ 条 migration 历来手写；`migration:generate` 扫不到 counselor 系实体）；
- **幂等**：每列加之前先查 INFORMATION_SCHEMA，缺才加 —— 重复跑 up 不报错，半途中断后重跑能补齐；
- `down` 净删两列，且缺列时不炸；
- **`src/migration/index.ts` + `bin/ormconfig.ts` 双登记** —— 硬约束 #1：真注册点是 `bin/ormconfig.ts`（import + `migrations[]` 数组），漏登记会**静默不建表**。用例 ⑳ 直接读两个文件对着断言（含「数组里必须真的列上」）。

### 2.10 boundary 白名单**无需新增条目**

`CharacterProfile`（第 282 行）与 `domain/character-profile.ts`（第 443 行）**早已在列** —— 接口内部加可选字段不需要新增白名单条目。`boundary.spec.ts` **12 例零改动**通过。

### 2.11 部署顺序（写在这里，别在部署时踩）

1. **先** `pnpm migration:run` —— 加两列（存量行自动是 0.5 / 0，行为与加列前逐字一致）；
2. **再** `npm run seed:character-profiles` —— 把 4 个角色的值补上（幂等 upsert）。

⚠️ **顺序反了会报错**：entity 加了列 → resolver 的 `SELECT` 就带上这两列 → migration 没跑就查 → `Unknown column 'baseline_safety'`。这是加列类迁移的固有代价，与仓库既有 ALTER 迁移（0019 / 0022 / 0024）同款。

⚠️ 不跑 seed 也不会炸 —— 只是 4 个角色回到 0.5 / 0（本 WP 的效果没生效）。

---

## 3. 闸门数字

| 闸门 | 结果 |
|---|---|
| `npx eslint "src/**/*.ts" "test/**/*.ts" "bin/**/*.ts"` | **0 error**（exit 0） |
| `npx tsc -p tsconfig.build.json --noEmit` | **0 error**（exit 0） |
| `npx vitest run --exclude '**/e2e/**/*.ts'` | **97 个测试文件 / 1520 例全绿**（WP50 基线 95 文件 / 1488 例 + 本轮新增 **2 文件 / 32 例**，**零回归**：1488 + 32 = 1520 ✓） |
| `npx vitest run test/engine-core/wp51-…spec.ts` + `test/engine-adapters/wp51-…spec.ts` + `boundary.spec.ts` | **44 例全绿**（本轮新增 **32 例**：内核 12 + 适配层 20；boundary 12 例零改动） |
| `git diff --stat HEAD -- src/engine-core` | **2 个文件**（`domain/character-profile.ts` + `domain/bootstrap.ts`）—— **正是任务单 §6.2 要求的范围，无其他** |

**回归确认**：

- **不提供 safety / bond** → 内核走默认值 0.5 / 0（三种缺省形态都验过：无 profile / 空 baseline / 只给 trust）；
- **越界值** → clamp 到 [0,1]（与 trust 同一口径）；
- **非有限值** → 落点 0（`clamp01` 的既有落点，与 trust 一致，不静默换成「看起来正常」的默认值）；
- **0 是有效值** → 不被当成「没给」；
- **既有维度** → trust / resistance / emotion / transference 的装配口径一个字没改；
- **快照字段集合** → 逐字不变（给与不给 safety / bond，键集合完全一样）；
- **种子没说 vs 种子说 0** → 键是否存在能区分（`'safety' in baseline`）；
- **临场 preset 不覆盖基线** → safety / bond 与 trust 同款（「角色本来是什么样」不是旋钮）；
- **resolver 仍是唯一映射入口** → 不在 resolver 里另写一份公式；
- **seed 漂移检测** → 只在种子表态时才算漂移（没表态的行，库里是什么就是什么）；
- **DB 默认值 == 内核常量** → 0.5 / 0 两边对着比（migration DDL 与 entity default 双向断言）；
- **migration** → 幂等 / 半途中断自愈 / down 净删 / 双登记，四条都验；
- **既有测试** → WP9-A / WP9-B / WP10A / WP42 全部保留（只加文件，未改任何既有断言）。

---

## 4. 本期**没做**的（明确留给后续，别当漏做）

1. **按依恋风格自动推导 safety / bond**（任务单 §7 第 1 条）—— 本期让种子自己填；自动推导作为后续优化。
2. **Admin Dashboard 编辑角色时加 safety / bond 输入框**（任务单 §7 第 2 条）—— 那是前端的事，本期只做后端。
3. **一次性回填脚本**（任务单 §7 第 3 条的「不做」部分）—— 补值靠幂等 seed 重跑自然完成，不写独立回填脚本。
4. **safety / bond 基线的临床校准**（任务单 §7 第 4 条）—— 本期是工程种子值，内测后按真实对练校准。

---

_创建：2026-11-04_
_深度通知：任务单 §2.2（bootstrap 现状）/ §2.3（CharacterProfile.baseline）/ §2.4（BuiltinCharacterSeed.baseline）/ §2.5（内置角色种子）/ §2.6（Entity）/ §2.7（resolver）/ §3.1–§3.7（本期做什么）/ §4.1–§4.5（边界问题补充）/ §5.1–§5.3（边界约束）/ §6.1–§6.3（验收与用例要求）逐条核实 + 真实代码 grep（`buildInitialSnapshot` 调用点 / `profile.baseline` 消费点 / 生产角色数据源 `readCharacterSource` / `bin/ormconfig.ts` 真注册点 / WP10A migration 守卫范式 / 内核 barrel 是否导出 `DEFAULT_SAFETY`）_
