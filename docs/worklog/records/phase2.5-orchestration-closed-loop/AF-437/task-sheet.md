---
taskId: AF-437
contextId: phase2.5-orchestration-closed-loop
title: 内核指纹模块与调试会话 kernelRef 落盘
type: implementation
status: backlog
baselineRef: f89aa09165acda2d403ddad1e9f8c4474e3e1add
dependsOn: []
priorTasks: [AF-427, AF-428]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T07:18:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-adapters/observability/
    - src/admin-debug/debug-session-record.ts
    - src/admin-debug/debug-session.service.ts
    - test/engine-adapters/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-437/
    - docs/worklog/completed/phase2.5/af437-kernel-ref-fingerprint-2026-11-24.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af437-kernel-ref-fingerprint-2026-11-24.md
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

AF-428 证明 `data/debug-sessions` 里 13 场语料是跨内核版本的混合快照，根因是**会话落盘没有任何版本指纹**：拿到一轮 trace 也无法判断它属于哪版 `DELTA_TABLE`。AF-427 台账因此只能判同算子内部相对稳定性。

# 目标

1. 新增 `src/engine-adapters/observability/kernel-fingerprint.ts`：
   - 用引擎公开 API `aggregateTurnDelta` 对 13 个 `CounselorEventKind` 逐事件求有效 delta 向量（不读内核私有常量、不改 `src/engine-core`）；
   - 规范化（键名排序、数值固定 6 位小数）后 sha256，取前 16 位，前缀 `kr1-`；
   - 导出 `KERNEL_FINGERPRINT_SCHEMA`、`FINGERPRINT_EVENT_KINDS`、`computeKernelFingerprint()`、模块级 `KERNEL_REF`。
2. `DebugSessionRecord` 加可选字段 `kernelRef?: string`（老记录不写，解析向后兼容）。
3. `DebugSessionService.persistCreate` 建档时写入 `kernelRef: KERNEL_REF`。
4. 单测 `test/engine-adapters/kernel-fingerprint.spec.ts`：格式 `kr1-` + 16 位十六进制；同输入两次调用相等；`neutral` 全零；`empathy.trust=0.10`、`judgment.trust=-0.12`（与 DELTA_TABLE 一致）；13 个算子都在指纹输入里。

# 做法

- 指纹只依赖公开导出，天然跟随系数变化：改任一系数 → 哈希变（不要写死哈希快照断言，避免内核正常调参就要改测试）。
- 记录字段可选、条件写入，与 `scenarioType` / `encounter` 同一风格。
- 不在 `src/engine-core` 里加任何东西。

# 成功判据

1. 新建调试会话 JSON 带 `kernelRef: "kr1-…"`；旧 JSON 不改也能读。
2. 单测、`pnpm lint`、`pnpm typecheck` 全绿；`git diff --stat HEAD -- src/engine-core` 为空。
3. 交付记录写明闸门真实数字与机器状态。
