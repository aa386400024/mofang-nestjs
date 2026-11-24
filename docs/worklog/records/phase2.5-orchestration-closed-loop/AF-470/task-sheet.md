---
taskId: AF-470
contextId: phase2.5-orchestration-closed-loop
title: 扩展 executor 资源域覆盖 scripts/eval/
type: implementation
status: backlog
baselineRef: 28aa06c1dbfe9f35acda47fb62c18c0c25a08f01
dependsOn: []
priorTasks: [AF-364, AF-466, AF-469]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.2, conventions.md#1.3]
createdAt: 2026-11-24T21:10:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/team/agent-orchestration/agent-cards/executor.json
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-470/
  modules:
    - orchestration
  interfaces: []
artifacts:
  - name: executor 资源域扩展记录
    path: docs/worklog/completed/phase2.5/af470-executor-eval-resource-2026-11-24.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs validate
    check: Agent Card 与状态索引校验通过
    threshold: 0 failed
successCriteria:
  - executor Agent Card 的 resources 明确包含 scripts/eval/
  - 不扩其他资源域，不改 orchestrator 资源域
  - cli validate 对 Agent Card 校验通过
  - 解除 AF-466（src/test + scripts/eval 混合实现）因 IM-010 被拦截的问题
---

## 1. 背景

AF-466 是“角色资产补齐 + 评测 harness 参数化”的单一实现任务，scope 同时包含 `src/engine-adapters/`、`test/`、`bin/` 与 `scripts/eval/visitor-register-stability/`。执行时 `run-once` 报 `scope-domain-conflict AF-466`：executor Agent Card 的 resources 覆盖 `src/`、`bin/`、`test/`，但不覆盖 `scripts/`，因此无法领单。

这不是 AF-466 scope 写错，而是 executor 资源域缺少“评测脚本实现”这一真实工作类型。AF-465 的 harness 与 11 条单测也落在 `scripts/eval/`，同类任务会反复被拦。

## 2. 实现口径

- 只把 `scripts/eval/` 加入 executor 的 resources；不放开整个 `scripts/`，避免 executor 触达 `scripts/orchestration/` 等主控域。
- 不改 executor 的 tools / limits / skills，不改 orchestrator 资源域。
- 只改 Agent Card 与交付记录，不改调度器代码、不放宽 IM-010 校验。

## 3. 非目标

- 不为 AF-466 单独开口子或绕过 IM-010。
- 不扩大 executor 到 `src/engine-core`、`scripts/orchestration/`、`admin-dashboard/` 之外的新域。
- 不改任何业务实现。
