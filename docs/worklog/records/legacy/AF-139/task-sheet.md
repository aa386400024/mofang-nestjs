---
taskId: AF-139
contextId: phase2.5-orchestration-closed-loop
title: AI 层面质量收口：收束内容门 + 安全修复轮 + pack 纳危机场 + 复评
type: implementation
status: backlog
baselineRef: ae624f90f4ee3f616416b9994beceadf3e5a3ed7
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-19T18:30:00+08:00
deadline: null
agentRole: orchestrator
priorTasks: [AF-138]
scope:
  files:
    - src/auto-practice/metrics/session-structure-audit.ts
    - src/auto-practice/practice-runner.service.ts
    - src/auto-practice/counselor-agent.service.ts
    - src/auto-practice/counselor/builder/counselor-prompt-builder.ts
    - src/auto-practice/counselor/builder/prompt-sections/crisis-stabilization.ts
    - bin/long-session-acceptance.ts
    - bin/ai-double-blind.ts
    - test/auto-practice/practice-runner-decide-turn.spec.ts
    - test/auto-practice/counselor-prompt-builder.spec.ts
    - docs/worklog/completed/phase2.5/af139-ai-quality-close-2026-11-19.md
    - docs/worklog/pending/phase2.5-README.md
  modules: []
  interfaces: []
artifacts:
  - name: AF-139 交付记录
    path: docs/worklog/completed/phase2.5/af139-ai-quality-close-2026-11-19.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 类型检查 0 错误
    threshold: exit=0
  - command: pnpm lint
    check: lint 0 错误
    threshold: exit=0
  - command: pnpm exec vitest run test/auto-practice/practice-runner-decide-turn.spec.ts test/auto-practice/counselor-prompt-builder.spec.ts test/auto-practice/boundary.spec.ts
    check: runner / prompt / boundary 定向单测全绿
    threshold: exit=0
successCriteria:
  - 常规收束窗内三件套不齐时 runner 挡回继续，齐了才 natural_close，且不改变 af127-v1 审计口径
  - 升级后计划轮安全五组不齐时追加 1 个修复轮，仍不齐以 crisis_safety_incomplete 结束且 status=crisis_ended
  - long-session-acceptance 取样同时纳入 completed 与 crisis_ended
  - 用新批次复跑结构审计与 AI 双盲，报告每一维阈值与证据，不调低 κ 0.40 / style 3.50
  - README §3.2 出口条件④回写真实判定；未达临床验收时明确 ai_proxy_candidate / clinicalAcceptanceEligible=false
---

