# 心理学资料库资产化 · 工作入口

> **路径**：`docs/worklog/pending/psych-corpus-README.md`
> **状态**：🚧 全量提取与分类已完成；已转成数据集 **11 个案例（484 轮 / 332 条 SFT）**——双面镜 3 个 + 精分教材 1 个 + 逐字稿方向 7 个。**其中 6 案可进训练，5 案仅作评测**（合规 / 技术淘汰 / 高风险，共 104 轮）
> **更新日期**：2026-11-08
> **总入口**：[§worklog/README.md](../README.md)
> **语料库**：[§psych-corpus-text](../../reference/psych-corpus-text/)
> **案例卡**：[§psych-cases](../../reference/psych-cases/)

---

## 0. 这是什么阶段（先读这段）

**这不是写代码阶段，是「素材准备」阶段。**

| 阶段 | 干什么 | 类比 |
|---|---|---|
| Phase2.5 WP-D | 训练模拟咨询师 AI + 自动对练 | 需要「教材」 |
| **本阶段** | **把 468 份心理学资料提取成文字、分类、转成案例卡** | **编教材** |
| Phase2.5 WP-E | 用督导解析当 ground truth 自动评测 | 需要「标准答案」 |

**一句话：把散落在 PDF/Word 里的督导智慧，变成工程能直接吃的结构化数据。**

---

## 1. 出口条件

| # | 出口条件 | 可判定标准 | 现状 |
|---|---|---|---|
| ① **全量提取** | 468 份每一份都有可用正文 | `manifest.jsonl` 里 `needs_ocr` = 0 | ✅ 已达成 |
| ② **类型可分** | 每份按正文判出是什么（不看文件名） | `corpus-index.json` 里 `unknown` ≤ 2% | ✅ 2 / 468 |
| ③ **对话可切轮** | 每份对话逐字稿切成结构化轮次 | `turns/*.turns.json` 覆盖全部 `dialogue` | ✅ 35/35 |
| ④ **案例卡成卡** | 双面镜 10 案 + 逐字稿精选做成逐轮标注卡 | `psych-cases/*.md`（非 `_skeleton/`）份数 | ✅ **11 份完成**（双面镜一 / 三 / 四 + 精分一 + 逐字稿方向 7 份）；`_skeleton/` 实为 **8 份**（原记 33 份是错的），已无可用池 |
| ⑤ **ground truth 可喂** | 每份卡有 gold_turns / bad_turns / delta | WP-E 脚本能直接读 | ✅ 11 案已具备（gold 151 / borderline 59 / bad 9） |
| ⑥ **合规过线** | 无真实姓名单位；未成年人打标 | 抽查无 PII | ✅ 见 §6 |

---

## 2. 数据现状（2026-08-08 全量跑完）

**源资料**：`E:\BaiduNetdiskDownload\心理学资料`（468 份）

| 提取状态 | 份数 | 说明 |
|---|---:|---|
| `ok` | 362 | 原生有文字层，直接提取 |
| `ok_doc` | 66 | 旧 `.doc`，Word COM 转会 `.docx` 后提取 |
| `ok_ocr` | 14 | 扫描版 PDF，全页 OCR |
| `ok_ocr_sample` | 23 | 大页数扫描件（电子书/习题集），只 OCR 前 8 页做内容识别 |
| `skipped` | 3 | `.caj` / `.mp4` / `.ppt`，无法提取 |
| **合计** | **468** | **`needs_ocr` = 0** |

**总字数**：3,906,046 字。

### 按类型分（`corpus-index.json`）

| 类型 | 份数 | 对 WP-D/WP-E 的价值 |
|---|---:|---|
| `dialogue` 对话逐字稿 | 35 | ★★★★★ 训练素材本体 |
| `supervision` 督导逐句点评 | 9 | ★★★★★ ground truth 来源 |
| `profile` 案例背景画像 | 24 | ★★★★ 来访画像 / 场景设定 |
| `handout` 话术工具 | 2 | ★★★★ 标签校准 |
| `case_report` 案例报告/期刊 | 361 | ★★★ 补充案例，**无逐轮对话** |
| `personal_growth` 个人成长报告 | 9 | ★ 认证材料，不进训练 |
| `concept` 概念讲义 | 22 | ★★ 理论背景 |
| `exam` 习题 | 1 | ☆ 不用 |
| `skipped` 无法提取 | 3 | `.caj` / `.mp4` / `.ppt` |
| `unknown` | 2 | 人工判断 |

**为什么 `case_report` 这么多**：468 份里 195 份文档版 + 177 份期刊，绝大多数是中小学/大学生心理辅导的**叙事体案例文章**（有作者、有案例经过、有反思），不是对话逐字稿。它们可以做"案例背景 + 干预思路"参考，但**喂不了逐轮训练和评测**。

---

## 3. 产物清单

### 语料库 `docs/reference/psych-corpus-text/`

| 文件/目录 | 内容 |
|---|---|
| `manifest.jsonl` | 468 条记录：源路径 / 类型 / 状态 / 字数 / txt 路径 |
| `extract-summary.json` | 首次全量提取汇总 |
| `txt/` | **465 个**纯文本，镜像源目录结构；文件头 4 行标注源文件、状态、字数 |
| `turns/` | **33 份** `*.turns.json`，每份含 `turns[] = {index, counselor, visitor, supervisor, supervisor_names}` |
| `corpus-index.md` | 概览：类型分布、议题分布、案例分组、错位证据 |
| `corpus-index-full.md` | 逐条明细（468 行） |
| `corpus-index.json` | 机器可读，含 `real_title / head / kind / kind_confidence / title_mismatch / case_group / topics` |
| `_doc2docx/` | 66 份由 `.doc` 转出的 `.docx`（中间产物，可删） |
| `_ocr.log` / `_classify.log` | 运行日志 |

### 案例卡 `docs/reference/psych-cases/`

| 文件 | 轮次 | gold / border / bad | 进 SFT |
|---|---|---|---|
| `psychoanalysis-01-double-life.md` | 121 | 11 / 13 / 2 | ✅ |
| `shuangmianjing-04-insecure-man.md` | 55 | 20 / 6 / 0 | ✅ |
| `shuangmianjing-03-marriage-wife.md` | 52 | 12 / 4 / 3 | ✅ |
| `cbt-02-social-anxiety-teen.md` | 45 | 10 / 5 / 0 | ❌ 在校生性议题 |
| `shuangmianjing-01-mother-daughter.md` | 39 | 9 / 3 / 0 | ✅ |
| `intake-01-entrance-exam-failure.md` | 22 | 5 / 3 / 0 | ✅ |
| `cbt-03-exam-anxiety-senior.md` | 16 | 7 / 2 / 0 | ❌ 高三在读 |
| `crisis-01-colorless-world.md` | 16 | 11 / 4 / 0 | ❌ risk=high |
| `behavior-01-alcohol-dependence.md` | 15 | 7 / 2 / 3 | ❌ 技术已淘汰 |
| `brief-01-friendship-betrayal.md` | 13 | 8 / 2 / 0 | ✅ |
| `behavior-02-fetish-theft.md` | 12 | 6 / 2 / 3 | ❌ 技术已淘汰＋敏感 |
| `_skeleton/*.md` | — | — | 8 份：3 组已用于双面镜一 / 三 / 四重做，2 份是合规排除的案例二（15 岁），1 份来访发言为 0，**无可填池** |
| `inventory.md` | — | — | 468 份原始清单，文首有「成卡状态」总表 |

### 结构化数据集 `docs/reference/psych-dataset/`

**机器消费入口，大模型/评测脚本读这里，不要读 md。**

| 文件 | 内容 |
|---|---|
| `cases/*.json` | **唯一真源**：一案例一文件，含逐轮 events / descriptive_tags / delta / ground_truth |
| `dataset/turns.jsonl` | 标注视图：一轮一条，供评测与分析 |
| `dataset/sft.jsonl` | 训练视图：OpenAI `messages` 格式，可直接喂微调框架 |
| `dataset/cases.jsonl` | 案例视图：案例元信息 + 评测锚点 |
| `dataset/visitors.jsonl` | **角色卡视图**：一案一行，AI 来访者人设 + 语言特征实算（WP-D 用） |
| `dataset/rubric.json` | **评测断言**：must_do / must_not_do / traps（WP-E 用） |
| `dataset/stats.json` | 统计：事件分布 / delta 均值 / 风险流派分布 |
| `schema/case.schema.json` | JSON Schema，字段与枚举约束 |
| `DATASET-CARD.md` | 数据集说明：字段语义、规模、偏差、扩容方式 |
| `DATASET-VISITORS.md` | 角色卡与断言的人读版（由上面两个 JSON 渲染） |

当前规模：**11 个案例 / 484 轮 / 332 条 SFT 样本**。可进训练的 4 案是双面镜一 / 三 / 四 + 精分一；另有 `brief-01`（13 轮）与 `intake-01`（22 轮）两份无督导材料，属可训练但材料性质较薄。5 案标 `trainable=false`（在校生性议题 / 高三在读 / risk=high / 技术已淘汰 / 高敏感，共 104 轮），只进 `turns.jsonl` 评测视图。详见 DATASET-CARD 的"覆盖与局限"。

**三份产物各管一件事，别混**：`trainable` 只控 `sft.jsonl`（不教模型模仿有争议的操作）；`visitors.jsonl` 管「能不能演这个来访者」，**11 案全收**；`rubric.json` 管「有没有拦住、该做的做了没」，**11 案全收**、51 条 must_do + 40 条 must_not_do。危机与成瘾案不进训练但必须进评测——真实咨询师就是会遇到这些来访者。
新增案例：改 `cases/*.json` → `python build_dataset.py --root docs/reference/psych-dataset`，校验不通过会直接退出。

---

## 4. 怎么消费这些产物

### WP-D（模拟咨询师训练）

1. 从 `corpus-index.json` 筛 `kind == "dialogue"` → 35 份候选
2. 按 `topics` 筛议题（抑郁/焦虑/亲子/婚姻/学业/职场…）
3. 按 `case_group` 聚合同一案例的多份材料
4. **首选 `dataset/visitors.jsonl`**：一案一行的完整人设（说话方式 / 口头语 / 回避方式 / 情绪基线 / 阻抗触发 / 风险触发 / 边界 / 代表台词），比从 `turns.json` 现拼角色卡稳定
5. 需要更多台词种子时再回 `turns.json` 取 `visitor` 文本，`counselor` 文本作为"专家示范"

### WP-E（自动评测 ground truth）

1. **先用 `dataset/rubric.json` 判拦截**：`gating_level=critical` 的案子（危机 / 未成年 / 有害技术）必须能测出系统有没有进安全流程；`must_not_do` 里 `severity=red` 的条目触发即判失败
2. 再用案例卡里的 **gold_turns**（黄金轮次）作为"高分应答"参照
3. 用 **bad_turns / 边界样本**作为负例
4. `expected_deltas` 直接写进评测断言（`trust / safety / bond / resistance / emotionValence`）
5. 督导点评原文（`supervisor` 字段）作为**评分理由**的自然语言依据

### 不要这样用

- ❌ 拿 `case_report` 当逐轮训练数据 —— 它没有对话
- ❌ 拿 `ok_ocr_sample` 当全文 —— 只有前 8 页
- ❌ 按文件名找材料 —— 实测有跨案例错位（`title_mismatch` 122 份）

---

## 5. 质量校验（已做过的检查）

| 检查 | 方法 | 结果 |
|---|---|---|
| 中文提取质量 | 抽 12 份验证，比对原 PDF 页数 | 断行自然、无乱码 |
| OCR 准确度 | 单份测试 `01 案例一基础知识点.pdf` | 3,615 字，识别准确 |
| 文件名可信度 | 正文标题 vs 文件名比对 | 122 份不一致，**不能信文件名** |
| 轮次切分粒度 | 案例一：脚本 56 轮 vs 人工整合 39 轮 | **定论：用 56 轮**。人工合并版把咨询师的连续发言并成一轮，丢了「他说一句、她接一句」的节奏，也无法逐轮挂 GT |
| 同名副本 | 内容比对 | `事件频发的一周(1).pdf` 与原件同为 12,659 字，重复 |

---

## 6. 合规红线

1. **心理数据不出境** —— 全部在本地/内网处理
2. **进训练集前脱敏** —— 真实姓名、单位、地名替换为占位符
3. **未成年人案例不进训练集** —— `topics` 含"儿童青少年"的需二次确认；文档版 195 份大量是中小学案例
4. **对话原文不进审议 prompt** —— 只进 `snapshot` 的结构化摘要（见 `deliberation-hook.port.ts`）

---

## 7. 下一步

| 优先级 | 事项 | 量 |
|---|---|---|
| **P0** | **`rubric.json` 的 11 案断言等真人临床复核**（尤以危机案的「风险评估 + 安全计划」条目、未成年两案的边界颗粒度） | 11 案 / 89 条 |
| P1 | 双面镜带逐轮对话的 4 个案例已全部处理完（1/3/4 已成卡，案例二因来访者 15 岁按合规排除）；**扩容已转向其他逐字稿，本轮完成 7 份** | — |
| P1 | 从 `turns/` 其余逐字稿里挑新的完整案例成卡。**本轮已完成 7 份**（见下表），`turns/` 里剩下的有效候选基本用尽 | 已交付 |
| P2 | ~~03 逐句解析（男性案例）成卡~~ 已完成，即案例四 `shuangmianjing-04-insecure-man`（55 轮 / gold 20 / borderline 6） | 1 份 ✅ |
| P3 | ~~补读 04 案例研讨~~ 已完成；同时核对出 `05 案例研讨（丛中）` 不属于本案例（讲的是另一位女性来访者），已在卡里剔除 | 1 份 ✅ |
| P4 | 23 份 `ok_ocr_sample` 若需全文，单独补跑全页 OCR | 23 份 |

**本轮已处理（7 份，全部有对应案例卡）**：

| 材料 | 轮次 | 落成 | 判断依据 |
|---|---|---|---|
| `逐字稿/心理电子书/不敢见人的男生` | 45 | `cbt-02-social-anxiety-teen` | 18 岁但在校高二 + 性议题 → `trainable=false` |
| `文档版-186/心理治疗案例分析` | 16 | `cbt-03-exam-anxiety-senior` | 高三在读 → `minor=true` + `trainable=false` |
| `文档版-186/我的世界没有色彩：抑郁症自杀干预` | 16 | `crisis-01-colorless-world` | 自杀意念 + 既往行动 → `risk=high` + `trainable=false` |
| `文档版-186/酒，我的命根子` | 15 | `behavior-01-alcohol-dependence` | 戒酒硫＋诱导饮酒致呕吐，技术已淘汰 |
| `文档版-186/偷窃而来的快乐` | 12 | `behavior-02-fetish-theft` | 电刺激厌恶疗法 + 恋物细节，技术淘汰且敏感 |
| `逐字稿/个案咨询对话` | 13 | `brief-01-friendship-betrayal` | 女大学生友情议题，可进训练 |
| `逐字稿/心理咨询案例对话(1)` | 22 | `intake-01-entrance-exam-failure` | 高考落榜生初访流程示范，可进训练 |

**已排除**：`03 逐句解析：CBT与格式塔的碰撞`（108 轮，属双面镜案例二，来访者 15 岁，合规排除）；`05 案例研讨：去看见，是一种勇敢`（133 轮，无来访者发言，是张沛超对双面镜四的督导研讨，已补进该卡 §4.5）；`意向对话技术应用案例分析`（22 轮，15 岁初三，整案排除）；`看看心理咨询里的精彩对话` / `高三心理咨询对话`（27 轮同源，高三在读）；`首次心理咨询谈话`（21 轮，与 `心理咨询案例对话(1)` 同源，只计一次）；另 5 份切出轮次但来访者发言为 0（`别让生命太沉重` 38 / `一例聚焦夫妻情绪家庭治疗` 40 / `一例情感与婚姻危机` 22 / `一例男大学生同性恋者` 18 / `大学生心理咨询案例-自卑` 13）。

**填骨架的方法**：读 `turns/*.turns.json` → 逐轮打 eventTags（9 类）→ 给 delta 方向 → 挂督导点评 → 补画像 → 写 ground truth。详见技能 `references/extraction-playbook.md`。

---

## 8. 工具（可复跑）

技能目录：`C:\Users\41391\AppData\Local\Doubao\User Data\Profile 5\.doubao\agent_mode\workspace\.user_skills\psych-corpus-to-worklog`

| 脚本 | 作用 |
|---|---|
| `extract_text.py` | 批量提取 PDF/DOCX/TXT/MD |
| `ocr_pdf.py` | 扫描版补 OCR（续跑 + 大文件抽样） |
| `convert_doc.ps1` | `.doc` → `.docx`（Word COM） |
| `merge_docx.py` | 转出的 docx 提取成 txt 并回写 manifest |
| `classify_texts.py` | 按正文分类，生成三份索引 |
| `build_case_skeleton.py` | 切轮次，生成骨架卡 |
| `clean_dialogue.py` | **切完轮次必跑**：剥离技术注释、动作描写、一段两角色归位、尾部附录与段末小结截断 |
| `case_md_to_json.py` | 案例卡 md → `cases/*.json`（GT 按 `### 3.x` 标题关键词分桶） |
| `build_dataset.py` | 汇总校验 → 生成 `dataset/*.jsonl` + `stats.json` |
| `build_visitors.py` + `spec_visitors.py` | 生成 `dataset/visitors.jsonl`：统计字段从干净数据实算，判断字段来自 SPECS 字典 |
| `build_rubric.py` | 生成 `dataset/rubric.json`：must_do / must_not_do / traps（**待临床复核**） |

**增量更新**：新增资料后重跑 `extract_text.py`（自动跳过已有 txt）→ `classify_texts.py` → `build_case_skeleton.py`。
