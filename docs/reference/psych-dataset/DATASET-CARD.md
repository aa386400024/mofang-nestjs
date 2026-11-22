# DATASET CARD · 心理督导案例数据集

> **路径**：`docs/reference/psych-dataset/`
> **版本**：v0.6（2026-11-08）· 三张双面镜卡换成**完整原文**（56 / 74 / 94 轮，旧版为合并版 39 / 52 / 55），数据集扩至 **484 轮 / 332 条 SFT**
> **用途**：Phase2.5 WP-D 模拟咨询师训练 / WP-E 自动评测 ground truth
> **许可证/合规**：内部使用，`pii_redacted = true`，心理数据不出境

---

## 1. 数据集是什么

从 468 份督导案例 / 逐字稿 / 讲义里提炼出的**逐轮标注对话数据**。

不是原始语料 dump，是**人工/模型判断过每轮咨询师用了什么技术、来访者状态往哪走**的结构化数据。

原始语料（465 份 txt，390 万字）在 `docs/reference/psych-corpus-text/`，本数据集是它的提炼层。

---

## 2. 文件

| 文件 | 是什么 | 消费者 |
|---|---|---|
| `cases/*.json` | **单案例真源**。一个案例一个文件，人可 review、git diff 友好 | 人 / 构建脚本 |
| `dataset/turns.jsonl` | **标注视图**。一轮一条，带事件标签、描述性标签、delta、质量 | 评测、分析 |
| `dataset/sft.jsonl` | **训练视图**。OpenAI `messages` 格式，可直接喂 LLaMA-Factory / ms-swift / OpenAI 兼容接口 | 微调框架 |
| `dataset/cases.jsonl` | **案例视图**。案例级元信息 + ground truth 锚点 | 评测编排 |
| `dataset/visitors.jsonl` | **角色卡视图**。一案一行，「AI 来访者」人设 + 语言特征实算值 | WP-D 模拟咨询师 |
| `dataset/rubric.json` | **评测断言**。一案一组：必须做什么 / 绝不能做什么 / 易踩的坑 | WP-E 自动评测 |
| `dataset/stats.json` | 统计：事件分布、delta 均值、风险/流派分布 | 监控漂移 |
| `schema/case.schema.json` | JSON Schema（draft-07），字段与取值约束 | CI 校验 |

**改数据的正确姿势**：改 `cases/*.json` → 跑 `build_dataset.py` 重新生成 `dataset/`。
不要手改 `dataset/*.jsonl`，下次构建会被覆盖。

---

## 3. 字段

### 3.1 案例级

| 字段 | 说明 |
|---|---|
| `case_id` | kebab-case，全局唯一 |
| `sources[]` | 原始材料 + `role`（profile / dialogue / supervision / handout） |
| `supervisors[]` | 督导姓名 + 流派 |
| `school[]` | **咨询师呈现的流派**与**督导视角流派**都列，二者可能不同（案例一：精神分析 × 系统式） |
| `risk` | `none/low/medium/high/crisis`。`crisis` 轮次**永不跑 LLM 审议**，走本地规则 |
| `minor` | `true` 时整案不进训练集 |
| `trainable` | 缺省 `true`。`false` 表示**成年但不该学**，三类：在校生性议题、已被现代规范淘汰的技术、内容高度敏感。**只管 SFT**：决定该案的咨询师回应是否进 `sft.jsonl`，不影响 `turns.jsonl`，也不影响角色卡与断言（见 §4.3） |
| `profile` | 来访画像（人口学、主诉、依恋假设、阻抗基线、家庭、移情） |
| `ground_truth` | `gold_turns` / `borderline_turns` / `bad_turns` / `absent_negative_tags` |
| `supervisor_summary[]` | 督导总评分条，给评测写评分理由用 |

### 3.2 轮次级

| 字段 | 说明 |
|---|---|
| `i` | 轮次号，对应 `T{i}`，从 1 连续 |
| `visitor` / `counselor` | 原文，已脱敏 |
| `events[]` | **严格 9 类** CounselerEventKind：`empathy / acceptance / normalization / open_probe / affirmation`（正向）；`judgment / preaching / minimizing / boundary_cross`（负向样本） |
| `descriptive_tags[]` | `observation / interpretation / confrontation / reframe / self_disclosure`。**不进 events**，避免污染训练标签 |
| `delta` | DeltaVector 子集：`trust / safety / bond / resistance / emotionValence`，值域 [-1, 1] |
| `quality` | `gold / normal / borderline / bad`，**由 ground truth 决定**，不是看人写卡时的星标 |

**为什么 events 和 descriptive_tags 要分开**：`interpretation`（解释）不是 9 类干预标签之一，但它确实是咨询师做的事。混进 events 会让训练标签口径和引擎词表对不上；完全丢掉又丢失信息。所以单列。

---

## 4. 怎么用

### 4.1 微调（WP-D）

```bash
# 直接吃 dataset/sft.jsonl，messages 格式无需转换
llamafactory-cli train ... dataset_dir=docs/reference/psych-dataset/dataset \
  dataset=sft.jsonl ...
```

每条样本：

```
system  : 咨询师角色设定（流派 + 技术约束 + 来访画像摘要）
user    : 之前对话（最近 2 轮） + 来访者刚说的话
assistant: 咨询师这一轮的实际回应
metadata: case_id / turn_index / events / delta / quality
```

**对齐规则**：轮次结构是「咨询师先说 → 来访者回应」，所以 assistant 回应的是**上一轮的来访者发言**。构建脚本已按此对齐，直接用不要自己再拼。

排除规则（构建时自动执行）：
- `minor = true` 整案排除
- `trainable = false` 整案排除（成年但材料不适合学，见 §3.1）
- `risk = crisis` 排除
- `quality ∈ {bad, borderline}` 排除
- `events` 含负向 4 类排除
- 开场轮（无上文）保留但标 `is_opening = true`，可按需过滤

### 4.2 评测（WP-E）

用 `turns.jsonl` 组评测集：

| 评测项 | 数据来源 |
|---|---|
| 标签准确率 | `events`（9 类） |
| 技术恰当性 | `descriptive_tags` + `note` |
| 关系推进是否符合预期 | `delta`（方向 + 量级） |
| 不该出现的行为 | `absent_negative_tags`（如案例一断言全程无 `judgment`） |
| 高分参照 | `is_gold = true` 的轮次原文 |
| 边界样本 | `is_borderline = true`（不是错，是有争议，用于校准阈值） |

### 4.3 角色卡与断言（三分流）

三个产物管三件事，别混：

| 产物 | 管什么 | 覆盖范围 |
|---|---|---|
| `sft.jsonl`（`trainable`） | 教咨询师**怎么回应** | 6 案 / **332 轮**。危机、成瘾、已被淘汰的技术、性议题不进 |
| `visitors.jsonl` | 让系统能**演**这个来访者给你练 | **全部 11 案** |
| `rubric.json` | 判系统**有没有拦住、有没有做该做的** | **全部 11 案** |

**为什么危机与成瘾案不进训练却必须进评测**：真实咨询师就是会遇到自杀风险、酒依赖、恋物偷窃的来访者，回避不等于不存在。这些案子的正确用途是**测应用能不能拦住**——比如风险场景是否强制进入安全流程、遇到有害技术是否拒答。所以它们不进 `sft.jsonl`（不教模型模仿有争议的操作），但必须有角色卡和断言。

**`visitors.jsonl` 字段分两类**：

- 统计字段（`turns` / `visitor_turns` / `silence_ratio` / `avg_chars_per_turn` / `avg_sentence_chars` / `question_ratio` / `total_chars` / `signature_quotes`）**由脚本从清洗后的对话实算**，不手填
- 判断字段（`register` / `fillers` / `avoidance` / `emotion_baseline` / `resistance_patterns` / `risk_triggers` / `boundaries` / `roleplay_notes`）由人对照原话填

**未成年角色（`cbt-02` / `cbt-03`）的边界写成硬约束**：性内容只到抽象层（可谈「青春期身体变化带来的羞耻感」，不展开身体细节与性幻想）、场景限定为「培训咨询师如何与青少年工作」、扮演时带 `<minor_context: school-age>`。

**`rubric.json` 字段**：

| 字段 | 说明 |
|---|---|
| `gating_level` | `critical` 场景本身高风险，必须识别并进入安全流程 / `high` 需边界与知情同意 / `normal` 常规治疗性因素 |
| `must_do[]` | 每条带 `fail_if`：缺了哪一步算失败 |
| `must_not_do[]` | 每条带 `severity`：`red` 直接判失败 / `amber` 扣分 |
| `traps[]` | 该案最容易踩的坑，取自案例卡 §3 的 borderline 判断 |

规模：**11 案 / must_do 51 条 / must_not_do 40 条**。断言**待真人临床复核**，当前状态是 `draft-needs-clinical-review`。

---

## 5. 当前规模与覆盖（诚实说明）

| 指标 | 值 |
|---|---|
| 案例 | **11** |
| 轮次 | **484**（v0.6 把双面镜一/三/四换成完整原文，+78 轮） |
| SFT 可训练样本 | **332** |
| 事件标注 | open_probe 301 / empathy 18 / affirmation 12 / normalization 4 / **preaching 10** / **minimizing 3** |
| 负向标签 | **13** |
| 质量分布 | normal 265 / gold 151 / borderline 59 / bad 9 |
| 流派覆盖 | 精神分析、系统式、CBT、整合、未标注（2 例） |
| 风险覆盖 | low、medium、**high** |
| 未成年人排除 | 16 轮（`cbt-03` 整案） |
| **不可训练（trainable=false）** | **5 案 / 104 轮**（cbt-02 45 / cbt-03 16 / crisis-01 16 / behavior-01 15 / behavior-02 12） |
| 有第三方督导的案例 | 3 案（双面镜一 / 三 / 四） |
| 角色卡（`visitors.jsonl`） | **11 案全收**：含 2 个未成年、1 个 high 风险、2 个已淘汰技术 |
| 评测断言（`rubric.json`） | 11 案 / must_do 51 / must_not_do 40，状态 `draft-needs-clinical-review` |

分案例明细：

| case_id | 轮次 | gold | border | bad | 进 SFT | 材料性质 |
|---|---|---|---|---|---|---|
| `psychoanalysis-01-double-life` | 121 | 11 | 13 | 2 | ✅ | 教材案例，作者自注 |
| `shuangmianjing-04-insecure-man` | **94** | **37** | **7** | 0 | ✅ | 被督导示范（3 位督导） |
| `shuangmianjing-03-marriage-wife` | **74** | **25** | **11** | **1** | ✅ | 被督导示范（含曾奇峰） |
| `shuangmianjing-01-mother-daughter` | **56** | **24** | **8** | 0 | ✅ | 被督导示范（刘丹、李松蔚） |
| `cbt-02-social-anxiety-teen` | 45 | 10 | 5 | 0 | ❌ 在校生性议题 | 教材，作者自注 |
| `intake-01-entrance-exam-failure` | 22 | 5 | 3 | 0 | ✅ | 初访流程示范，无督导 |
| `cbt-03-exam-anxiety-senior` | 16 | 7 | 2 | 0 | ❌ 高三在读 | 教材，作者自注 |
| `crisis-01-colorless-world` | 16 | 11 | 4 | 0 | ❌ risk=high | 教材，作者自注 |
| `behavior-01-alcohol-dependence` | 15 | 7 | 2 | 3 | ❌ 技术已淘汰 | 教材，作者自注 |
| `brief-01-friendship-betrayal` | 13 | 8 | 2 | 0 | ✅ | 会谈记录，无督导 |
| `behavior-02-fetish-theft` | 12 | 6 | 2 | 3 | ❌ 技术已淘汰＋敏感 | 教材，作者自注 |

> **v0.6 的口径变化**：三张双面镜卡从「合并压缩版」（39/52/55 轮）换成**完整原文**（56/74/94 轮），三案重新逐轮标注。gold 从 41→86、borderline 从 13→26 的增量中，有一部分是合并版把连续发言并成一轮后**判注被压缩**、无法逐轮挂 GT 造成的，不全是新增内容。

**这不是一个可以直接训练的数据集，是一个可用的样板 + 一条能自动扩容的生产线。**

局限必须说清楚：

1. **11 个案例、332 条样本**，仍不足以微调（同量级任务通常需数百到数千条）。
2. **负向样本 13 条，只覆盖两类**：`minimizing` 3 条（替来访者的家人辩护）+ `preaching` 10 条（替来访者做决定 / 以治疗必要性压过意愿）。`judgment` 与 `boundary_cross` **仍为 0**，模型学不到这两类"不该做什么"。
3. **可训练样本里没有 CBT。** 两张 CBT 卡（`cbt-02` 在校生性议题、`cbt-03` 高三在读）都因合规排除。`turns.jsonl` 里虽有 61 轮 CBT 数据，`sft.jsonl` 的流派仍只有精神分析、系统式、未标注。**这是当前最刺眼的失衡**——引擎的 CBT 分支没有对应训练数据。
4. **可训练的来访画像只有 6 例**（女白领 / 35 岁女公务员 / 36 岁男管理层 / 25 岁女白领 / 女大学生 / 高考落榜女生），仍集中在城市女性与在校学生，职业、年龄、阶层偏差明显。
5. **难度分层的 L3 在 v0.6 补上了。** 旧版双面镜四只有 55 轮，停在「与父亲认同」就收了，L3 只有解释、没有对话。换成完整 94 轮后，会谈实际下到了 `T54`「计划生育年代，我妈说我出来时我爸要把我往河里扔」→ `T55`「如果没用，可能活都活不了」——**这是咨询师在会谈里接住的一句话，不是督导的评论**，可以作 L3 对话样本。`T84`「无论你取得什么成绩，最后结论都一样」→ 他自己说出「我跟我爸很像」，是 L3 的自发落点。
6. **材料性质分三层，不可等同看待**：双面镜一 / 三 / 四是**被第三方督导的示范**（gold 有外部依据）；精分一与新增 5 份教材案例是**作者自注**（gold 只能靠"来访者是否当场有反应"判断）；`brief-01` / `intake-01` 是**会谈记录**，没有任何评论层。评测时应分层使用，不要把自注案例的 gold 当成权威判断。
7. **督导密度在下降。** 双面镜素材已用尽后转向其他逐字稿（本轮新增 7 案），但 11 案中有 8 案无第三方督导。**继续扩容的瓶颈不再是切轮次，而是"哪里还有带督导的逐字稿"。**
8. **危机案例缺安全计划。** `crisis-01` 全程无结构化自杀风险评估（计划 / 手段 / 既往尝试 / 保护因素），也没有安全计划，作者自述理由是"主动求助＋有自知力＋动机已减弱"。**这不是标注缺陷，是材料本身的处置缺口**；保留它正是为了让评测系统能抓到这类问题。

扩容方式：已查清 `psych-cases/_skeleton/` **只有 8 份**（不是 33 份）——其中 3 组已在本轮拿去重做双面镜一/三/四，2 份是已合规排除的案例二（15 岁来访者），1 份（张沛超研讨 133 轮，来访者有效发言 0）不能当对话卡。**没有可继续填的骨架池**；再扩容只能从 `txt/` 里找新的逐字稿，走 `clean_dialogue.py` → `cardgen.build()` → `case_md_to_json.py` → `build_dataset.py` 这条链，样本量随之线性增长。流程已跑通，剩下的成本是**判断**，不是机械劳动。

## 6. 已知偏差与坑

| 偏差 | 表现 | 处理 |
|---|---|---|
| **咨询师表现整体偏好** | 双面镜是示范教学，咨询师水平高于平均，模型会学到"理想化"风格 | 需要补负样本案例；评测时不能只用本数据集 |
| **督导视角不等于咨询师视角** | 案例一咨询师偏精神分析，督导是系统式，督导批评的正是咨询师的做法 | `school` 分列两者；写 ground truth 时区分"做得好"与"督导认为可以更好" |
| **OCR 文本有错字** | 被→袚、问→间、激将法→溯将法 | 成卡时按上下文改正，不要把错字抄进数据 |
| **轮次粒度偏细** | 脚本按"咨询师每次开口"切，一次干预被拆成多轮 | 打标签用细粒度合适；不要为了凑整合并 |
| **文件名不可信** | 122 份标题与内容不符 | 一律以 `real_title` + 正文为准 |
| **编号也不可信** | 案例四的 `05 案例研讨：精分视角看到深层的情感（丛中）` 讨论的其实是另一位女性来访者（恋爱焦虑、咨询 34–35 次），与阿季无关 | 引用任何研讨 / 解析材料前，先比对来访者的性别、年龄、主诉、家庭结构；对不上就不用，宁可少一份督导 |
| **教材案例自带技术注释** | 精分一原文每个干预后附 `(注释：治疗师运用具体化技术……)`，直接切轮次会把注释混进咨询师的话里 | 已抽到独立 `note` 字段；见技能 `scripts/clean_dialogue.py`。**不剥离的话，模型会学成"说完还要自己写技术说明"** |
| **trainable 不等于 minor** | 成年但材料不该学时，套 `minor` 会谎报年龄 | 单列 `trainable`：在校生性议题、已淘汰技术、高敏感内容三类；不影响 `turns.jsonl` |
| **危机材料的处置缺口会被当成范例学走** | `crisis-01` 有自杀意念却无风险评估与安全计划 | 标 `risk=high` + `trainable=false`，并在卡内 §3.5 明写「正确答案是否」，避免评测时误判为合格 |
| **自述 ≠ 被督导** | 自注材料里没有第三方反驳，"作者说这招好"不等于"这招真好" | gold 只收来访者当场有反应的轮次；作者标为技术正确但来访者无明显回应的降为边界 |
| **末轮往往没有来访者回应** | 5 案（alcohol T15 / cbt-02 T45 / crisis T16 / intake T22 / s04 T94）最后一轮是咨询师发言后会谈即结束，`visitor` 为空 | 属材料真实状态，不是缺失；这些轮次仍可作 SFT 目标（assistant 是本轮咨询师） |
| **占位句不能当训练目标** | 原文某轮无咨询师发言时，卡里只能写「本段为来访者开场独白，原文无咨询师发言」以满足 md→json 校验 | `build_dataset.py` 按 `PLACEHOLDER_MARKS` 排除该轮 SFT，并把它从历史上下文中剔除；实测挡掉 1 条 |
| **对白里的「咨询师」未必是旁白** | s04 全案主题就是来访者质疑「我的咨询师」；`intake-01` T2 是咨询师自我介绍；`behavior-01` T10 咨询师以「来访者」自指（教材原文如此，未改） | 清洗阶段只用「来访者 / 治疗师」等词做初筛，**必须逐条看上下文**，否则会把真实对话当污染删掉 |
| **回应长度分布很不均匀** | SFT 的 assistant 中位数 25 字，最短 3 字（「郁闷?」「难过。」），最长 324 字；≤4 字 11 条、>200 字 8 条 | 真实咨询本就以短句提问 / 反映为主，不按长短筛样本。`system` 只描述长度分布、**不写「不超过 120 字」硬上限**——写死会让模型学到「system 约束可以忽略」 |

---

## 7. 版本与更新

```
改 cases/*.json
   ↓
python scripts/build_dataset.py --root docs/reference/psych-dataset
   ↓   （校验不通过会直接退出，不产出脏数据）
dataset/{turns,sft,cases}.jsonl + stats.json
   ↓
python scripts/build_visitors.py --cases <...>/cases --out <...>/dataset/visitors.jsonl
python scripts/build_rubric.py
dataset/visitors.jsonl + rubric.json
```

校验项：必填字段、9 类枚举、delta 值域、轮次连续、ground truth 轮次存在性。
新增案例后 `stats.json` 会自动反映规模与分布变化。角色卡与断言**不自动跟着变**——新案要补 `spec_visitors.py` 的 SPECS 和 `build_rubric.py` 的 RUBRIC，否则这两个文件里就没有它。

版本：v0.6（三张双面镜卡换成完整原文，「督导总评」口径修复，`cases.jsonl` 补 `trainable`，SFT 排除占位句轮次）。

---

## 8. 溯源

每个案例的 `sources[]` 指回原始 PDF/Word 相对路径，可在
`docs/reference/psych-corpus-text/txt/` 找到对应全文。
`manifest.jsonl` 记录了每份资料的提取状态（`ok / ok_doc / ok_ocr / ok_ocr_sample / skipped`）。
