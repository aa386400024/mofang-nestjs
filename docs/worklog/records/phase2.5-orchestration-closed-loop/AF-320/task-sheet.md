---
taskId: AF-320
contextId: phase2.5-orchestration-closed-loop
title: CI 类型收窄与记录包发布门修复
type: fix
status: backlog
baselineRef: 311a2bce0e5be2f8f2e1091ac9bc9b707af1214a
dependsOn: []
priorTasks: [AF-317]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-23T00:20:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - test/engine-core/af315-bdi-decision-sensitivity.spec.ts
    - docs/worklog/completed/
    - docs/worklog/records/
    - docs/worklog/pending/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af320-ci-type-narrowing-2026-11-23.md
    kind: report
gates:
  - command: pnpm exec vitest run test/engine-core/af315-bdi-decision-sensitivity.spec.ts
    check: AF-315 决策敏感性场景测试
    threshold: exit=0
  - command: pnpm lint
    check: 静态检查
    threshold: exit=0
  - command: pnpm typecheck
    check: 类型检查
    threshold: exit=0
  - command: node scripts/orchestration/cli.mjs worklog verify --strict
    check: 记录包与回执哈希一致
    threshold: exit=0
  - command: pnpm orchestration:preflight
    check: 任务入场门通过
    threshold: exit=0
successCriteria:
  - CI 的类型检查路径与本地 `pnpm typecheck` 对齐验证，AF-315 场景测试不再出现 TS18048。
  - 场景断言语义不变，只做类型收窄，不改变任何临床门槛、系数或策略期望。
  - PR #153 的 Orchestration Gate 与 Lint + Typecheck 全绿，最终 squash 合并进 integrate。
  - 记录包回执哈希与 durable 回执字节一致，`worklog verify --strict` 通过。
---

# AF-320 · CI 类型收窄与记录包发布门修复

## 0. 为什么需要本单

AF-317 的 PR #153 在远端暴露出两个发布门问题：

1. **分支名双任务号**：首版分支 `task/AF-317-af316-receipt-alignment` 被 CI 的 PR 验收门当作任务编号来源，`extractCommitTaskId()` 解析出 `AF-317` 与 `AF-316` 两个编号后抛错。已改用单任务分支 `task/AF-317-receipt-alignment` 重建 PR，不涉及代码。
2. **记录包回执哈希漂移**：AF-316/AF-317 的 durable 回执在归档后为对齐验收口径被修改，记录包 `manifest.json` 仍保存旧 `sha256`，`worklog verify --strict` 报回执哈希不匹配。已按真实字节重算并修正 manifest。
3. **CI 类型检查比本地更宽**：`test/engine-core/af315-bdi-decision-sensitivity.spec.ts` 中 `out.intention` 在 CI 的类型检查里是可选属性，出现 `TS18048`；本地 `pnpm typecheck` 未覆盖同一范围。需要在测试内做显式非空收窄。

前三项都属于发布门修复，不改生产决策逻辑，也不改已经通过的临床场景期望。

## 1. 验收

- `out.intention` 在 AF-315 测试循环中显式非空收窄，运行时语义不变。
- 定向场景测试、`pnpm lint`、`pnpm typecheck` 全绿。
- `worklog verify --strict` 通过，AF-316/AF-317 记录包 manifest 与 durable 回执字节一致。
- PR #153 合并后，AF-316 的 BDI 决策层修复与 AF-317 的验收口径正式进入 `integrate`。

## 2. 非目标

- 不修改 `src/engine-core/**` 的决策逻辑、阈值、系数或事件词表。
- 不重写 AF-316/AF-317 已归档的任务单与历史交付记录。
- 不宣称临床有效性；临床督导复核仍按 AF-317 的 `openQuestions` 独立推进。
