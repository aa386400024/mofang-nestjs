# AF-405 · zero_motion 归因口径拆分（flat / net-zero / untagged）

- 任务：AF-405（executor）
- 基线：`eb051e3c06914cb91cd938713dcdf301f906eac9`（AF-404 合并后的 `integrate`）
- 日期：2026-11-24
- 结论：按任务单完成，`total / closure / idle` 语义与阈值分子未变，新增三桶只作诊断。

## 1. 改了什么

| 文件                                                 | 改动                                                                                                                                                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/auto-practice/metrics/acceptance-thresholds.ts` | 新增 `ZeroMotionDimensionDelta`；`ZeroMotionSessionDetail` 增加 `dimensionFirstLast` / `maxExcursion` / `isFlat` / `eventTagPositions`；`ZeroMotionBreakdown` 增加 `flat` / `netZero` / `untagged`，全部可选 |
| `src/auto-practice/metrics/batch-metrics.compute.ts` | 新增 `dimensionFirstLast()` / `maxExcursion()` / `isFlatSession()` / `nonNeutralTagPositions()`；逐场明细补齐；细分计数增加三桶                                                                              |
| `src/auto-practice/metrics/batch-metrics.schema.ts`  | 新增 `assertZeroMotionDimensionFirstLast()` / `assertZeroMotionEventTagPositions()`；扩展明细与细分守卫，旧快照缺省兼容                                                                                      |
| `test/auto-practice/wp-k-batch-compute.spec.ts`      | 原三类场次断言改为 `toMatchObject` 并补诊断字段；新增净零场次用例                                                                                                                                            |

## 2. 口径定义（关键）

- `total / closure / idle`：与 AF-404 逐字一致。`idle` 仍 = 零变化且事件层无任何非 neutral 事件，`session.zero_motion` 的分子不变。
- `flat`：每一轮八维都等于首轮（真冻结）。`maxExcursion = 0`。
- `netZero`：首末相等但中途动过（`maxExcursion > 0`）。旧口径会把它误当作冻结；本单只标注，不改变 `idle` 计数。
- `untagged`：`eventTagCounts` 为空对象，即本轮批次里该场从未落过任何事件标签。它是 `idle` 的子集，用来把“提取缺失”与“全程 neutral”分开看。
- `eventTagPositions`：非 neutral 标签出现的轮号（去重升序），用于区分“全程没动作”与“前几轮有动作后空转”。
- 隐私边界：只输出数值与标签名，不含对话原文、prompt、意图 rationale。

## 3. 验证数字

| 闸门     | 命令                                                                 | 结果                                                    |
| -------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| 单测     | `pnpm exec vitest run test/auto-practice/wp-k-batch-compute.spec.ts` | 1 文件 / 21 用例全绿（40ms）                            |
| Lint     | `pnpm lint`                                                          | exit 0，0 error                                         |
| 类型     | `pnpm typecheck`                                                     | exit 0，0 error                                         |
| 全量     | `pnpm test`                                                          | 312 passed / 1 skipped，4760 passed / 4 skipped，25.72s |
| 内核红线 | `git diff --stat HEAD -- src/engine-core`                            | 空                                                      |

全量首跑出现 1 例并发抖动：`test/admin-debug/debug-session-persistence.spec.ts` 的 `waitFor` 在 10000ms 内未成立（4764 中 1 failed）。该文件单跑 28/28 全绿，随后全量重跑 312 文件全绿，判定为既有并发时序抖动，与本单改动无关；本单未修改调试会话持久化链路。

## 4. 偏差

- 任务单要求“四类场次”：真冻结、净零、全程无标签、有非 neutral。原测试已经覆盖有非 neutral（closure）与无标签（idle untagged），本单补净零用例；真冻结由 `flat` 断言覆盖。
- 未改 `session.zero_motion` 的分子。这是刻意的：阈值是候选口径，先拿到新诊断数据再决定是否把 `untagged` 移出 `idle`，避免在缺少历史样本时改坏基线。

## 5. 后续建议

1. 下一批 `zero_motion` 落库后，先看 `flat / netZero / untagged` 三桶与 `dimensionFirstLast`，再决定是否收紧阈值。
2. MiniMax 只读审计建议的“适配层补在场 / 缺席判定轨”涉及架构决策与付费模型轨，需大炮点头，本单未动。
