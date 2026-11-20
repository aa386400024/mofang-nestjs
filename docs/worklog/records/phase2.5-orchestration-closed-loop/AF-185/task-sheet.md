---
taskId: AF-185
contextId: phase2.5-orchestration-closed-loop
title: 出口④ 48 packet 证据与迟到回执闭环统一落库
type: implementation
status: backlog
baselineRef: f4ec502c9f102b0a014ec0b8f7c55ef91d71946b
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T10:20:00Z
deadline: null
agentRole: executor
scope:
  files:
    - bin/long-session-acceptance.ts
    - test/auto-practice/af111-long-session-acceptance.spec.ts
    - docs/worklog/pending/phase2.5-README.md
    - docs/worklog/completed/phase2.5/af177-kappa48-2026-11-20.md
    - docs/worklog/completed/phase2.5/af178-af177-late-receipt-repair-2026-11-20.md
    - docs/worklog/completed/phase2.5/af179-af177-late-receipt-repair-2026-11-20.md
    - docs/worklog/completed/phase2.5/af180-af177-late-receipt-closure-2026-11-20.md
    - docs/worklog/completed/phase2.5/af181-af177-late-receipt-final-2026-11-20.md
    - docs/worklog/completed/phase2.5/af182-af177-late-receipt-clean-2026-11-20.md
    - docs/worklog/completed/phase2.5/af184-af177-late-receipt-two-stage-2026-11-20.md
    - docs/worklog/completed/phase2.5/af185-exit4-evidence-consolidation-2026-11-20.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af185-exit4-evidence-consolidation-2026-11-20.md
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
  - AF-177 的 48 packet 分层取样代码与证据原样落库，不重跑批次、不改 κ 数字
  - 统一提交面只声明完整任务交付文件；scope 显式覆盖历史承接记录，CI 编排门逐提交 scope 校验通过
  - 出口④ AI 六门 4/6 未通过的事实显式保留，safety 6 场=2、overall κ=0.295711<0.40 不得翻绿
  - src/engine-core 零 diff，全量测试与 lint/typecheck 真实通过
---

## 背景

AF-177 因租约迟到被归档 rejected；AF-179/180/181/182/184 的承接提交逐次被 acceptance 或 CI `scope-residual` 拦截。根因不是数据或代码，而是**提交面与任务 scope 不一致**：records 属编排域、历史承接记录未进 scope。

AF-185 把“出口④ 48 packet 证据 + 迟到回执闭环”合并为唯一交付提交：scope 显式列出全部承接交付记录，records/durable 走状态面豁免，避免再拆任务。

## 范围

- 不改 `src/engine-core`
- 不重跑 48 场 long 批次
- 不调整 0.40 κ 阈值，不把 AI proxy 写成临床达标
- 统一落库实现、证据与闭环记录
