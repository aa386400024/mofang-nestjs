# 出口④ 临床标注协议 · 六维真值 schema / 双人盲标 / 仲裁 / 覆盖率与缺口

> **任务**：AF-091 · Phase2.5 长会话档案与出口④临床标注协议
> **日期**：2026-11-18 · **分支**：integrate · **基线**：af4c0c8
> **结论先行**：**出口④ 当前只能判「未通过 / 部分可判」** —— 真实素材够做标注**规程**与**基线校准**，
> 但不够做「六维建议准确率 ≥ 80%」的**验收**（verbal / depth / style 三维零真值）。
> **不得用合成数据（`synthetic-supervisor-v1`）冒充 80% 验收。**

---

## 0. 这份协议解决什么问题

AF-088 对出口④给出的判定是「❌ 未通过 / 不可判定」，理由是评测集 `synthetic=true`。
那条结论是对的，但它只说了「**不可判**」，没回答「**要怎样才可判**」。

本协议把三件事写死：

1. **真值长什么样** —— 六维 schema（维度定义 / 方向口径 / 值域 / 标注单元）；
2. **谁来标、怎么标、标完怎么算** —— 双人盲标 + 仲裁 + 一致性门槛 + 评分公式；
3. **现在还差多少** —— 12 份真实案例卡 / 496 轮的逐维覆盖率与缺口，以及补齐路径。

> ⚠️ 本协议**不是**验收结论。它交付的是**可执行标准 + 现状盘点**。
> 出口④ 的正式结论仍是「未通过 / 部分可判」，直到真实督导标注到位并按本协议算出分数。

---

## 1. 出口④的验收口径（不可改写）

| 项 | 口径 | 真相源 |
|---|---|---|
| 验收项 | 审议建议准确率 **≥ 80%**（用督导解析当 ground truth 自动评测） | AF-088 证据 `data/phase25-exit/af088-exit345-evidence-2026-11-18.json` → `exit4.criterion` |
| 被测对象 | 规则 + 审议 相对 纯规则基线 的六维方向准确率提升 | 同上 → `baselineComparison` |
| 分子分母来源 | **必须是真实督导逐轮标注** | `src/engine-adapters/eval/eval.types.ts`（`synthetic` 是必填字段） |
| 判定纪律 | 合成数据只能证明「链路可用」，**不能**作验收结论 | AF-088 `exit4.warnings`（报告自带告警） |
| 真值维度名单 | `trust / safety / bond / verbal / depth / style`（**只有这一份**） | `src/engine-adapters/eval/eval.types.ts` → `EVAL_DIMENSIONS` |

**为什么是六维**：同盟三维（信任 / 安全感 / 纽带感）+ 阻抗三维（话量 / 深度 / 风格）。
内核另有 valence / arousal / positive / negative / dependency 五维（情绪 + 移情），
它们**不进**临床可解释的建议口径 —— 情绪是状态描述，移情是长周期关系变量，
混进同一个"准确率"里，分数升高说不清是哪件事变好了。

---

## 2. 六维真值 schema

### 2.1 维度定义与标注口径

| 维度 | 临床含义 | 标注对象 | 值域 | 方向判定 |
|---|---|---|---|---|
| `trust` | 来访者对咨询师的信任水平变化 | 本轮咨询师发言引发的关系变化 | [-1, 1] | \|delta\| ≤ 0.01 → `flat` |
| `safety` | 来访者的安全感 / 心理安全水平变化 | 同上 | [-1, 1] | 同上 |
| `bond` | 联盟纽带感（关系联结强度）变化 | 同上 | [-1, 1] | 同上 |
| `verbal` | 话量阻抗变化（说得多少、说得多快、多碎） | 同上 | [-1, 1] | 同上 |
| `depth` | 内容深度阻抗变化（议题多深、触及多深的材料） | 同上 | [-1, 1] | 同上 |
| `style` | 表达风格阻抗变化（理智化 / 情感化 / 具体化程度） | 同上 | [-1, 1] | 同上 |

**方向判定中性带**：`EVAL_DIRECTION_EPSILON = 0.01`（`src/engine-adapters/eval/eval.types.ts`）。
⚠️ 不用 0：数值有浮点噪声，0.004 的变化临床上没有意义，判成"涨了"会让方向准确率被浮点尾数支配。

### 2.2 标注单元（粒度到轮）

- **1 轮 = 1 次咨询师发言 + 其引发的来访者反应**（与 `ap_practice_turns` / 案例卡 `turns[].i` 的口径一致）。
- 标注**逐轮**给出；**不允许**按"整场印象"给一个总分 —— 逐字稿里的轮次信息（谁说了什么、来访者当场有没有反应）
  才是可核对的东西，整场印象无法仲裁、无法复算。
- 每轮标注记录（**最小记录单元**）：

  | 字段 | 说明 |
  |---|---|
  | `case_id` / `turn_index` | 定位键 |
  | `directions{6 维}` | 每维 `up` / `flat` / `down` |
  | `magnitudes{6 维}` | 每维期望 delta（[-1, 1]），`flat` 维写 0 |
  | `evidence` | 原文依据（轮次号 + 一句话理由），**不含原文全文**（隐私红线 AGENTS.md §5.4） |
  | `quality` | `gold` / `borderline` / `bad`（沿用案例卡口径） |
  | `confidence` | `high` / `medium` / `low`（`low` 的轮次进入仲裁队列） |

### 2.3 事件标签与六维真值的关系（别混用）

案例卡里已有两套标签，它们**都不是**六维真值：

| 标签 | 是什么 | 能不能当六维真值 |
|---|---|---|
| `events[]` | 咨询师做了什么（9 类干预/负向动作） | ❌ 是**动作**分类，不是关系状态变化 |
| `quality`（gold/borderline/bad） | 这一轮**做得好不好** | ❌ 是**质量**判断，不是六维方向/幅度 |
| `delta{trust,safety,bond,resistance,emotionValence}` | 部分轮次已有的关系状态变化 | ⚠️ 只覆盖五维中的三维（见 §4） |

**口径纪律**：事件标签与质量等级可以**直接**用于"该不该拦 / 做没做到"这类断言评测（rubric 口径），
但**不能**当成六维建议准确率的真值。

---

## 3. 双人盲标 + 仲裁流程

### 3.1 角色

| 角色 | 职责 | 硬要求 |
|---|---|---|
| 标注员 A | 独立标注 | 看不到 B 的任何结果 |
| 标注员 B | 独立标注 | 看不到 A 的任何结果 |
| 仲裁员 C | 裁决分歧轮次 | 具备临床资质；不得参与前两人标注 |
| 临床负责人 D | 协议版本签署 / 抽检 | 每批次抽检 ≥ 5% 轮次 |

### 3.2 盲标怎么做（可执行口径）

1. **派单随机化**：标注平台只暴露 `case_id` 的**匿名代号**与逐字稿正文；
   不暴露流派、督导姓名、`gold_turns` / `borderline_turns` / `bad_turns` 锚点、`trainable`、`risk`。
   —— 理由：锚点本身就是一种答案，先看到锚点会把"标注目录"变成"核对目录"。
2. **独立提交**：A、B 各自完整标完全部轮次后提交；提交后**不可编辑**（只能被仲裁覆盖并留痕）。
3. **一致性先于仲裁**：κ / ICC 一律在**仲裁前的双人原始标注**上计算。
   ⚠️ 先仲裁再算一致性会把分数人为拉高 —— 那不是"标注可复现"的证据。
4. **仲裁**：仅对分歧轮次（方向不同，或幅度差 > 0.05）由 C 裁决；C 的结论作为最终真值，
   同时保留 A/B 原始值（供后续分析标注员难度）。
5. **抽检**：D 每批抽检 ≥ 5% 已仲裁轮次；若抽检发现 C 的结论与证据不符 > 10%，该批整批回炉重标。

### 3.3 一致性门槛（达不到 = 该维不可判）

| 指标 | 口径 | 门槛 | 不达标怎么办 |
|---|---|---|---|
| 方向一致性 | Cohen's κ（三分类 up/flat/down） | **κ ≥ 0.60** | 该维标 `不可判`，**退出 80% 的分子与分母** |
| 方向一致性（子集） | 排除 `flat` 后的两分类 κ | κ ≥ 0.60 | 同上（作为主口径的补充） |
| 幅度一致性 | ICC(2,1) 或 方向判对轮次上的 MAE | **MAE ≤ 0.05**（对齐 `RULE_DIFF_AMPLITUDE_THRESHOLD`） | 幅度指标不报数，只报方向 |
| 样本量 | 每维有效（signal）轮次数 | **≥ 100 轮** | 该维结论只能写「样本不足」，不得给百分数 |
| 仲裁率 | 分歧轮次 / 总轮次 | ≤ 40% | 协议或标注指引要复盘（可能定义不清） |
| 抽检通过率 | D 抽检合格比例 | ≥ 90% | 该批回炉 |

### 3.4 评分公式（80% 到底是什么）

```
触发质量（闸门准不准）:
  precision = TP / (TP + FP), recall = TP / (TP + FN), F1 = 2PR / (P + R)
  真值 = "这一轮该不该跑审议"（督导标注）

建议质量（六维准不准）:
  对每一维 d ∈ {trust, safety, bond, verbal, depth, style}:
      support_d = 该维有真值且真值非 flat 的轮次数 (signal turns)
      acc_d     = 方向判对轮次 / support_d
  macroAverage = mean(acc_d for d where support_d ≥ 样本量门槛)
  amplitudeMAE = mean(|幅度误差| for 方向判对的轮次)

基线对比:
  directionAccuracyDelta = macroAverage(规则+审议) − macroAverage(纯规则)
```

**三条硬纪律**：

1. **缺真值的维不参与平均，也不许用 0 填充。**（`eval.types.ts` 里 `signalTurns` 的注释就是这个意思：
   "某一维如果整场都是平稳，真值恒为 0，那么'全押平稳'的退化解就能在这一维拿满分"。）
2. **分母是 signal turns，不是全部轮次。**
3. **分子分母必须来自真实督导标注**；`synthetic=true` 的数据集只能证明链路可用。

---

## 4. 现有真实案例覆盖率报告（实测，非估算）

> 复现命令（只读，不改任何文件）：
> ```bash
> node -e "const fs=require('fs'),p=require('path');const d='docs/reference/psych-dataset/cases';
> const fs2=fs.readdirSync(d).filter(f=>f.endsWith('.json')).sort();let T=0;const dim={};
> for(const f of fs2){const j=JSON.parse(fs.readFileSync(p.join(d,f),'utf8'));for(const t of j.turns||[]){T++;for(const k of Object.keys(t.delta||{}))dim[k]=(dim[k]||0)+1;}}
> console.log('cases',fs2.length,'turns',T,JSON.stringify(dim));"
> ```
> 结果：`cases 12 turns 496 {"trust":461,"bond":22,"resistance":16,"safety":32,"emotionValence":5}`

### 4.1 逐案例明细

| case_id | 轮数 | gold | borderline | bad | 已有 delta 维（轮） | 第三方督导数 | risk | 可训练 |
|---|---|---|---|---|---|---|---|---|
| psychoanalysis-01-double-life | 121 | 11 | 13 | 2 | trust 97 / safety 12 / emotionValence 5 / resistance 3 | 3 | low | ✅ |
| shuangmianjing-04-insecure-man | 94 | 37 | 7 | 0 | trust 94 / safety 3 | 3 | low | ✅ |
| shuangmianjing-03-marriage-wife | 74 | 25 | 11 | 1 | trust 74 / bond 8 / safety 3 / resistance 3 | 2 | medium | ✅ |
| shuangmianjing-01-mother-daughter | 56 | 24 | 8 | 0 | trust 55 / safety 8 / bond 3 | 2 | medium | ✅ |
| cbt-02-social-anxiety-teen | 45 | 10 | 5 | 0 | trust 44 / safety 1 / bond 2 | 2 | low | ❌ 在校生性议题 |
| intake-01-entrance-exam-failure | 22 | 5 | 3 | 0 | trust 22 | 1 | low | ✅ |
| crisis-01-colorless-world | 16 | 11 | 4 | 0 | trust 16 / safety 2 | 1 | high | ❌ risk=high |
| cbt-03-exam-anxiety-senior | 16 | 7 | 2 | 0 | trust 15 / bond 1 / resistance 1 | 1 | low | ❌ 高三在读 / 未成年 |
| behavior-01-alcohol-dependence | 15 | 7 | 2 | 3 | trust 12 / bond 3 / resistance 3 | 1 | medium | ❌ 技术已淘汰 |
| brief-01-friendship-betrayal | 13 | 8 | 2 | 0 | trust 13 / safety 2 | 1 | low | ✅ |
| couples-01-control-dependent | 12 | 2 | 4 | 3 | trust 10 / bond 2 / resistance 3 / safety 1 | 1 | medium | ❌ |
| behavior-02-fetish-theft | 12 | 6 | 2 | 3 | trust 9 / bond 3 / resistance 3 | 1 | medium | ❌ 技术已淘汰 + 敏感 |
| **合计** | **496** | **153** | **63** | **12** | — | **20 人次 / 12 案** | 6 low · 5 medium · 1 high | 6 案可训练 |

事件标签分布（全 496 轮）：`open_probe 309 / empathy 19 / affirmation 12 / preaching 11 / normalization 4 / minimizing 4 / judgment 1`；
负向标签 16 条。质量分布：`normal 268 / gold 153 / borderline 63 / bad 12`。

### 4.2 逐维覆盖率（**核心缺口表**）

| 临床维度 | 有 delta 标注的轮次 | 其中非平坦（signal, \|d\|>0.01） | 距"可算"门槛（≥100 signal 轮）的缺口 | 当前可判性 |
|---|---|---|---|---|
| `trust` | **461** | **49** | 缺 ≥ 51 signal 轮 | ⚠️ 有限样本可算（方向基线） |
| `safety` | **32** | 32 | 缺 ≥ 68 signal 轮 | ⚠️ 有限样本可算 |
| `bond` | **22** | 22 | 缺 ≥ 78 signal 轮 | ⚠️ 有限样本可算 |
| `verbal` | **0** | **0** | 全缺 | ❌ **不可算** |
| `depth` | **0** | **0** | 全缺 | ❌ **不可算** |
| `style` | **0** | **0** | 全缺 | ❌ **不可算** |

**两个必须说清的口径事实**：

1. **`trust` 的 461 轮里有 412 轮是"平坦"（|delta| ≤ 0.01）** —— 也就是说真正带信号的只有 49 轮。
   拿 461 当分子分母算出来的"准确率"会被"全押 flat"的退化解刷分（本仓库的 `signalTurns` 注释已经点破了这件事）。
2. **案例卡里的 `resistance`（16 轮）是**单一聚合维度**，不是 `verbal` / `depth` / `style` 三维之一**。
   把它拆成三个维度的值就是**编数据** —— 本协议明确禁止。`emotionValence`（5 轮）不在六维名单里，
   也不参与。

### 4.3 断言层（rubric）覆盖率

| 项 | 值 | 状态 |
|---|---|---|
| 覆盖案例 | 11 案（**缺 `couples-01-control-dependent`**） | `draft-needs-clinical-review` |
| `must_do` | 51 条（带 `fail_if`） | 待真人临床复核 |
| `must_not_do` | 40 条（severity `red` / `amber`） | 待真人临床复核 |
| `traps` | 17 条 | 取自案例卡 §3 的 borderline 判断 |

⚠️ 断言层是"**该不该拦 / 做没做到**"的验收口径，**不是**六维建议准确率的口径。两者不可互相顶替。

---

## 5. 结论：当前只能判「未通过 / 部分可判」

| 判据 | 现状 | 结论 |
|---|---|---|
| 真实督导逐轮**六维**标注 | 三维有零散 delta（trust 461 / safety 32 / bond 22），**三维零**（verbal / depth / style） | ❌ 不满足 |
| 每维 signal 轮次 ≥ 100 | 0 / 3 维达标（trust 49、safety 32、bond 22 均 < 100） | ❌ 不满足 |
| 双人盲标 + 仲裁 | 仓库内**无**任何逐轮六维双标记录 | ❌ 不满足 |
| 一致性门槛（κ ≥ 0.60） | 无原始双标数据，**不可算** | ❌ 不可算 |
| 合成评测（`synthetic-supervisor-v1`） | macroAverage 0.833379 / trigger F1 0.64 / 有效 4-8 场 / `synthetic=true` | ⚠️ 仅证明链路可用，**不得**作验收 |

**正式结论（与 AF-088 一致，本单细化）**：

> **出口④ = 未通过 / 部分可判。**
> - **可判（有限）**：`trust` / `safety` / `bond` 三维在现有真实素材上可建立**方向基线**，
>   但样本量低于门槛（49 / 32 / 22 signal 轮），任何百分数都只能标注为"样本不足的探索值"，**不构成验收**。
> - **不可判**：`verbal` / `depth` / `style` 三维零真值，**任何**数字都是编的。
> - **触发质量**（闸门该跑不该跑）同样没有真实逐轮真值 → 不可算。
> - **合成评测的 0.833 不得写成 80% 达标。**

---

## 6. 补齐路径（做到"可判"需要什么）

### 6.1 最小可行试点（建议下一步）

| 项 | 建议 |
|---|---|
| 试点素材 | 双面镜一 / 三 / 四（**有第三方督导**，合计 224 轮 / 74 gold / 26 borderline / 1 bad） |
| 试点目标 | 三维（trust / safety / bond）走通"双人盲标 → κ → 仲裁 → 评分"全流程，产出**第一份真实六维标注** |
| 试点规模 | 224 轮 × 6 维 × 2 人 = **2688 人维标注**（+ 仲裁，按 30% 分歧率估 ≈ 800 轮次仲裁） |
| 试点验收 | κ ≥ 0.60（信任维）+ 抽检通过率 ≥ 90% + 至少 1 维 signal 轮次 ≥ 100 |
| 明确不做 | 不引入合成数据补量；不把 `resistance` 拆成三维；不改案例卡原文 |

### 6.2 全量达标条件

- 六维每维 **signal 轮次 ≥ 100**（当前 0 / 3 维达标）；
- 触发质量真值：**逐轮**"该不该跑审议"标注（建议 ≥ 300 轮，含 ≥ 60 个正例，否则 P/R 不可靠）；
- 全部标注走完双人盲标 + 仲裁，且**仲裁前**原始标注留存（用于 κ 复算）；
- 评测报告的 `config.synthetic = false`，`groundTruthKind = supervisor`；
- 分数用本协议 §3.4 的公式算，且**报告里必须同时给出每维 support**（缺真值的维写 `null`，不写 0）。

### 6.3 关联的未决口径（需要产品 / 临床拍板）

1. **阻抗三维的标注锚点**：话量 / 深度 / 风格的"期望变化"在真实咨询里由谁定义？（督导的"这一轮做得好不好"能不能推出三维方向？—— 本协议默认**不能**。）
2. **长会话维度**（AF-091 引入的 40-50 轮场景）：现有 12 案例最长 121 轮但都是**长程案例**而非"单次 50 分钟咨询"，
   用它们标长会话，样本代表性需要单独评估。
3. **未成年 / 高风险 / 已淘汰技术案**（`cbt-02` / `cbt-03` / `crisis-01` / `behavior-01` / `behavior-02` / `couples-01`）：
   这些案在数据集里不可训练，但**必须**留在评测集（判"该拦的拦住没有"）。
   标注它们时，标注员需要额外资质与伦理口径 —— 当前 `rubric.json` 状态是 `draft-needs-clinical-review`，尚无定稿。

---

## 7. 禁止事项（红线）

| # | 禁止 | 原因 |
|---|---|---|
| 1 | 用 `synthetic-supervisor-v1` 或任何合成集的分数充当 80% 验收 | 分子分母都不是真人判断 |
| 2 | 用**规则 delta**（`rule_diff` 口径）冒充督导真值 | 评出来的是"审议与规则一致的比例"，与临床准不准无关 |
| 3 | 把 `resistance`（16 轮）拆成 verbal / depth / style | 编数据；维度不可由聚合值反推 |
| 4 | 用案例卡的 `gold` / `bad` 质量标签当六维方向真值 | 质量判断 ≠ 关系状态变化 |
| 5 | 缺真值的维用 0 填充进 macro 平均 | 抬高分数（退化解：全押 flat） |
| 6 | 先仲裁再算一致性 | 人为拉高 κ，不构成"可复现"证据 |
| 7 | 标注记录里写进逐字稿全文 | 隐私红线 AGENTS.md §5.4（心理原文禁止进普通日志 / 报告） |
| 8 | 未标注的轮次按"无变化"处理 | "不知道"与"确实没变"是两回事 |

---

## 8. 溯源

| 事实 | 位置 |
|---|---|
| 六维名单 / 方向口径 / signalTurns 纪律 | `src/engine-adapters/eval/eval.types.ts` |
| 真值提供者（督导口径 vs 规则差异口径） | `src/engine-adapters/eval/eval.ground-truth.ts` |
| 案例卡真源（12 案 / 496 轮） | `docs/reference/psych-dataset/cases/*.json` |
| 标注视图（turns.jsonl 496 行） | `docs/reference/psych-dataset/dataset/turns.jsonl` |
| 断言层（11 案 / 51 / 40 / 17，状态 draft） | `docs/reference/psych-dataset/dataset/rubric.json` |
| 数据集卡片（规模 / 偏差 / 扩容瓶颈） | `docs/reference/psych-dataset/DATASET-CARD.md` |
| 出口④ 既有证据（合成评测 / 判定 / 遗留项） | `data/phase25-exit/af088-exit345-evidence-2026-11-18.json` |
| AF-088 交付记录 | `docs/worklog/completed/phase2.5/af088-phase25-exit345-evidence-2026-11-18.md` |
| 本单交付记录 | `docs/worklog/completed/phase2.5/af091-phase25-session-realism-2026-11-18.md` |
