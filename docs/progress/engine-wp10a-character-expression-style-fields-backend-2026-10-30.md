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

- [ ] migration 可跑（up/down）
- [ ] tsc 0 错 / eslint 0
- [ ] 既有 seed 角色不受影响（resolver 返回的 CharacterProfile 与改动前逐字一致，因为字段不进内核）
- [ ] `DESCRIBE character_profiles` 三列存在且默认值正确
- [ ] jest 全绿（既有 1 套件 2 例失败 = drill-judge 既有债）

---

## 4. 后续（记给 Phase2 P1，不现在做）

Phase2 P1 做表达风格渲染时：
1. `buildCharacterProfile` 把这三个字段透传到内核 CharacterProfile
2. spec-assembler 据此组织渲染 prompt（话量基线控句长、叙事风格控结构、语态控情绪表达分寸）
3. 话题回避/答非所问等行为模式用 TrajectoryScript 节点 delta 实现，不进角色基线
