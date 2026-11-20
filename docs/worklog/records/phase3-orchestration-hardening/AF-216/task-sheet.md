---
taskId: AF-216
contextId: phase3-orchestration-hardening
title: CI 逐提交门与两阶段提交对齐：实现提交可凭提交内任务单入场
type: fix
status: backlog
baselineRef: 82e19c7
dependsOn: []
priorTasks: [AF-213, AF-214, AF-215]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, agent-orchestration/README.md#强制准入]
createdAt: 2026-11-21T02:40:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/ci-task-gate.mjs
    - scripts/orchestration/__tests__/ci-task-gate-impl-entry.spec.mjs
    - docs/team/agent-orchestration/cross-machine-single-writer.md
    - docs/worklog/completed/phase3-orchestration/af216-ci-gate-two-phase-commit-2026-11-21.md
  modules:
    - orchestration
  interfaces:
    - evaluateCommitAt
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase3-orchestration/af216-ci-gate-two-phase-commit-2026-11-21.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/ci-task-gate-impl-entry.spec.mjs
    check: 新增四路径单测绿
    threshold: exit=0
  - command: node scripts/orchestration/ci-task-gate.mjs --base 01c3ce8 --head 82e19c7
    check: 本仓真实历史逐提交全通过（三单实现提交不再 no-active-task）
    threshold: ok=true
  - command: pnpm lint
    check: ESLint 0 error
    threshold: exit=0
  - command: pnpm typecheck
    check: 类型检查 0 error
    threshold: exit=0
  - command: pnpm test
    check: 全量回归无新增红
    threshold: exit=0
successCriteria:
  - 实现提交（标题带唯一任务编号、提交内新增该任务的 records 任务单、索引里尚无该任务）可通过逐提交门，reason 标记 impl-entry-from-commit-sheet。
  - 入口严格受限：任务单不在提交内 / taskId 与标题不符 / scope 解析失败，一律仍判 no-active-task。
  - 注入后仍走同一套 scope 判定，越界文件照旧被判 scope-residual。
  - state-plane-only、archived-transition、squash 全生命周期三条既有路径行为不变（既有单测全部保持绿）。
  - 本仓 01c3ce8..82e19c7 真实历史上取证通过，engine-core 零 diff。
---

## 背景

`ci-task-gate.mjs` 对 base..head 每个提交重新读取「该提交 / 其父提交」的任务索引，复用 preflight 的状态机。两阶段提交流程（实现提交 → 回执摄入与归档状态面单独提交）使**实现提交自身的树状态**呈「索引里还没有这个任务」：

- `46179e7`（AF-213 实现）、`6f21391`（AF-214 实现）、`c3e680d`（AF-215 实现）三次实证，逐提交门全部 `no-active-task` 红；
- 本地 Husky 的 preflight 之所以绿，是因为它读**工作区**索引（claim 已写入），而 CI 读**提交内**索引（尚未入库）。

结论：现行两阶段提交规范产出的历史无法通过 PR 的逐提交复核，规范与门禁自相矛盾，必须从判定层消除，而不是靠"把索引塞进实现提交"这种反流程做法绕过。

## 要求

1. 在 `evaluateCommitAt` 增加一条受限入口：标题含唯一任务编号、该提交 diff **新增**了 `docs/worklog/records/<context>/<taskId>/task-sheet.md`、且该任务在提交索引与父索引中都不存在时，从任务单文本解析 scope，构造 `status=submitted` 的任务注入判定池，reason 标记 `impl-entry-from-commit-sheet`。
2. 入口严格受限：任务单不在提交内、taskId 与标题不符、scope 解析失败 → 仍判 `no-active-task`。
3. 注入后沿用同一套 scope 判定，越界照旧 `scope-residual` 红。
4. 既有三条路径（`state-plane-only` / `archived-transition` / squash 全生命周期）行为不变。
5. 单测覆盖四路径，并在真实历史上取证。

## 不做什么

- 不改 preflight（工作区侧已绿，语义不同）；
- 不放宽验收门 `evaluateAcceptanceSnapshot`（PR 最终 HEAD 仍必须 archived + passed durable 回执）；
- 不调整现有提交历史（本单只修门）。
