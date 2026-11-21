# AF-239 · 修复影子实验首 token P95 聚合取最大值

- 任务：`AF-239`（`phase2.5-orchestration-closed-loop`）
- 分支：`task/AF-239-p95-aggregation-fix`
- 日期：2026-11-22

## 结论

`mergeMetrics` 的整体 `firstTokenP95Ms` / `totalP95Ms` 原来取 12 场单场 P95 的最大值，而不是 144 轮全局样本的 P95。AF-238 r2 E 因此被误判 `first-token-p95` 硬失败：报告 `2981ms`，实际全局 `900ms`。

修复后重算 r2：

| arm | 修复前首 token P95 | 修复后 | 修复后 verdict |
| --- | --- | --- | --- |
| A | 3048ms | 2044ms | 基线 |
| C | 1376ms | 887ms | fail（plot、tag，真实内容问题） |
| E | 2981ms | 900ms | conditional（硬门槛全过） |

seed-v2 三次采样现在硬门槛 3/3 全过；seed-v1 仍因 r2 的 `plot-zero` 与 `tag-error-rate` 失败，属真实的格式稳定性问题。

## 改动

| 文件 | 改动 |
| --- | --- |
| `bin/visitor-sim-analysis.ts` | `mergeMetrics` 增加可选 `turnDurations` 参数；有轮次样本时按全局样本算 P50/P95，无样本时保留原聚合兜底 |
| `bin/visitor-sim-analysis.ts` | `analyzeArmObjective` 把全部会话的全部轮次传入 overall 与 byDifficulty 聚合 |
| `test/auto-practice/af232-visitor-shadow.spec.ts` | 新增回归：3 场 ×20 轮、其中 2 个慢轮时，整体 P95 不得被单场 max 抬到 3000 |

单场指标定义未变；生成、评分、门槛阈值、prompt 未改。

## 闸门

- `pnpm exec vitest run test/auto-practice/af232-visitor-shadow.spec.ts`：18/18 通过。
- 修复前该回归断言失败（`expected 3000 to be less than 1000`）。
- `pnpm lint`：0 error / 0 warning。
- `pnpm typecheck`：exit 0。
- `pnpm test`：252 文件通过 + 1 skipped；4214 tests 通过 + 4 skipped。
- `git diff --stat HEAD -- src/engine-core`：空。
- r2 重算：`scored=35`（仍保留 1 份 R2 解析失败，不影响 P95）；E 首 token P95 `900ms`、verdict `conditional hard=true`。

## 偏差

- 任务单写“重算 AF-238 r2/r3”，实际先重算 r2 验证；r3 与 r1 的缓存报告可在需要时补跑，本次不阻塞结论。
- 修复同时覆盖 `totalP95Ms`，避免同类延迟指标重复出现该缺陷。

## 限制

- 仅修复聚合口径，不改变单场内部 P95 或评分；历史报告中的旧 P95 数字需重跑才会更新。
- 不接生产。
