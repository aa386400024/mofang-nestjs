---
taskId: AF-451
contextId: phase2.5-orchestration-closed-loop
title: 合成语料生成器补写内核指纹并重跑
type: implementation
status: backlog
baselineRef: 50ef424ff2005da7dae593791b4dd854c4231851
dependsOn: []
priorTasks: [AF-450, AF-449]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T11:15:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/ops/quality/af448-scripted-corpus.ts
    - docs/worklog/pending/af451-scripted-kernelref-task-2026-11-24.md
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-451/
    - docs/worklog/completed/phase2.5/af451-scripted-kernelref-2026-11-24.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af451-scripted-kernelref-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec tsx scripts/ops/quality/af448-scripted-corpus.ts --apply
    check: 重跑后 6 场合成会话带上 kernelRef
    threshold: exit=0
  - command: node scripts/ops/quality/af427-operator-delta-ledger.mjs --dir data/debug-sessions
    check: 表四出现 kr1- 版本桶且其中含 6 场合成会话
    threshold: exit=0
---

# 背景

AF-450 把台账拆成真实 / 合成 / kernelRef 三段统计后，表四显示 19 场语料全落在 `none` 桶 —— 其中 6 场合成语料是 AF-449 刚生成的，本可以带上当时内核指纹。生成器 `af448-scripted-corpus.ts` 读的是内核 delta 表，却没把 `KERNEL_REF` 写进会话，导致这批语料也无法按内核版本追溯（AF-450-B1）。

# 目标

1. `scripts/ops/quality/af448-scripted-corpus.ts` 引入 `KERNEL_REF`（`src/engine-adapters/observability/kernel-fingerprint.ts` 的公开导出），写进每个合成会话的 `kernelRef` 字段。
2. 用 `--apply` 重跑，覆盖已有 6 场合成语料（`data/debug-sessions/`，gitignored）。
3. 台账复核表四：出现 `kr1-` 桶，且该桶 `syntheticSessions` 等于合成会话数。

# 边界

- 只改生成器的落盘元数据，不改剧本台词、不改分类器、不改台账脚本、不改内核。
- 不打印逐字稿原文。
- 不复刻内核指纹算法，直接引公开导出，避免第二份实现。

# 成功判据

1. `pnpm exec tsx scripts/ops/quality/af448-scripted-corpus.ts --apply` exit=0，6 个会话文件均含 `kernelRef` 且值以 `kr1-` 开头。
2. `node scripts/ops/quality/af427-operator-delta-ledger.mjs --dir data/debug-sessions` 表四出现 `kr1-` 桶，合成会话数对得上；表三（真实口径）数字不变（13 场）。
3. `pnpm typecheck` 0 error；`git diff --stat HEAD -- src/engine-core` 为空。
