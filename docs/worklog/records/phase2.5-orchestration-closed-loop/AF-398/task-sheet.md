---
taskId: AF-398
contextId: phase2.5-orchestration-closed-loop
title: AF-397 提交标题单一任务号返修
type: implementation
status: backlog
baselineRef: b58d64cf958ad83dcc775b9633d25382ba4e95ec
dependsOn: []
priorTasks: [AF-397, AF-396]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T01:36:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/admin-debug/
    - src/migration/
    - bin/ormconfig.ts
    - src/agent/llm/
    - src/config/envs/
    - .env.example
    - admin-dashboard/src/views/AutoPractice.vue
    - admin-dashboard/src/api/client.ts
    - test/admin-debug/
    - test/agent/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
    - docs/worklog/pending/archive/
  modules: []
  interfaces: []
artifacts: []
gates:
  - command: git log -1 --pretty=%s
    check: 提交标题只含单一任务号 AF-397
    threshold: 不含 AF-396
successCriteria:
  - 实现提交标题唯一任务号，满足 pr-release 标题校验
---

## 背景

AF-397 实现提交标题 `feat(af397): 重排 AF-396 交付提交链...` 同时含 AF-397 与 AF-396，被 `pr-release create` 拒绝。本任务仅用于授权重写提交标题，不改文件内容。
