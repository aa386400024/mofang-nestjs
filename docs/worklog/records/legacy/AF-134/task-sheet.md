---
taskId: AF-134
contextId: phase2.5-ai-proxy-acceptance
title: AF-133 收束修复的 scope 重签发与交付验收（返修任务）
type: fix
status: backlog
baselineRef: 6b4b8baafef92cc2bdedcef28b1696606f071906
dependsOn: [AF-133]
priorTasks: [AF-133, AF-131, AF-130]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-19T15:40:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/auto-practice/counselor/builder/prompt-sections/
    - src/auto-practice/counselor/builder/counselor-prompt-builder.ts
    - src/auto-practice/counselor-agent.service.ts
    - src/auto-practice/practice-runner.service.ts
    - src/auto-practice/session-profile.ts
    - test/auto-practice/counselor-prompt-builder.spec.ts
    - test/auto-practice/practice-runner-decide-turn.spec.ts
    - test/auto-practice/session-profile.spec.ts
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af134-scope-rescope-2026-11-19.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 类型检查 0 error
    threshold: exitCode=0
  - command: pnpm lint
    check: lint 0 error 0 warning
    threshold: exitCode=0
  - command: pnpm exec vitest run test/auto-practice/counselor-prompt-builder.spec.ts
    check: prompt 单测全绿
    threshold: exitCode=0
  - command: pnpm exec vitest run test/auto-practice/practice-runner-decide-turn.spec.ts
    check: 收束判定单测全绿
    threshold: exitCode=0
  - command: pnpm test
    check: 全量回归全绿
    threshold: exitCode=0
  - command: pnpm exec vitest run test/engine-core/boundary.spec.ts
    check: engine-core 边界单测全绿
    threshold: exitCode=0
successCriteria:
  - 以返修任务承接 AF-133 已完成但超出原 scope 的 session-profile 改动
  - AF-134 scope 必须完整覆盖实际改动文件，V7 不再残留
  - 所有闸门复跑真实数字写入 AF-134 交付记录
  - 不新增功能，不改 AF-133 已实现语义，只做 scope 收口与验收
  - legacy prompt 逐字不变与 engine-core 零 diff 必须保持
---
# AF-134 · AF-133 收束修复的 scope 重签发与交付验收（返修）

## 背景

AF-133 已完成实现并通过五项闸门 + 全量回归，但 MiniMax 为危机窗“多留 1 轮风险收束”增加了档案级开关：

- `src/auto-practice/session-profile.ts` 新增 `crisisRiskClosingRound`
- `test/auto-practice/session-profile.spec.ts` 同步 2 处断言

这两个文件不在 AF-133 原任务单 scope 内。AF-133 已进入 `submitted`，按框架规则不能原地改 scope；因此登记本返修任务，以完整 scope 承接并验收这批已完成改动。

## 范围

与 AF-133 实际改动面一致：

- `src/auto-practice/counselor/builder/prompt-sections/`
- `src/auto-practice/counselor/builder/counselor-prompt-builder.ts`
- `src/auto-practice/counselor-agent.service.ts`
- `src/auto-practice/practice-runner.service.ts`
- `src/auto-practice/session-profile.ts`
- 三个定向测试文件
- `docs/worklog/pending/` 与 `docs/worklog/completed/phase2.5/`

## 验收要求

- 不新增功能、不改 AF-133 已实现语义，只承接并验收已完成改动。
- 复跑全部闸门并把真实数字写入交付记录。
- 确认 `git diff --stat HEAD -- src/engine-core` 为空。
- 确认 legacy prompt golden 断言仍通过。
- 提交时只暂存 AF-133/AF-134 产物，不混入 AF-128 的并行改动。
