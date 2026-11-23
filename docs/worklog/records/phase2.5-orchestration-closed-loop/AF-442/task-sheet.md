---
taskId: AF-442
contextId: phase2.5-orchestration-closed-loop
title: 内核指纹落盘与历史记录包占位一并入库
type: implementation
status: backlog
baselineRef: f89aa09165acda2d403ddad1e9f8c4474e3e1add
dependsOn: []
priorTasks: [AF-439, AF-437, AF-436]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T07:40:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-adapters/observability/
    - src/admin-debug/debug-session-record.ts
    - src/admin-debug/debug-session.service.ts
    - test/engine-adapters/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-442/
    - docs/worklog/completed/phase2.5/af442-kernel-ref-fingerprint-2026-11-24.md
    - docs/worklog/completed/phase2.5/af439-kernel-ref-fingerprint-2026-11-24.md
    - docs/worklog/completed/phase2.5/af437-kernel-ref-fingerprint-2026-11-24.md
    - docs/worklog/completed/phase2.5/af438-kernelref-grouping-2026-11-24.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af442-kernel-ref-fingerprint-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec vitest run test/engine-adapters/kernel-fingerprint.spec.ts
    check: 指纹单测通过
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
---

# 背景

AF-437（GUI relay 投递失败被自动闭合）与 AF-438（依赖未满足停在 backlog）在状态面留下了「声明了交付记录路径但文件不存在」的记录包，`worklog verify --strict` 因此阻断每一次提交。AF-439 的实现在提交时同样被阻断（其 scope 不含那两个占位文件）。

# 目标

1. 把内核指纹实现（同 AF-439 设计）与三份记录包占位一并入库，使 verify 恢复 PASS。
2. 占位文件如实写明各自去向（AF-437 → AF-439/AF-442、AF-438 → 由 AF-442 之后的台账分组单承接）。

# 做法

一个提交内包含：指纹模块 + 记录/服务改动 + 单测 + 四份记录文件 + 本单记录包。

# 成功判据

1. `worklog verify --strict` PASS。
2. 定向 vitest 5 passed / lint 0 error / typecheck 0 error / engine-core 零 diff。
