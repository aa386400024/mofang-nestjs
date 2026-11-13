# G-4 · 规则轨词表子串重叠量级离线取证（纯取证 · 零 core 改动）

> 状态：✅ **已完成**（2026-11-13，MiniMax Code 执行；交付记录：`phase2.5-g4-lexicon-substring-overlap-evidence-implementation-2026-11-13.md`）
> 仓库：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`，基线 HEAD `399b6af`（本地 = 远端；工作区除 `data/quality/*.diff|*.md` 未跟踪诊断产物与 `docs/worklog/archive/relay-response-*` 回执外干净，`src/engine-core` diff 为空）。
> 事实源：结构债草案 `docs/worklog/pending/phase2.5-engine-core-structural-debt-assessment-2026-11-12.md`（§4.2 :164 G-4 附带登记、§3 I-01/I-02/I-18 行）；台账 `docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md`（I-01 词表段 :47-70）；D-1 第一段取证交付记录 `docs/worklog/completed/phase2.5/phase2.5-d1-event-classifier-evidence-implementation-2026-11-12.md`（基线快照 spec 与双重命中锚）；I-11 交付记录 `docs/worklog/completed/phase2.5/phase2.5-i11-accessibility-reconciliation-implementation-2026-11-13.md`（归档遍历 / 跳过披露 / 哈希完整性范式）。
> 任务性质：**离线只读取证单**（评估 / audit 类，对应草案 §4.2 附带登记 G-4）。不产运行时行为改动；产物 = 1 个只读复算脚本 + 取证结论（写入交付记录）+ 台账 / 草案 / README / wp-list 回写。本单只回答「子串重叠在归档里贡献了多少额外增量」的量级问题；**不做消歧实现、不改词表、不改分类器、不动 D-1 基线快照 spec**。
> 改动范围：`scripts/ops/quality/` 新增 1 个 tsx 脚本；docs 回写 4 处 + 交付记录 + 任务单归档；**core / adapter / 业务层 / 前端 / `.env.example` / `test` 零改动**；不碰 DB migration、不接 env、不调真模型、不跑批次、不改门槛取值与判据结构。
> **执行结果速览（2026-11-13 · MiniMax Code）**：静态穷举复核一致 —— 真相源实为 **9 条**规则（任务单写「8 条」但枚举 9 个 kind，见交付记录偏差 1），跨规则子串包含对**仅此 1 对**（`open_probe.「你觉得呢」` ⊃ `empathy.「你觉得」`）、同规则 0 对；**归档实测 646 场 / 18592 有效轮**：与该重叠对口径一致的双命中轮**仅 3 轮（0.0161%）**，全在 baseline、全非退化（小满 2 + 亦舟 1），其他多事件轮 61 轮（真实双事件，量级是重叠对 20 倍）；**§3.3 群体对照按口径判「样本不足 · 不出结论」**（重叠对组 n=3 < `--min-samples` 20），改用**上界**报告：重叠对轮 trust 占全库正向 trust 累计 **0.4016%** → **机制成立、量级接近不可见**。闸门全绿：脚本 exit 0（2.18s）、`tsc -p tsconfig.build.json` 0 错、全量类型检查 **401 条 / 87 文件 = HEAD `399b6af` 实测基线逐字一致**、单文件严格类型 0 错、`pnpm lint` **0 error 0 warning**、boundary **12 绿**、定向三路径 **102 文件 / 1890 例** / 四路径 **121 文件 / 2196 例**、全量 **3236 passed + 4 skipped（3240 例，193 文件）**、**六个变更面全空**、归档前后哈希逐字一致。偏差 8 条与新遗留 G4-L5~L4-L7 见交付记录。

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `AGENTS.md`（§1 分层、§2.1 engine-core 红线、§5.1 隐私）→ `README.md` → `docs/README.md` → `docs/team/conventions.md`（§1.1 分层、§1.3 pnpm 命令、§二 交付格式、§2.5 任务单与代码不符时的处置）。
2. 本开工单全文；I-11 交付记录（归档遍历、跳过披露、哈希完整性、隔离口径范式）；D-1 第一段取证交付记录（规则轨基线快照护栏用途）。
3. 现状锚点（§2 表）；既有取证脚本 `scripts/ops/quality/i11-accessibility-reconciliation.ts`（归档目录遍历 / trace 投影 / 纯函数与 main 分离 / 隐私输出口径）与 `scripts/ops/quality/d1-event-classifier-evidence.ts`（lineage 关联 `counselorModeId` + fileSha256 校验范式）。

---

## 1. 背景与已决项

### 1.1 背景

草案 §4.2 附带登记 **G-4 词表子串重叠**：`empathy` 词条 `你觉得` 是 `open_probe` 词条 `你觉得呢` 的子串，一句「你觉得呢」可同时命中两类，单轮正向增量叠加。D-1 第一段已把「双重命中存在」变成可执行证据（基线快照 spec 逐字锁定该锚），但遗留一个**量级问题未复算**：cold 场（及全库）小幅正向增量里，有多少比例由这种子串重叠双命中贡献。

主控 2026-11-13 离线静态复核：`EVENT_LEXICON` 8 条规则全量 terms 穷举，**跨规则子串包含对仅 1 对**（`empathy.「你觉得」 ⊂ open_probe.「你觉得呢」`）；同规则内 terms 互不为子串。脚本须复核该清单一致，并在此基础上做归档实测频次与增量量级归因。

### 1.2 已拍板（2026-11-13 用户确认「先补 G-4 取证再定」）

| #     | 议题           | 拍板结论                                                                                                                                                 | 依据                                   |
| ----- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 1.2.1 | 任务形态       | **纯离线只读取证**：输出重叠对清单、双命中频次分布、增量量级对照；不实现消歧（词表改词 / 分类器互斥 / 最长匹配均不在本单）                               | 用户拍板；草案 G-4 为附带登记          |
| 1.2.2 | 输入范围       | `data/archives/` 全部 6 个归档子目录；脚本支持 `--dir` 可复跑单目录；不连 DB、不读未归档运行时会话                                                       | 沿用 I-11 口径                         |
| 1.2.3 | 脚本落点与形态 | `scripts/ops/quality/g4-lexicon-substring-overlap-evidence.ts`，`tsx` 执行；纯离线只读文件；纯计算函数与 `main()` 分离，便于复核                         | 沿用 quality 组既有范式                |
| 1.2.4 | 测试形态       | **不新增 vitest spec**（纯取证脚本）；脚本内纯函数保持无副作用、可人工复算                                                                               | 取证单惯例；与 I-11 / D-1 取证脚本同构 |
| 1.2.5 | 结论边界       | 本单只出证据、量级对照与口径说明；「是否消歧、改词还是改分类器、是否修订基线 spec」属取证结论 + 用户拍板后的另案实现单，报告与交付记录不替用户下实现结论 | 草案 §4.2；D-1 护栏纪律                |

### 1.3 工程纪律（延续 audit / I-11 范式）

- **隐私红线**：脚本输出与报告只出角色 slug / label、批次目录、事件 kind、轮次、计数、比率与向量分量数值；**不出现任何对话原文、命中词原文回放、prompt 全文、`kernelState` 明细、单场会话 id**。
- **真相源唯一**：词表以 `src/engine-core/domain/events/event-lexicon.ts` 为唯一源；delta 种子向量以 `src/engine-core/cognition/state-transition.ts` 的 `DELTA_TABLE` 为唯一源。脚本注释标注真相源文件与行号；**不在脚本内复制第二套种子表做运行时复算**（参照 §3.4 参照口径约束）。
- **只读不写**：脚本只读归档 JSON；不写 DB / Redis、不发网络请求、不读 `process.env`；不修改任何归档文件。
- **可复算**：报告内每个数字必须由脚本输出复算得到，不手填、不照抄既有记录；既有基线数字作为对照列并列，不改写历史口径。

## 2. 已核现状锚点（2026-11-13 主控只读复核；行号以代码为准，先 grep 符号名定位）

### 2.1 词表与分类器

| 锚点       | 位置                                                       | 现状                                                                                                                                                                                                           |
| ---------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 规则词表   | `src/engine-core/domain/events/event-lexicon.ts`           | `EVENT_LEXICON` 8 条 `EventRule`（empathy / acceptance / normalization / open_probe / affirmation / judgment / preaching / minimizing / boundary_cross）；纯常量、无 I/O；匹配口径 = 小写子串包含（:6-8 注释） |
| 规则分类器 | `src/engine-core/cognition/rule-based-classifier.ts:18-29` | 遍历全部规则，每条规则命中即把该 kind 推入 `events[]`；**无互斥、无优先级、无子串消歧**；一条文本可命中多类，未命中归 `neutral`                                                                                |
| 已知重叠对 | 同上两文件                                                 | `empathy.terms` 含 `你觉得`；`open_probe.terms` 含 `你觉得呢`；前者是后者子串。主控穷举：跨规则子串对仅此 1 对，同规则内无包含                                                                                 |

### 2.2 delta 种子向量（参照口径真相源；脚本不复制进运行时复算）

| 事件       | trust | safety | bond  | 真相源                        |
| ---------- | ----- | ------ | ----- | ----------------------------- |
| empathy    | +0.10 | +0.02  | +0.01 | `state-transition.ts:199-214` |
| acceptance | +0.08 | +0.02  | +0.01 | `state-transition.ts:215-230` |
| open_probe | +0.05 | +0.01  | 0     | `state-transition.ts:247-262` |

> 完整向量（verbal / depth / style / valence / arousal / positive / negative / dependency）以源码 `DELTA_TABLE` 为准。归档实测 delta 经角色倍率、人格调制、`capTurnDelta` 折损与时序权重（缺省等权）处理，**不等于种子向量直接相加**。

### 2.3 归档 trace 可用字段（主控已抽样核实）

会话顶层：`characterSlug` / `characterLabel` / `turnCount` / `messages` / `traces[]` / `kernelState`。trace 字段：`turnIndex`、`characterSlug`、`bdiSnapshot{trust,safety,bond,valence,arousal,resistance,resistanceVerbal,resistanceDepth,resistanceStyle,anxiousSecure}`、`delta{...}`、`deltaDetail{..., events[]}`、`eventTags[]`、`eventTagLabels[]`、`degraded`、`llmUsage`、`intention`、`crisis`、`renderSpec`、`deliberationTrace`、`ts`。

- `eventTags[]` = 本轮命中事件 kind 列表；`deltaDetail.events[]` 与之一致，`delta` = 本轮合并后向量。
- 会话顶层**不带** `counselorModeId`；模式切片须经 lineage（批次报告 JSON）按 `debugSessionId` 关联，范式见 `d1-event-classifier-evidence.ts:187-215`。
- 归档 6 子目录：`debug-sessions-baseline-20261109`、`debug-sessions-pre96-2026-11-12`、`debug-sessions-verify-p1d-2026-11-10`、`debug-sessions-verify-prompt-version-2026-11-10`、`debug-sessions-verify-route1-2026-11-10`、`debug-sessions-verify-route1-p1d-2026-11-10`。

### 2.4 既有护栏（本单不得改动）

`test/quality/d1-event-classifier-evidence.spec.ts:436-458` 固定语料逐字锁定旧分类器口径；其中 `:453-456` 锁定「你觉得呢」同时命中 `empathy` + `open_probe`。该 spec 是规则轨回归对照锚；未来若派消歧实现单，须同步评估修订本组断言——**本单不碰**。

### 2.5 基线闸门数字（HEAD `399b6af` 复算为准，下表仅参照）

全量类型检查 **401 条 / 87 文件**；boundary **12 例绿**；全量 **3236 passed + 4 skipped（3240 例，193 文件）**；lint **0 error 0 warning**；归档 646 场 / 18592 有效轮。

## 3. 取证口径与输出

### 3.1 静态子串重叠对复核

- 脚本内置词表读取口径（与 `event-lexicon.ts` 同结构的静态声明，或在脚本注释逐字列出 terms），穷举跨规则与同规则子串包含对；输出清单须与主控复核一致（跨规则 1 对：`empathy.你觉得 ⊂ open_probe.你觉得呢`）。
- 若穷举出主控清单之外的新对子，列入「偏差」节，标注两边规则与词条，不擅自判定为应修。

### 3.2 实测频次分布（归档事实）

逐轮投影，输出：

1. **子串重叠对轮**：`eventTags` 同时含 `empathy` 与 `open_probe` 的轮次（即由该重叠对导致的双命中）；按角色、批次目录、`degraded` 分层计数与占有效轮比例。
2. **其他多事件轮**：`eventTags.length ≥ 2` 但不属于 §3.2-1 的轮次（一句语料命中多个互不构成子串的规则，属真实双事件，不是重叠所致）；单列计数，**不混入重叠对归因**。
3. 单事件轮、`neutral` 轮计数与跳过披露（非 JSON / 解析失败 / 无角色 / 无 traces / 根目录散落文件，口径同 I-11）。

### 3.3 增量量级归因（主口径 · 归档实测，群体对照）

- 对 §3.2-1 重叠对轮，取 `delta` 向量分量（trust / safety / bond 等同盟三维为主，其余维度并列）。
- **对照组**：仅含 `empathy` 单事件轮（不含 open_probe）的 `delta` 分布（中位 + 区间 + 样本量）；必要时并列仅含 `open_probe` 单事件轮分布。
- **对照输出**：重叠对轮相对 empathy 单命中对照，在各同盟维度多出的增量量级（中位差 + 区间）；样本不足（`< --min-samples`，默认 20）的分组标「样本不足 · 不出结论」，不强行给点值。
- **口径纪律**：做群体分布对照，**不做逐事件精确分量分解**（归档 delta 经倍率 / 调制 / cap，脚本不反推单事件分量）；报告须写明该对照是群体量级估计，非逐轮精确拆分。
- 模式切片：传 `--lineage` 批次报告 JSON 时按 `counselorModeId` 分层；未传则主口径不按模式分层，只按角色 / 批次目录。

### 3.4 参照口径（静态种子，仅量级参照，不作实测结论）

- 列出 empathy / open_probe 种子向量相加的理论增量（真相源 §2.2），明确标注：**未含角色倍率、人格调制、cap 折损与时序权重**，仅用于理解量级方向；实测对照一律以 §3.3 归档 delta 为准。

### 3.5 归档完整性

运行前后对归档目录做全清单哈希（文件数 / 字节数 / SHA256，口径同 I-11），报告逐字一致；不一致在偏差节披露。

## 4. 隔离与硬约束

- **零改动面**：`src/engine-core` / `src/engine-adapters` / 业务层 / `src/admin-dashboard` / `.env.example` / `test/` 变更面必须为空；不新增 core 导出或文件；`boundary.spec.ts` 不改。
- **脚本隔离**：仅 `node:fs` / `node:path` / `node:url` / `node:crypto`；**不 `import` 任何 `src/**`**；不读 `messages[].text`、`kernelState`；无 `process.env`、无 DB / Redis / 网络 / fetch、不调模型。
- **CLI**：`--dir`（默认 `data/archives`）、`--out`（报告输出路径）、`--lineage`（可选，批次报告 JSON）、`--min-samples`（默认 20）。
- **脚本输出**：报告落 `data/quality/`（该目录 `*.md` / `*.diff` 未被 gitignore 覆盖，提交时显式排除，不入库）。

## 5. 闸门要求（pnpm，禁裸 npx；命令以 `package.json` 为准）

| 闸门               | 要求                                                                                                                                                                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 脚本可运行         | `pnpm exec tsx scripts/ops/quality/g4-lexicon-substring-overlap-evidence.ts --dir data/archives --out <报告>` exit 0                                                                                                                                                        |
| 类型（build）      | `pnpm exec tsc -p tsconfig.build.json --noEmit` 0 error                                                                                                                                                                                                                     |
| 类型（含 spec）    | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`；401 条 / 87 文件基线逐字一致，本单新增 0 错                                                                                                                                                        |
| 脚本单文件严格类型 | `pnpm exec tsc --ignoreConfig --noEmit --strict --target es2024 --module nodenext --moduleResolution nodenext --types node --skipLibCheck scripts/ops/quality/g4-lexicon-substring-overlap-evidence.ts` 0 error（根 tsconfig 不含 `scripts/**`，参照 I-11 偏差 7 口径补验） |
| Lint               | `pnpm lint` 0 error / 0 warning；`pnpm exec oxlint` 脚本 0 error / 0 warning；`pnpm exec prettier --check` 脚本与本单 md 通过                                                                                                                                               |
| 边界护栏           | `pnpm exec vitest run test/engine-core/boundary.spec.ts` 12 例全绿                                                                                                                                                                                                          |
| 定向 / 全量测试    | 定向三路径、四路径、全量结果与基线逐字一致（文件数 / 用例数 / passed / skipped / failed）；core 与 adapter 变更面为空                                                                                                                                                       |
| 归档完整性         | 运行前后清单哈希逐字一致                                                                                                                                                                                                                                                    |

> 墙钟数字须带机器状态（是否有长驻进程、盘读取延迟）；既有债（401 / 87）与本单新增改动分开记录，不在本单清理。

## 6. 交付物与文档回写

**新增**：

- `scripts/ops/quality/g4-lexicon-substring-overlap-evidence.ts`
- `docs/worklog/completed/phase2.5/phase2.5-g4-lexicon-substring-overlap-evidence-implementation-2026-11-13.md`（交付记录：改动文件、口径决策、闸门数字、偏差清单、遗留登记）
- `docs/worklog/completed/phase2.5/phase2.5-g4-lexicon-substring-overlap-evidence-task-2026-11-13.md`（本任务单归档；状态行改 ✅，指向交付记录）

**回写既有文档**（活文档；历史交付记录只读）：

- 台账 `phase2.5-p1d-known-issues-2026-11-11.md`：I-01 或 I-18 段补 G-4 取证落地状态行 + 结论指向交付记录。
- 草案 `phase2.5-engine-core-structural-debt-assessment-2026-11-12.md`：§4.2 :164 G-4 附带登记行补取证落地状态与结论指向。
- `phase2.5-wp-list-2026-11-08.md` 与 `phase2.5-README.md`：各登记本单一行。

## 7. 遗留（本单不闭合）

| #     | 遗留                                                                                                                                                     | 归属                            |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| G4-L1 | 是否消歧（词表改词 / 分类器互斥 / 最长匹配优先）及选型；若动规则轨分类口径，须同步评估修订 D-1 基线快照 spec `:453-456` 锚                               | 取证结论 + 用户拍板后另派实现单 |
| G4-L2 | 重叠对增量在 cold / expert 模式下的分层量级；依赖 lineage 批次报告关联                                                                                   | 标定 / 灰度批次                 |
| G4-L3 | 规则轨整体待模型轨替换（蓝图方向）；本单只量化重叠对，不扩规则轨词表                                                                                     | 另案                            |
| G4-L4 | 若未来新增词表词条，须复核跨规则子串包含（条件触发，非本单待办）                                                                                         | 后续词表变更单                  |
| G4-L5 | **归档不落命中词**（`matchedTerms`）→ 重叠对贡献只能给上界，无法逐轮证明因果；若要精确归因，需在归档侧补存命中词快照                                     | 归档 / 采集层另案               |
| G4-L6 | **归档场次不在现有批次血缘内** → 模式分层（cold / expert）在当前归档上不可用（`--lineage` 试跑命中 0 轮）                                                | 批次血缘治理单                  |
| G4-L7 | **重叠对触发量级过小**（3 轮 / 0.0161%）→ 群体对照在现有样本上永远样本不足；若要给出统计结论，需先造**针对性语料批次**（大量含「你觉得呢」的规则轨回放） | 灰度 / 语料批次单               |

## 8. 开工 checklist

- [x] §0 必读文档读完；§2 锚点 grep 复核与源码一致（行号漂移以符号名为准并在偏差节注明）。
- [x] 脚本纯函数与 `main()` 分离；无 `src/**` import；无 I/O 副作用（除读归档文件与写报告）。
- [x] §3.1 静态对子串清单与主控复核一致；新对子入偏差节。
- [x] §3.2 重叠对轮与其他多事件轮分组清晰，不混算；跳过披露计数齐全。
- [x] §3.3 群体对照口径，不做逐事件分量分解；样本不足分组显式标注。
- [x] §3.5 归档前后哈希一致；报告数字均可由脚本复算。
- [x] §5 闸门全部通过并回填真实命令 / exit / 数字 / 墙钟与机器状态。
- [x] §6 交付物齐全；台账 / 草案 / wp-list / README 回写完成；排除项（`data/quality/*`、archive relay 回执）未入库。
