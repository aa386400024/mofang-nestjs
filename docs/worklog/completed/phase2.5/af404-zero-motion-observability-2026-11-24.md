# AF-404 zero_motion 可观测性补齐交付记录

日期：2026-11-24

## 结论

批次指标的 `zeroMotionBreakdown` 在原有 `total / closure / idle` 计数之外，新增可选的 `closureSessions / idleSessions` 逐场明细。明细只包含合规投影字段：`debugSessionId`、`characterSlug`、`counselorModeId`、`turns`、`eventTagCounts`，不含对话原文、prompt 或意图 rationale。

这样即使逐字稿文件不在本机，也能从批次指标直接定位哪几场零变化、事件标签是全程 `neutral` 还是完全未打标签，解决最新批次 48 场里 37 场逐字稿缺失导致另外 7 场 idle 无法定位的问题。

## 改动文件

- `src/auto-practice/metrics/acceptance-thresholds.ts`：新增 `ZeroMotionSessionDetail`；`ZeroMotionBreakdown` 增加可选 `closureSessions` / `idleSessions`。
- `src/auto-practice/metrics/batch-metrics.compute.ts`：新增 `countEventTags()` 与 `summarizeZeroMotionSession()`；`computeZeroMotionBreakdown()` 按 closure / idle 分别收集明细。
- `src/auto-practice/metrics/batch-metrics.schema.ts`：`assertZeroMotionBreakdown()` 校验新增数组；`assertZeroMotionSessionDetail()` 逐字段验型，缺省字段保持旧快照兼容。
- `test/auto-practice/wp-k-batch-compute.spec.ts`：新增 idle neutral、idle 未打标签、closure、有动作四类场次断言，并验证 schema 守卫通过。

## 字段口径

| 字段              | 含义                                                                             |
| ----------------- | -------------------------------------------------------------------------------- |
| `closureSessions` | 零变化且事件层存在非 neutral 事件的场次，按任务单口径豁免                        |
| `idleSessions`    | 零变化且事件层只有 neutral 或无事件标签的场次，计入失效                          |
| `eventTagCounts`  | 标签 → 出现轮次数；`{}` 表示全程没有任何事件标签，`{neutral:N}` 表示全程 neutral |

明细按输入场次顺序输出；字段只增不删，旧快照没有明细时读取端按 `undefined` 处理。

## 闸门数字

- `pnpm exec vitest run test/auto-practice/wp-k-batch-compute.spec.ts`：1 文件 / 20 用例全绿。
- `pnpm lint`：exit 0，0 error。
- `pnpm typecheck`：exit 0。
- `git diff --stat HEAD -- src/engine-core`：空。

## 提交链

任务分支 `task/AF-404-zero-motion-observability`，自 `integrate` HEAD `2ff6cfcc` 切出。

## 偏差与遗留

- 现有批次 `metrics_json` 不会回溯重算；新明细从下一次批次计算开始写入，历史批次仍按旧字段读取。
- 明细未包含八维首末值，因为按定义八维首末全等；真正需要区分的是事件标签分布。
- 前端尚未展示明细；本期只补数据面，后续可视需要增加管理端诊断视图。
