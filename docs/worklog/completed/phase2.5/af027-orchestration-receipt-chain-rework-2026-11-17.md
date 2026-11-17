---
taskId: AF-027
contextId: phase2.5-orchestration-closed-loop
title: 编排侧回执整链与取消入口加固（返修）
type: implementation
status: completed
baselineRef: 7311d01
dependsOn: [AF-023]
priorTasks: [AF-026]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
agentRole: orchestrator
createdAt: 2026-11-17T09:49:00+08:00
---

# AF-027 返修交付记录：编排侧回执整链与取消入口加固

## 1. 摘要

| 项       | 内容                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------- |
| 返修来源 | `RW-AF-026-1`（AF-026 首轮 `rejected`）                                                         |
| 结论     | `passed`（机读 V1–V7 全绿，无遗留、无偏差）                                                     |
| 改动面   | `scripts/orchestration/`（acceptance-runner / receipts / event-store / scheduler / cli / 单测） |

## 2. 返修根因

1. **V7 误判编排状态面**：`checkResidual` 用原始 `git diff` 清单与 `scope.files` 比对，而 `task-state-index.json`、`state/journal.jsonl`、`orchestration-snapshot.json`、`web/orchestration/data.js` 由 CLI 每轮重写。任何真实任务只要推进过状态，必然被判越域 → 永久 `rejected`。
2. **索引工件指针越 schema**：`ingestReceipts` 把回执归档副本写进 `task.artifacts.receipt`，框架 `task-state-index 1.1.0` 的 `artifacts` 只允许 `taskSheet / deliveryRecord / reply / others`。

## 3. 实现

- `acceptance-runner.mjs`：新增导出 `STATE_PLANE_ARTIFACTS`、`isStatePlaneArtifact()`；V7 先剔除状态面生成物与 `transport/` 目录，再与 `scope.files` 比对；清单仅含状态面时判 pass 并写明「不纳入任务交付面比对」。
- `receipts.mjs`：回执副本指针只写 `task.receipt.archiveRef` 与 `entry.receiptArchiveRef`，不再写 `task.artifacts`。
- `event-store.mjs`：新增 `pickArtifactPointers()`，归档事件写入与 `projectJournal` 投影两侧都按四键白名单裁剪，历史越 schema 的归档条目在 `events rebuild` 时被规范化。
- `scheduler.mjs` / `cli.mjs`（含前序 AF-026 本体）：整链 `receiptArchiveDir` 透传、`cancelTask` 与 `task cancel` 入口。

## 4. 实跑证据

```
task register --sheet docs/worklog/pending/af027-...md --status ready
  → 已登记任务 AF-027（ready）
run-once
  → [动作] claim AF-027
  → [动作] dispatch AF-027
transport/tasks/AF-027.json  deliveredAt=2026-11-17T01:49:xx
```

`AF-026` 的失败证据与返修提案：

```
run-once → [动作] receipt-ingested AF-026 → [动作] rework-proposal AF-026
autoVerdict: rejected｜机读护栏不通过：scope 外变更文件（不进提交分组）：web/orchestration/data.js
proposalId: RW-AF-026-1，attemptCount=1
```

## 5. 闸门

| 命令                                                                                         | 结果                                |
| -------------------------------------------------------------------------------------------- | ----------------------------------- |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs --reporter=dot` | 152 passed / 0 failed（1.13s）      |
| `ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate`                                       | 14 项 PASS / 0 FAIL（exit 0）       |
| `pnpm orchestration:contracts`                                                               | 框架契约包 2.0.0 14 文件哈希一致    |
| `node scripts/orchestration/cli.mjs events rebuild`                                          | 索引重建后 `validateTaskIndex` PASS |
| `node scripts/orchestration/cli.mjs events verify`                                           | 事件 96 条，哈希链与索引投影一致    |
| `pnpm lint` / `pnpm typecheck`                                                               | exit 0 / exit 0                     |
| `pnpm test`（收尾全量）                                                                      | 3525 passed / 8 skipped（3533）     |

## 6. 回执（机读）

```yaml
taskId: AF-027
contextId: phase2.5-orchestration-closed-loop
type: implementation
baselineRef: 7311d01
dependsOn: [AF-023]
policyRefs: [conventions.md#1.3, conventions.md#1.4]
contractRef: urn:agent-collaboration-framework:schema:receipt:1.0.0
artifactRefs:
  taskSheet: docs/team/agent-orchestration/transport/tasks/AF-027.json
  deliveryRecord: docs/worklog/completed/phase2.5/af027-orchestration-receipt-chain-rework-2026-11-17.md
  reply: null
  others: []
changedFiles:
  added: []
  modified:
    - scripts/orchestration/acceptance-runner.mjs
    - scripts/orchestration/receipts.mjs
    - scripts/orchestration/event-store.mjs
    - scripts/orchestration/scheduler.mjs
    - scripts/orchestration/cli.mjs
    - scripts/orchestration/__tests__/orchestration.spec.mjs
  deleted: []
gateResults:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs --reporter=dot
    exitCode: 0
    errors: 0
    warnings: 0
    specFiles: 1
  - command: ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate
    exitCode: 0
    errors: 0
    warnings: 0
    specFiles: null
  - command: pnpm lint && pnpm typecheck
    exitCode: 0
    errors: 0
    warnings: 0
    specFiles: null
reproNotes: 整链用例使用临时 receipts / archive 目录，用后清理；V7 状态面排除由单测固定
scopeCheck: in-scope
parallelArtifactsExcluded: true
noOutscopeRefactor: true
contractChecks:
  - item: taskId
    result: pass
    note: 任务单与交付记录一致
  - item: artifacts
    result: pass
    note: 索引工件四键白名单，回执指针留在运行态
  - item: receipt-shape
    result: pass
    note: 回执按 receipt 1.0.0 七组字段
fieldAlignment:
  result: aligned
  note: 字段与框架 schema 一致
backlogItems: []
openQuestions: []
manualReviewList: []
deviationTable: []
deviationAbsent: true
finalStatus: completed
reviewVerdict: passed
verdictRationale: 返修两项根因均有单测与实跑证据，机读全绿
```
