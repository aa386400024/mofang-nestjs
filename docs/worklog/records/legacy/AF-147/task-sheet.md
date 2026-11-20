---
taskId: AF-147
contextId: phase2.5-orchestration-closed-loop
title: AI 评分双轨：方法差异探针与同方法 κ 赛道
type: implementation
status: backlog
baselineRef: a2e3a7ed7d4ae68c21b2dc4f3ff204c6b43da0b2
dependsOn: [AF-146]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T09:30:00+08:00
deadline: null
agentRole: executor
priorTasks: [AF-146, AF-131, AF-125]
scope:
  files:
    - src/auto-practice/metrics/ai-double-blind.ts
    - bin/ai-double-blind.ts
    - test/auto-practice/ai-double-blind.spec.ts
    - docs/worklog/pending/af147-kappa-track-task-2026-11-20.md
    - docs/worklog/completed/phase2.5/af147-kappa-track-2026-11-20.md
    - docs/worklog/pending/phase2.5-README.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af147-kappa-track-2026-11-20.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 类型检查零错误
    threshold: exit=0
  - command: pnpm lint
    check: lint 零错误
    threshold: exit=0
  - command: pnpm exec vitest run test/auto-practice/ai-double-blind.spec.ts
    check: 双盲单测全绿
    threshold: exit=0
  - command: pnpm exec vitest run test/engine-core/boundary.spec.ts
    check: engine-core 边界 12 项全绿
    threshold: exit=0
successCriteria:
  - 保留现有 R1 证据优先 / R2 整体叙事 作为方法差异探针，不删现有行为
  - 新增同方法 κ 赛道：R1′/R2′ 使用同一锚点顺序与同一证据优先步骤，只换模型
  - κ 赛道报告独立标注 scoringTrack=kappa，不与方法探针的 κ 混用
  - 现有 16 packet 可直接用 --track kappa 复跑，无需新跑 LLM 批次
  - 不调低 0.40 / 3.50 / safety≥3 任一阈值
---

## 背景

AF-146 的 6 项硬门中唯一失败项是 overall 跨模型 κ 0.351351。AF-131 独立复核指出：现有 R1 证据优先、R2 整体叙事，是**故意不同方法**，用来发现盲点；同一个 κ 又被当“评分员可互换”硬门，测到的是方法差异，不是评分员差异。按 B-1 拆成两条赛道，κ 硬门只在同方法赛道执行。

## 交付边界

- 本单只改评分口径与 CLI，不改咨询师 prompt、不改批次、不重跑 LLM 对练批次。
- 方法探针保持原样；κ 赛道是新增开关，不改默认行为。
- 阈值一律不动；κ 赛道结果只作 `ai_proxy_candidate`。

