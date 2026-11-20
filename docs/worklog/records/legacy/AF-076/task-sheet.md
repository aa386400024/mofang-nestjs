---
taskId: AF-076
contextId: phase2.5-orchestration-closed-loop
title: 修正 Orchestration Gate：归档 completed 识别与已登记 backlog 的 conditional-pass 合并口径
type: fix
status: backlog
baselineRef: 4ef9ae8b774d2d655447aa72340ef3b40705cff5
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-18T03:58:00.000Z
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/ci-task-gate.mjs
    - scripts/orchestration/__tests__/orchestration.spec.mjs
    - docs/team/agent-orchestration/acceptance-checklist.md
    - docs/team/agent-orchestration/README.md
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af076-gate-conditional-merge-2026-11-18.md
    kind: report
gates:
  - command: corepack pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测全绿，覆盖 conditional-pass 合并与人工复核阻断
    threshold: 0 failed
  - command: corepack pnpm lint
    check: lint 全绿且 scripts 覆盖生效
    threshold: 0 error 0 warning
  - command: node scripts/orchestration/cli.mjs validate
    check: 状态索引、任务单、回执与契约目录全部 PASS
    threshold: exit 0
successCriteria:
  - squash 全生命周期门能识别当前 archived completed，不再误报 no-active-task
  - 只有 scopeCheck=in-scope、finalStatus=completed、无人工复核项、且每条遗留都有编号的 conditional-pass 才可合并
  - 存在人工复核项或遗留缺编号时仍拒绝合并
  - 单测覆盖通过/拒绝两侧，不降低总闸门强度
  - 不新跑 LLM 批次、不改业务 src，定向闸门全绿
---

# AF-076 · Orchestration Gate 口径修正任务单

## 背景

PR #24 的 `Orchestration Gate` 对 AF-075 报两个失败：

1. `no-active-task`：AF-075 已在当前 HEAD 归档为 `completed`，但 commit 门在 squash 全生命周期判定时，只有 durable 回执被判 `passed` 才承认归档迁移；AF-075 回执是 `conditional-pass`，于是父提交无任务、当前归档又不被借用作在办快照。
2. `passed-durable-receipt-missing`：合并门硬编码只接受 `reviewVerdict=passed`，而验收器允许 `conditional-pass`。两套口径互相矛盾：验收器认为可交付，合并门一律拒绝。

本单修正判定语义，不伪造回执、不把 conditional 一律放行：

- `conditional-pass` 可合并，但必须同时满足 `scopeCheck=in-scope`、`finalStatus=completed`、`manualReviewList` 为空、且 `backlogItems` 每条都有非空编号（遗留已登记）。
- 有任何人工复核项、或遗留项缺编号，仍拒绝。
- squash 全生命周期使用同一套「可合并回执」判定，修复归档 completed 识别。

## 范围

- 只改 `scripts/orchestration/ci-task-gate.mjs`、对应单测、适配层验收清单与 README。
- 不改业务 `src/`，不新跑 LLM 批次，不改数据库/Redis。
- 不放宽 `manualReviewList`、scope 越界、任务单缺失、status 非 completed 这些硬红线。
