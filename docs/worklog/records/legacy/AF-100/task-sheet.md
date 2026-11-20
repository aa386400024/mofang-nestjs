---
taskId: AF-100
contextId: phase2.5-exit4-proxy-quality
title: 质量证据线性化交付：执行侧代码与文档
type: implementation
status: backlog
baselineRef: 6a52d7e62795bc427408d0cc7c6eb415b03363c5
dependsOn: [AF-091, AF-093]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-18T20:02:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/
    - test/
    - docs/worklog/pending/
    - docs/worklog/completed/
  modules:
    - auto-practice-metrics
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af095-anchor-calibrated-quality-audit-2026-11-18.md
    kind: report
  - name: 校准与审计证据
    path: docs/worklog/completed/phase2.5/af095-counselor-quality-evidence-2026-11-18.json
    kind: report
gates:
  - command: corepack pnpm exec tsc --noEmit -p tsconfig.json
    check: 类型检查全绿
    threshold: error=0
  - command: corepack pnpm exec vitest run test/auto-practice/counselor-quality.spec.ts
    check: 质量审计单测全绿
    threshold: failed=0
successCriteria:
  - 质量审计代码、单测、证据 JSON 与 README 回写在单提交内交付
  - 实现提交时状态索引含 AF-100 submitted，满足 PR 逐提交门
  - 出口④仍判未达标 / 部分可判
  - engine-core 零 diff
---
# AF-100 质量证据线性化交付（执行侧）

## 背景

PR #33 的 Orchestration Gate 证明：实现提交如果没把当时的任务状态一起提交，PR 逐提交门
在归档后就看不到活跃任务上下文。本单把执行侧内容重做为一条带状态快照的线性提交。

## 目标

1. 单提交交付 `src/auto-practice/metrics/*`、9 例单测、两份证据 JSON、README §3.2 回写。
2. 提交树的状态索引保留 AF-100 submitted，保证 PR 逐提交门可判定。
3. 不夹带编排状态面修复（归 AF-101）。

## 验收

- `tsc --noEmit` exit 0。
- `vitest run test/auto-practice/counselor-quality.spec.ts` 9/9 passed。
- 交付记录六组机读标记齐全。
- `engine-core` 零 diff。
