---
taskId: AF-173
contextId: phase2.5-orchestration-closed-loop
title: integrate 编排门历史任务单容错
type: fix
status: backlog
baselineRef: cb262d69c37bae93febf2ab95ff4ddee524c1441
dependsOn: [AF-172]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T11:10:00+08:00
deadline: null
agentRole: orchestrator
priorTasks: [AF-172, AF-171, AF-169, AF-168, AF-164, AF-163]
scope:
  files:
    - scripts/orchestration/
    - docs/worklog/
    - docs/team/agent-orchestration/
  modules: [orchestration, release]
  interfaces:
    - node scripts/orchestration/ci-task-gate.mjs
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af173-integrate-gate-hydration-2026-11-20.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测全绿
    threshold: exit=0
  - command: node scripts/orchestration/ci-task-gate.mjs --base bb46bf48d9658b2deb4b893ca8aca6117f6673c3 --head cb262d69c37bae93febf2ab95ff4ddee524c1441
    check: integrate squash 提交门通过
    threshold: exit=0
successCriteria:
  - integrate push 门不再因历史任务单缺 frontmatter 失败
  - 主任务任务单仍严格解析，缺失即阻断
  - 新增单测覆盖历史任务单容错分支
  - 新 PR 13 项检查全绿后 squash 合并
---

# AF-173 · integrate 编排门历史任务单容错

> 状态：待执行（2026-11-20）
> 执行方：自做（主 AI，orchestrator 角色）
> 仓库：D:\work\Project\backend\mofang-nestjs-af070
> 唯一事实源：integrate cb262d6 Orchestration Gate 日志
> 任务性质：发布门修复
> 改动范围：ci-task-gate 的 squash hydration、单测、交付记录

## 1. 背景

AF-172 的 squash 提交 cb262d6 把 464 份 record bundle 一起入库。push 到 integrate 后，
`ci-task-gate` 在 squash hydration 阶段遍历所有“任务单在本次提交中变化”的归档任务，
把早于 1.1.0 契约、缺 frontmatter 的历史任务单当主任务解析，抛出
`任务单 frontmatter 缺失`，整条门失败。

## 2. 范围

在范围内：

- `scripts/orchestration/ci-task-gate.mjs`：次要任务容错解析。
- `scripts/orchestration/__tests__/orchestration.spec.mjs`：容错分支单测。
- `docs/worklog/`、`docs/team/agent-orchestration/`：交付记录与状态面。

不在范围内：

- 不放宽主任务严格解析。
- 不改 CI required checks 列表、不改分支保护。

## 3. 交付物

- 主任务严格、次要任务容错的 hydration 逻辑。
- 单测与本地 integrate squash 复跑证据。
- AF-173 记录包、交付记录、durable 回执。

## 4. 红线

- 不放宽 `--require-accepted`。
- 不使用 `--no-verify`、不关闭保护。

## 5. 闸门

- 编排单测全绿。
- `ci-task-gate` 对 cb262d6 单提交 PASS。

## 6. 交付记录

`docs/worklog/completed/phase2.5/af173-integrate-gate-hydration-2026-11-20.md`

## 7. 回写清单

- 记录包与回执归档、状态面更新。
- 合并后复核 integrate push 门。
