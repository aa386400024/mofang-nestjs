---
taskId: AF-124
contextId: phase2.5-long-session-acceptance
title: 返修链 PR、归档回执状态面与 squash 标题规范化
type: fix
status: ready
baselineRef: 799d73fb5fd22e2c2ec78db4a0a9493740cafd5d
dependsOn: []
priorTasks: [AF-123]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-19T03:20:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/ci-task-gate.mjs
    - scripts/orchestration/pr-release.mjs
    - scripts/orchestration/branch-workflow.mjs
    - scripts/orchestration/task-entry-gate.mjs
    - scripts/orchestration/__tests__/orchestration.spec.mjs
    - docs/worklog/pending/
    - docs/worklog/completed/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af124-repair-chain-gate-2026-11-19.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测全绿
    threshold: 0 failed
  - command: pnpm lint
    check: lint 0 error / 0 warning
    threshold: 0 error / 0 warning
  - command: pnpm exec tsc --noEmit -p tsconfig.json --incremental --tsBuildInfoFile node_modules/.tmp/tcheck-full.tsbuildinfo
    check: CI 同口径类型检查 0 error
    threshold: 0 error
successCriteria:
  - pr-release 允许同一分支携带 priorTasks 链内的任务提交，单提交仍只允许一个任务号
  - 归档 durable receipt 更新被识别为编排状态面，不再触发 no-active-task
  - squash 标题剥离任务号后不残留 / / / 分隔符，且只含主任务号
  - 定向单测覆盖三项并有真实退出码证据
---

# AF-124 · 返修链 PR 与状态面门禁修复

## 背景

AF-123 发布时暴露三处框架适配缺口：

1. `pr-release create` 只允许分支出现主任务号；已归档任务返修形成的 `priorTasks` 链无法出 PR。
2. 归档后补写 durable receipt 的提交被 `task-entry-gate` 判为 `no-active-task`，因 durable receipt 不在状态面清单。
3. `buildSquashCommitMessage` 剥离任务号后残留 `/ / /`，合并标题不可读。

## 目标

把三类缺口在编排适配层修掉，并补定向单测；不改变任务状态机语义、不放宽多任务单提交标题、不绕过受保护 PR。

## 硬约束

- 单提交标题仍只能有一个任务号；多任务号继续 fail closed。
- `priorTasks` 只放行任务链内的历史提交，不把任意任务混入 PR。
- durable receipt 只按状态面放行，不放宽业务文件 scope。
- 不触碰 engine-core。

## 验收

`pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` 全绿；`pnpm lint` 0 error / 0 warning；CI 同口径 tsc 0 error；回执六组字段齐全。
