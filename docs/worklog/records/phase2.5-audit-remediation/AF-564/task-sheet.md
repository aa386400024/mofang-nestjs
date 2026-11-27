---
taskId: AF-564
contextId: phase2.5-audit-remediation
title: 出口⑤ 1000 场批次入队与实跑
type: implementation
status: backlog
baselineRef: 2d965fb3fb98ca5826ae038a66c3c4ec3ba39796
riskClass: R2
gateProfile: full
dependsOn:
  - AF-561
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-27T02:32:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - scripts/eval/
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-audit-remediation/AF-564/
  modules: [auto-practice]
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af564-exit5-1000-batch-2026-11-27.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 0 error
    threshold: exit 0
  - command: pnpm lint
    check: 0 error
    threshold: exit 0
  - command: pnpm exec tsx scripts/eval/enqueue-exit5-batch.ts --target 482 --dry-run
    check: dry-run 打印 482 且不入队
    threshold: exit 0
successCriteria:
  - 提供可复用、幂等的出口⑤批次入队脚本，支持 target/batchId/maxTurns/dry-run
  - 入队前缀与 worker 一致，避免共享 Redis 上生产 worker 抢占本地批次
  - 按 completed 实际缺口精确补足到 1000，脚本重复投递不产生重复场次
  - 记录真实批次 ID、场数、完成状态与取数 SQL
  - 新批次抽样 visitor_display_text 与 visitor_tts_text 括号残留为 0
  - 不提高 worker 并发、不改上游模型、不改 prompt、engine-core 零 diff
---

# AF-564 · 出口⑤ 1000 场批次入队与实跑

## 背景

Phase2.5 出口⑤要求累计 1000 场 completed 对练。AF-563 任务单误沿用 AF-562 的记录包与产物路径，scope 不含实际记录目录，无法合规提交，故取消并重签本任务。

## 范围

- 新增并修正 `scripts/eval/enqueue-exit5-batch.ts`：8 角色 × 2 咨询师模式均匀分配，jobId 内容派生幂等，支持 dry-run。
- 修正入队前缀为 `resolveBullPrefix()`，与 worker 同前缀，避免打到共享 Redis 上生产 worker。
- 实际入队缺口批次并记录完成进度。
- 交付记录写清批次 ID、场数、当前 completed 总数、取数 SQL 与括号残留抽检。

## 不在范围

- 不扩 worker 并发、不改模型 provider、不改 prompt。
- 不在本任务内做人工盲评或出口④复评。
- 不动前端 / admin-dashboard / engine-core。
