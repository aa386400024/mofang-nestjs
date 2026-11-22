# AF-334 · 真人度 12 轮长会话层归因消融交付记录（2026-11-23）

## 交付内容

| 产物 | 路径 |
| --- | --- |
| 实测报告 | `docs/worklog/completed/phase2.5/af334-realism-long-session-ablation-report-2026-11-23.md` |
| 本交付记录 | `docs/worklog/completed/phase2.5/af334-realism-long-session-ablation-2026-11-23.md` |
| 原始 JSON（gitignored） | `data/phase25-exit/af334-realism-long-session-ablation/reps/rep-1..4.json`、`summary.json` |

本单为复用型验证任务：不新增业务代码，直接复用 AF-331 CLI 的 7 分支块与 AF-333 的 `--turn-set long`，用 AF-332 的分布 CLI 汇总。

## 实现要点 / 复用方式

1. 执行层：`pnpm exec tsx bin/visitor-realism-prompt-tightening.ts --turn-set long --arms "off,full,no-shape,no-event,no-quota,minimal,tightened" --reps 1 --turns 12`，每份报告含 2 人设 × 7 分支 = 14 个 cell、168 次调用。
2. 汇总层：`pnpm exec tsx bin/visitor-realism-baseline-variance.ts --dir .../reps --out .../summary.json --arms "off,full,no-shape,no-event,no-quota,minimal,tightened" --personas "anxious,guarded"`。
3. 分支含义沿用 AF-331：`full` 为生产完整块；`no-shape` / `no-event` / `no-quota` 分别逐字删除形态层 / 事件层 / 配额层；`minimal` = 配额 + 稳定层；`tightened` 为收紧候选。
4. 不改生产 prompt、不改 `humanization-v1`、不切 `RENDER_REALISM_MODE`；原始 JSON 含合成台词与 prompt，留在 gitignored 取证目录。

## 真实执行

- `4` 次独立重复，每份：`2 人设 × 7 分支 × 12 轮 = 168` 次调用。
- 合计 `672` 次豆包 Seed Character 调用，`0` 失败；每份 `turns=12`。
- 与 AF-333 使用同一套 12 轮台词、同一模型、同一温度与 token 上限。

### 结果摘要（密度/百字）

| 人设 | 分支 | 均值 | 中位数 | 最小 | 最大 | 窗口内 |
| --- | --- | --- | --- | --- | --- | --- |
| anxious | off | 2.719915 | 2.615241 | 2.066116 | 3.583062 | 2/4 |
| anxious | full | 7.541754 | 8.011380 | 5.785124 | 8.359133 | 0/4 |
| anxious | no-shape | 5.804483 | 5.812457 | 3.900709 | 7.692308 | 0/4 |
| anxious | no-event | 4.401231 | 4.562399 | 3.746398 | 4.733728 | 0/4 |
| anxious | no-quota | 7.327934 | 6.921429 | 6.756757 | 8.712121 | 0/4 |
| anxious | minimal | 3.090819 | 3.298872 | 2.222222 | 3.543307 | 1/4 |
| anxious | tightened | 2.856170 | 2.836195 | 2.651515 | 3.100775 | 0/4 |
| guarded | off | 3.277897 | 3.356395 | 2.118644 | 4.280156 | 1/4 |
| guarded | full | 7.526616 | 7.065368 | 6.635071 | 9.340659 | 0/4 |
| guarded | no-shape | 5.594589 | 5.230769 | 4.972376 | 6.944444 | 0/4 |
| guarded | no-event | 5.986649 | 6.079105 | 5.405405 | 6.382979 | 0/4 |
| guarded | no-quota | 7.569740 | 7.195512 | 7.079646 | 8.808290 | 0/4 |
| guarded | minimal | 2.555572 | 2.577095 | 1.807229 | 3.260870 | 2/4 |
| guarded | tightened | 3.283580 | 2.995731 | 2.857143 | 4.285714 | 0/4 |

关键指标：

- 焦虑：event/轮 · 轮次率 · 修正/轮 —— off `0.645833 / 0.583333 / 0`；full `2.145833 / 0.958333 / 0.708333`；no-shape `1.166667 / 0.812500 / 0.104166`；no-event `1.291666 / 0.854166 / 0.583333`；no-quota `1.708334 / 0.937500 / 0.312500`；minimal `0.666667 / 0.583333 / 0`；tightened `0.666667 / 0.541667 / 0.187500`。
- 回避：off `0.625000 / 0.562500 / 0.020833`；full `1.208333 / 1.000000 / 0`；no-shape `0.729167 / 0.687500 / 0`；no-event `1.000000 / 1.000000 / 0`；no-quota `1.291667 / 1.000000 / 0`；minimal `0.333333 / 0.312500 / 0`；tightened `0.437500 / 0.416667 / 0`。

## 关键设计判断

- **事件层是最大单项放大器，但不是唯一。** 拆事件层后焦虑中位数从 `8.011380` 降到 `4.562399`，回避从 `7.065368` 到 `6.079105`；仍远高于 `2.50`。
- **形态层与事件层叠加才构成主要过量。** 单拆形态层焦虑 `5.812457`、回避 `5.230769`；同时拆两层（`minimal`）降到 `3.298872 / 2.577095`，但都未回到窗口内。
- **配额层不是主因。** `no-quota` 焦虑 `6.921429`、回避 `7.195512`，与 `full` 基本同档；只收紧配额无法降密度。
- **`minimal` 与 `tightened` 仍不可作 active 候选。** 焦虑 minimal `3.298872` 高于 off `2.615241`；回避 tightened `2.995731`、焦虑 tightened `2.836195`，两人设 `0/4`。
- **off 基线在 12 轮上仍不稳。** 本批焦虑 off 中位数 `2.615241`、回避 `3.356395`；与 AF-333 的 `2.607085 / 2.344401` 不一致。合并 8 个 off 样本后焦虑约 `2.607`、回避约 `3.115`，仍都在窗口外。
- **生产继续 off；不调阈值；不启用 active 候选。**

## 闸门

| 闸门 | 结果 |
| --- | --- |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm lint` | exit 0，0 error / 0 warning |
| `pnpm test` | 294 files passed / 1 skipped；4510 tests passed / 4 skipped |
| `git diff --stat HEAD -- src/engine-core` | 空 |

日志：`docs/team/agent-orchestration/transport/af334-lint.log`、`af334-typecheck.log`、`af334-test.log`（gitignored）。

## 与任务单的偏差

| 任务单 | 实际 | 理由 |
| --- | --- | --- |
| 12 轮 × 7 分支 × 2 人设 × 4 重复 = 672 | 完全执行，672 调用、0 失败 | 无偏差 |
| 报告给逐重复、均值、中位数、极值、窗口计数 | 已给 14 个 cell 全部六项 | 无偏差 |
| 不改生产 prompt / 阈值 | 只跑离线 CLI；生产文件、`humanization-v1` 未改 | `git diff --stat HEAD -- src/engine-core` 为空 |
| 不新增业务代码 | 本单为复用型验证，只新增 docs | 任务范围本身就是验证，不强行加代码 |

## 未覆盖 / 遗留

- 4 次重复仍不足统计显著性；只覆盖 2 个合成人设。
- 事件层与形态层都需继续拆到句子级，确认最小可保留子集；本单只做整层删除。
- `minimal` 只作为“去 full 过量”的中间态；`tightened` 在长会话上不稳定，均不得上线。
- 原始 JSON 含合成台词与 prompt，保留在 gitignored 取证目录，不得提交。

## commit message

`feat(af334): 增加真人度 12 轮长会话层归因消融`
