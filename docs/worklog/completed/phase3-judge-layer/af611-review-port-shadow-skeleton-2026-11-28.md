# AF-611 交付记录 · Judge Layer P0：评审端口、Provider、Rubric 版本化与 Shadow 骨架

## 1. 任务与授权

- 任务单：`docs/worklog/records/phase3-judge-layer/AF-611/task-sheet.md`
- 执行仓 / 类型：`mofang-nestjs` / `implementation`（R1 / executor）
- 基线 / 分支：`4fab586b3753b8a7969cb1998ae43e96651279a5` / `task/AF-611-judge-layer-p0-provider-rubric-shadow`
- 授权与前置门禁：编排状态 `submitted`，`dependsOn: []`、`priorTasks: []`；任务单与交接件 `docs/team/agent-orchestration/transport/tasks/AF-611.json` 一致；单写者锁空闲。
- 分支说明：`integrate` 当前指向 `fe845ffb`，不含本单 `baselineRef`；任务单注册提交 `5fff240a` 与 AF-610 freeze `19e4d878` 均在 AF-608 任务线，故从 `19e4d878` 切出 `task/AF-611-...`，保留任务单与依赖历史。
- 回执：`docs/team/agent-orchestration/transport/receipts/AF-611.json`（durable 副本 `docs/worklog/records/phase3-judge-layer/AF-611/receipt-RC-AF-611-1.json`）

## 2. Scope 与排除项

- 允许改动：`docs/worklog/records/phase3-judge-layer/AF-611/`、`docs/worklog/completed/phase3-judge-layer/af611-review-port-shadow-skeleton-2026-11-28.md`、`src/engine-adapters/judge/`、`src/engine-adapters/eval/eval.service.ts`、`src/engine-adapters/eval/eval.types.ts`、`src/auto-practice/metrics/metric-dictionary.ts`、`src/auto-practice/metrics/batch-metrics.schema.ts`、`test/engine-adapters/judge/`
- 排除项：P1 双 Judge / 人工复核队列 / 一致性矩阵；P2 回归判据与阈值；DeepSeek 及新厂商；Flutter / Admin / 评审 UI / HTTP 响应契约；`src/counselor/drills` 判定引擎与 DrillVerdict 重构；AF-600/601/602 历史回执缺口、VPT 哈希漂移、临时脚本、legacy migrate 遗留；冻结期 PsyGuard。
- 授权交付物：本交付记录、AF-611 记录包、机读回执。
- 开工前并行/既有改动：约 500 项历史脏文件（legacy manifest、`docs/worklog/pending/archive` 回执删除件、`task-state-index.json` / `journal.jsonl` / `orchestration-snapshot.json`、`web/orchestration/data.js`）全部排除，未纳入本单提交。

## 3. 实现摘要

- 新增 `src/engine-adapters/judge/` 九文件：`ReviewJudgePort` 与场次级结果类型；Rubric / Prompt 版本与指纹；Provider 白名单与输入/结果/快照守卫；Judge 专用脱敏纯函数；MiniMax Provider；Shadow 编排；NestJS 模块与导出。
- 评级：三维 `empathic_attunement` / `safety_boundary` / `intervention_structure`，三档 `0/1/2`，独立于 drills 的 boundary 语义与 `DrillVerdict`。
- Provider：首个 Provider 为 `minimax`，复用既有 `CounselorLlmJsonClient.requestJson` 结构化 JSON 出口，模型默认沿用 `MINIMAX_COUNSELOR_LLM_MODEL`（缺省 `MiniMax-M3.1-Flash`）；构造期拒绝 DeepSeek，不新增 SDK / 评分库 / DB 驱动。
- Rubric 版本化：`judge-rubric-v1` / `judge-prompt-v1` 集中配置维度锚点、Prompt 模板与输出契约；Rubric 内容与 Prompt 版本进入指纹，版本不一致不可纵向比较。
- Shadow 闭环：在既有批次评测报告装配后旁路调用；单场失败、超时、非法响应或全轮排除只记 `judge` 段 `null` 与 `failureCodes`，批次继续；`DEFAULT_JUDGE_TIMEOUT_MS=30_000`。
- 落库：未新建表或 migration；评审单写入既有评测报告 `judge` 段与 v1 快照可选段，血缘含 providerId、model、rubricVersion、promptVersion、rubricFingerprint、inputFingerprint、sessionId、mode、judgeKind。
- 快照 Schema 保持 v1，`judge` 为可选字段；`undefined/null` 合法，非法评级、缺理由、缺血缘、证据引用缺失均被守卫拒绝。
- 脱敏：PII 正则复用 `pii-redactor`；人名、地点、单位、家庭关系泛化；自伤/创伤整句按句降级为类别标签；危机/自伤相邻轮次在出境前排除，仅保留本地规则结论与引用。
- 指标：新增 `judge.reviews.count`、`judge.review_coverage`、`judge.failure_rate`、`judge.rating.mean`（bounds 0–2）、`judge.rating.low_share`，全部 `direction: neutral`、`nullable: true`。指标字典版本保持 `dict-v4`，避免改动 scope 外硬断言测试；P1 接前端缓存时统一升版。
- 机器代理标注：`JUDGE_MACHINE_PROXY_LABEL` 固定声明“机器代理评审（非临床效度证据 / 非咨询师执业认定 / 不替代真人专家）”，快照守卫要求 disclaimer 含该标注。
- 单测：新增 5 个 spec + fixtures，覆盖端口替身、Provider 输入校验与失败回落、脱敏案例、Rubric/Prompt 血缘、可选快照段守卫，共 31 条。

## 4. 实际改动文件

- 新增：`src/engine-adapters/judge/{index,judge.types,judge.fingerprint,judge.rubric,judge.contract,judge.redaction,judge.provider,judge.shadow,judge.module}.ts`；`test/engine-adapters/judge/{judge-test-fixtures,judge-shadow,judge-redaction,judge-provider,judge-rubric,judge-snapshot-guard}.spec.ts`；本交付记录；`docs/worklog/records/phase3-judge-layer/AF-611/receipt-RC-AF-611-1.json`
- 修改：`src/engine-adapters/eval/eval.service.ts`、`src/engine-adapters/eval/eval.types.ts`、`src/auto-practice/metrics/metric-dictionary.ts`、`src/auto-practice/metrics/batch-metrics.schema.ts`、`docs/worklog/records/phase3-judge-layer/AF-611/manifest.json`
- 删除：无
- 删除引用核对：不适用（无删除文件）

## 5. 验收清单

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| ReviewJudgePort / JudgeReviewResult 场次级端口与三维 0/1/2 | pass | `src/engine-adapters/judge/judge.types.ts`、`judge.contract.ts`、`judge.module.ts` |
| 首个既有厂商 Provider，复用结构化 JSON 出口，DeepSeek 排除 | pass | `judge.provider.ts`；`test/engine-adapters/judge/judge-provider.spec.ts` |
| Rubric / Prompt 版本化与血缘指纹 | pass | `judge.rubric.ts`、`judge.fingerprint.ts`；`judge-rubric.spec.ts` |
| Shadow 闭环且失败不阻断批次 | pass | `judge.shadow.ts`、`eval.service.ts`；`judge-shadow.spec.ts` |
| v1 快照可选 Judge 段与非法守卫 | pass | `batch-metrics.schema.ts`、`judge.contract.ts`；`judge-snapshot-guard.spec.ts` |
| judge.* 指标 neutral、不进入回归好坏判定 | pass | `metric-dictionary.ts` |
| 脱敏纯函数与危机/自伤轮次排除 | pass | `judge.redaction.ts`、`judge.shadow.ts`；`judge-redaction.spec.ts` |
| 机器代理属性显式标注 | pass | `judge.types.ts`、`judge.contract.ts` 快照 disclaimer 守卫 |
| 目标单测全绿、不全量扩张范围 | pass | `pnpm exec vitest run test/engine-adapters/judge`：5 files / 31 tests passed |

## 6. 闸门证据

| 实际命令 | 退出码 | 错误 | 警告 | 用例/文件等关键数字 | 原始证据 |
| --- | ---: | ---: | ---: | --- | --- |
| `node scripts/orchestration/cli.mjs events verify` | 0 | 0 | 0 | 事件日志 2579 条；schema state-event 1.0.0；哈希链与索引投影一致 | `.tmp/af611-evidence/events-verify.log` |
| `node scripts/orchestration/cli.mjs validate --sheet docs/worklog/records/phase3-judge-layer/AF-611/task-sheet.md` | 1 | 3 | 0 | AF-611 任务单元 PASS；FAIL 仅 AF-600 / AF-601 / AF-602 历史回执 schema 缺口，不计本单新增失败 | `.tmp/af611-evidence/validate.log` |
| `pnpm lint` | 0 | 0 | 0 | 全仓 TS 与 scripts lint 通过（AF-611 文件复杂度 / 正则 / 排序全部清理） | 终端 stdout |
| `pnpm typecheck` | 0 | 0 | 0 | `tsc -p tsconfig.json --noEmit` 通过 | 终端 stdout |
| `pnpm exec vitest run test/engine-adapters/judge` | 0 | 0 | 0 | 5 files / 31 tests passed | 终端 stdout |
| `pnpm test` | 0 | 0 | 0 | 375 passed / 1 skipped files；5253 passed / 4 skipped tests；338.81s | `.tmp/af611-evidence/vitest-full.log` |
| `pnpm orchestration:preflight` | 0 | 0 | 0 | PASS task=AF-611 status=submitted files=19 covered=19，无状态面 / legacy / PsyGuard 混入 | 终端 stdout |

复现说明：Windows DESKTOP-E3EVQ9P，Node v22.23.2 / pnpm 9.15.0（package 要求 node>=26 仅 WARN）。顺序为事件链与任务单校验 → lint → typecheck → 目标单测 → 全量回归 → preflight；全量回归仅在任务收尾执行一次。

## 7. 范围核对、契约检查与并行隔离

- **范围核对**（`scopeCheck`）：`in-scope`；改动均在 `scope.files` 与 `artifacts` 内，无越界文件、无相邻重构。
- 并行产物已排除：`true`；约 500 项历史脏文件未暂存、未提交。
- 无越界重构：`true`；未改 drills / DrillVerdict / Flutter / Admin / HTTP 契约，未改 framework 规范件，未触碰 PsyGuard。
- **契约检查**（`contractChecks`）：taskId / contextId / type / baselineRef / contractRef 与任务单一致；状态面仅经 CLI 写入；scope 文件与声明集一致；receipt schema 按当前仓库契约校验。
- 字段对齐与真相源：`aligned`；任务单、交付记录、回执同 taskId、同结论、同数字，台账以 `docs/worklog` 为事实源。
- 落库边界：未新建表 / migration；仅在既有报告与快照增加可选 `judge` 段，字段与血缘已在本记录逐项登记，不扩展后台编辑能力。

## 8. 偏差表、遗留项与人工复核

- **偏差表**（`deviationTable`）：空数组，`deviationAbsent=true`。实现口径与任务单一致；仅分支基线按仓库实际任务线从 `19e4d878` 切出，已在 §1 说明。
- **遗留项**（`backlogItems`）：无新增台账号。P1 双 Judge / 人工复核队列 / 一致性矩阵、P2 回归判据接入、指标字典版本升级、独立评审单表结构均按任务单 outOfScope 留给后续任务。
- 未决问题：无新增产品或架构未决项。
- 人工/小豆复核：小豆核对回执工件路径、字段完整性、scope 引用与台账状态；业务闸门结论以本记录与回执证据为准。

## 9. 提交、推送与验收结论

- Commit：`56e12590`（实现与目标单测，19 files / +2434 / -4）；交付记录、冻结回执与 manifest 随后续提交入库。
- Push / PR：任务分支 `task/AF-611-judge-layer-p0-provider-rubric-shadow`；受保护 PR 按仓库 L3 流程创建与合并，不以本地直推代替。
- `finalStatus`：`completed`
- **验收结论**（`reviewVerdict`）：`passed`
- 结论依据：九项验收全部落地，目标 31 条单测与全量 5253 条回归通过，lint / typecheck / 事件链 / 任务单校验满足口径，scope 内无并行产物，契约与字段对齐，无新增遗留与偏差。

交回小豆：回执 JSON `docs/team/agent-orchestration/transport/receipts/AF-611.json`；交付记录 `docs/worklog/completed/phase3-judge-layer/af611-review-port-shadow-skeleton-2026-11-28.md`。由小豆核对证据和 scope 后更新台账。
