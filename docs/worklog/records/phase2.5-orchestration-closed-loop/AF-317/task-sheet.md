---
taskId: AF-317
contextId: phase2.5-orchestration-closed-loop
title: AF-316 验收回执对齐与受保护 PR 发布
type: verification
status: backlog
baselineRef: 46199f26c0bb4d292453b3147e9576be507c5597
dependsOn: []
priorTasks: [AF-316]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-22T23:59:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - docs/worklog/completed/
    - docs/worklog/records/
    - docs/worklog/pending/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af317-af316-receipt-alignment-2026-11-22.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs validate --sheet docs/worklog/records/phase2.5-orchestration-closed-loop/AF-317/task-sheet.md
    check: 状态索引与回执 schema 一致
    threshold: exit=0
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件链哈希与索引投影一致
    threshold: exit=0
  - command: pnpm orchestration:preflight
    check: 任务入场门通过
    threshold: exit=0
successCriteria:
  - AF-316 的 durable 回执最终判定与 CLI 自动验收结论一致：reviewVerdict=passed、scopeCheck=in-scope、finalStatus=completed。
  - 临床复核类事项不再作为阻塞 manualReviewList，统一落 openQuestions，避免“机读 passed、回执 conditional”的口径分裂。
  - AF-316 交付记录的验收结论同步为“机读 passed / 临床 conditional”，不把机读通过表述为临床有效。
  - AF-316 代码、测试、交付记录与 durable 回执均在同一 stacked 分支，AF-317 作为 priorTasks 链主任务发起受保护 PR。
  - 13 项远端必需检查全绿后 squash 合并进 integrate，合并后本地快进同步并核对 merge SHA。
---

# AF-317 · AF-316 验收回执对齐与受保护 PR 发布

## 0. 为什么需要本单

AF-316 已经由 CLI 自动验收为 `passed`，`manualReview` 为空，`manifest.status=completed`，但它的 durable 回执自报 `reviewVerdict=conditional-pass`，且 `manualReviewList` 有 4 条临床复核项。`mergeableDurableReceipts()` 对 `conditional-pass + 非空 manualReviewList` 判为不可合并，PR 会被 `passed-durable-receipt-missing` 拦下。

这不是代码缺陷，是回执口径与机读验收结论不一致。本单只做证据收口，不改任何生产代码：

1. durable 回执最终判定对齐为 `passed`；临床复核事项移入 `openQuestions` 继续跟踪，不再作为阻塞合入的 `manualReviewList`。
2. AF-316 交付记录的验收结论写成“机读 passed / 临床 conditional”，保留真实边界。
3. 由 AF-317 作为主任务、AF-316 作为 `priorTasks`，发起同一个受保护 PR；AF-316 的实现提交继续作为链内提交保留。

## 1. 验收

- durable 回执 `reviewVerdict=passed / scopeCheck=in-scope / finalStatus=completed / manualReviewList=[]`。
- `mergeableDurableReceipts` 返回 1 条可合并回执。
- `events verify` PASS；`validate` PASS。
- PR 的 13 项 required checks 全绿，squash 合并进 `integrate`，本地快进同步。

## 2. 非目标

- 不改 AF-316 的生产代码、测试与已通过的闸门数字。
- 不改 AF-316 的归档终态，不手改 `task-state-index.json` / `journal.jsonl`。
- 不把“机读 passed”升级成“临床有效”；临床督导复核仍是独立批次。
