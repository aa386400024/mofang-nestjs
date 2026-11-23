---
taskId: AF-443
contextId: phase2.5-orchestration-closed-loop
title: 补齐 AF-436/437/438 记录包占位并复位 verify
type: implementation
status: backlog
baselineRef: f89aa09165acda2d403ddad1e9f8c4474e3e1add
dependsOn: []
priorTasks: [AF-436, AF-437, AF-438, AF-442]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T08:10:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-436/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-437/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-438/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-443/
    - docs/worklog/completed/phase2.5/af436-kernel-ref-fingerprint-2026-11-24.md
    - docs/worklog/completed/phase2.5/af443-record-package-backfill-2026-11-24.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af443-record-package-backfill-2026-11-24.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs worklog verify --strict
    check: 记录包无缺文件
    threshold: exit=0
  - command: node scripts/orchestration/cli.mjs validate
    check: 索引与契约一致
    threshold: exit=0
---

# 背景

AF-436（scope-domain-conflict 取消）、AF-437（GUI relay 投递失败被自动闭合归档）、AF-438（依赖未满足停在 backlog）在状态索引里各自登记了任务单与交付记录路径，但对应的三份记录包目录与 `af436-*` 交付记录文件此前只存在于本机工作区、未随 AF-442 一并入库（AF-442 的 scope 不含它们，`preflight` 判 `scope-residual`）。任一记录包声明路径缺文件，`worklog verify --strict` 与 CI 的 `worklog verify --strict --state-free` 都会红。

# 目标

1. 把 AF-436 / AF-437 / AF-438 三个记录包（task-sheet + manifest）与 `af436-*` 交付记录占位入库。
2. 占位如实写明各自终态原因与承接去向，不粉饰失败。
3. `worklog verify --strict` 与 `validate` 回到 PASS，使后续提交与 CI 不再被记录缺文件阻断。

# 做法

一个提交内包含三个既有记录包目录、`af436-*` 占位、本单记录包与交付记录。不修改任何 `src/`、`scripts/` 代码。

# 成功判据

1. `worklog verify --strict` PASS（活跃=1 归档=411）。
2. `validate` PASS。
3. `git diff --stat HEAD -- src/engine-core` 为空。
