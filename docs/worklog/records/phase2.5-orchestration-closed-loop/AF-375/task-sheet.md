---
taskId: AF-375
contextId: phase2.5-orchestration-closed-loop
title: integrate 状态快照同步与 post-merge 编排门解耦
type: fix
status: backlog
baselineRef: 8c314c6ea1a9c5ac46636450516ed477bdc9f80d
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3, agent-orchestration/README.md#强制准入]
createdAt: 2026-11-23T18:35:00+08:00
deadline: null
agentRole: orchestrator
riskClass: R1
riskRationale: 只同步生成态状态快照并调整 CI 校验口径，不改业务代码、engine-core、数据库与线上配置；但状态快照体量大，需逐文件核对来源。
gateProfile: full
objective: 修复 AF-374 合并后 integrate CI 失败：状态索引仍停留在 1.1.0 且 push 门对解耦状态面使用 strict，导致单测与 post-merge Orchestration Gate 同时失败
successCriteria:
  - integrate 提交携带 task-state-index 1.2.0 快照，单测不再出现 1.1.0 / 1.2.0 版本漂移
  - push 到 integrate 的 Orchestration Gate 使用 --state-free 校验，与 PR 分支口径一致
  - events verify、worklog verify --strict --state-free、全量单测全部通过
outOfScope:
  - 不改 engine-core、业务代码、数据库与线上配置
  - 不升级框架 schema 版本
references: []
priorTasks:
  - AF-374
  - AF-370
  - AF-365
constraints:
  - 状态面只经 CLI 生成，不手工改写
  - 状态快照与代码修复分开提交
scope:
  files:
    - .github/workflows/ci.yml
    - docs/team/agent-orchestration/
    - web/orchestration/data.js
    - docs/worklog/records/
    - docs/worklog/completed/phase2.5/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af375-integrate-state-snapshot-2026-11-23.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测全绿
    threshold: exit 0，0 failed
  - command: pnpm test
    check: 全量单测全绿
    threshold: exit 0，0 failed
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件链与投影一致
    threshold: exit 0
assertions:
  - 提交后的 task-state-index version 为 1.2.0
  - push 门不再对解耦状态面报孤儿记录包
  - 本地 integrate 工作树不再保留生成态脏文件
risks:
  - 状态快照会把本机归档历史一次性固化，需确保事件链与投影一致后再提交
---

## 背景

AF-374 合并后，integrate 的远端 CI 暴露两处口径缺口：提交树内 `task-state-index` 仍是 1.1.0，而单测已按 1.2.0 契约断言；push 事件的 `Validate worklog record bundles` 对状态面解耦分支仍走 `--strict`，把索引未携带的孤儿记录包判为失败。

## 范围

- 只提交由 CLI 生成的当前状态快照（索引、事件日志、看板快照、data.js）与 CI 口径修复。
- 不触碰 engine-core、业务代码与框架 schema。

## 验收

- `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs`
- `pnpm test`
- `node scripts/orchestration/cli.mjs events verify`
- `node scripts/orchestration/cli.mjs worklog verify --strict --state-free`
- 合并后 integrate push 的 Orchestration Gate 通过。
