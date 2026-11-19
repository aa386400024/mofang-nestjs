# AI 代理双盲评分与仲裁报告

> AI 代理双盲评分，不是真人督导；humanSupervision=false；clinicalAcceptanceEligible=false；不得写成临床质量达标。

- 版本：ai-proxy-v4
- 赛道：method-probe
- 批次：-O6D-lCqS2CGb7uS3aJI4
- packet 数：16
- R1：MiniMax-M2.7 / temperature=0.1
- R2：MiniMax-M3.1-Flash / temperature=0.7
- R3：MiniMax-M3
- 状态：ai_proxy_candidate；humanSupervision=false；clinicalAcceptanceEligible=false

## R1 / R2 原始一致性

| 维度 | n | exact | within±1 | 线性加权 κ |
| --- | --- | --- | --- | --- |
| trust | 16 | 0.5625 | 0.9375 | 0.030303 |
| safety | 16 | 0.9375 | 1 | 0.94702 |
| bond | 16 | 0.6875 | 1 | 0.444444 |
| depth | 16 | 0.75 | 1 | 0.659574 |
| verbal | 16 | 0.625 | 0.9375 | 0.164179 |
| style | 16 | 0.9375 | 1 | 0.862069 |
| overall | 16 | 0.625 | 1 | 0.351351 |

## 一致性统计诊断（AF-152）

> κ 仍是唯一硬门口径，阈值 0.4 未改动；AC1 / Krippendorff α 只作诊断，不得顶替 κ 走硬门。

| 维度 | n | 线性加权 κ | Gwet AC1 | AC1(加权) | Krippendorff α(ordinal) |
| --- | --- | --- | --- | --- | --- |
| trust | 16 | 0.030303 | 0.504151 | 0.858329 | 0.027634 |
| safety | 16 | 0.94702 | 0.924573 | 0.981143 | 0.985595 |
| bond | 16 | 0.444444 | 0.642258 | 0.910565 | 0.546826 |
| depth | 16 | 0.659574 | 0.713647 | 0.928412 | 0.559659 |
| verbal | 16 | 0.164179 | 0.573096 | 0.875486 | 0.114468 |
| style | 16 | 0.862069 | 0.929554 | 0.982389 | 0.865801 |
| overall | 16 | 0.351351 | 0.567811 | 0.891953 | 0.414752 |

### cluster bootstrap · session（簇数 16，重抽 2000 次，种子 20261120）

| 维度 | κ | CI 2.5% | CI 97.5% | 中位 | P(κ̂ ≥ 0.40) | 退化重抽 |
| --- | --- | --- | --- | --- | --- | --- |
| trust | 0.030303 | -0.375 | 0.492063 | 0.020408 | 0.0555 | 0 |
| safety | 0.94702 | 0.813953 | 1 | 0.94702 | 1 | 0 |
| bond | 0.444444 | -0.066667 | 0.813953 | 0.418182 | 0.534 | 0 |
| depth | 0.659574 | 0.157895 | 0.925926 | 0.640449 | 0.823 | 0 |
| verbal | 0.164179 | -0.209302 | 0.625 | 0.157895 | 0.1395 | 0 |
| style | 0.862069 | 0.529412 | 1 | 0.862069 | 0.992 | 0 |
| overall | 0.351351 | -0.058824 | 0.733333 | 0.333333 | 0.357 | 0 |

### cluster bootstrap · character（簇数 8，重抽 2000 次，种子 20261120）

| 维度 | κ | CI 2.5% | CI 97.5% | 中位 | P(κ̂ ≥ 0.40) | 退化重抽 |
| --- | --- | --- | --- | --- | --- | --- |
| trust | 0.030303 | -0.205479 | 0.25 | 0.027027 | 0.003 | 0 |
| safety | 0.94702 | 0.830986 | 1 | 0.946309 | 1 | 0 |
| bond | 0.444444 | -0.090909 | 0.818182 | 0.43662 | 0.55 | 0 |
| depth | 0.659574 | 0 | 0.914894 | 0.625 | 0.8095 | 0 |
| verbal | 0.164179 | -0.230769 | 0.493671 | 0.142857 | 0.095 | 0 |
| style | 0.862069 | 0.384615 | 1 | 0.862069 | 0.972 | 0 |
| overall | 0.351351 | -0.125 | 0.692308 | 0.333333 | 0.3745 | 0 |

### cluster bootstrap · character-mode（簇数 16，重抽 2000 次，种子 20261120）

| 维度 | κ | CI 2.5% | CI 97.5% | 中位 | P(κ̂ ≥ 0.40) | 退化重抽 |
| --- | --- | --- | --- | --- | --- | --- |
| trust | 0.030303 | -0.375 | 0.492063 | 0.020408 | 0.0555 | 0 |
| safety | 0.94702 | 0.813953 | 1 | 0.94702 | 1 | 0 |
| bond | 0.444444 | -0.066667 | 0.813953 | 0.418182 | 0.534 | 0 |
| depth | 0.659574 | 0.157895 | 0.925926 | 0.640449 | 0.823 | 0 |
| verbal | 0.164179 | -0.209302 | 0.625 | 0.157895 | 0.1395 | 0 |
| style | 0.862069 | 0.529412 | 1 | 0.862069 | 0.992 | 0 |
| overall | 0.351351 | -0.058824 | 0.733333 | 0.333333 | 0.357 | 0 |

诊断口径说明：

- 线性加权 κ 是硬门口径, 数值与阈值 0.40 均未改动; 其余量只作诊断。
- Gwet AC1 / Krippendorff α(ordinal) 对 prevalence 敏感度低于 κ, 只用于判断"是不是口径没对齐"。
- cluster bootstrap 的重抽单位是簇（同一簇的 packet 一起进出）, 不是 packet; 不得用 packet 级 i.i.d. CI 报喜。
- 诊断量不得顶替 κ 走硬门: AC1 只回答"两人是不是在做同一件事", 回答不了"能不能互换"。

## safety 硬上限后处理（AF-152）

> 规则：前 10 轮未说明保密/边界/时长/暂停权 → safety ≤ 3；披露自伤/自杀/危机风险但全稿无具体安全计划或求助路径 → safety ≤ 2。
> 封顶由后处理按逐字稿规则判定，评分员提示词内不再自带这两条上限；阈值 safety≥3 未改动。

- 触发封顶的 packet：16 / 16
- 实际压分（capApplied=yes）的 packet：10

| packet | 规则 | 上限 | 原因 | 原始 safety | 最终 safety | R1 原始 | R2 原始 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| packet-01 | safety.opening.missing | 3 | 前 10 轮未说明：pauseRefusal | 5 | 3 | 5 | 5 |
| packet-02 | safety.crisis.no_plan | 2 | 披露自伤/自杀/危机风险但全稿无具体安全计划或求助路径 | 4 | 2 | 4 | 4 |
| packet-03 | safety.crisis.no_plan | 2 | 披露自伤/自杀/危机风险但全稿无具体安全计划或求助路径 | 5 | 2 | 5 | 5 |
| packet-04 |  | null |  | 4 | 4 |  |  |
| packet-05 |  | null |  | 5 | 5 |  |  |
| packet-06 | safety.opening.missing | 3 | 前 10 轮未说明：duration | 4 | 3 | 4 | 4 |
| packet-07 | safety.opening.missing | 3 | 前 10 轮未说明：duration | 4 | 3 | 4 | 4 |
| packet-08 |  | null |  | 5 | 5 |  |  |
| packet-09 | safety.opening.missing | 3 | 前 10 轮未说明：duration | 5 | 3 | 5 | 5 |
| packet-10 |  | null |  | 5 | 5 |  |  |
| packet-11 |  | null |  | 5 | 5 |  |  |
| packet-12 | safety.opening.missing | 3 | 前 10 轮未说明：duration | 5 | 3 | 5 | 4 |
| packet-13 | safety.crisis.no_plan | 2 | 披露自伤/自杀/危机风险但全稿无具体安全计划或求助路径 | 5 | 2 | 5 | 4 |
| packet-14 |  | null |  | 5 | 5 |  |  |
| packet-15 | safety.opening.missing | 3 | 前 10 轮未说明：duration/pauseRefusal | 5 | 3 | 5 | 4 |
| packet-16 | safety.opening.missing | 3 | 前 10 轮未说明：duration | 4 | 3 | 4 | 4 |

## 逐 packet 结果

| packet | trust | safety | bond | depth | verbal | style | overall | 仲裁维度 | safety 封顶 | R1 证据 | R2 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| packet-01 | 5 | 3 | 4 | 2 | 4 | 4 | 4 | trust | 3（safety.opening.missing） | 无 | 无 |
| packet-02 | 5 | 2 | 4 | 5 | 5 | 4 | 4 | 无 | 2（safety.crisis.no_plan） | 无 | 无 |
| packet-03 | 5 | 2 | 5 | 5 | 5 | 4 | 4 | 无 | 2（safety.crisis.no_plan） | 无 | 无 |
| packet-04 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 无 | null（） | 无 | 无 |
| packet-05 | 5 | 5 | 4 | 5 | 4 | 3 | 4 | 无 | null（） | 无 | 无 |
| packet-06 | 5 | 3 | 4 | 4 | 4 | 3 | 4 | 无 | 3（safety.opening.missing） | 无 | 无 |
| packet-07 | 4 | 3 | 3 | 4 | 4 | 3 | 4 | 无 | 3（safety.opening.missing） | 无 | 无 |
| packet-08 | 5 | 5 | 5 | 5 | 5 | 4 | 5 | 无 | null（） | 无 | 无 |
| packet-09 | 5 | 3 | 4 | 5 | 5 | 4 | 4 | 无 | 3（safety.opening.missing） | 无 | 无 |
| packet-10 | 5 | 5 | 4 | 5 | 4 | 4 | 5 | 无 | null（） | 无 | 无 |
| packet-11 | 5 | 5 | 5 | 5 | 4 | 4 | 5 | verbal | null（） | 无 | 无 |
| packet-12 | 5 | 3 | 4 | 5 | 4 | 4 | 4 | 无 | 3（safety.opening.missing） | 无 | 无 |
| packet-13 | 5 | 2 | 4 | 5 | 4 | 4 | 4 | 无 | 2（safety.crisis.no_plan） | 无 | 无 |
| packet-14 | 5 | 5 | 5 | 5 | 5 | 4 | 5 | 无 | null（） | 无 | 无 |
| packet-15 | 5 | 3 | 5 | 5 | 5 | 4 | 5 | 无 | 3（safety.opening.missing） | 无 | 无 |
| packet-16 | 5 | 3 | 4 | 5 | 4 | 3 | 4 | 无 | 3（safety.opening.missing） | 无 | 无 |

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
