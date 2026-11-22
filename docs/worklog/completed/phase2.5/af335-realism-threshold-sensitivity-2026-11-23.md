# AF-335 · 真人度基线分离度与阈值敏感性交付记录（2026-11-23）

## 交付内容

| 产物 | 路径 |
| --- | --- |
| 分离度纯模块 | `src/shared/realism/realism-sample-separation.ts` |
| 敏感性分析 CLI | `bin/visitor-realism-gate-sensitivity.ts` |
| 单测 | `test/shared/realism/realism-sample-separation.spec.ts` |
| 实测报告 | `docs/worklog/completed/phase2.5/af335-realism-threshold-sensitivity-report-2026-11-23.md` |
| 本交付记录 | `docs/worklog/completed/phase2.5/af335-realism-threshold-sensitivity-2026-11-23.md` |
| 分析 JSON（gitignored） | `data/phase25-exit/af335-realism-threshold-sensitivity/report.json` |

## 实现要点

1. `realism-sample-separation.ts` 提供 `separatingBand` / `confusionAt` / `countAbove`：
   - 判定口径固定 `value > threshold` 为正；
   - `separatingBand` 返回 `[max(negatives), min(positives))`，重叠或空样本返回 `null`；
   - 非有限值不参与统计；负/正样本各至少一个有限值才能算混淆矩阵。
2. `bin/visitor-realism-gate-sensitivity.ts` 读取多份 `summary.json`，按 `persona + arm` 合并 `densitySamples`，对 off 与 full / minimal / tightened 分别计算可分区间、中点和混淆矩阵。只读本地 JSON，不调模型。
3. 参数：`--summaries`（逗号分隔）、`--personas`、`--arms`、`--out`、`--json`。
4. 单测 11 例覆盖完全分离、重叠、相等边界、空样本、单样本、NaN/Infinity 过滤、阈值等于负样本最大值仍判负、混淆矩阵与 `countAbove`。
5. 不改生产 prompt、不改 `humanization-v1`、不切 `RENDER_REALISM_MODE`。

## 真实执行

- 输入：`data/phase25-exit/af333-realism-long-session/summary.json`（4 重复、6 cells）+ `data/phase25-exit/af334-realism-long-session-ablation/summary.json`（4 重复、14 cells）。
- 合并后 off 焦虑 8 样本、回避 8 样本；full / minimal 各 8；tightened 各 4。
- 执行命令：`pnpm exec tsx bin/visitor-realism-gate-sensitivity.ts --summaries "dir1/summary.json,dir2/summary.json" --out .../report.json --personas "anxious,guarded" --arms "full,minimal,tightened"`
- 全程 0 次模型调用（纯本地分析）。

### 结果摘要

| 人设 | 对比 | 正样本 | 可分区间 | 中点 | 中点混淆 |
| --- | --- | --- | --- | --- | --- |
| anxious | off vs full | 8 | `[3.583062, 5.785124)` | `4.684093` | TP=8 / FP=0 / TN=8 / FN=0 |
| anxious | off vs minimal | 8 | 不可分 | — | — |
| anxious | off vs tightened | 4 | 不可分 | — | — |
| guarded | off vs full | 8 | `[4.280156, 6.060606)` | `5.170381` | TP=8 / FP=0 / TN=8 / FN=0 |
| guarded | off vs minimal | 8 | 不可分 | — | — |
| guarded | off vs tightened | 4 | 不可分 | — | — |

跨人设统一阈值只能落在 `[4.280156, 5.785124)`，中点约 `5.032640`。

## 关键设计判断

- **只有 full 与 off 可分。** full 的 16 个样本最低 `5.785124`，off 的 16 个样本最高 `4.280156`，形成约 1.5 个点的空档；两人设分别给出 `[3.583062, 5.785124)` 与 `[4.280156, 6.060606)`。
- **minimal / tightened 与 off 结构性重叠。** 两者都有低于 off 最大值甚至低于中位数的样本；任何拒绝它们的阈值都会误伤部分 off。单一密度阈值无法区分“prompt 造成的事件”与“模型自然表达”。
- **gate 不能认证 active。** 因为 minimal / tightened 落在 off 分布内，gate 通过不等于候选中性；候选上线需另走 allowlist。
- **8+8 样本不足。** full 与 off 的分离依赖当前样本；off 的 `4.280156` 已接近 full 下界，再多几个 5+ 的 off 样本就会让完全可分消失。建议 ≥16–20 重复。
- **不调 `humanization-v1` 的 2.50。** 调阈值只能把假阳性搬成假阴性，不能同时满足“接受全部 off、拒绝 full、拒绝 minimal/tightened”。

## 闸门

| 闸门 | 结果 |
| --- | --- |
| `pnpm exec vitest run test/shared/realism/realism-sample-separation.spec.ts` | 11/11 passed |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm lint` | exit 0，0 error / 0 warning |
| `pnpm test` | 295 files passed / 1 skipped；4521 tests passed / 4 skipped |
| `git diff --stat HEAD -- src/engine-core` | 空 |

日志：`docs/team/agent-orchestration/transport/af335-lint.log`、`af335-typecheck.log`、`af335-test.log`（gitignored）。

## 与任务单的偏差

| 任务单 | 实际 | 理由 |
| --- | --- | --- |
| 至少 8 例单测 | 11 例 | 多覆盖阈值等于负样本最大值、NaN/Infinity、空样本 |
| 读取多份 summary.json | 通过 `--summaries` 逗号列表读取 AF-333/334 两份 | 无偏差 |
| 不调 threshold / 不改生产 | 未改 `humanization-v1` 与生产 prompt | 本单只做敏感性分析 |

## 未覆盖 / 遗留

- 8 个 off 样本不足以给出稳定分离区间；tightened 只有 4 个样本。
- 没有做句子级事件归因；只做整层/整分支的密度分布。
- 分析结果只是工程敏感性，不是临床阈值；不宣称疗效或临床真人度。
- 原始 JSON 在 gitignored 目录，不入库。

## commit message

`feat(af335): 增加真人度基线分离度与阈值敏感性分析`
