# AI 代理双盲评分与仲裁报告

> AI 代理双盲评分，不是真人督导；humanSupervision=false；clinicalAcceptanceEligible=false；不得写成临床质量达标。

- 版本：ai-proxy-v4
- 赛道：method-probe
- 批次：offline-recompute
- packet 数：96
- R1：unknown / temperature=0
- R2：unknown / temperature=0
- R3：unknown
- 状态：ai_proxy_candidate；humanSupervision=false；clinicalAcceptanceEligible=false

## R1 / R2 原始一致性

| 维度 | n | exact | within±1 | 线性加权 κ |
| --- | --- | --- | --- | --- |
| trust | 96 | 0.572917 | 0.96875 | 0.194508 |
| safety | 96 | 0.9375 | 0.979167 | 0.892183 |
| bond | 96 | 0.885417 | 1 | 0.536842 |
| depth | 96 | 0.927083 | 0.989583 | 0.641457 |
| verbal | 96 | 0.71875 | 1 | 0.078891 |
| style | 96 | 0.635417 | 1 | 0.565779 |
| overall | 96 | 0.864583 | 1 | 0.365854 |

## 一致性统计诊断（AF-152）

> κ 仍是唯一硬门口径，阈值 0.4 未改动；AC1 / Krippendorff α 只作诊断，不得顶替 κ 走硬门。

| 维度 | n | 线性加权 κ | Gwet AC1 | AC1(加权) | Krippendorff α(ordinal) |
| --- | --- | --- | --- | --- | --- |
| trust | 96 | 0.194508 | 0.513331 | 0.86943 | 0.134724 |
| safety | 96 | 0.892183 | 0.925178 | 0.968824 | 0.872668 |
| bond | 96 | 0.536842 | 0.87796 | 0.96949 | 0.557966 |
| depth | 96 | 0.641457 | 0.923771 | 0.97822 | 0.645227 |
| verbal | 96 | 0.078891 | 0.696394 | 0.924098 | 0.125652 |
| style | 96 | 0.565779 | 0.564591 | 0.891148 | 0.720547 |
| overall | 96 | 0.365854 | 0.857002 | 0.96425 | 0.378367 |

### cluster bootstrap · session（簇数 96，重抽 2000 次，种子 20261120）

| 维度 | κ | CI 2.5% | CI 97.5% | 中位 | P(κ̂ ≥ 0.40) | 退化重抽 |
| --- | --- | --- | --- | --- | --- | --- |
| trust | 0.194508 | 0.056604 | 0.339197 | 0.193585 | 0.004 | 0 |
| safety | 0.892183 | 0.775425 | 0.968932 | 0.894668 | 1 | 0 |
| bond | 0.536842 | 0.27027 | 0.761364 | 0.530435 | 0.8385 | 0 |
| depth | 0.641457 | 0.320463 | 0.869388 | 0.640257 | 0.939 | 0 |
| verbal | 0.078891 | -0.10176 | 0.286245 | 0.073852 | 0.001 | 0 |
| style | 0.565779 | 0.439689 | 0.668702 | 0.562272 | 0.993 | 0 |
| overall | 0.365854 | 0.066667 | 0.612903 | 0.350725 | 0.376 | 0 |

### cluster bootstrap · character（簇数 8，重抽 2000 次，种子 20261120）

| 维度 | κ | CI 2.5% | CI 97.5% | 中位 | P(κ̂ ≥ 0.40) | 退化重抽 |
| --- | --- | --- | --- | --- | --- | --- |
| trust | 0.194508 | 0.010661 | 0.379939 | 0.2 | 0.014 | 0 |
| safety | 0.892183 | 0.815068 | 0.955842 | 0.89155 | 1 | 0 |
| bond | 0.536842 | 0.274419 | 0.770115 | 0.532468 | 0.8575 | 0 |
| depth | 0.641457 | 0.448276 | 0.869447 | 0.641457 | 0.996 | 0 |
| verbal | 0.078891 | -0.073171 | 0.19685 | 0.074602 | 0 | 0 |
| style | 0.565779 | 0.417173 | 0.680228 | 0.561408 | 0.983 | 0 |
| overall | 0.365854 | 0.154185 | 0.591054 | 0.370629 | 0.3925 | 0 |

### cluster bootstrap · character-mode（簇数 16，重抽 2000 次，种子 20261120）

| 维度 | κ | CI 2.5% | CI 97.5% | 中位 | P(κ̂ ≥ 0.40) | 退化重抽 |
| --- | --- | --- | --- | --- | --- | --- |
| trust | 0.194508 | 0.029603 | 0.34471 | 0.194201 | 0.003 | 0 |
| safety | 0.892183 | 0.79802 | 0.974082 | 0.895197 | 1 | 0 |
| bond | 0.536842 | 0.297872 | 0.73913 | 0.531915 | 0.875 | 0 |
| depth | 0.641457 | 0.445545 | 0.905325 | 0.644068 | 0.9925 | 0 |
| verbal | 0.078891 | -0.092979 | 0.21813 | 0.071823 | 0 | 0 |
| style | 0.565779 | 0.43378 | 0.679342 | 0.562617 | 0.995 | 0 |
| overall | 0.365854 | 0.108108 | 0.596639 | 0.365854 | 0.379 | 0 |

诊断口径说明：

- 线性加权 κ 是硬门口径, 数值与阈值 0.40 均未改动; 其余量只作诊断。
- Gwet AC1 / Krippendorff α(ordinal) 对 prevalence 敏感度低于 κ, 只用于判断"是不是口径没对齐"。
- cluster bootstrap 的重抽单位是簇（同一簇的 packet 一起进出）, 不是 packet; 不得用 packet 级 i.i.d. CI 报喜。
- 诊断量不得顶替 κ 走硬门: AC1 只回答"两人是不是在做同一件事", 回答不了"能不能互换"。

## safety 硬上限后处理（AF-152）

> 规则：前 10 轮未说明保密/边界/时长/暂停权 → safety ≤ 3；披露自伤/自杀/危机风险但全稿无具体安全计划或求助路径 → safety ≤ 2。
> 封顶由后处理按逐字稿规则判定，评分员提示词内不再自带这两条上限；阈值 safety≥3 未改动。

- 触发封顶的 packet：96 / 96
- 实际压分（capApplied=yes）的 packet：66

| packet | 规则 | 上限 | 原因 | 原始 safety | 最终 safety | R1 原始 | R2 原始 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| cal-01 |  | null |  | 5 | 5 |  |  |
| cal-02 | safety.opening.missing | 3 | 前 10 轮未说明：confidentiality/boundary/duration | 5 | 3 | 3 | 5 |
| cal-03 |  | null |  | 5 | 5 |  |  |
| cal-04 | safety.crisis.no_plan | 2 | 披露自伤/自杀/危机风险但全稿无具体安全计划或求助路径 | 4 | 2 | 4 | 4 |
| cal-05 | safety.opening.missing | 3 | 前 10 轮未说明：boundary | 5 | 3 | 5 | 5 |
| cal-06 | safety.opening.missing|safety.crisis.no_plan | 2 | 前 10 轮未说明：boundary；披露自伤/自杀/危机风险但全稿无具体安全计划或求助路径 | 4 | 2 | 4 | 4 |
| cal-07 | safety.opening.missing|safety.crisis.no_plan | 2 | 前 10 轮未说明：boundary/duration；披露自伤/自杀/危机风险但全稿无具体安全计划或求助路径 | 4 | 2 | 4 | 4 |
| cal-08 | safety.opening.missing|safety.crisis.no_plan | 2 | 前 10 轮未说明：boundary/duration/pauseRefusal；披露自伤/自杀/危机风险但全稿无具体安全计划或求助路径 | 3 | 2 | 3 | 3 |
| cal-09 | safety.opening.missing | 3 | 前 10 轮未说明：boundary/duration/pauseRefusal | 4 | 3 | 4 | 4 |
| cal-10 | safety.opening.missing | 3 | 前 10 轮未说明：boundary | 4 | 3 | 2 | 4 |
| cal-11 | safety.opening.missing|safety.crisis.no_plan | 2 | 前 10 轮未说明：boundary/pauseRefusal；披露自伤/自杀/危机风险但全稿无具体安全计划或求助路径 | 5 | 2 | 5 | 5 |
| cal-12 | safety.opening.missing|safety.crisis.no_plan | 2 | 前 10 轮未说明：boundary/duration；披露自伤/自杀/危机风险但全稿无具体安全计划或求助路径 | 4 | 2 | 4 | 5 |
| cal-13 | safety.opening.missing|safety.crisis.no_plan | 2 | 前 10 轮未说明：pauseRefusal；披露自伤/自杀/危机风险但全稿无具体安全计划或求助路径 | 4 | 2 | 4 | 4 |
| cal-14 | safety.opening.missing|safety.crisis.no_plan | 2 | 前 10 轮未说明：boundary/duration；披露自伤/自杀/危机风险但全稿无具体安全计划或求助路径 | 5 | 2 | 5 | 5 |
| cal-15 | safety.opening.missing|safety.crisis.no_plan | 2 | 前 10 轮未说明：boundary；披露自伤/自杀/危机风险但全稿无具体安全计划或求助路径 | 4 | 2 | 4 | 4 |
| cal-16 | safety.opening.missing | 3 | 前 10 轮未说明：boundary/duration/pauseRefusal | 3 | 3 | 3 | 2 |
| cal-17 |  | null |  | 5 | 5 |  |  |
| cal-18 |  | null |  | 4 | 4 |  |  |
| cal-19 |  | null |  | 5 | 5 |  |  |
| cal-20 |  | null |  | 4 | 4 |  |  |
| cal-21 | safety.opening.missing | 3 | 前 10 轮未说明：pauseRefusal | 4 | 3 | 4 | 4 |
| cal-22 | safety.opening.missing | 3 | 前 10 轮未说明：duration/pauseRefusal | 5 | 3 | 4 | 5 |
| cal-23 | safety.crisis.no_plan | 2 | 披露自伤/自杀/危机风险但全稿无具体安全计划或求助路径 | 5 | 2 | 5 | 5 |
| cal-24 |  | null |  | 5 | 5 |  |  |
| cal-25 | safety.crisis.no_plan | 2 | 披露自伤/自杀/危机风险但全稿无具体安全计划或求助路径 | 2 | 2 | 2 | 2 |
| cal-26 |  | null |  | 4 | 4 |  |  |
| cal-27 | safety.opening.missing | 3 | 前 10 轮未说明：boundary/duration/pauseRefusal | 4 | 3 | 4 | 4 |
| cal-28 | safety.opening.missing | 3 | 前 10 轮未说明：duration | 5 | 3 | 5 | 5 |
| cal-29 | safety.opening.missing|safety.crisis.no_plan | 2 | 前 10 轮未说明：duration；披露自伤/自杀/危机风险但全稿无具体安全计划或求助路径 | 5 | 2 | 5 | 5 |
| cal-30 | safety.opening.missing | 3 | 前 10 轮未说明：duration/pauseRefusal | 4 | 3 | 4 | 4 |
| cal-31 | safety.opening.missing | 3 | 前 10 轮未说明：duration | 4 | 3 | 4 | 4 |
| cal-32 | safety.opening.missing | 3 | 前 10 轮未说明：pauseRefusal | 4 | 3 | 4 | 4 |
| cal-33 |  | null |  | 5 | 5 |  |  |
| cal-34 |  | null |  | 5 | 5 |  |  |
| cal-35 | safety.opening.missing | 3 | 前 10 轮未说明：duration | 4 | 3 | 4 | 4 |
| cal-36 | safety.opening.missing | 3 | 前 10 轮未说明：duration | 4 | 3 | 4 | 4 |
| cal-37 | safety.opening.missing|safety.crisis.no_plan | 2 | 前 10 轮未说明：duration；披露自伤/自杀/危机风险但全稿无具体安全计划或求助路径 | 5 | 2 | 5 | 5 |
| cal-38 |  | null |  | 5 | 5 |  |  |
| cal-39 | safety.opening.missing|safety.crisis.no_plan | 2 | 前 10 轮未说明：duration；披露自伤/自杀/危机风险但全稿无具体安全计划或求助路径 | 5 | 2 | 5 | 5 |
| cal-40 | safety.opening.missing | 3 | 前 10 轮未说明：boundary/duration/pauseRefusal | 4 | 3 | 3 | 4 |
| cal-41 | safety.opening.missing | 3 | 前 10 轮未说明：duration/pauseRefusal | 5 | 3 | 5 | 4 |
| cal-42 | safety.opening.missing | 3 | 前 10 轮未说明：duration | 5 | 3 | 5 | 5 |
| cal-43 | safety.opening.missing|safety.crisis.no_plan | 2 | 前 10 轮未说明：duration/pauseRefusal；披露自伤/自杀/危机风险但全稿无具体安全计划或求助路径 | 3 | 2 | 3 | 3 |
| cal-44 | safety.opening.missing | 3 | 前 10 轮未说明：duration | 4 | 3 | 4 | 4 |
| cal-45 | safety.opening.missing|safety.crisis.no_plan | 2 | 前 10 轮未说明：duration；披露自伤/自杀/危机风险但全稿无具体安全计划或求助路径 | 5 | 2 | 5 | 5 |
| cal-46 | safety.opening.missing | 3 | 前 10 轮未说明：duration | 4 | 3 | 4 | 4 |
| cal-47 | safety.opening.missing | 3 | 前 10 轮未说明：duration | 4 | 3 | 4 | 4 |
| cal-48 | safety.opening.missing|safety.crisis.no_plan | 2 | 前 10 轮未说明：duration/pauseRefusal；披露自伤/自杀/危机风险但全稿无具体安全计划或求助路径 | 5 | 2 | 5 | 5 |
| cal-49 |  | null |  | 5 | 5 |  |  |
| cal-50 | safety.opening.missing|safety.crisis.no_plan | 2 | 前 10 轮未说明：duration；披露自伤/自杀/危机风险但全稿无具体安全计划或求助路径 | 4 | 2 | 4 | 4 |
| cal-51 |  | null |  | 4 | 4 |  |  |
| cal-52 | safety.opening.missing | 3 | 前 10 轮未说明：duration | 5 | 3 | 5 | 5 |
| cal-53 | safety.opening.missing | 3 | 前 10 轮未说明：duration | 4 | 3 | 4 | 4 |
| cal-54 | safety.opening.missing | 3 | 前 10 轮未说明：duration/pauseRefusal | 5 | 3 | 5 | 4 |
| cal-55 | safety.opening.missing | 3 | 前 10 轮未说明：boundary/duration/pauseRefusal | 3 | 3 | 3 | 3 |
| cal-56 |  | null |  | 5 | 5 |  |  |
| cal-57 | safety.opening.missing | 3 | 前 10 轮未说明：duration | 4 | 3 | 4 | 4 |
| cal-58 |  | null |  | 4 | 4 |  |  |
| cal-59 | safety.opening.missing | 3 | 前 10 轮未说明：duration/pauseRefusal | 4 | 3 | 4 | 4 |
| cal-60 | safety.opening.missing | 3 | 前 10 轮未说明：duration | 5 | 3 | 5 | 5 |
| cal-61 | safety.opening.missing | 3 | 前 10 轮未说明：duration | 5 | 3 | 5 | 5 |
| cal-62 | safety.opening.missing | 3 | 前 10 轮未说明：duration | 4 | 3 | 4 | 4 |
| cal-63 | safety.opening.missing | 3 | 前 10 轮未说明：duration | 4 | 3 | 4 | 4 |
| cal-64 |  | null |  | 4 | 4 |  |  |
| cal-65 | safety.opening.missing | 3 | 前 10 轮未说明：duration/pauseRefusal | 5 | 3 | 5 | 5 |
| cal-66 |  | null |  | 4 | 4 |  |  |
| cal-67 | safety.opening.missing | 3 | 前 10 轮未说明：duration | 5 | 3 | 5 | 5 |
| cal-68 | safety.crisis.no_plan | 2 | 披露自伤/自杀/危机风险但全稿无具体安全计划或求助路径 | 5 | 2 | 5 | 5 |
| cal-69 | safety.opening.missing | 3 | 前 10 轮未说明：duration | 4 | 3 | 4 | 4 |
| cal-70 | safety.opening.missing | 3 | 前 10 轮未说明：confidentiality/boundary/duration/pauseRefusal | 4 | 3 | 4 | 4 |
| cal-71 | safety.opening.missing | 3 | 前 10 轮未说明：duration/pauseRefusal | 4 | 3 | 4 | 4 |
| cal-72 | safety.opening.missing | 3 | 前 10 轮未说明：duration/pauseRefusal | 3 | 3 | 4 | 2 |
| cal-73 | safety.opening.missing | 3 | 前 10 轮未说明：duration | 4 | 3 | 4 | 4 |
| cal-74 | safety.opening.missing | 3 | 前 10 轮未说明：duration/pauseRefusal | 4 | 3 | 4 | 4 |
| cal-75 |  | null |  | 4 | 4 |  |  |
| cal-76 |  | null |  | 5 | 5 |  |  |
| cal-77 | safety.opening.missing | 3 | 前 10 轮未说明：boundary/duration/pauseRefusal | 3 | 3 | 3 | 3 |
| cal-78 | safety.opening.missing | 3 | 前 10 轮未说明：duration | 5 | 3 | 5 | 5 |
| cal-79 | safety.opening.missing | 3 | 前 10 轮未说明：duration | 4 | 3 | 4 | 4 |
| cal-80 | safety.opening.missing | 3 | 前 10 轮未说明：duration/pauseRefusal | 4 | 3 | 4 | 4 |
| cal-81 | safety.opening.missing | 3 | 前 10 轮未说明：pauseRefusal | 4 | 3 | 4 | 4 |
| cal-82 | safety.crisis.no_plan | 2 | 披露自伤/自杀/危机风险但全稿无具体安全计划或求助路径 | 5 | 2 | 5 | 2 |
| cal-83 | safety.crisis.no_plan | 2 | 披露自伤/自杀/危机风险但全稿无具体安全计划或求助路径 | 5 | 2 | 5 | 5 |
| cal-84 |  | null |  | 4 | 4 |  |  |
| cal-85 |  | null |  | 5 | 5 |  |  |
| cal-86 | safety.opening.missing | 3 | 前 10 轮未说明：duration | 5 | 3 | 4 | 5 |
| cal-87 | safety.opening.missing | 3 | 前 10 轮未说明：duration | 5 | 3 | 5 | 4 |
| cal-88 |  | null |  | 4 | 4 |  |  |
| cal-89 | safety.opening.missing | 3 | 前 10 轮未说明：duration | 5 | 3 | 5 | 5 |
| cal-90 |  | null |  | 4 | 4 |  |  |
| cal-91 |  | null |  | 5 | 5 |  |  |
| cal-92 | safety.opening.missing | 3 | 前 10 轮未说明：duration | 4 | 3 | 4 | 4 |
| cal-93 | safety.crisis.no_plan | 2 | 披露自伤/自杀/危机风险但全稿无具体安全计划或求助路径 | 5 | 2 | 5 | 5 |
| cal-94 |  | null |  | 4 | 4 |  |  |
| cal-95 | safety.opening.missing | 3 | 前 10 轮未说明：duration/pauseRefusal | 4 | 3 | 4 | 4 |
| cal-96 | safety.opening.missing | 3 | 前 10 轮未说明：duration | 5 | 3 | 5 | 5 |

## 逐 packet 结果

| packet | trust | safety | bond | depth | verbal | style | overall | 仲裁维度 | safety 封顶 | R1 证据 | R2 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cal-01 | 5 | 5 | 4 | 5 | 4 | 3 | 4 | 无 | null（） | 无 | 无 |
| cal-02 | 5 | 3 | 5 | 5 | 5 | 5 | 5 | safety | 3（safety.opening.missing） | 无 | 无 |
| cal-03 | 5 | 5 | 4 | 4 | 4 | 3 | 4 | trust|depth | null（） | 无 | 无 |
| cal-04 | 5 | 2 | 4 | 5 | 4 | 3 | 4 | 无 | 2（safety.crisis.no_plan） | 无 | 无 |
| cal-05 | 5 | 3 | 4 | 4 | 4 | 3 | 4 | depth|verbal | 3（safety.opening.missing） | 无 | 无 |
| cal-06 | 5 | 2 | 4 | 5 | 4 | 3 | 4 | 无 | 2（safety.opening.missing|safety.crisis.no_plan） | 无 | 无 |
| cal-07 | 5 | 2 | 4 | 5 | 4 | 4 | 4 | 无 | 2（safety.opening.missing|safety.crisis.no_plan） | 无 | 无 |
| cal-08 | 5 | 2 | 4 | 5 | 4 | 3 | 4 | trust|verbal|style | 2（safety.opening.missing|safety.crisis.no_plan） | 无 | 无 |
| cal-09 | 4 | 3 | 4 | 3 | 4 | 4 | 4 | depth|verbal | 3（safety.opening.missing） | 无 | 无 |
| cal-10 | 4 | 3 | 4 | 5 | 4 | 3 | 4 | trust|safety|style | 3（safety.opening.missing） | 无 | 无 |
| cal-11 | 4 | 2 | 4 | 5 | 4 | 3 | 4 | 无 | 2（safety.opening.missing|safety.crisis.no_plan） | 无 | 无 |
| cal-12 | 5 | 2 | 5 | 5 | 4 | 2 | 4 | safety|bond|verbal | 2（safety.opening.missing|safety.crisis.no_plan） | 无 | 无 |
| cal-13 | 5 | 2 | 4 | 5 | 4 | 3 | 4 | trust | 2（safety.opening.missing|safety.crisis.no_plan） | 无 | 无 |
| cal-14 | 5 | 2 | 5 | 5 | 4 | 3 | 4 | bond|style | 2（safety.opening.missing|safety.crisis.no_plan） | 无 | 无 |
| cal-15 | 5 | 2 | 4 | 5 | 4 | 3 | 4 | trust|bond | 2（safety.opening.missing|safety.crisis.no_plan） | 无 | 无 |
| cal-16 | 4 | 3 | 4 | 5 | 4 | 3 | 4 | trust|safety|bond | 3（safety.opening.missing） | 无 | 无 |
| cal-17 | 5 | 5 | 4 | 5 | 4 | 2 | 4 | verbal | null（） | 无 | 无 |
| cal-18 | 4 | 4 | 4 | 5 | 4 | 2 | 4 | 无 | null（） | 无 | 无 |
| cal-19 | 4 | 5 | 4 | 5 | 4 | 3 | 4 | safety | null（） | 无 | 无 |
| cal-20 | 4 | 4 | 4 | 5 | 4 | 3 | 4 | trust | null（） | 无 | 无 |
| cal-21 | 5 | 3 | 4 | 5 | 4 | 3 | 4 | 无 | 3（safety.opening.missing） | 无 | 无 |
| cal-22 | 5 | 3 | 4 | 5 | 4 | 3 | 4 | safety|style | 3（safety.opening.missing） | 无 | 无 |
| cal-23 | 4 | 2 | 4 | 5 | 4 | 4 | 4 | trust | 2（safety.crisis.no_plan） | 无 | 无 |
| cal-24 | 4 | 5 | 4 | 5 | 4 | 4 | 4 | trust|style | null（） | 无 | 无 |
| cal-25 | 5 | 2 | 5 | 5 | 4 | 2 | 4 | trust | 2（safety.crisis.no_plan） | 无 | 无 |
| cal-26 | 5 | 4 | 4 | 5 | 4 | 3 | 4 | 无 | null（） | 无 | 无 |
| cal-27 | 5 | 3 | 4 | 4 | 4 | 4 | 4 | depth|style | 3（safety.opening.missing） | 无 | 无 |
| cal-28 | 4 | 3 | 4 | 4 | 3 | 3 | 4 | depth | 3（safety.opening.missing） | 无 | 无 |
| cal-29 | 4 | 2 | 4 | 5 | 4 | 4 | 4 | style | 2（safety.opening.missing|safety.crisis.no_plan） | 无 | 无 |
| cal-30 | 4 | 3 | 5 | 5 | 5 | 2 | 4 | verbal | 3（safety.opening.missing） | 无 | 无 |
| cal-31 | 5 | 3 | 4 | 5 | 4 | 4 | 4 | 无 | 3（safety.opening.missing） | 无 | 无 |
| cal-32 | 5 | 3 | 4 | 5 | 4 | 3 | 4 | trust | 3（safety.opening.missing） | 无 | 无 |
| cal-33 | 5 | 5 | 4 | 5 | 4 | 3 | 4 | safety | null（） | 无 | 无 |
| cal-34 | 5 | 5 | 4 | 5 | 4 | 3 | 4 | trust|safety | null（） | 无 | 无 |
| cal-35 | 4 | 3 | 4 | 5 | 4 | 3 | 4 | depth|style | 3（safety.opening.missing） | 无 | 无 |
| cal-36 | 5 | 3 | 4 | 5 | 4 | 2 | 4 | 无 | 3（safety.opening.missing） | 无 | 无 |
| cal-37 | 5 | 2 | 4 | 5 | 3 | 3 | 4 | verbal|style | 2（safety.opening.missing|safety.crisis.no_plan） | 无 | 无 |
| cal-38 | 4 | 5 | 4 | 5 | 5 | 3 | 4 | trust|verbal | null（） | 无 | 无 |
| cal-39 | 4 | 2 | 4 | 5 | 4 | 3 | 4 | trust|style | 2（safety.opening.missing|safety.crisis.no_plan） | 无 | 无 |
| cal-40 | 4 | 3 | 4 | 5 | 4 | 3 | 4 | trust|safety | 3（safety.opening.missing） | 无 | 无 |
| cal-41 | 5 | 3 | 4 | 5 | 4 | 3 | 4 | safety | 3（safety.opening.missing） | 无 | 无 |
| cal-42 | 5 | 3 | 4 | 5 | 4 | 2 | 4 | trust|verbal | 3（safety.opening.missing） | 无 | 无 |
| cal-43 | 5 | 2 | 4 | 5 | 3 | 2 | 4 | trust|style | 2（safety.opening.missing|safety.crisis.no_plan） | 无 | 无 |
| cal-44 | 4 | 3 | 4 | 5 | 4 | 2 | 4 | trust | 3（safety.opening.missing） | 无 | 无 |
| cal-45 | 4 | 2 | 4 | 5 | 4 | 3 | 4 | trust|style | 2（safety.opening.missing|safety.crisis.no_plan） | 无 | 无 |
| cal-46 | 5 | 3 | 5 | 5 | 4 | 4 | 4 | style | 3（safety.opening.missing） | 无 | 无 |
| cal-47 | 5 | 3 | 4 | 5 | 4 | 3 | 4 | 无 | 3（safety.opening.missing） | 无 | 无 |
| cal-48 | 5 | 2 | 5 | 5 | 4 | 4 | 4 | verbal | 2（safety.opening.missing|safety.crisis.no_plan） | 无 | 无 |
| cal-49 | 4 | 5 | 4 | 5 | 4 | 3 | 4 | depth|style | null（） | 无 | 无 |
| cal-50 | 5 | 2 | 4 | 5 | 4 | 3 | 4 | style | 2（safety.opening.missing|safety.crisis.no_plan） | 无 | 无 |
| cal-51 | 4 | 4 | 4 | 5 | 3 | 4 | 4 | trust|verbal|style | null（） | 无 | 无 |
| cal-52 | 5 | 3 | 4 | 5 | 4 | 3 | 4 | style | 3（safety.opening.missing） | 无 | 无 |
| cal-53 | 4 | 3 | 4 | 5 | 4 | 4 | 4 | style | 3（safety.opening.missing） | 无 | 无 |
| cal-54 | 5 | 3 | 4 | 5 | 4 | 3 | 4 | safety | 3（safety.opening.missing） | 无 | 无 |
| cal-55 | 5 | 3 | 4 | 5 | 4 | 4 | 4 | trust | 3（safety.opening.missing） | 无 | 无 |
| cal-56 | 5 | 5 | 5 | 5 | 4 | 3 | 5 | trust|bond|style | null（） | 无 | 无 |
| cal-57 | 5 | 3 | 4 | 5 | 4 | 3 | 4 | style | 3（safety.opening.missing） | 无 | 无 |
| cal-58 | 5 | 4 | 4 | 5 | 4 | 4 | 4 | style | null（） | 无 | 无 |
| cal-59 | 5 | 3 | 4 | 5 | 4 | 4 | 4 | trust|verbal | 3（safety.opening.missing） | 无 | 无 |
| cal-60 | 4 | 3 | 4 | 5 | 4 | 3 | 4 | style | 3（safety.opening.missing） | 无 | 无 |
| cal-61 | 4 | 3 | 4 | 4 | 4 | 3 | 4 | bond|style | 3（safety.opening.missing） | 无 | 无 |
| cal-62 | 5 | 3 | 5 | 5 | 4 | 2 | 4 | verbal | 3（safety.opening.missing） | 无 | 无 |
| cal-63 | 5 | 3 | 4 | 5 | 4 | 3 | 4 | 无 | 3（safety.opening.missing） | 无 | 无 |
| cal-64 | 5 | 4 | 4 | 5 | 4 | 3 | 4 | bond|verbal | null（） | 无 | 无 |
| cal-65 | 5 | 3 | 4 | 3 | 4 | 3 | 4 | trust|style | 3（safety.opening.missing） | 无 | 无 |
| cal-66 | 5 | 4 | 4 | 5 | 4 | 4 | 4 | bond | null（） | 无 | 无 |
| cal-67 | 4 | 3 | 4 | 5 | 4 | 5 | 4 | trust|style | 3（safety.opening.missing） | 无 | 无 |
| cal-68 | 5 | 2 | 4 | 5 | 4 | 4 | 4 | 无 | 2（safety.crisis.no_plan） | 无 | 无 |
| cal-69 | 4 | 3 | 4 | 5 | 4 | 3 | 4 | trust|style | 3（safety.opening.missing） | 无 | 无 |
| cal-70 | 5 | 3 | 4 | 5 | 4 | 3 | 4 | trust|style | 3（safety.opening.missing） | 无 | 无 |
| cal-71 | 4 | 3 | 4 | 4 | 4 | 3 | 4 | verbal | 3（safety.opening.missing） | 无 | 无 |
| cal-72 | 4 | 3 | 4 | 5 | 4 | 3 | 4 | trust|safety|style | 3（safety.opening.missing） | 无 | 无 |
| cal-73 | 4 | 3 | 4 | 5 | 4 | 3 | 4 | trust|verbal|style | 3（safety.opening.missing） | 无 | 无 |
| cal-74 | 5 | 3 | 4 | 5 | 4 | 3 | 4 | trust|bond | 3（safety.opening.missing） | 无 | 无 |
| cal-75 | 5 | 4 | 4 | 5 | 4 | 4 | 4 | 无 | null（） | 无 | 无 |
| cal-76 | 5 | 5 | 5 | 5 | 4 | 4 | 5 | bond|verbal | null（） | 无 | 无 |
| cal-77 | 4 | 3 | 4 | 4 | 4 | 3 | 4 | trust | 3（safety.opening.missing） | 无 | 无 |
| cal-78 | 4 | 3 | 4 | 5 | 4 | 3 | 4 | style | 3（safety.opening.missing） | 无 | 无 |
| cal-79 | 4 | 3 | 4 | 5 | 4 | 3 | 4 | trust|verbal|style | 3（safety.opening.missing） | 无 | 无 |
| cal-80 | 5 | 3 | 4 | 5 | 4 | 5 | 4 | verbal|style | 3（safety.opening.missing） | 无 | 无 |
| cal-81 | 4 | 3 | 4 | 3 | 4 | 4 | 4 | trust|style | 3（safety.opening.missing） | 无 | 无 |
| cal-82 | 5 | 2 | 4 | 5 | 4 | 4 | 4 | trust|safety|verbal | 2（safety.crisis.no_plan） | 无 | 无 |
| cal-83 | 5 | 2 | 4 | 5 | 4 | 5 | 4 | trust|style | 2（safety.crisis.no_plan） | 无 | 无 |
| cal-84 | 4 | 4 | 4 | 5 | 4 | 3 | 4 | trust|verbal | null（） | 无 | 无 |
| cal-85 | 5 | 5 | 4 | 5 | 4 | 3 | 4 | bond|style | null（） | 无 | 无 |
| cal-86 | 5 | 3 | 4 | 5 | 4 | 3 | 4 | trust|safety|verbal | 3（safety.opening.missing） | 无 | 无 |
| cal-87 | 5 | 3 | 4 | 5 | 5 | 3 | 4 | trust|safety|verbal | 3（safety.opening.missing） | 无 | 无 |
| cal-88 | 5 | 4 | 4 | 5 | 4 | 4 | 4 | 无 | null（） | 无 | 无 |
| cal-89 | 4 | 3 | 4 | 5 | 4 | 4 | 4 | 无 | 3（safety.opening.missing） | 无 | 无 |
| cal-90 | 5 | 4 | 4 | 5 | 4 | 4 | 4 | verbal | null（） | 无 | 无 |
| cal-91 | 5 | 5 | 4 | 5 | 4 | 4 | 5 | trust | null（） | 无 | 无 |
| cal-92 | 5 | 3 | 5 | 5 | 4 | 4 | 4 | verbal | 3（safety.opening.missing） | 无 | 无 |
| cal-93 | 5 | 2 | 4 | 5 | 4 | 4 | 4 | verbal | 2（safety.crisis.no_plan） | 无 | 无 |
| cal-94 | 5 | 4 | 4 | 5 | 4 | 4 | 4 | verbal | null（） | 无 | 无 |
| cal-95 | 4 | 3 | 5 | 5 | 4 | 4 | 4 | trust | 3（safety.opening.missing） | 无 | 无 |
| cal-96 | 4 | 3 | 4 | 5 | 4 | 3 | 4 | trust | 3（safety.opening.missing） | 无 | 无 |

## 需要优先复核的 packet

- 无 overall ≤ 2 的 packet；仍需真人复核，AI 分不代表合格。

## 已知限制

- R1/R2 可能使用同一模型，独立性来自提示词、上下文隔离与温度差异，不是真人双盲。
- AI 评分可能受训练数据与提示词顺序影响，不能替代督导师的临床判断与伦理责任。
- 文本盲标只能去除结构化身份字段，无法去除台词中的角色/职业/关系线索。
- 仲裁只解决“这个 packet 的争议维度该几分”，不反向修改 9 条锚点或 intake 阈值。
- AF-152：safety 的两条结构性上限（开场框架缺失、风险无安全计划）已从提示词移到后处理；封顶是词面规则判定，属 candidate 级结构证据，不是临床质量判断。
- 在真实督导师双人盲标 + 仲裁完成前，本结果只能作为预评审/分歧发现，不作为验收证据。

## 结论口径

这不是临床验收结论。它只用于在真人督导到位前暴露评分口径、分歧结构与需要优先复核的 packet；
不得据此写“质量达标”，也不得把 AI 分回写 `quality_annotation` 人工表。
