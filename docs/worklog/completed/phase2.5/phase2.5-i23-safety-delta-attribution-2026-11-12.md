# I-23 · `dim.safety.delta_avg` 全角色偏低归因备忘（只读，零代码改动）

> 状态：✅ 已交付（2026-11-12）
> 执行方：主控（只读调研；未改业务代码 / 测试 / engine-core；engine-core 文件仅读 + git blame）
> 仓库：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`
> 事实源：`docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md` I-09 / I-23；批次 `g3ONzlqSGMVJqkFMF9Lwh`（96 场）
> 代码锚点：`src/engine-core/cognition/state-transition.ts:197-345`（DELTA_TABLE）；`src/engine-core/cognition/personality-modulator.ts:103-143`（safetyScale）；`src/auto-practice/metrics/acceptance-thresholds.ts:77-137`（基线档）、`:153-171`（cold 候选档）
> 证据文件：`data/quality/safety-slice-96-2026-11-12.txt`；`data/quality/safety-reconcile-96-2026-11-12.txt`

---

## 0. 结论先行

1. **待验假设证伪**：I-23 怀疑"WP-L 同盟正交改造把 safety 增量压小了"。代码证据 + 理论对账双重核实：**WP-L 没有改 safety 列**，safety 增量未被压小。
2. **实测偏低的真实构成**（延续 I-09 三重折扣，并补上第四项"模式稀释"）：基础系数本就小 × 依恋倍率二次压缩 × 正事件率低 × 角色切片混入 cold 场次。
3. **调表还是调判据**：现有证据不支持上调 DELTA_TABLE safety 基础系数（I-09 R-2 已撤回该方向）；问题主要在**判据未按模式分档**——基线档 0.02 是按 expert 输入标定，套在 expert+cold 混合的角色切片上必然不达。cold 档候选表已把 safety 下限放到 0（待主控复核）。
4. **待补证据**：expert-only × 角色交叉切片（需 DB `counselorModeId`）。在拿到该切片前，不对依恋 `safetyScale` 是否偏低下结论。

---

## 1. 问题与假设

**现象**（I-23，本批复现）：`dim.safety.delta_avg` 全 8 角色 0.0075~0.0300；基线档判据下限 0.02，仅安然达线。原记录称"判据下限 0.015，仅安然、语桐达线"。

**待验假设**：WP-L 同盟正交改造后，safety 增量被压小。

## 2. 证据一：代码历史——WP-L 未触碰 safety 列

- WP-L 提交 `401a5a2`（"correct clinical delta table (WP-L)"）对 `state-transition.ts` 的 diff **只改正交五列**：`verbal / depth / style / valence / arousal`；`safety / trust / bond` 三列不在改动行内（diff 中无 `+/-` 前缀）。
- `git blame`：empathy 行 `safety: 0.02` 最后变更于 WP42（`84b24de`，同盟三维独立建模），其后无提交改过 safety 列。
- DELTA_TABLE safety 正向增量（当前值）：empathy 0.02、acceptance 0.02、normalization 0.01、open_probe 0.01、affirmation 0.01；负向：judgment -0.03、preaching -0.02、minimizing -0.02、boundary_cross -0.05、sensitive_touch -0.01。

> 即：正交改造的语义是"建立信任不等于拆防御"，压的是防御列（verbal/depth/style），不是关系增益列（trust/safety/bond）。

## 3. 证据二：理论对账——8 角色全部吻合实测

口径：理论净增量/场 = [Σ(正事件计数 × DELTA_TABLE safety) × safetyScale − Σ(负事件计数 × DELTA_TABLE safety)] / 12 场。
负向事件不乘 safetyScale（modulator 只作用于增益方向，`personality-modulator.ts:132`）。

| 角色（标签）                             | 风格 / safetyScale | 正事件 emp/acc/norm/probe/aff | 理论净增量/场 | 实测 delta | 差值    |
| ---------------------------------------- | ------------------ | ----------------------------- | ------------- | ---------- | ------- |
| 安然 `general_secure_l1`                 | secure / 1.0       | 21 / 1 / 0 / 2 / 0            | 0.0317        | 0.0300     | -0.0017 |
| 语桐 `social_anxious_l1`                 | anxious / 0.7      | 16 / 0 / 1 / 0 / 0            | 0.0159        | 0.0164     | +0.0005 |
| 小满 `self_worth_intellectualization_l1` | anxious / 0.7      | 12 / 1 / 0 / 0 / 0            | 0.0118        | 0.0107     | -0.0011 |
| 惊尘 `trauma_disorganized_l1`            | disorganized / 0.6 | 9 / 3 / 0 / 0 / 0             | 0.0078        | 0.0088     | +0.0010 |
| 沉舟 `depression_avoidant_l1`            | avoidant / 0.5     | 8 / 4 / 0 / 0 / 0             | 0.0092        | 0.0096     | +0.0004 |
| 亦舟 `workplace_intellectualization_l1`  | avoidant / 0.5     | 11 / 1 / 0 / 0 / 0            | 0.0083        | 0.0083     | 0.0000  |
| 念安 `grief_avoidance_l1`                | avoidant / 0.5     | 10 / 3 / 0 / 0 / 0            | 0.0058        | 0.0075     | +0.0017 |
| 晚晴 `intimate_avoidance_l1`             | anxious / 0.7      | 5 / 1 / 1 / 0 / 0             | 0.0076        | 0.0076     | 0.0000  |

- 8 角色理论值与实测同号、同量级，差值绝对值 ≤0.0017，**无系统性偏高或偏低残差**。
- 若表内 safety 系数被压小，理论对账会系统性高于实测、且差距随事件数放大；实际差额可由负向事件减值与 clamp 解释，未观察到该模式。

## 4. 偏低的真实构成（四层）

| 层                 | 数值 / 证据                                                                                                                                             | 性质                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| ① 基础系数小       | safety 单事件 0.01~0.02；trust 0.05~0.10（safety 约为 trust 的 1/5）                                                                                    | 临床设计：首次会谈安全感慢涨，不该快速建立（I-09） |
| ② 依恋倍率二次压缩 | secure 1.0 / avoidant 0.5 / anxious 0.7 / disorganized 0.6；非 secure 再砍 30%~50%                                                                      | 人格调节种子值，待标定单复核                       |
| ③ 正事件率低       | expert 正事件率 16.6%（neutral 82.7%）；cold 正事件率 3.1%（neutral 96.2%）                                                                             | safety 只在正事件上增长，事件少则增量小            |
| ④ 模式稀释         | 角色切片混 expert(6) + cold(6)；cold 切片 safDelta **0.0035**、31/48 场 zero_motion，把角色均值拉低；expert 整体 safDelta **0.0213**（恰达基线档 0.02） | 判据未分模式所致，非系数问题                       |

**渠道观察**：全场 acceptance 14、open_probe 2、affirmation 0，safety 增长几乎独靠 empathy（92 次）。safety 的事件渠道偏窄，属事件识别 / 咨询师侧结构，不是 safety 系数问题。

## 5. 判据口径核对（含一处口径漂移）

| 判据表                                 | safety.delta_avg 下限 | 状态                           |
| -------------------------------------- | --------------------- | ------------------------------ |
| 基线档 `INTAKE_EXPECTATIONS`           | **0.02**（max 0.06）  | 现行硬门槛，按 expert 输入标定 |
| cold 候选档 `INTAKE_EXPECTATIONS_COLD` | **0**（max 0.03）     | 候选值 · 待主控复核（I-21）    |

- I-23 记录的"判据下限 **0.015**"在现行代码中**无对应常量**（基线 0.02、cold 候选 0）；属历史口径漂移，备忘在此更正。旧批判据 0.015 下，安然 0.030、语桐 0.0164 达线；现行 0.02 下仅安然达线。

## 6. 建议方向（不在本备忘实现）

1. **不调 DELTA_TABLE safety 基础系数**：快涨会制造"快速安全感"假象（I-09 R-2 已撤回提系数方向）。
2. **判据按模式分档**：expert 用基线档 0.02，cold 用候选档下限 0；与 intake-v2 模式分层判据同向推进。
3. **待补证据**：从 DB 取 `counselorModeId`，出 expert-only × 角色 safety 切片。若 expert 内非 secure 角色仍普遍低于 0.02，再评估依恋 `safetyScale`（avoidant 0.5 / anxious 0.7 / disorganized 0.6）是否偏低；当前混合切片不足以支撑该结论。
4. **事件渠道**：跟踪 acceptance / open_probe / affirmation 的识别命中，拓宽 safety 增益来源（依赖判定器事件识别能力，同 I-01/I-02 前置阻塞）。

## 7. 复现与证据

```powershell
# 批次指标与切片：data/batch-reports/g3ONzlqSGMVJqkFMF9Lwh.json（byCharacter / byMode）
# 本备忘对账明细：data/quality/safety-reconcile-96-2026-11-12.txt
# 原始切片：data/quality/safety-slice-96-2026-11-12.txt
```

本备忘为只读归因，未产生代码改动；不替代后续 expert-only 切片复核。
