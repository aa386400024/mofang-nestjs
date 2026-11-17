---
taskId: AF-043
contextId: phase2.5-orchestration-closed-loop
title: 台账收口复单（AF-040 被同树残留判 rejected 后重开验收）
type: implementation
status: backlog
baselineRef: ba582325d10426d5bf194048b07899dcb3a1a373
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.3
  - conventions.md#1.4
createdAt: 2026-11-17T03:58:00.000Z
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
  - name: 通道失败口径裁定书
    path: docs/team/agent-orchestration/channel-failure-decisions-2026-11-17.md
    kind: report
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af043-improvement-closeout-rework-2026-11-17.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测全绿
    threshold: 'failed=0'
  - command: ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate
    check: 适配层机读校验全 PASS
    threshold: 'FAIL=0'
successCriteria:
  - 复用 AF-040 已在库的实现（commit 5cae3f6），不重复改动
  - 交付记录写明 AF-040 被判 rejected 的真实原因（同树跨任务残留）与消除方式（分组提交）
  - 台账 15 条全部到终态
evidenceFormat: commit hash + vitest 用例数 + validate PASS 计数 + 台账 summary
---

# AF-043 任务单（台账收口复单）

## 1. 为什么重开

AF-040 的实现全部在库（`5cae3f6`），但机读护栏判 `rejected`，理由是 `scope 外变更文件：test/admin-debug/wp38-debug-session-resume.spec.ts` —— 那是 AF-041 的改动，**同树共存**被判成 AF-040 越界。

这正是 AF-038 记过的归因问题（`AF-038-I2`）。本单的处置不是改护栏，而是**按任务分组提交**：把三组改动分别 commit（`5cae3f6` 代码 / `c8632c6` 用例 / 本单 docs），让每个任务的残留比对面变干净。

## 2. 范围

- 不重复改代码：AF-040 的 11 个文件已在 `5cae3f6`。
- 补本单交付记录；台账状态以 `improvements --summary` 复核。

## 3. 验收

闸门沿用 AF-040 的实跑数字并复跑编排单测与 validate；台账活跃项应为 0。
