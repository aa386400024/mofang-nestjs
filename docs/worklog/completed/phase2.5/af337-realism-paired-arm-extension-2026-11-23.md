# AF-337 · 真人度 full/minimal 配对扩样与阈值复核交付记录（2026-11-23）

## 交付内容

| 产物 | 路径 |
| --- | --- |
| 实测报告 | `docs/worklog/completed/phase2.5/af337-realism-paired-arm-extension-report-2026-11-23.md` |
| 本交付记录 | `docs/worklog/completed/phase2.5/af337-realism-paired-arm-extension-2026-11-23.md` |
| 原始 JSON（gitignored） | `data/phase25-exit/af337-realism-paired-arm-extension/reps/rep-1..8.json`、`summary.json`、`sensitivity/report.json` |

复用型验证，不新增业务代码：复用 AF-333 CLI 的 `--turn-set long`、AF-332 的分布 CLI、AF-335 的敏感性 CLI。

## 实现要点 / 复用方式

1. 8 次独立重复，每次只跑 `full` + `minimal`：`pnpm exec tsx bin/visitor-realism-prompt-tightening.ts --turn-set long --arms "full,minimal" --reps 1 --turns 12 --out .../reps/rep-N.json`；每份 2 人设 × 2 分支 × 12 轮 = 48 次调用。
2. 8 份汇总：`pnpm exec tsx bin/visitor-realism-baseline-variance.ts --dir .../reps --out .../summary.json --arms "full,minimal" --personas "anxious,guarded"`。
3. 敏感性：`pnpm exec tsx bin/visitor-realism-gate-sensitivity.ts --summaries "af333,af334,af336,af337 summary.json" ... --arms "full,minimal,tightened"`；off 16、full 16、minimal 16、tightened 4。
4. 不改生产文件、不调阈值、不切 `RENDER_REALISM_MODE`。

## 真实执行

- 有效新增：8 次 full+minimal 12 轮重复，`8 × 48 = 384` 次豆包 Seed Character 调用，0 失败。
- 无效消耗：首次 `--reps 8 --out <目录>` 完成 `2×2×5×12 = 240` 次调用后因 `--out` 只接受文件而 `EISDIR`，未留存任何样本。
- 本轮真实总消耗：`240 + 384 = 624` 次调用；报告与交付记录均保留这笔账。

### 结果摘要

新 8 次：

| 人设 | 分支 | 均值 | 中位数 | 最小 | 最大 | 窗口内 |
| --- | --- | --- | --- | --- | --- | --- |
| anxious | full | 7.311927 | 7.680962 | 5.685619 | 8.754209 | 0/8 |
| anxious | minimal | 2.921805 | 2.815880 | 2.032520 | 3.643725 | 3/8 |
| guarded | full | 6.939249 | 7.034976 | 5.607477 | 8.372093 | 0/8 |
| guarded | minimal | 2.103243 | 1.964149 | 1.086957 | 3.205128 | 5/8 |

合并 16：

| 人设 | 分支 | 均值 | 中位数 | 最小 | 最大 | 窗口内 |
| --- | --- | --- | --- | --- | --- | --- |
| anxious | off | 2.743605 | 2.729458 | 1.486989 | 4.150943 | 5/16 |
| anxious | full | 7.197552 | 7.614877 | 5.685619 | 8.754209 | 0/16 |
| anxious | minimal | 2.942349 | 2.916869 | 1.459854 | 4.296875 | 4/16 |
| guarded | off | 2.942199 | 3.147257 | 0.952381 | 4.280156 | 4/16 |
| guarded | full | 7.037324 | 6.984672 | 5.607477 | 9.340659 | 0/16 |
| guarded | minimal | 2.431334 | 2.765065 | 1.086957 | 3.260870 | 7/16 |
| anxious | tightened | 2.856170 | 2.836195 | 2.651515 | 3.100775 | 0/4 |
| guarded | tightened | 3.283580 | 2.995731 | 2.857143 | 4.285714 | 0/4 |

分离复核：

| 人设 | off 最大 | full 最小 | 区间 | 中点 | 中点混淆 |
| --- | --- | --- | --- | --- | --- |
| anxious | 4.150943 | 5.685619 | `[4.150943, 5.685619)` | 4.918281 | TP=16 / FP=0 / TN=16 / FN=0 |
| guarded | 4.280156 | 5.607477 | `[4.280156, 5.607477)` | 4.943817 | TP=16 / FP=0 / TN=16 / FN=0 |

统一区间 `[4.280156, 5.607477)`，中点 `4.943817`。minimal 16 与 tightened 4 均与 off 不可分。

## 关键设计判断

- **full 与 off 仍完全可分，但空档收窄到 1.33–1.53。** AF-336 焦虑空档 1.63、回避 1.78；补 full 后焦虑 `5.785124 → 5.685619`、回避 `6.060606 → 5.607477`，统一中点从 `5.032640` 降到 `4.943817`。
- **full 的尾部也在波动。** 新 full 的最小值都低于旧 full 的下界；full 不是稳定 6+，只是当前还没跌到 4.x。
- **minimal 完全落回 off 侧。** 16 个 minimal 全部低于中点，分布与 off 重叠；减层到这个程度没有可区分的真人度增量。
- **off 基线仍未进窗口。** 中位数 `2.729458` / `3.147257`，窗口内 `5/16` / `4/16`；补 full/minimal 不改变基线。
- **gate 只能当 full 报警。** 统一线 `4.943817` 0 误伤 off、抓住 16 个 full，但 16 个 minimal 也全部低于线；候选必须 allowlist。
- **生产继续 off；不调阈值；不启用 active 候选。**

## 闸门

| 闸门 | 结果 |
| --- | --- |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm lint` | exit 0，0 error / 0 warning |
| `pnpm test` | 295 files passed / 1 skipped；4521 tests passed / 4 skipped |
| `git diff --stat HEAD -- src/engine-core` | 空 |

日志：`docs/team/agent-orchestration/transport/af337-run.log`、`af337-lint.log`、`af337-typecheck.log`、`af337-test.log`（gitignored）。

## 与任务单的偏差

| 任务单 | 实际 | 理由 |
| --- | --- | --- |
| 8 次 12 轮 full+minimal，384 调用 | 有效 384 调用、0 失败 | 无偏差 |
| 合并 full/minimal 各 16 | 各 16 | 无偏差 |
| 复核分离区间 | full 仍可分，minimal/tightened 不可分 | 无偏差 |
| 不改生产 / 不调阈值 | 未改生产、`humanization-v1`、`RENDER_REALISM_MODE` | `engine-core` 零 diff |
| 成本 | 额外 240 次无效调用 | 首次参数写法错误，已在报告与回执登记 |

## 未覆盖 / 遗留

- full 16 / off 16 仍不是置信区间；空档只有 1.33–1.53。
- full 只有 16 个、off 只有 16 个，未做配对同会话采样（每对使用同一时间窗），只是同协议独立重复。
- minimal/tightened 不可分，候选只能 allowlist。
- 原始 JSON 在 gitignored 目录，不入库。

## commit message

`feat(af337): 补齐真人度 full/minimal 配对样本并复核分离`
