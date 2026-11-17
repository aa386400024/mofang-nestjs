---
taskId: AF-028
contextId: phase2.5-orchestration-closed-loop
title: backlog → ready 提级入口与文档口径对齐
type: implementation
status: completed
baselineRef: 976b833
dependsOn: [AF-027]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
createdAt: 2026-11-17T10:05:00+08:00
---

# AF-028 交付记录：backlog → ready 提级入口与文档口径对齐

## 1. 摘要

| 项     | 内容                                                                                                |
| ------ | --------------------------------------------------------------------------------------------------- |
| 缺口   | 框架允许 `backlog ↔ ready`，适配层却只有「注册进 backlog」的写入口，`AF-024` 登记后永久停在 backlog |
| 结论   | `passed`（机读 V1–V7 全绿，无偏差、无遗留）                                                         |
| 改动面 | `scheduler.mjs`（`promoteTask`）、`cli.mjs`（`task promote`）、单测、README、设计稿                 |

## 2. 实现

### 2.1 `promoteTask()`

`backlog → ready`，提级前四项硬校验，任一不满足直接抛错，不给「先塞进队列再说」留口子：

| 校验           | 拒绝条件                                             | 报错                                         |
| -------------- | ---------------------------------------------------- | -------------------------------------------- |
| 任务存在且活跃 | 不在 `tasks` 或已归档                                | `任务不在活跃列表`                           |
| 状态可迁移     | 已是 `ready` / 非 `backlog`                          | `已处于 ready` / `只有 backlog 可提到 ready` |
| 契约齐全       | 缺 `artifacts.taskSheet` 或 `taskId/contextId/type`  | `任务单指针缺失` / `任务单缺字段 <key>`      |
| 基线明确       | `baselineRef` 为空                                   | `基线不明确（缺 baselineRef）`               |
| 依赖满足       | `dependsOn` 有非 `completed` 上游（活跃 + 归档双查） | `依赖未满足：AF-xxx:<status>`                |

成功时写 `promotedAt`、追加 `backlog → ready` 历史、同步运行态条目，由 CLI 走 `commitIndex` 落事件。

### 2.2 `task promote` 入口

```
node scripts/orchestration/cli.mjs task promote --taskId <id> [--reason <text>]
```

流程：`loadIndex` → `loadRuntimeState` → `promoteTask` → `commitIndex` → `saveRuntimeState` → `refreshSnapshotArtifacts` → `auditRegistryCall`。help 与未知子命令提示同步改为 `register / import / resume / promote / cancel`。

### 2.3 单测

新增「人工提级」用例：成功后 `status=ready` 且历史末条 `from=backlog,to=ready`、运行态有 `promotedAt`；上游在 `archivedTasks` 且 `completed` 时算满足；依赖未满足 / 缺基线 / 缺任务单指针 / 已 ready / 非 backlog / 不存在六个拒绝分支逐个断言。

## 3. 文档口径

- `README.md` §4：补 `task promote` 与「ready 前置：契约齐全 + 基线明确 + 依赖满足」。
- `autonomous-team-design.md`：状态面段落补提级口径，避免「只能注册不能启用」的死状态被当成已闭环。

## 4. 闸门

| 命令                                                                                         | 结果                              |
| -------------------------------------------------------------------------------------------- | --------------------------------- |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs --reporter=dot` | 153 passed / 0 failed             |
| `ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate`                                       | PASS / FAIL 见 §5 复核            |
| `node scripts/orchestration/cli.mjs events verify`                                           | 事件 100 条，哈希链与索引投影一致 |
| `pnpm lint` / `pnpm typecheck`                                                               | exit 0 / exit 0                   |

## 5. 实跑证据

```
task register --sheet docs/worklog/pending/af028-...md --status ready
  → 已登记任务 AF-028（ready）
run-once
  → [动作] claim AF-028
  → [动作] dispatch AF-028
task promote --taskId AF-999      → 任务操作失败：提级失败：任务不在活跃列表：AF-999
task promote                      → 用法：task promote --taskId <id> [--reason <text>] ...
```

`AF-024` 保持 `backlog`：GUI 派发属未启动工作，不提前入队，避免在无 executor 时被错误领取。

## 6. 回执（机读）

```yaml
taskId: AF-028
contextId: phase2.5-orchestration-closed-loop
type: implementation
baselineRef: 976b833
dependsOn: [AF-027]
policyRefs: [conventions.md#1.3, conventions.md#1.4]
contractRef: urn:agent-collaboration-framework:schema:receipt:1.0.0
artifactRefs:
  taskSheet: docs/team/agent-orchestration/transport/tasks/AF-028.json
  deliveryRecord: docs/worklog/completed/phase2.5/af028-task-promote-and-docs-2026-11-17.md
  reply: null
  others: []
changedFiles:
  added: []
  modified:
    - scripts/orchestration/scheduler.mjs
    - scripts/orchestration/cli.mjs
    - scripts/orchestration/__tests__/orchestration.spec.mjs
    - docs/team/agent-orchestration/README.md
    - docs/team/agent-orchestration/autonomous-team-design.md
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
reproNotes: 提级拒绝分支由单测固定；真实 CLI 仅验证帮助与不存在任务的错误路径，未对 AF-024 真实提级
scopeCheck: in-scope
parallelArtifactsExcluded: true
noOutscopeRefactor: true
contractChecks:
  - item: taskId
    result: pass
    note: 任务单与交付记录一致
  - item: state-write
    result: pass
    note: 经 commitIndex 落事件，未直接改索引
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
verdictRationale: 提级入口有单测与 CLI 实证，文档口径同步，机读全绿
```
