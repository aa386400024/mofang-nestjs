# WP-J · 8 角色基线差异化落地任务单（企业级 · 直接做成品）

> 状态：待执行（2026-11-10）
> 执行方：MiniMax Code
> 仓库：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`
> 唯一事实源（数值与循证依据，先读）：`docs/reference/character-baseline-research.md`（v2）
> 本任务性质：**数值标定落地**，不是新功能、不是 schema 重构。严格限定在"角色基线数值"这一层。

---

## 一、背景（先读，方向别错）

当前 `character_profiles` 的基线数值按"焦虑/回避两档一刀切"：同依恋风格的角色，8 个基线字段一字不差。
代码注释自己写明"工程种子值，非临床标定"。已完成循证研究（v2，20 篇文献 + 真实量表常模 + 量化交叉核对），
产出 8 个角色各自独立的基线数值。本任务把这份研究表**确定性地落进代码与数据库**。

### 两类角色（关键，决定落地方式）

| 类别 | 角色 | 现状 |
|---|---|---|
| **A. 有来访池模板的 seed 角色（4）** | 晚晴、小满、念安、亦舟 | 在 `character-profile.seed.ts` 的 `CHARACTER_PROFILE_SEED_SPECS` 有完整规格，核心信念从来访池模板抽取 |
| **B. DB-only 角色（4）** | 沉舟、安然、语桐、惊尘 | src 里无 seed、无 migration、无 SQL 定义；仅在 `data/quality/anchor-sample-30.csv` 被引用；行只存在于数据库，且无来访池模板 |

### 数据如何被消费（已核对，别改）
- 自动对练/调试路径：`DbCharacterProfileResolver.resolve()` 取行 → `toCharacterSeed()` → 调**唯一**映射函数
  `buildCharacterProfile(seed, undefined)`（无 preset）→ 基线数值原样生效。
- 映射公式、`engine-core`、resolver 装配、列结构**本任务一律不动**。

---

## 二、范围（严格遵守，不越权）

**在范围内：**
1. 8 个角色的 8 个基线数值字段（trust / 三维阻抗 / valence / arousal / safety / bond）差异化落地。
2. 为数值建立**单一真相源**与**入库前自检**（含真实情绪标签核对）。
3. 配套单元测试与既有测试的同步更新。

**明确不在范围内（禁止顺手做）：**
- 不改 `engine-core` 任何一行（BDI 红线）。
- 不改表结构、不加 migration、不加列、不加 DB 约束。
- 不改映射函数 `buildCharacterProfile`、不改 resolver、不改 module 装配。
- 不碰任何角色的 `enabled` / `audit_status` / `version` / 内容字段（5Ps、信念、愿望、约束、敏感议题）。
- 不给 4 个 DB-only 角色补内容、不新建来访池模板、不做软删。
- 不自动 git commit / push。
- 不改 admin-dashboard、不改前端仓库。

---

## 三、目标架构（企业级设计，按此实现）

### 设计原则
1. **数值单一真相源**：8 个角色的基线数值只在一个模块声明，全仓任何地方需要这组数值都引用它，禁止第二份硬编码。
2. **内容与数值分离**：内容（5Ps/信念等）仍走既有路径；数值标定是独立关注点。
3. **入库前必炸**：区间错误、情绪标签与临床意图不符、角色不可区分，都在 seed/自检阶段当场抛错，不进库。
4. **幂等**：seed 连跑两次，第二次结果"未变"，不产生抖动写。

### 交付物 1：数值基线权威模块（新建）

新建 `src/engine-adapters/wiring/character/character-baseline-calibration.ts`：

- 导出 `CHARACTER_BASELINE_CALIBRATION`：8 行，按 `templateId` 索引，每行含
  `trust`、`resistance: {verbal, depth, style}`、`emotion: {valence, arousal}`、`safety`、`bond`、`expectedLabel`。
- 数据逐字使用 §四 的表，不得改动任何一个数值。
- 导出 `validateBaselineCalibration(): string | null`，全部通过返 null，否则返回首条错误描述。自检规则：
  1. **区间**：trust / 三维阻抗 / safety / bond / arousal ∈ [0,1]；valence ∈ [-1,1]。
  2. **情绪标签（用真实函数，不许重写）**：对每行调用 `resolveEmotionLabel(valence, arousal)`
     （从 `engine-core/domain/emotion.js` 导入），断言结果 === `expectedLabel`；不一致即报错。
  3. **可区分性**：任意两个角色，8 个维度中至少有一维绝对差 ≥ 0.05；存在"所有维度差都 <0.05"的角色对即报错。
  4. **无维度塌缩**：每个维度在 8 个角色上的（max−min）≥ 0.40，否则报错。
- 该模块为纯数据 + 纯函数：零 Nest 装饰器、零 IO、零随机。

### 交付物 2：4 个 seed 规格引用权威数值（重构，不复制）

- 改 `character-profile.seed.ts`：4 个 `CharacterProfileSeedSpec` 里的 `trust` / `resistance` / `emotion` /
  `safety` / `bond` 不再手写，改为从 `CHARACTER_BASELINE_CALIBRATION` 按 `templateId` 取值装配。
- 内容字段（beliefMeta、fivePs、underlyingDesires、forbiddenBehaviors、sensitiveTopics、expressionTone）**原样保留，一字不动**。
- 保持 `CharacterProfileSeedSpec` 的对外类型与既有导出不变；`buildCharacterProfileSeeds` / `seedCharacterProfiles`
  的签名与幂等语义不变。
- 若现有 `validateCharacterProfileSeedSpecs` 与新结构有冲突，仅做最小适配；其区间校验可与权威模块自检复用，不要新写第二份校验逻辑。

### 交付物 3：DB-only 角色的数值校准（只更新已存在行的基线列）

在 seed 模块新增一个纯函数 + 在 `bin/seed-character-profiles.ts` 接入（复用同一条命令，不新增 npm script）：

- 函数 `applyBaselineCalibration(repo, calibration)`：对 B 类 4 个 `templateId`，
  按 `template_id` 找到**已存在且未软删**的行，只更新 8 个基线列：
  `baseline_trust`、`baseline_resistance_verbal/depth/style`、`baseline_emotion_valence/arousal`、
  `baseline_safety`、`baseline_bond`。
- **硬约束**：
  - 只 UPDATE，不 INSERT（找不到行不造内容为空的新行）；用 TypeORM 按 templateId 的部分字段 update。
  - 只写 8 个基线列，载荷里不得出现内容列、`enabled`、`audit_status`、`version*`。
  - 行当前值与目标值一致 → 跳过（unchanged），不产生无谓写。
- 返回并打印：`{ updated, unchanged, missing: string[] }`，`missing` 列出在目标库没找到的 templateId
  （新环境可能没有这些行，属正常，要显式报告而不是静默）。
- `bin/seed-character-profiles.ts` 的执行顺序：先跑既有内容 seed（A 类），再跑数值校准（B 类）；
  两者结果分别打印。连接/DataSource 复用现有方案，不 bootstrap AppModule。

### 交付物 4：测试（企业级，覆盖回归与边界）

在 `test/engine-adapters/` 下新增并更新：

1. 新增 `character-baseline-calibration.spec.ts`：
   - 8 行数值全部通过自检；
   - 情绪标签：用真实 `resolveEmotionLabel` 逐行断言等于 expectedLabel（含沉舟 empty、惊尘 hurt 两个边界）；
   - 可区分性：0 对"全维差 <0.05"；无维度塌缩；
   - 故意构造越界值/错标签/重复角色，断言 `validateBaselineCalibration` 返回错误（负向用例）。
2. 新增/扩展 seed 校准测试：
   - B 类数值校准只更新基线列、不碰内容与状态；找不到行进入 missing 且不 INSERT；连跑两次幂等（第二次全 unchanged）。
3. 更新既有 `wp9b-*` / `wp51-*` / `wp9a-*` 等断言旧数值的测试：把期望值对齐到新表；
   若有测试钉住"同风格两角色数值相等"，改为断言两者数值不同且可区分。
4. 端到端断言：对 8 个 templateId，用 `buildCharacterProfile(seed, undefined)` 产出的基线与 §四 表逐字段一致，
   且渲染标签与 expectedLabel 一致。

---

## 四、8 角色目标数值（逐字落地，禁止改动）

| templateId | 角色 | 依恋 | trust | verbal | depth | style | valence | arousal | safety | bond | expectedLabel |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `vpt_general_secure_l1` | 安然 | secure | 0.65 | 0.25 | 0.25 | 0.30 | -0.15 | 0.45 | 0.70 | 0.50 | guarded |
| `vpt_intimate_avoidance_l1` | 晚晴 | anxious | 0.32 | 0.45 | 0.40 | 0.35 | -0.45 | 0.55 | 0.35 | 0.65 | guarded |
| `vpt_self_worth_intellectualization_l1` | 小满 | anxious | 0.30 | 0.40 | 0.55 | 0.65 | -0.48 | 0.50 | 0.35 | 0.55 | guarded |
| `vpt_social_anxious_l1` | 语桐 | anxious | 0.35 | 0.55 | 0.30 | 0.30 | -0.40 | 0.72 | 0.40 | 0.50 | anxious |
| `vpt_depression_avoidant_l1` | 沉舟 | avoidant | 0.18 | 0.65 | 0.70 | 0.55 | -0.65 | 0.18 | 0.20 | 0.15 | empty |
| `vpt_grief_avoidance_l1` | 念安 | avoidant | 0.25 | 0.55 | 0.50 | 0.50 | -0.55 | 0.35 | 0.25 | 0.20 | sad |
| `vpt_workplace_intellectualization_l1` | 亦舟 | avoidant | 0.22 | 0.50 | 0.65 | 0.70 | -0.55 | 0.25 | 0.25 | 0.10 | sad |
| `vpt_trauma_disorganized_l1` | 惊尘 | fearful | 0.10 | 0.50 | 0.60 | 0.45 | -0.60 | 0.64 | 0.10 | 0.45 | hurt |

> 情绪标签边界（真实 `resolveEmotionLabel`，供核对，不要重写）：valence≥.25 落正向；
> valence≤−.5 时 arousal≥.65→angry、≥.45→hurt、<.2→empty、否则 sad；中间带 arousal≥.6→anxious、≥.4→guarded、否则 neutral。

---

## 五、闸门（必须自己跑，填真实数字，禁止留空）

在仓库根目录逐条执行，把**实际命令、exit code、结果数字**写进交付记录：

| 闸门 | 命令 | 要求 |
|---|---|---|
| 类型 | `npx tsc -p tsconfig.build.json --noEmit` | 0 error |
| Lint | `npx eslint "src/**/*.ts" "test/**/*.ts"`（或项目实际 lint 范围） | 记录 error/warning 数，0 error |
| 测试 | `npx vitest run`（可先跑相关目录再跑全量） | 记录用例总数、通过/失败数；全绿 |
| 幂等 | `npm run seed:character-profiles` 连跑两次 | 第二次 B 类全部 unchanged；记录两次完整输出 |

- 某条命令跑不起来，必须在交付记录写明报错原因，禁止 silently skip、禁止写"待用户执行"。
- 不允许用 `--no-verify` 等绕过手段。
- 心理对话原文不得出现在任何新增日志/console 中（本任务只处理数值，本就不应打印原文）。

---

## 六、交付记录（完成后写，路径固定）

完成后把交付记录写入：
`docs/worklog/completed/phase2.5/wp-j-character-baseline-differentiation-2026-11-10.md`

内容必须包含：
1. 改动文件清单（新建/修改/删除，逐个说明用途）；
2. 目标架构落地说明（单一真相源如何保证、内容与数值如何分离）；
3. 8 角色最终落库数值 + 真实情绪标签核对结果；
4. 闸门表格：命令 / exit code / 真实数字（error、warning、用例数、两次 seed 输出）；
5. B 类校准结果 `{updated, unchanged, missing}` 与 missing 明细；
6. 风险与回归说明：哪些既有测试被改、为什么；确认未碰 engine-core / schema / 内容 / 状态字段；
7. 遗留项（如有）与建议的人工复核动作（如 `git diff --stat`、连库 `SELECT template_id, baseline_* ...` 抽查）。

【回复输出约定】写完交付记录后，在对话里说一句"已写入交付记录"并附该文件路径，不用重复贴全文。

---

## 七、红线汇总（违反即返工）

- engine-core 一行不动；schema/migration/列结构不动；唯一映射函数不动。
- 数值单一真相源，禁止第二份硬编码；情绪标签必须用真实函数核对，禁止重写阈值逻辑。
- B 类只 UPDATE 已存在行的 8 个基线列，不 INSERT、不碰内容与 enabled/audit_status。
- 不自动 commit/push；不越权改范围外文件；不引入需求外功能。
- 闸门自跑并填真实数字，不留空、不跳过。
