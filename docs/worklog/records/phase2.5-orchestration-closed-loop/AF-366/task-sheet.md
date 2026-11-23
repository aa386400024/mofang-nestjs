---
contractRef: "urn:agent-collaboration-framework:schema:task-sheet:1.2.0"
taskId: AF-366
contextId: "phase2.5-orchestration-closed-loop"
type: fix
title: "CI 编排门依赖与 PR 状态面解耦校验修复"
status: backlog
baselineRef: "06955ce535be1b2df9bc1571738934ef3960f340"
dependsOn: []
supersedes: []
supersededBy: null
policyRefs: []
createdAt: "2026-11-23T15:42:00+08:00"
objective: "修复 PR #178 暴露的 CI 编排门缺依赖与契约校验误判状态投影两处工程缺陷"
successCriteria:
  - "Orchestration Gate 在干净 runner 上安装锁定依赖后可通过 worklog strict --state-free"
  - "PR 任务分支的 contracts 校验显式跳过索引投影，integrate 推送仍保留全量投影校验"
  - "local validate --state-free 与 CI YAML 解析通过"
outOfScope:
  - "不改业务代码与引擎语义"
  - "不调整远程分支保护清单"
references:
  - ref: "https://github.com/aa386400024/mofang-nestjs/pull/178"
    kind: other
    note: "失败日志来源"
priorTasks:
  - "AF-365"
constraints:
  - "状态面只经 CLI 写，不手改 journal/index"
  - "不伪造 CI 结论"
scope:
  files:
    - ".github/workflows/ci.yml"
    - "scripts/orchestration/cli.mjs"
  modules:
    - "orchestration"
gates:
  - command: "pnpm orchestration:preflight"
    check: "任务门与 scope"
    threshold: "exit 0"
  - command: "pnpm lint"
    check: "lint"
    threshold: "0 error"
assertions:
  - "ci-task-gate 对 AF-366 提交范围 PASS"
risks:
  - "PR 与 integrate 校验路径分叉，需在交付记录写清条件"
owner: "orchestrator"
agentRole: orchestrator
riskClass: R1
riskRationale: "仅改 CI 门与校验开关，无业务运行时影响"
gateProfile: standard
artifactRefs:
  others: []
---

# AF-366 CI 编排门依赖与 PR 状态面解耦校验修复

## 背景

PR #178 在 `ed893655` 上暴露两处失败：

1. `Orchestration Gate` 没有安装依赖，`worklog verify --strict --state-free` 触发 `task-intake.mjs` 的 `yaml` 静态导入而 `ERR_MODULE_NOT_FOUND`。
2. `Contracts (framework 2.1.0)` 在 PR 合并引用上执行 `validate`，索引投影与任务分支不提交状态面的假设冲突，报 `索引投影一致 /：undefined`。

## 方案

- 编排门增加 pnpm 安装步骤，保证 strict 校验在干净 runner 可执行。
- `cli.mjs validate` 增加 `--state-free`，显式跳过索引投影并打印原因；integrate 推送仍全量校验。
- contracts job 按事件类型分叉：PR 用 `--state-free`，推送用全量。
