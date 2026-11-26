---
taskId: AF-522
contextId: phase2.5-orchestration-closed-loop
title: AF-521 批次证据与交付记录入库
type: documentation
status: backlog
baselineRef: a721af85e6fcd69d0d295da0c7cfae541da2a414
dependsOn: [AF-521]
priorTasks: [AF-521]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3, agent-orchestration/README.md#强制准入]
createdAt: 2026-11-26T09:00:00+08:00
deadline: null
agentRole: orchestrator
riskClass: R1
riskRationale: 只把 AF-521 已产出的报告与证据文件纳入版本库并提交；不改业务代码、不改状态面、不产生新的 LLM 调用。
gateProfile: full
objective: 在不绕过编排门的前提下，把 AF-521 的交付记录与批次证据文件作为受审计工件提交入库；AF-521 运行态已归档，但工件提交晚于归档，需单独登记 documentation 任务承载。
successCriteria:
  - AF-521 交付记录与三份证据 JSON 全部进入暂存并随本任务提交。
  - 提交内容不改 src/、test/、scripts/、migration、.env、prompt。
  - git diff --stat HEAD -- src test 与 src/engine-core 为空。
  - 回执 artifactRefs 指向的记录与证据文件均存在且哈希稳定。
outOfScope:
  - 不重新跑批次、不改 AF-521 的结论。
  - 不改任何业务代码或配置。
  - 不修改 AF-521 任务单与既有回执内容。
scope:
  files:
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-521/
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

# AF-522 · AF-521 批次证据与交付记录入库

## 1. 背景

AF-521 已按回执完成归档，但交付记录与证据文件当时仍在工作树，未进入提交。直接把这些文件挂在已归档任务下提交会被编排门禁拒绝（completed 任务不得再写实现文件）。本任务只承担这批既有工件的入库，不重跑批次。

## 2. 范围

- 提交 `docs/worklog/completed/phase2.5/af521-af393-postfix-batch-2026-11-26.md` 与 `af521-evidence/` 三份 JSON。
- 随提交携带 AF-521 的记录包（任务单、manifest、冻结回执）。
- 不改任何源码、测试、脚本、配置或批次结论。

## 3. 验收

- 上述文件全部入库且内容与 AF-521 回执清单一致。
- `src` / `test` / `engine-core` diff 为空。
- 事件链 `events verify` PASS。
