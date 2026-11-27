---
taskId: AF-563
contextId: phase2.5-audit-remediation
title: 出口⑤ 1000 场批次入队与首批运行
type: implementation
status: backlog
baselineRef: 2d965fb3fb98ca5826ae038a66c3c4ec3ba39796
riskClass: R2
gateProfile: full
dependsOn:
  - AF-561
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-27T10:10:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - scripts/eval/
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-audit-remediation/AF-562/
  modules: [auto-practice]
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af562-exit5-1000-batch-2026-11-27.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 0 error
    threshold: exit 0
  - command: pnpm lint
    check: 0 error
    threshold: exit 0
  - command: pnpm exec tsx scripts/eval/enqueue-exit5-batch.ts --target 487 --dry-run
    check: dry-run 打印 487 且不入队
    threshold: exit 0
successCriteria:
  - 提供可复用、幂等的出口⑤批次入队脚本，支持 target/batchId/maxTurns/dry-run
  - 按当前 completed=513 精确补 487 场，不重复、不超额
  - 实际入队后给出 BullMQ waiting/active/completed 现场数字
  - 不提高 worker 并发、不改上游模型、不触发 429 风险扩张
  - 交付记录写清批次 ID、场数、成本口径与后续取数方式
  - engine-core 零 diff
---

# AF-563 · 出口⑤ 1000 场批次入队与首批运行

## 背景

Phase2.5 出口⑤要求累计 1000 场 completed 对练。2026-11-27 实查 `ap_practice_sessions`：总 699，completed 513，距 1000 差 487。AF-529 明确记录“未启动 1000 场出口⑤批次”。本任务把一次性 P4 脚本升级为可复用出口⑤入队器，实际补 487 场。

## 范围

- 新增 `scripts/eval/enqueue-exit5-batch.ts`：8 角色 × 2 咨询师模式均匀分配，jobId 内容派生幂等，支持 dry-run。
- 实际入队一个 batchId，交给现有 `auto-practice` worker（并发 3）消费。
- 交付记录记录批次现场数字与取数 SQL。

## 不在范围

- 不扩 worker 并发、不改模型 provider、不改 prompt。
- 不在本任务内做人工盲评或出口④复评。
- 不动前端 / admin-dashboard / engine-core。
