# AF-336 · 真人度 off 基线扩样与 full 分离复核交付记录（2026-11-23）

## 交付内容

| 产物 | 路径 |
| --- | --- |
| 实测报告 | `docs/worklog/completed/phase2.5/af336-realism-off-baseline-extension-report-2026-11-23.md` |
| 本交付记录 | `docs/worklog/completed/phase2.5/af336-realism-off-baseline-extension-2026-11-23.md` |
| 原始 JSON（gitignored） | `data/phase25-exit/af336-realism-off-baseline-extension/reps/rep-1..8.json`、`summary.json`、`sensitivity/report.json` |

本单为复用型验证：不新增业务代码，复用 AF-333 CLI 的 `--turn-set long`、AF-332 的分布 CLI 与 AF-335 的敏感性 CLI。

## 实现要点 / 复用方式

1. 8 次独立重复，每份只跑 `off`：`pnpm exec tsx bin/visitor-realism-prompt-tightening.ts --turn-set long --arms off --reps 1 --turns 12 --out .../rep-N.json`；每份 2 人设 × 12 轮 = 24 次调用，合计 192 次、0 失败。
2. 新 8 份用 `pnpm exec tsx bin/visitor-realism-baseline-variance.ts --dir .../reps --out .../summary.json --arms off --personas "anxious,guarded"` 汇总。
3. 用 `pnpm exec tsx bin/visitor-realism-gate-sensitivity.ts --summaries "af333/summary.json,af334/summary.json,af336/summary.json" ...` 把 off 扩到 16，复核 full / minimal / tightened 分离。
4. 不新增 prompt、不改生产文件、不调阈值、不切 `RENDER_REALISM_MODE`。

## 真实执行

- 新增：8 次 off-only 12 轮重复，`8 × 24 = 192` 次豆包 Seed Character 调用，0 失败。
- 合并：off 16 样本（AF-333 4 + AF-334 4 + AF-336 8）；full / minimal 仍 8；tightened 仍 4。
- 全流程 0 次额外 full/minimal 调用，避免重复花钱。

### 结果摘要

新 8 次 off：

| 人设 | 均值 | 中位数 | 最小 | 最大 | 窗口内 |
| --- | --- | --- | --- | --- | --- |
| anxious | 2.891506 | 3.013593 | 1.486989 | 4.150943 | 3/8 |
| guarded | 3.047689 | 3.209230 | 1.265823 | 4.273504 | 1/8 |

合并 16 个 off：

| 人设 | 均值 | 中位数 | 最小 | 最大 | 窗口内 |
| --- | --- | --- | --- | --- | --- |
| anxious | 2.743605 | 2.729458 | 1.486989 | 4.150943 | 5/16 |
| guarded | 2.942199 | 3.147257 | 0.952381 | 4.280156 | 4/16 |

分离复核：

| 人设 | off 最大值 | full 最小值 | 可分区间 | 中点 | 中点混淆 |
| --- | --- | --- | --- | --- | --- |
| anxious | 4.150943 | 5.785124 | `[4.150943, 5.785124)` | 4.968033 | TP=8 / FP=0 / TN=16 / FN=0 |
| guarded | 4.280156 | 6.060606 | `[4.280156, 6.060606)` | 5.170381 | TP=8 / FP=0 / TN=16 / FN=0 |

## 关键设计判断

- **16 个 off 下 full 仍完全可分。** 空档约 1.5（焦虑 4.150943→5.785124，回避 4.280156→6.060606）；统一阈值仍为 `[4.280156, 5.785124)`，中点 `5.032640`。
- **但 off 基线更差。** 焦虑中位数 `2.729458`、回避 `3.147257`，都高于 `2.50`；窗口内仅 `5/16`、`4/16`。扩样没有把 off 拉回窗口，只是把上界推高。
- **分离是当前样本的巧合。** 焦虑上界离 full 下界只剩 1.63；再来一个 5+ 的 off 样本，完全可分就消失。
- **`minimal` / `tightened` 仍不可分。** 扩样只增加 off，没有改变它们与 off 的结构性重叠；gate 仍只能当 full 报警，不能当 active 认证。
- **生产继续 off；不调阈值；不启用 active 候选。**

## 闸门

| 闸门 | 结果 |
| --- | --- |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm lint` | exit 0，0 error / 0 warning |
| `pnpm test` | 295 files passed / 1 skipped；4521 tests passed / 4 skipped |
| `git diff --stat HEAD -- src/engine-core` | 空 |

日志：`docs/team/agent-orchestration/transport/af336-lint.log`、`af336-typecheck.log`、`af336-test.log`（gitignored）。

## 与任务单的偏差

| 任务单 | 实际 | 理由 |
| --- | --- | --- |
| 8 次 12 轮 off-only，192 调用 | 完全执行，0 失败 | 无偏差 |
| 合并 16 个 off | AF-333 4 + AF-334 4 + AF-336 8 = 16 | 无偏差 |
| 复核 full 分离 | full 仍 8 样本，区间存在 | 无偏差 |
| 不改生产 / 不调阈值 | 未改生产、`humanization-v1`、`RENDER_REALISM_MODE` | `engine-core` 零 diff |

## 未覆盖 / 遗留

- 16 个 off 仍是小样本；full 只有 8 个，分离区间不是置信区间。
- 没有补 full/minimal 新样本；继续只补 off 会让上界单边逼近 full 下界。
- `minimal` / `tightened` 仍不可分，只能走 allowlist。
- 原始 JSON 在 gitignored 目录，不入库。

## commit message

`feat(af336): 增加真人度 off 基线扩样与 full 分离复核`
