---
taskId: AF-171
contextId: phase2.5-orchestration-closed-loop
title: 修复 Orchestration Gate 零依赖与编排单测夹具
type: fix
status: backlog
baselineRef: 096011fc8028a91fa87deaa4129b668961d6a15c
dependsOn: [AF-169]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T10:40:00+08:00
deadline: null
agentRole: orchestrator
priorTasks: [AF-170, AF-169, AF-168, AF-164, AF-163]
scope:
  files:
    - scripts/orchestration/
    - docs/worklog/
    - docs/team/agent-orchestration/
  modules: [release, orchestration]
  interfaces:
    - node scripts/orchestration/cli.mjs worklog verify --strict
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af171-release-gate-dependency-fix-2026-11-20.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs scripts/orchestration/__tests__/worklog.spec.mjs
    check: 编排单测全绿
    threshold: exit=0
  - command: node scripts/orchestration/cli.mjs worklog verify --strict
    check: 记录包严格校验
    threshold: exit=0
successCriteria:
  - Orchestration Gate 的 worklog verify 在无 node_modules 环境可运行，不静态加载 yaml
  - 编排验收单测使用仓内确定性夹具，不依赖被忽略的历史记录文件
  - AF-168/AF-169/AF-171 提交链逐提交通过 ci-task-gate
  - 新 PR 的 13 项必需检查全绿后 squash 合并进 integrate
---

# AF-171 · 修复 Orchestration Gate 零依赖与编排单测夹具

> 状态：待执行（2026-20）
> 执行方：自做（主 AI，orchestrator 角色）
> 仓库：D:\work\Project\backend\mofang-nestjs-af070
> 唯一事实源：PR #51 失败日志、orchestration-cli-runbook references/closed-loop.md §4
> 任务性质：发布门修复
> 改动范围：编排 CLI 延迟加载、编排单测夹具、交付记录与记录包

## 1. 背景

PR #51 的 Orchestration Gate 在 `worklog verify --strict` 阶段报 `Cannot find package 'yaml'`：
`cli.mjs` 顶层静态导入 `task-intake.mjs`，后者依赖 yaml，而 Gate 按设计不安装 node_modules。
同时 Unit 三个分片都因验收单测引用工作区私有历史文件而失败。

AF-170 首次执行时回执 commit 指针笔误导致 rejected；本任务在同一修复面上重开，
从 AF-169 发布头重新提交，避免把被拒证据带入发布分支。

## 2. 范围

在范围内：

- `scripts/orchestration/cli.mjs`：任务单解析改为按需动态导入。
- `scripts/orchestration/__tests__/orchestration.spec.mjs` 与 `fixtures/`：自包含夹具。
- `docs/worklog/`、`docs/team/agent-orchestration/`：交付记录、记录包、状态面。

不在范围内：

- 不改 `src/`、`bin/`、`admin-dashboard/`。
- 不放宽 CI 门、不删除必需检查、不改分支保护。

## 3. 交付物

- 零依赖 Gate 可运行的 CLI 模块图。
- 确定性编排单测夹具。
- AF-171 记录包、delivery record、durable 回执。
- 指向 `integrate` 的受保护 PR。

## 4. 红线

- engine-core 零改动。
- 不使用 `--no-verify`、不关闭分支保护、不删除必需检查。
- 不把被忽略的历史记录文件当测试依赖。

## 5. 闸门

- 编排单测全绿。
- `worklog verify --strict` exit 0，且在移除 yaml 后仍 exit 0。
- `ci-task-gate` 对 AF-168/AF-169/AF-171 提交链逐提交 PASS。

## 6. 交付记录

`docs/worklog/completed/phase2.5/af171-release-gate-dependency-fix-2026-11-20.md`

## 7. 回写清单

- 记录包与回执归档、状态面更新。
- PR 合并后关闭被 supersede 的 PR #51。
