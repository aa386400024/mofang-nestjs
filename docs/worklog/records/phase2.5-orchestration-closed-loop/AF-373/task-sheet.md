---
taskId: AF-373
contextId: phase2.5-orchestration-closed-loop
title: 编排闭环确定性收口：回执冻结、归档不写记录包、Task trailer、合并后状态自愈
type: implementation
status: backlog
baselineRef: de6f45c0f0781c073358a15b3ab4b8c2fefd74fd
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3, agent-orchestration/README.md#强制准入]
createdAt: 2026-11-23T16:57:00+08:00
deadline: null
agentRole: orchestrator
riskClass: R1
riskRationale: 只改编排脚本、钩子、契约文档与状态面工具，不触碰 engine-core、业务代码、数据库与线上配置；但会影响全仓提交门与归档语义，需完整编排单测与 strict 校验。
gateProfile: full
objective: 把回执、归档、提交信息与合并后状态面的四类确定性缝隙改成机器可判且不可绕过的操作契约
successCriteria:
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
constraints:
  - 状态面只能经 CLI 写
  - 回执修订只能新增内容寻址文件，不得原地覆盖
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
    path: docs/worklog/completed/phase2.5/af373-orchestration-deterministic-hardening-2026-11-23.md
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
  - 已提交回执不可原地改写，只能新增内容寻址副本
  - 归档后工作树不出现记录包 manifest 脏文件
  - 无 Task trailer 的新提交被 CI 编排门拒绝
risks:
  - 收紧提交门会让历史未带 trailer 的分支推送失败，需要按两阶段提交补齐
  - state seal 会丢弃仅状态面的本地未提交改动，必须先备份
---

## 背景

AF-365/367/368/369/370/372 收口过程中反复暴露四类确定性缝隙：回执在提交后才入包、归档后 manifest 被回写、提交任务号靠 subject 猜、合并后本地状态面靠人工 stash 恢复。本任务把四类缝隙改成机器可判、不可绕过的操作契约。

## 范围

- 只改编排适配层与契约操作文档，不触碰 `src/engine-core/**` 与业务代码。
- 不改框架 schema 版本；新增的是适配层操作约束，v2.1.0 契约字段保持兼容。

## 验收

- `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs`
- `pnpm exec vitest run scripts/orchestration/__tests__/v21-adapters.spec.mjs`
- `pnpm orchestration:contracts`
- `node scripts/orchestration/cli.mjs worklog verify --strict --state-free`
- `node scripts/orchestration/cli.mjs events verify`
- 收尾全量 `pnpm lint` / `pnpm typecheck` / `pnpm test` 真实数字。
</content>
