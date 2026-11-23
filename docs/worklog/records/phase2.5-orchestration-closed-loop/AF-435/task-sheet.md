---
taskId: AF-435
contextId: phase2.5-orchestration-closed-loop
title: 行为算子 delta 台账补「语料跨版本」版本口径附注（重签发）
type: documentation
status: backlog
baselineRef: 4da75b978f2d1ffdd2b2155ddd55b5bca74fef7e
dependsOn: []
priorTasks: [AF-434, AF-427, AF-428]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T06:24:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/architecture/behavior-operator-delta-ledger-v1.0.md
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
    - docs/worklog/completed/phase2.5/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af435-ledger-version-caveat-2026-11-24.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs worklog verify --strict
    check: 记录包校验 PASS
    threshold: exit=0
---

# 背景

AF-427 台账表三把 `empathy` 实测 88.0% 的原因写成「待核实」。AF-428 取证已定性为跨内核版本混合快照，但台账正文没跟上。原任务 AF-434 因 scope 未覆盖记录包路径，回执预检拒绝冻结，按 `rescope` 语义重签发本单承接（scope 不原地修改）。

# 目标

1. 表三结论 3 改为已定性版本口径（含 `bea5a719` 时间线证据）。
2. 新增「版本口径附注」小节，给三条读表限定与一条补救口径。

# 做法

只改文档 + 落记录包：替换结论 3 的悬案表述，追加附注小节并链接取证文档。

# 成功判据

1. 台账正文不再出现「原因待核实」。
2. `receipt lint` 与 `worklog verify --strict` 均 PASS。
