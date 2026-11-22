---
taskId: AF-186
contextId: phase2.5-orchestration-closed-loop
title: 出口④ 证据闭包与提交面收敛
type: implementation
status: backlog
baselineRef: f4ec502c9f102b0a014ec0b8f7c55ef91d71946b
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T17:15:00Z
deadline: null
agentRole: executor
scope:
  files:
    - bin/long-session-acceptance.ts
    - test/auto-practice/af111-long-session-acceptance.spec.ts
    - docs/worklog/pending/phase2.5-README.md
    - docs/worklog/completed/phase2.5/af177-kappa48-2026-11-20.md
    - docs/worklog/completed/phase2.5/af178-af177-late-receipt-repair-2026-11-20.md
    - docs/worklog/completed/phase2.5/af179-af177-late-receipt-repair-2026-11-20.md
    - docs/worklog/completed/phase2.5/af180-af177-late-receipt-closure-2026-11-20.md
    - docs/worklog/completed/phase2.5/af181-af177-late-receipt-final-2026-11-20.md
    - docs/worklog/completed/phase2.5/af182-af177-late-receipt-clean-2026-11-20.md
    - docs/worklog/completed/phase2.5/af184-af177-late-receipt-two-stage-2026-11-20.md
    - docs/worklog/completed/phase2.5/af185-exit4-evidence-consolidation-2026-11-20.md
    - docs/worklog/completed/phase2.5/af186-exit4-legacy-closure-2026-11-20.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af186-exit4-legacy-closure-2026-11-20.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm lint
    check: 0 error 0 warning
    threshold: exit=0
  - command: pnpm exec vitest run test/auto-practice/af111-long-session-acceptance.spec.ts
    check: 定向全绿
    threshold: exit=0
  - command: pnpm test
    check: 全量全绿
    threshold: exit=0
successCriteria:
  - AF-177 的 48 packet 分层取样代码与证据原样落库，不重跑批次、不改 κ 数字
  - 统一提交面只含 scope 文件、本任务任务单与编排状态面；不再携带其他任务 records
  - 出口④ AI 六门 4/6 未通过的事实显式保留，不得翻绿
  - src/engine-core 零 diff，全量测试与 lint/typecheck 真实通过
plannedArtifacts: []
requiredSkills: []
requiredTools: []
outOfScope: []
constraints: []
priorTasks: [AF-177, AF-178, AF-179, AF-180, AF-181, AF-182, AF-184, AF-185]
---

# AF-186 · 出口④ 证据闭包与提交面收敛

AF-185 单提交把历史 records 一并带入，被 V7「按 commit 事实比对」判 scope 外：records 不在 `STATE_PLANE_ARTIFACTS`，只有本任务任务单被排除。

本单在 `f4ec502c9f102b0a014ec0b8f7c55ef91d71946b` 上重建干净提交面：只带代码、交付记录、README、本任务任务单与状态面，不带任何其他任务的 records。质量结论沿用 AF-177，不重跑、不改数字。
