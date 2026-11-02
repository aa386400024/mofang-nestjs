# WP10A · character_profiles 表达风格基线字段预留

> 类型: 后端任务单（小改动，migration + entity + seed 默认值）
> 前置: WP10（伦理盲盒剧本，并行不阻塞）；WP9-B（character_profiles 表已交付）
> 日期: 2026-10-30
> 红线: 不改 `src/engine-core/**`；不写字段消费逻辑（本期纯预留，Phase2 P1 才写渲染层消费）；不破坏既有 seed 数据。

---

## 0. 为什么有这条

终局文档《来访仿真全场景与复杂度管控方案》P1（Phase2 前期）要做：话量差异（区分防御性沉默 vs 气质性沉默）、叙事结构化 vs 弥散型、话题回避行为。这些本质是**角色人格特质**，应该存在 `character_profiles` 表，不是每个剧本单独写。

现在表刚建（WP9-B），加列成本最低。等 Phase2 真要做的时候再加 migration，虽然也不算推倒，但不如现在顺手加好、填默认值，避免后期 seed 脚本漏改。

**本期只做字段预留 + 默认值填充，不写任何消费逻辑。** 字段存在但不参与 BDI 决策、不进 RenderSpec、不影响当前会话行为。Phase2 P1 做表达风格渲染时再接线。

---

## 1. 做什么

### 1.1 加 3 列到 `character_profiles`

| 列名 | 类型 | 默认值 | 语义 |
|---|---|---|---|
| `speech_volume_baseline` | float [0,1] | 0.5 | 话量基线（0=极沉默/长停顿，1=絮叨/长篇大论）。与 `baseline_resistance_verbal` **正交**：verbal 阻抗是"不信任不愿暴露"，speech_volume 是"天然性格话多话少"。Phase2 渲染层据此控制句长/轮次字数 |
| `narrative_style` | varchar(20) | `'mixed'` | 叙事逻辑风格：`structured`（条理清晰/时间线明确）/ `disorganized`（话题跳跃/想到哪说到哪）/ `mixed`。Phase2 渲染层据此组织 prompt |
| `expression_tone` | varchar(20) | `'restrained'` | 语态倾向：`restrained`（克制内敛/情绪平淡）/ `emotional`（情绪化宣泄/哭泣/语句破碎）/ `intellectualizing`（理智化隔离/讲道理/自我分析）/ `passive_aggressive`（被动攻击/言语带刺/表面顺从实则抵触） |

### 1.2 migration

手写 migration（禁 synchronize）：
- `ALTER TABLE character_profiles ADD COLUMN ...`
- 三列全部 `DEFAULT <默认值>` + `NOT NULL`
- 已有 seed 数据（21 列那批 vpt slug）自动被 DEFAULT 填充，不需要 UPDATE

### 1.3 entity 补字段

`character-profile.entity.ts` 加三个 `@Column`，类型与 migration 对齐。

### 1.4 seed 默认值

`character-profile.seed.ts`（或 builtin-character-registry）里的种子角色，如果已有明确的表达风格设定就填上对应值；拿不准的留默认值 `0.5 / 'mixed' / 'restrained'`。**本期不要求给每个角色精调表达风格**——Phase2 P1 再逐个角色标定。

---

## 2. 不做

- ❌ 不改 engine-core（CharacterProfile 纯层类型不加字段——等 Phase2 P1 真要消费时再加）
- ❌ 不写渲染层消费逻辑（spec-assembler / render-prompt 不读这三个字段）
- ❌ 不改 resolver 映射（buildCharacterProfile 不透传这三个字段到内核）
- ❌ 不改 admin API / DTO（这三个字段本期不暴露给前端）
- ❌ 不做话题回避/答非所问/重复叙述等沟通行为策略字段（这些是行为模式，不是基线特质，放剧本节点 delta 更合适）
- ❌ 不加 participants[] 多人字段 / suspend 状态枚举 / 事件总线 / 权限位（后期 migration 成本不高，现在做是过度工程）

---

## 3. 验收

- [x] migration 可跑（up/down）—— **真库实测**：up / 幂等再跑 / revert 回 21 列 / 半途中断自愈 / down 缺列不炸 / 再 up 回 24 列
- [x] tsc 0 错 / eslint 0 —— `tsconfig.build.json` 0 错；eslint exit 0（0 error 0 warning）
- [x] 既有 seed 角色不受影响（resolver 返回的 CharacterProfile 与改动前逐字一致，因为字段不进内核）—— 单测断言 resolver 映射输出**不含**三列；真库 seed 跑完 `新增 0 / 更新 2 / 未变 2`，"更新 2"**只动 `expression_tone` 一列**
- [x] `DESCRIBE character_profiles` 三列存在且默认值正确 —— 真库实测 24 列（21+3），`null=NO`，default = `0.5 / mixed / restrained`
- [x] jest 全绿（既有 1 套件 2 例失败 = drill-judge 既有债）—— 全量 55 套件 836 例中 834 例通过，唯一失败 = `drill-judge.spec.ts` 2 例

---

## 4. 后续（记给 Phase2 P1，不现在做）

Phase2 P1 做表达风格渲染时：
1. `buildCharacterProfile` 把这三个字段透传到内核 CharacterProfile
2. spec-assembler 据此组织渲染 prompt（话量基线控句长、叙事风格控结构、语态控情绪表达分寸）
3. 话题回避/答非所问等行为模式用 TrajectoryScript 节点 delta 实现，不进角色基线

---

## 5. 交付后回写

> 完整交付记录另见: [`engine-wp10a-character-expression-style-fields-backend-implementation-2026-10-30.md`](./engine-wp10a-character-expression-style-fields-backend-implementation-2026-10-30.md)（本文档末尾 §6 是它的摘要版）

---

## 6. 交付记录（2026-10-30 · WP10A 后端）

### 6.1 三列落地（1:1，0 自由发挥）

| 列名 | 类型 | 默认值 | 实体属性 |
|---|---|---|---|
| `speech_volume_baseline` | `FLOAT` | `0.5` | `speechVolumeBaseline: number` |
| `narrative_style` | `VARCHAR(20)` | `'mixed'` | `narrativeStyle: CharacterNarrativeStyle` |
| `expression_tone` | `VARCHAR(20)` | `'restrained'` | `expressionTone: CharacterExpressionTone` |

三列全部 `NOT NULL` + `DEFAULT` → **存量行在 MySQL 里被直接填成 DEFAULT（不是 NULL）**，WP9-B seed 灌进来的 4 个 vpt slug 行**一条 UPDATE 都不写**就拿到默认值（真库实测已确认）。

### 6.2 本轮的核心判断：默认值只有一处真相（DDL）

任务单 §1.4 写的是「拿不准的留默认值 `0.5 / 'mixed' / 'restrained'`」—— 字面照抄会在 seed 里存一份默认值副本，于是有两条路径会把库里 Phase2 P1 标定好的值冲回默认：① seed 重跑时又写一遍默认值；② 将来改 DDL 默认值，seed 里的副本静默漂移。

本轮落法：**种子没表态 → 该键根本不出现**。于是 INSERT 走 DB DEFAULT（TypeORM `InsertQueryBuilder` 对 `undefined` 写 `DEFAULT`）、UPDATE 整列不碰（`UpdateQueryBuilder` 明确跳过 `undefined` 属性）。这条语义**同时落在 spec → seed 行 → 灌库载荷三段**（只落一段等于半吊子）。

### 6.3 「明确表态」的判定口径（把主观印象挡在库外）

只认**该角色自己的既有数据**（模板 slug / 5Ps 原文）是否明文写出该特质：

| 角色 | template_id | 依据 | 表态 |
|---|---|---|---|
| 小满 | `vpt_self_worth_intellectualization_l1` | slug 含 `intellectualization` + 5Ps「用'我可以做得更好'压住被否定的感受」 | `expressionTone: 'intellectualizing'` |
| 亦舟 | `vpt_workplace_intellectualization_l1` | slug 含 `intellectualization` + 5Ps「用讲道理替代表达情绪、把感受分析成问题清单」 | `expressionTone: 'intellectualizing'` |
| 晚晴 / 念安 | `vpt_intimate_avoidance_l1` / `vpt_grief_avoidance_l1` | 既有数据未写明 | **不表态**（走 DEFAULT） |
| 全部 4 个 | — | 没有任何既有数据说明话量基线 / 叙事风格 | **一律不表态** |

**为什么话量基线全员不表态**：任务单 §1.1 明确它与 `baseline_resistance_verbal` **正交** —— "不信任不愿暴露"推不出"天然性格话少"。晚晴的 verbal 阻抗高，既可能是防御性沉默，也可能是气质性话少 —— 合成成一个维度正是本字段要消灭的错误。

### 6.4 改动面

**新增（2）**：`src/migration/1714900000025-AddCharacterProfileExpressionFields.ts`（手写 DDL + 逐列 `INFORMATION_SCHEMA` 幂等守卫，up/down 双侧）/ `test/engine-adapters/wp10a-character-expression-fields.spec.ts`（14 例）。

**修改（5）**：`character-profile.entity.ts`（3 个 `@Column` + 2 个字符串联合类型）/ `character-profile.seed.ts`（3 个可选字段 + 条件展开 + `hasDrift` 仅表态时比对 + `validateSeedRanges` 增话量基线 [0,1] + 2 角色表态）/ `src/migration/index.ts` 与 `bin/ormconfig.ts`（**严格 1:1 登记**）/ `test/engine-adapters/wp9b-db-character-resolver.spec.ts`（`buildRow` 补 3 字段以适配 entity 必填属性）。

### 6.5 闸门结果

| 闸门命令 | 结果 |
|---|---|
| `npx tsc -p tsconfig.build.json --noEmit` | ✅ 0 错 |
| `npm run lint` | ✅ exit 0（0 error 0 warning） |
| `npx jest test/engine-adapters test/engine-core test/voice` | ✅ 26 套件 / 512 例全绿 |
| `npx jest test/engine-adapters/wp10a-character-expression-fields.spec.ts` | ✅ 14/14 通过 |
| `npm test`（全量） | 55 套件 / 836 例：**834 例通过**；**仅** `test/counselor/drill-judge.spec.ts` 2 例失败 = **既有债**（该套件只 import `src/counselor/drills/**`，与本单零交集，未擅自修） |
| `git diff --stat HEAD -- src/engine-core` | ✅ 空（内核整树零改动） |
| **真库 `mofang_dev`** | ✅ migration up / 幂等再跑 / revert 回 21 列 / 半途中断自愈（只发 2 条 ALTER）/ down 缺列不炸 / 再 up 回 24 列 / seed 连跑幂等（`新增 0 / 更新 0 / 未变 4`） |

### 6.6 commit 文案

```text
feat(engine): WP10A character_profiles 加 3 列表达风格基线预留字段(话量基线/叙事风格/语态倾向), 手写幂等 migration + entity, seed 只对既有数据明文表态的角色写值
```

### 6.7 已知边界

1. 三个字段本期**完全不参与任何行为**（纯预留）：不进内核 `CharacterProfile`、不进 `RenderSpec`、不影响会话行为、不出现在前端 DTO —— Phase2 P1 才接线。
2. 只表态了 2/4 角色的 1 个字段；话量基线与叙事风格**全员默认**，Phase2 P1 需逐个角色标定。
3. 小满 / 亦舟的 `expressionTone` 是**既有数据的转写**，不是新的临床判断 —— 与仓库既有基线数值口径一致（工程种子值，非临床标定），仍待专业评审复核。
4. **revert 会把三列连同值一起删掉** —— 再 `migration:run` 时存量行回到 DEFAULT，需重跑 `npm run seed:character-profiles` 才能补回表态值。
5. **部署顺序**：必须先 `npm run migration:run` 再起服务，否则 resolver 的 SELECT 报 `Unknown column 'speech_volume_baseline'`。
6. **前端零改动**，不需要配合任何东西。
