# WP-L · 临床增量表纠正 + 12 轮档验收口径重写（修复 · 企业级/临床级）

> 状态：✅ 已完成（2026-11-11）。代码与文档落盘、静态闸门全绿；16 场重跑通过（16/16 completed、llm_call_ratio=1.0、intake 验收 PASS、语桐 depth 终值 0.25/0.275 不触底）。交付记录见 `docs/worklog/completed/phase2.5/wp-l-clinical-delta-and-acceptance-correction-2026-11-11.md`。
> 执行方：自做 / 可派 MiniMax Code
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 `integrate`
> 唯一事实源：`docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md`（19 条问题 + 6 条撤回）
> 任务性质：**内核协议变更**（改 `DELTA_TABLE` 常量）
> 前置依赖：**WP-K 必须先完成**（没有批次对比工具，就无法判断本单是改好还是改坏）

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `README.md` → 2. `docs/README.md` → 3. `docs/team/conventions.md`（**§1.1 分层 + 16 条硬约束**）
2. `docs/worklog/pending/phase2.5-README.md` + `phase2.5-wp-list-2026-11-08.md`
3. **唯一事实源**：`docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md`（必读 §2 的 I-03/I-04/I-05/I-06/I-07/I-08/I-20）
4. 本任务单

---

## 1. 背景（为什么必须改）

### 1.1 一件事，不是七件事

现有 `DELTA_TABLE` 把「同盟上升」与「阻抗下降」写成**等量反向配平**：

```
empathy:  trust +0.10  /  depth −0.10  /  style −0.06
acceptance: trust +0.08 /  depth −0.08 /  style −0.05
```

结果是：**共情每来一次，来访者的防御就等量塌一次**。这在临床上是错的——
「我信任你」与「这事我还不想说」是**正交**的两种状态，可以同时成立。现在的模型表达不了这句话。

### 1.2 硬证据（逐轮 delta 实测，不可辩驳）

语桐（anxious）/expert，12 轮，3 次 empathy（`debug_WTVIHzzXUDGbcF7C74P0h`）：

| 轮        | 事件    | d_trust    | d_safety   | d_depth    | d_valence  | d_arousal  |
| --------- | ------- | ---------- | ---------- | ---------- | ---------- | ---------- |
| 4         | empathy | **+0.120** | **+0.014** | **−0.125** | **+0.100** | **−0.050** |
| 8         | empathy | +0.120     | +0.014     | −0.125     | +0.100     | −0.050     |
| 9         | empathy | +0.120     | +0.014     | **−0.050** | +0.100     | −0.050     |
| 其余 9 轮 | neutral | 0          | 0          | 0          | 0          | 0          |

读法（三点都已核验）：

1. `+0.120 = 0.10×1.2(anxious trustScale)`、`+0.014 = 0.02×0.7(anxious safetyScale)`、`−0.125 = −0.10÷0.8(anxious resistanceScale)` → **人格系数精确生效**；
2. 第 9 轮 `−0.050` 而非 `−0.125` → **depth 只剩余量 0.050，被 clamp 触底**；
3. 结论：**3 次共情就把焦虑型的深度防御打穿到 0**。不是"12 轮内缓慢降低"，是断崖。

同一份数据还暴露两件事：

- `valence +0.100 / arousal −0.050` 与安然（secure）**完全相同** → 情绪维度没有角色级调节（I-20）；
- `sensitive_touch` 只给 `valence −0.05`，而 `empathy` 给 `+0.10` → **一次共情抵两次触碰痛处**（I-07）。

### 1.3 为什么不能只改"门槛"或"轮次"

已推演并撤回的三个方案（**不要再提**）：

| 撤回的方案                                         | 为什么不行                                 |
| -------------------------------------------------- | ------------------------------------------ |
| `safety` 0.02 → 0.05，trust 收敛 2:1               | 临床上把安全感和信任当作可换算的量，是错的 |
| 「12 轮内 safety 有 0.138~0.24 可够 0.6」          | 目标本身不成立：12 轮不该到 0.6            |
| 阶段机用 `safety ≥ 基线 + 0.12` 作 12 轮内转换条件 | 12 轮是 intake 档，不该发生阶段转换        |

**12 轮 ≈ 首次会谈的 20-25 分钟。这个阶段的临床目标不是"打开"，是"留在场"。**

---

## 2. 范围（严格遵守）

**在范围内：**

1. 改 `src/engine-core/cognition/state-transition.ts` 的 `DELTA_TABLE` —— **resistance 三维**（`verbal` / `depth` / `style`）
2. 同文件改 —— **情绪二维**（`valence` / `arousal`）
3. 新增一份「12 轮档 intake 验收口径」文档，并在旧验收文档加一行指向
4. 用 WP-K 工具跑改前/改后对比，产出判读

**明确不在范围内（禁止顺手做）：**

- **不改门槛**：`DEFAULT_ALLIANCE_CONFIG` 的 `open 0.6` / `resistanceTrust 0.4` / `resistanceSafety 0.3` 与 `LOW_DEPTH 0.35` 全部不动
- **不改 `trust` 增量**（trust 曲线本来就是对的：焦虑型快速理想化，符合文献）
- **不改 `safety` 增量**（safety 慢是对的，错的是要求它 12 轮到 0.6）
- 不改 `bond` / `positive` / `negative` / `dependency`
- 不改 `EVENT_LEXICON` / 判定器（那是 P3，另开单）
- 不改 `DEFAULT_DELTA_CAP_CONFIG`（cap 值本身合理）
- 不加 `frame_gain`、不做 per-session 阈值注入（都是 P1，另开单）
- 不增角色基线、不碰 `CHARACTER_BASELINE_CALIBRATION`
- 不改前端、不改 `boundary.spec.ts`
- 不自动 commit / push

---

## 3. 数值方案（**需大炮拍板**）

### 3.1 P0-a · 拆 resistance 三维配平

| 事件            | 字段     | 现值  | **建议值** | 理由                                        |
| --------------- | -------- | ----- | ---------- | ------------------------------------------- |
| `empathy`       | `depth`  | −0.10 | **−0.02**  | 共情建立信任，不等于让来访者放弃防御        |
| `empathy`       | `style`  | −0.06 | **−0.01**  | 人格级防御（理智化/回避）在首次会谈几乎不动 |
| `empathy`       | `verbal` | −0.08 | **−0.03**  | 愿意多说一点，但不该是断崖式倾诉            |
| `acceptance`    | `depth`  | −0.08 | **−0.02**  | 同上                                        |
| `acceptance`    | `style`  | −0.05 | **−0.01**  |                                             |
| `acceptance`    | `verbal` | −0.06 | **−0.02**  |                                             |
| `normalization` | `depth`  | −0.07 | **−0.02**  | 「这很正常」是轻微松动，不是拆墙            |
| `normalization` | `style`  | −0.04 | **−0.01**  |                                             |
| `normalization` | `verbal` | −0.05 | **−0.02**  |                                             |
| `affirmation`   | `depth`  | −0.06 | **−0.02**  |                                             |
| `affirmation`   | `style`  | −0.04 | **−0.01**  |                                             |
| `affirmation`   | `verbal` | −0.04 | **−0.015** |                                             |
| `open_probe`    | `depth`  | −0.06 | **−0.03**  | 探问确实会让人多暴露一点，比共情略强        |
| `open_probe`    | `style`  | −0.03 | **−0.015** |                                             |
| `open_probe`    | `verbal` | −0.03 | **−0.02**  |                                             |

**负向事件（`judgment` / `preaching` / `minimizing` / `boundary_cross` / `sensitive_touch`）的 resistance 增量全部不动** ——
阻抗上升是对的，风险信号必须保留强度。

### 3.2 P0-b · 修情绪失真

| 事件              | 字段      | 现值      | **建议值** | 理由                                 |
| ----------------- | --------- | --------- | ---------- | ------------------------------------ |
| `empathy`         | `valence` | +0.10     | **+0.03**  | 一次共情不该把情绪从 −0.40 拉到持平  |
| `empathy`         | `arousal` | −0.05     | **−0.02**  | 镇静是轻微的，不是一片药             |
| `acceptance`      | `valence` | +0.08     | **+0.03**  |                                      |
| `acceptance`      | `arousal` | −0.04     | **−0.02**  |                                      |
| `normalization`   | `valence` | +0.07     | **+0.02**  |                                      |
| `normalization`   | `arousal` | 0         | 0          | 不变                                 |
| `affirmation`     | `valence` | +0.10     | **+0.04**  | 肯定比共情略强（推动感更强）         |
| `affirmation`     | `arousal` | −0.03     | **−0.02**  |                                      |
| `open_probe`      | `valence` | +0.04     | **+0.02**  |                                      |
| `open_probe`      | `arousal` | +0.02     | +0.02      | 不变（探问略提激活）                 |
| `sensitive_touch` | `valence` | **−0.05** | **−0.12**  | **触碰痛处的代价必须大于共情的收益** |
| `sensitive_touch` | `arousal` | +0.15     | +0.15      | 不变                                 |

改后比例：一次触碰 `−0.12` vs 一次共情 `+0.03` → **代价是收益的 4 倍**。
于是「谈核心议题」的场，`valence` 必然是净下降 —— 这才是临床真实的。

### 3.3 可复算的预期值（验收用，必须自己算出来对上）

以语桐（anxious）/expert/12 轮/3 次 empathy 为例（`resistanceScale = 0.8`）：

| 维度      | 改前实测                    | 改后预期（3 次 empathy）     | 算法               |
| --------- | --------------------------- | ---------------------------- | ------------------ |
| `depth`   | 0.30 → **0**（−0.30，触底） | 0.30 → **0.225**（−0.075）   | `−0.02 ÷ 0.8 × 3`  |
| `style`   | 0.30 → 0.075（−0.225）      | 0.30 → **0.2625**（−0.0375） | `−0.01 ÷ 0.8 × 3`  |
| `verbal`  | 0.55 → 0.25（−0.30）        | 0.55 → **0.4375**（−0.1125） | `−0.03 ÷ 0.8 × 3`  |
| `trust`   | 0.35 → 0.71                 | **不变**                     | trust 不在本单范围 |
| `safety`  | 0.40 → 0.442                | **不变**                     |                    |
| `valence` | −0.40 → −0.10               | **−0.40 → −0.31**（+0.09）   | `+0.03 × 3`        |
| `arousal` | 0.72 → 0.57                 | **0.72 → 0.66**（−0.06）     | `−0.02 × 3`        |

**关键验证点**：改后 `depth` **不得触底**（应停在 0.225 附近）。若仍触底，说明数值给大了或事件数比预期多。

---

## 4. 12 轮档验收口径重写（P0-c · 文档层）

新建 `docs/worklog/pending/phase2.5-intake-acceptance-criteria-2026-11-11.md`，
并在 `phase2.5-p1d-acceptance-and-rerun-plan-2026-11-10.md` §3.5 顶部加一行：
「12 轮档判据已被 `phase2.5-intake-acceptance-criteria-2026-11-11.md` 取代，本节保留作历史口径」。

### 12 轮档（intake）· 判据

| 维度       | 判据                                      | 依据                                       |
| ---------- | ----------------------------------------- | ------------------------------------------ |
| `trust`    | 上升 **+0.05 ~ +0.20**（secure 可取下限） | 焦虑型快速理想化（Horvath & Symonds 1991） |
| `safety`   | **+0.02 ~ +0.06**                         | 「试探性安全」，不是"恢复安全"             |
| `bond`     | **≤ ±0.03**                               | 纽带通常 3–5 次后成形                      |
| `depth`    | **降幅 ≤ 0.10**                           | 防御是保护性的                             |
| `style`    | **≤ 0.05**                                | 人格级防御稳定                             |
| `verbal`   | **降幅 ≤ 0.15**                           | 愿说一点，不是倾倒                         |
| `valence`  | **不要求改善**（净下降可接受）            | 谈痛苦会被激活                             |
| `arousal`  | **结束 ≥ 基线 − 0.05**                    | 会谈结束仍高于基线是真实的                 |
| **探索率** | **不验**                                  | 探索不属 intake 阶段目标                   |

### 40 轮档（≈两次会谈）· 判据（留作后续，本单不跑）

- `depth` 降幅 **0.10 ~ 0.25**
- 探索率 **> 0**（至少一场出现 `affective_exploration`）
- `safety` 累积 ≥ 基线 + 0.10

---

## 5. 改动前必做的两个前置检查（不做就会翻车）

### 5.1 先查有多少测试硬编码了旧值

```
grep -rn "0\.10\|0\.08\|0\.07\|0\.06\|0\.05" test/engine-core/ test/engine-adapters/
```

**必须先列出受影响的用例清单**，判断哪些是「断言具体数值」（必须同步改）与哪些是「断言不等式」（应保持不变）。
把清单写进交付记录 §2，不要改完才发现挂了一片。

### 5.2 先确认探索率会怎么变（预期会下降，这是对的）

`LOW_DEPTH = 0.35` 不动，而 `depth` 现在不再归零 → 满足 `depth < 0.35` 更难 →
**探索率必然下降**。

**这不是回归，是修正**。所以本单必须**同时**落地 §4 的新判据；
否则用旧判据看，会得出「改完更差了」的错误结论 —— 这正是 WP-K 存在的意义。

---

## 6. 验证方法（照这个做，不要自创）

1. **前置**：WP-K 已交付，`data/batch-reports/verify-route1-p1d-2026-11-10.json` 存在（改前基线）
2. **改前快照已固化**，不需要重跑改前批次
3. 改代码 → 跑 §7 闸门
4. **重跑 16 场**：同 8 角色、同 expert 模式、`maxTurns=12`
   - **batchId 必须换新**（`p1d-r3-intake-2026-11-11`）—— BullMQ `jobId` 是内容派生且幂等，同 id 会被静默去重
5. 用 `npx tsx bin/batch-report.ts` 出改后快照
6. 与改前快照逐维对比，按 §4 判据逐条判 PASS/FAIL
7. **写对照表**：每维度 × 每角色 × 改前/改后/Δ
8. **专门核一条**：语桐 `depth` 是否还触底（本单的核心断言）

---

## 7. 闸门（自己跑，填真实数字）

| 闸门             | 命令                                                   | 要求                                                                          |
| ---------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 类型             | `npx tsc -p tsconfig.build.json --noEmit`              | 0 error                                                                       |
| Lint             | `npx eslint "src/**/*.ts" "test/**/*.ts" --fix`        | 0 error，记 warning 数                                                        |
| 测试             | `npx vitest run test/engine-core test/engine-adapters` | 全绿，记用例数；**列出被同步修改的用例**                                      |
| engine-core 变更 | `git diff --stat HEAD -- src/engine-core`              | **非空是预期**（本单就是要改内核），但必须只有 `state-transition.ts` 一个文件 |
| 边界护栏         | `npx vitest run test/engine-core/boundary.spec.ts`     | 全绿（**不许改这个文件**）                                                    |
| **重跑批次**     | 16 场                                                  | completed ≥ 14，`llm_call_ratio ≥ 0.9`                                        |
| **核心断言**     | 语桐 depth 终值                                        | **> 0**（不触底）                                                             |
| **判据核算**     | 8 角色 × 上表 8 项                                     | 逐条 PASS/FAIL，写进交付记录                                                  |

---

## 8. 交付记录（路径固定）

`docs/worklog/completed/phase2.5/wp-l-clinical-delta-and-acceptance-correction-YYYY-MM-DD.md`

必须含：

1. 一句话总结
2. **实际改动的 15 个数值 before/after 表**（逐行，不许省略）
3. 前置检查结果：受影响的既有测试清单与处理方式
4. 闸门表（命令 / exit code / 真实数字）
5. **16 场改前 vs 改后对照表**（每维度 × 每角色，含 Δ）
6. **核心断言核对**：语桐 depth 不触底；探索率变化（并解释"下降是对的"）
7. 风险与回归：确认未碰门槛 / trust / safety / bond / 基线 / 判定器
8. 遗留项（P1 `frame_gain`、per-session 阈值、P3 判定器召回）

---

## 9. 【交付回写清单】

- [ ] 交付记录已写到 §8 路径
- [ ] **新验收口径文档已写**（`phase2.5-intake-acceptance-criteria-2026-11-11.md`）
- [ ] 旧验收文档 §3.5 顶部已加历史口径提示行
- [ ] `phase2.5-p1d-known-issues-2026-11-11.md`：I-03/I-04/I-05/I-06/I-07/I-20 状态改「已修复」
- [ ] 任务单移入 `completed/phase2.5/`，状态改 `✅`
- [ ] 回写 `phase2.5-wp-list-2026-11-08.md`
- [ ] 回写 `phase2.5-README.md` §3
- [ ] 给 commit message 草稿（**不提交**）

---

## 10. 回复输出约定

1. 「已写入交付记录」+ 路径；
2. 报闸门真实数字；
3. **报 16 场对照表的关键 3 行**（语桐 depth、探索率、safety 均值）；
4. 报 §9 完成情况；
5. 不贴代码 diff 与台词原文。
