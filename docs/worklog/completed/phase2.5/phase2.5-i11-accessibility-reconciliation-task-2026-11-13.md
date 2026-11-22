# I-11 · 方向 3 开工单 · 探索门槛可达性离线对账（纯取证 · 零 core 改动）

> 状态：✅ **已完成**（2026-11-13，MiniMax Code 执行；交付记录：`phase2.5-i11-accessibility-reconciliation-implementation-2026-11-13.md`）
> 仓库：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`，基线 HEAD `ae4513b`（本地 = 远端；工作区除 `data/quality/*.diff` 未跟踪诊断产物与 `docs/worklog/archive/` 回执外干净，core diff 为空）。
> 事实源：结构债草案 `docs/worklog/pending/phase2.5-engine-core-structural-debt-assessment-2026-11-12.md`（§4.1 :118-142 候选方向 3、§3 I-11 行 :101、§6 :256）；台账 `docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md`（I-11 节 :273-307、另案声明 :378 / :563）；S-1 交付记录 `docs/worklog/completed/phase2.5/phase2.5-s1-open-depth-threshold-port-implementation-2026-11-12.md`（方向 1 端口化已交付，不解决可达性）；C5-1 交付记录 `docs/worklog/completed/phase2.5/phase2.5-c5-exploration-coverage-implementation-2026-11-13.md`（12 轮档不验探索、40 轮档才验的分层口径）。
> 任务性质：**离线只读取证单**（评估 / audit 类，结构债类别 C2 门槛 + C1 速率的取证复核）。不产运行时行为改动；产物 = 1 个只读复算脚本 + 取证结论（写入交付记录）+ 台账 / 草案 / README / wp-list 回写。S-1 已把深度门槛端口化（方向 1）；本单做草案 §4.1 候选方向 3：用归档快照序列复核各角色达到双门槛所需轮次，作为门槛与速率标定的取证依据。方向 2（门槛结构临床复核）仍属临床拍板，不在本单。
> 改动范围：`scripts/ops/quality/` 新增 1 个 tsx 脚本；docs 回写 4 处 + 交付记录 + 任务单归档；**core / adapter / 前端零改动**；不碰 DB migration、不接 env、不调真模型、不跑批次、不改门槛取值与判据结构。
> **执行结果速览（2026-11-13 · MiniMax Code）**：646 场 / 18592 有效轮复算完成 → **序列内实测只有安然触达（51/69 = 73.9%，触达轮次 1 / 3 / 50），其余 7 角色 0 场触达**；末轮短板：惊尘 / 亦舟 / 沉舟 / 念安 双卡点，语桐 / 晚晴 / 小满 同盟卡点；**外推 A（任务单主口径）方法退化**（归档零膨胀，全库 88.5% 相邻轮差分为 0 → 三维中位恒 0）→ 8 角色全判「不可达」，**属方法退化而非临床结论**，并列口径 B（会话净变化率 · 非实测）给出区间（沉舟 331 / 晚晴 180 / 小满 217 / 语桐 235 / 念安 650 / 惊尘 767 / 亦舟 793）；**台账 I-09 线性表复算**：沉舟 0.60x / 小满 0.58x 同量级，语桐 0.21x / 惊尘 0.33x 台账偏乐观；档位归类 **仅安然快侧 4 轮够 12 轮档，其余 7 角色两档均不可达**。闸门全绿：脚本 exit 0、`tsc -p tsconfig.build.json` 0 错、全量类型检查 **401 条 / 87 文件 = HEAD `ae4513b` 实测基线逐字一致**、`pnpm lint` **0 error 0 warning**、boundary **12 绿**、定向三路径 **102 文件 / 1890 例** / 四路径 **121 文件 / 2196 例**、全量 **3236 passed + 4 skipped（3240 例，193 文件）**、**core / adapter / 业务层 / 前端 / `.env.example` 五个变更面全空**、归档运行前后哈希一致。偏差 8 条与新遗留 L-7~L-10 见交付记录。

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `README.md` → `docs/README.md` → `docs/team/conventions.md`（§1.1 分层、§1.3 pnpm 命令、§二 交付格式、§2.5 任务单与代码不符时的处置）→ `AGENTS.md`（§5.1 隐私、§2.1 engine-core 红线）。
2. 本开工单全文；S-1、C5-1 两份交付记录（端口化边界、档位分层口径、遗留登记）。
3. 现状锚点（§2 表）；既有取证脚本 `scripts/ops/quality/visitor-quality-audit.ts`（逐轮 `strategyByTurn` 序列 + snapshot 读取 + 跨场聚合范式、隐私输出口径）。
4. 草案 §4.1 :130-138（三方向区分）；台账 I-11 节 :273-307（现有线性外推表与「理论估算、非实测」标注）。

---

## 1. 背景与已决项

### 1.1 背景

探索策略要求同时满足双门槛：同盟短板 `min(trust, safety) >= open(0.6)` **且** 深度阻抗 `depth < openDepth(0.35)`。台账现有可达轮次表（语桐 ~50、小满 ~125、沉舟 ~200、惊尘 ~250）是**用 I-09 实际速率做的线性外推估算**，非实测序列复核；台账与草案均显式标注「理论估算，非实测」。S-1 只把 `LOW_DEPTH` 并入 `AllianceThresholds.openDepth` 端口（方向 1），门槛取值与可达性结论未动。

本单方向 3 的目标：基于仓库内归档会话的逐轮快照序列，做两层对账——

1. **序列内实测对账**：归档轨迹内是否触达门槛、首次触达轮次、未触达场次的末轮短板；
2. **离线状态机外推**：对序列内未触达的角色，用实测相邻轮差分（而非台账线性除法）驱动内核状态转移口径，估算可达轮次区间，与台账线性表并列对照。

产出是标定批次的取证依据；本单不替临床拍板门槛取值、不拆门槛结构、不标定阈值或速率。

### 1.2 已拍板（不再复议；用户 2026-11-13 确认「按推荐来，企业级标准 + 顶级临床思维」）

| #     | 议题           | 拍板结论                                                                                                                                                       | 依据                                   |
| ----- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 1.2.1 | 对账口径       | **序列内实测对账 + 未触达角色离线状态机外推补估算**；实测与外推分区呈现，外推不得冒充实测                                                                      | 用户拍板；草案 §4.1 :134「算所需轮次」 |
| 1.2.2 | 输入范围       | 仓库内 `data/archives/` 全部 6 个归档子目录（§2 表）；脚本支持 `--dir` 参数可复跑单目录；不连 DB、不读未归档的运行时会话                                       | 用户拍板；归档目录已 gitignore（:118） |
| 1.2.3 | 脚本落点与形态 | `scripts/ops/quality/i11-accessibility-reconciliation.ts`，`tsx` 执行；纯离线只读文件；纯计算函数与 `main()` 分离（参照 audit 脚本 :25-27 注释纪律），便于复核 | 沿用 quality 组既有范式                |
| 1.2.4 | 测试形态       | **不新增 vitest spec**（纯取证脚本）；脚本内纯函数保持无副作用、可人工复算；若执行方认为核心判定函数值得护栏，可补轻量 spec 并在交付记录偏差节说明，默认不补   | 取证单惯例；与 D-1 取证脚本同构        |
| 1.2.5 | 档位分层口径   | 沿用 C5-1：12 轮档不验探索，40 轮档才验；外推轮次按 §4.4 三档归类，不新建探索阈值、不进判据表 / 门禁 / verdict                                                 | C5-1 交付记录；台账 I-16 / I-24 备注   |
| 1.2.6 | 结论边界       | 本单只出证据、区间与对照；「门槛是否调低 / 深度条件是否拆分」属方向 2 临床复核，报告与交付记录不替临床下结论                                                   | 草案 §4.1 方向 2；台账 R-3 撤回口径    |

### 1.3 工程纪律（取证脚本延续 audit 范式）

- 隐私红线：脚本输出与报告只出角色 label / slug、批次目录、轮次、数值、计数与标签；**不出现任何对话原文、prompt 全文、`kernelState` 明细、单场会话 id、展示名之外的个人信息**。
- 阈值唯一真相源：门槛常量以 `src/engine-core/cognition/alliance-config.ts` 的 `DEFAULT_ALLIANCE_CONFIG.thresholds` 为准（open 0.6 / resistanceTrust 0.4 / resistanceSafety 0.3 / openDepth 0.35）；脚本注释标注真相源文件，不在脚本内另抄第二套种子。
- 只读不写：脚本只读归档 JSON，不写 DB、不写 Redis、不发网络请求、不读 `process.env` 门槛覆写；不修改任何归档文件。
- 可复算：报告内每个数字必须由脚本输出复算得到，不手填、不照抄台账旧表；台账旧表作为对照列并列，不改写历史口径。

## 2. 已核现状锚点（2026-11-13 只读复核；行号以代码为准，先 grep 符号名定位）

### 2.1 判据与种子真相源

| 位置                                                   | 现状                                                                                                                                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/engine-core/cognition/intention-planner.ts:57-61` | `const { verbal, depth, style } = snapshot.resistance`；`:61` `allianceGate = Math.min(snapshot.trust, snapshot.safety)`；depth 取自 `resistance.depth`（阻抗维，非其他 depth）                                                            |
| 同文件 :74                                             | 探索分支：`else if (allianceGate >= thresholds.open && depth < thresholds.openDepth)`；`:75` 按 valence 选 `affective_exploration` / `cognitive_exploration`                                                                               |
| `src/engine-core/cognition/alliance-config.ts:114-122` | `DEFAULT_ALLIANCE_CONFIG.thresholds = { open: 0.6, resistanceTrust: 0.4, resistanceSafety: 0.3, openDepth: DEFAULT_OPEN_DEPTH(0.35) }`；`:106` `DEFAULT_OPEN_DEPTH = 0.35`；`:147-162` `resolveAllianceThresholds` 缺项 / 非法逐项回落种子 |
| `src/engine-core/cognition/alliance-config.ts:61-83`   | `AllianceThresholds { open; resistanceTrust; resistanceSafety; openDepth? }`；`openDepth` 可选，解析结果必填完整数字                                                                                                                       |

### 2.2 归档快照结构（脚本输入）

| 位置                                                             | 现状                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/archives/debug-sessions-baseline-20261109/`                | 500 个会话 JSON；traces 序列；`traces[i].bdiSnapshot = { trust, safety, bond, valence, arousal, resistance, resistanceVerbal, resistanceDepth, resistanceStyle, anxiousSecure }`；会话顶层 `characterSlug / characterLabel / turnCount / traces / kernelState` |
| `data/archives/debug-sessions-pre96-2026-11-12/`                 | 91 个 JSON；schema 同上（抽样核对同构）                                                                                                                                                                                                                        |
| `data/archives/debug-sessions-verify-p1d-2026-11-10/`            | 6 个 JSON；schema 同上                                                                                                                                                                                                                                         |
| `data/archives/debug-sessions-verify-prompt-version-2026-11-10/` | 1 个 JSON；schema 同上                                                                                                                                                                                                                                         |
| `data/archives/debug-sessions-verify-route1-2026-11-10/`         | 32 个 JSON；schema 同上                                                                                                                                                                                                                                        |
| `data/archives/debug-sessions-verify-route1-p1d-2026-11-10/`     | 16 个 JSON；schema 同上                                                                                                                                                                                                                                        |
| 既有范式脚本                                                     | `scripts/ops/quality/visitor-quality-audit.ts`：`:321-352` `strategyByTurn: Map<number,string>` 逐轮序列；`:465-471` 读 `kernelState.snapshot` 末轮四维；`:492-501` 拼逐轮策略序列；`:611-620` 跨场策略聚合；`:848-851` `--dir` 用法；隐私口径 :8-13           |
| 既有取证脚本（纯函数零 IO 范式）                                 | `scripts/ops/quality/d1-event-classifier-evidence.ts`（词表 / 计算抽纯模块，脚本末尾 `await main()`，import 不触发整场跑批）                                                                                                                                   |

### 2.3 角色 slug → 姓名映射（2026-11-13 归档抽样核对）

| characterSlug                           | characterLabel | 依恋风格组（供分组参考，以内核 AttachmentStyle 为准） |
| --------------------------------------- | -------------- | ----------------------------------------------------- |
| `vpt_general_secure_l1`                 | 安然           | secure                                                |
| `vpt_social_anxious_l1`                 | 语桐           | anxious                                               |
| `vpt_self_worth_intellectualization_l1` | 小满           | avoidant（intellectualization）                       |
| `vpt_grief_avoidance_l1`                | 念安           | avoidant（grief）                                     |
| `vpt_depression_avoidant_l1`            | 沉舟           | avoidant（depression）                                |
| `vpt_workplace_intellectualization_l1`  | 亦舟           | avoidant（intellectualization）                       |
| `vpt_trauma_disorganized_l1`            | 惊尘           | disorganized                                          |
| `vpt_intimate_avoidance_l1`             | 晚晴           | avoidant（intimate）                                  |

### 2.4 台账现有对照口径（只读并列，不改写）

| 角色 | safety 基线 | 需增量 | 台账速率（expert） | 台账外推轮次 |
| ---- | ----------- | ------ | ------------------ | ------------ |
| 安然 | 0.70        | 0      | —                  | 0            |
| 语桐 | 0.40        | +0.20  | +0.004/轮          | ~50          |
| 小满 | 0.35        | +0.25  | +0.002/轮          | ~125         |
| 沉舟 | 0.20        | +0.40  | +0.002/轮          | ~200         |
| 惊尘 | 0.10        | +0.50  | +0.002/轮          | ~250         |

> 台账 :296-302 原表只列 5 角色；草案 :120 depth 基线列全 8 角色。本单脚本对 8 角色全量出对账结果；未在台账表内的角色（念安 / 亦舟 / 晚晴）只出实测与外推，不补台账对照列。

## 3. 范围

### 3.1 在范围内

**A. 复算脚本（`scripts/ops/quality/i11-accessibility-reconciliation.ts`）**

1. **输入遍历**：默认扫 `data/archives/` 全部子目录（§2.2），`--dir <path>` 可指定单目录；只读 `*.json`；非 JSON 文件跳过并计数（不静默丢场）。逐场解析顶层 `characterSlug / characterLabel / traces`；`traces` 按 `turnIndex` 升序排序；缺 `bdiSnapshot` 或缺键的轮次跳过并计入「缺键轮次」计数。
2. **序列内实测对账（逐场）**：
   - 逐轮读 `bdiSnapshot.trust / safety / resistanceDepth`（bond 不进门槛，仅记录末轮值供参考）；
   - 门槛判定复用 §2.1 口径：`gate = min(trust, safety) >= 0.6 && depth < 0.35`；
   - 每场输出：角色 slug / label、批次目录、轮次数、首轮快照四维、末轮快照四维、序列内是否触达、首次触达轮次（`null` = 序列内未触达）；
   - 未触达场次记录末轮短板：同盟短板 `max(0, 0.6 - min(trust, safety))`、深度短板 `max(0, depth - 0.35)`，并标注卡点维度（同盟 / 深度 / 双卡点）。
3. **跨场 × 角色聚合**：按「批次目录 × 角色」两层分组（另出跨目录总览），输出：场次计数、序列内触达场次比例、触达轮次分布（min / 中位 / max）、未触达场次末轮短板均值与分布、四维末轮均值；退化场次（全场 `degraded = true` 或 `llmUsage.completionTokens = 0`）单列分层，不混入主统计；退化判定**仅用归档内 `trace.degraded` 与 `llmUsage` 字段**（参照 audit :323 / :337 / :345 逐字稿退化轮口径），**不调用 audit 的 DB `degraded_turns` 表**（audit :232-245 连库口径仅作参照；本单不连 DB）。
4. **离线状态机外推（仅序列内未触达角色）**：
   - 增量估计：取该角色（样本不足时回退依恋风格组，再不足则全样本）归档 traces 相邻轮实测差分 `Δtrust / Δsafety / Δdepth`，取中位与 25 / 75 分位；退化轮差分单列参考，不进主增量；
   - 推演：从末轮快照出发，每轮按中位增量推进（trust / safety 上行、depth 下行方向按实测差分符号；若某维中位增量 ≤ 0 且未过线，该维记「增量方向不支持」）；状态上下限沿用内核快照既有范围（脚本注释引用 `state-transition.ts` / snapshot 范围真相源，不另造 clamp 规则）；
   - 触达条件同 §3.1-2；输出中位增量下的估算轮次 + 25 / 75 分位区间；增量方向不支持或区间不收敛时，标「不可达（增量方向不支持）」，不给单点轮次；
   - 外推假设必须在脚本头注释与交付记录显式列出：恒定增量速率、无阻抗反弹、无危机 / 破裂态、无跨会话衰减、无事件类型结构变化；外推只作标定参照，不是实测结论。
5. **对照与档位归类**：
   - 逐角色并列三列：台账线性外推轮次（§2.4，只读引用）、本单外推中位轮次（区间）、序列内实测触达轮次；偏差方向与量级（同量级 / 更乐观 / 更保守 / 不可达）；
   - 档位归类（§1.2.5）：`n ≤ 12` → 12 轮档与 40 轮档均可达；`12 < n ≤ 40` → 仅 40 轮档可达；`n > 40` 或不可达 → 两档均不可达；外推区间跨档时标注跨档区间。
6. **输出**：stdout 打印聚合表（角色 × 批次目录 × 指标）；`--out <path>` 可选写同构 Markdown 表（默认不写文件；正式取证结论写入交付记录，不新增独立报告 md 入库）。

**B. 取证结论（交付记录内，不另立报告文件）**

7. 交付记录含：脚本与运行命令、输入场次 / 轮次计数、各角色实测触达率与外推区间表、与台账线性表对照偏差、档位归类汇总、归档口径限制声明（§4.3）、隐私自检结论、遗留项清单。

**C. 文档回写**

8. 台账 I-11 节 :307 处置段补方向 3 离线对账已交付备注（实测触达率 + 外推区间结论见交付记录）；:378 / :563 另案声明中「I-11 core 门槛可达性对账」一项回填为已离线取证（方向 2 临床结构复核仍另案）。
9. 草案 §4.1 :142 落地状态行补方向 3 已离线对账；§3 I-11 行 :101 备注同步；§6 :256 进度列更新。
10. `phase2.5-README.md` 与 `phase2.5-wp-list-2026-11-08.md` 登记本单（沿用 S-1 / C5-1 行范式）。

### 3.2 明确不在范围内

- **core 纯层零改动**：`git diff --stat HEAD -- src/engine-core` 必须为空；不新增 core 文件 / 具名导出；不改 `AllianceThresholds` / `AllianceConfig` / planner 判据任何字段与逻辑。
- **adapter / 业务层零改动**：`git diff --stat HEAD -- src/engine-adapters src/auto-practice src/voice src/counselor src/ai-engine src/llm src/practice` 为空；不改观测带、指标计算、审计落库。
- 不改门槛取值、不拆双门槛结构、不做方向 2 临床复核（「低 depth 是否仍是探索前提」）；不标定阈值 / delta 速率 / 倍率；不接 env 覆写通道；不新增 env 键。
- 不连 DB / Redis / 网络；不调真模型 / LLM；不跑批次队列；不做成本 / 429 / 吞吐实测。
- 不碰前端 `src/admin-dashboard`；不清理既有根 `tsconfig` 类型债（401 条 / 87 文件，单独排期）；不复议 D-4 cold 先验（DOC-2 不建议单独实施）；不做 D-3 剩余形态斜率、D-5 / G-4 词表消歧。
- 不修改 `data/archives/` 内任何归档文件；归档 JSON 已 gitignore，不入库。
- 不顺手归档 pending 目录历史预研回执（`*-research-minimax-*` / `*-research-result-*`）；该事后治理另单处理。
- 发现任务单与代码 / 归档冲突时，写进交付记录风险 / 偏差节，不静默改写；不自动 commit / push。

## 4. 契约与口径

### 4.1 判定口径（与 planner 逐字对齐）

```ts
// 真相源: src/engine-core/cognition/alliance-config.ts DEFAULT_ALLIANCE_CONFIG.thresholds
//         src/engine-core/cognition/intention-planner.ts:61,74
const open = 0.6; // thresholds.open
const openDepth = 0.35; // thresholds.openDepth
const allianceGate = Math.min(trust, safety);
const reachable = allianceGate >= open && depth < openDepth;
```

- `depth` = `bdiSnapshot.resistanceDepth`（= `resistance.depth`，阻抗维）；不是 valence / arousal，不是 bond。
- `bond` 不进门槛（planner :16-17 注释：纽带是关系深度刻度，不是「敢不敢说话」的刻度）；脚本仅记录末轮 bond 供参考，不参与判定。
- 脚本不 import core 模块做运行时调用（避免脚本编译耦合 build rootDir）；判定常量与真相源逐字一致，注释标注文件与行号；若复核发现种子值与 §2.1 不符，停下记录偏差，不自行改值。

### 4.2 实测与外推分区（临床取证纪律）

| 层         | 数据来源                           | 性质                                      | 报告呈现                                        |
| ---------- | ---------------------------------- | ----------------------------------------- | ----------------------------------------------- |
| 序列内实测 | 归档 traces 相邻轮快照             | 归档轨迹内事实（受归档口径限制，见 §4.3） | 触达轮次 / 末轮短板，可直接引用                 |
| 状态机外推 | 实测差分中位 + 内核转移口径推演    | 模型估算，含 §3.1-4 假设                  | 区间 + 假设清单，标注「非实测」，不与实测列混排 |
| 台账线性表 | 台账 :296-302（I-09 速率线性除法） | 历史理论估算                              | 只读对照列，不改写                              |

### 4.3 归档口径限制（报告与交付记录必须显式声明）

- 归档多为规则轨降级回放：baseline 批次抽样 `degraded` 占比约 96%、`llmUsage` 全 0；状态推进来自规则事件序列，**不代表真实 LLM 对练轨迹**。本单结论限定为「规则轨状态机层面的门槛可达性对账」，不外推到真实对练表现。
- 快照时点早于 S-1（端口化）与 D-2（事件拆分）落地；门槛值未变（0.6 / 0.35 逐字），但事件 kind 集合与词表口径与当前版本存在时点差；报告标注每批次目录时点。
- 正式批次（96 场 / 16 场）逐轮同盟状态未落库（`ap_practice_sessions` 为场次级元数据，`ap_practice_turns` 存来访者语义文本，不含 trust / safety / depth 序列）；本单输入仅限仓库归档；后续批次若补逐轮状态快照采集，应重跑本脚本复算。
- 各归档目录时点 / 轮次长度 / 退化率不同，聚合必须按目录分层；跨目录总览只作参考汇总，不掩盖分层差异。

### 4.4 档位归类（沿用 C5-1 分层，不新建阈值）

| 外推可达轮次 n    | 12 轮档（intake，不验探索） | 40 轮档（验探索） |
| ----------------- | --------------------------- | ----------------- |
| `n ≤ 12`          | 可达                        | 可达              |
| `12 < n ≤ 40`     | 不可达（档位不验）          | 可达              |
| `n > 40` / 不可达 | 不可达                      | 不可达            |

- 区间跨档时标注跨档区间（如 38~46：40 轮档边界两侧）；归类结果只进取证报告，不进判据表 / 健康门禁 / verdict。

### 4.5 隐私口径

- 脚本与报告输出：角色 label / slug、批次目录名、轮次、四维数值、计数、策略标签；不出对话原文、TTS 标记、prompt 全文、`kernelState` 全量、单场 session id、咨询师 / 来访者展示名（角色 label 为既有基线名，允许）。
- 归档 JSON 含来访者台词原文（`messages[].text`）；脚本不读取 `messages` 文本字段，不把文本写进任何输出。

## 5. 风险点登记（本单相关）

| #   | 风险                                                                      | 本单处置                                                                                                                                |
| --- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | 阈值口径漂移：脚本另抄一套门槛，与内核种子不一致                          | 阈值注释引用 `alliance-config.ts` 种子真相源；§4.1 判定式逐字对齐 planner；复核不符即停并记偏差；脚本不读 env 覆写                      |
| T2  | 降级回放数据被误读为真实对练轨迹，结论过度推广                            | §4.3 限制声明进交付记录；退化场次单列分层；结论限定「规则轨状态机层面」；不外推真实 LLM 对练表现                                        |
| T3  | 外推轮次被误读为实测：模型估算顶替序列事实                                | §4.2 实测 / 外推 / 台账三列分区；外推必带区间 + 假设清单；报告标题与表头标注「外推 · 非实测」；增量方向不支持时标不可达，不硬凑单点轮次 |
| T4  | 序列口径错位：turnIndex 乱序 / 缺轮 / snapshot 缺键导致差分错位或静默丢场 | traces 按 turnIndex 排序；缺键轮次跳过并计数；非 JSON / 缺字段场次计入跳过计数并在报告披露；不静默丢弃                                  |
| T5  | 越界改 core：对账计算被塞进 core 纯层，或脚本 import core 带来 build 耦合 | 脚本落 `scripts/ops/quality/`，不 import src；core / adapter / 业务层 diff 全空；不新增 core 导出 / 文件；boundary 护栏不受影响         |
| T6  | 隐私泄漏：报告带出对话原文 / 单场明细 / kernelState 全量                  | 脚本不读 `messages[].text`；输出白名单（§4.5）；交付记录隐私自检表逐条过；归档原文不入库                                                |
| T7  | 批次时点混淆：6 目录不同时点 / 轮长 / 退化率被混算，汇总掩盖结构差异      | 按批次目录分层聚合 + 总览两层；报告标注每目录文件数 / 时点 / 退化率；跨目录总览明确标注参考性质                                         |
| T8  | 临床越界：把可达性证据写成「门槛应调低 / 深度条件应拆分」的结论           | §1.2.6 结论边界；报告只出证据 / 区间 / 对照；方向 2 临床复核另案；不替临床拍板                                                          |
| T9  | 外推 clamp 自造规则：脚本另写一套上下限，与内核状态范围不符               | 上下限引用内核 `state-transition.ts` / snapshot 范围真相源（注释标注）；脚本不新写 clamp 常量；复核内核范围后在交付记录写明引用点       |
| T10 | 台账旧表被覆写：对照过程中改写台账 :296-302 历史口径                      | 台账旧表只读；脚本输出对照列引用旧值；交付记录并列呈现，不修改台账原表行                                                                |

## 6. 闸门（执行方跑，填真实数字；pnpm，禁裸 npx）

跑前：PATH 补 `D:\Apps\Git\cmd`（避免 tsx / vitest 调 git ENOENT 假失败）；确认无 `nest start --watch` / `vite dev` 常驻；记录机器状态（Node 版本 / 常驻进程 / 盘读延迟）。

基线参照（2026-11-13，HEAD `ae4513b`，D-7 交付实测；开工前主控须复跑确认，不沿用历史墙钟数字）：类型债 401 条 / 87 文件；`boundary.spec.ts` 12 例绿；定向三路径 `test/quality test/engine-core test/engine-adapters` 102 文件 / 1890 例；四路径含 `test/auto-practice` 121 文件 / 2196 例；全量 193 文件 / 3240 例（3236 passed + 4 skipped + 0 failed）；lint 0 error / 0 warning。

| 闸门             | 命令                                                                                                                       | 判据                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 脚本可运行       | `pnpm exec tsx scripts/ops/quality/i11-accessibility-reconciliation.ts --dir data/archives`                                | 退出码 0；stdout 输出 §3.1-3 / 5 聚合表；跳过 / 缺键场次计数披露；报告数字可由脚本复算复现             |
| 类型（build）    | `pnpm exec tsc -p tsconfig.build.json --noEmit`                                                                            | 0 error（脚本不在 build rootDir 内；须确认未引入 src 编译耦合）                                        |
| 类型（含 spec）  | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`                                                    | 本单相关文件 0 error（既有类型债 401 / 87 另计，不新增）                                               |
| Lint             | `pnpm lint`                                                                                                                | 0 error，记 warning 数；脚本文件过 oxlint / prettier（lint-staged 覆盖 `scripts/**/*.ts`）             |
| 边界护栏         | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                                                                   | 12 例全绿；本单不改该文件                                                                              |
| 定向测试         | `pnpm exec vitest run test/quality test/engine-core test/engine-adapters`                                                  | 全绿；用例数 ≥ 基线，零丢失 / 零改写（本单默认不新增 spec；若补 spec，用例单列计数）                   |
| 全量             | `pnpm test`                                                                                                                | 全绿，记总数 / passed / skipped / failed / 墙钟 + 机器状态；失败先单文件复跑区分确定性缺陷与负载 flake |
| core 变更面      | `git diff --stat HEAD -- src/engine-core`                                                                                  | **为空**；无新增 core 文件 / 具名导出                                                                  |
| adapter / 业务面 | `git diff --stat HEAD -- src/engine-adapters src/auto-practice src/voice src/counselor src/ai-engine src/llm src/practice` | 为空                                                                                                   |
| 前端变更面       | `git diff --stat HEAD -- src/admin-dashboard`                                                                              | 为空                                                                                                   |
| 配置变更面       | `git diff --stat HEAD -- .env.example`                                                                                     | 为空（本单不新增 env 键）                                                                              |
| 归档完整性       | 脚本运行前后核对 `data/archives/` 文件清单与哈希                                                                           | 归档文件零修改；脚本只读                                                                               |
| 隐私自检         | 脚本源码 + 交付记录 + stdout 输出人工过一遍                                                                                | 无原话、无 prompt 全文、无 `kernelState` 明细、无单场 id、无展示名外的个人信息                         |

## 7. 交付记录与回写

### 7.1 交付记录路径

`docs/worklog/completed/phase2.5/phase2.5-i11-accessibility-reconciliation-implementation-2026-11-13.md`，含：一句话总结；实际方案 vs 任务单偏差（conventions §2.5）；改动文件清单（脚本 / 文档分组）；闸门表（命令 / exit code / 真实数字 / 机器状态）；§5 风险逐条处置确认；实测 / 外推 / 台账三列对照表与档位归类汇总；归档口径限制与隐私自检结论；遗留项清单（§7.3）。

### 7.2 交付回写清单

- [x] 交付记录写到 §7.1 路径；本任务单移入 `completed/phase2.5/`，状态行改完成标记并链接交付记录
- [x] 台账 I-11 节处置段补方向 3 已离线对账备注；:378 / :563 另案声明回填（方向 2 临床复核仍另案）
- [x] 结构债草案 §4.1 落地状态行补方向 3；§3 I-11 行 :101 备注同步；§6 :256 进度列更新
- [x] 活清单 `phase2.5-wp-list-2026-11-08.md` 与 `phase2.5-README.md` 登记本单
- [x] `git diff --stat HEAD -- src/engine-core`、adapter / 业务层、`.env.example`、`src/admin-dashboard` 实测记录进交付记录
- [x] 脚本输出聚合表留存 `data/quality/`（gitignore，不入库）；交付记录内引用关键数字
- [x] 提交分组隔离：本单文件不混入并行产物；给一行 commit message 草稿，不自行 commit / push

### 7.3 遗留登记（本单不闭合，显式留痕）

| #    | 遗留项                                                                                                                                                                                                     | 去向                            |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| L-1  | I-11 方向 2：门槛结构临床复核（「低 depth 是否仍是探索前提」；是否拆为独立条件）                                                                                                                           | 临床拍板另案                    |
| L-2  | 正式批次逐轮同盟状态快照采集（当前 session 表场次级、turn 表仅语义文本）；采集后重跑本脚本复算                                                                                                             | 批次 / 采集层另案               |
| L-3  | 外推模型细化：分事件类型增量、阻抗反弹 / 破裂态、跨会话衰减、事件结构版本差；当前为恒定中位增量简化模型                                                                                                    | 标定批次单                      |
| L-4  | 门槛取值 / delta 速率 / 倍率的临床标定（依赖第二家 provider + 长会话批次样本）                                                                                                                             | 标定批次单                      |
| L-5  | 既有根 `tsconfig` 类型债（401 条 / 87 文件）                                                                                                                                                               | 单独排期                        |
| L-6  | pending 目录历史预研回执归档（`*-research-minimax-*` / `*-research-result-*`）                                                                                                                             | 事后文档治理单                  |
| L-7  | 外推主口径 A（相邻轮差分中位 / 分位）在本归档**方法退化**（全库 88.5% 相邻轮差分为 0；角色级活跃轮占比 6.5%~11.2% → 三维中位恒 0）：需按事件类型分层估计增量，或改用会话净变化率口径（本单已并列补口径 B） | 标定批次单                      |
| L-8  | 增量估计的**活跃轮占比下限**未固化（实测最低 6.5%，勉强过线；建议 < 5% 判「增量估计不可用」并标注）                                                                                                        | 取证脚本改进单                  |
| L-9  | 角色 → 依恋风格组 → 全样本**回退链机制仍在**（本单 8 角色全在角色级命中，回退链未触发、未实证）；另建议回退链不跨角色借增量，只降级为「标注来源」                                                          | 取证脚本改进单                  |
| L-10 | 依恋风格映射口径：任务单 §2.3 按 slug 字面归类（小满 / 晚晴 = avoidant）与仓内 seed（均为 **anxious**）冲突；本单 8 角色全走角色级增量 → **对结论零影响**                                                  | 任务单口径修订（偏差 1 已登记） |

## 附录 · 边界与顺序

- 本单是 I-11 方向 3 取证复核，不改写 S-1 已交付的端口化结构；方向 1（端口化）已闭合，方向 2（临床结构复核）另案，本单只做方向 3（可达性对账）。
- 顺序关系：S-1（门槛端口化）→ **I-11 方向 3（可达性离线对账，本单）** → 标定批次（阈值 / 速率 / 倍率 / 语义取证）；方向 2 临床复核与标定批次并行决策，不阻塞本单取证。
- 既有类型债、并行进程产物与本单改动分开记录；交付时 `git status --short` 逐条比对清单，未跟踪诊断产物（`data/quality/*.diff`、archive 回执）不入库；归档 JSON 整体 gitignore，不入库。
