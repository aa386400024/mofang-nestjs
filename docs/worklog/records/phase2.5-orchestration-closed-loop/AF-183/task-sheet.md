---
taskId: AF-183
contextId: phase2.5-orchestration-closed-loop
title: AF-177 迟到回执闭环终态承接（含记录包 scope）
type: implementation
status: backlog
baselineRef: 6319b46802506dc3b9b3e2e79e9b72c0506fa6f3
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T09:55:00Z
deadline: null
agentRole: executor
scope:
  files:
    - bin/long-session-acceptance.ts
    - test/auto-practice/af111-long-session-acceptance.spec.ts
    - docs/worklog/completed/phase2.5/af177-kappa48-2026-11-20.md
    - docs/worklog/completed/phase2.5/af183-af177-late-receipt-record-scope-2026-11-20.md
    - docs/worklog/pending/phase2.5-README.md
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-183/manifest.json
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-183/task-sheet.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af183-af177-late-receipt-record-scope-2026-11-20.md
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
  - 以 AF-183 完成 completed/archived 与 durable receipt；scope 显式包含本任务记录包 manifest，V7 提交文件域全绿
  - 交付记录明确写出口④ AI 六门 4/6 未通过，safety 6 场=2、overall κ=0.295711<0.40 不得翻绿
  - src/engine-core 零 diff，全量测试与 lint/typecheck 真实通过
---

## 背景

AF-182 干净提交面仍被 V7 判 fail，复算定位只剩一个文件：

`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-182/manifest.json`

`isTaskSheetArtifact` 只豁免本任务 `task-sheet.md`，不豁免同目录 `manifest.json`；scope 未显式列 records 目录，于是记录包 manifest 成为 scope 外提交文件。

AF-183 的修复：把本任务记录包的 `manifest.json` 与 `task-sheet.md` 显式写进 scope，提交面仍只含 AF-183 自己的文件。

## 范围

- 不改 `src/engine-core`
- 不重跑 48 场 long 批次
- 不调整 0.40 κ 阈值，不把 AI proxy 写成临床达标
- 只补任务闭环、交付记录与 durable receipt
