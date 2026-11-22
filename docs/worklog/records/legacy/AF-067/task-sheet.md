---
taskId: AF-067
contextId: phase2.5-orchestration-closed-loop
title: 回归判定器四态边界回归测试补齐
type: verification
status: backlog
baselineRef: 79a5ee2bf7d213bd74f9a92a44e86909176eec87
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-17T22:58:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - test/auto-practice/
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af067-regression-evaluator-boundary-tests-2026-11-17.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/regression-evaluator-boundary.spec.ts
    check: 新增四态边界用例全绿
    threshold: 0 failed
  - command: pnpm typecheck
    check: 类型检查 0 error
    threshold: 0 error
  - command: pnpm lint
    check: lint 0 error
    threshold: 0 error
successCriteria:
  - 只新增 test/auto-practice/ 下的回归测试，不修改 src/ 生产代码
  - 覆盖 incomparable 四类原因：acceptance 不同、任一批覆盖率低于 0.9、counselorModeId 集合不同、characterSlug 集合不同
  - 覆盖 combined=unknown 的不可比原因
  - 覆盖 regressed 优先于 improved 的综合判定，以及 neutral 方向指标不参与好坏判定
  - 覆盖 REGRESSION_TOL 边界：等于容差为 neutral，超过容差才判定 movement
  - 回执含 gateResults / scopeCheck / contractChecks / backlogItems / deviationTable / reviewVerdict 六组机读字段
  - 不修改 scope 之外的文件，不提交并行工作区里的其他产物
---

# AF-067 · 回归判定器四态边界回归测试补齐

## 背景

WP-K 回归判定器 `src/auto-practice/metrics/regression-evaluator.ts` 是 Phase 2.5 出口质量判读的核心纯函数，现有实现已覆盖四态与 incomparable 保护，但边界分支缺少独立回归测试。本单只补测试，用于锁定“不可比时绝不硬比”的纪律。

## 交付要求

新增 `test/auto-practice/regression-evaluator-boundary.spec.ts`，用最小 `BatchMetricsV1` 夹具构造正负向场景，断言 `verdict`、`reasons`、`items` 与 `movement`。测试必须能在本仓现有 vitest 配置下直接跑，不依赖容器、数据库或网络。

## 边界

- 不改 `src/` 生产代码；
- 不改既有测试文件；
- 不跑 LLM 批次；
- 不提交 `data/batch-reports/**` 等并行产物。
