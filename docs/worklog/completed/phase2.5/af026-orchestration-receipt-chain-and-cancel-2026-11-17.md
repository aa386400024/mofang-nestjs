---
taskId: AF-026
contextId: phase2.5-orchestration-closed-loop
title: 编排侧回执整链与取消入口加固
type: implementation
status: completed
baselineRef: 7311d01
dependsOn: [AF-023]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
agentRole: orchestrator
createdAt: 2026-11-17T09:45:00+08:00
---

# AF-026 编排侧回执整链与取消入口加固（交付记录）

## 1. 摘要

| 项     | 内容                                                                                   |
| ------ | -------------------------------------------------------------------------------------- |
| 任务单 | `docs/worklog/pending/af026-orchestration-receipt-chain-and-cancel-task-2026-11-17.md` |
| 结论   | `passed`（机读 V1–V7 全绿，无遗留、无偏差）                                            |
| 基线   | `7311d01`                                                                              |
| 改动面 | `scripts/orchestration/`（scheduler / cli / 单测）、`docs/worklog/`                    |

## 2. 背景与根因

两处缺口都不是文档问题，而是运行态真的走不通：

1. **整链无进程内证据**。`processReceipts` 调用 `ingestReceipts` 时没有透传回执归档目录，用例只能写仓库真实 `archive/`；因此「回执落盘 → 摄入 → 验收 → 归档」只有分段单测加 DR-001 实跑，缺一条可重复执行的整链用例。
2. **`canceled` 不可达**。框架 `docs/state-machine.md` 允许 `backlog / ready / submitted / working / input-required → canceled`，但 CLI 只有 `archive`，而 `archive` 前置条件是任务已是终态，形成死锁：误立项或资源域切错的任务无法按状态机合法关闭，只能改文件绕过。

## 3. 实现

### 3.1 `scheduler.mjs`

- `processReceipts` 透传 `receiptArchiveDir` 到 `ingestReceipts`，用例可注入临时目录，不污染仓库运行态。
- 新增导出 `cancelTask(index, runtimeState, taskId, opts)`：
  - 校验任务在活跃列表、非终态、`canTransition(status,'canceled')` 为真；
  - 写 `cancelReason`、push `history{from,to:canceled}`；
  - 清 `leaseClaimedAt/leaseDeadline`，运行态写 `releaseReason='cancelled'`、`heldForHuman=false`、`escalation=null`。

### 3.2 `cli.mjs`

- 新增 `task cancel --taskId <id> [--reason]`：调 `cancelTask` → `commitIndex` → `saveRuntimeState` → 刷新快照 → 审计登记。
- help 与头注释同步。

### 3.3 单测（`orchestration.spec.mjs`）

- 「整链：回执落盘 → 摄入 → 验收 → 归档，一轮内闭合 completed」：临时 receipts / archive 目录，合法七组回执，断言 `receipt-ingested` + `archive-completed`、`archivedTasks[0].status=completed`、`autoVerdict.verdict=passed`。
- 「人工取消：非终态沿状态机闭合到 canceled 并清租约；终态拒绝取消」：断言终态抛错、不存在任务抛错、history 末条为 `ready → canceled`。

## 4. 实跑证据

```
node scripts/orchestration/cli.mjs task register --sheet docs/worklog/pending/af026-...md --status ready
  → 已登记任务 AF-026（ready）

node scripts/orchestration/cli.mjs run-once
  → [动作] claim AF-026
  → [动作] dispatch AF-026
  → AF-026 [submitted] implementation｜编排侧回执整链与取消入口加固

transport/tasks/AF-026.json  2394 bytes  deliveredAt=2026-11-17T01:45:29.419Z
```

取消入口实跑（AF-025 跨资源域案例）：

```
node scripts/orchestration/cli.mjs task cancel --taskId AF-025 --reason 'scope 跨 executor / orchestrator 资源域，按角色切片重新立项'
  → 已取消任务 AF-025：status=canceled
node scripts/orchestration/cli.mjs archive AF-025 --status canceled ...
  → 已归档：AF-025 [canceled]
```

## 5. 闸门

| 命令                                                                                         | 结果                                                |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs --reporter=dot` | 151 passed / 0 failed                               |
| `ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate`                                       | 10 项 PASS / 0 FAIL                                 |
| `pnpm orchestration:contracts`                                                               | 框架契约包 2.0.0（v2.0.0 / c507188）14 文件哈希一致 |
| `pnpm lint`                                                                                  | exit 0                                              |
| `pnpm typecheck`                                                                             | exit 0                                              |

## 6. 回执（机读）

```yaml
taskId: AF-026
contextId: phase2.5-orchestration-closed-loop
type: implementation
baselineRef: 7311d01
dependsOn: [AF-023]
policyRefs: [conventions.md#1.3, conventions.md#1.4]
contractRef: urn:agent-collaboration-framework:schema:receipt:1.0.0
artifactRefs:
  taskSheet: docs/team/agent-orchestration/transport/tasks/AF-026.json
  deliveryRecord: docs/worklog/completed/phase2.5/af026-orchestration-receipt-chain-and-cancel-2026-11-17.md
  reply: null
  others: []
changedFiles:
  added: []
  modified:
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
reproNotes: 整链用例使用临时 receipts / archive 目录，用后清理
scopeCheck: in-scope
parallelArtifactsExcluded: true
noOutscopeRefactor: true
contractChecks:
  - item: taskId
    result: pass
    note: 任务单与交付记录一致
  - item: artifacts
    result: pass
    note: 任务单为产出数组，索引指针分离
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
verdictRationale: 整链与取消入口均有进程内用例与实跑证据，机读全绿
```
