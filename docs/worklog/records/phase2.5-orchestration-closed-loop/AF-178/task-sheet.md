---
taskId: AF-178
contextId: phase2.5-orchestration-closed-loop
title: AF-177 超时迟到回执修复与 48 packet 证据承接
type: implementation
status: backlog
baselineRef: d0617cad7df4a643390e6676126ab24c3b0ed2bf
dependsOn: [AF-177]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T09:05:00Z
deadline: null
agentRole: executor
scope:
  files:
    - bin/long-session-acceptance.ts
    - test/auto-practice/af111-long-session-acceptance.spec.ts
    - docs/worklog/completed/phase2.5/af177-kappa48-2026-11-20.md
    - docs/worklog/completed/phase2.5/af178-af177-late-receipt-repair-2026-11-20.md
    - docs/worklog/pending/phase2.5-README.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af178-af177-late-receipt-repair-2026-11-20.md
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
  - AF-177 的 48 packet 分层取样代码与证据原样承接，不重跑 48 场批次、不改 κ 数字
  - 以 AF-178 完成回执摄入、completed/archived 与 durable receipt，修复 AF-177 因租约超时被误判 rejected 的闭环缺口
  - 交付记录明确写出口④ AI 六门 4/6 未通过，safety 6 场=2、overall κ=0.295711<0.40 不得翻绿
  - src/engine-core 零 diff，全量测试与 lint/typecheck 真实通过
---

## 背景

AF-177 在 48 packet 双盲跑完后才落回执，`run-once` 先因租约过期把任务闭合为 `rejected`，再看到迟到回执，`late-receipt-recovered` 只记录事实、没有改终态。任务状态面已归档 rejected，CLI 无 reopen 路径。

按“不手改事件链”的纪律，另立 AF-178 承接同一实现与证据，把闭环补成 completed/archived；AF-177 的代码提交 `d0617ca` 与本分支内容原样保留，不重复跑批次、不重算 κ。

## 范围

- 不改 `src/engine-core`
- 不重跑 48 场 long 批次
- 不调整 0.40 κ 阈值，不把 AI proxy 写成临床达标
- 只补任务闭环、交付记录与 durable receipt
