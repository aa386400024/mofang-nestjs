---
taskId: AF-068
contextId: phase2.5-orchestration-closed-loop
title: AF-065 已验收场景透传改动落地
type: implementation
status: backlog
baselineRef: ec345612fac8382acf333c744ca4c60c0a03ff29
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-17T23:10:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/auto-practice/
    - test/auto-practice/
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af068-af065-scenario-type-landing-2026-11-17.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/batch-scenario-type.spec.ts
    check: 场景透传 9 个用例全绿
    threshold: 0 failed
  - command: pnpm typecheck
    check: 类型检查 0 error
    threshold: 0 error
  - command: pnpm lint
    check: lint 0 error
    threshold: 0 error
successCriteria:
  - 把 AF-065 已验收的 scenarioType 透传改动落到当前 integrate：controller 的 BatchBody.scenarioType、parseBatchScenarioType、enqueueBatch 校验与入队透传
  - queue service 的 AutoPracticeJobData.scenarioType 与 processJob 原样透传 runner.run
  - 新增 test/auto-practice/batch-scenario-type.spec.ts，覆盖 exam 透传、缺省不写键、非法值不入队、freeform、队列/worker 透传与缺省
  - 不修改 practice-runner.service.ts、turn-engine.port.ts、审议判定与策略边界、LLM 调用、.env、数据库
  - 回执含 gateResults / scopeCheck / contractChecks / backlogItems / deviationTable / reviewVerdict 六组机读字段
  - 不执行任何 orchestration CLI 写子命令，不自行 commit/push/归档
---

# AF-068 · AF-065 已验收场景透传改动落地

## 背景

AF-065 的交付已被验收，但因 executor 提前归档导致本地 pre-commit 无法提交，代码只留在 `stash@{0}`（commit `7fe02e524fbbb838de9c1727acbc5735df68e664`）。本单把这份已验收改动重新落到 `integrate`，不改语义，只做落地与复验。

## 取回方式

在仓库根只取以下三个路径，不要取 stash 里的 docs/state/scripts：

```text
git checkout 7fe02e524fbbb838de9c1727acbc5735df68e664 -- src/auto-practice/auto-practice.controller.ts src/auto-practice/practice-queue.service.ts test/auto-practice/batch-scenario-type.spec.ts
```

取回后必须核对：`BatchBody.scenarioType`、`parseBatchScenarioType()`、`enqueueBatch()` 先校验再入队、`AutoPracticeJobData.scenarioType`、`processJob()` 透传 `runner.run()`。如果取回内容与 AF-065 交付记录不一致，以交付记录为准做修正。

## 边界

- 只动上述三个代码/测试路径与交付记录、任务单；
- 不改 runner、turn-engine、审议边界、LLM、数据库；
- 不跑真实 LLM 批次；
- 不提交 stash 里的门禁修复与状态面改动。
