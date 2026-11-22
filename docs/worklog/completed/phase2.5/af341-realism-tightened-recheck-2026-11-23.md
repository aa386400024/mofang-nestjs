# AF-341 交付记录 · tightened 臂八次重复复核

- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-341/task-sheet.md`
- 基线：`1930636242b03678db2379aec736471294478fee`
- 日期：2026-11-23

## 1. 改了哪些文件

| 文件 | 变更 |
| --- | --- |
| `docs/worklog/completed/phase2.5/af341-realism-tightened-recheck-report-2026-11-23.md` | 复核报告 |
| `docs/worklog/completed/phase2.5/af341-realism-tightened-recheck-2026-11-23.md` | 本交付记录 |
| `docs/worklog/records/.../AF-341/` | 任务单、manifest、回执 |

无代码改动。

## 2. 关键决策

1. **只补样本，不改臂**。`tightened` 已在 AF-335 有 4 次，本单新跑 8 次，用于判断稳定性，不做代码层修饰。
2. **把“分离性”当成与“在窗”同等重要的指标**。AF-335/337/340 都只看密度，这次同时算 off 16 对 tightened 8 的分离区间，才看出反向耦合。
3. **不调 `humanization-v1` 阈值**。窗口是否该改，是需要大炮决定的产品口径，不在执行单里改。

## 3. 闸门数字

| 闸门 | 结果 |
| --- | --- |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm lint` | exit 0，0 error / 0 warning |
| `pnpm test` | 296 文件通过 / 1 跳过（297）；4538 例通过 / 4 跳过（4542） |
| `git diff --stat HEAD -- src/engine-core` | 空 |
| `pnpm orchestration:preflight` | PASS |

## 4. 实测

- 焦虑 tightened：均值 `2.794673` / 中位 `2.846368` / 范围 `1.851852–4.089219`，`3/8` 在窗。
- 回避 tightened：均值 `3.021134` / 中位 `2.686278` / 范围 `2.116402–4.487179`，`4/8` 在窗。
- 与 off 16 两格均完全重叠，无可分离区间。
- 结论：密度稳定在 2.79/3.02；越接近窗口越与 off 不可分，密度与分离性反向耦合。

## 5. 与任务单的偏差

| 任务单要求 | 实际 | 处理 |
| --- | --- | --- |
| 8 次 × 2 人设 12 轮 | 192 次，0 失败 | 一致 |
| 不改代码 / 不调阈值 | 未改 | 一致 |

## 6. commit message

`docs(af341): 真人度 tightened 臂八次重复复核`
