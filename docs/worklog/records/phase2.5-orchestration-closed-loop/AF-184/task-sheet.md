---
taskId: AF-184
contextId: phase2.5-orchestration-closed-loop
title: AF-177 迟到回执闭环终态承接（两段提交）
type: implementation
status: backlog
baselineRef: 6319b46802506dc3b9b3e2e79e9b72c0506fa6f3
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T10:05:00Z
deadline: null
agentRole: executor
scope:
  files:
    - bin/long-session-acceptance.ts
    - test/auto-practice/af111-long-session-acceptance.spec.ts
    - docs/worklog/completed/phase2.5/af177-kappa48-2026-11-20.md
    - docs/worklog/completed/phase2.5/af184-af177-late-receipt-two-stage-2026-11-20.md
    - docs/worklog/pending/phase2.5-README.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af184-af177-late-receipt-two-stage-2026-11-20.md
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
  - 以 AF-184 完成 completed/archived 与 durable receipt；验收提交只含交付文档，记录包与归档状态在第二提交落库，避免 records 进入 executor scope
  - 交付记录明确写出口④ AI 六门 4/6 未通过，safety 6 场=2、overall κ=0.295711<0.40 不得翻绿
  - src/engine-core 零 diff，全量测试与 lint/typecheck 真实通过
---

## 背景

AF-183 把本任务 `records/.../manifest.json` 写进 executor scope，触发 `scope-domain-conflict`：records 属编排者资源域，executor 不能声明。

AF-176 的可复用模式是两段提交：验收提交只含交付文档（scope 内），记录包 manifest / 归档状态在验收后的第二个提交落库。AF-184 按此执行。

## 范围

- 不改 `src/engine-core`
- 不重跑 48 场 long 批次
- 不调整 0.40 κ 阈值，不把 AI proxy 写成临床达标
- 验收提交不含 records；记录包与 completed/archived 状态在第二提交
