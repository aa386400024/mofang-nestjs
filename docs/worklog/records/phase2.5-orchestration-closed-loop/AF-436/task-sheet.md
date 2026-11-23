---
taskId: AF-436
contextId: phase2.5-orchestration-closed-loop
title: 调试会话落内核指纹（kernelRef）并让台账按版本分组
type: implementation
status: backlog
baselineRef: f89aa09165acda2d403ddad1e9f8c4474e3e1add
dependsOn: []
priorTasks: [AF-427, AF-428, AF-435]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T07:05:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - src/engine-adapters/observability/
    - src/admin-debug/debug-session-record.ts
    - src/admin-debug/debug-session.service.ts
    - test/engine-adapters/
    - scripts/ops/quality/af427-operator-delta-ledger.mjs
    - scripts/orchestration/__tests__/af427-operator-delta-ledger.spec.mjs
    - docs/architecture/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
    - docs/worklog/completed/phase2.5/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af436-kernel-ref-fingerprint-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec vitest run test/engine-adapters/kernel-fingerprint.spec.ts
    check: 指纹单测通过
    threshold: exit=0
  - command: pnpm exec vitest run scripts/orchestration/__tests__/af427-operator-delta-ledger.spec.mjs
    check: 台账单测通过
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
---

# 背景

AF-427 表三把「实测/系数比」当稳定性指标，AF-428 却发现语料是跨内核版本的混合快照——因为**会话落盘没有版本指纹**，谁也无法判断一轮对话到底是哪版 `DELTA_TABLE` 跑出来的。这是 AF-427 backlog B1 的根治项。

# 目标

1. 新增「内核指纹」：用公开 API（`aggregateTurnDelta` 逐事件求 delta）对 13 个算子的有效系数做规范化哈希，得 `kr1-<16位>`；不读内核私有常量，`src/engine-core` 一行不动。
2. 调试会话建档时把指纹写进记录（`kernelRef?: string`），老记录不写（保持向后兼容）。
3. 台账脚本按 `kernelRef` 分组统计语料，新增「版本分布」表；缺指纹的老语料单列 `legacy`。

# 做法

- `src/engine-adapters/observability/kernel-fingerprint.ts`：`computeKernelFingerprint()` + 模块级 `KERNEL_REF` 常量。
- `DebugSessionRecord` 加可选字段，`persistCreate` 写入。
- 台账脚本新增 `byKernelRef` 统计与渲染；单测覆盖指纹格式、稳定性、代表算子系数与 legacy 分组。

# 成功判据

1. 新会话 JSON 带 `kernelRef: "kr1-…"`，老记录仍可解析。
2. 指纹只随有效系数变化：改任一系数 → 指纹变化（单测用等价向量验证）。
3. 台账表四列出 `kr1-…` 与会话/轮次计数，`legacy` 单列。
4. 闸门：定向 vitest 全绿、`pnpm lint` 0 error、`pnpm typecheck` 0 error、engine-core 零 diff。
