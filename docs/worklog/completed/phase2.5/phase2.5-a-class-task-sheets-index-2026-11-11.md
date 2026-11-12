# Phase2.5 A 类任务单索引（MiniMax Code 派单用 · 2026-11-11）

> 本索引把清点出的 A 类 10 项（纯后端代码 / 静态排查）映射到 7 张任务单；每张任务单按 `docs/team/wp-task-template.md` 格式独立可派。
> 基线：分支 `integrate`，HEAD `80e1813`，工作树干净。本批任务单**不含 commit / push**；实现类闸门由执行方自跑并填真实数字。

## 〇、执行回写（2026-11-11 全部交付，主 AI 验收通过）

| #   | 任务单   | 状态      | 交付记录（`completed/phase2.5/`）                           |
| --- | -------- | --------- | ----------------------------------------------------------- |
| 1   | AUDIT-D1 | ✅ 已交付 | `audit-d1-deliberation-fingerprint-2026-11-11.md`           |
| 2   | REVIEW-3 | ✅ 已交付 | `review3-wpn-contract-alignment-2026-11-11.md`              |
| 3   | DOC-2    | ✅ 已交付 | `doc2-neutral-split-timing-weight-assessment-2026-11-11.md` |
| 4   | RESID-1  | ✅ 已交付 | `resid1-stagnation-state-exports-2026-11-11.md`             |
| 5   | I-12     | ✅ 已交付 | `i12-per-session-threshold-plumbing-2026-11-11.md`          |
| 6   | I-20     | ✅ 已交付 | `i20-valence-arousal-role-coefficients-2026-11-11.md`       |
| 7   | P1e-3    | ✅ 已交付 | `p1e3-visitor-semantic-tag-migration-2026-11-11.md`         |

批量回执：`relay-response-phase25-a-class-2026-11-11.md`。验收复跑：tsc 0 error、lint 0 error（记录中的 2 个既有 warning 已不重现）、全量 2991 例（2987 passed + 4 skipped，0 failed）；engine-core 4 文件与 §4 例外批准一致。遗留项 G-1（P0）/ G-2 / G-3 / L-P1e 及各单 L 项均已登记，待后续派单与用户拍板。

## 一、映射表

| A 类项 | 问题 / 来源                                        | 任务单文件                                                                          | 任务性质                              | 改动范围                                         |
| ------ | -------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------ |
| A1     | WP-B 考核场景纯规则核实（出口②未闭环项）           | `phase2.5-audit-deliberation-fingerprint-2026-11-11.md`（AUDIT-D1 §A1）             | 只读审计                              | 纯文档                                           |
| A2     | I-14 `prompt_version` 填充率突变根因               | 同上（AUDIT-D1 §A2）                                                                | 只读审计                              | 纯文档                                           |
| A3     | I-15 `gate_decisions` 始终 0 行根因                | 同上（AUDIT-D1 §A3）                                                                | 只读审计                              | 纯文档                                           |
| A4     | TD-2 遗留：`stagnation-calibration.ts` 2 个 TS2459 | `phase2.5-resid1-stagnation-state-exports-2026-11-11.md`（RESID-1）                 | 类型可见性小修                        | 后端 `src/auto-practice/`                        |
| A5     | I-12 门槛实例级单例 → per-session 注入缝           | `phase2.5-i12-per-session-threshold-plumbing-2026-11-11.md`（I-12）                 | 装配重构（数值冻结）                  | 后端 wiring；必要时内核纯端口                    |
| A6     | I-20 valence / arousal 角色级系数                  | `phase2.5-i20-valence-arousal-role-coefficients-2026-11-11.md`（I-20）              | 内核纯算子端口（种子 1.0 零行为变化） | `src/engine-core/`（例外批准）                   |
| A7     | I-18 `neutral` 拆分（含 cold 模式先验可行性）      | `phase2.5-i18-i19-neutral-split-timing-weight-assessment-2026-11-11.md`（DOC-2 §A） | 纯文档评估                            | 纯文档                                           |
| A8     | I-19 时序权重可行性（协议变更评估，不改代码）      | 同上（DOC-2 §B）                                                                    | 纯文档评估                            | 纯文档                                           |
| A9     | WP-N 前后端契约类型对齐复核                        | `phase2.5-contract-wpn-fe-be-alignment-review-2026-11-11.md`（REVIEW-3）            | 只读审计；前端类型缺口才修            | 默认纯文档；修复仅 `admin-dashboard/src/api/`    |
| A10    | P1e Phase3 `visitor.prompts.ts` 语义标记迁移       | `phase2.5-p1e-phase3-visitor-semantic-tag-migration-2026-11-11.md`（P1e-3）         | prompt 文案迁移 + 离线灰度对比        | 后端 `src/agent/visitor/`（+ 离线对比脚本/说明） |

## 二、分组与建议派发顺序

### 第 1 组 · 只读审计 / 文档（不依赖修复结论，可先派）

1. **AUDIT-D1**（A1 + A2 + A3）：三条根因沿调用链钉死；结论决定后续是否需要修复单。
2. **REVIEW-3**（A9）：契约对照；仅前端类型缺口才动手。
3. **DOC-2**（A7 + A8）：方案分级与契约可行性论证；零代码。

### 第 2 组 · 后端小修（独立、低风险）

4. **RESID-1**（A4）：两个状态接口加 `export`，清 TD-2 遗留的 2 个 TS2459；运行时零行为变化。

### 第 3 组 · 实现类（建议在第 1 组审计结论回来后再派）

5. **I-12**（A5）：打通会话级配置注入缝；阈值 / 系数数值一律冻结，真实覆盖来源待标定单接入。
6. **I-20**（A6）：补 valence / arousal 系数端口，种子全 1.0；临床差异化倍率与适配层 env 扩列另单跟踪。
7. **P1e-3**（A10）：prompt 标记迁移；先离线批次对比降级率与 `[pause]` 命中率，在线切换由用户复核指标后拍板。

## 三、跨单纪律（派单前知会执行方）

- 命令一律 pnpm，禁止裸 npx；内循环定向跑，全量闸门只在收尾跑一次。
- `src/engine-core/` 默认零改动；例外改动必须在交付记录按 conventions §1.1 写批准说明，`boundary.spec.ts` 全绿。
- 灰度期不调子强度 / 阈值 / 系数临床值；本批实现类任务均为「端口 / 缝 / 种子 1.0」，不带数值变化。
- 心理对话原文不进日志 / console / crash report；只出码与计数。
- 不自动 commit / push；提交按任务分组 stage，本单文件与并行产物不混提。
- 审计类任务发现活缺口时只登记后续任务单条目，不在本单就地修复。

## 四、未纳入本批（B / C / D 类，见盘点结论）

- **B 类（依赖真库 / LLM 批次）**：100 场验证批次、出口③成本种子校准、出口④ ≥80% 验收、出口⑤场次条数复核与补量、I-08 / I-17 批次复核、存量 clean 基线重跑、40 轮档。
- **C 类（人工标注 / 临床拍板 / 外部输入）**：按批人工标注与锚点标定、I-02 漏判率人工抽样、I-17 独立算法复核、问题清单排期拍板、rubric 89 条断言临床复核、Phase4 外部资质阻塞项。
- **D 类（已登记 backlog，不在主线清）**：FE 51 条既有 vue-tsc 类型债（涉文件数以现场 type-check 复跑为准）、FE `includeInvalid` 选择器开关、scripts tsconfig（M-4 维持现状）。
