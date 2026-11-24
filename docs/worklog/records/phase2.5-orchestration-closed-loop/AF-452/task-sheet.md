---
taskId: AF-452
contextId: phase2.5-orchestration-closed-loop
title: AF-438 收口：标记为被 AF-450 取代并补齐归档件
type: documentation
status: backlog
baselineRef: ecfcde196416623412cd4eb8758f3e8912fc9452
dependsOn: []
priorTasks: [AF-451, AF-450, AF-438]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T11:45:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/worklog/pending/af452-close-af438-task-2026-11-24.md
    - docs/worklog/completed/phase2.5/af438-kernelref-grouping-2026-11-24.md
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-452/
    - docs/worklog/completed/phase2.5/af452-close-af438-2026-11-24.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af452-close-af438-2026-11-24.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs worklog verify --strict
    check: PASS 且活跃任务归零
    threshold: exit=0
---

# 背景

AF-438（台账按 kernelRef 分组统计语料版本分布）停在 backlog，`dependsOn: [AF-437]` 而 AF-437 早已归档，依赖永远不可满足。其目标已由 AF-450（真实 / 合成 / kernelRef 三段统计 + 表四分布）与 AF-451（合成语料补写指纹）实际完成，只剩「状态面收口」没做。

# 目标

1. AF-438 经 CLI 闭合为 canceled（理由：已被 AF-450 / AF-451 取代），不再占 backlog。
2. 补齐 AF-438 记录包声明的交付记录路径 `af438-kernelref-grouping-2026-11-24.md`，内容为「已被取代」事实说明，不含实现。
3. 本单交付记录 `af452-close-af438-2026-11-24.md` 记录收口过程。

# 边界

- 只做状态面与归档补齐，不改任何脚本 / 代码 / 台账。
- 不删除 AF-438 记录包，保留审计链。

# 成功判据

1. `node scripts/orchestration/cli.mjs status` 活跃任务为 0（AF-438 不再在列）。
2. `node scripts/orchestration/cli.mjs worklog verify --strict` PASS。
3. `node scripts/orchestration/cli.mjs events verify` PASS（哈希链与索引投影一致）。
