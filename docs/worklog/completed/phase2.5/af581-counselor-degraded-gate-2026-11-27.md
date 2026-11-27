# AF-581 交付记录：批次有效性门禁消费咨询师侧降级计数

- 任务：AF-581
- 上下文：phase2.5-quality-gates
- 类型：implementation
- 日期：2026-11-27
- 分支：task/AF-581-counselor-degraded-gate
- 基线：d57b5d8d784a331f535ae5ad9c06269457f49809

## 1. 问题与目标

`computeBatchMetrics` 已聚合 `counselorDegradedTurns`，但 `evaluateBatchHealth` 只消费 `counterConsistent`、`llmCallRatio` 与 `renderFallbackRatio`。咨询师侧出现系统性降级的批次仍可能 `valid=true`，被当成可用于结论的数据。本单补上比例与阈值判定，让「有观测、无判定」闭环。

## 2. 改动清单

| 文件 | 改动 |
| --- | --- |
| `src/auto-practice/practice-batch-health.service.ts` | 新增 `BATCH_HEALTH_COUNSELOR_DEGRADED_RATIO_MAX = 0.05`；`BatchMetrics` / `BatchHealth` 增加 `counselorDegradedRatio`；`BATCH_VALIDITY_FLAGS` 增加 `COUNSELOR_DEGRADED_HIGH`；`evaluateBatchHealth` 在比例 `>= 0.05` 时 push flag，`valid` 仍由 flags 统一决定 |
| `test/auto-practice/wp-h-wave2-3-batch-observability.spec.ts` | 新增 4 条边界用例：0 轮回落 0 不产生 NaN；0.04 不判无效；恰好 0.05 判无效；0.2 判无效 |

比例口径：`totalTurns > 0 ? counselorDegradedTurns / totalTurns : 0`，只依赖既有 `BatchMetrics` 字段，不新增 DB 查询、不新增 env 键、不改 controller / DTO / 前端 / migration。

## 3. 设计决策

1. 阈值复用既有 `BATCH_HEALTH_FALLBACK_RATIO_MAX = 0.05` 的可材料性量级，避免同一门禁族出现第二套阈值真相源；后续按真实批次标定另案处理。
2. 门禁只回答「批次数据能否用于结论」，不是临床质量结论；flag 命名用 `COUNSELOR_DEGRADED_HIGH`，不写「不合格」。
3. `valid` 继续由 flags 数量统一决定，不引入独立布尔短路，保持既有门禁语义。
4. 纯函数保持纯：不读 env、不连 DB、不写日志；心理内容不进日志。

## 4. 闸门

| 命令 | 退出码 | 数字 | 定性 |
| --- | --- | --- | --- |
| `pnpm exec vitest run test/auto-practice/wp-h-wave2-3-batch-observability.spec.ts` | 0 | 29 passed / 0 failed，22.57s | 定向全绿 |
| `pnpm typecheck` | 0 | 0 error | PASS |
| `pnpm lint` | 0 | 0 error，无 warning | PASS |
| `git diff --stat HEAD -- src/engine-core` | 0 | 输出为空 | engine-core 零 diff |
| `git diff --check` | 0 | 无空白错误 | PASS |
| `node scripts/orchestration/cli.mjs events verify` | 0 | 2419 条事件；schema / 哈希链 / 索引投影一致 | PASS |
| `node scripts/orchestration/cli.mjs validate` | 0 | 全仓机读校验全 PASS | PASS |
| `pnpm test`（默认并行） | 1 | 5148 passed / 5 failed / 4 skipped，745.45s | 见 §5 |
| `pnpm exec vitest run --maxWorkers=16` | 1 | 5149 passed / 4 failed / 4 skipped，663.93s | 见 §5 |
| `pnpm exec vitest run test/auto-practice/af073-batch-report-cli.spec.ts` | 0 | 4 passed / 0 failed，70.83s | 单跑全绿 |
| `pnpm exec vitest run test/engine-adapters/wp12-memory-closeout.spec.ts` | 0 | 40 passed / 0 failed，21.16s | 单跑全绿 |

## 5. 全量测试失败定位（与本单无关）

两次全量运行的失败都落在两个既有测试文件的**测试内部 30s 超时**，不是业务断言失败：

1. `test/auto-practice/af073-batch-report-cli.spec.ts`：4 例 `expected null to be 0/2/2/3`，每例约 30039ms。该文件通过 `spawnSync(..., { timeout: 30_000 })` 拉起 `tsx bin/batch-report.ts`，单跑每例 16–19s，并行满载时超过 30s 被子进程超时杀死，`status` 变 null。单跑 4/4 全绿。
2. `test/engine-adapters/wp12-memory-closeout.spec.ts`：1 例 `Test timed out in 30000ms`，位于 `:765`。单跑 40/40 全绿，该例 8.76s。

AF-581 只改批次健康纯函数与其单测，未触碰 CLI 子进程、逐字稿桥或这两个测试文件；失败在两份全量日志中均可复现为并行负载下的固定超时，且单跑全绿。结论：**本单代码无回归，全量门红的根因是测试超时预算过紧，属独立测试稳定性债**，建议另案把上述两处改成显式、可解释的超时预算（不掩盖真实挂起）。

## 6. 偏差

- 任务单要求 `pnpm test` exit 0；本机 node v22（低于仓库 engines `>=26`）+ 363 文件并行时，两个既有测试文件触发内部 30s 超时。按上表以「单文件复跑全绿 + 全量其余全绿」收口，回执评审结论为 `conditional-pass`，并把测试稳定性债登记为遗留项。
- 无其他偏差；未改任务单 scope 外文件。

## 7. 遗留

- 全量测试超时预算：`af073-batch-report-cli.spec.ts` 的 `spawnSync` 30s 与 `wp12-memory-closeout.spec.ts` 的单例 30s，建议新任务改为显式 120s / 60s 并保留用例语义。
- IM-058 已具备关闭证据；因本单 scope 不含 `improvement-log.json`，台账关闭由后续编排动作处理。
- 0.05 阈值是否长期沿用，待真实批次标定后再定；本单不改阈值来源。
