# I-21/I-22 + TD-4 · intake-v2 判据按咨询师模式分档 + 指纹口径对齐（判据增强 + bug 修复）

> 状态：✅ **已交付**（2026-11-12，MiniMax Code）→ 交付记录：[phase2.5-intake-v2-mode-stratified-acceptance-implementation-2026-11-12.md](phase2.5-intake-v2-mode-stratified-acceptance-implementation-2026-11-12.md)
> 执行方：MiniMax Code
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 integrate
> 唯一事实源：
>
> - `docs/worklog/completed/phase2.5/phase2.5-verification-batch-96-implementation-2026-11-12.md`（96 场批次交付记录）
> - `docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md` I-21 / I-22
> - `docs/worklog/pending/phase2.5-toolchain-tech-debt-2026-11-11.md` TD-4
> - `docs/worklog/pending/phase2.5-intake-acceptance-criteria-2026-11-11.md`（intake-v1 临床口径）
> - 快照：`data/batch-reports/g3ONzlqSGMVJqkFMF9Lwh.json`
>   任务性质：判据口径增强（I-21/I-22）+ 技术债修复（TD-4）
>   改动范围：仅后端 `src/` / `test/` / `bin/`；`admin-dashboard/` 与 Flutter 一律不改（见 §2）

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `E:\Work\Project\backend\mofang-nestjs\README.md` —— 仓库总览
2. `E:\Work\Project\backend\mofang-nestjs\docs\README.md` —— 文档导航
3. `E:\Work\Project\backend\mofang-nestjs\docs\team\conventions.md` —— 代码红线 + 交付格式（engine-core 分层归属、16 条硬约束）
4. `docs/worklog/pending/phase2.5-README.md` 与 `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` —— 阶段入口
5. 事实源四份（见头部），重点读 I-21 / I-22 / TD-4 的问题描述与边界
6. 本任务单（你在读的这份）

---

## 1. 背景（先读，方向别错）

### 1.1 平台角色分工（本单边界的前提，不许理解反）

本平台是**咨询师对练平台**，存在两条 AI 角色链路：

- **AI 来访者（visitor）**：正式产物，面向 Flutter 用户端。走现有引擎（engine-core + engine-adapters + 8 角色基线 + verbal_voice）；`characterSlug` 标识其人格角色。真实咨询师在客户端跟 AI 来访者对练。
- **AI 咨询师（counselor AI）**：仅存在于 `src/auto-practice/` 调试模块内的 LLM 对手，模式表 `ap_counselor_modes`（expert / novice / chatty / cold / preachy / nonsense），`counselorModeId` 标识其模式。**不进 Flutter 用户路径**。
- `auto-practice` 模块是「AI 咨询师 × AI 来访者」双向自动对练的内部调试设施，用于批量压测引擎反应。

**判据度量的是 AI 来访者的状态轨迹**（trust / safety / bond / depth / style / verbal / arousal / zero_motion）；`counselorModeId` 只是切片维度，用来观察同一个来访者在不同风格咨询师输入下的反应。**本单不给 AI 咨询师台词定任何 KPI**，被验收对象始终是 AI 来访者。

### 1.2 为什么要分档（I-21 / I-22）

v1 判据是一张全局单表，对批次聚合后的 `metrics` 整体判分。96 场批次 `g3ONzlqSGMVJqkFMF9Lwh`（8 角色 × expert/cold × 6 重复，maxTurns 12）实测切片如下（数值取自快照 JSON，非文档转抄）：

| 切片   | 场次 | 轮次 |    trust |   safety |     bond |     depth |     style |    verbal |   arousal | zero_motion | exploration |
| ------ | ---: | ---: | -------: | -------: | -------: | --------: | --------: | --------: | --------: | ----------: | ----------: |
| 全局   |   96 | 1112 | 0.084125 | 0.012365 | 0.008208 | -0.010049 |  0.000079 | -0.021464 | -0.007292 |          38 |       0.125 |
| expert |   48 |  561 | 0.138583 | 0.021250 | 0.013500 | -0.019241 | -0.002225 | -0.038049 | -0.018750 |           7 |       0.125 |
| cold   |   48 |  551 | 0.029667 | 0.003479 | 0.002917 | -0.000857 |  0.002384 | -0.004880 |  0.004167 |          31 |       0.125 |

v1 单表阈值（`acceptance-thresholds.ts` 现行常量）：trust ∈ [0.05, 0.20]；safety ∈ [0.02, 0.06]；bond ∈ [-0.03, 0.03]；depth / style / verbal 为 `max_delta`（0.10 / 0.05 / 0.15）；arousal ≥ -0.05；zero_motion 必须为 0。

问题：

- **I-21（判据未按模式分档）**：全局聚合把 expert 与 cold 混在一起。cold 模式下来访者面对冷漠输入，联盟建立本来就慢，trust / safety 低位是合理反应；用 expert 档阈值套 cold 切片，会把「合理封闭」误判成来访者质量不合格。切片数据已经分开存在（`byMode`），但判分只吃全局 `metrics`。
- **I-22（zero_motion 在 cold 下语义未定义）**：`session.zero_motion` 定义为「八维首末全部相等的场次数」，v1 要求必须为 0。但在 cold 模式下，来访者保持封闭、状态被阻尼压住，与「检测器失效（应动未动、事件层全 neutral）」是两种本质不同的情形。现有口径把前者也算成失效，31 场 cold 零变化场次被误计入。

### 1.3 指纹口径问题（TD-4）

`computeConfigFingerprint` 的文件扩展名默认取自 `import.meta.url`（`config-fingerprint.ts:114`）。服务端运行的是 `dist/*.js`，扩展名 `.js`；CLI（`bin/batch-report.ts` 经 tsx 跑 src）进程入口是 `.ts`，扩展名 `.ts`。两侧 acceptance 段（以及其余文件段）因此读取不同文件，指纹**按设计永不相等**，跨批指纹比对在 CLI 与服务端口径之间不可比。模块文件头注释（`config-fingerprint.ts:17`）已写明「.ts 与 .js 口径互不可比，统一用 dist」，实现尚未对齐。

96 场批次实测对照（交付记录 §4.3）：src 口径 combined `491558624aeafdb3`，dist 口径 combined `cf032d71ea4849b1`；dist 值与库内落库逐位相同。注意 CLI 不直接算指纹——`bin/batch-report.ts:231` 在 CLI 进程内实例化 `BatchMetricsService`，指纹由 `batch-metrics.service.ts:191` 计算，扩展名随进程上下文落到 `.ts`；修复落点在指纹模块 / 该调用链，不是 CLI 内另写哈希。

### 1.4 关键现状（已核对，别当新问题）

- 快照结构现成：`MetricsSlice { sessions, turns, metrics }`（`batch-metrics.schema.ts:41-45`），`byMode` / `byCharacter` 两套切片同构（`batch-metrics.compute.ts:279-284`）。切片判分可直接复用 `evaluateIntakeAcceptance(slice.metrics)`，不需要新造聚合口径。
- 判分唯一调用点：`bin/batch-report.ts:126` `evaluateIntakeAcceptance(snapshot.metrics)`，PASS/FAIL 与未达标项渲染在 :127-146。
- catalog 只读端点：`auto-practice.controller.ts:297-304` `buildMetricCatalog()`（纯常量组装、无判定逻辑），:310-321 `GET metrics/catalog`。
- 指纹唯一服务端调用点：`batch-metrics.service.ts:191` `computeConfigFingerprint({ promptVersion })`；CLI 不直接算指纹，消费快照内 `snapshot.fingerprint`。
- acceptance 段挂在 `acceptance-thresholds.ts`（`config-fingerprint.ts:61`）；判据表改动后该段指纹自然变化，跨批会按设计给出 `incomparable`，无需额外处理。
- 既有测试基线：**3004 passed / 4 skipped（3008 例，186 文件）**；engine-core 交付时 `git diff --stat HEAD -- src/engine-core` 为空。

---

## 2. 范围（严格遵守，不越权）

**在范围内：**

1. **判据表分档**（`src/auto-practice/metrics/acceptance-thresholds.ts`）：
   - 判据按 `counselorModeId` 分档组织；`expert`（及其他未单列模式）回落沿用 v1 现行阈值作为基线档；`cold` 单设一档。
   - `evaluateIntakeAcceptance` 支持按模式切片判分：输入切片指标 + 模式 id，返回与 v1 同构的逐维结果（`passed` / `results[]`，字段名与 `reason` 结构保持兼容）。
   - 版本号 `INTAKE_ACCEPTANCE_VERSION` 由 `intake-v1` 升为 `intake-v2`；v1 阈值表作为历史口径保留可读（不回溯重算历史快照）。
2. **zero_motion 的 cold 豁免语义**（I-22）：区分「合理封闭」与「检测器失效」——零变化场次若事件层存在非 neutral 事件（基于切片内可用的 event 指标 / traces 事件标签判定），不计入失效；纯 neutral 空转场次仍计入。具体事件口径在交付记录里写明判定规则与数据来源。
3. **CLI 报告适配**（`bin/batch-report.ts`）：除全局判定外，对 `byMode` 各切片分别判分并在 MD 报告输出每档 PASS/FAIL 与未达标项；全局结论保留，不替换。
4. **catalog 契约**（`auto-practice.controller.ts`）：端点下发分档后的判据结构与新版本号；保持只读投影、不含判定逻辑。
5. **指纹口径对齐**（TD-4，`config-fingerprint.ts` 及调用链）：文件哈希统一按 `dist/*.js` 口径读取，使 CLI 进程与服务端进程对同一配置算出相同分段指纹；保留 fail-closed 行为（读不到文件 → 该段 `unknown`、combined `unknown`）。
6. **测试**：覆盖分档判分（expert 回落基线 / cold 专属阈值 / 缺模式回落）、zero_motion 两类语义、catalog 端点分档结构与版本号、指纹 .js 口径一致性；并用 96 场快照复算 v1 / v2 对照，结果写入交付记录。

**明确不在范围内（禁止顺手做）：**

- 不改 `src/engine-core/` 下任何文件；`boundary.spec.ts` 不许改。纯计算若确需落内核，先在交付记录里提出并等主控确认，不在本单自行移入。
- 不碰 AI 咨询师模式的 `system_prompt`、台词生成链路与 `ap_counselor_modes` 表数据；不为 AI 咨询师设定任何质量判据。
- 不改 Flutter 客户端（独立仓库）；不改 `admin-dashboard/` 任何代码。后端 catalog 结构若变化，只在交付记录「契约变化」一节列明差异，供前端 AI 后续对齐；`admin-dashboard/src/components/metricCatalog.ts:60-70` 的本地兜底镜像本单不修改。
- 不改表结构、不加 migration、不加列；不改映射函数、resolver、module 装配。
- **I-23（safety 量级偏低归因）不在本单**：等分档切片落地后另单复算。
- 不处理 I-11 / I-16 门槛与判定器词表改造；不跑新批次、不改批次生成参数。
- 不自动 `git commit` / `git push`；写完给 commit message 草稿，等用户指令。

---

## 3. 目标架构 / 交付物

> 设计原则固定四条：单一真相源 / 内容与逻辑分离 / 出错当场炸不进库 / 幂等。

- **交付物 1：分档判据纯函数** —— `src/auto-practice/metrics/acceptance-thresholds.ts`：分档判据常量 + 类型 + `evaluateIntakeAcceptance`（按模式判分）。零 IO、零框架依赖，与现行文件同性质。
- **交付物 2：消费点适配** —— `bin/batch-report.ts`（全局 + 切片判定渲染）、`auto-practice.controller.ts`（catalog 下发分档结构与版本号）。
- **交付物 3：指纹口径修复** —— `config-fingerprint.ts`（或其调用点）统一 dist/.js 口径。
- **交付物 4：测试** —— 纯静态投影校验 / 单元纯函数为主；不起 Nest、不连真实 DB。覆盖：expert 回落基线档、cold 专属档、未知模式回落、zero_motion 合理封闭 vs 空转两类、catalog 版本号与结构、指纹两侧口径一致。

**口径真相源（必填）**：判据表、阈值、版本号唯一真相源是 `acceptance-thresholds.ts` 常量；catalog 端点只读投影下发；CLI 报告与测试只读取该源，不复算判定阈值、不另抄一份口径。版本号随数据下发，便于审计追溯。

**阈值选型纪律**：

- expert 档沿用 v1 现行阈值，不在本单改动。
- cold 档阈值由执行方基于 §1.2 切片实测 + `phase2.5-intake-acceptance-criteria-2026-11-11.md` §3 临床依据提出**候选值**，逐条附 rationale；候选值在代码常量中标注为「待主控复核」，不写成已定稿的验收硬门槛。主控复核后再转正。
- 不引入 v1 未覆盖的新指标作为判据（指标字典改动属另单）。

---

## 4. 红线（违反即返工）

- **分层归属**：纯决策计算 / 纯出口字段 / 纯类型该进 `engine-core/` 就进；`engine-core/` 内禁止任何 NestJS / IO / 网络 / prompt / 模型名 / 心理原文 console；`boundary.spec.ts` 是机器护栏，不许自改。
- 心理对话原文禁止进日志 / console / crash report；报告只出码、计数与脱敏后的维度数值。
- 判据与阈值只在 `acceptance-thresholds.ts` 一处定义；CLI、controller、测试、前端镜像均为消费端，不得复制第二份阈值。
- 判分返回结构保持向后兼容：既有字段（`passed`、`results[].metricId/actual/passed/reason`）不删不改语义；新增字段以增量方式加入。
- schemaVersion（快照 v1）不变；本单改的是判据版本（intake-v2），不是快照 schema。
- 不改表结构 / migration / 内容字段；不越权加需求外功能。
- 不自动 commit / push。

---

## 5. 闸门（分层执行，填真实数字，禁止留空）

### 5.0 命令规范（强制，禁止裸 npx）

- 本仓库 `packageManager=pnpm`：跑脚本用 `pnpm <script>`，跑二进制用 `pnpm exec <bin> <args>`；禁用裸 `npx`。
- 跑闸门前确认机器干净：无 `nest start --watch` / 后台 `vite dev` / `dist/app` 在跑；先跑 `pnpm doctor:fs` 确认盘读延迟正常。
- 取证会话 PATH 需含 git：本机 git 在 `D:\Apps\Git\cmd`。依赖 `execFileSync('git')` 的 spec 在缺 git 的 PATH 下会报 ENOENT 假失败，补齐 PATH 后复跑；不要把环境缺陷记成回归。

### 5.1 日常内循环（定向）

| 目的             | 命令                                                       |
| ---------------- | ---------------------------------------------------------- |
| 语法 / 明显缺陷  | `pnpm lint:fast`                                           |
| 类型（增量缓存） | `pnpm typecheck`                                           |
| 单个测试文件     | `pnpm exec vitest run <file.spec.ts>`                      |
| 受影响测试       | `pnpm test:related -- <src/xxx.ts>` 或 `pnpm test:changed` |

### 5.2 收尾全量闸门（交付前各跑一次，记录真实命令 / exit code / 数字）

| 闸门        | 命令                                                              | 要求                                                                                  |
| ----------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 类型        | `pnpm typecheck`（怀疑缓存失真改跑 `pnpm typecheck:full`）        | 0 error                                                                               |
| Lint        | `pnpm lint`                                                       | 0 error，记 warning 数                                                                |
| 测试        | `pnpm test`                                                       | 全绿；记用例总数、failed / skipped 数与墙钟，并注明机器状态（有无长驻进程、盘读延迟） |
| engine-core | `git diff --stat HEAD -- src/engine-core`                         | 空（或写明例外批准）                                                                  |
| 任务特有    | 96 场快照复算：v1 与 v2 判分结果对照；指纹 CLI / 服务端口径一致性 | 结果写入交付记录                                                                      |

基线参照：3004 passed / 4 skipped；本单交付后不允许新增 failed，最终例数以实测为准。

---

## 6. 交付记录（完成后写，路径固定）

写到：`docs/worklog/completed/phase2.5/phase2.5-intake-v2-mode-stratified-acceptance-implementation-2026-11-12.md`

内容必须含：

1. 一句话总结。
2. 方案设计：实际实现 vs 任务单方案；有偏差写清原方案 / 实际方案 / 为什么（conventions §2.5）。
3. 改动文件清单（新建 / 修改 / 删除，逐个一句用途）。
4. 闸门表：命令 / exit code / 真实数字（error、warning、用例数、墙钟、机器状态）。
5. 任务特有结果：
   - expert / cold 两档在 96 场切片上的 v1 与 v2 判分对照（逐维实际值 + 通过 / 未通过）；
   - zero_motion 豁免判定规则、事件数据来源、豁免场次数；
   - cold 档候选阈值清单 + rationale + 「待主控复核」标注；
   - 指纹口径修复方式与两侧一致性证据。
6. 契约变化：catalog 下发结构前后差异（供前端 AI 对齐 `metricCatalog.ts` 镜像）。
7. 风险与回归：哪些既有测试被改及原因；确认未碰 engine-core / schema / 表结构 / 内容字段。
8. 遗留项与建议人工复核。

---

## 7. 【交付回写清单】做完逐项勾选

- [x] 交付记录已写到 §6 固定路径
- [x] 本任务单从 `pending/` 移到 `completed/phase2.5/`，顶部状态行改为 ✅ 并链接交付记录
- [x] 回写 `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` 本任务行状态与交付记录链接
- [x] 回写 `docs/worklog/pending/phase2.5-README.md` §3 当前任务表
- [x] 更新判据口径文档 `phase2.5-intake-acceptance-criteria-2026-11-11.md`：版本标注 intake-v2 与分档口径（v1 段落保留为历史口径）
- [x] 回写 known-issues：I-21 / I-22 状态更新（若仍有未闭环子项，写明遗留）
- [x] 回写 tech-debt 台账：TD-4 状态关闭或写明残留
- [x] `git diff --stat HEAD -- src/engine-core` 为空
- [x] 提交分组核对：本单文件与并行进程产物分开；未代提交（等主控指令）
- [x] 给出一行 commit message 草稿（不自己 commit / push）

---

## 8. 回复输出约定

完成后在对话里：

1. 说一句「已写入交付记录」并附文件路径，不重复贴全文；
2. 报告闸门真实数字（typecheck / lint / vitest）；
3. 报告 §7 回写清单哪几项已做、有无遗留；
4. 不贴代码 diff 全文，让主控自行 `git diff`。
