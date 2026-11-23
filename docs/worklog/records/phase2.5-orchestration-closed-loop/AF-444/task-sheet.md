---
taskId: AF-444
contextId: phase2.5-orchestration-closed-loop
title: 编排闭环收口：内核指纹与记录包同批入库并对齐状态面
type: implementation
status: backlog
baselineRef: f89aa09165acda2d403ddad1e9f8c4474e3e1add
dependsOn: []
priorTasks: [AF-443, AF-442, AF-439, AF-437, AF-436]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T08:45:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-adapters/observability/
    - src/admin-debug/
    - test/engine-adapters/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-436/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-437/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-438/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-439/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-442/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-443/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-444/
    - docs/worklog/completed/phase2.5/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af444-orchestration-closure-2026-11-24.md
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
  - command: node scripts/orchestration/cli.mjs worklog verify --strict
    check: 记录包无缺文件
    threshold: exit=0
---

# 背景

PR #214（AF-442）在 CI 的 `Orchestration Gate` 中失败，失败点是 `worklog verify --strict`：该分支引入了 AF-436/437/438 三个任务的状态索引条目，却只带入了 AF-442 自己的记录包——三个历史记录包（task-sheet + manifest）与 `af436-*` 占位当时只在本机工作区。同时 AF-443 的补齐提交落在 AF-442 任务链之外，`pr-release` 按「一个 PR 只能承载单任务及其 priorTasks 链」拒绝。

两单的产物在语义上互相引用：AF-442 的完成态需要 AF-443 补齐的占位才让 verify 通过；AF-443 的记录又叠加在 AF-442 的状态提交之上。分两个 PR 各自都会因为缺另一个的记录文件而红。因此需要一个把两者一并收口、且长度覆盖全部残留文件的承接任务。

# 目标

1. 在一个 PR 内让 `worklog verify --strict`、`validate`、`Orchestration Gate` 同时为绿。
2. 保留 AF-442 的指纹实现与其交付记录，不重做实现。
3. 记录包、占位与状态面各自独立提交，不混提。

# 做法

分支自 `integrate` 切出，复用 AF-442（feat + 状态面）与 AF-443（记录包 + 状态面）四个已验提交，本任务只追加第五、第六个提交：本单记录包与最终状态面。

# 成功判据

1. PR 13 项 required checks 全绿，其中 `Orchestration Gate` 对每个提交 PASS。
2. `git diff --stat HEAD -- src/engine-core` 为空。
3. squash 合并进 `integrate` 后本地快进一致。
