# Phase3 文字层真人度 · P1 审计基线（audit 口径同源迁移 + D7 六类不流利分布 + 双批次基线）

> 状态：✅ 已完成（2026-11-13）· 交付记录：[`phase3-disfluency-p1-audit-baseline-implementation-2026-11-13.md`](phase3-disfluency-p1-audit-baseline-implementation-2026-11-13.md) · 台账：[`phase3-disfluency-backlog-2026-11-13.md`](../../pending/phase3-disfluency-backlog-2026-11-13.md)
> 执行方：MiniMax Code
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 `integrate`，上游 `origin/integrate`
> 唯一事实源：
>
> - `docs/worklog/pending/phase3-text-disfluency-humanization-plan-2026-11-11.md`（Phase3 总体方案，下称「蓝图」）§5.2、§6 P1、§5.2.4 种子区间
> - 本单只覆盖蓝图 §6 **P1 · 审计基线**；P0 度量层（已交付闭环）、P2 Prompt 与开关、P3 角色配置与灰度准出均不在本单（见 §3.2）
>
> 任务性质：纯离线观测与口径收敛，**零行为变化**；改动落在 `scripts/ops/quality/`、`test/quality/`、`docs/worklog/` 与 `data/quality/` 产物，**不改 `src/` 运行时代码**，不碰 engine-core、不碰 prompt、不加 env、不加表。

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `E:\Work\Project\backend\mofang-nestjs\AGENTS.md` —— 仓库入口与 engine-core 红线
2. `E:\Work\Project\backend\mofang-nestjs\docs\team\conventions.md` —— 代码红线、16 条硬约束、交付格式
3. 蓝图 `phase3-text-disfluency-humanization-plan-2026-11-11.md`：重点 §5.2 度量层设计、§5.2.3 隐私分层、§5.2.4 种子区间、§6 P0 落地状态与遗留表（L-1 ~ L-10）
4. P0 交付记录 `docs/worklog/completed/phase2.5/phase3-disfluency-p0-metrics-implementation-2026-11-12.md`：§2 六处偏差、§8 遗留项
5. 现状锚点文件（本单 §2 已逐条核对，实现前再 Read 一遍确认行号未漂移）：
   - `src/auto-practice/metrics/disfluency-analyzer.ts`、`disfluency-lexicon.ts`、`metric-dictionary.ts`
   - `scripts/ops/quality/visitor-quality-audit.ts`
   - `test/quality/p1d-visitor-quality-lexicon.spec.ts`、`test/auto-practice/metrics/disfluency-analyzer.spec.ts`
6. 本任务单（你在读的这份）

---

## 1. 背景（先读，方向别错）

### 1.1 平台与被度量对象

本平台是咨询师对练平台。`src/auto-practice/` 是「AI 咨询师 × AI 来访者」双向自动对练的内部调试设施；批次快照度量的是 **AI 来访者（visitor）** 的轨迹。本单的不流利指标同样只度量 visitor 台词，不给 AI 咨询师台词定任何 KPI。

### 1.2 为什么做 P1（蓝图 §3 原则 1：度量先行）

P0（2026-11-12 已闭环）把六类不流利纯函数分析器、词表、dict-v2 八指标、服务层数值投影与快照聚合全部打通；闸门全绿（全量 3058 passed / 4 skipped / 0 failed），零行为变化。P1 是 P0 之后的第二步：

1. **口径同源**：审计脚本 `visitor-quality-audit.ts` 仍保留一套私有填充词表与私有归一化函数（P0 偏差 11 的收尾，对应遗留 L-1），须迁到 P0 纯模块，消除两套词表 / 两套归一化口径并存。
2. **基线观测**：audit 新增 D7 段，输出六类不流利分布与八个指标，与 `humanization-v1` 种子区间**并列对照**；跑两个既有离线批次出基线快照 JSON 与备忘文档，为后续 P2（Prompt 配额 / 开关）、P3（灰度准出）提供数字锚点。
3. **只观测、不改判据**：本单不把任何不流利指标接进门禁求值，不改阈值，不生成行为。

### 1.3 隐私边界（本单最高优先级约束，蓝图 §5.2.3）

- `batch-metrics.compute.ts` 是零 IO 纯函数层，输入经服务层合规投影，物理上不含原文。本单**不动 compute 层**。
- 审计脚本是离线只读设施：读 visitor `text` → 调纯函数 `analyzeDisfluency` → 只保留数值结果；原始 `text` 不进任何下游结构、不进控制台输出、不进基线 JSON、不进测试快照。
- 输出护栏（沿用脚本既有红线，文件头 :12）：报告、JSON、CSV 中**只出现 id / 数字 / 标签**，不出现任何对话文本。
- 边界自检：`grep` 确认脚本内 analyzer 的 import 与调用只在 `visitor-quality-audit.ts`（及测试）；`batch-metrics.compute.ts` 内不出现任何文本形参或 analyzer import。

### 1.4 关键现状（已逐条核对，别当新问题）

| #   | 核对项         | 蓝图假设 / 预期                             | 代码实测现状（2026-11-13 HEAD `ab012f1`）                                                                                                                                                                                                                      | 结论                                                                                                          |
| --- | -------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | 分析器导出     | `analyzeDisfluency` / `aggregateDisfluency` | `disfluency-analyzer.ts:245` `analyzeDisfluency(text: string): DisfluencyMetrics`；:37-38 re-export `aggregateDisfluency`、`EMPTY_DISFLUENCY_METRICS` 与类型 `DisfluencyCounts / DisfluencyMetrics`；数值契约本体在 `disfluency-lexicon.ts:18-44`（P0 偏差 1） | audit 从 analyzer / lexicon import，类型取自 lexicon re-export                                                |
| 2   | 聚合返回形状   | 事件率 / 占比 / 密度 / 六类计数             | `aggregateDisfluency`（lexicon.ts:170-205）返回 `{ eventsPerTurn, eventTurnRate, densityPer100Chars, typeCounts }`；**六类 per_turn 不在聚合返回内**，由调用方 `typeCounts[k] / 纳入轮数` 计算，口径对齐字典                                                   | D7 脚本侧补六类 per_turn；elongation 只入 typeCounts 总量，**无 elongation_per_turn 键**（P0 偏差 5）         |
| 3   | 字典 8 键      | `text.disfluency.*` dict-v2                 | `metric-dictionary.ts:338-402` 八键齐全：`events_per_turn` / `event_turn_rate` / `density_per100` / `filler_per_turn` / `pause_per_turn` / `repair_per_turn` / `repetition_per_turn` / `trailoff_per_turn`                                                     | D7 字段命名与字典 id 一一对应，不另造字段                                                                     |
| 4   | 脚本私有词表   | 废弃私有 FILLERS，改 import lexicon         | `visitor-quality-audit.ts:134` 私有 `FILLERS`（6 词，split 计数，无位置约束、无消歧）；lexicon `FILLER_WORDS`（:52，10 词，位置敏感 + 消歧优先级）                                                                                                             | 废弃 :134 常量；filler 计数改由逐轮 `counts.filler` 汇总，不再脚本内 split                                    |
| 5   | 脚本私有归一化 | 迁 `normalizeForLength`                     | `normalize` :266-268（去空白 + 去标点）；P0 偏差 2 已实测与 `normalizeForLength` 逐字等价；`normalizeForDetection`（lexicon.ts:151）保留省略号 / 破折号，仅供分析器内部识别用                                                                                  | 重复率 / n-gram 路径（:272、:418、:422）改用 `normalizeForLength`；脚本不引入 `normalizeForDetection`         |
| 6   | 文本信号派生   | 口径迁移                                    | `deriveTextSignals` :374-398（filler 命中 :394）；`deriveRepeatRates` :417-442（`fillerPerTurn` :440）；`SessionAudit` 装配 :503-540                                                                                                                           | filler 命中改挂分析器结果；`fillerPerTurn` 旧字段保留并标 deprecated（见 §4.2）                               |
| 7   | 报告段与 CLI   | 新增 reportD7，保留 `--dir`                 | `reportD4` :800-808；`reportD5` :815-824；`exportAnchor` :832-845；`main` :847-891，`--dir` 解析 :849-857，D4 调用 :883                                                                                                                                        | 新增 `reportD7(valid)`，在 :884 后接入；离线目录用法与默认目录行为不变                                        |
| 8   | 现有单测       | D7 快照测试就近落                           | `test/quality/p1d-visitor-quality-lexicon.spec.ts`（词表打标）；`test/auto-practice/metrics/disfluency-analyzer.spec.ts`（六类正例 / 消歧 / 白名单 / 聚合 / 边界确定性 / 归一化，27 例）                                                                       | analyzer 分类口径已被 P0 spec 覆盖，本单测试**不重复**分类正例；只测脚本层 D7 输出结构、聚合接线与泄漏护栏    |
| 9   | 判据文件       | P1 只追加对照展示                           | `acceptance-thresholds.ts`：`INTAKE_EXPECTATIONS` :77、`INTAKE_EXPECTATIONS_V1` :140、`INTAKE_EXPECTATIONS_COLD` :153；**无 humanization-v1**（属 P2 L-7）                                                                                                     | 不新增 / 修改任何判据数组；种子区间仅作为报告里的并列对照常量展示                                             |
| 10  | 离线批次候选   | ≥2 批次，含既有 8 角色                      | `data/archives/` 六目录实测：`baseline-20261109` 500 场 / 16864 轮；`pre96-2026-11-12` 91 场 / 1003 轮；`verify-route1-2026-11-10` 32 / 516；`verify-route1-p1d-2026-11-10` 16 / 183；`verify-p1d-2026-11-10` 6 / 24；`verify-prompt-version-2026-11-10` 1 / 2 | 第一批 `baseline-20261109`，第二批 `pre96-2026-11-12`（规模与跨批次可比性，对应 L-3）；小 verify 批次可选补充 |

### 1.5 开放项裁定（主控复核已定，实现方不再二选一）

1. **audit 复用快照还是直调 analyzer**：归档批次早于 P0，快照内无 `disfluency` 数值字段；脚本离线扫归档时**对 visitor 文本直调纯函数 `analyzeDisfluency`**，聚合走 `aggregateDisfluency`。函数与口径必须与 P0 服务层快照同一套（同模块 import），不另写复算逻辑。
2. **批次目录**：固定 `baseline-20261109` + `pre96-2026-11-12`（§2 第 10 行）。
3. **导出名 / 字段形状**：以 §2 实测代码为准，蓝图 §5.2.1 签名仅作参考。

---

## 2. 现状锚点（行号以 §1.4 实测为准；实现前重读确认）

| 锚点                        | 路径 : 行号                                                                        | 说明                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 分析器主函数                | `src/auto-practice/metrics/disfluency-analyzer.ts:245`                             | `analyzeDisfluency(text)`                                                           |
| 契约 / 聚合 / 常量          | `src/auto-practice/metrics/disfluency-lexicon.ts:18-44, 52-121, 131, 151, 170-205` | 类型、EMPTY、词表白名单、两套归一化、聚合                                           |
| 字典八键                    | `src/auto-practice/metrics/metric-dictionary.ts:335-402, 435`                      | `buildDisfluencyMetrics()` 并入字典                                                 |
| 脚本词表 / 归一化（待废弃） | `scripts/ops/quality/visitor-quality-audit.ts:134, 266-268`                        | 私有 `FILLERS`、私有 `normalize`                                                    |
| 脚本信号派生                | `scripts/ops/quality/visitor-quality-audit.ts:374-398, 417-442, 503-540`           | `deriveTextSignals` / `deriveRepeatRates` / `SessionAudit` 装配                     |
| 脚本报告 / CLI              | `scripts/ops/quality/visitor-quality-audit.ts:800-808, 847-891`                    | D4 段、`main` 与 `--dir`                                                            |
| 既有词表 spec               | `test/quality/p1d-visitor-quality-lexicon.spec.ts`                                 | 脚本词表打标单测范式参照                                                            |
| 分析器 spec                 | `test/auto-practice/metrics/disfluency-analyzer.spec.ts`                           | P0 分类与聚合口径回归锚，本单不改                                                   |
| 种子区间                    | 蓝图 §5.2.4（:191-195）                                                            | `event_turn_rate ∈ [0.20, 0.55]`；`events_per_turn ≤ 0.8`；`repair_per_turn ≤ 0.25` |

---

## 3. 范围与边界

### 3.1 本单要做（仍零行为变化）

1. **audit 口径同源迁移（L-1）**：脚本废弃私有 `FILLERS`（:134）与私有 `normalize`（:266-268），改从 P0 纯模块 import；filler 计数与归一化全部走 lexicon / analyzer 口径。
2. **audit 新增 D7 段**：逐轮 `analyzeDisfluency` + 整场 `aggregateDisfluency`，输出六类计数与八个指标（`events_per_turn` / `event_turn_rate` / `density_per100` / `filler·pause·repair·repetition·trailoff_per_turn`）；与 §2 种子区间**并列对照展示**，只观测、不接门禁、不改阈值。
3. **D7 输出快照测试**：覆盖六类计数、聚合口径（含空轮次集合全零、不出 NaN）、无原文泄漏护栏；落点 `test/quality/`（与 `p1d-visitor-quality-lexicon.spec.ts` 同目录），文件名在交付记录注明。
4. **双批次基线产物**：跑两个离线批次，产出 `data/quality/disfluency-baseline-<batchId>.json`（只含数字与批次 id，无原文）+ 一份基线备忘 md；备忘给种子词表 / 区间的校准建议，**区分「观测事实」与「建议调参」**，不直接改判据。
5. **Phase3 专属 backlog 台账（L-10）**：新建 `docs/worklog/pending/phase3-disfluency-backlog-2026-11-13.md`，把蓝图遗留表 L-1 ~ L-9 迁移过去并标注归属阶段；本单自身遗留一并登记。

### 3.2 明确排除（越界即返工）

- **P2**：`disfluency-profile.ts` / `disfluency-instruction.ts`、档位解析、4 个 env 键、`.env.example`、output guard 超限重生成接线、off 模式 prompt 逐字快照——全部不做。
- **P3**：character 实体两列、手写 migration、`bin/ormconfig.ts` 双登记、ResolvedCharacter 侧通道透传、A/B 灰度、人工读感准出、`humanization-v1` 判据正式生效——全部不做。
- **运行时代码**：不改 `src/auto-practice/metrics/` 下 P0 任何文件（只读复用）；不新增内核导出 / 文件；不碰 prompt 模板；不加表、不加 migration、不加 env 键；不改判据数组与阈值常量。
- **engine-core 纯层一行不动**：交付时 `git diff --stat HEAD -- src/engine-core` 必须为空。
- **不清理既有技术债**：类型债 401 条 / 87 文件为既有基线（TD-5，另案排期），本单不新增、不就地清理。

---

## 4. 实现口径

### 4.1 口径同源迁移（脚本内）

1. 新增 import（analyzer.ts re-export + lexicon 常量 / 类型）；删除 :134 私有 `FILLERS` 与 :266-268 私有 `normalize`。
2. 重复率 / n-gram / 唯一性路径（:272、:418、:422）的去空白去标点统一改用 `normalizeForLength`；该函数与旧 `normalize` 逐字等价（P0 偏差 2 已实测），迁移后这三处数值应保持不变——测试或批次复算中若发现漂移，先核对字符表，不自行改词表。
3. filler 命中不再脚本内 `text.split(filler).length - 1`；改由 §4.2 逐轮分析结果的 `counts.filler` 汇总。
4. **旧字段过渡**：`SessionAudit.fillerPerTurn`（:103、:407、:440、:532、:805）保留一个版本周期，字段注释标 `@deprecated`（旧口径：6 词 split、无位置约束）；D4 报告行保留展示并标注 deprecated。新口径六类分布只走 D7，**新旧两个 filler 数字不混用对照**；交付记录 §口径对照给出同批次旧 / 新两个 filler 均值。

### 4.2 每场不流利数值接线

1. 在 :503 `texts`（visitor 台词数组）之后，逐轮 `analyzeDisfluency(text)` 得到 `DisfluencyMetrics[]`；空文本 / 纯标点走分析器既有零值与边界行为，脚本不另写兜底分支。
2. 整场 `aggregateDisfluency(turns)` 取 `eventsPerTurn / eventTurnRate / densityPer100Chars / typeCounts`；六类 per_turn = `typeCounts[k] / texts.length`（空集合分母为 0 时置 0，与聚合函数空态一致）。
3. `SessionAudit` 扩一个**纯数值** `disfluency` 字段（形状对齐 P0 `DisfluencyMetrics[]` 的整场聚合结果 + 六类 per_turn；无任何文本引用）。类型从 lexicon re-export 取，不在脚本内重声明契约。
4. 退化场次口径不变：D7 统计仍只纳入 `degradedTurns === 0` 的 `valid` 场次（沿用 :871 过滤）；降级场次不计入基线均值。

### 4.3 D7 报告段（`reportD7(valid)`）

1. 段落标题 `[D7] 不流利分布（Phase3 P1 · 观测对照，不接门禁）`。
2. 输出（全场均值 + 六类计数合计 / per_turn，精度沿用脚本 `toFixed` 既有范式）：
   - `events_per_turn`、`event_turn_rate`、`density_per100`
   - `filler / pause / repair / repetition / trailoff_per_turn`（elongation 只列事件总量，不设 per_turn 行）
3. 种子区间并列对照（蓝图 §5.2.4，常量写在脚本本地只读常量区，注释标明「工程种子值 · P2 才接判据」）：
   - `event_turn_rate` 对照区间 `[0.20, 0.55]`
   - `events_per_turn` 对照上限 `≤ 0.8`
   - `repair_per_turn` 对照上限 `≤ 0.25`
   - 对照行只标「种子区间 / 实测值 / 是否落在区间内」三列形态；**不输出 PASS / FAIL 判定**，不进健康门禁。
4. 报告与 §4.1 D4 旧字段一样：只出 id / 数字 / 标签，无台词。

### 4.4 D7 快照测试（`test/quality/`）

1. 固定小夹具（若干轮 visitor 文本，含普通句、填充词句、修正句、半截话、空文本）：断言六类计数、`events`、`hasEvent`、`normalizedLength` 与 P0 analyzer spec 口径一致；断言整场聚合四字段与六类 per_turn 数值。
2. 空轮次集合 → 聚合全零、不抛错、不出 `NaN` / `Infinity`。
3. **泄漏护栏**：构造含可识别标记文本（如唯一占位串）的夹具，断言脚本导出的审计结构、报告序列化结果与基线 JSON 对象中**不出现该占位串**；断言 `SessionAudit.disfluency` 字段内只有数值与数字键。
4. 不复测 analyzer 分类正例（P0 spec 已覆盖）；不依赖数据库或真实归档目录。

### 4.5 双批次基线产物

1. 顺序实跑两批（`--dir` 离线用法，脚本 exit 0）：
   - `data/archives/debug-sessions-baseline-20261109`
   - `data/archives/debug-sessions-pre96-2026-11-12`
2. 产物 `data/quality/disfluency-baseline-<batchId>.json`：结构含批次目录名 / 场次与轮数、`events_per_turn` / `event_turn_rate` / `density_per100` / 六类 per_turn 均值与六类计数合计；**只含数字与批次 id**，无台词、无 matchedTerms、无解释文本。
3. 基线备忘 md（`data/quality/` 或 `docs/worklog/completed/phase2.5/` 下随交付记录，路径在交付记录注明）：两批次八指标实测值、与种子区间对照、跨批次可比性观察（对应 L-3）；**观测事实**（实测数字、批次场次 / 轮数、批次有效性局限）与**建议调参**（词表 / 阈值 / 区间后续校准方向）分两节写清，建议项不落到任何代码或判据改动。
4. **批次有效性局限必须如实标注**：`baseline-20261109` 是早期归档批次（README §3.1：兜底句占比 91.8%、大量场次 `total_tokens = 0`），其不流利分布偏低 / 失真属预期，**不得**把该批区间当作临床标定结论；本单基线只证明口径可离线复算与跨批次可比，临床标定留待真跑批次样本（见遗留 L-2 / L-5 类批次依赖）。

### 4.6 Phase3 backlog 台账（L-10）

新建 `docs/worklog/pending/phase3-disfluency-backlog-2026-11-13.md`：

| 迁移自蓝图 | 内容摘要                                                               | 归属阶段                | 本单处置                                 |
| ---------- | ---------------------------------------------------------------------- | ----------------------- | ---------------------------------------- |
| L-1        | audit 迁 lexicon 口径 + D7 段；废弃私有 FILLERS                        | P1                      | 本单闭环（交付记录勾销）                 |
| L-2        | 8 指标 bounds 基线后补齐（`density_per100` 上界；per_turn 取值域确认） | P1 观测 / 后续补 bounds | 基线数字入台账，bounds 补全另案          |
| L-3        | `density_per100` 取值域校准 + 归一化字符数跨批次可比性                 | P1                      | 本单双批次可比性观察入台账；校准结论另案 |
| L-4        | repetition「只认子句开头」位置取舍是否保留                             | P1 量化 / 后续拍板      | 基线 repetition 分布入台账；取舍拍板另案 |
| L-5        | filler 词表与位置约束阈值校准                                          | P1 观测 / 后续标定      | 基线 filler 分布入台账；标定依赖真跑批次 |
| L-6        | `TRAILOFF_MIN_CHARS = 4` 阈值校准                                      | P1 观测 / 后续标定      | 基线 trailoff 分布入台账；标定另案       |
| L-7        | `humanization-v1` 判据（§5.2.4）未实现                                 | P2                      | 原样保留，不在本单                       |
| L-8        | 角色侧联动（profile / instruction / env 三态开关 / 指纹段 / 灰度）     | P2 / P3                 | 原样保留，不在本单                       |
| L-9        | 角色实体列 / 迁移 / 透传 / 灰度判据                                    | P3                      | 原样保留，不在本单                       |

本单若产生新遗留（测试落点选择、跨批次不可比项、脚本输出格式调整等），追加到台账并在交付记录 §遗留项列明。

---

## 5. 闸门（真实命令 / exit code / 数字写进交付记录；禁裸 npx，统一 pnpm）

| #   | 命令                                                                                                              | 通过标准                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | `pnpm exec tsc -p tsconfig.build.json --noEmit`                                                                   | 0 error                                                                                                                   |
| 2   | `pnpm lint`                                                                                                       | 0 error（既有 warning 基线如实记录，不新增）                                                                              |
| 3   | `pnpm exec vitest run test/quality test/auto-practice/metrics`                                                    | 全绿；报告测试文件数 / 用例数 / failed 0                                                                                  |
| 4   | `pnpm exec tsx scripts/ops/quality/visitor-quality-audit.ts --dir data/archives/debug-sessions-baseline-20261109` | exit 0；人工核对输出结构、D7 无原文                                                                                       |
| 5   | `pnpm exec tsx scripts/ops/quality/visitor-quality-audit.ts --dir data/archives/debug-sessions-pre96-2026-11-12`  | exit 0；同上                                                                                                              |
| 6   | `git diff --stat HEAD -- src/engine-core`                                                                         | 为空                                                                                                                      |
| 7   | 收尾全量 `pnpm test` 一次（仅交付前跑；`pnpm test:fast` 冒烟不作证据）                                            | 0 failed；记录测试文件数 / 用例数 / skipped / 墙钟与机器状态（Node 版本、是否有长驻进程、盘读取状态），数字须可复现       |
| 8   | 类型债基线核对                                                                                                    | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` 条数 / 文件数 = 既有基线 401 / 87，本单相关新增 0 |

- 既有基准（G-4 闭环后，2026-11-13）：全量 3236 passed + 4 skipped（3240 例，193 文件）；boundary 12 绿。本单净增用例以交付记录实测为准。
- 脚本 / 测试之外的 docs 与 `data/quality/` 产物不进代码闸门；基线 JSON 与备忘 md 随交付提交，被 `.gitignore` 强制忽略的 `*.txt` / `*.csv` / `transcripts/` 留本地不入库。

---

## 6. 交付物与固定路径

1. 改动文件清单（脚本、测试、docs、产物分四组列）。
2. 交付记录（固定路径）：`docs/worklog/completed/phase2.5/phase3-disfluency-p1-audit-baseline-implementation-2026-11-13.md`，含：
   - 改动文件清单与新增 / 修改 / 删除区分；
   - §4.1 口径迁移前后对照（旧 filler 口径 vs 新 analyzer 口径，同批次两个均值）；
   - 两批次基线八指标数字、种子区间对照结果、跨批次可比性观察；
   - 观测事实 vs 建议调参（分节）；
   - 闸门表：实际命令、exit code、error / warning 数、测试文件 / 用例数、墙钟与机器状态；
   - 遗留项与建议人工复核清单；台账文件链接。
3. 任务单归档：验收通过后本单从 `pending/` 移到 `completed/phase2.5/`，顶部状态行改 ✅ 并链接交付记录。
4. 索引回写：蓝图 §6 P1 段补任务单 / 交付记录链接；`phase2.5-README.md` §3 表尾追加 P1 行；Phase3 backlog 台账（§4.6）与蓝图遗留表交叉链接。
5. 提交信息草稿（一个提交一个意图；脚本 + 测试一组，docs + 产物一组，按仓库钩子纪律不跳过 `--no-verify`）：
   - `feat(quality): P1 audit 接入不流利分析器并新增 D7 双批次基线`
   - `docs(worklog): Phase3 P1 任务单 / 交付记录 / backlog 台账与索引回写`

---

## 7. DoD 核对清单

- [x] 脚本私有 `FILLERS` / `normalize` 已删除，词表与归一化全部来自 P0 模块
- [x] D7 段输出八指标 + 六类计数，种子区间只并列对照、无 PASS / FAIL 判定
- [x] D7 快照测试落地 `test/quality/`，含空态与泄漏护栏
- [x] 两批次基线 JSON 落 `data/quality/`，只含数字与批次 id；备忘分「事实 / 建议」两节
- [x] Phase3 backlog 台账建立，L-1 ~ L-9 迁移并标注归属
- [x] 闸门 8 项全绿，数字与机器状态写入交付记录
- [x] `src/` P0 文件零改动；engine-core diff 为空；未碰 prompt / env / 表 / migration / 判据
- [x] 蓝图、README、台账索引一致，无断链
