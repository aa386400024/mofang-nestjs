---
taskId: AF-164
contextId: phase2.5-orchestration-closed-loop
title: Phase2.5 待合并任务链的受保护 PR 批次发布
type: verification
status: backlog
baselineRef: b7ebc6195e5fa5f61ac4037f01bab8511eb6b41d
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T10:00:00+08:00
deadline: null
agentRole: orchestrator
priorTasks:
  - AF-126
  - AF-127
  - AF-128
  - AF-133
  - AF-136
  - AF-137
  - AF-140
  - AF-141
  - AF-142
  - AF-146
  - AF-147
  - AF-152
  - AF-154
  - AF-155
  - AF-156
  - AF-157
  - AF-158
  - AF-159
  - AF-161
  - AF-162
  - AF-163
  - IM-073
scope:
  files:
    - docs/worklog/
    - docs/team/agent-orchestration/
  modules: [orchestration]
  interfaces:
    - node scripts/orchestration/pr-release.mjs
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af164-release-integrate-2026-11-20.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs worklog verify --strict
    check: worklog 严格校验通过
    threshold: exit=0
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件链一致
    threshold: exit=0
successCriteria:
  - 从 task/AF-164-release-integrate 向 integrate 创建单一受保护 PR
  - PR 承载 origin/integrate..release 分支上 59 个已验收提交，任务链 22 个任务号全部在 priorTasks 显式声明
  - 13 项远端必需检查全绿后由 pr-release.mjs squash 合并
  - 合并后 integrate 快进同步，worklog verify 与 events verify 保持通过
---
# AF-164 · Phase2.5 待合并任务链的受保护 PR 批次发布

## 背景

`task/AF-152-quality-admin` 在 Phase2.5 迭代中累积了 59 个已验收但尚未进入 `integrate` 的提交，覆盖 AF-126–AF-163 任务链与编排状态面。所有任务均已完成机读验收与归档，但从未通过受保护 PR 进入 `integrate`；直接按单任务创建 PR 会被 `assertSingleTaskBranch` 判为链外任务混入。

## 目标

- 建立显式批次发布任务，把 59 个已验收提交作为一个受保护 PR 的整体交付单元；
- 在任务单 `priorTasks` 中完整声明链内任务号，保留逐任务审计链；
- 通过 `pr-release.mjs` 创建 PR、等待 13 项必需检查、squash 合并并快进同步 `integrate`；
- 合并后复核 worklog 与事件链，确认发布没有破坏编排状态面。

## 非目标

- 不修改任何业务代码、测试、配置或历史提交；
- 不重写已验收任务的交付记录或回执；
- 不做 L4（master 合并、tag、release、对外部署）；
- 不绕过必需检查、不使用直推或 `--no-verify`。
