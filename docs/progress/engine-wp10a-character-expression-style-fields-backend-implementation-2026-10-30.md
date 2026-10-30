# WP10A · character_profiles 表达风格基线字段预留 · 后端交付记录

> 任务单: [`engine-wp10a-character-expression-style-fields-backend-2026-10-30.md`](./engine-wp10a-character-expression-style-fields-backend-2026-10-30.md)
> 前置: [WP9-B（`character_profiles` 表）](./engine-wp9b-db-character-pool-backend-implementation-2026-10-29.md) / [WP10（伦理盲盒剧本）](./engine-wp10-ethical-blindbox-scripts-backend-implementation-2026-10-30.md)
> 仓库: `E:\Work\Project\backend\mofang-nestjs` ｜ 日期: 2026-10-30

---

## 0. 一句话结论

**任务单 §1 的四小节全部落地**：`character_profiles` 加 3 列（`speech_volume_baseline` FLOAT 默认 0.5 / `narrative_style` VARCHAR(20) 默认 `'mixed'` / `expression_tone` VARCHAR(20) 默认 `'restrained'`），**手写幂等 migration**（存量行由 DB DEFAULT 自动填充，**一条 UPDATE 都不写**），entity 补三个 `@Column`，seed 里**拿不准的留默认值** —— 落法是「**键不存在 = 走 DB DEFAULT**」，seed 不抄第二份默认值。

**这一轮真正的设计点不是"加三列"，是"默认值只有一处真相（DDL）"**：任务单 §1.4 写的是「拿不准的留默认值 `0.5 / 'mixed' / 'restrained'`」，字面照抄会在 seed 里存一份默认值副本 —— 于是有两条路径会把库里 Phase2 P1 标定好的值冲回默认：① seed 重跑时把默认值又写一遍；② 将来改 DDL 默认值，seed 里的副本静默漂移。本轮的落法是**种子没表态就不写该列**（键根本不存在）→ INSERT 走 DB DEFAULT、UPDATE 整列不碰。

**红线全部守住**：`src/engine-core/` 整树零改动（`git diff --stat HEAD -- src/engine-core` **为空**）；**不写消费逻辑**（三列不进内核 `CharacterProfile`、不进 `RenderSpec`、不影响会话行为）；**不改 resolver 映射**；**不暴露给前端 DTO**。

**闸门**：`tsc -p tsconfig.build.json` **0 错** / eslint **0 error 0 warning** / `jest test/engine-adapters test/engine-core test/voice` **26 套件 512 例全绿** / 全量 `npm test` **55 套件 836 例中 834 例通过**，唯一失败仍是 `drill-judge.spec.ts` 的 2 例既有债。**外加真库实测**（dev 库 `mofang_dev`）：migration up / 幂等 / 半途中断自愈 / down 缺列不炸 / revert 回 21 列 / 再 up 回 24 列，全绿。

---

## 1. §1.1 三列定义（1:1 落地，0 自由发挥）

| 列名 | 类型 | 默认值 | 语义 | 实体属性 |
|---|---|---|---|---|
| `speech_volume_baseline` | `FLOAT` | `0.5` | 话量基线 [0,1]（0=极沉默/长停顿，1=絮叨/长篇大论）。与 `baseline_resistance_verbal` **正交** | `speechVolumeBaseline: number` |
| `narrative_style` | `VARCHAR(20)` | `'mixed'` | 叙事逻辑风格：`structured` / `disorganized` / `mixed` | `narrativeStyle: CharacterNarrativeStyle` |
| `expression_tone` | `VARCHAR(20)` | `'restrained'` | 语态倾向：`restrained` / `emotional` / `intellectualizing` / `passive_aggressive` | `expressionTone: CharacterExpressionTone` |

**"正交"这件事为什么必须写进注释**：任务单 §1.1 明确 `speech_volume_baseline` 与 `baseline_resistance_verbal` 正交 —— verbal 阻抗是"不信任、不愿暴露"，话量基线是"天然性格话多话少"。两者会**同时反向变化**（话多但不愿说 / 话少但很能说）。合成成一个维度 = 把"防御性沉默"和"气质性沉默"混成同一种人。这条口径已写进 entity 字段注释，并且**成为本轮 seed 不给任何角色填话量基线的直接理由**（见 §4.3）。

**两个字符串联合类型建在 entity 文件里**（`CharacterNarrativeStyle` / `CharacterExpressionTone`），不用 `enum`：

- 它们是**纯数据判别式**，不需要运行时值（与同文件既有的 `CharacterAuditStatus` 同款口径）；
- `enum` 会生成运行时对象 → 进 DDL 时还要写 `enumType`；纯字符串联合直接落 `varchar(20)`，与任务单 §1.1 的列定义逐字对齐。

---

## 2. §1.2 migration（手写 DDL，禁 synchronize）

**文件**：`src/migration/1714900000025-AddCharacterProfileExpressionFields.ts`
**类名**：`AddCharacterProfileExpressionFields1714900000025`

### 2.1 DDL 逐字

```sql
ALTER TABLE character_profiles ADD COLUMN speech_volume_baseline FLOAT NOT NULL DEFAULT 0.5 AFTER baseline_emotion_arousal;
ALTER TABLE character_profiles ADD COLUMN narrative_style        VARCHAR(20) NOT NULL DEFAULT 'mixed'      AFTER speech_volume_baseline;
ALTER TABLE character_profiles ADD COLUMN expression_tone        VARCHAR(20) NOT NULL DEFAULT 'restrained' AFTER narrative_style;
```

三条全部 `NOT NULL` + `DEFAULT` → **存量行在 MySQL 里被直接填成 DEFAULT（不是 NULL）**，所以 WP9-B seed 灌进来的 4 个 vpt slug 行，**一条 UPDATE 都不写**就拿到了默认值（真库实测见 §8.2）。

### 2.2 幂等守卫：`EXPRESSION_COLUMNS` 常量驱动，逐列判断

```ts
const EXPRESSION_COLUMNS: readonly ExpressionColumnSpec[] = [
  { column: 'speech_volume_baseline', ddl: 'speech_volume_baseline FLOAT NOT NULL DEFAULT 0.5 AFTER baseline_emotion_arousal' },
  { column: 'narrative_style',        ddl: "narrative_style VARCHAR(20) NOT NULL DEFAULT 'mixed' AFTER speech_volume_baseline" },
  { column: 'expression_tone',        ddl: "expression_tone VARCHAR(20) NOT NULL DEFAULT 'restrained' AFTER narrative_style" },
];
```

`up` 先查 `INFORMATION_SCHEMA.COLUMNS`（`TABLE_SCHEMA = DATABASE()`），**缺才加**；`down` 同样查，**只删存在的列**。

**为什么把列定义收成常量而不是散在三个 `qr.query` 里**：幂等守卫要**逐列**判断"在不在"，DDL 也要**逐列**执行 —— 同一份列清单驱动两件事，才不会出现"守卫查了列 A、DDL 加了列 B"这种静默漂移。守卫与 DDL 必须是**同一份真相**。

### 2.3 四个"仓库硬约束"的落法

| 约束 | 本轮落法 |
|---|---|
| **不用 `migration:generate`** | `bin/ormconfig.ts` 的 entities glob 只覆盖 `src/entity/**`，扫不到本仓实体 → generate 出来是空壳。仓库 60+ 条 migration 历来手写 DDL，本条保持一致 |
| **禁 `synchronize`** | schema 只走 migration（ADR-0003） |
| **不改已执行过的迁移** | 0013 / 0023 / 0024 等已在 dev 库跑过的**一行不动** —— 迁移只增不改 |
| **不加索引** | 这三列本期不参与任何查询（resolver 主查询路径仍是 `template_id` + `audit_status`/`enabled`）→ 加索引是给"还没人查的字段"做优化，属过度工程 |

另外：**不加 DB 级 FK / 不落 `tenant_id`**（system 级资产，与 0023 同款）；**不把内容写进 migration**（表达风格是内容资产，归 seed 脚本，migration 只改 schema）。

### 2.4 部署顺序（重要）

entity 加了列 → resolver 的 `SELECT` 会带上这三列 → **必须先 `migration:run` 再起服务**，否则查询报 `Unknown column 'speech_volume_baseline'`。这是加列类迁移的固有代价，与仓库既有 ALTER 迁移（0019 / 0022 / 0024）同款。已写进 migration 头注释与 `bin/ormconfig.ts` 登记注释。

---

## 3. §1.3 entity 补三个 `@Column`

`src/engine-adapters/wiring/character/character-profile.entity.ts`：

```ts
@Column({ type: 'float', name: 'speech_volume_baseline', default: 0.5 })
speechVolumeBaseline!: number;

@Column({ type: 'varchar', length: 20, name: 'narrative_style', default: 'mixed' })
narrativeStyle!: CharacterNarrativeStyle;

@Column({ type: 'varchar', length: 20, name: 'expression_tone', default: 'restrained' })
expressionTone!: CharacterExpressionTone;
```

### 3.1 为什么属性设成**必填**（`!: number`），而不是 `?: number`

列是 `NOT NULL DEFAULT` → 真实行里**永远有值**，标成可选等于给未来接线留 `undefined` 陷阱（Phase2 P1 消费时每一处都要判空），同时会**引入第二份默认值**（属性上的 `?` + 缺省语义 = "可能是 0.5 也可能是 undefined"）。

代价是：既有测试的 `buildRow` helper 构造的是"真实行的形状"，必须补齐这三列。**改 helper 而不是把属性改成可选** —— 前者让"真实行一定有这三列"这件事在类型层就成立。

### 3.2 entity 与 migration 两边的默认值**对着比**

加列这件事最典型的失败模式是**两边不一致**：entity 写 `default: 0.5`、migration 写 `DEFAULT 0.6`（或反过来）—— 代码不报错、测试也绿，直到线上某天 seed 灌进去一个 0.6 的行才发现"entity 说的是 0.5"。

所以单测**不是各断言一次，而是把两边对着比**（见 §8.1 用例 ④）。entity 侧的 `default` 在本仓实际不参与建表（synchronize 禁用，schema 只走 DDL），但它会参与 TypeORM 的 INSERT 默认值推导 —— 所以两边必须一致。

---

## 4. §1.4 seed 默认值（拿不准的留默认值）

`src/engine-adapters/wiring/character/character-profile.seed.ts`，三处落法：

| 位置 | 落法 |
|---|---|
| `CharacterProfileSeedSpec` | 三个**可选**字段：`speechVolumeBaseline?` / `narrativeStyle?` / `expressionTone?` |
| `buildCharacterProfileSeeds` | 条件展开：`...(spec.x === undefined ? {} : { x: spec.x })` —— **键不存在**，不是 `undefined` 值 |
| `toEntityPayload`（灌库载荷） | 同上条件展开 |

### 4.1 「留默认值」= 键不存在（走 DB DEFAULT），不是显式写一份默认值

**这是本轮的核心判断。** 任务单原文是「拿不准的留默认值 `0.5 / 'mixed' / 'restrained'`」—— 字面照抄意味着在 seed 里存一份默认值副本，于是有两条路径会把库里标定好的值冲回默认：

1. **seed 重跑**：seed 无条件写 `speechVolumeBaseline: 0.5` → Phase2 P1 在库里标定成 0.8 的行，下次跑 seed 就被写回 0.5；
2. **改 DDL 默认值**：将来把默认话量改成 0.6，seed 里的副本静默漂移 —— 两处默认值不一致，且没有任何测试会红。

本轮的落法：**种子没表态 → 该键根本不出现**。于是：

- **INSERT**：TypeORM `InsertQueryBuilder` 对 `undefined` 的属性写 `DEFAULT`（源码实证），落到 DDL 里的默认值；
- **UPDATE**：`UpdateQueryBuilder` 明确注释「it doesn't make sense to update undefined properties, so just skip them」→ 整列不碰。

结论：**默认值只有 DDL 一处真相**。而"键不存在"这个语义**必须同时落在 spec → seed 行 → 灌库载荷三段**，只落一段就等于半吊子（行里有键、载荷里没有 → INSERT 走 DEFAULT；行里有键、载荷里有 `undefined` → 视 TypeORM 版本而异）。

### 4.2 `hasDrift` 只在种子表态时比对

```ts
if (payload.speechVolumeBaseline !== undefined && row.speechVolumeBaseline !== payload.speechVolumeBaseline) return true;
```

种子没表态的行，**库里是什么就是什么** —— Phase2 P1 标定过的值不该被 seed 判成"漂移"然后被覆盖。若不这么写：seed 没表态 → 库里是标定值 → 判漂移 → `repo.update` 写一遍（哪怕载荷里是 undefined，UPDATE 也会整列跳过，但**"有漂移"的判断本身已经错了**，会污染 seed 脚本的统计口径）。

### 4.3 判定口径：只认该角色**自己的既有数据**是否明文写出该特质

不是"我们对这个角色的主观印象"。本轮逐个查 4 个 vpt slug 角色自己的 slug 与 5Ps 原文：

| 角色 | template_id | 既有数据里的明文 | 本轮表态 |
|---|---|---|---|
| 小满 | `vpt_self_worth_intellectualization_l1` | slug 直接含 `intellectualization`；5Ps 写着「用'我可以做得更好'压住被否定的感受」 | `expressionTone: 'intellectualizing'` |
| 亦舟 | `vpt_workplace_intellectualization_l1` | slug 直接含 `intellectualization`；5Ps 写着「用讲道理替代表达情绪、把感受分析成问题清单」 | `expressionTone: 'intellectualizing'` |
| 晚晴 | `vpt_intimate_avoidance_l1` | 既有数据未写明理智化 | **不表态**（走 DEFAULT `'restrained'`） |
| 念安 | `vpt_grief_avoidance_l1` | 既有数据未写明理智化 | **不表态**（走 DEFAULT `'restrained'`） |
| 全部 4 个 | — | 没有任何既有数据说明话量基线 / 叙事风格 | **一律不表态** |

**为什么 `speech_volume_baseline` 全员不表态**：任务单 §1.1 明确它与 `baseline_resistance_verbal` **正交** —— "不信任不愿暴露"推不出"天然性格话少"。晚晴的 verbal 阻抗高，既可能是防御性沉默（话少是因为不愿说），也可能是气质性话少（本来就话少）—— 正是这个字段存在的理由（把两者分开），所以**从阻抗推导话量基线是本字段要消灭的错误**。拿不准 → 留默认。

**为什么 `narrative_style` 全员不表态**：4 个角色的既有数据里没有"条理清晰 / 话题跳跃"的明文描述。

### 4.4 数值区间自检补话量基线

`validateSeedRanges` 增加（**只在表态时校验** —— 没表态就没有值可越界）：

```ts
if (spec.speechVolumeBaseline !== undefined && (spec.speechVolumeBaseline < 0 || spec.speechVolumeBaseline > 1)) {
  return `角色 ${spec.templateId} 的话量基线越界: ${spec.speechVolumeBaseline}`;
}
```

---

## 5. §2「不做」逐条核对（红线）

| 任务单 §2 的「不做」 | 本轮核对结果 |
|---|---|
| 不改 engine-core（`CharacterProfile` 纯层不加字段） | ✅ `git diff --stat HEAD -- src/engine-core` **为空** |
| 不写渲染层消费逻辑（spec-assembler / render-prompt 不读这三字段） | ✅ 零改动；单测 ⑬ 断言 resolver 映射输出**不含**这三列 |
| 不改 resolver 映射（`buildCharacterProfile` 不透传） | ✅ `toCharacterSeed` 零改动；单测 ⑬ 钉死 |
| 不改 admin API / DTO（不暴露给前端） | ✅ `character-profile.dto.ts` 零改动；单测 ⑭ 断言 DTO 文件**不含**这三个属性名 |
| 不做话题回避/答非所问/重复叙述等行为策略字段 | ✅ 未加任何行为模式字段（那是剧本节点 delta 的事） |
| 不加 participants[] / suspend 枚举 / 事件总线 / 权限位 | ✅ 未加 |

**"不消费"这一条是能自动验的**：`toCharacterSeed` 是 resolver 的**唯一**映射入口，断言它的输出里不含这三字段，等于物理证明"这三列没进内核" —— 不用去读人肉 diff。这是本轮红线最有价值的一条单测。

---

## 6. §3 验收对照

| # | 任务单 §3 验收项 | 本轮状态 |
|---|---|---|
| 1 | migration 可跑（up/down） | ✅ **真库实测**（见 §8.2）：up 成功 / 幂等再跑 "No migrations are pending" / revert 回 21 列 / 半途中断自愈 / down 缺列不炸 / 再 up 回 24 列 |
| 2 | tsc 0 错 / eslint 0 | ✅ `tsconfig.build.json` 0 错；eslint exit 0（0 error 0 warning） |
| 3 | 既有 seed 角色不受影响（resolver 返回的 `CharacterProfile` 与改动前逐字一致） | ✅ 三列不进内核 → resolver 输出逐字不变；单测 ⑬ 钉死。**且真库实测**：seed 跑完 `新增 0 / 更新 2 / 未变 2`，其中"更新 2"**只动 `expression_tone` 一列**，其余 23 列零改动 |
| 4 | `DESCRIBE character_profiles` 三列存在且默认值正确 | ✅ **真库实测**：24 列（21+3），三列 `null=NO`，default 分别为 `0.5 / mixed / restrained`；存量 4 行被 DEFAULT 自动填成 `0.5 / mixed / restrained` |
| 5 | jest 全绿（既有 1 套件 2 例失败 = drill-judge 既有债） | ✅ 全量 **55 套件 / 836 例：834 通过**，唯一失败 = `test/counselor/drill-judge.spec.ts` 2 例既有债 |

---

## 7. 与任务单的差异（显式说明）

| # | 任务单原文 | 本轮落法 | 理由 |
|---|---|---|---|
| 1 | §1.4「拿不准的留默认值 `0.5 / 'mixed' / 'restrained'`」 | **键不存在 = 走 DB DEFAULT**，seed 里不抄第二份默认值 | 字面照抄会有两条路径把库里标定好的值冲回默认（seed 重跑 / 改 DDL 后副本漂移）。默认值只有 DDL 一处真相。语义上仍严格满足"拿不准的留默认值" |
| 2 | §1.4「如果已有明确的表达风格设定就填上对应值」 | 判定口径收紧为「**该角色自己的既有数据**（slug / 5Ps 原文）是否明文写出该特质」→ 仅 2/4 角色的 `expressionTone` 表态；`speechVolumeBaseline` / `narrativeStyle` **全员不表态** | 任务单说"如果已有明确的设定" —— 什么是"明确"必须落成可核验的口径，否则就是主观印象进库。`speech_volume_baseline` 与 verbal 阻抗正交，从阻抗推导正是本字段要消灭的错误 |
| 3 | §1.1 表里 `speech_volume_baseline` 标注 `float [0,1]` | `[0,1]` 落成**语义范围**（注释 + seed 侧 `validateSeedRanges` 校验），**不加 DB CHECK 约束** | 任务单 §1.1 的类型列写的是 `float`，`[0,1]` 是取值语义不是列类型；加 CHECK 会给"还没人写的列"加写锁与运维成本，属过度工程。seed 侧校验已能挡住灌库越界 |
| 4 | §1.2 只写「`ALTER TABLE ... ADD COLUMN` / 三列 `DEFAULT` + `NOT NULL`」 | 额外加**逐列 `INFORMATION_SCHEMA` 幂等守卫**（up / down 双侧） | 跟 WP19 `AddTurnDebugTrace` 同款。半途中断可自愈、重复跑不报错 —— 加列类迁移最容易写错的地方。已真库实测（§8.2 ③④） |
| 5 | 未指定 entity 属性必填 / 可选 | 选**必填**（`!: number` / `!: 联合类型`），并更新既有测试 helper `buildRow` | `NOT NULL DEFAULT` 的列在真实行里永远有值；标可选等于给 Phase2 P1 留 `undefined` 陷阱 + 第二份默认值 |
| 6 | §3 验收只列「migration 可跑（up/down）」「DESCRIBE」 | 额外实测：**框架级幂等 / 半途中断自愈 / down 缺列不炸 / seed 连跑幂等 / seed 只动一列** | 加列类迁移的失败模式不止"能不能跑"，还包括"重跑会不会炸""半途中断能不能自愈""seed 会不会把别的列冲掉" |

---

## 8. 闸门实测结果

### 8.1 代码闸门

```
npx tsc -p tsconfig.build.json --noEmit                                    → 0 错
npx tsc -p tsconfig.json --noEmit（含 test/）                               → 41 个既有债报错，本轮文件零报错（见 §8.3）
npm run lint                                                                → exit 0（eslint 0 error 0 warning）
npx jest test/engine-adapters test/engine-core test/voice                   → 26 套件 / 512 例全绿
npx jest test/engine-adapters/wp10a-character-expression-fields.spec.ts    → 14/14 通过
npm test（全量）                                                            → 55 套件：54 套件 834 例通过，1 套件 2 例失败（见 §8.4）
git diff --stat HEAD -- src/engine-core                                     → 空（内核整树零改动）
git status --porcelain -- src/counselor/drills                              → 空（drills 零改动）
```

**本轮新增单测 14 例（`test/engine-adapters/wp10a-character-expression-fields.spec.ts`）**：

| 组 | 断言 |
|---|---|
| entity 列定义（2 例） | 三列的列名/类型/长度/默认值与任务单逐字一致；属性名与 DB 列名是显式映射（不靠驼峰自动推导） |
| migration（6 例） | 空表 → 3 条 ADD COLUMN 且 DDL 默认值与 entity 一致；**两边默认值对着比**（漂移即红）；幂等（三列都在 → 一条 ALTER 都不发）；半途中断只加缺的那一列；down 净删三列且缺列不炸；**在 `src/migration/index.ts` 与 `bin/ormconfig.ts` 严格 1:1 登记**（漏登记 = 永不执行） |
| seed 表态口径（3 例） | 只有"既有数据自己就写明了该特质"的角色才表态；话量基线/叙事风格全部不表态；种子构建出的行**键不存在**（不是 `undefined` 值） |
| 灌库载荷语义（1 例） | INSERT 载荷里不表态的列**整列不出现**（DB DEFAULT 生效） |
| 红线（2 例） | resolver 映射输出不含三列；前端 DTO 文件不含三个属性名 |

**migration 为什么用假 `QueryRunner` 跑一遍而不是只读源码**：只读源码只能断言"文件里有没有这串字"；跑一遍能断言**真的发出去的 DDL** —— 包括"列已存在时一条 ALTER 都不发"这条幂等语义（这是 migration 最容易写错的地方）。

### 8.2 真库实测（dev 库 `mofang_dev`，`117.72.30.78:3306`）

`migration:show` 确认**只有本轮这一条待执行**（其余 64 条全 `[X]`），所以 `migration:run` 精确命中本轮迁移，不会误伤其他 schema。

| 步骤 | 操作 | 实测结果 |
|---|---|---|
| ① | `npm run migration:run` | ✅ 三条 `ALTER TABLE ... ADD COLUMN` 依次发出，迁移执行成功 |
| ② | `DESCRIBE character_profiles` | ✅ **24 列**（21 + 3）；三列 `Null=NO`，`Default` 分别为 `0.5` / `mixed` / `restrained` |
| ③ | `SELECT` 三列 | ✅ **存量 4 行全部被 DEFAULT 自动填成 `0.5 / mixed / restrained`** —— **零 UPDATE** |
| ④ | 再跑 `npm run migration:run` | ✅ `No migrations are pending`（框架级幂等） |
| ⑤ | `npm run seed:character-profiles` | ✅ `新增 0 / 更新 2 / 未变 2（合计 4）` —— "更新 2"**只动 `expression_tone` 一列**（小满 / 亦舟 → `intellectualizing`），其余 23 列零改动 |
| ⑥ | seed 连跑第二次 | ✅ `新增 0 / 更新 0 / 未变 4` —— **seed 幂等** |
| ⑦ | `npm run migration:revert` | ✅ 回滚成功；`DESCRIBE` 回 **21 列**；存量 4 行**仍在**（数据零丢失） |
| ⑧ | 手工只加第 1 列（模拟半途中断）→ `migration:run` | ✅ **只发出 2 条 ALTER**（跳过已存在的 `speech_volume_baseline`）→ 守卫自愈 |
| ⑨ | 手工删掉 `expression_tone` → `migration:revert` | ✅ **回滚仍成功**（down 缺列不炸） |
| ⑩ | `migration:run` + seed（恢复终态） | ✅ 回到 24 列；小满 / 亦舟 = `intellectualizing`，晚晴 / 念安 = `restrained`（默认），话量基线全 `0.5`、叙事风格全 `mixed` |

**最终库态**（dev 库当前状态，已恢复正确）：

```
列数 = 24
  speech_volume_baseline | float        | null=NO | default=0.5
  narrative_style        | varchar(20)  | null=NO | default=mixed
  expression_tone        | varchar(20)  | null=NO | default=restrained
  {"template_id":"vpt_grief_avoidance_l1","speech_volume_baseline":0.5,"narrative_style":"mixed","expression_tone":"restrained"}
  {"template_id":"vpt_intimate_avoidance_l1","speech_volume_baseline":0.5,"narrative_style":"mixed","expression_tone":"restrained"}
  {"template_id":"vpt_self_worth_intellectualization_l1","speech_volume_baseline":0.5,"narrative_style":"mixed","expression_tone":"intellectualizing"}
  {"template_id":"vpt_workplace_intellectualization_l1","speech_volume_baseline":0.5,"narrative_style":"mixed","expression_tone":"intellectualizing"}
```

### 8.3 `npx tsc -p tsconfig.json --noEmit`（含 `test/`）的报错 = **仓库既有债**

```
test/e2e/knowledge-search.e2e-spec.ts   13 个（TS2307 模块不存在: ../src/... 相对路径从 test/e2e/ 解析不到）
test/good-state-diary.e2e-spec.ts       28 个（TS4111 / TS2352 / TS2349 supertest 类型）
```

两个文件引用了**不存在的模块**，是早于本轮的失效 e2e。本轮未碰这两个文件，也没为了消报错去动它们。生产构建口径 `tsconfig.build.json` **0 错**；本轮新增 + 修改的 spec 文件在全量 `tsconfig.json` 口径下**零报错**。（与 WP9-C / WP10 交付记录里登记的完全一致。）

### 8.4 全量 jest 唯一的失败：`test/counselor/drill-judge.spec.ts` 2 例 = **既有债**

```
● boundary 三档判定 › 否定守卫: 命中词前有否定字时该次命中不计入, 但同词后面的未否定出现仍计入
    Expected: "我加你"   Received: null
● crisis 判定 › 评判式回应 → 不评判锚点未覆盖, 且给"这里可以多问一句"方向提示
    Expected substring: "多问一句"   Received: "出现了「别想太多」这类措辞 —— …"
```

该套件**只 import `src/counselor/drills/**`**，与本轮改动的 `src/engine-adapters/wiring/character/**` + `src/migration/**` **零交集**；本轮**一行未碰** `src/counselor/drills/**`。按任务单"既有债不擅自修"处理。

---

## 9. 改动面清单

### 9.1 新增文件（2）

| 文件 | 职责 |
|---|---|
| `src/migration/1714900000025-AddCharacterProfileExpressionFields.ts` | 手写 DDL + 逐列 `INFORMATION_SCHEMA` 幂等守卫（up/down 双侧）+ `EXPRESSION_COLUMNS` 单一列清单真相 |
| `test/engine-adapters/wp10a-character-expression-fields.spec.ts` | entity 列定义 / migration DDL 与幂等 / 1:1 登记 / seed 表态口径 / 灌库载荷语义 / 红线（14 例） |

### 9.2 修改文件（5）

| 文件 | 改动 |
|---|---|
| `src/engine-adapters/wiring/character/character-profile.entity.ts` | 3 个 `@Column` + 2 个字符串联合类型 + 文件头 WP10A 段落 + 字段注释（含"与 verbal 阻抗正交"口径） |
| `src/engine-adapters/wiring/character/character-profile.seed.ts` | `CharacterProfileSeedSpec` / `CharacterProfileSeed` 加 3 个可选字段；`buildCharacterProfileSeeds` / `toEntityPayload` 条件展开；`hasDrift` 仅表态时比对；`validateSeedRanges` 增话量基线 [0,1]；小满 / 亦舟表态 `expressionTone: 'intellectualizing'` |
| `src/migration/index.ts` | 导出 `AddCharacterProfileExpressionFields1714900000025`（与 `bin/ormconfig.ts` 严格 1:1） |
| `bin/ormconfig.ts` | import + `migrations[]` 数组登记（仓库硬约束：真注册点在这里） |
| `test/engine-adapters/wp9b-db-character-resolver.spec.ts` | `buildRow` 补 3 个字段（`seed.X ?? DB 默认`）以适配 entity 必填属性 —— **只补形状，不改断言口径** |

### 9.3 红线核对

| 红线 | 核对结果 |
|---|---|
| 不改 `src/engine-core/**` | ✅ `git diff --stat HEAD -- src/engine-core` 为空 |
| 不写字段消费逻辑（不进内核 / 不进 RenderSpec） | ✅ 三列零消费；单测 ⑬ 断言 resolver 映射输出不含三列 |
| 不改 resolver 映射 | ✅ `toCharacterSeed` / `buildCharacterProfile` 零改动 |
| 不暴露给前端 DTO | ✅ `character-profile.dto.ts` 零改动；单测 ⑭ 钉死 |
| 禁 `synchronize` | ✅ schema 只走 migration（ADR-0003） |
| 不用 `migration:generate` | ✅ 手写 DDL（entities glob 扫不到本仓实体） |
| migration 与 `bin/ormconfig.ts` 严格 1:1 | ✅ 两处都登记；单测 ⑧ 断言（含 ormconfig 的 `migrations[]` 数组里真的列上） |
| 不改已执行过的迁移 | ✅ 0013 / 0023 / 0024 等一行未动，迁移只增不改 |
| 不落 `tenant_id` / 不加 DB FK / 不加计数字段 | ✅ 全部未加 |
| 软删手写 `deletedAt: IsNull()` | ✅ 未动软删约定 |
| 不自动 commit / push | ✅ 本轮**不提交**，commit 文案见 §10 |

---

## 10. commit 文案

```text
feat(engine): WP10A character_profiles 加 3 列表达风格基线预留字段(话量基线/叙事风格/语态倾向), 手写幂等 migration + entity, seed 只对既有数据明文表态的角色写值
```

---

## 11. 用户验收 + 已知边界

### 11.1 需要用户配合的

**前端 / 客户端零改动** —— 这三列本期既不暴露给前端 DTO，也不影响任何会话行为，前端不接任何东西。

### 11.2 本轮已自测完的部分（不需要用户再做）

- 真库 migration 全生命周期（up / 幂等 / revert / 半途中断自愈 / down 缺列不炸 / 再 up）—— 见 §8.2，开发库当前处于**正确终态**；
- seed 灌库与连跑幂等（`新增 0 / 更新 0 / 未变 4`）；
- 全部代码闸门（tsc / eslint / jest 全量）。

### 11.3 已知边界 / 后续项（必须如实看）

1. **这三个字段本期完全不参与任何行为**（纯预留）：不进内核 `CharacterProfile`、不进 `RenderSpec`、不影响会话行为、不出现在前端 DTO。Phase2 P1 才接线（任务单 §4）。
2. **只表态了 2/4 角色的 1 个字段**：小满 / 亦舟的 `expressionTone = 'intellectualizing'`；晚晴 / 念安与全部 4 个角色的话量基线、叙事风格**一律走默认值**。Phase2 P1 需要逐个角色标定 —— 任务单 §1.4 本来就说"本期不要求给每个角色精调表达风格"。
3. **小满 / 亦舟的 `expressionTone` 是既有数据的转写，不是新的临床判断** —— 依据是这两个角色自己的 slug 与 5Ps 原文（见 §4.3）。与仓库既有基线数值口径一致（**工程种子值，非临床标定**），仍待后期专业评审复核。
4. **`speech_volume_baseline` 与 `baseline_resistance_verbal` 正交** —— 现有 seed 的 verbal 阻抗**不能**用来推导话量基线，这正是本字段存在的理由（区分"防御性沉默"与"气质性沉默"）。
5. **revert 会把三列连同值一起删掉** —— 再 `migration:run` 时存量行回到 DEFAULT，`intellectualizing` 需要重跑 `npm run seed:character-profiles` 才能补回来（本轮已实测并已恢复到正确终态）。
6. **部署顺序**：必须先 `npm run migration:run` 再起服务，否则 resolver 的 SELECT 报 `Unknown column 'speech_volume_baseline'`（加列类迁移的固有代价，与既有 ALTER 迁移同款）。
7. **entity 的 `default` 不参与建表**（synchronize 禁用，schema 只走 DDL），但会参与 TypeORM 的 INSERT 默认值推导 —— 所以 entity 与 migration 两边的默认值有单测**对着比**，改一边另一边会红。
8. **`drill-judge` 既有债 2 例**未修（任务单明确"不擅自修"）；`tsconfig.json` 口径下 41 个既有 e2e 报错同样未动。
