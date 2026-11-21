---
taskId: AF-247
contextId: phase2.5-orchestration-closed-loop
title: AF-245 CI 全量 typecheck 修复（AF-246 重签发）
type: fix
status: backlog
baselineRef: 83fc29905a6fd85a91e60e0123dac3d227eb1c36
dependsOn: [AF-245]
priorTasks: [AF-245]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-22T06:40:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - bin/
    - test/auto-practice/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af247-ci-typecheck-fix-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/af245-persona-delta.spec.ts
    check: 定向单测全绿
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm exec tsc --noEmit -p tsconfig.json
    check: CI 全量 typecheck 0 error
    threshold: exit=0
  - command: pnpm test
    check: 全量单测全绿
    threshold: exit=0
---

# AF-247 · AF-245 CI 全量 typecheck 修复（AF-246 重签发）

## 背景

AF-245 已归档，PR #94 的 `Lint + Typecheck` 失败。AF-246 已修复并归档，但任务单登记时漏写 `priorTasks: [AF-245]`，导致 `pr-release create` 拒绝 AF-246 分支携带 AF-245 提交。AF-246 未合并、未开 PR，按链规则用新任务重签发，保持 AF-245 原提交与证据不动。

## 目标

- 修正 AF-245 遗留的三处 CI 类型错误：
  - `RealismDimension` 从 `visitor-realism-rating.js` 导入；
  - `score.dimensions[dimension]` 恢复强类型；
  - `Object.fromEntries + as` 换成显式字面量构造。
- 测试维度断言改索引访问，并处理 eslint `dot-notation` 与 tsconfig `noPropertyAccessFromIndexSignature` 的冲突。
- 用 CI 同口径 `tsc --noEmit -p tsconfig.json` 验证 0 error。

## 非目标

- 不改审计逻辑、不重跑数据、不调整 AF-245 结论。
- 不碰 `src/engine-core`，不改 CI workflow。

## 验收

- 定向 2/2；lint 0 error；CI 同口径 tsc 0 error；全量测试全绿。
- AF-247 PR 携带 AF-245 链提交，PR #94 被关闭。
- AF-246 保持已归档但未合并，作为失败的重签发前身记录在案。
