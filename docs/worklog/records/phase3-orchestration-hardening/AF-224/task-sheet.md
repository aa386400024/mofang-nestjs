---
taskId: AF-224
contextId: phase3-orchestration-hardening
title: 预研文档入库（Phase3 Judge Layer 方案）+ 架构文档资源域补挂
type: documentation
status: backlog
baselineRef: 57077be
dependsOn: []
priorTasks: [AF-223]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, agent-orchestration/README.md#强制准入]
createdAt: 2026-11-21T03:35:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md
    - docs/team/agent-orchestration/agent-cards/orchestrator.json
    - docs/worklog/records/phase3-orchestration-hardening/AF-224/
  modules:
    - docs
  interfaces: []
artifacts:
  - name: 交付记录 预研文档入库
    path: docs/worklog/completed/phase3-orchestration/af224-judge-layer-doc-intake-2026-11-21.md
    kind: report
  - name: Phase3 Judge Layer 预研方案
    path: docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md
    kind: document
gates:
  - command: pnpm orchestration:contracts
    check: 框架契约包与 agent card schema 校验通过
    threshold: exit=0
  - command: pnpm lint
    check: ESLint 0 error（文档改动不破坏既有 lint 面）
    threshold: exit=0
  - command: pnpm typecheck
    check: 类型检查 0 error
    threshold: exit=0
  - command: pnpm test
    check: 全量用例 0 failed（收尾一次，确认无回归）
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: empty
successCriteria:
  - 既有预研文档 `docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md` 纳入版本库，正文不改写（不改动原有结论与表格）。
  - 该文档在 `orchestrator` agent card 的资源域内可见：`docs/architecture/` 追加到 resources，避免后续以该目录为 scope 的任务被判 `scope-domain-conflict`。
  - 不引入任何代码、schema、迁移或依赖变化；`src/engine-core` 零 diff。
  - 入库后 `pnpm orchestration:worklog verify --strict` 与 `pnpm orchestration:status` 仍为通过态，活跃任务回落到 0。
---
