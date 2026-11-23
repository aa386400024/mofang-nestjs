# AF-377 交付记录：squash 合并提交按任务单 scope 并集判定

- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-377/task-sheet.md`
- 交付日期：2026-11-23
- 任务类型：fix（R1）
- 基线：`27663341b299e01552fa5635092e1c78db4142c5`
- 分支：`task/AF-377-squash-scope-union`

## 问题

PR #183 把 AF-375 与 AF-376 堆叠合并后，squash 提交只携带 `Task: AF-376`，逐提交门按 AF-376 单任务 scope 校验，于是 AF-375 合法改动的 `.github/workflows/ci.yml`、`docs/team/agent-orchestration/**`、`web/orchestration/data.js` 被判 `scope-residual`，integrate 的 Orchestration Gate 持续 failure。

## 改动

1. `scripts/orchestration/ci-task-gate.mjs`
   - `evaluateCommitSnapshot` 新增 `extraScopeFiles`，并入任务单合成任务与 recorded archived 任务的 scope。
   - `evaluateAt` 从本提交实际变更的 `docs/worklog/records/**/task-sheet.md` 收集任务单 scope；**只有具备可合并 durable 回执的任务单才进入并集**，防止提交夹带伪造任务单扩张写权限。
   - 新增 `collectAcceptedSquashScopeFiles` 纯函数，统一并集与回执筛选口径。
2. `scripts/orchestration/task-entry-gate.mjs`
   - `evaluateTaskEntry` 接收 `extraScopeFiles`，选中任务后构造 `selectedWithStackedScope`；`relevant` 过滤与 `detectResidualFiles` 均使用并集后的 selected，避免重算后回退原始 scope。
3. `scripts/orchestration/__tests__/orchestration.spec.mjs`
   - 新增“仅带 durable 回执的任务单进入并集、伪造任务单不得扩张 scope”用例。
   - 新增“stacked squash 单任务判定吸收同提交内已验收任务 scope”用例。

## 关键设计决策

- 并集来源限定为**同提交实际变更的任务单**，不读取索引里的活跃任务，避免把“在办任务”当成扩大写权限的来源。
- 回执筛选复用 `mergeableDurableReceipts`：passed，或 conditional-pass 且无人工复核项、backlog 项均已登记。
- 单任务提交仍等价于原行为：没有其他任务单或没有 durable 回执时，`extraScopeFiles` 为空，越界照旧 `scope-residual`。
- 未改 engine-core、业务代码、状态面生成物；未放宽 PR 最终 HEAD 验收门。

## 验证

| 闸门             | 命令                                                                          | 结果                                                      |
| ---------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------- |
| 编排单测         | `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 270 passed，0 failed                                      |
| Lint             | `pnpm lint`                                                                   | exit 0                                                    |
| Typecheck        | `pnpm typecheck`                                                              | exit 0                                                    |
| 全量测试         | `pnpm test`                                                                   | 311 passed / 1 skipped 文件；4749 passed / 4 skipped 用例 |
| 真实提交复跑     | `node scripts/orchestration/ci-task-gate.mjs --base 8c314c6e --head 27663341` | PASS，`total=1 passed=1 failed=0 ok=true`；`residual=[]`  |
| engine-core 边界 | `git diff --stat HEAD -- src/engine-core`                                     | 空                                                        |

真实验证对象：`27663341b299e01552fa5635092e1c78db4142c5`（AF-375 + AF-376 的 stacked squash），判定结果 `task=AF-376 reason=pass files=15`。

## 偏差与遗留

- 无任务单偏差。
- 历史孤儿记录包 AF-363..AF-372 仍在 state-free 口径下跳过，不在本任务范围。
- 独立复跑 `27663341` 只证明该 squash 提交可通过；合并后 integrate push CI 是否整体转绿，以合并后远端 Run 为准。

## 提交信息

`fix(wpAF-377): squash 合并提交按任务单 scope 并集判定`

## 回执冻结

- 回执：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-377/receipt-RC-AF-377-1.json`
- receiptId：`RC-AF-377-1`
- 内容哈希：`5d4e61191bb54325aec599f6b3fe4f3e5839ca90b26f5561d0753fcc07647b0a`
- 冻结前已通过 `receipt lint` 七组字段、scope、工件与换行检查。
