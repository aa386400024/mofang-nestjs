# AF-332 · 真人度短会话基线方差与配对中位数交付记录（2026-11-23）

## 交付内容

| 产物 | 路径 |
| --- | --- |
| 分布纯模块 | `src/shared/realism/realism-metric-distribution.ts` |
| 基线方差分析 CLI | `bin/visitor-realism-baseline-variance.ts` |
| 单测 | `test/shared/realism/realism-metric-distribution.spec.ts` |
| 实测报告 | `docs/worklog/completed/phase2.5/af332-realism-baseline-variance-report-2026-11-23.md` |
| 本交付记录 | `docs/worklog/completed/phase2.5/af332-realism-baseline-variance-2026-11-23.md` |
| 原始 JSON（gitignored） | `data/phase25-exit/af332-realism-baseline/reps/rep-1..6.json`、`summary.json` |

## 实现要点

1. `realism-metric-distribution.ts` 提供 `medianOf` / `statisticsOf` / `countWithinWindow` / `countAtMost`；缺失、非有限值不参与统计，偶数样本中位数取中间两数均值。
2. `bin/visitor-realism-baseline-variance.ts` 读取目录下 `rep-*.json`（每份为 AF-331 单重复报告，2 人设 × 3 分支 × 6 轮），输出每人设每分支的均值、中位数、最小、最大、窗口内计数与逐重复密度。
3. 分析 CLI 同时用 `humanization-v1` 对每个样本做“假设性 active”判定，明确标注为校准，不是生产 gate。
4. 复用 AF-331 的 `off` / `full` / `minimal` 块，不新增 prompt、不改生产文件。
5. 单测 12 例覆盖奇数/偶数中位数、缺失值、空数组、单样本、极值、窗口/上限计数与不修改入参。

## 真实执行

- 6 次独立重复，每份：2 人设 × 3 分支 × 6 轮 = 36 次调用。
- 合计 `216` 次豆包 Seed Character 调用，`0` 失败。
- 分析命令：`pnpm exec tsx bin/visitor-realism-baseline-variance.ts --dir data/phase25-exit/af332-realism-baseline/reps --out data/phase25-exit/af332-realism-baseline/summary.json`

### 结果摘要（密度/百字）

| 人设 | 分支 | 均值 | 中位数 | 最小 | 最大 | 窗口内 |
| --- | --- | --- | --- | --- | --- | --- |
| anxious | off | 2.853935 | 3.172327 | 1.351351 | 4.724409 | 2/6 |
| anxious | full | 7.223002 | 7.445629 | 5.487805 | 8.484848 | 0/6 |
| anxious | minimal | 3.417372 | 3.324176 | 1.438849 | 5.263158 | 1/6 |
| guarded | off | 2.412356 | 1.925926 | 1.652893 | 5.194805 | 5/6 |
| guarded | full | 7.779097 | 7.136363 | 6.086957 | 10.679612 | 0/6 |
| guarded | minimal | 2.143403 | 1.838466 | 1.162791 | 3.797468 | 4/6 |

其它指标：

- anxious：off 事件/轮 `0.666667`、轮次率 `0.611111`、修正/轮 `0`；full `2.166667 / 1.000000 / 0.777778`；minimal `0.777778 / 0.583333 / 0`。
- guarded：off `0.388889 / 0.388889 / 0`；full `1.333333 / 1.000000 / 0`；minimal `0.277778 / 0.277778 / 0`。

## 关键设计判断

- **`full` 稳定过量，不是单次抖动。** 12 个样本全部高于 `2.50`，最低 `5.487805`、最高 `10.679612`；`0/6` 通过。
- **off 基线本身在 6 轮短会话上不稳定。** 焦虑 `1.351351 – 4.724409`、`2/6` 在窗口内；回避 `1.652893 – 5.194805`、`5/6` 在窗口内。单批均值不能代表基线。
- **`minimal` 不是焦虑的可靠修复。** 焦虑 minimal 中位数 `3.324176` 高于 off `3.172327`，`1/6` 在窗口内；回避 minimal 与 off 基本同档（`1.838466` vs `1.925926`）。
- **均值被离群样本拉偏。** 焦虑 off 均值 `2.853935` vs 中位数 `3.172327`；回避 off 均值 `2.412356` vs 中位数 `1.925926`；报告同时给出两者。
- **不调整 `humanization-v1` 阈值。** 当前 `2.50` 是 2026-11-23 工程种子；在短会话上方差过大，改阈值只是换一个数字，不能解决采样噪声。

## 闸门

| 闸门 | 结果 |
| --- | --- |
| `pnpm exec vitest run test/shared/realism/realism-metric-distribution.spec.ts test/shared/realism/realism-prompt-tightening.spec.ts` | 25/25 passed（12 + 13） |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm lint` | exit 0，0 error / 0 warning |
| `pnpm test` | 293 files passed / 1 skipped；4502 tests passed / 4 skipped |
| `git diff --stat HEAD -- src/engine-core` | 空 |

日志：`docs/team/agent-orchestration/transport/af332-analysis-console.log`、`af332-lint.log`、`af332-typecheck.log`、`af332-test.log`（gitignored）。

## 与任务单的偏差

| 任务单 | 实际 | 理由 |
| --- | --- | --- |
| 6 次独立重复，2 人设 × 3 分支 × 6 轮 | 完全执行，216 次调用、0 失败 | 无偏差 |
| 分析 CLI 读取多份报告 | 读取 `rep-1..6.json`，输出 `summary.json` | 无偏差 |
| 报告给逐重复值、均值、中位数、极值、窗口计数 | 已给出六人设分支全部六项 | 无偏差 |
| 不改生产 prompt / 阈值 | 生产文件、`humanization-v1` 均未改 | `git diff --stat HEAD -- src/engine-core` 为空 |

## 未覆盖 / 遗留

- 6 次重复仍不足统计显著性；样本只覆盖 2 个合成人设。
- 未解决短会话密度方差；下一步需要 ≥12 轮或更多重复，并按人设分开基线。
- `minimal` 只作为“去 full 过量”的中间态，不作为可上线 active。
- 原始 JSON 含合成台词，保留在 gitignored 取证目录，不得提交。

## commit message

`feat(af332): 增加真人度短会话基线方差与中位数分析`
