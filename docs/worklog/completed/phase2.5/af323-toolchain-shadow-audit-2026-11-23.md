# AF-323 · 工具链收口与真实语料分类器影子审计

- 交付日期：2026-11-23
- 工作树：`D:\work\Project\backend\mofang-nestjs-af281r`
- 分支：`task/AF-323-toolchain-shadow-audit`
- 基线：`3f12ae0834a28ac0dee1dac5a378e0dd4d7a4bb8`（`integrate`，AF-322 squash merge）
- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-323/task-sheet.md`
- 任务状态：`submitted` → 回执摄入后由 CLI 转 `completed` 并归档

## 1. 结论

本单把 AF-322 之后剩下的三处工具链缺口和一处真实语料缺口补齐，验收口径仍是 **AI 层确定性测试与工程闸门**，不做临床有效性宣称：

1. **类型检查同口径**：`pnpm typecheck` 改为覆盖整个 `tsconfig.json`，与 CI 完全一致；保留 `typecheck:src` 作为 `src` 快检入口，避免日常内循环变慢。
2. **CI 命令不漂移**：CI Typecheck 直接调用 `pnpm typecheck`，本地与远端不可能再执行两套命令。
3. **分支名护栏**：`buildBranchName` 拒绝 slug 内任意位置出现的 `af123` / `af-123` 片段，覆盖大小写、连字符、嵌入词中间、多任务号四种变体。
4. **真实语料影子审计**：新增离线 CLI 与纯统计层，对 8 场目标 trace 抽样，规则轨与模型轨（shadow）并行；只输出 id / 计数 / 比率 / 标签 / 模型标识，不输出任何对话原文。
5. **审计结论**：真实样本下模型轨系统性过判，`llm_active` 不具备切换条件；模型轨继续 `shadow`，生产判定零变化。

## 2. 闸门结果（gateResults）

| 命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs scripts/orchestration/__tests__/af322-classifier-shadow-audit.spec.mjs` | 2 文件通过；265 例通过（orchestration 260 + 审计统计 5） |
| `pnpm typecheck` | exit 0；`tsc -p tsconfig.json --noEmit --incremental --tsBuildInfoFile node_modules/.tmp/tcheck-full.tsbuildinfo`，与 CI 完全同口径 |
| `pnpm lint` | exit 0；0 error / 0 warning（主 lint + scripts 二次 lint） |
| `pnpm exec eslint scripts/ops/quality/af322-classifier-shadow-audit.ts` | exit 0；单独校验新 TS 审计脚本，修复 4 error + 5 warning 后 0/0 |
| `pnpm test` | 288 文件通过 / 1 跳过（289）；4435 例通过 / 4 跳过（4439）；19.86s |
| `pnpm audit:classifier-shadow -- --rule-only --sample-per-session 3` | 规则轨基线跑通；覆盖 7/8 场、21 轮、degraded 0、exact 21/21、Jaccard 1.0000 |
| `pnpm audit:classifier-shadow -- --sample-per-session 2 --limit 14` | 真实 shadow 跑通；14 轮 / 7 场 / 可用 13 / 降级 1；exact 1/13、Jaccard 0.1859 |
| `node scripts/orchestration/cli.mjs events verify` | 回执摄入后执行，以 CLI 输出为准 |
| `node scripts/orchestration/cli.mjs worklog verify --strict` | 回执归档后执行，以 CLI 输出为准 |

## 3. 范围核对（scopeCheck）

- 结论：`in-scope`（编排状态面由 CLI 自动生成，非手工改动）。
- 类型检查：`package.json`、`.github/workflows/ci.yml`。
- 分支护栏：`scripts/orchestration/branch-workflow.mjs`、`scripts/orchestration/__tests__/orchestration.spec.mjs`。
- 审计工具：`scripts/ops/quality/af322-classifier-shadow-audit.ts`、`scripts/ops/quality/af322-classifier-shadow-audit.mjs`、`scripts/orchestration/__tests__/af322-classifier-shadow-audit.spec.mjs`。
- 记录与报告：`docs/worklog/completed/phase2.5/af323-toolchain-shadow-audit-2026-11-23.md`、`docs/worklog/completed/phase2.5/af323-classifier-shadow-audit-2026-11-23.md`、`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-323/`。
- 编排状态面：`docs/team/agent-orchestration/task-state-index.json`、`state/journal.jsonl`、`orchestration-snapshot.json`、`web/orchestration/data.js`，均由 CLI 写入。
- `src/engine-core/**` 零改动：`git diff --stat HEAD -- src/engine-core` 为空。
- 未改：模型轨 prompt 与判定阈值、生产来访者模型、管理台成本字段、`typings/global.d.ts`。
- 未纳入提交：`data/phase25-exit/af229-lite-dev-12/`、`af280-engine-render-v5/`、`af295-v2-screen6/`、`af295-v2-smoke2/` 四个历史取证目录。

## 4. 契约核对（contractChecks）

| 契约项 | 结果 | 说明 |
| --- | --- | --- |
| taskId | pass | AF-323 经 CLI 登记、promote、run-once 领单；分支名与提交标题只含一个任务号 |
| state-write | pass | 状态索引、事件链、快照、web 数据均经 CLI 生成，未手改状态面 |
| scope | pass | 代码、测试、报告、记录均在任务单声明的文件域内 |
| toolchain-consistency | pass | 本地 `pnpm typecheck` 与 CI Typecheck 为同一条命令、同一缓存文件 |
| branch-guard | pass | `af316-receipt`、`AF-317-receipt`、`fix-af322-alignment`、`af321-af322-merge`、`fooaf316` 全部拒绝，正例通过 |
| audit-privacy | pass | 脚本与控制台只输出 id / 计数 / 比率 / 标签 / 模型标识；不打印、不落盘咨询师或来访原文 |
| audit-determinism | pass | 统计层纯函数独立单测；缺失场次、降级轮、neutral 率、空 Jaccard 均有显式口径 |
| shadow-only | pass | 审计固定 `effectiveMode: 'shadow'`；core 结果始终来自规则轨，生产判定零变化 |
| clinical-boundary | pass | 报告明确声明一致性口径不是人工金标准；未宣称临床有效性；真人标定独立排期 |

## 5. 偏差表（deviationTable）

| 任务单说 | 实际做法 | 理由 |
| --- | --- | --- |
| 分支护栏拒绝「嵌入其他词中间」的任务号 | 首版 regex 只匹配段首或连字符后；发现 `fooaf316` 漏网后改为任意位置 `/af-?\d{3}/`，并补该变体用例 | 首版未满足任务单字面要求；按验收标准修正而不是解释成「常见形态」 |
| 审计报告需要标签分布 | 统计层新增 `labelRows`，按标签聚合两轨计数 | 只给 exact / Jaccard 无法解释模型轨为何过判；标签分布是定位 prompt 过宽的直接证据 |
| rule-only 模式输出置信度 | 无有限置信度时输出 `null` / `n/a` | 规则轨没有模型置信度，显示 `0.0000` 会被误读成低置信 |
| 默认 `--sample-per-session 3` | 真实 shadow 实跑用 `--sample-per-session 2 --limit 14` | 控制单次真实模型调用成本与耗时；报告中明确样本只取尾部 2 轮 |
| 任务单未列 `fooaf316` 用例 | 纳入同一拒绝用例的参数化列表 | 验证任意位置匹配，防止以后把 regex 改回段首匹配 |
| 审计 CLI 不在 `pnpm lint` 覆盖范围 | 单独跑 `pnpm exec eslint` 并修复到 0/0 | 主 lint 只覆盖 `src/test/bin` 与 `scripts/**/*.mjs/cjs`；新 TS 脚本不应留 lint 债 |

## 6. 遗留登记（backlogItems）

1. `AF323-B1`：影子审计真实样本只有 14 轮（13 可用）、每场尾部 2 轮、7/8 场覆盖；不是全量分布，也不是人工金标准。需要按场次分层抽全 20 轮并扩大场次后复跑。
2. `AF323-B2`：模型轨 `neutral` 率 0.0769 vs 规则轨 0.6923，`sensitive_touch` 8/13、`open_probe` 9/13，说明 prompt 对普通探问与敏感触碰的边界过宽；需要单独任务收紧 prompt，不在本单改判定口径。
3. `AF323-B3`：影子通过阈值未定。Jaccard、核心标签重合、neutral 率、degraded 率各自权重没有人工金标准，不能只用 exact 一致率拍板。
4. `AF323-B4`：真实调用出现 1 轮 3 次 3s 超时后降级；`llm_active` 前需评估 P50 / P95 延迟与超时预算。
5. `AF323-B5`：`typings/global.d.ts` 未声明 AF-322 新增 3 个 env 键；代码走 `ConfigService.get()` 无类型缺口，且 `typings/` 不在任何 Agent Card 资源域，登记为资源域治理遗留。
6. `AF323-B6`：管理台成本 `totalCost` / `totalCostCny` 兼容仍为既有技术债，与本单无关。
7. `AF323-B7`：AF-321 记录包 `manifest.status` 仍为 `backlog`，与实际 `canceled` 不一致；当前 `worklog verify --strict` PASS，但字段语义需要后续经 CLI 治理，禁止手改记录包。

## 7. 验收结论（reviewVerdict）

`passed`（AI 层与工程层）。类型检查同口径、CI 命令不漂移、分支护栏、审计 CLI、统计单测、真实影子跑、报告与全量闸门均有可复现证据；全量 288 文件 / 4435 例通过，lint 与 typecheck 0 error。影子审计明确给出「不建议切 `llm_active`」的结论，模型轨保持 shadow，生产行为零变化。

**临床边界**：本单没有真实咨询师在环，审计不是人工金标准，所有一致性数字只描述规则轨与当前模型轨的差异，不构成临床有效性或安全性证据。真人标定必须在 AI 层稳定通过之后单独排期。

## 8. 提交信息

`feat(af323): 收口类型检查与分支护栏并落地分类器影子审计`
