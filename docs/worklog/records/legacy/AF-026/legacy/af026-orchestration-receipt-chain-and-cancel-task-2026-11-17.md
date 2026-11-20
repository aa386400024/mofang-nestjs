---
taskId: AF-026
contextId: phase2.5-orchestration-closed-loop
title: 编排侧回执整链与取消入口加固
type: implementation
status: ready
baselineRef: 7311d01
dependsOn: [AF-023]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.3
  - conventions.md#1.4
createdAt: 2026-11-17T09:45:00+08:00
deadline: 2026-11-17T10:45:00+08:00
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
    - docs/team/agent-orchestration/
    - docs/worklog/completed/phase2.5/
  modules: []
  interfaces: []
artifacts:
  - name: 编排侧加固实施记录
    path: docs/worklog/completed/phase2.5/af026-orchestration-receipt-chain-and-cancel-2026-11-17.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs --reporter=dot
    check: 编排单测全绿（含整链与取消用例）
    threshold: 'failed=0'
  - command: ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate
    check: 适配层框架 schema 校验全 PASS
    threshold: 'fail=0'
successCriteria:
  - processReceipts 可注入回执归档目录，整链用例不污染仓库运行态
  - 存在用例覆盖「回执落盘 → 摄入 → 验收 → 归档 completed」整链
  - 非终态任务可经唯一命令入口按状态机闭合到 canceled，终态任务拒绝取消
evidenceFormat: 命令 + exit code + 用例数
---

# AF-026 编排侧回执整链与取消入口加固（任务单）

## 1. 背景

两处真实缺口：其一，「回执摄入 → 验收 → 归档」此前只有分段单测与 DR-001 实跑证据，没有进程内串起整链的用例，且 `processReceipts` 未透传回执归档目录，用例无法隔离仓库 archive；其二，框架状态机允许非终态 → `canceled`，但没有任何命令能执行，误立项或资源域切错的任务只能改文件绕过状态机。

## 2. 目标

1. `processReceipts` 透传 `receiptArchiveDir`，补整链用例（临时 receipts / archive 目录，一轮内 `receipt-ingested` + `archive-completed`，终态 `completed`、`autoVerdict=passed`）。
2. 新增 `cancelTask` 与 `task cancel --taskId`：沿状态机闭合到 `canceled`、写 `cancelReason`、清租约与持单，终态任务与不存在任务显性报错。

## 3. 切片（scope）

`scripts/orchestration/`（scheduler / cli / 单测）、`docs/team/agent-orchestration/`（运行态与口径）、`docs/worklog/completed/phase2.5/`（交付记录）。不改验收规则、不改 transport 协议、不碰业务代码。

## 4. 验收

- 编排单测全绿（含整链与取消用例）；
- `orchestration:validate` 全 PASS；
- 实跑一次 `task cancel` 并归档，运行态投影一致。
