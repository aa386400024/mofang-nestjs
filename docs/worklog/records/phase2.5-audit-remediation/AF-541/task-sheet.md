---
taskId: AF-541
contextId: phase2.5-audit-remediation
title: 扩充 executor 资源域以覆盖部署与 CI 文件
type: implementation
status: backlog
baselineRef: 33fe92e616ae3562ca7dec029fd84cfc06f9fb3e
dependsOn: []
priorTasks: [AF-540]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1]
createdAt: 2026-11-26T18:40:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - docs/team/agent-orchestration/agent-cards/executor.json
    - docs/worklog/records
  modules: []
  interfaces: []
artifacts: []
gates:
  - command: pnpm orchestration:preflight
    check: PASS
    threshold: exit 0
successCriteria:
  - executor 资源域覆盖 Dockerfile / compose / .dockerignore / package.json / CI workflow
---

# AF-541 · 扩充 executor 资源域

审计修复包含部署与 CI 文件，但 executor Agent Card 资源域未声明仓根 Dockerfile / compose / .dockerignore / package.json / `.github/workflows/`，导致调度阶段 `scope-domain-conflict`。

本任务只改 `docs/team/agent-orchestration/agent-cards/executor.json` 的 `resources`，补齐这些真实可写资源，不改任何执行语义。
