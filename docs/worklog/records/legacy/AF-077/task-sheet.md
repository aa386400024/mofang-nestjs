---
taskId: AF-077
contextId: phase2.5-orchestration-closed-loop
title: 修正 pr-release 本地合并门：与 CI 门统一可合并 durable 回执口径
type: fix
status: backlog
baselineRef: e381112b05ccf31988aa8316c30330b3d059e8b3
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-18T04:05:00.000Z
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/pr-release.mjs
    - scripts/orchestration/__tests__/orchestration.spec.mjs
    - docs/team/agent-orchestration/README.md
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af077-pr-release-conditional-2026-11-18.md
    kind: report
gates:
  - command: corepack pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测全绿，覆盖 pr-release 可合并回执判定
    threshold: 0 failed
  - command: corepack pnpm lint
    check: lint 全绿且 scripts 覆盖生效
    threshold: 0 error 0 warning
  - command: node scripts/orchestration/cli.mjs validate
    check: 状态索引、任务单、回执与契约目录全部 PASS
    threshold: exit 0
successCriteria:
  - pr-release merge 不再硬编码只接受 passed，改为与 ci-task-gate 同一套 mergeableDurableReceipts
  - conditional-pass 仍要求无人工复核项、backlog 每条有编号、scope=in-scope、finalStatus=completed
  - 单测覆盖通过/拒绝两侧，不降低合并门强度
  - 不新跑 LLM 批次、不改业务 src，定向闸门全绿
---

# AF-077 · pr-release 本地合并门口径修正任务单

## 背景

AF-076 已把 CI `Orchestration Gate` 改成「可合并 durable 回执」，PR #24 的 13 项检查已全绿。但本地 `pr-release.mjs merge` 仍调用 `hasPassedDurableReceipt`，硬编码只接受 `verdict === 'passed'`，对 AF-075 的 `conditional-pass` 直接报「没有 passed 的 durable 回执」，导致 CI 已放行、本地工具却拒绝合并。

根因是同一语义存在第二份实现：CI 门与本地合并门各写一套回执判定，AF-076 只修了前者。本单把本地合并门统一到 `ci-task-gate.mjs` 的 `mergeableDurableReceipts`，并补单测防止再次漂移。

## 范围

- 只改 `scripts/orchestration/pr-release.mjs`、对应单测、适配层 README（如措辞需要）。
- 不改业务 `src/`，不新跑 LLM 批次，不改数据库/Redis。
- 不放宽 `manualReviewList`、scope 越界、任务单缺失、status 非 completed 硬红线。
