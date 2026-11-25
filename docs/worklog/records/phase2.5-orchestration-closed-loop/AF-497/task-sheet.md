---
taskId: AF-497
contextId: phase2.5-orchestration-closed-loop
title: 缓存观测与 paired 重跑最终单提交合并
type: fix
status: backlog
baselineRef: b6520ebe274e438d9b770e00627fdb28ec1b8eec
dependsOn: []
priorTasks: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.2, conventions.md#1.3]
createdAt: 2026-11-25T08:30:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/llm/
    - src/engine-adapters/rendering/
    - src/admin-debug/
    - src/voice/
    - test/llm/
    - scripts/eval/visitor-register-stability/
    - docs/worklog/records/phase2.5-visitor-register-eval/AF-478/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-497/
    - docs/worklog/completed/phase2.5/
  modules:
    - llm-provider
    - rendering
    - admin-debug
    - voice
    - visitor-register-eval
  interfaces:
    - chat-provider-usage
    - llm-done-usage
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af497-cache-final-2026-11-25.md
    kind: report
gates:
  - command: pnpm lint
    check: lint 0 error
    threshold: 0
  - command: pnpm typecheck
    check: typecheck 0 error
    threshold: 0
successCriteria:
  - 从 integrate 重建单提交，分支名、提交 trailer、PR 标题只带 AF-497。
  - 内容等于 AF-478 的 22 个文件、voice 自洽修复、RC-2 与收口文档。
  - PR 通过 required checks 后 squash 合入 integrate，旧 #232/#236/#237/#238 关闭。
---

## 1. 背景

AF-478 提交拆分导致分支单独 lint 失败；AF-478 已归档不能续用。多次收口都因历史提交标题或分支 slug 带 AF-478 被 CI 判双任务号。最终以 AF-497 从 integrate 重建只带单任务号的单提交分支。

## 2. 口径

- 不改 `src/engine-core`。
- 不重复 AF-481 的六处接线。
- 业务内容与 AF-493 单提交完全一致。
