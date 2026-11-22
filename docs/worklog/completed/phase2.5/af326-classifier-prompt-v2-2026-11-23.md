# AF-326 · 模型分类器 prompt v2 收紧与分层影子复评

- 交付日期：2026-11-23
- 工作树：`D:\work\Project\backend\mofang-nestjs-af281r`
- 分支：`task/AF-326-classifier-prompt-v2`
- 基线：`db2e2efdd77feb45dd38007e432fd4cc109a7a1b`（`integrate`，AF-323 squash merge）
- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-326/task-sheet.md`
- 任务状态：`submitted` → 回执摄入后由 CLI 转 `completed` 并归档

## 1. 结论

本单只改模型分类器 prompt 与对应测试，不改规则轨、不改内核、不切生产模式。核心结果：

1. `MODEL_CLASSIFIER_PROMPT_VERSION` 从 `model-event-classifier-v1` 升到 `model-event-classifier-v2`；观测、会话统计与单元测试均可核对。
2. 标签口径从「一句话定义」收紧为可执行优先级：先判具体行为标签；无具体行为时默认 `neutral`；`neutral` / `holding_present` / `cold_absent` 三者互斥；默认只给一个具体行为标签，最多两个。
3. `open_probe` 排除封闭式提问、澄清、复核事实、心理教育后的提问、行动许可、练习确认、二选一、问「愿不愿意试一次」、问「哪一句想改」；句末问号不等于 open_probe。
4. `sensitive_touch` 只在 user prompt 的敏感议题词表被明确列出且本轮实际触及时输出；词表为空时 user prompt 显式写入禁止项，模型轨 v2 在 66 个可用轮中 0 次输出。
5. 真实 shadow 70 次调用 / 66 可用：exact 33/66（0.5000）、Jaccard 0.5581、规则轨 neutral 0.5758、模型轨 neutral 0.5606，差 **1.52pp**；相比 v1 的 exact 0.0769、Jaccard 0.1859、neutral 差 61.54pp 有实质改善。
6. **仍保持 `shadow`，不切 `llm_active`**：exact 0.50 低于早期建议的 0.60，且 3s 超时下降级 4/70（5.71%），规则轨也不是人工金标准。生产判定零变化。

## 2. 闸门结果（gateResults）

| 命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run test/engine-adapters/model-event-classifier.spec.ts` | 1 文件通过；71 例通过（含新增 2 例 prompt v2 契约） |
| `pnpm typecheck` | exit 0；`tsc -p tsconfig.json --noEmit --incremental --tsBuildInfoFile node_modules/.tmp/tcheck-full.tsbuildinfo`，与 CI 同口径 |
| `pnpm lint` | exit 0；0 error / 0 warning |
| `pnpm test` | 288 文件通过 / 1 跳过（289）；4437 例通过 / 4 跳过（4441）；19.60s |
| `pnpm audit:classifier-shadow -- --rule-only --sample-per-session 10 --limit 70` | 70 轮、可用 70、降级 0、exact 70/70、Jaccard 1.0000、neutral 0.5714 |
| `pnpm audit:classifier-shadow -- --sample-per-session 10 --limit 70` | 70 轮、可用 66、降级 4、exact 33/66、Jaccard 0.5581、neutral 规则 0.5758 / 模型 0.5606 |
| `git diff --stat HEAD -- src/engine-core` | 空 |
| `node scripts/orchestration/cli.mjs events verify` | 回执摄入后执行，以 CLI 输出为准 |
| `node scripts/orchestration/cli.mjs worklog verify --strict` | 回执归档后执行，以 CLI 输出为准 |

## 3. 范围核对（scopeCheck）

- 结论：`in-scope`（编排状态面由 CLI 自动生成，非手工改动）。
- prompt 与版本常量：`src/engine-adapters/cognition/model-event-classifier.ts`。
- 测试：`test/engine-adapters/model-event-classifier.spec.ts`。
- 报告：`docs/worklog/completed/phase2.5/af326-classifier-prompt-v2-2026-11-23.md`、`docs/worklog/completed/phase2.5/af326-classifier-shadow-recheck-2026-11-23.md`。
- 记录：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-326/`；AF-324 / AF-325 为 scope / 依赖原因取消的记录包。
- 编排状态面：`docs/team/agent-orchestration/task-state-index.json`、`state/journal.jsonl`、`state/archived-notes.json`、`orchestration-snapshot.json`、`web/orchestration/data.js`，均由 CLI 写入。
- `src/engine-core/**` 零改动。
- 未改：规则轨词典、分类器模式配置、生产来访者模型、审计 CLI 统计口径、`typings/global.d.ts`。
- 未纳入提交：`data/phase25-exit/af229-lite-dev-12/`、`af280-engine-render-v5/`、`af295-v2-screen6/`、`af295-v2-smoke2/` 四个历史取证目录。

## 4. 契约核对（contractChecks）

| 契约项 | 结果 | 说明 |
| --- | --- | --- |
| taskId | pass | AF-326 经 CLI register / promote / run-once 领单；分支名与提交标题只含一个任务号 |
| rescope-audit | pass | AF-324（orchestrator 资源域不含 src/test）→ cancel；AF-325（依赖含已取消 AF-324）→ `task rescope` 重签发为 AF-326，`priorTasks` 保留审计链 |
| state-write | pass | 状态索引、事件链、快照、web 数据均经 CLI 生成，未手改状态面 |
| scope | pass | 代码、测试、报告、记录均在任务单声明的文件域内 |
| prompt-version | pass | 常量、观测记录、测试统一为 `model-event-classifier-v2` |
| sensitive-touch-binding | pass | v2 在 66 个可用轮中 0 次输出；词表为空时 user prompt 显式禁止 |
| neutral-alignment | pass | 规则 0.5758 / 模型 0.5606，差 1.52pp，满足 ≤10pp |
| shadow-only | pass | 审计固定 `effectiveMode: 'shadow'`；生产判定仍来自规则轨，零变化 |
| clinical-boundary | pass | 规则轨不是人工金标准；未宣称临床有效性；真人标定独立排期 |

## 5. 偏差表（deviationTable）

| 任务单说 | 实际做法 | 理由 |
| --- | --- | --- |
| taskId 原定 AF-324 | AF-324 被 `scope-domain-conflict` 拦下，cancel 后由 executor 任务 AF-325 承接；AF-325 因依赖已取消任务无法 promote，再 `rescope` 为 AF-326 | 不修改资源域、不绕过依赖校验；按框架 `rescope` 保留审计链 |
| 多标签「只在两个行为独立成立时输出」 | 进一步收紧为「默认一个，最多两个」 | 真实复核显示多标签是过判主要来源；最多两个仍允许独立成立的复合轮 |
| prompt 首版 v2 一次成型 | 分两版收紧：首版 56 可用 exact 0.2321 / Jaccard 0.3720 / neutral 差 35.71pp；第二版才达到 0.5000 / 0.5581 / 1.52pp | 首版仍把分析建议后的问句判 open_probe、把分析中的情绪词判 empathy；按真实失败样本二次收紧，而不是把首版数字当结论 |
| 任务单要求「至少 7 场 × 10 轮」 | 70 次抽样覆盖 7 场 × 10 轮；66 轮可用，4 轮 3s 超时降级 | 抽样覆盖满足；可用轮 66 已明确写进报告，不把降级轮算进 exact / Jaccard |
| 降级率早期建议 ≤5% | 实测 4/70（5.71%），未达标 | 3s 超时预算由 AF-323 审计 CLI 固定；本单不改审计脚本，按实测记录并列为遗留 |
| exact 早期建议 ≥0.60 | 实测 0.5000，未达标 | 不把规则轨当金标准去凑 exact；任务单硬门槛是 neutral 差、样本覆盖与 sensitive_touch 约束 |

## 6. 遗留登记（backlogItems）

1. `AF326-B1`：3s 超时导致 4/70（5.71%）降级，高于 5% 建议线；`llm_active` 前需评估 P50 / P95 延迟并把超时预算做成可配置审计参数。
2. `AF326-B2`：exact 0.5000 低于早期建议 0.60；剩余差异集中在 `open_probe`（模型 9 / 规则 1）与 `empathy`（模型 23 / 规则 22）的边界，需要人工双标或咨询师金标准判定谁对。
3. `AF326-B3`：样本仍是每场尾部 10 轮、7/8 场、单模型单次；未做全量 20 轮 × 8 场与跨模型复评。
4. `AF326-B4`：规则轨 `judgment` 1 / `minimizing` 4，模型轨均为 0；模型对负向标签可能漏判，需单独抽样核对。
5. `AF326-B5`：模型轨 raw 输出未落盘，观测只能聚合标签；无法从报告反查单轮模型原文，这是隐私红线的预期代价。
6. `AF326-B6`：`typings/global.d.ts` 仍未声明 AF-322 新增 3 个 env 键，与本单无关。
7. `AF326-B7`：AF-321 记录包 `manifest.status` 仍为 `backlog` 与实际 `canceled` 不一致；`worklog verify --strict` PASS，字段语义治理另排。

## 7. 验收结论（reviewVerdict）

`passed`（AI 层与工程层）。prompt v2 版本、标签口径、sensitive_touch 词表绑定、neutral 对齐、真实 shadow 复评、单测、typecheck、lint、全量测试均有可复现证据；全量 288 文件 / 4437 例通过。真实 shadow 的 neutral 差从 61.54pp 压到 1.52pp，exact 从 0.0769 升到 0.5000，Jaccard 从 0.1859 升到 0.5581，sensitive_touch 从 8 次降到 0 次。**生产模式不变，模型轨继续 shadow；不宣称临床有效性。**

## 8. 提交信息

`feat(af326): 收紧模型事件分类器 prompt 并完成分层影子复评`
