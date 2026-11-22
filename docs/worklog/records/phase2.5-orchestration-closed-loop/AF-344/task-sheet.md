---
taskId: AF-344
contextId: phase2.5-orchestration-closed-loop
title: 签名判据 v1 交付证据返修
type: documentation
status: backlog
baselineRef: e91497412a3f0c6d1245f49ef206e4df75229b47
dependsOn: []
priorTasks: [AF-342]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-23T07:20:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - docs/worklog/completed/
    - docs/worklog/records/
  modules:
    - visitor-realism
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af343-realism-signature-judge-evidence-2026-11-23.md
    kind: report
  - name: 回验报告
    path: docs/worklog/completed/phase2.5/af342-realism-signature-judge-report-2026-11-23.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm lint
    check: 0 error / 0 warning
    threshold: exit=0
  - command: pnpm test
    check: 全量测试全绿
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: 输出为空
    threshold: exit=0
successCriteria:
  - 交付记录必须含 gateResults / scopeCheck / contractChecks / backlogItems / deviationTable / reviewVerdict 六组机读标记。
  - 回执必须引用实现提交 7d1d200c 与本次文档提交，changedFiles 与 commit 事实一致。
  - 任务单工件指针必须落在 records 记录包，不得指向 transport 交接件。
  - 不改任何 src/bin/test 代码；只补交付证据。
---

# AF-344 · 签名判据 v1 交付证据返修

AF-342 的判据实现与回验已完成，但交付记录缺少六组机读标记、任务单指针指向 transport 交接件，导致机读验收 rejected。本单只返修交付证据，不改代码。

## 边界

- 不改 `src/shared/realism/`、`bin/`、`test/` 任何一行。
- 不重跑模型调用；回验数据已归档。
- 归档后 AF-342 保留 rejected 记录，本单作为其返修闭环。

