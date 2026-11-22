---
taskId: AF-239
contextId: phase2.5-orchestration-closed-loop
title: 修复影子实验首 token P95 聚合取最大值
type: fix
status: backlog
baselineRef: fb327f44764833432138fabbaf0b76ba56eefb56
dependsOn: [AF-238]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-22T04:48:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - bin/
    - test/auto-practice/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af239-p95-aggregation-fix-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/af232-visitor-shadow.spec.ts
    check: 定向单测全绿
    threshold: exit=0
  - command: pnpm lint
    check: 0 error / 0 warning
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
successCriteria:
  - 整体 firstTokenP95/totalP95 改为对全部轮次样本取 P95，而不是对单场 P95 取 max。
  - 增加回归测试：两场各含一个慢轮、其余快轮时，整体 P95 不应被单场慢轮抬到 max。
  - 用修复后代码重算 AF-238 r2 E，确认首 token P95 由 2981ms 回到约 900ms。
  - engine-core 零改动。
---

# AF-239 · 修复影子实验首 token P95 聚合取最大值

## 背景

AF-238 发现 `mergeMetrics` 的 `firstTokenP95Ms` / `totalP95Ms` 使用 `Math.max(...items.map(p95))`，把单场 P95 的最大值当作整体 P95。12 场 ×12 轮共 144 轮时，个别慢轮会让整体 P95 虚高。AF-238 r2 E 因此被误判 `first-token-p95` 硬失败：报告 `2981ms`，全局 144 轮重算 `900ms`。

## 目标

整体 P95 按所有会话的全部轮次样本计算；单场指标保持不变。回归测试覆盖“两个慢轮不应决定整体 P95”。

## 范围

- 只改 `bin/visitor-sim-analysis.ts` 与对应测试、交付记录。
- 不改生成、评分、门槛阈值与 prompt。
- 重算 AF-238 r2/r3 报告以验证修复，不改历史数据源。

## 验收

- 单测覆盖聚合 P95 语义。
- 修复后 AF-238 r2 E 首 token P95 与手工全局值一致（约 900ms）。
- lint/typecheck/全量测试全绿；engine-core 零 diff。
