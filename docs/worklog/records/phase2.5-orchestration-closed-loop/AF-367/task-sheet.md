---
contractRef: "urn:agent-collaboration-framework:schema:task-sheet:1.2.0"
taskId: AF-367
contextId: "phase2.5-orchestration-closed-loop"
type: fix
title: "CI 门禁与状态面解耦测试假设收口"
status: backlog
baselineRef: "06955ce535be1b2df9bc1571738934ef3960f340"
dependsOn: []
supersedes:
  - "AF-366"
supersededBy: null
policyRefs: []
createdAt: "2026-11-23T15:55:00+08:00"
objective: "在状态面解耦前提下修复任务分支上误用已提交索引的编排单测，并补齐 CI 条件环境与交付证据"
successCriteria:
  - "PR 任务分支的编排单测在 ORCH_STATE_FREE=1 下不再要求索引为最新 1.2.0 状态"
  - "integrate 推送仍保留索引版本、契约对账与投影一致性的全量断言"
  - "Orchestration Gate 依赖安装、Contracts 状态面分叉、Unit/Coverage 全绿"
outOfScope:
  - "不改业务代码与引擎语义"
  - "不把任务分支的状态面提交回分支"
references:
  - ref: "https://github.com/aa386400024/mofang-nestjs/pull/178"
    kind: other
    note: "Unit/Coverage 失败证据"
priorTasks:
  - "AF-366"
constraints:
  - "状态面只经 CLI 写，不手改 journal/index"
  - "不通过跳过测试伪装通过；state-free 仅限定状态面断言"
scope:
  files:
    - ".github/workflows"
    - "scripts/orchestration"
    - "docs/worklog"
  modules:
    - "orchestration"
gates:
  - command: "pnpm orchestration:preflight"
    check: "任务门与 scope"
    threshold: "exit 0"
  - command: "pnpm lint"
    check: "lint"
    threshold: "0 error"
  - command: "pnpm test"
    check: "全量单测"
    threshold: "0 failed"
assertions:
  - "PR Unit 三个分片与 Coverage 全绿"
risks:
  - "state-free 分支放宽断言，需保证 integrate 全量门仍严格"
agentRole: orchestrator
riskClass: R1
riskRationale: "仅调整测试假设与 CI 环境，不改运行时行为"
gateProfile: standard
artifactRefs:
  others: []
---

# AF-367 CI 门禁与状态面解耦测试假设收口

## 背景

AF-366 已让 `Orchestration Gate` 与 `Contracts` 在 PR 上通过。剩余 Unit 三个分片与 Coverage 分片 2 的失败根因是同一处：任务分支按设计不提交 `task-state-index.json`，测试却读取仓内基线索引并断言其版本为 1.2.0、与 journal 逐字段一致。

## 方案

- 测试显式识别 `ORCH_STATE_FREE=1`：任务分支只验证索引 schema 与自洽，不要求索引为最新运行态；`integrate` 推送仍执行全量版本、契约与投影断言。
- CI 顶层注入 `ORCH_STATE_FREE`：PR 为 1，推送为 0。
- 保留 AF-366 的编排门依赖安装与 contracts 分叉修复。
