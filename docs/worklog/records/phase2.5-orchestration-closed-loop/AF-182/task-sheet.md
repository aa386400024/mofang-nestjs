---
taskId: AF-182
contextId: phase2.5-orchestration-closed-loop
title: AF-177 迟到回执闭环终态承接（干净提交面）
type: implementation
status: backlog
baselineRef: cbdf2768adbec17a6d32fb45c3baee7fa4c52da4
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T09:45:00Z
deadline: null
agentRole: executor
scope:
  files:
    - bin/long-session-acceptance.ts
    - test/auto-practice/af111-long-session-acceptance.spec.ts
    - docs/worklog/completed/phase2.5/af177-kappa48-2026-11-20.md
    - docs/worklog/completed/phase2.5/af182-af177-late-receipt-clean-2026-11-20.md
    - docs/worklog/pending/phase2.5-README.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af182-af177-late-receipt-clean-2026-11-20.md
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
  - 以 AF-182 完成 completed/archived 与 durable receipt；本次提交面只含 AF-182 交付文件，避免 V7 把其他任务记录算作 scope 外残留
  - 交付记录明确写出口④ AI 六门 4/6 未通过，safety 6 场=2、overall κ=0.295711<0.40 不得翻绿
  - src/engine-core 零 diff，全量测试与 lint/typecheck 真实通过
---

## 背景

AF-177 迟到回执被归档 rejected；AF-179/AF-180/AF-181 承接后仍被 acceptance 判 rejected。根因逐层定位：

1. AF-179 `conditional-pass` 不是原因，acceptance 允许 conditional-pass → completed；
2. AF-180 的 `commits` 混入 AF-177 `d0617ca` 与 AF-179 `a0447d0`，跨任务文件域触发 V7；
3. AF-181 的提交 `cbdf276` 顺带带入了 `AF-180/receipt-RC-AF-180-1.json`，该文件不在 AF-181 scope，再次触发 V7。

AF-182 的修复：**只提交 AF-182 自己的交付文件 + README + 编排状态面**，不携带任何其他任务记录；回执 `commits` 只声明这一个干净提交。

## 范围

- 不改 `src/engine-core`
- 不重跑 48 场 long 批次
- 不调整 0.40 κ 阈值，不把 AI proxy 写成临床达标
- 只补任务闭环、交付记录与 durable receipt
