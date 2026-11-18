---
taskId: AF-119
contextId: phase2.5-long-session-acceptance
title: AF-117 机读验收返修（scope 与交付记录标记）
type: fix
status: ready
baselineRef: null
dependsOn: []
priorTasks: [AF-117]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-19T02:46:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - bin/ai-double-blind.ts
    - test/auto-practice/ai-double-blind.spec.ts
    - docs/worklog/completed/phase2.5/af117-ci-fix-delivery-2026-11-19.md
    - docs/worklog/completed/phase2.5/af119-ci-fix-acceptance-2026-11-19.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af119-ci-fix-acceptance-2026-11-19.md
    kind: report
gates:
  - command: pnpm exec tsc --noEmit -p tsconfig.json --incremental --tsBuildInfoFile node_modules/.tmp/tcheck-full.tsbuildinfo
    check: CI 全量类型检查 0 error
    threshold: 0 error
  - command: pnpm lint
    check: lint 0 error / 0 warning
    threshold: 0 error / 0 warning
  - command: pnpm exec vitest run test/auto-practice/ai-double-blind.spec.ts test/engine-core/boundary.spec.ts
    check: 26 tests passed
    threshold: 26 passed / 0 failed
successCriteria:
  - AF-117 回执已被机读验收拒绝，原因含 scope 与五组字段标记缺失
  - 本任务只补 scope 与交付记录字段标记，不改代码语义
  - 回执六组字段齐全且机读验收通过
---

# AF-119 · AF-117 机读验收返修

## 背景

AF-117 回执被机读验收拒绝：af117 交付记录不在 scope，且交付记录缺 `scopeCheck` / `contractChecks` / `backlogItems` / `deviationTable` / `reviewVerdict` 字段标记。原 AF-118 因 `dependsOn` 指向 rejected 的 AF-117 被取消，本任务以 `priorTasks` 承接，不再阻断。

## 目标

只做验收面返修：af117 交付记录纳入 scope 并补齐五组字段标记；代码修复保持 `eeecb06` 不变。

## 硬约束

- 不改 AF-117 回执与 AF-116 证据。
- 不重跑 LLM 批次，不扩大代码改动。
- 仍从 AF-117 HEAD stacked，不直推 integrate。

## 验收

AF-119 回执 `reviewVerdict=passed`，机读验收通过并归档；stacked PR 全绿后合并。
