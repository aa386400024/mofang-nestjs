---
taskId: AF-582
contextId: phase2.5-quality-gates
title: 显式化两处测试超时预算，消除全量并行下的固定 flaky
type: fix
status: backlog
baselineRef: db586a05db0f68d0c092628ee73585f8f5e9d63f
dependsOn: []
priorTasks: [AF-073, AF-581]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-27T23:55:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - test/auto-practice/af073-batch-report-cli.spec.ts
    - test/engine-adapters/wp12-memory-closeout.spec.ts
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-quality-gates/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af582-test-timeout-budget-2026-11-27.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/af073-batch-report-cli.spec.ts test/engine-adapters/wp12-memory-closeout.spec.ts
    check: 两个定向文件全绿
    threshold: exit 0
  - command: pnpm typecheck
    check: 类型检查 0 error
    threshold: exit 0
  - command: pnpm lint
    check: lint 0 error
    threshold: exit 0
  - command: pnpm test
    check: 全量测试全绿
    threshold: exit 0
successCriteria:
  - af073 CLI 用例的 spawnSync 超时与用例超时都显式写为 120s，不低于实测单跑 19s 的 6 倍余量
  - wp12 逐字稿覆盖写用例显式写 60s，不低于实测单跑 8.8s 的 6 倍余量
  - 只改超时预算与注释，不改断言、夹具、业务实现或用例语义
  - 全量并行下两个文件不再出现 30s 固定超时
  - engine-core 零 diff，不新增依赖
objective: 让两处既有测试的超时预算与实际耗时匹配，消除本机全量并行时与代码无关的固定 flaky，恢复 pnpm test 的可信红灯语义
outOfScope:
  - 不优化 CLI 冷启动性能
  - 不改 vitest 全局 testTimeout
  - 不改任何业务代码
constraints:
  - 超时必须仍是挂起探测器，不得改成无限等待或吞异常
  - 注释写清实测耗时与并行放大原因，避免后人误删
  - 不引入 fake timer / mock 子进程，保持真实 CLI 端到端语义
---

## 背景

AF-581 全量门两次运行均只有 5 例失败，全部落在两个既有测试文件的 30s 超时：

- `af073-batch-report-cli.spec.ts`：`spawnSync(..., { timeout: 30_000 })` 拉起 `tsx bin/batch-report.ts`，单跑每例 16–19s，363 文件并行时超过 30s 被杀死，`status` 变 null。
- `wp12-memory-closeout.spec.ts:765`：单跑 8.76s，并行时超过 vitest 默认 30s。

单文件复跑均全绿，证明不是代码回归。本单只把预算改到可解释的余量，保留真实端到端链路与失败可观测性。

## 实现口径

1. `af073`：`spawnSync` timeout 30s → 120s；四个 `it` 第三参显式 120s。
2. `wp12`：目标用例第三参显式 60s。
3. 注释记录实测单跑耗时与并行放大原因。
4. 不改断言、夹具、业务实现、全局 vitest 配置。

## 红线

- 只改两个测试文件。
- `engine-core` 零 diff。
- 不改成无限等待，不用 mock 替换真实 CLI。
