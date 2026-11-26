---
taskId: AF-559
contextId: phase2.5-audit-remediation
title: 移除来访者台词中的括号舞台说明
type: fix
status: backlog
baselineRef: d19fd56a8f567c72d59d551d6bc2c556b04fce2a
riskClass: R2
gateProfile: full
dependsOn: []
priorTasks: [AF-281, AF-459]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3, docs/team/agent-orchestration/README.md]
createdAt: 2026-11-27T01:00:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/shared/realism
    - src/shared/prosody
    - src/engine-adapters/rendering
    - src/auto-practice/semantic
    - test/shared
    - test/auto-practice
    - test/engine-adapters
    - docs/worklog/pending
    - docs/worklog/completed/phase2.5
    - docs/worklog/records/phase2.5-audit-remediation/AF-559
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af559-visitor-stage-direction-2026-11-27.md
    kind: report
gates:
  - command: pnpm exec vitest run test/shared/realism/visitor-stage-direction.spec.ts test/shared/prosody/prosody-text.spec.ts test/auto-practice/wp-j-p1e-semantic-turn-persister.spec.ts
    check: 定向单测全绿
    threshold: exit 0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit 0
  - command: pnpm lint
    check: 0 error 0 warning
    threshold: exit 0
  - command: pnpm test
    check: 全量测试全绿
    threshold: exit 0
successCriteria:
  - 来访者台词中的全角括号舞台说明（如（停顿）（声音很轻）（攥着衣角））在展示、TTS、逐字稿落库前被确定性剥离，不依赖 prompt 自觉
  - 只剥离句首/句末或含动作、神态、语气、停顿线索的括号；普通括号内容不被误删
  - 流式清洗器同时扣住未闭合的全角左括号，避免半截舞台说明漏给前端/TTS
  - 使用 2026-11-26 最近 9 场 284 轮真实数据回归：105 轮命中括号，清洗后 0 轮残留舞台说明
  - 不修改 engine-core；pnpm lint / typecheck / test 全绿
---
