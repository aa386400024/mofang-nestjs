---
taskId: AF-341
contextId: phase2.5-orchestration-closed-loop
title: 真人度 tightened 臂八次重复复核
type: verification
status: backlog
baselineRef: 1930636242b03678db2379aec736471294478fee
dependsOn: [AF-340, AF-335]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-23T06:12:00+08:00
deadline: 2026-11-23T07:00:00+08:00
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
    path: docs/worklog/completed/phase2.5/af341-realism-tightened-recheck-2026-11-23.md
    kind: report
  - name: 复核报告
    path: docs/worklog/completed/phase2.5/af341-realism-tightened-recheck-report-2026-11-23.md
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
  - 用 12 轮 long 跑 8 次 tightened（2 人设 × 8 × 12 = 192 次调用），0 失败。
  - 与 AF-335 的 4 次 tightened 对照，判断 2.856170/3.283580 是否稳定。
  - 给出 tightened 与 off 16 的分离区间、在窗计数，以及与 full/shape-capped 的密度差。
  - 不改代码、不改生产 prompt、不调阈值。
---

# AF-341 · 真人度 tightened 臂八次重复复核

AF-335 的 tightened 只有 4 次重复（焦虑 2.856170、回避 3.283580），是当前密度最低的可读候选，但样本不足。本单只补样本，不改代码。

## 边界

- 只跑离线 CLI，不改 src/test、不改生产块、不切模式、不调阈值。
- 原始 JSON 放 gitignored data/phase25-exit/af341-realism-tightened-recheck/。
- 工程复核，不是临床结论。
