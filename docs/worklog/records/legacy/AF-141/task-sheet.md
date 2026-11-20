---
taskId: AF-141
contextId: phase2.5-orchestration-closed-loop
title: AF-140 maxTurns+2 后 stale 断言对齐（practice-runner.spec）
type: fix
status: backlog
baselineRef: 1daecfb6bacc7e3a80c916bf815c36f2115366cf
dependsOn: [AF-140]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-19T22:15:00+08:00
deadline: null
agentRole: executor
priorTasks: [AF-140]
scope:
  files:
    - test/auto-practice/practice-runner.spec.ts
    - docs/worklog/completed/phase2.5/af141-af140-test-scope-2026-11-19.md
    - docs/worklog/pending/af141-af140-test-scope-task-2026-11-19.md
  modules: []
  interfaces: []
artifacts:
  - name: AF-141 交付记录
    path: docs/worklog/completed/phase2.5/af141-af140-test-scope-2026-11-19.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/practice-runner.spec.ts
    check: practice-runner 定向单测全绿
    threshold: exit=0
successCriteria:
  - AF-140 允许 maxTurns+2 后，AF-091 旧用例的 50 轮断言改为 52，且仍断言 engine.turn 调用 52 次
  - 定向 practice-runner 19/19 通过；全量测试不再因该 stale 断言失败
  - 交付记录与回执显式说明该测试文件不在 AF-140 scope、以 AF-141 单独收口
---


