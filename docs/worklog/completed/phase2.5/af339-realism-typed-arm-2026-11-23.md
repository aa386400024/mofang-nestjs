# AF-339 · 真人度分型候选 typed 臂交付记录（2026-11-23）

## 交付内容

| 产物 | 路径 |
| --- | --- |
| 分型候选臂 | `src/shared/realism/realism-prompt-tightening.ts`（`typed`、`typed-noshape`） |
| 单测 | `test/shared/realism/realism-prompt-tightening.spec.ts`（18 例） |
| 实测报告 | `docs/worklog/completed/phase2.5/af339-realism-typed-arm-report-2026-11-23.md` |
| 本交付记录 | `docs/worklog/completed/phase2.5/af339-realism-typed-arm-2026-11-23.md` |
| 原始 JSON（gitignored） | `data/phase25-exit/af339-realism-typed-arm/reps/rep-1..8.json`、`noshape-reps/rep-1..8.json`、`summary.json`、`noshape-summary.json`、两份 profile |

## 实现要点

1. `TIGHTENING_ARMS` 扩到 9 个：新增 `typed`、`typed-noshape`。
2. `buildTypedBlock`：保留形态层与其余行，只替换配额与事件两行；焦虑禁用 `repair`、只留 `filler`/`pause`；回避把 `pause` 压到每两轮一次、只留 `trailoff`/`pause`。
3. `buildTypedNoShapeBlock`：在 typed 基础上删掉形态层，验证形态层是不是主驱动。
4. 单测覆盖：9 臂顺序、typed 只改两行、焦虑禁改口、回避压停顿、typed-noshape 只少形态一行、仍保留分型限制、所有非 off 分支 prompt 拼接。

## 实测结果

| 人设 | 分支 | 中位数 | 窗口内 | 每轮事件 | repair/turn |
| --- | --- | --- | --- | --- | --- |
| anxious | typed | 5.045884 | 0/8 | 1.041667 | 0.375000 |
| guarded | typed | 6.153846 | 0/8 | 1.000000 | 0 |
| anxious | typed-noshape | 2.835170 | 2/8 | 0.552083 | 0 |
| guarded | typed-noshape | 2.925578 | 2/8 | 0.395833 | 0 |

对照：off `2.729458` / `3.147257`；full `7.614877` / `6.984672`。

关键发现：
- `typed` 保留形态层时，焦虑 `repair` 仍有 `0.375/turn`，回避 `pause` 仍 `1.0/turn`，事件层禁令无效；
- `typed-noshape` 回到 off 密度与词表，证明真人度增量由形态层“每轮执行”驱动，而不是事件层配额；
- 继续在事件层做减法是死路，下一轮必须先改形态层触发条件。

## 闸门

| 闸门 | 结果 |
| --- | --- |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm lint` | exit 0，0 error / 0 warning |
| `pnpm test` | 296 files passed / 1 skipped；4535 tests passed / 4 skipped |
| `git diff --stat HEAD -- src/engine-core` | 空 |

日志：`docs/team/agent-orchestration/transport/af339-lint.log`、`af339-typecheck.log`、`af339-test.log`、`af339-run.log`、`af339-noshape-run.log`（gitignored）。

备注：合并跑闸门时 `tsc --incremental` 曾出现过一次无诊断的 exit 1（日志中没有 TS 错误），单独重跑 `pnpm typecheck` 为 exit 0；最终以单独重跑结果为准。

## 与任务单的偏差

任务单只要求 `typed`；实测发现 `typed` 被形态层架空后，追加了 `typed-noshape` 作为对照，用于隔离形态层的影响。两次各 8 次重复，共新增 384 次调用、0 失败。这是范围扩展，已在报告与回执中写明理由。

## 未覆盖 / 遗留

- 两个候选都只有 8 次 12 轮重复，不是置信区间。
- 未做“形态层低频高强度”候选；这是下一轮的正解方向。
- `typed-noshape` 的人设声音是否明显变弱，未做人工听感/可读性评估。
- 生产继续 `off`；不调阈值、不启用候选。

## commit message

`feat(af339): 增加真人度分型候选 typed 与去形态对照臂`
