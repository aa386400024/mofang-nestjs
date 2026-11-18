---
taskId: AF-120
contextId: phase2.5-long-session-acceptance
title: AF-119 回执 scope 事实比对返修
type: fix
status: ready
baselineRef: null
dependsOn: []
priorTasks: [AF-119]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-19T02:48:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - bin/ai-double-blind.ts
    - test/auto-practice/ai-double-blind.spec.ts
    - docs/worklog/completed/phase2.5/af117-ci-fix-delivery-2026-11-19.md
    - docs/worklog/completed/phase2.5/af119-ci-fix-acceptance-2026-11-19.md
    - docs/worklog/completed/phase2.5/af120-ci-fix-scope-2026-11-19.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af120-ci-fix-scope-2026-11-19.md
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
  - AF-119 回执被拒只因 changedFiles.commits 含状态提交，状态提交里的 durable receipt 不在 scope
  - 本任务只修正回执的 commit 事实范围，不改代码与交付内容
  - 回执六组字段齐全且机读验收通过
---

# AF-120 · AF-119 回执 scope 事实比对返修

## 背景

AF-119 `autoVerdict=rejected`：

`scope 外提交文件（已按 commit 事实比对）：docs/worklog/pending/archive/AF-117-receipt-AF-117-1795027195399.json`

根因是 AF-119 回执 `changedFiles.commits` 列入了状态提交 `3d86e1c`；该提交含 durable 回执，不在任务 scope。框架的 commit 事实比对把状态提交也算进来。

## 目标

AF-120 回执只声明代码/文档提交 `eeecb06`、`e412cc1` 与本次交付提交，不把状态提交列入 `changedFiles.commits`；代码与交付内容不变。

## 硬约束

- 不改代码、不改评分/仲裁语义。
- 不改 AF-117/AF-119 已归档回执。
- stacked 分支与 PR base 不变。

## 验收

AF-120 回执 `reviewVerdict=passed`，机读验收通过并归档。
