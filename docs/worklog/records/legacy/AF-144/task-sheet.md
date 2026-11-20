---
taskId: AF-144
contextId: phase2.5-orchestration-closed-loop
title: 最终收束独立生成通道与确定性补全
type: implementation
status: backlog
baselineRef: 82911050e23524cf9c10d4af8a275f0f61920251
dependsOn: [AF-140]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-19T22:50:00+08:00
deadline: null
agentRole: executor
priorTasks: [AF-140, AF-141]
scope:
  files:
    - src/auto-practice/counselor-agent.service.ts
    - src/auto-practice/practice-runner.service.ts
    - src/auto-practice/metrics/session-structure-audit.ts
    - test/auto-practice/counselor-final-closing.spec.ts
    - test/auto-practice/practice-runner-final-closing.spec.ts
    - test/auto-practice/practice-runner-decide-turn.spec.ts
    - docs/worklog/pending/af143-final-closing-channel-task-2026-11-19.md
    - docs/worklog/pending/af144-final-closing-channel-task-2026-11-19.md
    - docs/worklog/completed/phase2.5/af143-final-closing-channel-2026-11-19.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af143-final-closing-channel-2026-11-19.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 类型检查零错误
    threshold: exit=0
  - command: pnpm lint
    check: lint 零错误
    threshold: exit=0
  - command: pnpm exec vitest run test/auto-practice/counselor-final-closing.spec.ts test/auto-practice/practice-runner-final-closing.spec.ts test/auto-practice/practice-runner-decide-turn.spec.ts test/auto-practice/counselor-prompt-builder.spec.ts
    check: 收束通道与既有收束断言全部通过
    threshold: exit=0
successCriteria:
  - 到 maxTurns+1 必定触发最终收束，不再依赖拼接文本的 complete 误判
  - 最终收束走独立单轮通道，只喂最近 3 轮摘要，不把长历史当连续对话
  - 最终收束输出若仍缺 summary / takeaway / nextStep，由确定性补全补齐
  - 既有 AF-140 的 finalClosing 断言按新语义更新，不删除覆盖
  - 定向测试与全量测试通过；不调低任何质量阈值
---


