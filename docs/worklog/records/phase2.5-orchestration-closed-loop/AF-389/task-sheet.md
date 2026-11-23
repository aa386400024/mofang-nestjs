---
taskId: AF-389
contextId: phase2.5-orchestration-closed-loop
title: Phase2.5 出口基线与真实库口径重写
type: documentation
status: backlog
baselineRef: e57eb33190d66b7026c2ff71bc7e12eb7c351e38
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3, agent-orchestration/README.md#强制准入]
createdAt: 2026-11-23T22:52:00+08:00
deadline: null
agentRole: orchestrator
riskClass: R1
riskRationale: 仅重写 Phase2.5 文档基线，不触碰源码、测试、CI、数据库与运行配置。
gateProfile: light
objective: 把 Phase2.5 README 与 WP 清单中过时的出口⑤/总览口径，按当前 MySQL 实查数字重新基线化，并记录最新有效批次指标与文档漂移项。
successCriteria:
  - README §3.2 出口表 ⑤ 改为当前实查数字 491 场 / 12,848 轮 / 39 批（25 valid），completed 368 / stagnant 68 / failed 38 / crisis_ended 17。
  - README 新增一节记录本次实查时间、SQL 口径、最新有效批次 `hRW4V44-t43yyty_EyLke` 的 48 场 / 840 轮 / zero_motion 8 / neutral 84.64% 等数字，不改历史小节。
  - 出口⑤缺口按 completed 口径写明 632 场，并说明按 75% 完成率折算约需新增 843 场；不把 total 口径与 completed 口径混写。
  - WP 清单顶部状态与核对日期更新；不改写各 WP 历史交付结论。
  - 明确标注第二家 provider 已接入、README 旧“待采购 key”口径已过时；不宣称临床质量达标。
  - 交付记录含 gateResults / scopeCheck / contractChecks / backlogItems / deviationTable / reviewVerdict 六组机读标记。
  - src / test / bin / engine-core / admin-dashboard / 数据库零改动。
outOfScope:
  - 不重跑任何练习批次，不调用 LLM，不写数据库。
  - 不修改历史 §3.2.1–§3.2.21 的结论与数字。
  - 不把 AI 代理分数写成临床达标。
  - 不改 WP 清单中各 WP 的历史交付状态。
---

# AF-389 · Phase2.5 出口基线与真实库口径重写

## 1. 背景

Phase2.5 README 与 WP 清单最后一次正式基线停在 2026-11-19/11-20（AF-177）。当前 MySQL 实查已变为 491 场 / 12,848 轮 / 39 批，completed 368 场；README 仍写 111 场 / 1877 轮 / completed 60，缺口 940 场。11-21 最新的有效批次 `hRW4V44-t43yyty_EyLke` 还暴露了 `zero_motion 8/48` 与 `neutral 84.64%` 的当前质量风险。文档口径不重写，后续任何“还差多少”“能不能放量”的判断都会算错。

本单只做文档基线重写与漂移登记，不重跑批次、不改代码、不改历史结论。

## 2. 范围

在范围内：

- `docs/worklog/pending/phase2.5-README.md`
- `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`
- `docs/worklog/completed/phase2.5/`（交付记录）
- `docs/worklog/records/`（记录包）

明确不在范围内：

- 不改 `src/`、`test/`、`bin/`、`admin-dashboard/`、`.env`、migration。
- 不重跑练习批次，不调用 LLM，不写 MySQL / Redis。
- 不改历史 §3.2 小节里的既有判定。

## 3. 交付物

- README §3.2 出口表现状更新（⑤ 与文档漂移说明）。
- README 新增“2026-11-23 真实库基线”小节，含查询时间、SQL 口径、批次指标。
- WP 清单顶部状态更新。
- 本单交付记录与回执。

## 4. 红线

- 单一真相源：本次数字只来自只读 SQL 查询，不复算、不估算；估算值必须显式标注“按 75% 完成率折算”。
- 不改历史结论，不把 AI 代理预评审写成临床达标。
- 心理内容不进入文档；只写场次、轮次、事件率、状态计数。

## 5. 闸门

- `git diff --stat HEAD -- src/engine-core` 必须为空。
- `git diff --name-only HEAD` 只含本单文档路径。
- `node scripts/orchestration/cli.mjs events verify` PASS。
- 不跑全量测试：本单零代码改动，文档闸门以路径与内容核对为准。

## 6. 交付记录

`docs/worklog/completed/phase2.5/af389-phase25-baseline-rebaseline-2026-11-23.md`

## 7. 回写清单

- README 出口表与新增基线节。
- WP 清单顶部状态。
- 编排状态面由 CLI 写入。
- 回执六组字段齐全。
