---
taskId: AF-499
contextId: phase2.5-orchestration-closed-loop
title: 修复状态锚点回归在 CI 环境被自动禁用导致的 Unit shard 失败
type: fix
status: backlog
baselineRef: ac6d09bbe05bb1eec95ef5abb6f5e44d825c6f55
dependsOn: []
priorTasks: [AF-498]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-25T09:30:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/state-anchor.mjs
    - scripts/orchestration/__tests__/orchestration.spec.mjs
    - scripts/orchestration/__tests__/af498-root-fix.spec.mjs
    - docs/team/agent-orchestration/af498-root-fix.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af499-ci-anchor-portability-2026-11-25.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__
    threshold: 全绿
    check: 编排测试全绿
  - command: CI=true pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    threshold: 全绿
    check: CI 环境下锚点回归通过
successCriteria:
  - ORCH_STATE_ANCHOR=on 显式覆盖 CI 自动禁用，回归测试在 CI 环境下仍能验证锚点播种与恢复
  - AF-498 测试并入既有 spec，避免新增文件改变远端分片构成
---

# AF-499 · 状态锚点 CI 可验证性

## 背景

AF-498 的根因修复提交 `cda0bd9c` 新增了 `af498-root-fix.spec.mjs`，其中锚点回归依赖 `ORCH_STATE_ANCHOR=on` 覆盖 CI 自动禁用。但实现只识别 `off`，CI 分支仍先返回 disabled，导致远端 `CI=true` 下该用例失败；同时新增测试文件改变了 `--shard=2/3` 的文件分配，扩大了远端失败面。

## 范围

只修正状态锚点的显式开启语义，并把 AF-498 回归并入既有 `orchestration.spec.mjs`，删除独立新文件。不改 CI workflow，不改业务代码，不改 `src/engine-core`。

## 验收

- `ORCH_STATE_ANCHOR=on` 在 `CI=true` / `GITHUB_ACTIONS=true` 下仍启用锚点，供测试显式验证。
- 普通 CI 运行（未显式 on）仍不访问本机锚点，不引入写盘副作用。
- `scripts/orchestration/__tests__` 全绿；CI 环境变量下锚点用例通过。
