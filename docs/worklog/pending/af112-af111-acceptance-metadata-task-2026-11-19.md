---
taskId: AF-112
contextId: phase2.5-long-session-acceptance
title: AF-111 验收元数据修正（回执字段与 LF）
type: documentation
status: backlog
baselineRef: e6ff2efbbac1a875917b39298282b5629cc61da7
dependsOn: []
priorTasks: [AF-111]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-19T00:55:00Z
deadline: null
agentRole: executor
scope:
  files:
    - docs/worklog/pending/af112-af111-acceptance-metadata-task-2026-11-19.md
    - docs/worklog/completed/phase2.5/af112-af111-acceptance-metadata-delivery-2026-11-19.md
    - docs/worklog/completed/phase2.5/af111-long-session-acceptance-delivery-2026-11-19.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af112-af111-acceptance-metadata-delivery-2026-11-19.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs validate --sheet docs/worklog/pending/af112-af111-acceptance-metadata-task-2026-11-19.md
    check: 任务单 schema 通过
    threshold: exitCode=0
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件链与索引投影一致
    threshold: exitCode=0
  - command: git diff --check
    check: 无空白错误与 CR
    threshold: exitCode=0
successCriteria:
  - 修正 AF-111 机读验收的两项元数据缺口：任务单不含 CR、交付记录含 backlogItems 与 reviewVerdict 字面标记
  - 不修改代码、不改临床结论、不把候选口径升为硬门
  - 任务单 validate、events verify、git diff --check 实跑并记录真实退出码
  - 交付记录保留 AF-111 的 tsc/lint/vitest/boundary 证据引用，不重复跑全量
---

## 背景

AF-111 的代码、单测、协议与 README 已提交（`c17d67c`），tsc/lint/定向 vitest/boundary 均实跑绿。但 `run-once` 摄入回执后，机读护栏判为 `rejected`，原因是两项元数据问题，不是实现缺陷：

1. AF-111 任务单包含 CR（Windows CRLF），护栏要求 LF；
2. AF-111 交付记录没有出现 `backlogItems` / `reviewVerdict` 字面字段标记。

按编排规则，已归档任务不再继续写入；本单作为 AF-111 的返修任务（`priorTasks: [AF-111]`），只修元数据，不重写实现，也不改变“候选、不接硬门、出口④仍不可判定”的临床结论。

## 目标

- 新建 LF 任务单与交付记录，满足机读护栏；
- 在 AF-111 交付记录末尾补 `backlogItems` / `reviewVerdict` 两个字段标记，并说明含义（不是修改历史结论）；
- 用 `validate --sheet`、`events verify`、`git diff --check` 留下可复现证据。

## 非目标

- 不修改 `src/auto-practice/metrics/long-session-acceptance.ts`、`bin/long-session-acceptance.ts`、单测或协议；
- 不新增 LLM 批次、不改 intake 阈值、不接硬门；
- 不声称真实督导师盲标已发生，不写“临床质量达标”。
