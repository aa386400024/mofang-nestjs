---
contractRef: "urn:agent-collaboration-framework:schema:task-sheet:1.2.0"
taskId: AF-364
contextId: "phase2.5-orchestration-closed-loop"
type: implementation
title: "扩展 orchestrator 资源域覆盖框架契约包"
status: backlog
baselineRef: "06955ce535be1b2df9bc1571738934ef3960f340"
dependsOn: []
supersedes: []
supersededBy: null
policyRefs: []
createdAt: "2026-11-23T14:40:00+08:00"
objective: "把 contracts/agent-collaboration-framework/ 纳入 orchestrator 的可写资源域，使框架契约包同步与校验由主控角色承接，避免再靠 executor 越域"
successCriteria:
  - "orchestrator Agent Card 的 resources 明确包含 contracts/agent-collaboration-framework/"
  - "cli validate 对 Agent Card 校验通过"
  - "card 变更不影响 executor 现有资源域"
outOfScope:
  - "不改 executor 资源域"
  - "不改契约包内容本身"
references:
  - ref: "docs/team/agent-orchestration/agent-cards/README.md"
    kind: spec
    note: "Agent Card 字段口径与维护规则"
  - ref: "docs/team/agent-orchestration/README.md"
    kind: spec
    note: "角色绑定与资源域"
priorTasks: []
constraints:
  - "只扩 orchestrator 资源域，不扩其他角色"
  - "不新增凭据或路径白名单以外的信息"
scope:
  files:
    - "docs/team/agent-orchestration/agent-cards/orchestrator.json"
    - "docs/team/agent-orchestration/agent-cards/README.md"
  modules: []
  interfaces: []
exclusions:
  - "scripts/ 与契约包本体"
requiredSkills:
  - "orchestration"
requiredTools:
  - "workspace-write"
agentRole: orchestrator
artifacts:
  - name: "交付记录"
    path: "docs/worklog/completed/phase2.5/af364-orchestrator-card-2026-11-23.md"
    kind: report
artifactSchema: null
deliveryPath: null
gates:
  - command: "node scripts/orchestration/cli.mjs validate"
    check: "Agent Card 校验通过"
    threshold: null
evidenceFormat: "命令 + 退出码 + 关键输出"
riskClass: R0
riskRationale: "仅调整角色资源域声明与文档，无运行时逻辑变化"
gateProfile: light
escalationTriggers:
  - "扩展资源域被用于越域写入"
priority: null
deadline: null
retention: null
---

# 扩展 orchestrator 资源域覆盖框架契约包

框架契约包同步属于主控编排职责，但 orchestrator 卡片当前未声明 `contracts/agent-collaboration-framework/`，导致 v2.1 消费任务被 IM-010 资源域越域拦截。本任务只修正资源域声明，不动契约内容。
