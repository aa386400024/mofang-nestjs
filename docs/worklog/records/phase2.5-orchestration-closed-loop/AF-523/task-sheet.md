---
taskId: AF-523
contextId: phase2.5-orchestration-closed-loop
title: AF-521 批次证据与交付记录入库（scope 重签发）
type: documentation
status: backlog
baselineRef: a721af85e6fcd69d0d295da0c7cfae541da2a414
dependsOn: []
priorTasks: [AF-521, AF-522]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3, agent-orchestration/README.md#强制准入]
createdAt: 2026-11-26T09:10:00+08:00
deadline: null
agentRole: orchestrator
riskClass: R1
riskRationale: 只承载已产出文档工件的入库提交；不改业务代码、不重跑批次。AF-522 因 scope 漏列自身记录包被拒，按重签发处理。
gateProfile: full
objective: 修正 AF-522 的 scope 漏列问题，把 AF-521 交付记录与证据、AF-521 记录包、AF-522/AF-523 记录包合并为一次受审计的文档入库提交。
successCriteria:
  - AF-521 交付记录与三份证据 JSON 已随文档提交入库。
  - 提交包含 AF-521 与 AF-522 记录包，不包含任何 src/test/scripts/migration/.env/prompt 改动。
  - git diff --stat HEAD -- src test 与 src/engine-core 为空。
  - 回执七组字段通过 lint，事件链 events verify PASS。
outOfScope:
  - 不重跑批次、不改 AF-521 结论。
  - 不改任何业务代码或配置。
  - 不修改 AF-521 任务单与既有回执。
scope:
  files:
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af521-af393-postfix-batch-2026-11-26.md
    kind: report
  - name: 批次汇总证据
    path: docs/worklog/completed/phase2.5/af521-evidence/summary.json
    kind: dataset
  - name: 24 场批次证据
    path: docs/worklog/completed/phase2.5/af521-evidence/batch-24.json
    kind: dataset
  - name: long 4 场批次证据
    path: docs/worklog/completed/phase2.5/af521-evidence/batch-4.json
    kind: dataset
gates:
  - command: git diff --stat HEAD -- src test
    check: 无源码与测试改动
    threshold: 输出为空
  - command: git diff --stat HEAD -- src/engine-core
    check: 内核零改动
    threshold: 输出为空
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件链一致
    threshold: PASS
---

# AF-523 · AF-521 批次证据与交付记录入库（scope 重签发）

## 1. 背景

AF-522 负责把 AF-521 归档后遗留的交付记录与证据入库。文档提交 `06b4f09b` 已完成，但 AF-522 的 `scope.files` 漏列自身记录包与 AF-521 记录包，验收把提交内记录文件判为越界并拒绝归档。本任务按 `task reissue` 重签发，scope 覆盖整个 `docs/worklog/records/phase2.5-orchestration-closed-loop/`，不修改既有任务与提交内容。

## 2. 范围

- 确认 `06b4f09b` 的九份文档工件。
- 把 AF-522 与 AF-523 记录包一起纳入本任务收口。
- 不改代码、配置与批次结论。
