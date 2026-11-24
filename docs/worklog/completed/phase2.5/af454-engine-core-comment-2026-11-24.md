# AF-454 · engine-core 两处注释与 AF-322 标定系数口径对齐

日期 2026-11-24 · 分支 `task/AF-454-engine-core-comment` · 基线 `e855dbcc`

## 为什么做

AF-322 标定批次已把 `DELTA_TABLE` 里 `holding_present` / `cold_absent` 从 ZERO 改成非零工程种子值，但两处内核注释仍按标定前的说法写，读代码的人会据此认为这两类事件不产生任何 delta（AF-446-B1 / B2 登记项）。本次只把注释拉到与真实值一致，**不动任何数值与逻辑**。

## engine-core 红线例外

本任务动 `src/engine-core`，依据是大炮 2026-11-24 对本轮的明确批准（交互确认，选项「批准改注释」）：

> 按豁免在任务单记本次批准，只动注释（session-event.ts + state-transition.ts），必须过 boundary.spec.ts 断言，逻辑零变化。

边界自我约束：只改注释行；无新增文件、无 import 变化、无类型/常量/函数改动。

## 改了什么

`src/engine-core/domain/events/session-event.ts`

- 原第 19-20 行「DELTA_TABLE 里的种子向量 = ZERO (零回归)」→ 改为「自 AF-322 标定起已带非零工程种子值」，并直接写出两类事件的种子值（holding_present: safety +0.004 / bond +0.002 / verbal -0.002；cold_absent: trust -0.004 / safety -0.002 / bond -0.002），保留「工程种子、非临床标定、仍可经 DeltaTableConfig 覆写」的原有约束。
- 第 34 / 36 行两个枚举成员的 doc 注释「种子 delta = ZERO, 临床增量待标定」→ 改为「种子 delta 非零，见 state-transition.ts DELTA_TABLE」。

`src/engine-core/cognition/state-transition.ts`

- 第 364-368 行原来只列 3 个维度（holding_present 列 safety/bond/verbal，cold_absent 列 trust/safety/bond），实际 `DELTA_TABLE` 还含 valence / arousal / depth / style / negative。改为**全量非零维度**逐字段列出，并显式说明「未列的维度种子为 0」，避免读者误以为漏维度是漏写。

改动量：`2 files changed, 10 insertions(+), 7 deletions(-)`，逐行均可判定为注释行。

## 闸门（实跑数字）

| 闸门         | 命令                                                     | 结果                                  |
| ------------ | -------------------------------------------------------- | ------------------------------------- |
| 内核边界断言 | `pnpm exec vitest run test/engine-core/boundary.spec.ts` | **12 tests / 1 file passed**（991ms） |
| 类型检查     | `pnpm typecheck`                                         | **exit 0**，0 error                   |
| 静态检查     | `pnpm lint`                                              | **exit 0**，0 error / 0 warning       |
| 红线核对     | `git diff --stat HEAD -- src/engine-core`                | 只有上述两文件，纯注释                |

注：本机当前 PATH 的 node 是 v22.23.2（repo 要求 ≥26），pnpm 打印了 engine 警告，但三道闸门均 exit 0；这与既有任务的实测口径一致，未改动环境。

## 与任务单的偏差

无。任务单五项成功判据逐条满足。

## 遗留

- 本次把 B1/B2 闭合后，AF-446 回执里这两条候选改进应转入 improvement-log 并置 done —— 由后续的候选改进入库任务统一处理（AF-455）。
- `DELTA_TABLE` 数值本身仍标为「工程种子，非临床标定」，与 `docs/architecture/behavior-operator-delta-ledger-v1.0.md` 口径一致，未新增结论。
