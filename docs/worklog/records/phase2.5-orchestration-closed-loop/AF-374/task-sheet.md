---
taskId: AF-374
contextId: phase2.5-orchestration-closed-loop
title: 编排闭环确定性收口返修：回执冻结、归档不写记录包、Task trailer、合并后状态自愈
type: implementation
status: backlog
baselineRef: de6f45c0f0781c073358a15b3ab4b8c2fefd74fd
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3, agent-orchestration/README.md#强制准入]
createdAt: 2026-11-23T18:20:00+08:00
deadline: null
agentRole: orchestrator
riskClass: R1
riskRationale: 只改编排脚本、钩子、契约文档与状态面工具，不触碰 engine-core、业务代码、数据库与线上配置；但会影响全仓提交门与归档语义，需完整编排单测与 strict 校验。
gateProfile: full
objective: 返修 AF-373 未合并 PR 暴露的提交序列缺口，并把回执、归档、提交信息与合并后状态面的确定性契约完整落到可合并提交
successCriteria:
  - 任务单与实现同一提交入库，PR 每个提交都能经 Orchestration Gate 逐提交复核
  - 回执摄入前必须已冻结进任务记录包，内容寻址副本一旦入库不可原地改写
  - run-once 验收与归档只写状态面，不再回写已入库 manifest，归档后 strict 校验保持通过
  - 提交信息优先解析 Task trailer，commit-msg 自动补齐，CI 对缺失或冲突硬失败
  - state seal 可自动备份并丢弃陈旧生成态，fast-forward integrate 后完成 events/worklog 校验
outOfScope:
  - 不改 engine-core、业务代码、数据库与线上配置
  - 不升级框架 schema 版本
references: []
priorTasks:
  - AF-365
  - AF-370
  - AF-372
  - AF-373
constraints:
  - 状态面只能经 CLI 写
  - 回执修订只能新增内容寻址文件，不得原地覆盖
  - 任务单必须先于实现进入首个提交
scope:
  files:
    - scripts/orchestration/
    - .husky/
    - docs/team/agent-orchestration/
    - docs/worklog/pending/
    - docs/worklog/records/
    - docs/worklog/completed/phase2.5/
    - package.json
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af374-orchestration-deterministic-hardening-2026-11-23.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测全绿
    threshold: exit 0，0 failed
  - command: pnpm exec vitest run scripts/orchestration/__tests__/v21-adapters.spec.mjs
    check: v2.1 适配层单测全绿
    threshold: exit 0，0 failed
  - command: pnpm orchestration:contracts
    check: 契约包校验通过
    threshold: exit 0
assertions:
  - 首个提交同时包含任务单与实现，CI 不再报 no-active-task
  - 已提交回执不可原地改写，只能新增内容寻址副本
  - 归档后工作树不出现记录包 manifest 脏文件
  - 无 Task trailer 的新提交被 CI 编排门拒绝
risks:
  - 收紧提交门会让历史未带 trailer 的分支推送失败，需要按两阶段提交补齐
  - state seal 会丢弃仅状态面的本地未提交改动，必须先备份
---

## 背景

AF-373 的实现已经本地验收并归档，但未合并 PR #180 的 Orchestration Gate 在首个提交 `481998a` 报 `no-active-task`：任务单是在第二个提交才入库，逐提交门无法在该提交上找到任务归属。按 `orchestration-cli-runbook` 第 4 节“已归档任务的未合并 PR 返修”口径，登记新任务 AF-374，承接同一范围并以正确提交序列重建。

## 范围

- 只改编排适配层与契约操作文档，不触碰 `src/engine-core/**` 与业务代码。
- 不改框架 schema 版本；新增的是适配层操作约束，v2.1.0 契约字段保持兼容。

## 验收

- `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs`
- `pnpm exec vitest run scripts/orchestration/__tests__/v21-adapters.spec.mjs`
- `pnpm orchestration:contracts`
- PR 每个提交均通过 `Orchestration Gate`，最终 HEAD 具备 passed durable 回执。
