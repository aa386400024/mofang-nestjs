---
taskId: AF-399
contextId: phase2.5-orchestration-closed-loop
title: 回执换行归一与记录包哈希修复
type: implementation
status: backlog
baselineRef: b58d64cf958ad83dcc775b9633d25382ba4e95ec
dependsOn: []
priorTasks: [AF-398, AF-397, AF-396]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T01:38:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
    - docs/worklog/pending/archive/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af399-receipt-hash-normalization-2026-11-24.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs worklog verify --strict --state-free
    check: 记录包哈希全绿
    threshold: exit=0
successCriteria:
  - AF-397 / AF-398 回执文件在仓库内以 LF 存储，manifest sha256 与真实字节一致
  - 不放宽校验、不手改回执内容
---

## 背景

AF-397 / AF-398 回执由 PowerShell `Set-Content` 写入 CRLF，`receipt freeze` 记录了 CRLF 哈希；Git 提交把文件归一为 LF，CI `worklog verify --strict --state-free` 报回执哈希不匹配。本任务只做换行归一与 manifest 哈希重算。
