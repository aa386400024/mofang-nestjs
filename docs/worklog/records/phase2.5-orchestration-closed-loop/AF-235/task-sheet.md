---
taskId: AF-235
contextId: phase2.5-orchestration-closed-loop
title: 修复 squash 归档门被无关在办任务阻断
type: fix
status: backlog
baselineRef: b10bc368cf53545144783dd1f10376e1af64e23b
dependsOn: [AF-234]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-22T03:50:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - scripts/orchestration/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af235-squash-gate-active-task-fix-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排门回归测试全绿
    threshold: exit=0
  - command: pnpm lint
    check: 0 error / 0 warning
    threshold: exit=0
  - command: pnpm exec tsc --noEmit -p tsconfig.json --incremental --tsBuildInfoFile node_modules/.tmp/tcheck-full.tsbuildinfo
    check: CI 同款全量类型检查 0 error
    threshold: exit=0
  - command: pnpm test
    check: 全量测试全绿
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: empty-output
successCriteria:
  - 当 squash 提交标题显式声明一个已归档任务、且该任务有 passed 回执时，即使索引里还有其他在办任务，也按该任务的归档投影恢复 scope。
  - 未显式声明任务号时保持原行为：有其他在办任务就不借归档投影，避免 scope 歧义。
  - 增加回归测试覆盖「AF-234 场景」：归档任务 + 无关在办任务同时存在。
  - 编排门、lint、全量 tsc、全量测试全绿；engine-core 零 diff。
---

# AF-235 · 修复 squash 归档门被无关在办任务阻断

## 背景

AF-234 的 PR 全部 13 项检查通过并 squash 合并为 `b10bc368`，但合并后的 Orchestration Gate 失败：`task-not-found AF-234`。本地复现确认根因在 `task-entry-gate.mjs` 的 `archivedTransition` 条件 `currentEligible.length === 0`。只要索引里还有 AF-229/AF-231 两个无关在办任务，已归档 AF-234 的 squash 提交就无法借用归档投影恢复 scope，即使提交标题显式写了 AF-234、durable 回执也 passed。

## 范围

- 修改 `scripts/orchestration/task-entry-gate.mjs`：显式任务号时允许按该任务恢复归档投影，不受其他在办任务影响。
- 增加 `scripts/orchestration/__tests__/orchestration.spec.mjs` 回归测试。
- 不改 orchestration 其他状态机行为。

## 验收

- 复现场景通过；无显式任务号仍走原保守逻辑。
- 编排测试、lint、全量 tsc、全量测试全绿。
