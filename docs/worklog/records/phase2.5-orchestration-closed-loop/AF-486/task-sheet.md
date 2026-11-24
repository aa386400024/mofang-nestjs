---
taskId: AF-486
contextId: phase2.5-orchestration-closed-loop
title: AF-478 收口：提交自洽、scope 对齐与合入
type: fix
status: backlog
baselineRef: 561385b87234134589a97abb3efaa1c099a99bcc
dependsOn: [AF-478, AF-481, AF-482]
priorTasks: [AF-478, AF-481, AF-482]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.2, conventions.md#1.3]
createdAt: 2026-11-25T08:00:00+08:00
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
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-486/
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
    path: docs/worklog/completed/phase2.5/af486-af478-final-close-2026-11-25.md
    kind: report
gates:
  - command: pnpm lint
    check: lint 0 error
    threshold: 0
  - command: pnpm typecheck
    check: typecheck 0 error
    threshold: 0
successCriteria:
  - AF-478 的 22 个提交文件加 voice 自洽修复全部落在本任务 scope 内，branch、commit trailer 与本任务号一致。
  - voice.service 的 buildLlmDoneUsage 用 LlmUsage 交叉类型承接 cachedTokens，单独检出可过 lint/typecheck。
  - RC-AF-478-2 按提交 221475aa 的 22 个文件判定 in-scope，RC-1 保持冻结。
  - 六个 wiring/observability/agent-llm 文件仍由 AF-481 承接，不在本 PR 中冒领。
  - PR 通过 20 项 required checks 后 squash 合入 integrate，旧 #232 关闭并标注 superseded。
---

## 1. 背景

AF-478 与 AF-481 在同一工作树完成，提交拆分后 AF-478 分支单独检出时 `voice.service.ts` 读取了尚未声明的 `cachedTokens`，`pnpm lint` 报 `no-unsafe-assignment`。同时 AF-478 已归档，无法把自洽修复以 AF-478 任务号提交而不破坏 branch/commit 任务号一致性。

## 2. 目标

以 AF-486 作为收口任务，把 AF-478 的 22 个文件、voice 自洽修复、RC-2 一起提交到 `task/AF-486-...` 分支，开新 PR 取代 #232，通过 required checks 后合入。

## 3. 口径

- 不修改 `src/engine-core`。
- 不重复 AF-481 的六处 wiring/observability/agent-llm 改动。
- RC-1 保持冻结；RC-2 只修正提交 221475aa 的 scope 判定。
- 旧 #232 不直接合并，改为 superseded 关闭。
