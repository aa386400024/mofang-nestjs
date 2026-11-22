---
taskId: AF-345
contextId: phase2.5-orchestration-closed-loop
title: 签名判据 v1 实现与证据闭环（返修）
type: implementation
status: backlog
baselineRef: e91497412a3f0c6d1245f49ef206e4df75229b47
dependsOn: []
priorTasks: [AF-342, AF-344]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-23T07:25:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/shared/realism/
    - bin/visitor-realism-humanization-judge.ts
    - test/shared/realism/
    - docs/worklog/completed/
    - docs/worklog/records/
  modules:
    - visitor-realism
  interfaces: []
artifacts:
  - name: 签名判据实现
    path: src/shared/realism/realism-humanization-judge.ts
    kind: code
  - name: 回验 CLI
    path: bin/visitor-realism-humanization-judge.ts
    kind: code
  - name: 单测
    path: test/shared/realism/realism-humanization-judge.spec.ts
    kind: test
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af344-realism-signature-judge-evidence-2026-11-23.md
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
  - 签名判据 `realism-signature-judge-v1` 落地并有单测覆盖。
  - 零调用回验 7 臂 112 样本，off 误报 0/16、full 签名覆盖 16/16。
  - 交付记录含 gateResults / scopeCheck / contractChecks / backlogItems / deviationTable / reviewVerdict 六组机读标记。
  - 回执引用本单唯一提交，changedFiles 与提交事实一致。
  - 不改 engine-core；不宣称临床有效性。
---

# AF-345 · 签名判据 v1 实现与证据闭环（返修）

AF-342 的实现已通过闸门，但因证据链缺陷被机读 rejected；AF-344 的文档返修又因分支历史包含 AF-342 提交无法通过逐提交门。本单把代码与证据收敛为**一个提交**，以 AF-345 作为唯一交付身份重新闭环。

## 边界

- 代码沿用 AF-342 已验证实现，不做逻辑改动。
- 唯一新增改动为交付证据与编排记录。
- 不重跑模型调用；112 样本回验结果复用 `data/phase25-exit/af342-realism-signature-judge/report.json`。
