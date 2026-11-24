# AF-449 交付记录 · 零语料算子剧本补语料落地

- 任务：AF-449（orchestrator，`priorTasks: [AF-448, AF-447, AF-427]`）
- 分支：`task/AF-449-scripted-corpus`（自 `integrate` = `df537e60cbc150fedfd84bfc3554c496f923419b`）
- 日期：2026-11-24

## 1. 承接关系（为什么有两个任务号）

| 任务   | 状态               | 作用                                                                                             |
| ------ | ------------------ | ------------------------------------------------------------------------------------------------ |
| AF-447 | canceled（已归档） | 首版任务单，`baselineRef` 留空导致 `task promote` 判「基线不明确」拒绝提级                       |
| AF-448 | canceled（已归档） | 重签发承接实现；scope 不含 `completed/af447-*.md`，回执预检与 `preflight` 都判越界，无法合法落库 |
| AF-449 | 本单               | 终版：把已完成的实现、AF-448 交付记录与 AF-447 归档补齐件一起纳入 scope 落库                     |

实现与证据在 AF-448 完成，本单不重写逻辑，只负责合法落库与终态闸门取证；AF-448 交付记录原文保留（`af448-scripted-corpus-2026-11-24.md`）。

## 2. 实现摘要

`scripts/ops/quality/af448-scripted-corpus.ts`：6 个剧本场景 / 34 个咨询师轮，每轮过生产同款 `RuleBasedClassifier({ semantics: 'v2' })` 拿真实事件，delta 用内核 `aggregateTurnDelta` 计算，落盘 `data/debug-sessions/debug_scripted_af448_<n>.json`（gitignored）。会话带 `synthetic: true` / `generationMethod` / `scriptedScenario` / `scriptedSummary` / 隐私 `note`。

只做规则轨可判定的三类算子；`holding_present` / `cold_absent` 是模型轨跨轮事件，规则轨不伪造，留 backlog。

## 3. 终态闸门

| 闸门     | 命令                                                                                 | 结果                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 干跑     | `pnpm exec tsx scripts/ops/quality/af448-scripted-corpus.ts --dry-run`               | exit=0，场景=6 / 轮=34，`{"acceptance":3,"affirmation":12,"normalization":11,"boundary_cross":8,"neutral":2}`，三类零语料算子全命中，未写盘 |
| 台帐复核 | `node scripts/ops/quality/af427-operator-delta-ledger.mjs --dir data/debug-sessions` | 表三：normalization 11 轮 / affirmation 12 轮 / boundary_cross 8 轮，实测/系数比均 100.0%（此前三类均为 0）                                 |
| 类型     | `pnpm typecheck`                                                                     | 0 error                                                                                                                                     |
| 红线     | `git diff --stat HEAD -- src/engine-core`                                            | 空                                                                                                                                          |
| 记录包   | `node scripts/orchestration/cli.mjs worklog verify --strict`                         | PASS（AF-447 / AF-448 / AF-449 三个 artifactPath 均存在，不再报缺文件）                                                                     |

## 4. 偏差

- 任务编号发生两次重签发（AF-447 → AF-448 → AF-449）。原因链条：①任务单 `baselineRef` 留空不可原地修补；②AF-448 scope 未覆盖被重签发任务的归档补齐件，`receipt lint` 与 `preflight` 均判越界。scope 与目标三单一致，未扩范围。
- 已登记遗留 AF448-B3：任务单模板把 `baselineRef` 标「可空」与 `task promote` 的强制校验口径冲突，建议模板注明必填或由 CLI 兜底。

## 5. 遗留

1. `holding_present` / `cold_absent` 仍零语料，需真跑 LLM 的评测批次（AF448-B1）。
2. 台帐未按 `kernelRef` / `synthetic` 分桶，合成语料与真实语料同表（AF448-B2，承接单 AF-438 需重签发）。
3. `pnpm lint` 两条既有 warning（`src/admin-debug/tts/debug-tts.service.ts:13-14` import/order），非本单引入。
