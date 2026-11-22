---
taskId: AF-233
contextId: phase2.5-orchestration-closed-loop
title: 修复 AF-232 CI 全量类型检查暴露的类型错误并补齐发布门
type: fix
status: backlog
baselineRef: badc63033841c83acd3f06b7d3371d97e3d35ec9
dependsOn: [AF-232]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-22T03:20:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - bin/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af233-af232-ci-tsc-fix-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec tsc --noEmit -p tsconfig.json --incremental --tsBuildInfoFile node_modules/.tmp/tcheck-full.tsbuildinfo
    check: CI 同款全量类型检查 0 error
    threshold: exit=0
  - command: pnpm lint
    check: 0 error / 0 warning
    threshold: exit=0
  - command: pnpm vitest run test/auto-practice/af232-visitor-shadow.spec.ts
    check: AF-232 定向单测 16/16
    threshold: exit=0
  - command: pnpm test
    check: 全量测试全绿
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: empty-output
successCriteria:
  - 修复 AF-232 分支在全量 tsc 下暴露的 5 类类型错误，不改变运行行为。
  - CI 同款 tsc、lint、AF-232 定向单测、全量测试全部通过。
  - 不在已归档 AF-232 任务上继续追加实现提交；本任务以叠层方式承接修复。
  - 交付记录与实际闸门数字一致，回执六组字段完整，PR 最终 HEAD 通过编排门。
---

# AF-233 · 修复 AF-232 CI 全量类型检查与发布门

## 背景

AF-232 在归档后跑 CI 同款 `tsc --noEmit -p tsconfig.json` 失败，暴露 `tsconfig.check.json` 未覆盖的类型错误。修复提交直接追加在已归档的 AF-232 分支上，被服务端 Orchestration Gate 判定 `task-not-found`。本任务作为叠层修复任务，承接代码修复与发布门闭环，保留 AF-232 原始提交。

## 范围

- 只修 `bin/visitor-sim-analysis.ts`、`bin/visitor-sim-prompts.ts`、`bin/visitor-sim-shadow.ts` 的类型问题。
- 补 AF-232 交付记录的闸门补充说明，并新增本任务交付记录。
- 不改 `src/engine-core/**`，不碰生产 visitor 链路，不改数据产物。

## 验收

- 全量 tsc 0 error；lint 0 error/warning；AF-232 定向 16/16；全量测试全绿；engine-core diff 为空。
- 分支以 AF-232 归档 HEAD 为基线叠层，PR 逐提交门与最终验收门同时通过。
