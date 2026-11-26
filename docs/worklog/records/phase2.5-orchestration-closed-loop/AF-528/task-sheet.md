---
taskId: AF-528
contextId: phase2.5-orchestration-closed-loop
title: AF-527 收口补记：旧实例终端自启防护与状态面 trailer 修正
type: documentation
status: backlog
baselineRef: 686c56194f683713d6bec20c333f267e2dce30a6
dependsOn: []
priorTasks: [AF-527, AF-526]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3, agent-orchestration/README.md#强制准入]
createdAt: 2026-11-26T12:00:00+08:00
deadline: null
agentRole: executor
riskClass: R1
riskRationale: 只改运行手册与收口记录，不碰业务代码、队列配置、数据库或运行态；用于补记 AF-527 实测到的旧实例终端自启，并修正状态面提交 trailer 使 integrate 推送门恢复绿色。
gateProfile: full
objective: 补记 AF-527 旧实例终端的自启风险并给出进程树处置方式，同时修正状态面提交的 Task trailer，使 integrate 推送门恢复绿色。
successCriteria:
  - 运行手册补写旧 worktree 的 VS Code 终端可能重放 pnpm start:dev，停进程后需按进程树关闭终端并观察 60–90 秒。
  - 新增 AF-527 收口补记，记录 11:40:54 自启、11:41:22 监听 3000、随后 taskkill 进程树并复核 oldBackendCount=0。
  - 不启动 1000 场出口⑤批次，不产生 LLM 费用。
  - events verify PASS；worklog verify --strict --state-free PASS；src/engine-core 零 diff。
outOfScope:
  - 不启动 1000 场出口⑤批次，不发起任何自动对练批次。
  - 不改业务代码、engine-core、数据库结构、.env 或生产部署拓扑。
  - 不改队列前缀实现，不重新跑 smoke。
  - 不碰 admin-dashboard 与 Flutter 代码。
scope:
  files:
    - docs/runbooks/
    - docs/worklog/completed/
    - docs/worklog/records/
    - docs/worklog/pending/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af528-af527-closeout-2026-11-26.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件链一致
    threshold: exit 0 且 PASS
  - command: node scripts/orchestration/cli.mjs worklog verify --strict --state-free
    check: 工作日志严格校验通过
    threshold: exit 0 且 PASS
acceptance:
  - 运行手册含旧实例终端自启处置段。
  - 补记记录含实测 PID/时间/端口与最终复核。
  - 状态面提交走 Task none，integrate 推送 Orchestration Gate 恢复绿色。
---

## 背景

AF-527 已完成合并，但合并后的状态面提交 `686c5619` 因提交正文缺少合法 `Task` trailer，在 integrate 推送的 Orchestration Gate 失败。同时，AF-527 清理旧后端后，旧 worktree 的 VS Code 终端在 11:40:54 重放 `pnpm start:dev`，11:41:22 再次拉起 `dist/app` 监听 3000。需要在运行手册中写明“只停进程不够，要按进程树关闭终端并观察”，并留下收口补记。

## 范围

只改文档：`docs/runbooks/validation-environment-isolation.md` 增加旧实例终端自启处置；新增 `docs/worklog/completed/phase2.5/af528-af527-closeout-2026-11-26.md` 记录实测事实与最终复核。不改代码、不改队列实现、不重跑 smoke、不启动 1000 场批次。
