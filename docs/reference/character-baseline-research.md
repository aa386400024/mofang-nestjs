# 角色基线差异化研究（8 角色 · 循证推导）

> 状态：讨论稿（v2，交叉核对版），2026-11-10
> 目的：解决当前 `character_profiles` 按"焦虑/回避两档一刀切"导致同档角色数值完全雷同的问题。
> v2 变更：新增量表真实常模锚定、双路径架构说明、情绪标签核对、量化距离矩阵与蒙特卡洛基线。
> 方法纪律：**文献只负责排序、方向、剖面形状；具体小数是工程锚点，不是临床事实。** 两者严格分开标注。

---

## 0. 方法论：文献能给什么、不能给什么

没有任何已发表论文会写"回避型 trust = 0.28"这种数字。文献能提供三类可引用结论：

1. **排序（ordering）**：四种依恋风格在信任/同盟上的相对高低。
2. **方向（direction）**：焦虑→高唤醒、回避→低唤醒、抑郁迟滞→低效价低唤醒。
3. **剖面形状（profile shape）**：理智化→style 阻抗高；社交焦虑→verbal 高但 depth 低；创伤→解离、波动。

小数转换需要一套**显式工程锚点约定**（§5），并保证：
- 任意两个角色至少有一个维度差异 ≥ 0.05（低于此值内核行为不可区分）；
- 所有数值标注"工程种子值，待真实对练校准"，不冒充临床标定。

---

## 1. 理论框架一：成人依恋四分类（Bartholomew & Horowitz, 1991）

内部工作模型沿"自我意象（正/负）× 他人意象（正/负）"切出四象限：

| 风格 | 自我 | 他人 | 核心人际特征 |
|---|---|---|---|
| **secure 安全型** | 正 | 正 | 能自我暴露、协作、反思 |
| **preoccupied 焦虑型（痴迷）** | 负 | 正 | 渴望亲密、怕被抛弃、高联结渴望 |
| **dismissing 回避型（疏离）** | 正 | 负 | 自我满足、压抑依赖、求助=软弱 |
| **fearful 混乱/恐惧型** | 负 | 负 | 既渴望又害怕，接近—回避冲突 |

**对工程字段的推导：**
- trust / safety 排序：secure 最高，preoccupied 次之（能建关系但焦虑），dismissing 低（不信任他人），fearful 最低（关系本身=危险信号）。
- bond（联结渴望）方向与 safety 不同：preoccupied 最高（强烈渴望），fearful 中等（渴望但被恐惧压住），dismissing 最低（压抑渴望），secure 健康中等。

---

## 2. 理论框架二：情绪环形模型（Russell, 1980，原文已核对）

情绪沿两个近独立双极轴分布：**valence（愉悦—不愉悦）× arousal（激活—去激活）**。

原始论文 8 个锚点的精确角度（已 fetch 原文确认）：
pleasure 0° / excitement 45° / arousal 90° / **distress 135°** / misery 180° / **depression 225°** / sleepiness 270° / contentment 315°。

**推导：**
- 抑郁迟滞角色（沉舟）落在低—低象限（225°）；
- 焦虑/社交焦虑角色（晚晴/语桐）落在低—高象限（135°）；
- 这解释了"同是负效价，抑郁和焦虑必须用 arousal 区分"。

---

## 3. 理论框架三：防御机制层次（Vaillant）与各议题临床特征

### 3.1 理智化（intellectualization）
Vaillant 归为**神经症型防御**：停留在事实与理论层，让情绪无法抵达。典型例："整周查生存率数据，从不说'我害怕'。"
- **推导**：理智化角色（小满、亦舟）`resistance.style` 显著高，`depth` 高。

### 3.2 抑郁的精神运动性迟滞（psychomotor retardation）
PMC 对照研究：迟滞型忧郁症特征是 **noninteractiveness（不互动）**、言语缓慢、应答延迟显著；与焦虑痛苦型靠"低迟滞"区分。
- **推导**：沉舟 verbal/depth 最高之一，arousal 全 8 人最低。

### 3.3 PTSD 四症状簇（DSM-5 / PCL-5）
四簇：侵入、回避、认知与情绪负性改变、**唤醒与反应性改变（含 hypervigilance 过度警觉）**。
- **推导**：惊尘 arousal 高且波动、safety/trust 最低；触及创伤时解离/换题 → depth 高。

### 3.4 社交焦虑的自主神经唤醒（LSAS）
LSAS 明确两条可分离通道：主观恐惧 + **自主神经唤醒（心悸、脸红、出汗、震颤）**；社交场景心率可高于基线 20–40 bpm，脸红（erythrophobia）形成自我强化环。
- **推导**：语桐 arousal 全 8 人最高；verbal 高（言语抑制），但 depth 低（"被评价"的恐惧一触即发）。

### 3.5 哀伤双过程模型（Stroebe & Schut, DPM）
健康哀伤不是线性阶段，而是在 **loss-oriented 与 restoration-oriented 之间振荡（oscillation）**，回避本身是调节机制的一部分。
- **推导**：念安以回避/忙碌为主，但谈伴侣时有触情通道 → depth 比纯抑郁低一档；arousal 有昼夜节律（剧本自述"白天撑、晚上发慌"）。

### 3.6 职业倦怠（burnout）与述情障碍（alexithymia）
- 倦怠核心：情绪枯竭、冷漠/去人格化、效能感下降 → 低能量、低 arousal。
- 述情障碍：难识别/描述情绪、外向性思维，常与理智化、躯体化共现。
- **推导**：亦舟 arousal 低（耗竭而非抑郁）、style 最高、bond 最低。

---

## 4. 依恋风格 → 治疗同盟的实证关系

- 安全型依恋来访者：同盟更稳固、自我探索与暴露更充分、协作理解更好。
- 焦虑/回避策略来访者：建立信任更困难；回避型来访者在关系初期更易保持距离。
- 依据：在线/面对面治疗同盟对照研究（PMC9112077）；同盟预测因素研究（Madrid, 2026）。

---

## 5. 量表真实常模锚定（v2 新增，让锚点有数据支撑）

### 5.1 ECR-R 成人依恋常模（Fraley，N>17,000，1–7 分制）

| 维度 | 总体 M | SD | 两维相关 |
|---|---|---|---|
| Avoidance | 2.92 | 1.19 | .40 |
| Anxiety | 3.56 | 1.12 | |

将 1–7 分线性归一 `(x−1)/6`，锚点带与真实 z 分位对齐：

| z 分位 | Anxiety 分（归一） | Avoidance 分（归一） |
|---|---|---|
| z = −1 | 2.44（.24） | 1.73（.12） |
| z = 0（总体均值） | 3.56（.43） | 2.92（.32） |
| z = +1 | 4.68（.61） | 4.11（.52） |
| z = +1.5 | 5.24（.71） | 4.71（.62） |

含义：工程锚点（.2/.3/.4/.5/.6/.7）不是随意取的整十数，而是落在真实总体的可识别 z 分位上。

### 5.2 临床量表 cutoff（独立第二来源）

| 量表 | 分级阈值 |
|---|---|
| **PHQ-9** 抑郁 | 0–4 无 / 5–9 轻 / 10–14 中 / 15–19 中重 / 20–27 重 |
| **PCL-5** PTSD | 总分 0–80，cutoff ≥33 为可能 PTSD |
| **LSAS** 社交焦虑 | 筛查 cutoff 30；缓解 ≤35–36；临床显著变化点 ≈46 |

这些 cutoff 用于核对角色"严重度档位"：本批 8 角色均为 L1（轻度/训练档），故没有角色落到极端锚点（0.1 以下/0.75 以上），与量表轻度区间一致。

---

## 6. 8 角色基线建议表（含情绪标签核对）

| 角色 | 依恋 | trust | verbal | depth | style | valence | arousal | safety | bond | 情绪标签 |
|---|---|---|---|---|---|---|---|---|---|---|
| **安然** general_secure | secure | 0.65 | 0.25 | 0.25 | 0.30 | -0.15 | 0.45 | 0.70 | 0.50 | guarded |
| **晚晴** intimate | preoccupied | 0.32 | 0.45 | 0.40 | 0.35 | -0.45 | 0.55 | 0.35 | 0.65 | guarded |
| **小满** self_worth | preoccupied | 0.30 | 0.40 | 0.55 | 0.65 | -0.48 | 0.50 | 0.35 | 0.55 | guarded |
| **语桐** social_anxious | preoccupied | 0.35 | 0.55 | 0.30 | 0.30 | -0.40 | **0.72** | 0.40 | 0.50 | anxious |
| **沉舟** depression | dismissing | 0.18 | 0.65 | 0.70 | 0.55 | **-0.65** | **0.18** | 0.20 | 0.15 | empty |
| **念安** grief | dismissing | 0.25 | 0.55 | 0.50 | 0.50 | -0.55 | 0.35 | 0.25 | 0.20 | sad |
| **亦舟** workplace | dismissing | 0.22 | 0.50 | 0.65 | **0.70** | -0.55 | 0.25 | 0.25 | 0.10 | sad |
| **惊尘** trauma | fearful | **0.10** | 0.50 | 0.60 | 0.45 | -0.60 | 0.64 | **0.10** | 0.45 | hurt |

证据映射：关系三维依据 §1+§4；valence/arousal 依据 §2+§5；理智化两角色 §3.1+§3.6；沉舟 §3.2；惊尘 §3.3；语桐 §3.4；念安 §3.5。

**两处循证微调（v1→v2）：**
- 沉舟 arousal 0.20→**0.18**：内核 `empty` 标签要求 arousal<0.2，原值 .20 会被解析成 "sad"，与迟滞空洞的临床意图不符。
- 惊尘 arousal 0.65→**0.64**：arousal≥0.65 且 valence≤−0.5 会被解析成 "angry"，但创伤默认状态不是敌意（PCL-5 高唤醒以恐惧为主），.64 落 "hurt"。

---

## 7. 量化区分度验证（脚本可复算）

### 7.1 两两距离与蒙特卡洛基线（8 维标准化欧氏距离）

| 基线 | 最小距离 P5 | 中位数 | P95 |
|---|---|---|---|
| 全立方体均匀随机（不公平参照） | .433 | .641 | .825 |
| **约束随机（临床可行域内，公平参照）** | **.197** | **.293** | **.380** |
| 本方案 | 最小 .248（沉舟—亦舟） | — | 最大 1.074 |

**诚实解读：**
- 全立方体随机基线偏高，是因为它允许点落在正效价、极端角落等真实角色不会出现的区域，不能直接比。
- 在**临床可行域内**，本方案最小距离 .248 处于约束随机分布第 21 百分位——略低于随机中位数，但远高于第 5 百分位，**不属于异常聚集**。低于中位数是刻意的临床相似性（沉舟/亦舟同为低唤醒，靠 style/verbal 区分）。
- 原"双胞胎"问题是距离 0，已彻底消除。

### 7.2 可区分性硬检查
- 逐对计算最大单维差异：**单维最大差异 < 0.05 的角色对 = 0**，即每一对角色都至少有一个维度达到可区分阈值。

### 7.3 各维度分布（无维度塌缩）

| 维度 | 均值 | SD | 跨度 |
|---|---|---|---|
| trust | .296 | .154 | .55 |
| verbal | .481 | .112 | .40 |
| depth | .494 | .153 | .45 |
| style | .475 | .144 | .40 |
| valence | -.479 | .145 | .50 |
| arousal | .455 | .175 | .54 |
| safety | .325 | .168 | .60 |
| bond | .388 | .193 | .55 |

8 个维度跨度均 ≥ .40，没有任何一维被压成常数。

### 7.5 真实函数端到端确认（最终核实）
用 tsx 直接 import 代码里真实的 `buildCharacterProfile(seed, undefined)`（无 preset，自动对练路径）跑全部 8 个候选值，并调用真实 `resolveEmotionLabel`：
- 输出的 trust / 三维阻抗 / valence / arousal / safety / bond 与 §6 建议表**逐字段一致**；
- 真实函数渲染标签：安然/晚晴/小满 guarded、语桐 anxious、沉舟 empty、念安/亦舟 sad、惊尘 hurt，与预期完全吻合；
- 所有候选值通过 `validateSeedRanges` 区间自检。验证脚本为临时文件，已删除，未污染仓库。

### 7.4 起始决策分区（内核阈值 open=.6 / rTrust=.4 / rSafety=.3）

- **A 区（可探索，min(trust,safety)≥.6）**：安然（.65）
- **B 区（信任受限、安全尚可）**：晚晴、小满、语桐（trust .30–.35，safety .35–.40）
- **C 区（信任+安全双低，safety<.3）**：沉舟、念安、亦舟、惊尘

只有安全型开场即可探索，其余均需先建同盟——与 §4 实证一致，且由内核门槛确定性推导。

---

## 8. 双路径架构说明（v2 新增，避免误读）

代码里存在两条不同的运行路径，基线消费方式不同：

| 路径 | 入口 | preset | 实际生效的 arousal |
|---|---|---|---|
| **自动对练 / 调试** | DebugSessionService → `resolver.resolve({templateId})` | **不传 preset** | 用 character_profiles 的 seed 值（即本研究表，雷达图准确） |
| **真实语音会话** | voice-gateway → resolveVoicePreset | 传来访池默认（emotionBaseline .30–.40） | preset 覆盖 seed arousal |

- 雷达图反映的是**自动对练路径**，本研究的差异化数值在该路径直接生效。
- 来访池 `emotionBaselineDefault`（晚晴 .35 / 亦舟 .30 / 念安 .40 / 小满 .35）只在语音会话路径生效，与 seed 值不同，是两套独立数据，改动时需分别评估。

---

## 9. 落地边界（待确认后再动代码）

- seed 内 4 角色（晚晴/小满/念安/亦舟）：改 `CHARACTER_PROFILE_SEED_SPECS` 数值。
- 另外 4 个（沉舟/安然/语桐/惊尘）不在 seed，需先确认来源（DB 手加 / builtin / 迁移），再决定补 seed 还是改 DB。
- 不改内核 `engine-core`、不改默认值、不改列结构。
- 重跑 seed 走幂等 upsert，hasDrift 命中 UPDATE；不自动 commit。
- 所有数值保持"工程种子值"标注，内测后按真实对练数据再校准。

---

## 参考文献（可点击）

1. Bartholomew & Horowitz (1991), Four-Category Model — http://psychocrimino.free.fr/wp-content/uploads/Horowitz1991.pdf
2. Attachment theory in adult psychiatry, Cambridge — https://core-cms.prod.aop.cambridge.org/core/journals/advances-in-psychiatric-treatment/article/attachment-theory-in-adult-psychiatry-part-1-conceptualisations-measurement-and-clinical-research-findings/C1084D49C14D769C7FDA3A19CC6A0E9C
3. Russell (1980), A Circumplex Model of Affect（原文已核对）— http://pdodds.w3.uvm.edu/research/papers/others/1980/russell1980a.pdf
4. Vaillant, A Glossary of Defenses — http://www.columbia.edu/itc/hs/medical/clerkships/psych/misc/articles/valiant.pdf
5. Defense Mechanisms — https://psychology.com/tools/pdf/defense-mechanisms.pdf
6. Psychomotor disturbance: anxious vs melancholic, PMC — https://pmc.ncbi.nlm.nih.gov/articles/PMC11471942/
7. Depressive Illness (BMJ) — https://pmc.ncbi.nlm.nih.gov/articles/PMC1912993/pdf/brmedj02116-0045.pdf
8. PTSD Clusters — https://neurolaunch.com/ptsd-clusters/
9. PCL-5 — https://mdcodelookup.com/ptsd-checklist-pcl5/
10. LSAS — https://en.arabpsychology.com/scales/liebowitz-social-anxiety-scale-lsas-2/
11. Social Anxiety Symptoms — https://socialanxiety.co/social-anxiety-symptoms/
12. Stroebe & Schut, DPM (Utrecht) — https://dspace.library.uu.nl/server/api/core/bitstreams/104f8e69-4f54-4206-ae32-358d9c5d406f/content
13. DPM overview — https://www.changesinbetween.com/dual-process-model-of-coping-with-bereavement/
14. Therapeutic Alliance and Attachment, PMC — https://pmc.ncbi.nlm.nih.gov/articles/PMC9112077/
15. Predictors of Therapeutic Alliance (2026) — https://journals.copmadrid.org/clysa/art/clh2026a5
16. ECR-R Norms (Fraley) — https://labs.psychology.illinois.edu/~rcfraley/measures/ecrr.htm
17. PHQ-9 Severity (APA) — https://www.psychiatry.org/File%20Library/Psychiatrists/Practice/DSM/DSM-5-TR/APA-DSM5TR-SeverityMeasureForDepressionAdult.pdf
18. LSAS remission thresholds, PMC — https://pmc.ncbi.nlm.nih.gov/articles/PMC10940979/
19. Burnout Review, PMC — https://pmc.ncbi.nlm.nih.gov/articles/PMC8834764/
20. Alexithymia, PMC — https://pmc.ncbi.nlm.nih.gov/articles/PMC8456171/
