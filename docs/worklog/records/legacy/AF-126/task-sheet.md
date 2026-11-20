---
taskId: AF-126
contextId: phase2.5-ai-proxy-acceptance
title: 长会谈开场知情框架与结束收束纪律
type: implementation
status: backlog
baselineRef: bb46bf48d9658b2deb4b893ca8aca6117f6673c3
dependsOn: [AF-125]
priorTasks: [AF-125]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-19T09:30:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - src/auto-practice/counselor/builder/prompt-sections/opening-framework.ts
    - src/auto-practice/counselor/builder/prompt-sections/close-discipline.ts
    - src/auto-practice/counselor/builder/counselor-prompt-builder.ts
    - test/auto-practice/counselor-prompt-builder.spec.ts
    - docs/worklog/pending/af126-opening-framework-closeout-task-2026-11-19.md
    - docs/worklog/completed/phase2.5/af126-opening-framework-closeout-2026-11-19.md
    - docs/worklog/pending/phase2.5-README.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af126-opening-framework-closeout-2026-11-19.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/counselor-prompt-builder.spec.ts
    check: 定向单测全绿
    threshold: exitCode=0
  - command: pnpm exec tsc --noEmit
    check: 类型检查 0 error
    threshold: exitCode=0
  - command: pnpm lint
    check: lint 0 error / 0 warning
    threshold: exitCode=0
  - command: node scripts/orchestration/cli.mjs validate --sheet docs/worklog/pending/af126-opening-framework-closeout-task-2026-11-19.md
    check: 任务单 schema 通过
    threshold: exitCode=0
successCriteria:
  - 长会话档案（long/standard）下，咨询师 system prompt 新增开场知情框架块，至少覆盖保密与保密例外、设置边界、时长/频率、可暂停与可拒答
  - 开场框架只在长会话档案启用；legacy 档 prompt 逐字不变
  - 长会话收尾纪律新增结构化收束要求：总结本次理解、来访者带走的内容、下一步安排；不得只输出 END 标记
  - 收束要求不强迫拖轮次，不伪造来访者发言，不早于 minTurnsBeforeClose
  - 定向单测覆盖 legacy 不变、long 启用、开场要素齐全、收束三要素齐全
  - 不新跑练习批次，不改 ai-proxy 阈值，不写临床质量达标
---

# AF-126 · 长会谈开场知情框架与结束收束纪律

## 背景

AF-125 用 16 个 long packet 做 AI 代理跨模型预评审，正式判定 AI 层面质量门未达标：

- safety 平均 3.000、最低 2；15/16 场 safety=3，无一场 ≥4；
- style 平均 3.125；14/16 场 style=3；
- 根因不是个别咨询师发挥差，而是产品层缺少开场知情框架与结束收束结构。

台账 `IM-066` 已登记该缺口。本任务负责在咨询师 prompt 层补齐结构，不负责重新评审判定。

## 目标

- 新增开场知情框架纪律块，按 `SessionProfile` 动态启用；
- 扩展长会话收尾纪律，明确要求总结、带走内容、下一步；
- 保证 legacy 档逐字不变；
- 补定向单测；
- 不新跑批次、不改评分阈值、不写“质量达标”。

## 非目标

- 不修改 `ai-double-blind.ts` 的 `ai-proxy-v2` 阈值；
- 不修改 `engine-core`；
- 不重新跑 AF-125 的 16 packet 评分；
- 不把 prompt 改动直接宣称为临床达标。
