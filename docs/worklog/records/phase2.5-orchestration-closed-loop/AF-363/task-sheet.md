---
contractRef: "urn:agent-collaboration-framework:schema:task-sheet:1.1.0"
taskId: AF-363
contextId: "phase2.5-orchestration-closed-loop"
type: implementation
title: "编排 v2.1：状态面解耦、风险分级、PR 生命周期与执行器心跳"
status: backlog
baselineRef: "06955ce535be1b2df9bc1571738934ef3960f340"
dependsOn: []
supersedes: []
supersededBy: null
policyRefs: []
createdAt: "2026-11-23T13:30:00+08:00"
objective: "把框架 v2.1 的风险分级、取代关系、依赖转接、周期时间与执行器心跳落到 mofang 适配层，并解耦状态面、补齐 PR 生命周期工具"
successCriteria:
  - "任务分支不再提交 journal/索引/快照/data.js；状态面由独立状态分支或生成物承载并有同步命令"
  - "CI 按 riskClass 与改动路径分档，R0/R1 不再等全量 13 项，R2 仍保留全量"
  - "pr-release 支持仓库级 list/triage/close/supersede，branch plan 默认 slug 可用"
  - "receipt scaffold 可从任务单生成六组骨架，strict 对 legacy 债不再静默 PASS"
  - "executor-session 支持 ack/heartbeat/progress/cancel/terminal 与失联回收"
  - "框架包 2.1.0 哈希校验通过，编排单测/lint/typecheck 全绿"
outOfScope:
  - "不改 BDI 业务引擎语义"
  - "不重写历史任务单与归档记录"
references:
  - ref: "D:/work/Project/agent-collaboration-framework/CHANGELOG.md"
    kind: document
    note: "框架 v2.1.0 契约与不变量来源"
  - ref: "docs/team/agent-orchestration/README.md"
    kind: spec
    note: "适配层现状与 13 项 gate 口径"
priorTasks: []
constraints:
  - "状态面只经 CLI 写，不手改 journal/index"
  - "不伪造临床数值；未标定机制默认关闭"
  - "跨仓提交只写 artifactRefs.others，不写 changedFiles.commits"
scope:
  files:
    - "scripts/orchestration"
    - ".github/workflows"
    - "package.json"
    - "contracts/agent-collaboration-framework"
    - "docs/team/agent-orchestration"
    - "docs/worklog"
  modules: []
  interfaces: []
exclusions:
  - "src/ 与 test/ 业务代码"
requiredSkills:
  - "orchestration"
requiredTools:
  - "workspace-write"
  - "gate-execution"
  - "version-control"
agentRole: executor
artifacts:
  - name: "交付记录"
    path: "docs/worklog/completed/phase2.5/af361-orchestration-v21-2026-11-23.md"
    kind: report
artifactSchema: null
deliveryPath: null
gates:
  - command: "pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs"
    check: "编排单测全绿"
    threshold: null
  - command: "pnpm lint"
    check: "lint 全绿"
    threshold: null
  - command: "pnpm typecheck"
    check: "typecheck 全绿"
    threshold: null
  - command: "node scripts/orchestration/verify-framework-bundle.mjs"
    check: "框架契约包哈希与版本一致"
    threshold: null
evidenceFormat: "命令 + 退出码 + 数字"
riskClass: R2
riskRationale: "触及状态面、发布门、CI 拓扑与执行器生命周期，属于编排核心不可回退变更"
gateProfile: full
escalationTriggers:
  - "状态面迁移导致历史归档不可重建"
  - "required checks 调整后无法证明 R2 仍全量"
priority: null
deadline: null
retention: null
---

# 编排 v2.1：状态面解耦、风险分级、PR 生命周期与执行器心跳

本任务把框架 v2.1 的可执行条款落到 mofang 适配层。核心取舍是：状态面与业务分支解耦，门禁按风险分级，但 R2 仍保留全量；执行器存活以心跳为准，窗口 PID 只作投递证据。
