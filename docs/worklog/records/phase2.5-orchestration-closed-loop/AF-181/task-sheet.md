---
taskId: AF-181
contextId: phase2.5-orchestration-closed-loop
title: AF-177 迟到回执闭环终态承接（单提交证据域）
type: implementation
status: backlog
baselineRef: 5f0a5ffbf3567a29c648edb1c27635ffbc4df0d6
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T09:35:00Z
deadline: null
agentRole: executor
scope:
  files:
    - bin/long-session-acceptance.ts
    - test/auto-practice/af111-long-session-acceptance.spec.ts
    - docs/worklog/completed/phase2.5/af177-kappa48-2026-11-20.md
    - docs/worklog/completed/phase2.5/af181-af177-late-receipt-final-2026-11-20.md
    - docs/worklog/pending/phase2.5-README.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af181-af177-late-receipt-final-2026-11-20.md
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
  - 以 AF-181 完成 completed/archived 与 durable receipt，修复 AF-177 租约超时被归档 rejected 的闭环缺口
  - 回执 changedFiles.commits 只声明本任务提交，避免把 AF-177/AF-179 的文档域误算进 AF-181 scope
  - 交付记录明确写出口④ AI 六门 4/6 未通过，safety 6 场=2、overall κ=0.295711<0.40 不得翻绿
  - src/engine-core 零 diff，全量测试与 lint/typecheck 真实通过
---

## 背景

AF-177 回执晚于租约被归档 rejected；AF-179/AF-180 承接后仍被 acceptance 判 rejected。根因已定位：回执 `changedFiles.commits` 把 AF-177（d0617ca）、AF-179（a0447d0）的提交一起声明，`checkResidualByCommits` 会把这些提交的文件集与 AF-180 scope 比对，AF-179 的交付记录不在 AF-180 scope，触发 V7 残留 fail。

AF-181 的修复口径：**回执只声明本任务提交**；AF-177 代码提交放在 `artifactRefs.others` 作为历史承接，不参与本任务文件域比对。

## 范围

- 不改 `src/engine-core`
- 不重跑 48 场 long 批次
- 不调整 0.40 κ 阈值，不把 AI proxy 写成临床达标
- 只补任务闭环、交付记录与 durable receipt
