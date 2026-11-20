---
taskId: AF-148
contextId: phase2.5-orchestration-closed-loop
title: AF-147 验收机械门修复与重开
type: fix
status: backlog
baselineRef: 15c25dc2e12c5d5455c27abbafe89351c680904e
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T01:10:00+08:00
deadline: null
agentRole: executor
priorTasks: [AF-147, AF-146, AF-131]
scope:
  files:
    - docs/worklog/pending/af148-af147-acceptance-rework-task-2026-11-20.md
    - docs/worklog/completed/phase2.5/af148-af147-acceptance-close-2026-11-20.md
    - docs/worklog/pending/phase2.5-README.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af148-af147-acceptance-close-2026-11-20.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 类型检查零错误
    threshold: exit=0
  - command: pnpm lint
    check: lint 零错误
    threshold: exit=0
  - command: pnpm exec vitest run test/auto-practice/ai-double-blind.spec.ts test/engine-core/boundary.spec.ts
    check: 定向 28 项全绿
    threshold: exit=0
successCriteria:
  - 只修 AF-147 验收机械门（任务单 CR 与交付记录字段标记），不改 AF-147 代码与结论
  - 新交付记录逐字包含 gateResults / scopeCheck / contractChecks / backlogItems / deviationTable / reviewVerdict 六组标记
  - 任务单与交付记录均为 UTF-8 无 BOM、LF，无 CR
  - 不改 0.40 阈值、不把 5/6 写成 AI 层面达标、不写临床验收达标
  - 代码相对 AF-147 提交零 diff，engine-core 零 diff
---

## 背景

AF-147 实现提交 `15c25dc` 已落地并通过 typecheck / lint / 定向 28 / 全量 3873；但机读验收在 V5 编码门报 `taskSheet: 含 CR`，并在交付记录字段标记门报六组标记缺失，任务被判 rejected。代码与质量结论本身无误，属于**验收材料机械门失败**。

## 交付边界

- 本单只补验收材料：新任务单用 LF，新交付记录包含六组机读字段标记。
- 不修改 AF-147 已归档的 delivery record 与 rejected 证据，保留审计链。
- 不重跑 LLM 校准、不改阈值、不重写 AF-147 的 5/6 未达标结论。
- 代码零改动；引用 AF-147 提交与全量测试证据。
