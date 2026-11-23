---
contractRef: "urn:agent-collaboration-framework:schema:task-sheet:1.2.0"
taskId: AF-365
contextId: "phase2.5-orchestration-closed-loop"
type: implementation
title: "编排 v2.1：状态面解耦、风险分级、PR 生命周期与执行器心跳"
status: backlog
baselineRef: "06955ce535be1b2df9bc1571738934ef3960f340"
dependsOn: []
supersedes: []
supersededBy: null
policyRefs: []
createdAt: "2026-11-23T14:50:00+08:00"
objective: "把框架 v2.1 的风险分级、取代关系、依赖转接、周期时间与执行器心跳落到 mofang 适配层，并解耦状态面、补齐 PR 生命周期工具"
successCriteria:
  - "任务分支不再提交 journal/索引/快照/data.js；状态面由独立状态分支承载并有同步命令"
  - "CI 按 riskClass 与改动路径分档，R0/R1 不再等全量 13 项，R2 仍保留全量"
  - "pr-release 支持仓库级 list/triage/close/supersede，branch plan 默认 slug 可用"
  - "receipt scaffold 可从任务单生成六组骨架，strict 对 legacy 债不再静默 PASS"
  - "executor-session 支持 ack/heartbeat/progress/cancel/terminal 与失联回收"
  - "框架契约包 2.1.0 哈希校验通过，编排单测/lint/typecheck 全绿"
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
priorTasks:
  - "AF-364"
  - "AF-363"
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
agentRole: orchestrator
artifacts:
  - name: "交付记录"
    path: "docs/worklog/completed/phase2.5/af365-orchestration-v21-2026-11-23.md"
    kind: report
artifactSchema: null
deliveryPath: null
gates:
  - command: "node scripts/orchestration/cli.mjs test"
    check: "编排单测全绿"
    threshold: null
  - command: "node scripts/orchestration/verify-framework-bundle.mjs"
    check: "框架契约包哈希与版本一致"
    threshold: null
  - command: "pnpm lint"
    check: "lint 全绿"
    threshold: null
  - command: "pnpm typecheck"
    check: "typecheck 全绿"
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

## 一、范围与前置修正

AF-363 因 `agentRole: executor` 与 scope 越域被 IM-010 拦截；AF-364 先行扩展 orchestrator 资源域，但为避免拆成两个 PR，已将两者并入本任务，`priorTasks` 双向可追溯。orchestrator 卡片新增 `contracts/agent-collaboration-framework/` 资源域随本任务提交。

## 二、交付分组

1. 状态面解耦：业务分支不再提交 `task-state-index.json` / `state/journal.jsonl` / `orchestration-snapshot.json` / `web/orchestration/data.js`；由 `state sync` 在状态分支或收尾快照落地。
2. 风险分级门禁：CI 按 `riskClass` + 改动路径分档；R0 轻量、R1 定向、R2 全量 13 项；不允许把低风险解释成免检。
3. PR 生命周期：`pr-release` 增加仓库级 `list / triage / close / supersede`，`branch plan` 自动生成合规 slug。
4. 回执与 strict：`receipt scaffold` 生成六组骨架；`worklog verify --strict` 对 legacy 指针与无任务单从静默 PASS 改为显式计数 + 阈值。
5. 执行器心跳：新增 `executor-session` 落盘与 `session heartbeat/terminal` 命令，超时未心跳进入 `lost` 并回收租约。
6. 契约包：新增 `contracts/agent-collaboration-framework/2.1.0/`，`verify-framework-bundle.mjs` 按版本目录校验。

## 三、验收口径

- 状态面：任务分支 diff 不含四个生成态文件；历史归档可由 CLI 重建。
- 门禁：R2 仍 13/13；R0/R1 的跳过项有显式记录，不是静默放行。
- PR 工具：`list` 可仓库级只读盘点；`close/supersede` 有 dry-run 与幂等。
- 心跳：无心跳超租约会话判 `lost`，不能把 GUI 窗口存活当作执行存活。
- 双仓：框架仓 `e412403` 与适配层契约包内容哈希一致。
