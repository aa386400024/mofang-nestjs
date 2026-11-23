---
taskId: AF-388
contextId: phase2.5-orchestration-closed-loop
title: 工作区产物收口线性化落地
type: documentation
status: backlog
baselineRef: 78f0501653ebbd62006c8bf9c3cc699c42938e71
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3, agent-orchestration/README.md#强制准入]
createdAt: 2026-11-23T22:24:00+08:00
deadline: null
agentRole: orchestrator
riskClass: R1
riskRationale: 仅把 AF-386/AF-387 已完成的文档收口内容在 integrate 基线上线性落地；不触碰源码、CI、数据库与运行配置。
gateProfile: light
objective: 用单个实现提交把 .gitignore 阻断、relay-response 证据、AF-386/AF-387 记录包与交付记录落到 AF-388 下，避免 AF-386 的 rejected 提交进入逐提交编排门。
successCriteria:
  - 实现提交只包含 .gitignore、relay-response 文档、AF-386/AF-387/AF-388 记录包与交付记录
  - 回执声明实现提交，且文件域全部落在任务 scope 内
  - AF-386 的 rejected 历史保留在归档索引，不改状态、不 force push 原分支
  - src、test、bin、engine-core 零改动
outOfScope:
  - 不重写 AF-386 的提交历史，不把 AF-386 rejected 改成 completed
  - 不提交 data/phase25-exit 原始实验数据与 .tmp 临时产物
  - 不改业务代码、CI、数据库迁移与运行配置
references: []
priorTasks:
  - AF-387
  - AF-386
constraints:
  - 状态面只能经 CLI 写入
  - 任何提交不得使用 --no-verify
  - 只暂存本任务声明的文件
scope:
  files:
    - .gitignore
    - docs/worklog/pending/archive/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
    - docs/worklog/completed/phase2.5/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af388-workspace-artifact-cleanup-landing-2026-11-23.md
    kind: report
gates:
  - command: git diff --check
    check: 空白与冲突标记检查
    threshold: exit 0
  - command: pnpm orchestration:preflight
    check: 编排前置门通过
    threshold: exit 0
  - command: pnpm lint
    check: ESLint 全绿
    threshold: exit 0
  - command: pnpm typecheck
    check: TypeScript 全量类型检查通过
    threshold: exit 0
  - command: pnpm test
    check: 全量单测通过
    threshold: exit 0，0 failed
assertions:
  - 实现提交在 AF-388 名下，逐提交编排门不遇到 AF-386 rejected 提交
  - AF-388 交付记录包含六组机读字段标记
  - git diff --stat HEAD -- src/engine-core 输出为空
---

## 背景

AF-386 完成了实际文件收口，但因任务单 scope 未覆盖登记落点，机读验收为 rejected；AF-387 补了 scope 与交付字段并 completed，但其分支从 AF-386 HEAD stacked，逐提交编排门会看到 AF-386 的 rejected 提交，无法作为 PR 合入 integrate。

本任务从 AF-387 的最终树出发，在 integrate 基线上用单个实现提交把同一批文档与记录包落在 AF-388 名下：保留 AF-386/AF-387 记录包与交付记录作为历史证据，不重写、不 force push 原分支，也不把 AF-386 rejected 改成 completed。
