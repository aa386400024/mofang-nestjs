---
taskId: AF-027
contextId: phase2.5-orchestration-closed-loop
title: 编排侧回执整链与取消入口加固（返修）
type: implementation
status: ready
baselineRef: 7311d01
dependsOn: [AF-023]
priorTasks: [AF-026]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.3
  - conventions.md#1.4
createdAt: 2026-11-17T09:49:00+08:00
deadline: 2026-11-17T10:49:00+08:00
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
    - docs/team/agent-orchestration/
    - docs/worklog/completed/phase2.5/
  modules: []
  interfaces: []
artifacts:
  - name: 返修实施记录
    path: docs/worklog/completed/phase2.5/af027-orchestration-receipt-chain-rework-2026-11-17.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs --reporter=dot
    check: 编排单测全绿
    threshold: 'failed=0'
  - command: ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate
    check: 适配层 schema 校验全 PASS
    threshold: 'fail=0'
successCriteria:
  - 整链用例覆盖「回执落盘 → 摄入 → 验收 → 归档 completed」
  - V7 不再把编排状态面生成物（快照 / 索引 / journal / data.js / transport）判为任务越域
  - 索引工件指针只含 taskSheet / deliveryRecord / reply / others，回执指针留在运行态
  - 非终态任务可经 task cancel 按状态机闭合到 canceled
evidenceFormat: 命令 + exit code + 用例数
---

# AF-027 返修：编排侧回执整链与取消入口加固（任务单）

## 1. 返修背景

`AF-026` 首轮验收被判 `rejected`，根因（`RW-AF-026-1`）：

1. **V7 误判编排状态面**。`checkResidual` 拿原始 `git diff` 清单与任务 `scope.files` 比对，而 `task-state-index.json`、`state/journal.jsonl`、`orchestration-snapshot.json`、`web/orchestration/data.js` 由 CLI 每轮自动重写，属编排自身状态面，不是任何任务的交付面。结果是：任何真实任务只要本轮推进过状态，就必然被 V7 判越域 → 永久 `rejected`。
2. **索引工件指针越 schema**。`ingestReceipts` 把回执归档副本指针写进 `task.artifacts.receipt`，而框架 `task-state-index 1.1.0` 的 `artifacts` 只允许 `taskSheet / deliveryRecord / reply / others`，索引校验直接失败（`must NOT have additional properties`）。

## 2. 返修内容

- `acceptance-runner.mjs`：导出 `STATE_PLANE_ARTIFACTS` 与 `isStatePlaneArtifact()`，V7 先剔除状态面生成物再与 `scope.files` 比对；清单仅含状态面时记 pass 并说明「不纳入任务交付面比对」。
- `receipts.mjs`：回执副本指针只写 `task.receipt.archiveRef` 与运行态 `entry.receiptArchiveRef`，不再触碰 `task.artifacts`。
- `event-store.mjs`：新增 `pickArtifactPointers()`，写入与投影两侧都按白名单裁剪，历史越 schema 的归档事件在重建时被规范化。
- 单测：新增「V7 状态面生成物不计残留」，并把回执用例改为断言 `artifacts` 不含 `receipt`、指针在 `receipt.archiveRef`。

## 3. 切片（scope）

`scripts/orchestration/`、`docs/team/agent-orchestration/`、`docs/worklog/completed/phase2.5/`。不改验收语义（V1–V6 不变），不改 transport 协议，不碰业务代码。

## 4. 验收

- 编排单测全绿；
- `orchestration:validate` 全 PASS（含索引 schema）；
- 本轮真实任务走完 claim → dispatch → 回执 → 验收 → 归档，结论 `passed`。
