---
taskId: AF-290
contextId: phase2.5-orchestration-closed-loop
title: AF-289 验收 scope 修正与 stacked 合并（保留原实现提交）
type: fix
status: backlog
baselineRef: c453f05a1bd7d596e590d87491c9870a4e7bd3a6
dependsOn: []
priorTasks: [AF-289]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, conventions.md#1.3]
createdAt: "2026-11-22T16:45:00+08:00"
deadline: null
agentRole: orchestrator
scope:
  files:
    - bin/visitor-render-smoke.ts
    - docker/grafana/dashboards/mofang-overview.json
    - docs/runbooks/render-telemetry-alerting.md
    - docs/worklog/completed/phase2.5/af289-candidate-cooldown-current-state-2026-11-22.md
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-289/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-290/
    - src/engine-adapters/rendering/llm-render.adapter.ts
    - src/engine-adapters/rendering/render-metrics.telemetry.ts
    - src/engine-adapters/rendering/render-telemetry.port.ts
    - src/shared/infra/metrics/metrics.service.ts
    - test/config/af283-render-alerting.spec.ts
    - test/engine-adapters/af289-candidate-cooldown-state.spec.ts
    - test/shared/infra/metrics/render-telemetry-metrics.spec.ts
  modules: []
  interfaces: []
artifacts:
  - name: AF-289 stacked 合并与验收 scope 修正记录
    path: docs/worklog/completed/phase2.5/af290-af289-acceptance-scope-fix-2026-11-22.md
    kind: report
gates:
  - command: pnpm orchestration:preflight
    check: 任务单在办、scope 覆盖
    threshold: exit=0
successCriteria:
  - 在任务分支保留 AF-289 的三个原始提交，只补 AF-290 任务单与 scope 修正
  - run-once 验收通过并归档
  - PR 最终 HEAD 含 passed durable 回执
---

# AF-290 · AF-289 验收 scope 修正与 stacked 合并（fix）

> 状态：📋 待执行（2026-11-22）
> 原因：AF-289 任务单 frontmatter 缺少 `scope.files`，登记后索引 scope 为空；回执按 commit 事实比对时 11 个实现文件全部被判越界，`run-once` 产出 `rework-proposal AF-289` 并归档为 rejected。
> 处置：按编排规范 §4“已归档任务的未合并 PR 若需返修，登记新任务并从旧 HEAD 切 stacked 分支，保留原提交”，开 AF-290 修正 scope 并完成合并；不 cherry-pick、不改写 AF-289 的证据提交。

## 1. 范围

**在范围内：**
- `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-290/`：本任务单、manifest、durable 回执。
- `docs/worklog/completed/phase2.5/af290-af289-acceptance-scope-fix-2026-11-22.md`：本次 stacked 修正记录。
- AF-289 已提交的 11 个实现文件仅作为 scope 覆盖对象，不再改动代码语义；如需补闸门只跑验证，不改实现。
- 更新 AF-289 交付记录补一段“scope 缺失 → AF-290 修正”的事实说明。

**不在范围内：**
- 不改 `src/engine-core/**`。
- 不 cherry-pick、不 squash 掉 AF-289 的 `b05cb718` / `2ca2432f` / `c453f05a` 三个原始提交。
- 不碰 AF-280/AF-281 未跟踪半成品、`admin-dashboard/`、Flutter。
- 不新增业务功能；MiniMax 评审提出的 P0-1/P0-3 另开任务。

## 2. 验收口径

- 分支从 AF-289 当前 HEAD `c453f05a` 切出，分支名 `task/AF-290-...`，历史保留 AF-289 提交。
- AF-290 任务单 `scope.files` 覆盖 AF-289 全部 11 个改动文件与两份 worklog 路径。
- 回执 `changedFiles.commits` 覆盖 `b05cb718`、`2ca2432f`、`c453f05a` 以及 AF-290 自身提交；`scopeCheck=in-scope`。
- `run-once` 验收通过，状态 `completed` 后归档；durable 回执进入 `AF-290/receipt-RC-AF-290-1.json`。
- PR 13 项 required checks 全绿后 squash 合并，清理分支。

## 3. 红线

- engine-core 零改动。
- 状态面只经 CLI；任务单正文不改写历史。
- 不把 AF-289 的 rejected 事实抹掉：AF-289 记录包保留，AF-290 记录说明返修原因。

## 4. 回复输出约定

报告 stacked 分支 HEAD、AF-290 验收结论、归档数、PR 与 merge SHA。
