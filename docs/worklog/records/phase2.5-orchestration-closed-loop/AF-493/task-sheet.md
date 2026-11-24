---
taskId: AF-493
contextId: phase2.5-orchestration-closed-loop
title: AF-478 缓存观测与 paired 重跑收口（单提交）
type: fix
status: backlog
baselineRef: b6520ebe274e438d9b770e00627fdb28ec1b8eec
dependsOn: []
priorTasks: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.2, conventions.md#1.3]
createdAt: 2026-11-25T08:10:00+08:00
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
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-493/
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
    path: docs/worklog/completed/phase2.5/af493-af478-squash-close-2026-11-25.md
    kind: report
gates:
  - command: pnpm lint
    check: lint 0 error
    threshold: 0
  - command: pnpm typecheck
    check: typecheck 0 error
    threshold: 0
successCriteria:
  - 分支 task/AF-493-af478-squash 相对 integrate 只有一个提交，commit trailer 为 AF-493，标题不含其他任务编号。
  - 提交内容等于 AF-478 的 22 个文件 + voice 自洽修复 + RC-2 + AF-493 交付记录。
  - RC-AF-478-2 判定提交 221475aa 的 22 个文件 in-scope，RC-1 保持冻结。
  - PR 通过 required checks 后 squash 合入 integrate，旧 #232、#236 关闭并标注 superseded。
---

## 1. 背景

AF-478 与 AF-481 的提交拆分后，AF-478 分支单独 lint 失败；AF-478 已归档，无法用 AF-478 任务号提交修复。AF-486 尝试收口，但 PR 历史里仍带 AF-478 提交标题，CI 判双任务号。

## 2. 目标

以 AF-493 重建单提交 PR：相对 integrate 只保留一个提交，提交信息只带 AF-493，彻底消除双任务号。

## 3. 口径

- 单提交内容与 AF-486 的 PR 树一致。
- 不改 `src/engine-core`；不重复 AF-481 六处接线。
- 旧 #232、#236 关闭，标注 superseded-by-487。
