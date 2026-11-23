---
taskId: AF-413
contextId: phase2.5-orchestration-closed-loop
title: 调试会话原子写 Windows 瞬时占用重试
type: fix
status: backlog
baselineRef: 6a3cdec63d19965023a3e67e45e3c4b8d456e1a2
dependsOn: []
priorTasks: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T04:35:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - src/admin-debug/
    - test/admin-debug/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af413-atomic-write-retry-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec vitest run test/admin-debug/af413-atomic-write-retry.spec.ts test/admin-debug/debug-session-persistence.spec.ts
    check: 原子写重试单测与既有持久化回归全绿
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
successCriteria:
  - 写文件 rename 遇到 Windows 瞬时占用码时进行有限退避重试，其他错误立即抛出
  - 重试次数与退避可单测（注入 rename / sleep 桩），不依赖真实文件系统
  - 既有持久化用例全部保持通过，关闭会话状态可见
  - 不改变存储格式、不改 API 语义、不碰 engine-core
  - lint / typecheck / 定向单测全绿
---

## 背景

AF-412 推送分支时 pre-push 全量测试出现 `debug-session-persistence.spec.ts` 的 `waitFor 超时: 条件在 10000ms 内没成立`（关会话后状态未变 completed）。该用例在 316 个 worker 并行、Windows 文件系统高负载下偶发；`closeSession` 的 `markCompleted` 是 fire-and-forget，一旦 `rename` 遇到目标文件被临时占用（EPERM/EBUSY/EACCES），写失败被吞掉，状态永远停在 active。

## 目标

给原子写的 `rename` 加有限退避重试：只对 Windows 瞬时占用码重试（3 次，10/20/40ms），其他错误立即抛；把重试逻辑抽成可注入纯函数，用桩覆盖成功、重试后成功、重试耗尽、非瞬时错误四条路径；不改存储格式与 API。

## 范围隔离

只改 `src/admin-debug/debug-session-store.ts` 与新增单测、交付记录、记录包；不碰 `src/engine-core`、`src/engine-adapters`、接口层、`.env`、数据库。
