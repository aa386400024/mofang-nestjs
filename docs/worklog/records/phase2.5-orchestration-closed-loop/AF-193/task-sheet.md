---
taskId: AF-193
contextId: phase2.5-orchestration-closed-loop
title: executor 资源域纳入任务记录目录
type: fix
status: backlog
baselineRef: 4ca4dbe5c772bccc9bf1a3c73ad0dbc4a0e49866
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.2, conventions.md#1.3, conventions.md#5]
createdAt: 2026-11-20T19:12:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/team/agent-orchestration/agent-cards/executor.json
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-193/
    - docs/worklog/completed/phase2.5/af193-executor-card-records-2026-11-20.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af193-executor-card-records-2026-11-20.md
    kind: report
gates:
  - command: pnpm orchestration:validate
    check: Agent Card 与工具契约校验通过
    threshold: exit=0
  - command: pnpm orchestration:status
    check: 索引与事件链可读
    threshold: exit=0
successCriteria:
  - executor Agent Card resources 显式包含 docs/worklog/records/，使任务单可与执行提交同仓
  - 不改变 executor 的业务代码域与禁止项
  - 任务单、交付记录、回执、索引与事件同源
plannedArtifacts: []
requiredSkills: []
requiredTools: []
outOfScope:
  - src/engine-core/ 任何文件
  - Flutter 客户端代码
constraints:
  - 不手改 journal / task-state-index
  - 仅调整资源域，不放宽 cannotDo
priorTasks: [AF-192]
---

# AF-193 · executor 资源域纳入任务记录目录

## 背景

CI `Orchestration Gate` 要求每个执行提交同时携带 `docs/worklog/records/<context>/<taskId>/task-sheet.md`；但 executor Agent Card 的 `resources` 只列 `docs/worklog/pending/` 与 `docs/worklog/completed/`，导致带 records 的任务在 `validateScopeDomain` 被拦截，形成“CI 要任务单、调度不让任务单进 scope”的死锁。

## 处置

在 executor 的 `resources` 中增加 `docs/worklog/records/`：记录目录是执行证据与任务单的法定位置，不是策略或业务代码；`cannotDo` 与代码域保持不变。

## 验收

见 frontmatter `successCriteria`。
