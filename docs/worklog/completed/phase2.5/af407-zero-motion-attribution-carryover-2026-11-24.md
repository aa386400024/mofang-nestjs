# AF-407 交付记录：zero_motion 归因口径承接（合规提交形态）

- 日期：2026-11-24
- 任务：AF-407（承接 AF-405 / AF-406）
- 基线：`integrate` @ `eb051e3c06914cb91cd938713dcdf301f906eac9`
- 分支：`task/AF-407-zero-motion-carryover`

## 一、为什么又开一单

AF-405 的业务实现与证据已经验收，但实现提交没有随带任务单；归档后 CI 逐提交门判 `no-active-task`，PR #198 失败关闭。

AF-406 补带了任务单，且实现提交同时包含 AF-405 与 AF-406 两份冻结件；但实现与回执两个提交标题都含 `AF-406`、`AF-405` 两个任务编号，`pr-release` 在创建 PR 前直接拒绝，PR 未能建立。

两次返修都没有改业务逻辑，问题只在提交形态。AF-407 用一份标题唯一、任务单同提交、先实现后归档的顺序重新承接同一份代码，避免第三次踩同一坑。

## 二、代码内容

与 AF-405 逐字一致，没有重写：

- `ZeroMotionBreakdown` 新增 `flat` / `netZero` / `untagged`，其中 `untagged` 是 `idle` 子集。
- `ZeroMotionSessionDetail` 新增 `dimensionFirstLast`、`maxExcursion`、`isFlat`、`eventTagPositions`。
- `batch-metrics.compute.ts` 新增 `dimensionFirstLast()`、`maxExcursion()`、`isFlatSession()`、`nonNeutralTagPositions()`，并接入三桶计数。
- `batch-metrics.schema.ts` 新增两个子守卫，旧快照缺省兼容。
- `test/auto-practice/wp-k-batch-compute.spec.ts` 从 20 例增至 21 例，新增“净零场次与真冻结分开计数”。

`total / closure / idle` 与阈值分子均未改变，属于纯增量诊断，不改变既有判定。

## 三、提交形态

| 提交   | 标题                                              | 内容                                                         |
| ------ | ------------------------------------------------- | ------------------------------------------------------------ |
| 实现   | `feat(metrics): AF-407 zero_motion 归因口径承接`  | 业务代码、单测、AF-405/AF-406 交付记录、AF-406/AF-407 任务单 |
| 回执   | `docs(orchestration): AF-407 回执与记录包`        | AF-407 回执、AF-405/AF-406/AF-407 记录包                     |
| 状态面 | `chore(orchestration): AF-407 状态索引与快照同步` | 索引、快照、事件日志、可视化数据                             |

实现提交标题只含 `AF-407`，且同提交新增 AF-407 任务单，满足 CI 两阶段入场条件。

## 四、闸门

| 闸门     | 命令                                                                 | 结果                                                    |
| -------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| 定向单测 | `pnpm exec vitest run test/auto-practice/wp-k-batch-compute.spec.ts` | 21/21 通过，30ms                                        |
| 类型检查 | `pnpm typecheck`                                                     | 0 error                                                 |
| Lint     | `pnpm lint`                                                          | 0 error                                                 |
| 内核边界 | `git diff --stat HEAD -- src/engine-core`                            | 空                                                      |
| 全量测试 | `pnpm test`                                                          | 312 passed / 1 skipped，4760 passed / 4 skipped，25.85s |

## 五、遗留

- `zero_motion` 历史批次仍缺 37/48 份逐字稿，无法逐场回溯；本单只保证未来批次可区分 `flat / netZero / untagged`。
- 适配层 presence 判定轨（`holding_present` / `cold_absent`）仍未实施，需要架构决策。
- 影子审计脚本 `af322-classifier-shadow-audit.ts:154` 仍用 legacy 分类器，与生产 v2 不一致，未开任务。
