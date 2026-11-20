---
taskId: AF-113
contextId: phase2.5-long-session-acceptance
title: 堵住多任务堆叠 PR 被 squash 后的 scope 折叠缺口
type: fix
status: backlog
baselineRef: c8ad077b933192dfe800a53482974caac8d8aa9b
dependsOn: []
priorTasks: [AF-112]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-19T01:10:00Z
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/pr-release.mjs
    - scripts/orchestration/__tests__/orchestration.spec.mjs
    - docs/team/agent-orchestration/README.md
    - docs/worklog/pending/af113-af112-stacked-squash-guard-task-2026-11-19.md
    - docs/worklog/completed/phase2.5/af113-af112-stacked-squash-guard-delivery-2026-11-19.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af113-af112-stacked-squash-guard-delivery-2026-11-19.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测全绿（含新增堆叠 PR 守卫用例）
    threshold: exitCode=0
  - command: node scripts/orchestration/cli.mjs validate --sheet docs/worklog/pending/af113-af112-stacked-squash-guard-task-2026-11-19.md
    check: 任务单 schema 通过
    threshold: exitCode=0
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件链与索引投影一致
    threshold: exitCode=0
  - command: git diff --check
    check: 无空白错误与 CR
    threshold: exitCode=0
successCriteria:
  - pr-release create 在推送前识别分支上是否混入目标任务之外的提交任务号，发现堆叠即拒绝并给出明确原因
  - 纯状态面提交（无任务号）不误伤，单任务分支不受影响
  - 新增单测覆盖“单任务通过 / 多任务堆叠拒绝 / 状态面豁免”三种场景
  - README 记录该守卫的触发条件与处置口径，避免再次出现 AF-112 的 scope 折叠
---

## 背景

AF-112 的 PR #42 分支上同时存在 AF-111 的实现提交与 AF-112 的元数据修正提交。PR 合并前逐提交门禁按各自任务判定，13 项检查全绿；`pr-release merge` 按框架要求 squash 后，`integrate` 上只剩一个提交，服务端门禁只能按提交标题里的 AF-112 单任务 scope 判定，AF-111 的实现文件（`src/`、`bin/`、`test/`、协议）被算作越界，post-merge Orchestration Gate 报 `scope-residual`。

根因不是实现或证据缺陷，而是发布流程缺少“一个 PR 只能承载一个任务”的前置守卫。逐提交门禁无法在 squash 后保留多任务边界，因此必须在 `pr-release create` 阶段阻断堆叠。

## 目标

- `pr-release create` 在推送分支前扫描 `base..branch` 的提交标题，提取任务号；
- 若出现目标任务号以外的任务号，直接拒绝创建 PR，提示先把前置任务单独合并；
- 纯状态面提交（无任务号）与目标任务的重复提交不阻断；
- 补单测与 README 口径，避免同类折叠再次发生。

## 非目标

- 不改变 `ci-task-gate` 既有逐提交判定语义；
- 不为历史提交 `c8ad077` 伪造状态或改写 `integrate` 历史；
- 不调整 13 项必需检查、分支保护或 L4 冻结动作。
