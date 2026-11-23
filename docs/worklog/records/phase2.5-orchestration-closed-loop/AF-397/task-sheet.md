---
taskId: AF-397
contextId: phase2.5-orchestration-closed-loop
title: AF-396 交付提交链返修（CI 逐提交任务快照补齐）
type: implementation
status: backlog
baselineRef: b58d64cf958ad83dcc775b9633d25382ba4e95ec
dependsOn: []
priorTasks: [AF-396, AF-395, AF-394]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T01:34:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/admin-debug/
    - src/migration/
    - bin/ormconfig.ts
    - src/agent/llm/
    - src/config/envs/
    - .env.example
    - admin-dashboard/src/views/AutoPractice.vue
    - admin-dashboard/src/api/client.ts
    - test/admin-debug/
    - test/agent/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
    - docs/worklog/pending/archive/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af397-debug-tts-history-repair-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec vitest run test/config/wp25-env-example-coverage.spec.ts test/admin-debug/debug-tts.spec.ts test/agent/llm-doubao-usage.spec.ts
    check: 定向用例全绿
    threshold: 全绿
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm test
    check: 全量测试全绿
    threshold: 全绿
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零 diff
    threshold: 空输出
successCriteria:
  - AF-396 的代码、迁移、前端、env 模板、交付记录与回执在单一实现提交中完整保留
  - 实现提交包含 AF-397 记录包任务单，满足 CI 逐提交两阶段入场
  - 状态面归档作为独立提交，不混入实现
  - PR 的 Orchestration Gate 逐提交通过
---

## 背景

AF-396 已完成实现、回执冻结与归档，但 PR #193 的逐提交 Orchestration Gate 失败：AF-395 cherry-pick 提交与 AF-396 实现提交都没在自身提交树里携带任务单与状态快照，CI 判 `no-active-task`。

## 目标

按框架两阶段提交口径返修提交链：非状态面文件压缩为一个实现提交（含 AF-397 任务单，触发 `deriveImplementationTaskFromCommitSheet` 受限入场），状态面归档单独提交，重新走受保护 PR 合并。

## 范围边界

- 不改任何业务代码内容，只重排提交；AF-396 已验收的代码、测试、迁移、前端、env 模板与文档全部保留。
- 不碰 Flutter、生产 `src/voice` 链路与 `src/engine-core`。
- 状态面与实现分开提交。

## 交付记录

`docs/worklog/completed/phase2.5/af397-debug-tts-history-repair-2026-11-24.md`
