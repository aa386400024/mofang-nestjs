# C5-1 开工单 · 探索指标分层（角色覆盖切片 · I-16 / I-24 · 纯观测 · 零门禁变化）

> 状态：✅ **已交付**（2026-11-13，MiniMax Code）→ [交付记录](phase2.5-c5-exploration-coverage-implementation-2026-11-13.md)（本单已归档至 `docs/worklog/completed/phase2.5/`）
> 仓库：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`，基线 HEAD `368da4f`（本地 = 远端；工作区除 `data/quality/*.diff` 未跟踪诊断产物与 `docs/worklog/archive/` 回执外干净）。
> 任务性质：**评测 / 指标层**单（结构债类别 C5，草案 §36）。在既有批次快照的全局 `exploration.rate`（场次比例）之外，**新增角色级探索覆盖观测指标**，让「7/8 角色完全 0 探索」的结构在快照里可被复算；补切片内探索率断言；在指标字典与注释里标注探索属长会话（40 轮档）口径。**不新建任何探索门禁 / 阈值，不改既有判据，不碰前端，不碰 core。**
> 改动范围：后端 `src/auto-practice/metrics/` 2 个既有文件 + 既有指标 spec 增补；不新增 DB 列、不接 migration、不改批次实体、不跑批次、不调真模型。
> 前置文档：台账 I-16（:365-369）、I-24（:544-550）、P0-c（:581-585）；结构债草案 §4 I-16 / I-24 行、§6 第 1 条；intake 验收口径文档 §37 / §60 / §67；intake-v2 交付记录（切片与指纹范式）；D-3 交付记录（闸门表格式、遗留清单范式）。

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `README.md` → `docs/README.md` → `docs/team/conventions.md`（§1.1 分层、§二 交付格式）→ `AGENTS.md`（§5.1 隐私）。
2. 本开工单全文；台账 I-16 / I-24 / P0-c 三节；intake 验收口径文档（`phase2.5-intake-acceptance-criteria-2026-11-11.md`）。
3. 既有实现锚点：`batch-metrics.compute.ts`（`computeSummaryMetrics` :240-264、`buildSlice` :313、`groupBy` :323、`computeBatchSnapshot` :344-392）、`metric-dictionary.ts`（`MetricDef` :29-44、`SCALAR_METRICS` :248 起、`EXPLORATION_STRATEGIES` 集合在 compute :114）、`batch-metrics.schema.ts`（`MetricsSlice` :42-52、`assertMetricsMap` :120-128）。
4. 既有 spec：`test/auto-practice/wp-k-batch-compute.spec.ts`（helper :31-84、切片断言 :126-130、探索率用例 :109-115、disfluency 切片断言范式 :153-168）。
5. D-3 交付记录（闸门表格式、纯函数 / 缺省零回归写法、遗留项登记范式）。

---

## 1. 背景与已决项

### 1.1 背景

- **I-16**：历史 96 场批次以「探索率 ≥15%」总量口径判读，安然一人 100% 探索即可贡献大量探索场次，掩盖「其余 7 人 0 探索」的结构问题；批判 FAIL 实为总量指标与结构指标冲突。**应废总量、改分层。**
- **I-24**：`exploration.rate` 12/96，12 场全部集中安然，其余 7 角色 0 场；与 I-11（core 门槛不可达）/ I-16（总量掩盖结构）同源；intake 12 轮档不验探索，40 轮档与后续批次跟进。
- **P0-c**：12 轮档只验 intake 阶段行为（trust 温和上升、safety 微升、depth 降幅 ≤0.10、style 不动、valence 不要求、arousal 结束 ≥ 基线 −0.05），**不验探索**；探索放 40 轮档（≈两次会谈）。

### 1.2 复核已确认的现状（2026-11-13 只读复核，行号以代码为准）

1. **intake 判据表已不验探索**：`acceptance-thresholds.ts:136` 注释「exploration.rate 刻意不验（属 40 轮档）」；`INTAKE_EXPECTATIONS` 基线档 8 条无探索指标。
2. **批次有效性门禁不含探索**：`practice-batch-health.service.ts` 三条合格线 = LLM 调用比 ≥0.9（:33）、兜底率 ≤0.05（:36）、计数一致（:50）；无探索率判定。
3. **全仓无探索率阈值门禁代码**：`exploration.rate` 仅用于快照展示、列表排序（`controller.ts:358`、`client.ts:307`）、趋势线（`BatchTrendChart.vue:24`）、CLI 报告表格（`bin/batch-report.ts:274`）；I-16 所述「≥15% 门禁」是历史批次离线判读口径，代码层早已不含。
4. **指标层已有双维切片**：`computeBatchSnapshot` :364-369 按 `counselorModeId`（byMode）与 `characterSlug`（byCharacter）分组，每组走 `buildSlice → computeMetricMap`，切片内**已独立算出** `exploration.rate`。
5. **既有缺口**：
   - 切片内 `exploration.rate` 尚无 spec 断言（`wp-k-batch-compute.spec.ts:126-130` 只验 `sessions` 数量）。
   - 现有 `exploration.rate` 是**场次比例**（含探索策略的场次 ÷ 纳入场次），回答不了「多少角色完全 0 探索」；缺角色级覆盖口径。
   - 指标字典未标注探索类指标的档位适用性（长会话档观测，不参与 intake 门禁）。
6. **轮档概念当前不在代码里**：只有场次级 `maxTurns`（实体默认 15、controller :153 兜底 15）；无 12 / 24 / 40 轮档字段或 `turnBand`。本单**不引入轮档元数据字段**（见 §3.2）。

### 1.3 已拍板（不再复议）

1. **范围 = 甲（后端纯指标 + 测试，不碰前端）**：新增角色覆盖观测指标 + 补切片探索率断言 + 档位口径标注 + 文档回写；前端分组行展示留后续单。
2. **只增不废弃**：保留既有 `exploration.rate`（场次比例，稳定契约 id 只增不改）；新指标与其并存，回答不同问题；不替换、不改写旧键口径。
3. **纯观测，不做门禁**：新指标不进 `acceptance-thresholds.ts` 判据表、不进批次健康三条门禁、不参与任何 PASS / FAIL verdict；不填任何探索阈值（40 轮档阈值留标定批次 / 第二家 provider 后的长会话批次）。
4. **不动 core**：本单改动全部落在 `src/auto-practice/metrics/` 评测层；I-11 的 core 探索门槛（`min(trust,safety) ≥ open` 且 `depth < openDepth`）属 C2 / C1 core 行为，不在本单；本单只在观测层暴露结构，不解读为「门槛已修好」。
5. **不引入 DB 列 / 实体字段 / migration**：新指标只进快照 `metrics` map（随 `metrics_json` 落库）；不新增批次表冗余标量列、不接列表排序、不接端点新字段。
6. **缺省 / 零场次回落口径与 `exploration.rate` 一致**：无纳入场次时新指标 = 0（不抛错、不留 null）。

### 1.4 工程纪律（D-1 / D-2 / D-3 已证，延续）

- 一个提交一个意图；分组暂存；不跳 pre-commit 钩子（禁 `--no-verify`）；提交后 `git show --stat` 核对收录文件。
- 后端走 pnpm，禁裸 npx；lint 走 `pnpm lint`；测试 `pnpm test` / `pnpm exec vitest`。
- 既有技术债不在本单清理；新发现问题写进交付记录风险节，不静默改写、不顺手重构相邻旧文件。
- 发现任务单与代码冲突时，写进交付记录风险节，不静默改写。

---

## 2. 已核现状锚点（行号以代码为准，先 grep 符号名定位）

| 锚点                                                            | 文件 · 行号                          | 现状事实                                                                            |
| --------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| `EXPLORATION_STRATEGIES`                                        | `batch-metrics.compute.ts:114`       | 模块私有 `Set`：`affective_exploration` / `cognitive_exploration`                   |
| `computeSummaryMetrics(sessions, pipeline, metrics, breakdown)` | `batch-metrics.compute.ts:240-264`   | 全局与切片共用；:246-250 算 `exploration.rate`；新角色覆盖指标在此函数内同口径计算  |
| `buildSlice(sessions, pipeline)`                                | `batch-metrics.compute.ts:313-321`   | 分组切片，返回 `{ sessions, turns, metrics, zeroMotionBreakdown }`                  |
| `groupBy(sessions, key)`                                        | `batch-metrics.compute.ts:323-333`   | 通用分组工具；角色分组键 = `session.characterSlug`                                  |
| `computeBatchSnapshot`                                          | `batch-metrics.compute.ts:344-392`   | :364 byMode、:365 byCharacter、:368-369 构建切片、:371 全局                         |
| `MetricDef` 结构                                                | `metric-dictionary.ts:29-44`         | `id / label / unit / direction / bounds / nullable / definition`                    |
| `SCALAR_METRICS`                                                | `metric-dictionary.ts:248` 起        | 固定非维度 / 事件 / 策略指标数组；`exploration.rate` :250-257                       |
| `TRACKED_STRATEGIES`                                            | `metric-dictionary.ts:105` 起        | 8 种策略枚举（含两类探索 :109-110）                                                 |
| `MetricsSlice.metrics`                                          | `batch-metrics.schema.ts:45`         | `Readonly<Record<string, number \| null>>` 自由键 map；新指标无需改 schema 类型     |
| `assertMetricsMap`                                              | `batch-metrics.schema.ts:120-128`    | 只验每个值为有限数字或 null；新键自动通过，无需改守卫                               |
| `exploration.rate` 计算                                         | `batch-metrics.compute.ts:250`       | `round6(explorationSessions / sessions.length)`；零场次兜底 0                       |
| 探索策略切片断言缺失                                            | `wp-k-batch-compute.spec.ts:126-130` | 现有切片用例只断 `sessions` 数；本单补切片内 `exploration.rate` 断言                |
| 探索率场次口径用例                                              | `wp-k-batch-compute.spec.ts:109-115` | 一场含 `affective_exploration` → `exploration.rate = 1`；新指标用例照此 helper 组织 |
| 切片指标断言范式                                                | `wp-k-batch-compute.spec.ts:153-168` | disfluency 全局 + byMode + byCharacter 三向断言；新指标同范式                       |

---

## 3. 范围

### 3.1 在范围内

**A. 指标计算 · `src/auto-practice/metrics/batch-metrics.compute.ts`**

1. 在 `computeSummaryMetrics` 内新增角色级探索覆盖计算，写入新指标键 `exploration.character_coverage`：
   - **角色集合**：传入 `sessions` 中出现过的不同 `characterSlug`（本批实际覆盖到的角色；未跑到的角色不计入分母）。
   - **分子**：上述角色中，至少一场 `traces.some(trace => EXPLORATION_STRATEGIES.has(trace.strategy))` 的角色数。
   - **口径**：`分子 ÷ 角色集合大小`；角色集合为空（无纳入场次）→ `0`；`round6`（与既有指标同一浮点纪律）。
   - 该函数对全局集合与各切片集合共用，故新指标在全局、byMode、byCharacter 三处自然同口径产出：byCharacter 单角色切片值 ∈ `{0, 1}`；byMode 切片 = 该模式内角色覆盖；全局 = 全批角色覆盖。
2. 不新增具名导出；计算逻辑为模块内纯函数 / 内联循环，无 IO、无 env、无全局对象、无随机、无时钟；同输入 → 同输出。
3. `exploration.rate`（:246-250）既有计算与口径**一字不改**。

**B. 指标字典 · `src/auto-practice/metrics/metric-dictionary.ts`**

1. `SCALAR_METRICS` 追加新指标定义（照 :250-257 范式）：

   ```text
   {
     id: 'exploration.character_coverage',
     label: '探索角色覆盖率',
     unit: 'ratio',
     direction: 'neutral',
     bounds: RATIO_BOUNDS,
     nullable: false,
     definition: '本批纳入场次覆盖到的不同角色中，至少一场出现 affective_exploration / cognitive_exploration 的角色数 ÷ 角色数；回答"多少角色完全 0 探索"，与场次比例 exploration.rate 口径不同。属长会话（40 轮档）观测口径，12 轮 intake 档判据不验探索，本指标不参与合格判定。',
   }
   ```

   - `direction` 取 `neutral`：结构覆盖是描述性观测，不做单调优劣判定（同阻抗三维 neutral 纪律）；探索本属长会话档，本指标不进 intake verdict。
   - `RATIO_BOUNDS` / `round6` 沿用既有常量，不新增边界常量。

2. `exploration.rate` 定义（:256）补档位适用标注（不改数值口径）：在 `definition` 或相邻注释注明「长会话（40 轮档）观测口径；12 轮 intake 档不验探索（见 `acceptance-thresholds.ts` 注释），不参与合格判定」。
3. 文件头注释（:13-20 指标分层清单）按需补一行新指标归类；不改动 `TRACKED_STRATEGIES` / `TRACKED_EVENTS` / `POSITIVE_EVENTS` 任何枚举。

**C. 测试 · 增补 `test/auto-practice/wp-k-batch-compute.spec.ts`**（沿用既有 helper :31-84；若内聚度需要可新建 `test/auto-practice/c5-exploration-coverage.spec.ts`，文件选择在交付记录写明，用例清单不变）

1. **切片探索率断言**（补 :126-130 既有切片用例）：构造跨角色 / 跨模式场次，断言 `byMode[...].metrics['exploration.rate']` 与 `byCharacter[...].metrics['exploration.rate']` 等于各自切片内场次比例（不只是 `sessions` 数）。
2. **新指标用例**：
   - a. 多角色、仅一个角色含探索策略 → `exploration.character_coverage = 1/N`（N = 角色集合大小）；同批 `exploration.rate` 为场次比例，两值可不同，分别断言。
   - b. 全部角色都有 ≥1 场探索 → coverage = `1`。
   - c. 无纳入场次（空 sessions 集合）→ coverage = `0`，不抛错、不为 null。
   - d. 同一角色多场，其中一场含探索 → 该角色计入分子（角色级去重，不因场次重复计数）。
   - e. 切片退化：单角色 byCharacter 切片 coverage ∈ `{0, 1}`；byMode 分组内覆盖口径正确。
   - f. 确定性：同输入两次快照深相等（除 `computedAt`），新指标值一致（沿用 :199 范式）。
3. 不新增连 DB / 起 Nest 的用例；输入仍为手工构造的合规 `SessionComputationInput`。

**D. 文档回写（随交付记录一并提交，docs 组）**

1. 台账 `phase2.5-p1d-known-issues-2026-11-11.md`：I-16 行（:33）与小节（:365-369）、I-24 行（:41）与小节（:544-550）备注：角色覆盖观测指标已落地快照；总量掩盖问题在指标层可复算；40 轮档探索阈值与 I-11 core 可达性仍留后续批次 / 另案。
2. 结构债草案 `phase2.5-engine-core-structural-debt-assessment-2026-11-12.md`：I-16 行（:106）、I-24 行（:114）进度列与 §6 第 1 条（:255）同步本单状态。
3. `phase2.5-README.md`：登记本单一行（完成态数字在交付时填）。
4. intake 验收口径文档：在探索率口径行补注「角色覆盖率为结构观测、非门槛」；不新增 40 轮档判定条款（§121 候选雏形保留原样，阈值留标定批次）。

### 3.2 明确不在范围内

- 不新建 / 修改任何探索门禁、阈值、verdict 规则；不改 `acceptance-thresholds.ts` 判据表行与 `INTAKE_EXPECTATIONS`；不改 `practice-batch-health.service.ts` 三条门禁。
- 不碰前端：`admin-dashboard/` 变更面为空；分组行展示分角色指标、列表 / 趋势图口径标注留后续单。
- 不碰 `src/engine-core/**`；不改 I-11 探索门槛结构、`openDepth`、`DELTA_TABLE`、事件词表；不改 `intention-planner` / `alliance-config`。
- 不新增 DB 列 / 实体字段 / migration；不为新指标加快照冗余标量列、不接端点排序或新响应字段。
- 不引入轮档元数据（12 / 24 / 40 档字段、`turnBand`、批次档位标记）；档位适用性只写进字典定义与注释。
- 不实现 40 轮档探索判据；不填探索阈值标定值；不跑批次、不调真模型、不做吞吐 / 429 实测。
- 不改快照 `schemaVersion`；旧快照缺新键按缺省处理（字段 / 键只增不删纪律，同 `zeroMotionBreakdown` 先例）。
- 不清理既有债（D-2 遗留 L-1～L-10、llm_active 生效轨、D-5 词表子串重叠、D-4 cold 先验）；不复议 D-4（DOC-2 不建议单独实施）。

---

## 4. 契约与口径

### 4.1 新指标契约

| 项                         | 口径                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 键 id                      | `exploration.character_coverage`（稳定契约，发布后只增不改不复用）                                                           |
| 单位 / 方向 / 取值域       | `ratio` / `neutral` / `[0, 1]`；`nullable: false`；`round6`                                                                  |
| 分子                       | 角色集合中 ≥1 场 traces 命中 `EXPLORATION_STRATEGIES` 的角色数                                                               |
| 分母                       | sessions 中不同 `characterSlug` 数量（本批实际覆盖角色；未跑到角色不计入）                                                   |
| 空集回落                   | 分母 0 → `0`（不 null、不抛错）                                                                                              |
| 切片语义                   | 全局 / byMode / byCharacter 三处同函数同口径；byCharacter 切片值 ∈ {0, 1}                                                    |
| 与 `exploration.rate` 关系 | `rate` = 含探索场次 ÷ 纳入场次（场次比例）；`coverage` = 含探索角色 ÷ 覆盖角色（角色比例）；两者并存，回答不同问题，互不替代 |
| 门禁地位                   | 纯观测；不进判据表、不进健康门禁、不进 verdict                                                                               |

### 4.2 隐私与确定性

- 指标只消费 `TraceInput.strategy` 与 `SessionComputationInput.characterSlug`（合规投影字段，不含台词 / prompt / `kernelState` / 展示名）；计算层物理接触不到对话文本。
- 纯函数：无 env、无 `globalThis`、无随机、无时钟；同输入两次快照除 `computedAt` 外深相等。
- 快照内所有字符串值长度 ≤ 64 的既有合规断言（spec :205 附近）继续成立；新键的值是数字，不引入新字符串。

### 4.3 版本与可比性

- 新键进 `metrics` map（全局与切片共用）；`BatchMetricsV1` 类型为自由键 map，schema 版本保持 1；旧快照无此键，读端按缺省处理，不回溯重算、不覆盖写。
- 跨批比较仍先经指纹一致性判定；本单不改指纹段构成（指标计算文件哈希随 `stateTransition` 段之外的既有指纹口径，交付记录复核 `acceptance` 段是否受影响——本单不改判据表，预期 `acceptance` 指纹段不变）。

---

## 5. 并发、中断与回落纪律

- 指标计算无状态、无共享可变量；纯函数随快照计算调用，不持有会话实例状态。
- 回落链：空场次集合 → coverage = 0；角色集合去重在函数内完成；任何分支不抛错到服务层。
- 本单无外部依赖、无网络 / DB / 时钟调用，不存在失败分支；计算异常应在 spec 层以固定输入断言钉住。

---

## 6. 风险点登记（本单相关）

| #   | 风险                                                                          | 级别             | 缓解 / 处置                                                                                                                               |
| --- | ----------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `rate`（场次）与 `coverage`（角色）被误读为同一指标，或 coverage 被当成新门槛 | 中               | 字典定义写清分子 / 分母与两者区别；spec 分别断言两值；交付记录显式声明纯观测、不进 verdict；§3.2 边界写入任务单                           |
| R2  | 分母只含本批跑到的角色，角色覆盖随样本覆盖波动                                | 中               | definition 显式写「本批纳入场次覆盖到的角色」；spec d / e 钉住去重与切片语义；交付记录注明不可跨样本直接横比                              |
| R3  | byCharacter 切片 coverage ∈ {0,1}，被误读为「整场探索率」                     | 低               | 字典注释与 spec e 说明切片退化语义；面板展示属后续前端单，本单不呈现该切片值                                                              |
| R4  | 旧快照缺新键导致读端 undefined                                                | 低               | map 自由键 + 字段只增不删纪律；读端既有 null 容错范式；spec 确定性用例覆盖新键存在性；不改 schemaVersion                                  |
| R5  | 新指标被复制进阈值表 / 健康门禁，越界成隐式门禁                               | 中（越界即打回） | 闸门 diff 核对 `acceptance-thresholds.ts`、`practice-batch-health.service.ts` 无新增探索引用；§3.2 明确禁止；交付记录附两文件零 diff 证据 |
| R6  | 误触 core 边界或新增导出 / 文件撞护栏                                         | 低               | 改动限 `metrics/` 2 个既有文件；不新增具名导出；既有 boundary spec 保持绿（本单不碰 core，预期零 core diff）                              |
| R7  | 探索门槛临床口径（I-11 可达性）被误读为本单已解决                             | 中               | 交付记录与台账备注复述边界：本单只做观测分层；门槛取值、可达性对账、delta 速率均属 core 另案（S-1 已端口化但未解决可达性）                |

---

## 7. 闸门（执行方跑，填真实数字；pnpm，禁裸 npx）

跑前：PATH 补 `D:\Apps\Git\cmd`（避免 vitest 调 git ENOENT 假失败）；确认无 `nest start --watch` / `vite dev` 常驻；记录机器状态（CPU / 内存 / Node 版本 / 常驻进程 / 盘读延迟）。

基线（2026-11-13，D-3 交付实测；类型债 401 条 / 87 文件，HEAD `368da4f`）：boundary 12 例全绿；定向 `test/quality test/engine-core test/engine-adapters test/auto-practice` 102 文件 / 1881 例；全量 **3216 passed + 4 skipped（3220 例，193 文件）**；lint 0 error / 0 warning。机器：Node v22.23.2（主控本地）/ pnpm 9.x；回执机器 Node 版本与墙钟须一并记录（同 D-3 §4.3 flake 教训：负载差异下偶发超时须单文件复跑定性，不混作确定性缺陷）。

| 闸门            | 命令                                                                                                                            | 判据                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 类型（build）   | `pnpm exec tsc -p tsconfig.build.json --noEmit`                                                                                 | 0 error                                                                                                   |
| 类型（含 spec） | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`                                                         | 本单相关文件 0 error；既有类型债 401 条 / 87 文件不新增（stash 差分法对照基线）                           |
| Lint            | `pnpm lint`                                                                                                                     | 0 error，记 warning 数                                                                                    |
| 定向测试        | `pnpm exec vitest run test/auto-practice test/quality test/engine-core test/engine-adapters`                                    | 全绿；用例数 ≥ 基线，零丢失 / 零改写；新增 coverage 用例单列计数                                          |
| 全量            | `pnpm test`                                                                                                                     | 全绿，记总数 / skipped / failed / 墙钟 + 机器状态                                                         |
| 边界护栏        | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                                                                        | 12 例全绿；本单不改该文件                                                                                 |
| core 变更面     | `git diff --stat HEAD -- src/engine-core`                                                                                       | 为空                                                                                                      |
| 前端变更面      | `git diff --stat HEAD -- src/admin-dashboard`                                                                                   | 为空                                                                                                      |
| 门禁文件变更面  | `git diff --stat HEAD -- src/auto-practice/metrics/acceptance-thresholds.ts src/auto-practice/practice-batch-health.service.ts` | 为空（新指标不进门禁）                                                                                    |
| 改动文件清单    | `git diff --stat HEAD`                                                                                                          | 恰好 §3.1 A / B 两个既有源码文件 + spec 增补 + §3.1 D 文档；无新增 `.ts` 源文件（spec 文件选择见 §3.1 C） |
| 隐私自检        | 新增 spec / 注释人工过一遍                                                                                                      | 无原话、无 prompt 全文、无 `kernelState`、无展示名                                                        |

---

## 8. 交付记录与回写

### 8.1 交付记录路径

`docs/worklog/completed/phase2.5/phase2.5-c5-exploration-coverage-implementation-YYYY-MM-DD.md`，含：一句话总结；实际方案 vs 任务单偏差（conventions §2.5）；改动文件清单（源码 / spec / 文档分组）；闸门表（命令 / exit code / 真实数字 / 机器状态）；§6 风险逐条处置确认；新指标口径示例（固定输入下 rate 与 coverage 并排列值）；旧快照缺键兼容说明；遗留项（前端分组行展示、40 轮档探索阈值标定、I-11 core 可达性另案）。

### 8.2 交付回写清单

- [x] 交付记录写到 §8.1 路径
- [x] 本任务单移入 `completed/phase2.5/`，状态行改完成标记并链接交付记录
- [x] 台账 I-16 / I-24 行与小节备注（观测分层已落地；阈值与 core 可达性另案）
- [x] 结构债草案 §4 I-16 / I-24 进度列、§6 第 1 条同步
- [x] 活清单 `phase2.5-README.md` 登记（`phase2.5-wp-list-2026-11-08.md` 为冻结快照，不回写）
- [x] §7 各变更面 diff 实测记录进交付记录（core 空、前端空、门禁文件空）
- [x] 提交分组隔离：本单文件不混入并行产物；给一行 commit message 草稿，不自行 commit / push

---

## 附录 · C5-1 边界与遗留

**本单遗留到后续单**：

- 前端分组行（byCharacter）展示切片内探索率 / 覆盖率；批次列表与趋势图的总量口径标注（甲方案明确不碰前端）。
- 40 轮档探索判据与阈值标定（含「探索率 >0」候选条款取值）；依赖第二家 provider 与长会话批次样本。
- I-11 core 探索门槛结构复核与可达性对账（C2 / C1，core 另案；S-1 仅完成端口化，未解决可达性）。
- 轮档元数据字段（12 / 24 / 40 档）若未来需要按档分派判据，另立 schema / 实体变更单。

**本单不涉及（既有债另案）**：

- D-2 遗留 L-1～L-10；llm_active 生效轨接线；D-5 / G-4 词表子串重叠；D-4 cold 模式先验（DOC-2 不建议单独实施，不复议）；I-17 同源性跟踪；I-22 豁免方向待新批次取证。
