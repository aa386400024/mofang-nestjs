---
taskId: AF-180
contextId: phase2.5-orchestration-closed-loop
title: AF-177 超时迟到回执闭环修复（终态承接）
type: implementation
status: backlog
baselineRef: d0617cad7df4a643390e6676126ab24c3b0ed2bf
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T09:25:00Z
deadline: null
agentRole: executor
scope:
  files:
    - bin/long-session-acceptance.ts
    - test/auto-practice/af111-long-session-acceptance.spec.ts
    - docs/worklog/completed/phase2.5/af177-kappa48-2026-11-20.md
    - docs/worklog/completed/phase2.5/af180-af177-late-receipt-closure-2026-11-20.md
    - docs/worklog/pending/phase2.5-README.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af180-af177-late-receipt-closure-2026-11-20.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm lint
    check: 0 error 0 warning
    threshold: exit=0
  - command: pnpm exec vitest run test/auto-practice/af111-long-session-acceptance.spec.ts
    check: 定向全绿
    threshold: exit=0
  - command: pnpm test
    check: 全量全绿
    threshold: exit=0
successCriteria:
  - AF-177 的 48 packet 分层取样代码与证据原样承接，不重跑批次、不改 κ 数字
  - 以 AF-180 完成 completed/archived 与 durable receipt，修复 AF-177 租约超时被归档 rejected 的闭环缺口
  - 交付记录明确写出口④ AI 六门 4/6 未通过，safety 6 场=2、overall κ=0.295711<0.40 不得翻绿
  - src/engine-core 零 diff，全量测试与 lint/typecheck 真实通过
---

## 背景

AF-177 回执晚于租约，被 `run-once` 归档为 rejected；AF-179 同为承接任务，但回执写 `conditional-pass` 后仍被自动归档为 rejected。终态承接改为 AF-180，回执不再把“质量门未过”与“任务闭环未完成”混为同一 verdict：任务交付本身 passed，出口④ 质量结论在正文显式写 FAIL。

## 范围

- 不改 `src/engine-core`
- 不重跑 48 场 long 批次
- 不调整 0.40 κ 阈值，不把 AI proxy 写成临床达标
- 只补任务闭环、交付记录与 durable receipt
