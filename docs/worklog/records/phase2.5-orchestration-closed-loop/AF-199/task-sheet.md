---
taskId: AF-199
contextId: phase2.5-orchestration-closed-loop
title: 收口 executor 记录目录资源域
type: fix
status: backlog
baselineRef: ca25d2e79abefef67d219a82a0c969f0c192da9d
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.2, conventions.md#1.3, conventions.md#5]
createdAt: 2026-11-20T19:40:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/team/agent-orchestration/agent-cards/executor.json
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-199/
    - docs/worklog/completed/phase2.5/af199-executor-card-records-2026-11-20.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af199-executor-card-records-2026-11-20.md
    kind: report
gates:
  - command: pnpm orchestration:validate
    check: Agent Card 与工具契约校验通过
    threshold: exit=0
  - command: node scripts/orchestration/cli.mjs worklog verify --strict
    check: 记录包完整
    threshold: exit=0
successCriteria:
  - executor resources 纳入 docs/worklog/records/，后续任务单可与实现同提交
  - 不放宽代码域与 cannotDo
  - 任务单、回执、交付记录与状态面同源
plannedArtifacts: []
requiredSkills: []
requiredTools: []
outOfScope:
  - src/engine-core/ 任何文件
constraints:
  - 不手改 journal / task-state-index
  - AF-193 rejected 历史原样保留
priorTasks: [AF-193]
---

# AF-199 · 收口 executor 记录目录资源域

## 背景

AF-193 已完成同一修正但 CI 因执行提交未携带状态面失败；AF-199 按两阶段提交口径将 Agent Card、任务单与 submitted 状态面同提交落地。

## 验收

见 frontmatter `successCriteria`。
