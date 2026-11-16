# Phase2.5 · intake-v2 判据按咨询师模式分档 + TD-4 指纹口径修复 —— 交付记录

- 文档日期：2026-11-12
- 任务单：[phase2.5-intake-v2-mode-stratified-acceptance-2026-11-12.md](phase2.5-intake-v2-mode-stratified-acceptance-2026-11-12.md)
- 执行方：MiniMax Code
- 关联台账：I-21 / I-22（[已知问题清单](../../pending/phase2.5-p1d-known-issues-2026-11-11.md)）、TD-4（[技术债台账](../../pending/phase2.5-toolchain-tech-debt-2026-11-11.md)）
- 事实源批次：`g3ONzlqSGMVJqkFMF9Lwh`（96 场 / 1112 轮）

---

## 0. 一句话总结

**判据按 `counselorModeId` 分档（intake-v1 → intake-v2）落地：`expert` 及未单列模式回落 v1 基线档、`cold` 单设候选阈值档；`session.zero_motion` 在 cold 档按 I-22 拆出「合理封闭 / 纯 neutral 空转」两类语义；CLI 报告在保留全局结论的前提下追加按模式切片判分；catalog 下发分档结构与新版本号；TD-4 同单修复——指纹统一按 `dist/*.js` 口径，CLI 进程与服务端进程逐段指纹现已完全相同。**

96 场复算对照：全局 **6/8（与 v1 一致，未被替换）**、`expert` **7/8**、`cold` **8/8（v1 单表套 cold 切片只有 5/8）**。

---

## 1. 方案设计：实际实现 vs 任务单方案

### 1.1 任务单方案与实际实现对照

| 任务单方案（§2 / §3）                                                                    | 实际实现                                                                                                                                                                                                                                     | 是否有偏差                      |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 判据表按 `counselorModeId` 分档组织，`expert`（及未单列）回落 v1 基线档，`cold` 单设一档 | `acceptance-thresholds.ts` 新增 `IntakeTier` / `INTAKE_TIERS`（`baseline` 兜底档 + `cold` 档）+ `resolveIntakeTier()`；`baseline.expectations` **就是** `INTAKE_EXPECTATIONS`（v1 原表，引用同一对象，非复制）                               | 否                              |
| `evaluateIntakeAcceptance` 支持按模式切片判分，返回与 v1 同构                            | 新增第二参数 `options`（`counselorModeId` / `sessions` / `zeroMotion`）；返回保留 `passed` + `results[]`，**增量**加 `acceptanceVersion` / `tierId` / `counselorModeId` 三字段                                                               | 否（仅增量字段）                |
| 版本 `intake-v1` → `intake-v2`，v1 阈值保留可读、不回溯重算历史快照                      | `INTAKE_ACCEPTANCE_VERSION = 'intake-v2'`；`INTAKE_EXPECTATIONS` 数值一条未改（仍为基线档口径）+ `INTAKE_EXPECTATIONS_V1` 历史别名 + `INTAKE_ACCEPTANCE_VERSION_HISTORY`；历史快照文件未动                                                   | 否                              |
| I-22：零变化场次若事件层存在非 neutral 事件则豁免，纯 neutral 空转仍计入                 | **逐场**判定（见 §3.2）；数据源 = 逐字稿合规投影的 `traces[].eventTags`；新增 `MetricsSlice.zeroMotionBreakdown`（可选字段，`total/closure/idle`）                                                                                           | **有**（口径细化，见 §1.2）     |
| CLI 除全局判定外对 `byMode` 各切片分别判分并输出每档 PASS/FAIL 与未达标项                | `bin/batch-report.ts` 新增 `judgeByMode()` + `renderModeSection()`：MD 追加分档总表 + 每档明细（含零变化 总/豁免/计入）；**全局结论保留不替换**                                                                                              | 否                              |
| catalog 下发分档结构与新版本号（只读投影、不含判定逻辑）                                 | `buildMetricCatalog()` 增 `acceptanceVersionHistory` + `tiers[]`；`expectations` 保持与常量**逐条同源引用**（旧前端镜像不炸）；`meta` 增 `tierCount`；投影里**不含任何判定结果**（有单测断言）                                               | 否                              |
| TD-4：指纹文件哈希统一按 `dist/*.js` 口径，保留 fail-closed                              | 新增共享解析器 `resolveFingerprintSource()`（`prompt-fingerprint.ts`）+ `resolveDistArtifactPath()`；`config-fingerprint.ts` 的 7 段（含 `prompts` 段）与 `computePromptVersion()` 全部走该口径；读不到仍返回 `unknown` → combined `unknown` | 否（落点比任务单更全，见 §1.3） |
| 测试覆盖六项                                                                             | 新增 `test/auto-practice/intake-v2-mode-stratified-acceptance.spec.ts` **25 条**；**未改任何既有测试**                                                                                                                                       | 否                              |

### 1.2 偏差 1：I-22 的豁免判定做在**逐场**粒度，不是切片聚合粒度

- **任务单原方案**：「基于切片内可用的 event 指标 / traces 事件标签判定」。
- **实际方案**：只用 **traces 事件标签**、且做在**逐场**粒度。
- **为什么**：切片级 event 指标（`event.neutral.rate` 等）只有聚合值，**无法归因到具体哪一场**；而豁免是**场次级**判定（这一场豁免 / 那一场计入）。若在切片聚合层判定，"有多少场被豁免"根本无法算出来。因此在计算层逐场判定并把结果汇总进 `MetricsSlice.zeroMotionBreakdown`（`total` / `closure` / `idle`），判分时只用这个汇总数。
- **代价**：快照 JSON 多一个可选字段（`schemaVersion` 仍为 v1，字段只增不删，旧快照读端按缺省处理）。

### 1.3 偏差 2：TD-4 的修复面比任务单写的更宽（多覆盖了 `prompts` 段）

- **任务单原方案**：「`config-fingerprint.ts`（或其调用点）统一 dist/.js 口径」。
- **实际实现**：7 段**全部**统一到 `dist/*.js`，包括 `prompts` 段——因为它取自 `computePromptVersion()`，而该函数的扩展名同样来自 `import.meta.url`。**只修 `config-fingerprint.ts` 的话，`prompts` 段仍然两侧不等，`combined` 依旧不可比**，TD-4 等于没修干净。
- **落地方式**：按任务单 §1.3 的要求「修复落点在指纹模块 / 该调用链，不是 CLI 内另写哈希」，把解析器放在 `prompt-fingerprint.ts`（`config-fingerprint.ts` 本就 import 它），由 `config-fingerprint.ts` 复用，**没有在 CLI 里另写一份哈希**。

### 1.4 偏差 3：cold 档的 `zero_motion` 判据形式（`max_ratio` 而非绝对计数）

- 任务单要求「不引入 v1 未覆盖的新指标作为判据」——本单**未新增任何指标 id**，`session.zero_motion` 原 id 复用。
- 为了让 cold 档的豁免语义可表达（且不因切片场次数不同而误判），新增了判据**类型** `max_ratio`：分子取 I-22 的"计入"场次数，分母取切片场次数。判据 **id 集合与 v1 完全一致**（8 条、同一批 id），只是 cold 档的 `session.zero_motion` 从 `must_be_zero` 改为 `max_ratio`（比例上限，候选值 0.70）。
- 分子口径（`raw` 全量计数 / `idle` I-22 计入数）写在判据常量里，**不在消费点里二次决定**。

---

## 2. 改动文件清单

### 2.1 后端源码（`src/`）

| 文件                                                 | 改动                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/auto-practice/metrics/acceptance-thresholds.ts` | **判据唯一真相源**：新增 `IntakeTier` / `INTAKE_TIERS`（`baseline` 兜底档 + `cold` 候选档）、`resolveIntakeTier()`、`getIntakeTier()`、`ZeroMotionBreakdown`、`IntakeAcceptanceOptions`、判据类型 `max_ratio`；版本升 `intake-v2`；`evaluateIntakeAcceptance` 支持按模式切片判分 |
| `src/auto-practice/metrics/batch-metrics.schema.ts`  | 快照与切片加**可选**字段 `zeroMotionBreakdown`；守卫新增该字段的验型（在场则逐字段验，不在场则跳过）                                                                                                                                                                             |
| `src/auto-practice/metrics/batch-metrics.compute.ts` | 逐场计算零变化细分（`isZeroMotion` 复用 + 新增 `hasNonNeutralEvent`），产出 `total/closure/idle`；`session.zero_motion` 指标值改为取自同一份细分（单一来源）                                                                                                                     |
| `src/auto-practice/prompt-fingerprint.ts`            | 新增 `resolveFingerprintSource()` / `resolveDistArtifactPath()` / `FingerprintSourceTarget`；`computePromptVersion()` 与 `resolveTemplatePaths()` 默认走统一口径（dist 优先，缺失才回退源码）                                                                                    |
| `src/auto-practice/config-fingerprint.ts`            | 7 段文件哈希统一走 `resolveFingerprintSource()`（显式注入 `baseDir`/`extension` 时按注入值走，供单测）                                                                                                                                                                           |
| `src/auto-practice/auto-practice.controller.ts`      | `buildMetricCatalog()` 增发 `acceptanceVersionHistory` + `tiers[]`；`GET metrics/catalog` 的 `meta` 增发 `tierCount`                                                                                                                                                             |

### 2.2 CLI 与测试

| 文件                                                              | 改动                                                                                                                           |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `bin/batch-report.ts`                                             | 新增 `judgeByMode()` / `renderModeSection()`；MD 追加「按咨询师模式分档判定」总表 + 每档明细；全局结论保留                     |
| `test/auto-practice/intake-v2-mode-stratified-acceptance.spec.ts` | **新增** 25 条用例（分档回落 / cold 专属 / 未知模式 / zero_motion 两类语义 / catalog 结构与版本 / 指纹两侧一致 / fail-closed） |

### 2.3 文档回写（§7 清单）

`docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`、`docs/worklog/pending/phase2.5-README.md`、`docs/worklog/pending/phase2.5-intake-acceptance-criteria-2026-11-11.md`、`docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md`（I-21 / I-22）、`docs/worklog/pending/phase2.5-toolchain-tech-debt-2026-11-11.md`（TD-4）、本任务单归档。

> **未改**：`src/engine-core/**`（零 diff）、`admin-dashboard/**`、Flutter 仓库、`ap_counselor_modes` 表数据、咨询师 `system_prompt` 与台词生成链路、指标字典（`metric-dictionary.ts` 未动）、表结构 / migration / 映射 / 装配。

---

## 3. 闸门表（真实数字）

> 机器状态：**跑闸门前已停掉全部 5 个长驻进程**（`pnpm start:dev` PID 2032、`nest start --watch` PID 14988、`pnpm dev` PID 17196、admin-dashboard `vite` PID 11044、`dist/app` PID 18084），跑闸门期间**无 node 长驻进程**；取证会话 PATH 补齐 `D:\Apps\Git\cmd`。

| 闸门                    | 命令                                                                               | exit | 真实数字                                                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| 盘延迟体检              | `pnpm doctor:fs`                                                                   | 0    | walk=32ms / cold=88ms(slow 6) / warm=20ms(slow 0) / per-file 均值 0.10ms → **合格**                                          |
| 类型                    | `pnpm typecheck`                                                                   | 0    | **0 error**                                                                                                                  |
| Lint                    | `pnpm lint`                                                                        | 0    | **0 error / 2 warning**（2 条 `import/order` 在 `batch-metrics.service.ts`，**本单未改该文件**，与基线逐一致）               |
| 测试                    | `pnpm test`                                                                        | 0    | **186 文件 passed + 1 skipped（187）**；**3029 passed / 4 skipped（3033 例）**；vitest Duration **86.40s**（墙钟 **88.8s**） |
| 构建（供指纹口径取证）  | `pnpm build`                                                                       | 0    | tsc 通过，`dist/` 重建为当前判据内容                                                                                         |
| engine-core             | `git diff --stat HEAD -- src/engine-core`                                          | —    | **空**（零改动）                                                                                                             |
| 任务特有 · 96 场复算    | `pnpm exec tsx bin/batch-report.ts --batch g3ONzlqSGMVJqkFMF9Lwh --out <临时目录>` | 0    | 覆盖 96/96、1112 轮；全局 6/8、expert 7/8、cold 8/8（详见 §4）                                                               |
| 任务特有 · 指纹两侧一致 | CLI(`tsx`→src) vs 服务端(`node`→dist) 各算一次分段指纹                             | 0    | **7 段逐段相同、combined 均为 `ce51839d02ea4020`**（详见 §5）                                                                |

**与基线对照**：基线 3004 passed / 4 skipped（3008 例 / 186 文件）→ 本单 **3029 passed / 4 skipped（3033 例 / 187 文件）**，净增 **+25 例**（新增 spec 的 25 条用例），**无新增 failed、无新增 skipped**。

---

## 4. 任务特有结果（一）：96 场快照在 v1 / v2 下的判分对照

批次 `g3ONzlqSGMVJqkFMF9Lwh`（8 角色 × expert/cold × 6 重复，maxTurns 12，96/96 场、1112 轮）。
复算命令：`pnpm exec tsx bin/batch-report.ts --batch g3ONzlqSGMVJqkFMF9Lwh --out <临时目录>`。
**说明**：复算产物写到临时目录，**未覆盖仓库内 `data/batch-reports/g3ONzlqSGMVJqkFMF9Lwh.{json,md}`**——该批是按 intake-v1 判读的历史批次，历史报告不改写。

### 4.1 全局（基线档 = v1 单表，逐条相同）

| #   | 判据                    | 实测         | 区间 / 要求   | 判定        |
| --- | ----------------------- | ------------ | ------------- | ----------- |
| 1   | `dim.trust.delta_avg`   | 0.084125     | [0.05, 0.20]  | ✅ PASS     |
| 2   | `dim.safety.delta_avg`  | **0.012365** | [0.02, 0.06]  | ❌ **FAIL** |
| 3   | `dim.bond.delta_avg`    | 0.008208     | [−0.03, 0.03] | ✅ PASS     |
| 4   | `dim.depth.delta_avg`   | −0.010049    |               | Δ           | ≤ 0.10 | ✅ PASS |
| 5   | `dim.style.delta_avg`   | 0.000079     |               | Δ           | ≤ 0.05 | ✅ PASS |
| 6   | `dim.verbal.delta_avg`  | −0.021464    |               | Δ           | ≤ 0.15 | ✅ PASS |
| 7   | `dim.arousal.delta_avg` | −0.007292    | ≥ −0.05       | ✅ PASS     |
| 8   | `session.zero_motion`   | **38**       | 必须为 0      | ❌ **FAIL** |

**全局结论：6 / 8 —— 与 intake-v1 判定逐条一致（任务单要求"全局结论保留，不替换"）。**

### 4.2 `expert` 切片（v2 回落基线档，阈值与 v1 逐条相同）

| #   | 判据                    | 实测      | 判定        |
| --- | ----------------------- | --------- | ----------- |
| 1   | `dim.trust.delta_avg`   | 0.138583  | ✅ PASS     |
| 2   | `dim.safety.delta_avg`  | 0.02125   | ✅ PASS     |
| 3   | `dim.bond.delta_avg`    | 0.0135    | ✅ PASS     |
| 4   | `dim.depth.delta_avg`   | −0.019241 | ✅ PASS     |
| 5   | `dim.style.delta_avg`   | −0.002225 | ✅ PASS     |
| 6   | `dim.verbal.delta_avg`  | −0.038049 | ✅ PASS     |
| 7   | `dim.arousal.delta_avg` | −0.01875  | ✅ PASS     |
| 8   | `session.zero_motion`   | **7**     | ❌ **FAIL** |

**`expert`：7 / 8（FAIL）** —— 只差 `session.zero_motion`（7 场）。v1 单表套该切片也是 7/8，**分档前后完全一致**（expert 回落基线档的设计目的）。

### 4.3 `cold` 切片：v1 单表 vs v2 分档

| #   | 判据                    | 实测                       | v1 单表判定（基线档） | v2 分档判定（cold 档）        |
| --- | ----------------------- | -------------------------- | --------------------- | ----------------------------- |
| 1   | `dim.trust.delta_avg`   | 0.029667                   | ❌ FAIL（< 0.05）     | ✅ PASS（[0.01, 0.08]）       |
| 2   | `dim.safety.delta_avg`  | 0.003479                   | ❌ FAIL（< 0.02）     | ✅ PASS（[0.00, 0.03]）       |
| 3   | `dim.bond.delta_avg`    | 0.002917                   | ✅ PASS               | ✅ PASS                       |
| 4   | `dim.depth.delta_avg`   | −0.000857                  | ✅ PASS               | ✅ PASS（                     | Δ   | ≤ 0.05） |
| 5   | `dim.style.delta_avg`   | 0.002384                   | ✅ PASS               | ✅ PASS（                     | Δ   | ≤ 0.05） |
| 6   | `dim.verbal.delta_avg`  | −0.004880                  | ✅ PASS               | ✅ PASS（                     | Δ   | ≤ 0.05） |
| 7   | `dim.arousal.delta_avg` | 0.004167                   | ✅ PASS               | ✅ PASS（≥ −0.05）            |
| 8   | `session.zero_motion`   | 31（31/48 = **0.645833**） | ❌ FAIL（≠ 0）        | ✅ PASS（≤ 0.70 + 0.01 容差） |

**`cold`：v1 单表 5/8（FAIL） → v2 分档 8/8（PASS）。**

### 4.4 汇总

| 切片     | 场次 | 轮次 | v1 单表  | v2 分档          | 命中的档位            |
| -------- | ---: | ---: | -------- | ---------------- | --------------------- |
| 全局     |   96 | 1112 | 6/8 FAIL | 6/8 FAIL（不变） | `baseline`（兜底）    |
| `expert` |   48 |  561 | 7/8 FAIL | 7/8 FAIL（不变） | `baseline`（回落 v1） |
| `cold`   |   48 |  551 | 5/8 FAIL | **8/8 PASS**     | `cold`（候选阈值）    |

---

## 5. 任务特有结果（二）：I-22 zero_motion 两类语义

### 5.1 判定规则（逐场）

1. **零变化**：该场八个追踪维度的**首末快照全部相等**（与 `session.zero_motion` 指标同口径）。
2. **事件层有非 neutral 事件**（`traces[].eventTags` 里存在任一非 `neutral` 标签）→ 记为 **`closure`（合理封闭）**，按任务单口径**豁免，不计入失效**。
3. **事件层只有 neutral / 无事件标签** → 记为 **`idle`（纯 neutral 空转）**，**计入失效**。
4. **基线档（`baseline`）不使用该拆分**：`session.zero_motion` 仍按 v1 原语义 `must_be_zero`（原始计数必须为 0）——保证 v1 口径一个数值都没改。

### 5.2 数据来源

- **来源**：逐字稿合规投影 `TraceInput.traces[].eventTags`（只含事件标签，**不含对话原文 / messages / renderSpec / intention.rationale**）。
- **计算**：`src/auto-practice/metrics/batch-metrics.compute.ts` 的 `hasNonNeutralEvent()` + `computeZeroMotionBreakdown()`（纯函数、逐场、零 IO）。
- **落库**：`MetricsSlice.zeroMotionBreakdown`（`{ total, closure, idle }`）与快照根级同名字段（**可选**字段，`schemaVersion` 仍为 v1）。
- **判分消费**：cold 档的 `session.zero_motion` 判据 `kind = 'max_ratio'`、`numerator = 'idle'`、`max = 0.70`、`tol = 0.01`，分母 = 切片场次数。

### 5.3 实测豁免场次数（本批）

| 切片     | 零变化总数 | 合理封闭（豁免） | 纯 neutral 空转（计入） |
| -------- | ---------: | ---------------: | ----------------------: |
| 全局     |         38 |            **0** |                      38 |
| `expert` |          7 |            **0** |                       7 |
| `cold`   |         31 |            **0** |                      31 |

### 5.4 诚实结论 + 需主控复核的一点（**重要**）

1. **本批 38 场零变化场次，与"事件层全 neutral"的场次集合完全重合（38/38）**：即**没有一场**零变化场次的事件层存在非 neutral 事件。**按任务单口径，豁免命中 0 场**——cold 档之所以能判 PASS，靠的是它自己的候选阈值（0.645833 ≤ 0.70），**不是**靠豁免。
2. **需要主控复核的语义方向**：任务单 §2.2 字面写的是「事件层存在非 neutral 事件 → 豁免；纯 neutral 空转 → 计入」。本单**按字面实现**（未擅自改口径）。但从临床/工程含义看，"检测器失效"更像是**有非 neutral 输入却状态毫无变化**（输入有动作、状态却不动 = 状态转移没生效），而"合理封闭"更像**输入全程 neutral、来访者本就无从变化**（没东西能推动状态）。若主控认为映射方向应相反，则 cold 档的分子会变成"有非 neutral 事件却零变化"的场次数（本批为 **0**），豁免集合变为 38 场，cold 档的 0.70 阈值将成为**形式门槛**。**本单不替主控做这个决定，两种口径的实测数都已在上表给出，任一方向都可直接换算。**
3. 本单**未改动**任何既有阈值数值，也未把 cold 候选阈值写成硬门槛（见 §6）。

---

## 6. 任务特有结果（三）：cold 档候选阈值清单（**待主控复核**）

> 代码位置：`src/auto-practice/metrics/acceptance-thresholds.ts` 的 `INTAKE_EXPECTATIONS_COLD`；每条 rationale 都带「【候选 · 待主控复核】」前缀，且该档 `provisional = true`。
> 选型依据：§1.2 切片实测（`cold` 48 场 / 551 轮）+ `phase2.5-intake-acceptance-criteria-2026-11-11.md` §3 的方向性依据。

| 判据                    | cold 候选值                         | 实测             | rationale（摘要）                                                                                            |
| ----------------------- | ----------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `dim.trust.delta_avg`   | range **[0.01, 0.08]**              | 0.029667         | 冷漠输入下信任建立显著慢（expert 0.1386）；下限 0.01 保住"完全无响应即不合格"的底线，上限 0.08 允许明显建立  |
| `dim.safety.delta_avg`  | range **[0.00, 0.03]**              | 0.003479         | cold 切片 safety 几乎不涨，属试探性安全缺失的合理反应；下限 0 允许零增长，上限 0.03 防"无节制依赖"滑向另一端 |
| `dim.bond.delta_avg`    | range **[−0.03, 0.03]**             | 0.002917         | 沿用 v1：纽带 3–5 次会谈后才成形，首次会谈本就不该动                                                         |
| `dim.depth.delta_avg`   | max_delta **0.05**                  | −0.000857        | 深度防御基本稳；比基线更紧，专门捕捉"冷漠输入反而把深度防御撬开 / 塌陷"这类异常                              |
| `dim.style.delta_avg`   | max_delta **0.05**                  | 0.002384         | 沿用 v1：人格级表达风格防御稳定                                                                              |
| `dim.verbal.delta_avg`  | max_delta **0.05**                  | −0.004880        | 冷漠输入下话量阻抗几乎不动；比基线更紧，捕捉"话量阻抗被压垮 / 泄洪"这类异常                                  |
| `dim.arousal.delta_avg` | min_value **−0.05**                 | 0.004167         | 沿用 v1：结束时唤醒仍可能高于基线，不要求下降                                                                |
| `session.zero_motion`   | max_ratio **≤ 0.70**（分子 = idle） | 31/48 = 0.645833 | I-22：只计"纯 neutral 空转"的零变化场次；该档不要求为 0，但空转率过高说明"冷漠被静默成中性"的失效面过大      |

**复算稳健性**：cold 档阈值取在实测值两侧有裕度的位置（trust 实测 0.0297 距下限 0.01 有 0.0197 裕度、距上限 0.08 有 0.05；zero_motion 实测 0.6458 距上限 0.70 有 0.054 裕度），**样本内不会贴边**。

---

## 7. 任务特有结果（四）：TD-4 指纹口径修复与两侧一致性证据

### 7.1 修复方式

- 新增统一口径解析器（`src/auto-practice/prompt-fingerprint.ts`）：
  - `findPackageRoot()`：从当前模块目录向上找最近的含 `package.json` 的祖先目录；
  - `resolveDistArtifactPath()`：把 `<root>/src/**` 或 `<root>/dist/**` 映射到 `<root>/dist/**`（去掉 `src`/`dist` 前导段，幂等）；
  - `resolveFingerprintSource()`：**当且仅当**包根下存在构建产物（`dist/<模块路径>.js`）时，返回 `{ baseDir: <root>/dist/auto-practice, extension: '.js', mode: 'dist' }`；否则回退 `{ baseDir: <当前模块目录>, extension: 当前扩展名, mode: 'source' }`。
- `computePromptVersion()`（`prompts` 段的数据源）与 `computeConfigFingerprint()` 的其余 6 段**全部**改走该口径。
- **fail-closed 保留**：任一段文件读不到 → 该段 `unknown` → `combined` `unknown`（有单测覆盖）。
- **两侧一致的原因**：CLI（tsx 跑 src）与服务端（node 跑 dist）**判据是同一个信号**——"包根下有没有构建产物"——因此不会各走各的分支；仓库有构建产物时，两侧都读 `dist/**/*.js`。

### 7.2 两侧一致性证据（同一台机器、同一时刻、同一份构建产物）

| 段                 | CLI（`pnpm exec tsx` → src 上下文） | 服务端（`node` → dist 上下文） | 是否相同 |
| ------------------ | ----------------------------------- | ------------------------------ | -------- |
| `stateTransition`  | `69ccc9b78a23b2c1`                  | `69ccc9b78a23b2c1`             | ✅ 相同  |
| `alliance`         | `b345d48a3a672de6`                  | `b345d48a3a672de6`             | ✅ 相同  |
| `deltaTableConfig` | `99be3719551b6c6b`                  | `99be3719551b6c6b`             | ✅ 相同  |
| `lexicon`          | `4d42d5321212b6f9`                  | `4d42d5321212b6f9`             | ✅ 相同  |
| `baselines`        | `4caa0d3a39015d13`                  | `4caa0d3a39015d13`             | ✅ 相同  |
| `prompts`          | `ed0430680b4c8837`                  | `ed0430680b4c8837`             | ✅ 相同  |
| `acceptance`       | `4474dd5be381d905`                  | `4474dd5be381d905`             | ✅ 相同  |
| **combined**       | **`ce51839d02ea4020`**              | **`ce51839d02ea4020`**         | ✅ 相同  |

（`promptVersion` 两侧同为 `ed0430680b4c8837`。）

### 7.3 与修复前 / 与库内落库值的差异说明

| 值                 | 来源                                                                        | 说明                                                                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `491558624aeafdb3` | 修复前 **CLI/src 口径**（96 场交付记录 §4.3）                               | 与 dist 口径**按设计永不相等**（TD-4 根因）                                                                                                                                |
| `cf032d71ea4849b1` | 修复前 **服务端/dist 口径** = 库内 `ap_practice_batches.config_fingerprint` | 96 场批次落库值（intake-v1 时期）                                                                                                                                          |
| `ce51839d02ea4020` | 修复后**两侧一致**的新值                                                    | 变化来源：`acceptance` 段哈希的**判据文件内容已改**（intake-v1 → intake-v2）；其余 6 段的源文件本单**未改**（`git diff HEAD -- src/engine-core src/engine-adapters` 为空） |

**结论**：新值与库内旧落库值不同是**判据文件内容变更**导致的**预期**差异 —— 判据改了，acceptance 段就该变，跨批判 `incomparable` 正是这一设计（任务单 §1.4 明写）。TD-4 本身的口径不一致（两侧永不相等）已消除。

---

## 8. 契约变化：`GET /admin/api/auto-practice/metrics/catalog`

### 8.1 前后对比

| 字段                            | 修复前      | 修复后                                                          |
| ------------------------------- | ----------- | --------------------------------------------------------------- |
| `data.dictionaryVersion`        | ✅ 存在     | ✅ 不变                                                         |
| `data.acceptanceVersion`        | `intake-v1` | **`intake-v2`**                                                 |
| `data.acceptanceVersionHistory` | —           | **新增** `['intake-v2', 'intake-v1']`                           |
| `data.metrics`                  | ✅ 指标字典 | ✅ 不变                                                         |
| `data.expectations`             | v1 的 8 条  | ✅ **保持不变**（= 基线档，与常量逐条同源引用；旧前端镜像不炸） |
| `data.tiers`                    | —           | **新增** 数组（2 档）                                           |
| `meta.expectationCount`         | 8           | ✅ 不变                                                         |
| `meta.tierCount`                | —           | **新增** 2                                                      |

### 8.2 `data.tiers[]` 元素结构

```jsonc
{
  "id": "cold", // 档位 id (baseline / cold)
  "label": "cold 负向极端档 (候选阈值 · 待主控复核)",
  "counselorModeIds": ["cold"], // 适用模式; [] = 兜底档
  "provisional": true, // true = 候选阈值, 待主控复核
  "note": "…", // 一句说明
  "expectations": [/* 该档判据, 结构同 expectations */],
}
```

### 8.3 前端影响（**本单未改 admin-dashboard 任何代码**）

- `admin-dashboard/src/api/types.ts` 的 `MetricCatalogPayload` **尚未声明** `acceptanceVersionHistory` / `tiers` —— TypeScript 侧**读旧字段不受影响**（后端加字段属向后兼容），但**分档信息目前前端拿不到**。
- `admin-dashboard/src/components/metricCatalog.ts` 的**本地兜底镜像仍是 v1 单表**（8 条），远端拉取成功后仍以 `payload.expectations` 渲染 → **页面现在展示的是基线档口径**，与后端 cold 档不一致。需前端 AI 后续对齐（建议：`tiers[]` 渲染成可切换的模式档视图 + 兜底镜像补 cold 档）。
- 后端 catalog 仍是**只读投影**，**不含任何判定逻辑 / 判定结果**（有单测断言 payload 里不出现 `passed` / `actual`）。

---

## 9. 风险与回归

| 项                               | 结论                                                                                                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 既有测试是否被改                 | **一个都没改**；新增 1 个 spec（25 例）。`wp-k-config-fingerprint.spec.ts` / `wp-k-metric-catalog-endpoint.spec.ts` / `prompt-version.spec.ts` / `wp-k-batch-compute.spec.ts` 等**未改且全绿** |
| 判据返回结构兼容性               | `passed` / `results[].metricId                                                                                                                                                                 | actual | passed | reason` **未删未改语义**，新字段一律增量；`evaluateIntakeAcceptance` 原单参调用（不传 options）行为与 v1 一致 |
| engine-core                      | **零 diff**（`git diff --stat HEAD -- src/engine-core` 为空）；`boundary.spec.ts` 未改                                                                                                         |
| 快照 schema                      | `schemaVersion` 仍为 **v1**（未升）；只**增**可选字段 `zeroMotionBreakdown`；旧快照读端按缺省处理，`assertBatchMetricsV1` 对在场字段验型                                                       |
| 表结构 / migration / 映射 / 装配 | **零改动**                                                                                                                                                                                     |
| 指标字典                         | **零改动**（未新增任何指标 id；判据 id 集合与 v1 完全一致）                                                                                                                                    |
| 咨询师侧                         | 未碰 `ap_counselor_modes` 表数据、未碰 `system_prompt` / 台词生成链路；**未给 AI 咨询师台词定任何 KPI**（被验收对象始终是 AI 来访者状态轨迹）                                                  |
| 隐私                             | 判分与报告只出**计数 / 布尔 / 脱敏后的维度数值**；零变化细分来自 eventTags（事件标签），不含对话原文、量表答案、心理画像                                                                       |
| 指纹 fail-closed                 | 保留并有单测：读不到文件 → 该段 `unknown` → combined `unknown`                                                                                                                                 |
| 回退风险                         | cold 候选阈值未经主控复核前**不应作为硬门槛**使用（代码里 `provisional = true` + rationale 标注）                                                                                              |

| **并行进程产物（提交分组核对）** | 交付时工作区另有 **admin-dashboard/ 3 个文件的改动**（src/i18n/locales/en.ts、src/i18n/locales/zh-CN.ts、src/views/ArchitectureDiagram.vue）—— **非本单改动**（本单未碰 admin-dashboard 任何代码，系并行前端进程产物）。提交时须按 §7 分组 stage，**不要与本单文件混提** |

---

## 10. 遗留项与建议人工复核

1. **cold 档候选阈值待主控复核**（§6 清单）：本单只提出候选值并标注待复核，未转正。
2. **I-22 豁免 / 计入的映射方向待主控定夺**（§5.4）：本单按任务单字面实现；实测两种方向的数都已给出，可直接换算。
3. **I-23（safety 增量全角色系统性偏低）不在本单**：分档后 cold 档的 safety 用的是**候选区间**（0.00–0.03），全局 safety 0.012365 仍低于基线档下限；safety 量级归因需另单（任务单明确排除）。
4. **审议开关仍未开**（`ENGINE_DELIBERATION_ENABLED` 未配 → 96 场审议调用 0 次）：出口条件③的审议成本仍无证据，与本单无关，另单处理。
5. **前端 catalog 镜像待对齐**（§8.3）：`admin-dashboard/src/components/metricCatalog.ts` 仍是 v1 单表兜底镜像，本单按约束未改。
6. **跨批判 `incomparable` 属预期**：判据文件变更后 acceptance 段指纹变化，96 场批次与后续批次按设计不可硬比（任务单 §1.4）。
7. **建议**：下一批（配好审议开关后）用 intake-v2 分档口径重跑一批，既能取审议成本证据，也能验证 cold 档候选阈值在**新样本**上的稳健性（当前候选阈值只在 48 场 cold 切片上标定，样本量偏小）。

---

## 11. 提交信息草稿

```
feat(auto-practice): intake-v2 判据按咨询师模式分档 + 零变化 I-22 语义 + 指纹统一 dist 口径
```

> 按约束**未自动 commit / push**，请主控自行提交。
