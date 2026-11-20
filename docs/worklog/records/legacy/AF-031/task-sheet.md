---
taskId: AF-031
contextId: phase2.5-orchestration-closed-loop
title: 返修 AF-030：任务单编码缺陷收口与验收护栏复验
type: implementation
status: backlog
baselineRef: 04f6524
dependsOn: [AF-023]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.3
  - conventions.md#1.4
createdAt: 2026-11-17T10:58:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
    - docs/team/agent-orchestration/
    - docs/worklog/pending/
    - docs/worklog/completed/
  modules: []
  interfaces: []
artifacts:
  - name: 编码缺陷收口实施记录
    path: docs/worklog/completed/phase2.5/af031-task-sheet-encoding-closure-2026-11-17.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测全绿
    threshold: 'failed=0'
  - command: ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate
    check: 适配层框架 schema 校验全 PASS
    threshold: 'fail=0'
successCriteria:
  - 返修任务单与交付记录均为 LF + 无 BOM，V5 编码检查 PASS
  - AF-030 已落的护栏修复（任务单豁免 V7 / 索引三键 / 时间戳归一）在复验中全部 PASS
  - 任务从 ready 走到 completed 归档，全链无 rejected 分支
evidenceFormat: 命令 + exit code + 用例数；编码证据取 V5 检查行与字节检查结果
---

# AF-031 返修任务单（编码缺陷收口）

## 1. 背景

AF-030 已把三处验收护栏缺陷修完（任务单豁免 V7、索引工件三键、事件时间戳归一 + 链纠偏），四闸在交付时全绿。但它自己的任务单在改 `createdAt` 时被 `Set-Content` 重写成 CRLF，自动验收的 V5 编码检查判 `taskSheet: 含 CR`，于是 `rejected`。

这不是代码问题，是本机工具链的编码坑：`Set-Content` / `Out-File` 一律改写行尾为 CRLF，写 Markdown 只能用 `[IO.File]::WriteAllText` + `UTF8Encoding($false)`。本单把这条坑固化进口径并复验，避免同一类返修继续空转。

返修链：AF-024（rejected，GUI 通道交付面完整）→ AF-029（canceled，依赖口径写错）→ AF-030（rejected，任务单 CRLF）→ **AF-031（本单）**。

## 2. 目标

- 本单任务单与交付记录 LF + 无 BOM，V5 PASS。
- 复验 AF-030 已落的三处修复：V7 任务单豁免、索引三键、事件时间戳归一与 110 条链一致。
- `run-once` 从 `ready` 一路走到 `completed`，不触发 `rework-proposal`。

## 3. 切片（scope）

纳管 `scripts/orchestration/` 的验收/投影实现复核、`docs/team/agent-orchestration/` 口径与运行态、`docs/worklog/` 的本单任务单与交付记录。不改业务代码。

## 4. 验收

- `validate` 0 FAIL；
- `events verify` 110 条一致；
- 单测 164 passed；
- 任务归档终态 `completed`。

## 5. 状态

✅ 已交付。编码坑与处置见 `docs/worklog/completed/phase2.5/af031-task-sheet-encoding-closure-2026-11-17.md`。
