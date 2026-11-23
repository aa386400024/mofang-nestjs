---
taskId: AF-439
contextId: phase2.5-orchestration-closed-loop
title: 内核指纹模块与调试会话 kernelRef 落盘（AF-437 承接）
type: implementation
status: backlog
baselineRef: f89aa09165acda2d403ddad1e9f8c4474e3e1add
dependsOn: []
priorTasks: [AF-437, AF-427, AF-428]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T07:25:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-adapters/observability/
    - src/admin-debug/debug-session-record.ts
    - src/admin-debug/debug-session.service.ts
    - test/engine-adapters/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-439/
    - docs/worklog/completed/phase2.5/af439-kernel-ref-fingerprint-2026-11-24.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af439-kernel-ref-fingerprint-2026-11-24.md
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
  - command: git diff --stat HEAD -- src/engine-core
    check: 零 diff
    threshold: 空
---

# 背景

AF-428 证明 `data/debug-sessions` 的 13 场语料是跨内核版本的混合快照，根因是会话落盘不带版本指纹。AF-437 原单由 GUI relay 派发时因发送器环境缺陷（Windows PowerShell 子进程 `Get-FileHash` 不可用）判投递失败并被自动闭合归档，本单承接同一实现。

# 目标

1. `src/engine-adapters/observability/kernel-fingerprint.ts`：用公开 API `aggregateTurnDelta` 逐事件求 13 个算子的有效 delta，规范化后 sha256 前 16 位，前缀 `kr1-`；导出 `KERNEL_REF`。
2. `DebugSessionRecord` 加可选字段 `kernelRef?: string`；`persistCreate` 写入。
3. `test/engine-adapters/kernel-fingerprint.spec.ts` 覆盖格式 / 稳定性 / 13 算子齐全 / 代表系数 / 系数变化即哈希变化。

# 做法

详见 `.tmp/af437-design.md` 的技术设计（同一份设计适用于本单）。

# 成功判据

1. 新会话 JSON 带 `kernelRef: "kr1-…"`，老记录可解析。
2. 定向 vitest、`pnpm lint`、`pnpm typecheck` 全绿；`src/engine-core` 零 diff。
3. 交付记录含六组机读字段与真实闸门数字。
