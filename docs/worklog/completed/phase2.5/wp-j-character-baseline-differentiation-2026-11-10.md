> **路径**：`docs/worklog/completed/phase2.5/wp-j-character-baseline-differentiation-2026-11-10.md`
> **任务单**：[wp-j-character-baseline-differentiation-task-2026-11-10.md](wp-j-character-baseline-differentiation-task-2026-11-10.md)
> **状态**：✅ 已交付（2026-11-10）· 闸门全绿 · 真库 seed 连跑两次幂等
> **研究依据**：[`docs/reference/character-baseline-research.md`](../../reference/character-baseline-research.md)（v2 · 20 篇文献 + ECR-R 常模 + 量化交叉核对）

---

## 一、本单做了什么（一句话）

把"焦虑 / 回避两档一刀切"的角色基线，换成**8 个角色各自独立**的循证标定值，并给这组数值建了**唯一真相源 + 入库前必炸的自检**：
A 类 4 个（有 seed 规格）从权威表**装配**，B 类 4 个（DB-only）走**只 UPDATE 已存在行的 8 个基线列**的校准路径。

同档角色此前是"同一个人"（晚晴 == 小满、亦舟 == 念安，8 个字段一字不差）；现在每个角色有自己的数值剖面，
且**全仓再无第二份硬编码**。

---

## 二、方案设计（实际实现）

### 2.1 三层结构

| 层 | 文件 | 职责 |
|---|---|---|
| **数值真相源**（新建） | `src/engine-adapters/wiring/character/character-baseline-calibration.ts` | 8 行标定表 + 自检（区间 / 标签 / 可区分 / 无塌缩）+ 区间校验复用入口 |
| **内容 + 装配 + 落库**（改） | `src/engine-adapters/wiring/character/character-profile.seed.ts` | A 类 4 规格按 templateId **装配**数值；新增 B 类校准函数 |
| **执行入口**（改） | `bin/seed-character-profiles.ts` | 先内容 seed（A 类）→ 再数值校准（B 类），分别打印 |

### 2.2 单一真相源怎么保证

- 8 个角色的 8 个基线数值**只在** `CHARACTER_BASELINE_CALIBRATION` 一处声明。
- A 类 seed 规格用 `...baselineOf(templateId)` **展开装配**（不是抄一份）：
  改了标定表 → seed 跟着变 → 库跟着变；抄一份则"改一处漏一处"且**没有任何报错**。
- B 类名单 `DB_ONLY_BASELINE_CALIBRATION` 是**推导**出来的（权威表 − 有 seed 规格的行），
  不是手写名单 —— 手写名单迟早漂。
- 区间校验也只写一份：seed 侧的 `validateSeedRanges` 改为**调用**权威模块的 `validateBaselineRowRanges`。
- 内置种子（`builtin_avoidant_l1` / `builtin_anxious_low_mood_l1`）**不在**这 8 个角色里 —— 那是纯内存测试档位，
  本单不碰（既有测试已改成显式断言"它们不在标定表里"）。

### 2.3 内容与数值怎么分离

- **内容**（5Ps / 核心信念 / 底层愿望 / 负向约束 / 敏感议题 / 表达语态）→ 仍走 `character-profile.seed.ts` 原路径，**一字未动**。
- **数值**（trust / 三维阻抗 / valence / arousal / safety / bond）→ 只在权威标定表里。
- 两者唯一的接口是 **templateId**：内容与数值靠 id 对齐，谁都不抄谁的数字。

### 2.4 两类角色的落地路径

| 类别 | 角色 | 路径 | 写什么 |
|---|---|---|---|
| A（有 seed 规格） | 晚晴 / 小满 / 念安 / 亦舟 | 内容 seed（幂等 upsert） | 内容列 + 8 个基线列（数值已从权威表装配） |
| B（DB-only，无来访池模板） | 沉舟 / 安然 / 语桐 / 惊尘 | `applyBaselineCalibration` | **只** 8 个基线列；找不到行 → missing，**不 INSERT** |

B 类的 `applyBaselineCalibration`：
- 查询 `template_id IN (...) AND deleted_at IS NULL`（软删手写 `IsNull()`，仓库硬约束 #3）；
- 载荷**只有 8 个基线列**，不含内容列 / `enabled` / `audit_status` / `version*`；
- 值一致 → `unchanged`（不写、不抖 `updated_at`）；有差 → 只 UPDATE 那 8 列；
- 找不到行 → 进 `missing` **显式报告**（新环境没这些行是正常的，不静默造行）。

---

## 三、与任务单的偏差说明（7 处，全部有理由）

| # | 任务单原文 | 实际方案 | 为什么改 |
|---|---|---|---|
| **D1** | `validateBaselineCalibration(): string | null`，"用真实 resolveEmotionLabel（从 engine-core/domain/emotion 导入）" | **标签解析函数改为依赖注入**：`validateBaselineCalibration(resolveLabel, calibration?)`，由调用方传入内核那个真函数 | 三条约束互斥：① 内核 barrel **未导出** `resolveEmotionLabel`（WP62 只补了 `clamp01/clampValence`）；② `boundary.spec.ts` **断言⑪ 禁止 adapter 深路径 import 内核内部模块**（只允许 barrel 与 `in-memory/`）—— 在 adapter 里写深路径 import 会让这条机器守卫变红；③ 给 barrel 补导出 = 改 engine-core（本单红线）+ 改 `boundary.spec.ts` 白名单（仓库明令"护栏不许自己拆"）。**阈值仍只有内核一份，本模块零阈值副本**；生产侧由 `bin/` 脚本（不受断言⑪ 约束）注入真函数，测试侧由 `test/`（不受约束）注入真函数。 |
| **D2** | `validateBaselineCalibration()` 无参 | 第二个参数 `calibration` 可选（缺省 = 权威表本身） | 任务单同时要求"构造越界值 / 错标签 / 重复角色，断言返回错误"—— 无参就**没法对改造过的表做校验**。纯增量：`validateBaselineCalibration(resolveLabel)` 的调用形态照旧成立。 |
| **D3** | "每维度跨 8 角色 (max−min) ≥ 0.40" | 判定加 1e-9 浮点容差 | **实测踩到真坑**：`style` 维真值跨度就是 0.40（0.70 − 0.30），但 IEEE-754 下算得 `0.39999999999999997` —— 直接比较会把**完全合规**的表判成"维度塌缩"。容差比最小刻度（0.01）小 7 个数量级，真正的塌缩（0.399）仍会判红。**数值一个没改**。 |
| **D4** | "对 B 类 4 个 templateId" | B 类集合**推导**（权威表 − 有 seed 规格的行） | 手写名单 = 第二份真相（seed 规格增删时名单漂且无人知晓）。 |
| **D5** | "4 个规格里的 trust / resistance / emotion / safety / bond 改为从权威模块按 templateId 取值装配" | 一行 `...baselineOf(templateId)` 展开八维 | 八维一次装配，规格里不再出现裸数字；找不到行当场抛（静默落回 DB DEFAULT 会让角色变成"又一个平庸角色"）。 |
| **D6** | "其区间校验可与权威模块自检复用" | 已复用（seed 侧改为调用 `validateBaselineRowRanges`） | 顺带修掉旧实现一个口径问题：旧 `validateSeedRanges` 用 `Math.abs(value) > 1` 判阻抗，**负阻抗**（如 -0.5）会被放过；新口径是 [0,1]。 |
| **D7** | "找不到行 → missing" | 软删行同样算 missing | 软删行不是"可更新的行"；且本单红线禁止复活 / 补内容。已在测试里单独钉住（⑨）。 |

> 另有一处**纯表达**调整（非行为差异）：测试里 `buildCharacterProfile(seed, undefined)` 用具名常量 `NO_PRESET` 表达 ——
> lint 规则 `unicorn/no-useless-undefined` 会把字面量 `undefined` 参数判为冗余，但"显式不传 preset"正是该用例要表达的语义。

---

## 四、改动文件清单

| 文件 | 类型 | 用途 |
|---|---|---|
| `src/engine-adapters/wiring/character/character-baseline-calibration.ts` | **新建** | 8 行权威标定表 + `validateBaselineCalibration` + `validateBaselineRowRanges` + `getBaselineCalibration` + `BASELINE_CALIBRATION_BY_TEMPLATE_ID` |
| `src/engine-adapters/wiring/character/character-profile.seed.ts` | 改 | ① A 类 4 规格数值改为 `...baselineOf(templateId)` 装配；② 新增 `DB_ONLY_BASELINE_CALIBRATION`；③ 新增 `applyBaselineCalibration` + `toBaselineColumns` + `hasBaselineDrift`；④ `validateSeedRanges` 改为复用权威区间校验 |
| `bin/seed-character-profiles.ts` | 改 | 注入内核真 `resolveEmotionLabel` → 标定自检（入库前必炸）→ 先内容 seed（A 类）→ 再数值校准（B 类），两段分别打印 + missing 明细 |
| `test/engine-adapters/character-baseline-calibration.spec.ts` | **新建** | 21 例：表结构 / 真实标签逐行断言（含沉舟 empty、惊尘 hurt）/ 可区分性 / 无塌缩 / 反双胞胎 / 5 类负向用例 / seed 装配关系 / 端到端 `buildCharacterProfile(seed, undefined)` |
| `test/engine-adapters/character-baseline-seed-calibration.spec.ts` | **新建** | 11 例：B 类集合推导 / 只更 8 列（载荷键集合逐一断言）/ 内容与状态列未动 / missing 不 INSERT / 软删不算 / 连跑两次幂等 / A 类不被这条路径碰 |
| `test/engine-adapters/wp51-character-seed-alliance-baseline.spec.ts` | 改 | ⑩⑪ 从"按风格分档的硬编码数值"改为"对齐权威标定表 + 反双胞胎断言"（见 §六） |
| `test/engine-adapters/wp9b-db-character-resolver.spec.ts` | 改 | E 段从"seed 规格抄 WP9-A 内置种子档位"改为"对齐权威标定表 + 同风格不再同值 + 内置种子不在这 8 个角色里" |

**未改动**：`src/engine-core/**`（零行）、`character-profile.entity.ts`、`builtin-character-registry.ts`、`db-character-profile.resolver.ts`、
`src/migration/**`、任何 schema / 列 / 表结构、admin-dashboard、前端仓库、`package.json`（未新增 npm script）。

---

## 五、8 角色最终落库数值 + 真实情绪标签核对

真库 `mofang_dev`（117.72.30.78:3306）`character_profiles` 实查（seed 跑完后 SELECT 逐字段核对）：

| templateId | 角色 | 依恋 | trust | verbal | depth | style | valence | arousal | safety | bond | expectedLabel | 真实 `resolveEmotionLabel` | 核对 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `vpt_general_secure_l1` | 安然 | secure | 0.65 | 0.25 | 0.25 | 0.30 | -0.15 | 0.45 | 0.70 | 0.50 | guarded | **guarded** | ✅ |
| `vpt_intimate_avoidance_l1` | 晚晴 | anxious | 0.32 | 0.45 | 0.40 | 0.35 | -0.45 | 0.55 | 0.35 | 0.65 | guarded | **guarded** | ✅ |
| `vpt_self_worth_intellectualization_l1` | 小满 | anxious | 0.30 | 0.40 | 0.55 | 0.65 | -0.48 | 0.50 | 0.35 | 0.55 | guarded | **guarded** | ✅ |
| `vpt_social_anxious_l1` | 语桐 | anxious | 0.35 | 0.55 | 0.30 | 0.30 | -0.40 | 0.72 | 0.40 | 0.50 | anxious | **anxious** | ✅ |
| `vpt_depression_avoidant_l1` | 沉舟 | avoidant | 0.18 | 0.65 | 0.70 | 0.55 | -0.65 | 0.18 | 0.20 | 0.15 | empty | **empty** | ✅ |
| `vpt_grief_avoidance_l1` | 念安 | avoidant | 0.25 | 0.55 | 0.50 | 0.50 | -0.55 | 0.35 | 0.25 | 0.20 | sad | **sad** | ✅ |
| `vpt_workplace_intellectualization_l1` | 亦舟 | avoidant | 0.22 | 0.50 | 0.65 | 0.70 | -0.55 | 0.25 | 0.25 | 0.10 | sad | **sad** | ✅ |
| `vpt_trauma_disorganized_l1` | 惊尘 | disorganized | 0.10 | 0.50 | 0.60 | 0.45 | -0.60 | 0.64 | 0.10 | 0.45 | hurt | **hurt** | ✅ |

- **8/8 行标签与内核真函数输出逐行一致**（用 `resolveEmotionLabel(valence, arousal)` 实调，非写死期望）。
- **两处真实函数边界**落地正确：沉舟 arousal **0.18**（< 0.2 → `empty`，不是 `sad`）；惊尘 arousal **0.64**（< 0.65 → `hurt`，不是 `angry`）。
- 数值**逐字**等于任务单 §四 / 研究 v2 §6 —— 一个数都没改。
- 各维跨度（max−min）：trust .55 / verbal .40 / depth .45 / style .40 / valence .50 / arousal .54 / safety .60 / bond .55 —— **8 维全部 ≥ 0.40**，无塌缩。
- 两两最大单维差：**无一对 < 0.05**（最小的一对是沉舟—亦舟，靠 style/verbal 区分）。
- 反双胞胎达成：晚晴 ≠ 小满（trust .32/.30、depth .40/.55）、亦舟 ≠ 念安（depth .65/.50、style .70/.50）。

---

## 六、闸门表（真实数字）

| 闸门 | 命令 | exit code | 结果 |
|---|---|---|---|
| 类型 | `npx tsc -p tsconfig.build.json --noEmit` | **0** | **0 error** |
| Lint | `npx eslint "src/**/*.ts" "test/**/*.ts" "bin/**/*.ts"` | **0** | **0 error / 0 warning**（含 `bin/`，与 `npm run lint` 同范围） |
| 测试 | `npx vitest run` | **0** | **179 文件 / 2882 用例：2863 passed、19 skipped、0 failed**（174 passed 文件 + 5 skipped 文件） |
| 内核边界 | `git diff --stat HEAD -- src/engine-core` | **0** | **输出为空**（engine-core 零行改动） |
| 幂等 | `npm run seed:character-profiles` 连跑两次 | **0 / 0** | 见下方两次完整输出，第二次 B 类**全 unchanged** |

### 6.1 第一次 seed 输出（完整）

```
[seed:character-profiles] 目标库 117.72.30.78:3306 / schema mofang_dev
[seed:character-profiles] 内容基线自检通过, 共 6 个公共模板可对齐
[seed:character-profiles] 基线标定自检通过, 共 8 个角色 (DB-only 4 个走数值校准)
[seed:character-profiles] 内容 seed (A 类 4 个) → 新增 0 / 更新 4 / 未变 0（合计 4）
[seed:character-profiles] 基线校准 (B 类 4 个) → 更新 4 / 未变 0 / 缺失 0
[seed:character-profiles] 基线校准缺失明细: (无)
```

### 6.2 第二次 seed 输出（完整）

```
[seed:character-profiles] 目标库 117.72.30.78:3306 / schema mofang_dev
[seed:character-profiles] 内容基线自检通过, 共 6 个公共模板可对齐
[seed:character-profiles] 基线标定自检通过, 共 8 个角色 (DB-only 4 个走数值校准)
[seed:character-profiles] 内容 seed (A 类 4 个) → 新增 0 / 更新 0 / 未变 4（合计 4）
[seed:character-profiles] 基线校准 (B 类 4 个) → 更新 0 / 未变 4 / 缺失 0
[seed:character-profiles] 基线校准缺失明细: (无)
```

### 6.3 B 类校准结果

| 项 | 第一次 | 第二次 |
|---|---|---|
| `updated` | 4 | 0 |
| `unchanged` | 0 | **4** |
| `missing` | `[]`（0 个） | `[]`（0 个） |
| missing 明细 | **无**（本库 4 个 DB-only 行全部存在：`vpt_depression_avoidant_l1` / `vpt_general_secure_l1` / `vpt_social_anxious_l1` / `vpt_trauma_disorganized_l1`） | 同左 |

> 说明：本库 4 个 B 类行都存在，所以 `missing` 为空 —— **空也是显式报告**（脚本恒打印"缺失明细: (无)"）。
> 新环境若没有这些行，会逐个列出 templateId 且**不造行**。

### 6.4 一处与本单无关的偶发失败（如实记录）

全量 vitest 首跑出现 1 例失败：`test/counselor/wp21-report-stream.spec.ts`（报告 SSE 推送，counselor 层，与角色基线无关）。
单独重跑该文件 **2 次均 15/15 全绿**，随后全量重跑 **2863 全绿** —— 判定为并行负载下的**既有偶发**（SSE 时序），非本单引入。

---

## 七、风险与回归说明

### 7.1 被改的既有测试及原因

| 文件 | 用例 | 原来钉住什么 | 现在钉住什么 | 为什么必须改 |
|---|---|---|---|---|
| `wp51-character-seed-alliance-baseline.spec.ts` | ⑩ | 4 个 seed 角色 safety/bond = 0.4/0.5/0.25/0.05（"按风格分档"的硬编码） | 对齐权威标定表 + **同风格不再同值**（bond 分开） | 新表里晚晴/小满 safety 都是 .35、bond .65/.55；亦舟/念安 safety 都是 .25、bond .10/.20 —— 旧断言按"档位"钉死，与新表直接冲突 |
| `wp51-character-seed-alliance-baseline.spec.ts` | ⑪ | 同上（种子构建出的行） | 同上（装配关系） | 同上 |
| `wp9b-db-character-resolver.spec.ts` | E 段 | "seed 规格抄 WP9-A 内置种子的 anxious / avoidant 档位"（trust .28 等） | "seed 规格逐字等于权威标定表" + "同风格两角色不再同值" + "内置种子不在这 8 个角色里" | WP-J 的核心就是把"抄内置种子档位"换成"按角色独立标定"；旧断言描述的正是本单要消灭的关系 |

> 说明：其余引用旧数字的测试（`wp49` / `wp41` / `wp38` / `wp10a` / `wp9b-character-admin` / `wp30-admin-real-api` / `wp19r-trace-wiring` 等）
> 用的是**各自独立的 mock 行字面量**，不读 seed 规格 → **未受影响，一行未改**。

### 7.2 确认未碰的东西

- ✅ **engine-core 零行**：`git diff --stat HEAD -- src/engine-core` 为空；`boundary.spec.ts` 未改（断言⑥/⑪ 原样）。
- ✅ **schema / migration / 列结构零改动**：未新增 migration、未改 entity、未加列、未加约束。
- ✅ **内容列零改动**：5Ps / 核心信念 / 底层愿望 / 负向约束 / 敏感议题 / 表达语态 —— A 类规格里**一字未动**（diff 可见只有数值行被替换）。
- ✅ **状态列零改动**：B 类校准载荷只有 8 个基线列（测试逐一断言载荷键集合）；实查 `audit_status=approved`、`enabled=1`、`version=1`、`deleted_at=NULL` 全部原样。
- ✅ **唯一映射函数零改动**：`buildCharacterProfile` / `toCharacterSeed` / resolver 装配一行未动。
- ✅ 未动 admin-dashboard、未动前端仓库、未新增 npm script、未自动 commit/push。
- ✅ 心理对话原文未进任何新增日志/console（本单只处理数值，日志里只有 templateId 与数字）。

### 7.3 行为面影响（供督导预期）

- **自动对练 / 调试路径**（`buildCharacterProfile(seed, undefined)`）：8 个角色的开场基线**全部改变** → 同档角色的行为差异会明显变大（这正是本单目的）。
- **真实语音会话路径**：`resolveVoicePreset` 传来的访客池默认 `emotionBaseline` **仍覆盖** seed 的 arousal（研究 v2 §8 的双路径）—— 本单**未改**这条路径，语音路径的 arousal 仍来自来访池默认档。
- 内置种子（`builtin_avoidant_l1` / `builtin_anxious_low_mood_l1`）**未改** → 纯内存档位行为零回归。

---

## 八、遗留项与建议的人工复核

### 8.1 遗留项

1. **数值仍是"工程标定值"，不是临床标定** —— 研究 v2 的方法纪律：文献只给排序 / 方向 / 剖面形状，小数是工程锚点。
   建议在 100 场级验证批次跑完后，用真实对练数据回校这 8 行（表在单一真相源里，改一处即全仓生效）。
2. **语音路径的 arousal 仍被来访池默认覆盖** —— 与本单的差异化数值是两套数据。若要让语音路径也吃到标定值，
   需另开一单改 `resolveVoicePreset` 的来源（**会改到生产语音路径，本单明确不做**）。
3. **`verb_voice` 8 角色文案仍为 NULL**（另一单在办，`phase2.5-verbal-voice-drafts-2026-11-10.md`）—— 与本单无耦合。
4. **`wp21-report-stream.spec.ts` 偶发失败**（见 §6.4）—— 既有 flaky，与本单无关，可另单加固。

### 8.2 建议的人工复核动作

```bash
# ① 内核零改动
git diff --stat HEAD -- src/engine-core

# ② 全仓只有一处数值真相源 (应当只命中权威标定模块 + 装配点)
grep -rn "0\.39999999\|baseline_trust" src/ --include=*.ts | head

# ③ 连库抽查 8 行 (真实库已跑过, 期望与 §五 表格逐字一致)
SELECT template_id, baseline_trust, baseline_resistance_verbal, baseline_resistance_depth,
       baseline_resistance_style, baseline_emotion_valence, baseline_emotion_arousal,
       baseline_safety, baseline_bond, audit_status, enabled, version, deleted_at
FROM character_profiles
WHERE template_id IN (
  'vpt_general_secure_l1','vpt_intimate_avoidance_l1','vpt_self_worth_intellectualization_l1',
  'vpt_social_anxious_l1','vpt_depression_avoidant_l1','vpt_grief_avoidance_l1',
  'vpt_workplace_intellectualization_l1','vpt_trauma_disorganized_l1'
) ORDER BY template_id;

# ④ 幂等复核 (应全 unchanged)
npm run seed:character-profiles
npm run seed:character-profiles
```

---

## 九、回写清单

| 文件 | 动作 |
|---|---|
| `docs/worklog/completed/phase2.5/wp-j-character-baseline-differentiation-2026-11-10.md` | 本文件（新增） |
| `docs/worklog/completed/phase2.5/wp-j-character-baseline-differentiation-task-2026-11-10.md` | 任务单从 `pending/` 移入，状态行改为 ✅ 并指向本交付记录 |
| `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` | 「8 角色基线差异化」行：🚧 在办 → ✅ 已交付 + 交付记录链接 |
| `docs/worklog/pending/phase2.5-README.md` | §3「8 角色基线差异化」行：🚧 在办 → ✅ 已交付 + 交付记录链接 |

> ⚠️ **并发编辑说明**：本单交付期间，`docs/README.md`、`docs/team/conventions.md`、`docs/worklog/README.md`、
> `docs/worklog/pending/phase2.5-README.md`、`docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`
> 以及新文件 `docs/team/wp-task-template.md` **被另一个会话改动**（非本单所为）。
> 本单只对 phase2.5-README 与 wp-list 里「8 角色基线差异化」那两行做了**定点更新**，未覆盖他人改动。

---

## 十、commit message 草稿

```
feat(wp-j): 8 角色基线差异化落地 —— 循证标定表作单一真相源 + A 类装配 / B 类只更新基线列
```
