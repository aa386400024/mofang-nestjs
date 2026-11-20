---
taskId: AF-025
contextId: phase2.5-orchestration-closed-loop
title: 回执摄入到验收归档的整链单测
type: implementation
status: ready
baselineRef: 7311d01
dependsOn: [AF-023]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.4
createdAt: 2026-11-17T09:43:00+08:00
deadline: 2026-11-17T10:43:00+08:00
agentRole: executor
scope:
  files:
    - scripts/orchestration/__tests__/
    - scripts/orchestration/scheduler.mjs
    - scripts/orchestration/receipts.mjs
    - docs/worklog/completed/phase2.5/
  modules: []
  interfaces: []
artifacts:
  - name: 整链单测与补记
    path: docs/worklog/completed/phase2.5/af025-receipt-chain-integration-2026-11-17.md
    kind: test
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs --reporter=dot
    check: 编排单测全绿（含整链用例）
    threshold: 'failed=0'
  - command: ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate
    check: 适配层框架 schema 校验全 PASS
    threshold: 'fail=0'
successCriteria:
  - 存在一条用例覆盖「回执落盘 → ingestReceipts → 验收 → 归档 completed」整链
  - 用例可注入临时 receipts / archive 目录，不污染仓库运行态
  - 断言覆盖动作序列与归档条目终态
evidenceFormat: 命令 + exit code + 用例数
---

# AF-025 回执整链单测（任务单）

## 1. 背景

此前「回执摄入 → 验收 → 归档」只由 DR-001 实跑与分段单测覆盖，缺一条在进程内串起整链的用例；`processReceipts` 也未把 `archiveDir` 透传给 `ingestReceipts`，导致用例无法隔离仓库 archive 目录。

## 2. 目标

补一条整链用例：临时 receipts 目录写入合法七组回执，一轮 `processReceipts` 内完成 `receipt-ingested` 与 `archive-completed`，归档条目终态为 `completed`，且 `autoVerdict=passed`。

## 3. 切片（scope）

`scripts/orchestration/scheduler.mjs`（透传 archiveDir）、`scripts/orchestration/__tests__/`、`docs/worklog/completed/phase2.5/`（交付记录）。不改验收规则本体，不改 transport 协议。

## 4. 验收

- 整链用例通过，临时目录用后清理；
- 编排单测全绿，`orchestration:validate` 全 PASS。
